import mongoose, { Schema, Document, Model, Types } from 'mongoose'

/**
 * An admin's post to the whole community.
 *
 * One-way by design: the PRD gives announcements their own channel precisely so
 * they do not compete with conversation. Members react and, where the author
 * allows it, reply -- but they cannot start one.
 *
 * Reactions are embedded. An announcement is read far more often than it is
 * reacted to, the set is small and bounded by the member count in practice, and
 * keeping them here means rendering the list costs one query rather than a
 * second lookup per row.
 */

export interface IAnnouncementReaction {
  user: Types.ObjectId
  emoji: string
  at: Date
}

export interface IAnnouncement extends Document {
  community: Types.ObjectId
  author: Types.ObjectId
  /** Kept so a withdrawn account still reads as the person who posted. */
  authorName: string
  title: string
  body: string
  /** Pinned announcements lead the list regardless of age. */
  pinned: boolean
  repliesEnabled: boolean
  reactions: IAnnouncementReaction[]
  deletedAt?: Date
  createdAt: Date
  updatedAt: Date
}

export const MAX_ANNOUNCEMENT_LENGTH = 4000

const reactionSchema = new Schema<IAnnouncementReaction>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    emoji: { type: String, required: true, maxlength: 8 },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
)

const announcementSchema = new Schema<IAnnouncement>(
  {
    community: { type: Schema.Types.ObjectId, ref: 'Community', required: true },
    // Nullable like groupMessage's author: the announcement outlives the
    // account that wrote it, and the name below is what carries it afterwards.
    author: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    authorName: { type: String, required: true },
    title: { type: String, required: true, trim: true, maxlength: 140 },
    body: { type: String, required: true, maxlength: MAX_ANNOUNCEMENT_LENGTH },
    pinned: { type: Boolean, default: false },
    repliesEnabled: { type: Boolean, default: true },
    reactions: { type: [reactionSchema], default: [] },
    deletedAt: { type: Date },
  },
  { timestamps: true },
)

/**
 * The community's announcement list: pinned first, then newest.
 *
 * Mongo can walk this index in that order directly, so the common read needs no
 * in-memory sort.
 */
announcementSchema.index({ community: 1, pinned: -1, createdAt: -1 })

const Announcement: Model<IAnnouncement> = mongoose.model<IAnnouncement>(
  'Announcement',
  announcementSchema,
)

export default Announcement
