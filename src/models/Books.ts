import mongoose, { Schema, Document, Model, Types } from 'mongoose'

export type BookStatus = 'reading' | 'completed' | 'plan to read'

export interface IBook extends Document {
  title: string
  coverImageUrl: string
  fileUrl: string
  pages: number
  uploadedBy: Types.ObjectId
  lastPageRead: number
  status: BookStatus
  /** Opt-in: shared with every reader, and eligible for Trending. */
  isPublic: boolean
  /**
   * Set when this book is listed by a verified author rather than uploaded by
   * a reader for themselves. The listing fields below only mean anything when
   * it is present.
   */
  authorProfile?: Types.ObjectId
  /** Shown on the listing; the author's own description of the book. */
  synopsis?: string
  genre?: string
  language?: string
  readingLevel?: string
  /**
   * Price in minor units (kobo), with the currency beside it.
   *
   * Stored now and charged later: payments are a separate piece of work, so a
   * listing may carry a price while every book remains free to add. Integer
   * minor units rather than a float, because money in a float is a rounding
   * bug waiting for a busy day.
   */
  priceMinor?: number
  currency?: string
  listedAt?: Date
  /** Running aggregate of bookReview, so a listing need not count them. */
  ratingSum: number
  ratingCount: number
  /** Set when this copy came from another reader's public book. */
  sourceBookId?: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const bookSchema = new Schema<IBook>(
  {
    title: {
      type: String,
      required: true,
      index: true,
    },

    coverImageUrl: {
      type: String,
      required: true,
    },
    fileUrl: {
      type: String,
      required: true,
    },
    pages: {
      type: Number,
      required: true,
    },

    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    lastPageRead: {
      type: Number,
      default: 0,
    },
    // Off unless the uploader turns it on. A book is someone's document until
    // they say otherwise, so sharing is never a default and never implicit.
    authorProfile: { type: Schema.Types.ObjectId, ref: 'AuthorProfile', index: true },
    synopsis: { type: String, maxlength: 4000 },
    genre: { type: String, trim: true },
    language: { type: String, trim: true },
    readingLevel: { type: String, trim: true },
    priceMinor: { type: Number, min: 0 },
    currency: { type: String, default: 'NGN' },
    listedAt: { type: Date },
    ratingSum: { type: Number, default: 0, min: 0 },
    ratingCount: { type: Number, default: 0, min: 0 },
    isPublic: {
      type: Boolean,
      default: false,
      index: true,
    },
    // Which public book this was taken from, so a reader is not offered a title
    // they already have, and so the original can be credited.
    sourceBookId: {
      type: Schema.Types.ObjectId,
      ref: 'Book',
      index: true,
    },
    status: {
      type: String,
      enum: ['reading', 'completed', 'plan to read'],
      default: 'plan to read',
    },
  },
  { timestamps: true },
)

const Book: Model<IBook> = mongoose.model<IBook>('Book', bookSchema)

export default Book
