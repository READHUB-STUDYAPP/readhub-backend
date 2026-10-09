import mongoose, { Schema, Document, Model, Types } from 'mongoose'

/**
 * Something a reader has done, kept because they did it.
 *
 * The counterpart to the live statistics, not a replacement for them. Streaks,
 * minutes and books read stay derived from the data that already records them,
 * so they are never stale and never need backfilling. What cannot be derived
 * is the *having done it*: a reader who kept a thirty-day streak in January
 * and misses a day in March still kept a thirty-day streak in January, and a
 * profile that recomputes its badges would quietly take that away from them.
 * Removing something a person earned is the one thing a reward system must
 * never do.
 *
 * So the rule is: derived values answer "how are you doing", rows here answer
 * "what have you done". They never contradict because they are not claims
 * about the same thing.
 *
 * Rows are append-only. Nothing in the application deletes one.
 */

export interface IAchievement extends Document {
  user: Types.ObjectId
  /** A key from the catalogue in services/achievements.ts. */
  key: string
  earnedAt: Date
  /**
   * The number that earned it, frozen at the moment it was earned -- the
   * streak that reached 30, the count that reached 10. Kept so the profile can
   * say what happened without recomputing a figure that has since moved on.
   */
  value?: number
  /** Set when an administrator gave it rather than a threshold being crossed. */
  awardedBy?: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const achievementSchema = new Schema<IAchievement>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    key: { type: String, required: true, trim: true, maxlength: 60 },
    earnedAt: { type: Date, default: Date.now },
    value: { type: Number },
    awardedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
)

// Earned once, however many times the threshold is crossed again. This index
// is what actually makes that true: two sessions ending at the same moment
// both see the same streak and both try to award it, and only the database
// sees both at once. The duplicate is the signal that it was already earned.
achievementSchema.index({ user: 1, key: 1 }, { unique: true })

// A profile reads one reader's badges, newest first.
achievementSchema.index({ user: 1, earnedAt: -1 })

const Achievement: Model<IAchievement> = mongoose.model<IAchievement>(
  'Achievement',
  achievementSchema,
)

export default Achievement
