import mongoose, { Schema, Document, Model, Types } from 'mongoose'

/**
 * "Olawale O. completed Atomic Habits. 10 minutes ago."
 *
 * The Activities tab. Written when something worth telling the community
 * happens, read as a reverse-chronological list, and never updated -- which is
 * what lets it be a plain append-only collection with one index.
 *
 * The actor's name is snapshotted alongside the reference, for the same reason
 * group messages carry one: the feed should still read correctly after someone
 * leaves, rather than quietly losing rows or showing blanks.
 *
 * Rows expire. A feed of what is happening has no use for last year, and a TTL
 * keeps the collection bounded without a sweep job of its own.
 */

export type ActivityType =
  | 'BOOK_COMPLETED'
  | 'GROUP_JOINED'
  | 'GROUP_CREATED'
  | 'CHALLENGE_JOINED'
  | 'CHALLENGE_COMPLETED'
  | 'STREAK_MILESTONE'
  | 'MEMBER_JOINED'
  | 'ANNOUNCEMENT_POSTED'

export interface ICommunityActivity extends Document {
  community: Types.ObjectId
  actor?: Types.ObjectId
  actorName: string
  type: ActivityType
  /** What it happened to: a book title, a group name, a challenge title. */
  subject?: string
  /** Where tapping the row should go. */
  targetRoute?: string
  targetId?: string
  createdAt: Date
  expiresAt: Date
}

/** How long the feed remembers. */
export const ACTIVITY_TTL_DAYS = 90

const activitySchema = new Schema<ICommunityActivity>(
  {
    community: { type: Schema.Types.ObjectId, ref: 'Community', required: true },
    actor: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    actorName: { type: String, required: true },
    type: { type: String, required: true },
    subject: { type: String, maxlength: 200 },
    targetRoute: { type: String },
    targetId: { type: String },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

/** The feed itself. */
activitySchema.index({ community: 1, createdAt: -1 })

/** Mongo removes the row once it is older than the feed's memory. */
activitySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

const CommunityActivity: Model<ICommunityActivity> = mongoose.model<ICommunityActivity>(
  'CommunityActivity',
  activitySchema,
)

export default CommunityActivity
