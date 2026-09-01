import mongoose, { Schema, Document, Model, Types } from 'mongoose'

/**
 * Where each member has reached in a group's book.
 *
 * Its own collection rather than an array on the group. A reading position
 * changes every few minutes for every member at once, and embedding it would
 * mean each page turn rewriting -- and re-indexing -- the whole group document
 * that everyone else is reading at the same time.
 *
 * A book in a group belongs to whoever added it, so their own `Book.lastPageRead`
 * cannot serve: five other members reading the same book each need a position
 * of their own.
 */
export interface IGroupProgress extends Document {
  group: Types.ObjectId
  book: Types.ObjectId
  user: Types.ObjectId
  lastPageRead: number
  /** Minutes read in this group's copy, for the group's totals. */
  minutes: number
  updatedAt: Date
  createdAt: Date
}

const groupProgressSchema = new Schema<IGroupProgress>(
  {
    group: { type: Schema.Types.ObjectId, ref: 'ReadingGroup', required: true },
    book: { type: Schema.Types.ObjectId, ref: 'Book', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    lastPageRead: { type: Number, default: 0, min: 0 },
    minutes: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
)

// One row per member per book, and the key the upsert writes against. Unique so
// a racing write cannot produce two positions for the same reader.
groupProgressSchema.index({ group: 1, book: 1, user: 1 }, { unique: true })

// The group screen reads every position in the group at once; this serves it
// from the index rather than a scan.
groupProgressSchema.index({ group: 1, updatedAt: -1 })

const GroupProgress: Model<IGroupProgress> = mongoose.model<IGroupProgress>(
  'GroupProgress',
  groupProgressSchema,
)

export default GroupProgress
