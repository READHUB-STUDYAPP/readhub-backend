import type { Request, Response } from 'express'
import { isValidObjectId, Types } from 'mongoose'
import Book from '../models/Books.js'
import ReadingSession from '../models/readingSession.js'

const errMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** Bounded so a client cannot ask for everything in one request. */
const DEFAULT_LIMIT = 12
const MAX_LIMIT = 50

/** "Trending" has to mean recent, or it becomes an all-time chart that never moves. */
const WINDOW_DAYS = 30

const readLimit = (raw: unknown): number => {
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_LIMIT
  return Math.min(Math.floor(value), MAX_LIMIT)
}

/**
 * The public fields of a shared book.
 *
 * The uploader is deliberately absent. Sharing a book is not the same as
 * publishing who owns it, and nothing on the Explore screen needs to know.
 */
const publicProjection = {
  _id: 1,
  title: 1,
  coverImageUrl: 1,
  pages: 1,
} as const

/**
 * What readers are actually reading, among books their uploaders chose to share.
 *
 * Ranked by *distinct readers* in the window rather than by sessions or
 * minutes: one person returning to the same book every day is one person
 * interested, not a trend, and counting sessions would let a single reader push
 * a title to the top.
 */
export const getTrending = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Unauthorized' })

    // Public ids first, off an index, so the aggregation below only ever walks
    // sessions that can possibly qualify.
    const publicBooks = await Book.find({ isPublic: true }).select('_id').lean()
    if (publicBooks.length === 0) return res.json([])

    const publicIds = publicBooks.map((book) => book._id)
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000)

    const ranked = await ReadingSession.aggregate([
      { $match: { book: { $in: publicIds }, startTime: { $gte: since } } },
      // Collapse to one row per reader per book before counting, which is what
      // makes this "how many people" rather than "how many sittings".
      { $group: { _id: { book: '$book', user: '$user' } } },
      { $group: { _id: '$_id.book', readers: { $sum: 1 } } },
      { $sort: { readers: -1 } },
      { $limit: readLimit(req.query.limit) },
      {
        $lookup: {
          from: 'books',
          localField: '_id',
          foreignField: '_id',
          as: 'book',
        },
      },
      { $unwind: '$book' },
      {
        $project: {
          _id: '$book._id',
          title: '$book.title',
          coverImageUrl: '$book.coverImageUrl',
          pages: '$book.pages',
          readers: 1,
        },
      },
    ])

    return res.json(await withLibraryFlag(ranked, req.user.id))
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/**
 * Shared books the reader does not have yet.
 *
 * Ranked the same way as Trending. There is no genre taxonomy to reason from,
 * and inferring one from titles would produce suggestions that look considered
 * without being so.
 */
export const getRecommended = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Unauthorized' })

    const owned = await Book.find({ uploadedBy: req.user.id })
      .select('_id sourceBookId')
      .lean()

    // Both the copies they took from someone else and their own uploads, so a
    // reader is never recommended a book already sitting in their library.
    const exclude = new Set<string>()
    for (const book of owned) {
      exclude.add(String(book._id))
      if (book.sourceBookId) exclude.add(String(book.sourceBookId))
    }

    const candidates = await Book.find({
      isPublic: true,
      _id: { $nin: Array.from(exclude).map((id) => new Types.ObjectId(id)) },
      uploadedBy: { $ne: req.user.id },
    })
      .select(publicProjection)
      .lean()

    if (candidates.length === 0) return res.json([])

    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000)
    const ranked = await ReadingSession.aggregate([
      {
        $match: {
          book: { $in: candidates.map((book) => book._id) },
          startTime: { $gte: since },
        },
      },
      { $group: { _id: { book: '$book', user: '$user' } } },
      { $group: { _id: '$_id.book', readers: { $sum: 1 } } },
    ])

    const readersByBook = new Map(ranked.map((row) => [String(row._id), row.readers as number]))

    const sorted = candidates
      .map((book) => ({ ...book, readers: readersByBook.get(String(book._id)) ?? 0 }))
      // Unread shared books still deserve to surface, so a zero score sorts
      // last rather than being filtered out -- otherwise nothing new is ever
      // recommended until someone else happens to read it first.
      .sort((a, b) => b.readers - a.readers)
      .slice(0, readLimit(req.query.limit))

    return res.json(sorted.map((book) => ({ ...book, inLibrary: false })))
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/**
 * Copies a shared book into the reader's own library.
 *
 * A copy, not a reference: reading progress, status and notes are per reader,
 * and the original stays owned by whoever uploaded it.
 */
export const addToLibrary = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Unauthorized' })

    const { bookId } = req.params
    if (!isValidObjectId(bookId)) {
      return res.status(400).json({ message: 'Invalid book id' })
    }

    // Scoped to public books, so this cannot be used to pull a private one.
    const source = await Book.findOne({ _id: bookId, isPublic: true }).lean()
    if (!source) return res.status(404).json({ message: 'Book not found' })

    if (String(source.uploadedBy) === req.user.id) {
      return res.status(400).json({ message: 'This book is already yours' })
    }

    // Adding twice is a double tap, not an error.
    const existing = await Book.findOne({
      uploadedBy: req.user.id,
      sourceBookId: source._id,
    })
    if (existing) {
      return res.status(200).json({ message: 'Already in your library', book: existing })
    }

    const book = await Book.create({
      title: source.title,
      coverImageUrl: source.coverImageUrl,
      fileUrl: source.fileUrl,
      pages: source.pages,
      uploadedBy: req.user.id,
      sourceBookId: source._id,
      // The copy starts unshared regardless of the original. Sharing is a
      // decision about your own library, not something inherited.
      isPublic: false,
    })

    return res.status(201).json({ message: 'Added to your library', book })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/**
 * The uploader turns sharing on or off for their own book.
 *
 * Scoped to books they uploaded, so nobody can share someone else's copy, and
 * turning it off withdraws it from Explore immediately -- copies already taken
 * are left alone, since those are other people's libraries now.
 */
export const setVisibility = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Unauthorized' })

    const { bookId } = req.params
    if (!isValidObjectId(bookId)) {
      return res.status(400).json({ message: 'Invalid book id' })
    }

    if (typeof req.body?.isPublic !== 'boolean') {
      return res.status(400).json({ message: 'isPublic must be true or false' })
    }

    const book = await Book.findOneAndUpdate(
      { _id: bookId, uploadedBy: req.user.id },
      { $set: { isPublic: req.body.isPublic } },
      { new: true },
    )

    if (!book) return res.status(404).json({ message: 'Book not found' })

    return res.json({ message: 'Sharing updated', book })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/** Marks which of these the reader already has, so the client can say so. */
async function withLibraryFlag(
  books: { _id: Types.ObjectId }[],
  userId: string,
): Promise<Record<string, unknown>[]> {
  if (books.length === 0) return []

  const ids = books.map((book) => book._id)
  const owned = await Book.find({
    uploadedBy: userId,
    $or: [{ _id: { $in: ids } }, { sourceBookId: { $in: ids } }],
  })
    .select('_id sourceBookId')
    .lean()

  const held = new Set<string>()
  for (const book of owned) {
    held.add(String(book._id))
    if (book.sourceBookId) held.add(String(book.sourceBookId))
  }

  return books.map((book) => ({ ...book, inLibrary: held.has(String(book._id)) }))
}
