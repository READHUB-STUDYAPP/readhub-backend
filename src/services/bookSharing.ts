import { Types } from 'mongoose'

import Book, { type IBook } from '../models/Books.js'

/**
 * The same book, in two libraries.
 *
 * A book here belongs to one reader: `uploadedBy` owns it, progress and status
 * hang off that row, and a second reader wanting the same title gets a copy of
 * their own with `sourceBookId` pointing back at the original. That is the
 * right model -- two people reading the same book are not at the same page --
 * but it means "the same book" is a family of rows rather than one id, and
 * anything that matches on a bare id silently fails across readers.
 *
 * Which is what happened to shared reads. A pair agreed on a book, the id
 * stored was the chooser's own row, and the partner held an id they could not
 * fetch: their library did not contain it, the reader would not open it, and
 * their automatic progress never matched because it was keyed on exactly that
 * id. The pair saw a title and two bars, one of which could never move.
 *
 * So two questions get answered in one place:
 *
 *   Which rows count as this book?   `bookFamilyIds`, for matching progress.
 *   May this reader have a copy?     `shareableRootOf`, for handing one over.
 *
 * The second question has a rule that is not ours to relax. A private upload is
 * somebody's own document, and the library is explicit that sharing is never a
 * default and never implicit. Agreeing to read a book together is not the
 * owner publishing it, so only a book whose root is public is ever copied.
 */

/** The row a family is named after: the original, not a copy of it. */
export async function rootOf(
  bookId: Types.ObjectId | string,
): Promise<(IBook & { _id: Types.ObjectId }) | null> {
  const book = await Book.findById(bookId).lean<IBook & { _id: Types.ObjectId }>()
  if (!book) return null
  if (!book.sourceBookId) return book

  const root = await Book.findById(book.sourceBookId).lean<IBook & { _id: Types.ObjectId }>()
  // A copy whose original was deleted is still the best name we have for the
  // family, so it stands in for its own root rather than resolving to nothing.
  return root ?? book
}

/**
 * Every row that is this book, in anybody's library.
 *
 * Used for matching rather than for display: when a reader turns a page, this
 * is what decides whether some shared read is about the book they are holding.
 * Always includes the id it was asked about, so a caller never ends up with an
 * empty set and silently matches nothing.
 */
export async function bookFamilyIds(
  bookId: Types.ObjectId | string,
): Promise<Types.ObjectId[]> {
  const ids = new Map<string, Types.ObjectId>()
  const remember = (id: Types.ObjectId) => ids.set(String(id), id)

  if (Types.ObjectId.isValid(String(bookId))) remember(new Types.ObjectId(String(bookId)))

  const root = await rootOf(bookId)
  if (!root) return [...ids.values()]

  remember(root._id)

  // Everyone else's copies of the same original.
  const copies = await Book.find({ sourceBookId: root._id }).select('_id').lean()
  for (const copy of copies) remember(copy._id as Types.ObjectId)

  return [...ids.values()]
}

/**
 * The reader's own row for this book, if they have one.
 *
 * This is what a "read it" button needs: the id the reader can actually open,
 * which is almost never the id the shared read was created with.
 */
export async function myCopyOf(
  userId: Types.ObjectId | string,
  bookId: Types.ObjectId | string,
): Promise<(IBook & { _id: Types.ObjectId }) | null> {
  const family = await bookFamilyIds(bookId)
  if (family.length === 0) return null

  return Book.findOne({
    uploadedBy: userId,
    $or: [{ _id: { $in: family } }, { sourceBookId: { $in: family } }],
  }).lean<IBook & { _id: Types.ObjectId }>()
}

/**
 * The public original behind a book, if there is one.
 *
 * Returns null for a private upload, and for a copy of one. Null is the answer
 * that means "not ours to hand out", and every caller treats it that way.
 */
export async function shareableRootOf(
  bookId: Types.ObjectId | string,
): Promise<(IBook & { _id: Types.ObjectId }) | null> {
  const root = await rootOf(bookId)
  if (!root) return null
  return root.isPublic ? root : null
}

export type CopyOutcome =
  | { ok: true; book: IBook & { _id: Types.ObjectId }; created: boolean }
  | { ok: false; reason: 'not-found' | 'private' }

/**
 * Puts a copy of a shared book into a reader's library.
 *
 * A copy, not a reference, exactly as adding from Explore does: progress,
 * status and notes are per reader, and the original stays owned by whoever
 * uploaded it. Returning the existing row rather than refusing makes this safe
 * to call again -- two people can start the same read from two devices, and a
 * partner who already added the book themselves must not see an error.
 */
export async function copyForReader(
  userId: Types.ObjectId | string,
  bookId: Types.ObjectId | string,
): Promise<CopyOutcome> {
  const existing = await myCopyOf(userId, bookId)
  if (existing) return { ok: true, book: existing, created: false }

  const source = await shareableRootOf(bookId)
  if (!source) {
    const anything = await Book.exists({ _id: bookId })
    return { ok: false, reason: anything ? 'private' : 'not-found' }
  }

  if (String(source.uploadedBy) === String(userId)) {
    return { ok: true, book: source, created: false }
  }

  try {
    const copy = await Book.create({
      title: source.title,
      coverImageUrl: source.coverImageUrl,
      fileUrl: source.fileUrl,
      pages: source.pages,
      uploadedBy: userId,
      sourceBookId: source._id,
      // The copy starts unshared whatever the original says. Sharing is a
      // decision about your own library, not something inherited.
      isPublic: false,
    })

    return {
      ok: true,
      book: copy.toObject() as IBook & { _id: Types.ObjectId },
      created: true,
    }
  } catch (error) {
    // Losing a race to another device is not a failure: whoever won made the
    // row this reader wanted, so look again rather than reporting an error.
    const won = await myCopyOf(userId, bookId)
    if (won) return { ok: true, book: won, created: false }
    throw error
  }
}
