import mongoose, { Schema, Document, Model, Types } from 'mongoose'

/**
 * A community's reading challenge.
 *
 * "Read for 20 minutes every day for 30 days." The challenge holds the rule and
 * the window; what each person has actually done lives in
 * `challengeParticipant`, so a challenge with a thousand entrants is still one
 * small document.
 *
 * The PRD is explicit that this should not become a race. The metrics are
 * consistency-shaped -- days active, minutes, pages -- and the board that
 * displays them is ordered but deliberately not called a ranking.
 */

export type ChallengeGoal =
  | 'read-daily'
  | 'finish-book'
  | 'read-pages'
  | 'read-minutes'
  | 'read-books'
  | 'complete-schedule'

export interface IChallenge extends Document {
  community: Types.ObjectId
  title: string
  description?: string
  goal: ChallengeGoal
  /**
   * What the goal is measured against: minutes per day, total pages, number of
   * books. Its meaning follows `goal` rather than being a separate unit field.
   */
  target: number
  startsAt: Date
  endsAt: Date
  createdBy: Types.ObjectId
  participantCount: number
  createdAt: Date
  updatedAt: Date
}

const challengeSchema = new Schema<IChallenge>(
  {
    community: { type: Schema.Types.ObjectId, ref: 'Community', required: true },
    title: { type: String, required: true, trim: true, maxlength: 140 },
    description: { type: String, trim: true, maxlength: 1000 },
    goal: {
      type: String,
      required: true,
      enum: [
        'read-daily',
        'finish-book',
        'read-pages',
        'read-minutes',
        'read-books',
        'complete-schedule',
      ],
      default: 'read-daily',
    },
    target: { type: Number, required: true, min: 1 },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    participantCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
)

/**
 * The challenges tab, which shows the running one first.
 *
 * Sorting by `endsAt` within a community answers both "what is active" and
 * "what has finished" from the same index.
 */
challengeSchema.index({ community: 1, endsAt: -1 })

const Challenge: Model<IChallenge> = mongoose.model<IChallenge>('Challenge', challengeSchema)

export default Challenge
