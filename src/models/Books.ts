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
