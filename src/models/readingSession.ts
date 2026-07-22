import mongoose, { Schema, Document, Model, Types } from 'mongoose'

export interface IReadingSession extends Document {
  user: Types.ObjectId
  book: Types.ObjectId
  startTime: Date
  endTime?: Date
  duration?: number // minutes
  pagesRead: number
  startPage?: number
  endPage?: number
  createdAt: Date
  updatedAt: Date
}

const readingSessionSchema = new Schema<IReadingSession>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    book: {
      type: Schema.Types.ObjectId,
      ref: 'Book',
      required: true,
    },

    startTime: {
      type: Date,
      required: true,
    },

    endTime: {
      type: Date,
    },

    duration: {
      type: Number, // minutes
    },

    pagesRead: {
      type: Number,
      default: 0,
    },

    startPage: Number,

    endPage: Number,
  },
  { timestamps: true },
)

const ReadingSession: Model<IReadingSession> =
  mongoose.model<IReadingSession>('ReadingSession', readingSessionSchema)

export default ReadingSession
