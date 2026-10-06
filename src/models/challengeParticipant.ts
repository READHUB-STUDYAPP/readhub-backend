import mongoose, { Schema, Document, Model, Types } from 'mongoose'

/**
 * One person's run at one challenge.
 *
 * `daysActive` is a list of date stamps rather than a counter, because the
 * question a daily challenge actually asks is "did they read on each of these
 * days", and a counter cannot answer it idempotently -- two reading sessions on
 * the same evening must count once. Thirty entries for a thirty-day challenge
 * is a small array with a natural ceiling.
 */

export interface IChallengeParticipant extends Document {
  challenge: Types.ObjectId
  community: Types.ObjectId
  user: Types.ObjectId
  /** `YYYY-MM-DD` in the reader's zone, one per day they read. */
  daysActive: string[]
  minutesRead: number
  pagesRead: number
  booksCompleted: number
  completedAt?: Date
  joinedAt: Date
  createdAt: Date
  updatedAt: Date
}

const participantSchema = new Schema<IChallengeParticipant>(
  {
    challenge: { type: Schema.Types.ObjectId, ref: 'Challenge', required: true },
    community: { type: Schema.Types.ObjectId, ref: 'Community', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    daysActive: { type: [String], default: [] },
    minutesRead: { type: Number, default: 0, min: 0 },
    pagesRead: { type: Number, default: 0, min: 0 },
    booksCompleted: { type: Number, default: 0, min: 0 },
    completedAt: { type: Date },
    joinedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
)

/** Join once. */
participantSchema.index({ challenge: 1, user: 1 }, { unique: true })

/** The challenge's board, and the count behind it. */
participantSchema.index({ challenge: 1, minutesRead: -1 })

/** "Which challenges am I in", across a community. */
participantSchema.index({ user: 1, community: 1 })

const ChallengeParticipant: Model<IChallengeParticipant> = mongoose.model<IChallengeParticipant>(
  'ChallengeParticipant',
  participantSchema,
)

export default ChallengeParticipant
