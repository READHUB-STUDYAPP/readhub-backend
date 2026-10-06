import mongoose, { Schema, Document, Model, Types } from 'mongoose'

/**
 * An accepted pair, and the space the two of them share.
 *
 * A pair is unordered -- there is no owner and no guest -- so the two ids are
 * also written, sorted and joined, into `pair`. That string is what carries the
 * unique index and stops A-and-B and B-and-A becoming two different spaces.
 *
 * The index is deliberately NOT on `users`. A unique index on an array field is
 * multikey: it would require every id to be unique across the whole collection,
 * so the first pair a reader joined would be the only one they could ever have.
 * That happens to resemble the free-tier limit, which is exactly what makes the
 * mistake easy to miss -- the limit belongs in the controller, where it can be
 * raised, not in an index that cannot be.
 *
 * Ending is a status change, not a delete. The shared reading and the
 * conversation are the record of something the two of them did; removing the
 * row would take a finished book off both their histories.
 */

export type BuddyStatus = 'active' | 'ended'

export interface IBuddy extends Document {
  /** Exactly two, stored in ascending id order. */
  users: Types.ObjectId[]
  /** The sorted ids joined by a colon. Carries the uniqueness of the pair. */
  pair: string
  status: BuddyStatus
  startedAt: Date
  endedAt?: Date
  /** Who ended it, so the other side can be told plainly. */
  endedBy?: Types.ObjectId
  /** The read in progress, if any. Denormalised for the list screen. */
  currentRead?: Types.ObjectId
  lastMessageAt?: Date
  /** Shared reads finished together. The pair's own small history. */
  completedReads: number
  createdAt: Date
  updatedAt: Date
}

/** The canonical spelling of a pair: sorted ids, so it reads the same either way round. */
export function pairKeyOf(a: Types.ObjectId | string, b: Types.ObjectId | string): string {
  return [String(a), String(b)].sort().join(':')
}

/** The two ids in the order the pair key puts them. */
export function pairUsers(a: Types.ObjectId | string, b: Types.ObjectId | string): string[] {
  return [String(a), String(b)].sort()
}

const buddySchema = new Schema<IBuddy>(
  {
    users: {
      type: [{ type: Schema.Types.ObjectId, ref: 'User', required: true }],
      validate: {
        validator: (value: Types.ObjectId[]) => value.length === 2,
        message: 'A buddy pair is exactly two people',
      },
    },
    pair: { type: String, required: true },
    status: { type: String, enum: ['active', 'ended'], default: 'active' },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date },
    endedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    currentRead: { type: Schema.Types.ObjectId, ref: 'BuddyRead' },
    lastMessageAt: { type: Date },
    completedReads: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
)

// One live pair, one row. Ended pairs are excluded so two people who drifted
// apart can become buddies again later.
buddySchema.index(
  { pair: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } },
)

// "My buddies", most recently talked-to first. Multikey on users, which is fine
// and wanted here -- it is only uniqueness that an array index gets wrong.
buddySchema.index({ users: 1, status: 1, lastMessageAt: -1 })

const Buddy: Model<IBuddy> = mongoose.model<IBuddy>('Buddy', buddySchema)

export default Buddy
