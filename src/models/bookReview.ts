import mongoose, { Schema, Document, Model, Types } from 'mongoose'

/**
 * A reader's rating of a book, with optional words.
 *
 * One per reader per book, enforced by the database, so a book's score is a
 * count of people rather than a count of opinions typed.
 *
 * The reviewer's name is snapshotted for the same reason group messages carry
 * one: a review outlives the account that wrote it, and a wall of "Former
 * member" is better than a review list that silently shrinks.
 */

export interface IBookReview extends Document {
  book: Types.ObjectId
  user: Types.ObjectId
  reviewerName: string
  rating: number
  body?: string
  deletedAt?: Date
  createdAt: Date
  updatedAt: Date
}

export const MAX_REVIEW_LENGTH = 2000

const bookReviewSchema = new Schema<IBookReview>(
  {
    book: { type: Schema.Types.ObjectId, ref: 'Book', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewerName: { type: String, required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    body: { type: String, maxlength: MAX_REVIEW_LENGTH },
    deletedAt: { type: Date },
  },
  { timestamps: true },
)

/** One review per reader per book. */
bookReviewSchema.index({ book: 1, user: 1 }, { unique: true })

/** The review list under a book, newest first. */
bookReviewSchema.index({ book: 1, createdAt: -1 })

const BookReview: Model<IBookReview> = mongoose.model<IBookReview>('BookReview', bookReviewSchema)

export default BookReview
