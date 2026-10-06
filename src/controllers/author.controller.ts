import type { Request, Response } from 'express'

import AuthorFollow from '../models/authorFollow.js'
import AuthorProfile from '../models/authorProfile.js'
import Book from '../models/Books.js'
import BookReview from '../models/bookReview.js'
import ReadingSession from '../models/readingSession.js'
import User from '../models/User.js'
import { notifyMany } from '../services/notification.service.js'

/**
 * Author Space: profiles, listings, followers and reviews.
 *
 * Selling is deliberately absent. Listings carry a price so the data is ready,
 * but nothing here takes money -- payments are their own piece of work with
 * their own review, and a half-built checkout is worse than none.
 *
 * The statistics an author sees are aggregates over their own books. No
 * endpoint here returns who read what: the PRD is explicit that an author
 * should not learn a reader's private behaviour merely because that reader
 * opened their book.
 */

const errMessage = (error: unknown) => (error instanceof Error ? error.message : 'Unknown error')

const param = (value: unknown): string => (Array.isArray(value) ? value[0] : String(value ?? ''))

/* -------------------------------------------------------------- profiles */

/** The caller's own author profile, created on first visit to the space. */
export const getMyAuthorProfile = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const profile = await AuthorProfile.findOne({ user: req.user.id }).lean()
    return res.json(profile ?? null)
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

