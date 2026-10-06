import mongoose, { Schema, Document, Model, Types } from 'mongoose'

/**
 * One reader refusing to hear from another.
 *
 * Deliberately not buddy-specific. A block is a statement about a person, not
 * about one feature, so it lives at the account level and anything social can
 * consult it. Reading Buddy is the first caller; it should not be the last.
 *
 * The block is one-directional in storage and two-directional in effect: the
 * blocker stops seeing the blocked, and the blocked stops being able to reach
 * the blocker. Discovery and requests both consult it in both directions, which
 * is why the reverse index exists.
 */

export interface IUserBlock extends Document {
  blocker: Types.ObjectId
  blocked: Types.ObjectId
  /** Kept for the moderation queue, never shown to the blocked user. */
  reason?: string
  createdAt: Date
  updatedAt: Date
}

const userBlockSchema = new Schema<IUserBlock>(
  {
    blocker: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    blocked: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, trim: true, maxlength: 300 },
  },
  { timestamps: true },
)

// Blocking twice is the same block.
userBlockSchema.index({ blocker: 1, blocked: 1 }, { unique: true })

// "Who has blocked me?" -- asked on every discovery page, so it needs its own.
userBlockSchema.index({ blocked: 1 })

const UserBlock: Model<IUserBlock> = mongoose.model<IUserBlock>('UserBlock', userBlockSchema)

export default UserBlock
