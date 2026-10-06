import mongoose, { Schema, Document, Model, Types } from 'mongoose'

/**
 * One book two buddies agreed to read, and how far each of them has got.
 *
 * Progress is per person, held in a two-entry array rather than a shared
 * number. The PRD is specific that the pair should see a shared picture
 * "without forcing identical pace", and a single shared counter cannot express
 * that -- it would either average two people or let the faster one appear to
 * drag the slower one along.
 *
 * The array is bounded at two, so embedding is safe: this document cannot grow
 * with use the way a message list would.
 */

export type BuddyReadStatus = 'active' | 'completed' | 'abandoned'

export interface IBuddyReadProgress {
  user: Types.ObjectId
  page: number
  /** Set the first time they reach the target. */
  completedAt?: Date
  updatedAt: Date
}

export interface IBuddyRead extends Document {
  buddy: Types.ObjectId
  book: Types.ObjectId
  /** Snapshot, so an unlinked or renamed book does not blank the history. */
  bookTitle: string
  /** Pages to reach. Null when the pair set only a date. */
  targetPage?: number
  /** When they mean to be done. Drives the reminders. */
  targetDate?: Date
  progress: IBuddyReadProgress[]
  status: BuddyReadStatus
  startedAt: Date
  completedAt?: Date
  createdBy: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const progressSchema = new Schema<IBuddyReadProgress>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    page: { type: Number, default: 0, min: 0 },
    completedAt: { type: Date },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false },
)

const buddyReadSchema = new Schema<IBuddyRead>(
  {
    buddy: { type: Schema.Types.ObjectId, ref: 'Buddy', required: true },
    book: { type: Schema.Types.ObjectId, ref: 'Book', required: true },
    bookTitle: { type: String, required: true, trim: true, maxlength: 300 },
    targetPage: { type: Number, min: 1 },
    targetDate: { type: Date },
    progress: { type: [progressSchema], default: [] },
    status: { type: String, enum: ['active', 'completed', 'abandoned'], default: 'active' },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
)

// A pair's reading history, newest first, and the one that is live.
buddyReadSchema.index({ buddy: 1, status: 1, startedAt: -1 })

// The nudge sweep asks for live reads with a target date that has passed.
buddyReadSchema.index(
  { targetDate: 1 },
  { partialFilterExpression: { status: 'active' } },
)

const BuddyRead: Model<IBuddyRead> = mongoose.model<IBuddyRead>('BuddyRead', buddyReadSchema)

export default BuddyRead