export const upsertAuthorProfile = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const { penName, bio, photoUrl, genres, location, website, links } = req.body
    if (!penName || String(penName).trim().length === 0) {
      return res.status(400).json({ message: 'A pen name is required' })
    }

    const existing = await AuthorProfile.findOne({ user: req.user.id })

    // Editing a verified profile does not silently revoke verification -- the
    // claim that was checked was authorship, and a changed bio does not undo
    // it. A changed pen name does, because that is the name that was verified.
    const renamed = existing && existing.penName !== String(penName).trim()
    const status =
      existing?.status === 'verified' && renamed ? 'pending' : existing?.status ?? 'unverified'

    const profile = await AuthorProfile.findOneAndUpdate(
      { user: req.user.id },
      {
        $set: {
          penName: String(penName).trim(),
          bio,
          photoUrl,
          genres: Array.isArray(genres) ? genres : [],
          location,
          website,
          links: Array.isArray(links) ? links : [],
          status,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    )

    return res.json(profile)
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/** Ask a human to check that this person wrote these books. */
export const requestVerification = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const profile = await AuthorProfile.findOne({ user: req.user.id })
    if (!profile) return res.status(404).json({ message: 'Create your author profile first' })
    if (profile.status === 'verified') return res.json(profile)

    profile.status = 'pending'
    profile.reviewNote = undefined
    await profile.save()

    return res.json(profile)
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/** A public author page. Only verified authors have one. */
export const getAuthor = async (req: Request, res: Response) => {
  try {
    const authorId = param(req.params.authorId)

    const profile = await AuthorProfile.findOne({ _id: authorId, status: 'verified' }).lean()
    if (!profile) return res.status(404).json({ message: 'Author not found' })

    const books = await Book.find({ authorProfile: profile._id, isPublic: true })
      .sort({ listedAt: -1 })
      .select('title coverImageUrl synopsis genre pages priceMinor currency ratingSum ratingCount')
      .lean()

    const following = req.user?.id
      ? Boolean(await AuthorFollow.findOne({ author: profile._id, user: req.user.id }).lean())
      : false

    return res.json({
      ...profile,
      following,
      books: books.map((book) => ({
        ...book,
        rating: book.ratingCount ? book.ratingSum / book.ratingCount : null,
      })),
    })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

export const listAuthors = async (req: Request, res: Response) => {
  try {
    const { q } = req.query
    const filter: Record<string, unknown> = { status: 'verified' }
    if (q && String(q).trim()) filter.$text = { $search: String(q).trim() }

    const authors = await AuthorProfile.find(filter)
      .sort({ followerCount: -1 })
      .limit(30)
      .select('penName bio photoUrl genres followerCount bookCount')
      .lean()

    return res.json(authors)
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/* ------------------------------------------------------------- following */

export const followAuthor = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const authorId = param(req.params.authorId)
    const author = await AuthorProfile.findById(authorId).lean()
    if (!author) return res.status(404).json({ message: 'Author not found' })

    const existing = await AuthorFollow.findOne({ author: authorId, user: req.user.id })
    if (existing) {
      await AuthorFollow.deleteOne({ _id: existing._id })
      await AuthorProfile.updateOne({ _id: authorId }, { $inc: { followerCount: -1 } })
      return res.json({ following: false })
    }

    await AuthorFollow.create({ author: authorId, user: req.user.id })
    await AuthorProfile.updateOne({ _id: authorId }, { $inc: { followerCount: 1 } })
    return res.json({ following: true })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/* -------------------------------------------------------------- listings */

/**
 * Put one of the author's own books in front of readers.
 *
 * The book must already exist and belong to them -- a listing describes a book
 * rather than creating one, so the upload path stays the single way a file
 * enters ReadHub.
 */
export const listBook = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const profile = await AuthorProfile.findOne({ user: req.user.id })
    if (!profile) return res.status(404).json({ message: 'Create your author profile first' })
    if (profile.status !== 'verified') {
      return res.status(403).json({ message: 'Your author profile is not verified yet' })
    }

    const { bookId, synopsis, genre, language, readingLevel, priceMinor, currency } = req.body

    const book = await Book.findOne({ _id: bookId, uploadedBy: req.user.id })
    if (!book) return res.status(404).json({ message: 'Book not found' })

    book.authorProfile = profile._id
    book.synopsis = synopsis
    book.genre = genre
    book.language = language
    book.readingLevel = readingLevel
    if (typeof priceMinor === 'number') book.priceMinor = Math.max(0, Math.round(priceMinor))
    if (currency) book.currency = currency
    book.isPublic = true
    book.listedAt = new Date()
    await book.save()

    await AuthorProfile.updateOne(
      { _id: profile._id },
      { $set: { bookCount: await Book.countDocuments({ authorProfile: profile._id }) } },
    )

    // The people who asked to hear from this author, and only them.
    const followers = await AuthorFollow.find({ author: profile._id }).select('user').lean()
    await notifyMany(
      followers.map((f) => f.user),
      {
        type: 'AUTHOR_UPDATE',
        category: 'books',
        title: `${profile.penName} published a book`,
        message: book.title,
        actionRoute: 'author',
        actionId: String(profile._id),
        dedupeKey: `listing:${book._id}`,
      },
    )

    return res.json(book)
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

export const unlistBook = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const bookId = param(req.params.bookId)
    const book = await Book.findOneAndUpdate(
      { _id: bookId, uploadedBy: req.user.id },
      { $set: { isPublic: false }, $unset: { listedAt: 1 } },
      { new: true },
    )
    if (!book) return res.status(404).json({ message: 'Book not found' })

    return res.json({ message: 'No longer listed' })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/* --------------------------------------------------------------- reviews */

export const listReviews = async (req: Request, res: Response) => {
  try {
    const bookId = param(req.params.bookId)

    const reviews = await BookReview.find({ book: bookId, deletedAt: { $exists: false } })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean()

    const book = await Book.findById(bookId).select('ratingSum ratingCount').lean()

    return res.json({
      reviews,
      average: book?.ratingCount ? book.ratingSum / book.ratingCount : null,
      count: book?.ratingCount ?? 0,
    })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/**
 * Leave or change a review.
 *
 * The book's running total is adjusted by the difference rather than recounted,
 * so a book with thousands of reviews does not re-read them to show a star
 * rating.
 */
export const upsertReview = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const bookId = param(req.params.bookId)
    const rating = Number(req.body?.rating)
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'A rating is a whole number from 1 to 5' })
    }

    const book = await Book.findById(bookId)
    if (!book) return res.status(404).json({ message: 'Book not found' })

    const user = await User.findById(req.user.id).select('username').lean()
    const existing = await BookReview.findOne({ book: bookId, user: req.user.id })

    if (existing) {
      const delta = rating - existing.rating
      existing.rating = rating
      existing.body = req.body?.body
      await existing.save()
      if (delta !== 0) await Book.updateOne({ _id: bookId }, { $inc: { ratingSum: delta } })
      return res.json(existing)
    }

    const review = await BookReview.create({
      book: bookId,
      user: req.user.id,
      reviewerName: user?.username ?? 'A reader',
      rating,
      body: req.body?.body,
    })
    await Book.updateOne({ _id: bookId }, { $inc: { ratingSum: rating, ratingCount: 1 } })

    return res.status(201).json(review)
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/* ------------------------------------------------------------- dashboard */

/**
 * What an author is allowed to know.
 *
 * Totals across their own books: how many people opened them, how far they got
 * on average, how long they spent. Aggregated in the database, and never joined
 * back to a person -- which is the line the PRD draws.
 */
export const getAuthorDashboard = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const profile = await AuthorProfile.findOne({ user: req.user.id }).lean()
    if (!profile) return res.status(404).json({ message: 'Create your author profile first' })

    const books = await Book.find({ authorProfile: profile._id })
      .select('title pages ratingSum ratingCount listedAt')
      .lean()

    const bookIds = books.map((book) => book._id)

    const [sessions] = await ReadingSession.aggregate<{
      readers: number
      sessions: number
      pages: number
    }>([
      { $match: { book: { $in: bookIds } } },
      {
        $group: {
          _id: null,
          readers: { $addToSet: '$user' },
          sessions: { $sum: 1 },
          pages: { $sum: '$pagesRead' },
        },
      },
      {
        $project: {
          readers: { $size: '$readers' },
          sessions: 1,
          pages: 1,
        },
      },
    ])

    return res.json({
      profile,
      totals: {
        books: books.length,
        followers: profile.followerCount,
        readers: sessions?.readers ?? 0,
        sessions: sessions?.sessions ?? 0,
        pagesRead: sessions?.pages ?? 0,
      },
      books: books.map((book) => ({
        _id: book._id,
        title: book.title,
        pages: book.pages,
        rating: book.ratingCount ? book.ratingSum / book.ratingCount : null,
        ratingCount: book.ratingCount,
        listedAt: book.listedAt,
      })),
    })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/* ------------------------------------------------------------ admin side */

/** The verification queue, for the existing admin panel. */
export const listPendingAuthors = async (_req: Request, res: Response) => {
  try {
    const pending = await AuthorProfile.find({ status: 'pending' })
      .sort({ updatedAt: 1 })
      .populate('user', 'username email')
      .lean()
    return res.json(pending)
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

export const decideAuthorVerification = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const authorId = param(req.params.authorId)
    const approve = req.body?.approve === true

    const profile = await AuthorProfile.findById(authorId)
    if (!profile) return res.status(404).json({ message: 'Author not found' })

    profile.status = approve ? 'verified' : 'rejected'
    profile.reviewNote = req.body?.note
    profile.reviewedBy = req.user.id as never
    profile.reviewedAt = new Date()
    await profile.save()

    await notifyMany([profile.user], {
      type: 'SYSTEM_ALERT',
      category: 'system',
      priority: 'high',
      title: approve ? 'Your author profile is verified' : 'Your author profile needs changes',
      message: approve
        ? 'You can now list books on ReadHub.'
        : profile.reviewNote ?? 'Please review the details on your profile and submit again.',
      actionRoute: 'author-space',
    })

    return res.json(profile)
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}
