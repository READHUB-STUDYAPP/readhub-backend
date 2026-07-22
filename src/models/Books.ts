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
