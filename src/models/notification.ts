import mongoose, { Schema, Document, Model, Types } from 'mongoose'

/**
 * One thing worth telling one person.
 *
 * Rows are written either to be delivered now or to be delivered later, and the
 * same collection serves both -- a row with `scheduledAt` in the future is a
 * queue entry, and the poller in `notificationScheduler` is what turns it into
 * a delivery. That avoids standing up Redis and a queue runner on a box already
 * carrying four stacks, at the cost of one indexed query a minute.
 *
 * `claimedAt` is what keeps that safe if the API ever runs more than one
 * instance: a worker claims a batch with a conditional update before sending,
 * so two pollers cannot send the same row twice.
 *
 * Types are an enum rather than free text, as the PRD asks. A fixed vocabulary
 * is what lets preferences, grouping and analytics all talk about the same
 * thing without string-matching message copy.
 */

export type NotificationCategory =
  | 'reading'
  | 'community'
  | 'groups'
  | 'challenges'
  | 'events'
  | 'books'
  | 'system'

export type NotificationType =
  // reading
  | 'READING_REMINDER'
  | 'READING_GOAL_REMINDER'
  | 'READING_GOAL_COMPLETED'
  | 'STREAK_AT_RISK'
  | 'STREAK_MILESTONE'
  | 'BOOK_COMPLETED'
  | 'CONTINUE_READING'
  // community
  | 'COMMUNITY_ANNOUNCEMENT'
  | 'COMMUNITY_INVITATION'
  | 'COMMUNITY_JOIN_APPROVED'
  | 'COMMUNITY_JOIN_REQUEST'
  // reading groups
  | 'GROUP_ADDED'
  | 'GROUP_BOOK_ADDED'
  | 'GROUP_SCHEDULE'
  | 'GROUP_DISCUSSION'
  | 'GROUP_DISCUSSION_REPLY'
  | 'GROUP_MENTION'
  | 'GROUP_MILESTONE'
  // books and authors
  | 'BOOK_RECOMMENDATION'
  | 'AUTHOR_UPDATE'
  // system
  | 'SYSTEM_ALERT'

/**
 * How insistent this is.
 *
 * `critical` ignores quiet hours and cannot be switched off -- account and
 * security matters only. Everything else waits for a sensible hour and obeys
 * the reader's preferences.
 */
export type NotificationPriority = 'critical' | 'high' | 'normal' | 'low'

export type NotificationChannel = 'in_app' | 'push' | 'email'

export interface INotification extends Document {
  user: Types.ObjectId
  type: NotificationType
  category: NotificationCategory
  title: string
  message: string
  icon?: string
  /**
   * Where tapping it should land. A route the clients understand, plus the id
   * it needs -- the PRD's rule is that a notification without a useful next
   * action should not be sent.
   */
  actionRoute?: string
  actionId?: string
  priority: NotificationPriority
  channels: NotificationChannel[]
  /**
   * Collapses repeats. Two notifications sharing a key within a window are the
   * same event told twice, and only the first is kept -- this is what section
   * 26's "prevent duplicate notifications" rests on.
   */
  dedupeKey?: string
  /** Null for send-now. A future date makes this a queue entry. */
  scheduledAt?: Date
  claimedAt?: Date
  sentAt?: Date
  readAt?: Date
  /** Stops a stale reminder arriving days after it mattered. */
  expiresAt?: Date
  /** Set when the reason for sending went away before it was sent. */
  cancelledAt?: Date
  createdAt: Date
  updatedAt: Date
}

const notificationSchema = new Schema<INotification>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true },
    category: {
      type: String,
      required: true,
      enum: ['reading', 'community', 'groups', 'challenges', 'events', 'books', 'system'],
    },
    title: { type: String, required: true, maxlength: 140 },
    message: { type: String, required: true, maxlength: 500 },
    icon: { type: String },
    actionRoute: { type: String },
    actionId: { type: String },
    priority: {
      type: String,
      required: true,
      enum: ['critical', 'high', 'normal', 'low'],
      default: 'normal',
    },
    channels: { type: [String], default: ['in_app'] },
    dedupeKey: { type: String },
    scheduledAt: { type: Date },
    claimedAt: { type: Date },
    sentAt: { type: Date },
    readAt: { type: Date },
    expiresAt: { type: Date },
    cancelledAt: { type: Date },
  },
  { timestamps: true },
)

/** The notification centre: one reader's list, newest first. */
notificationSchema.index({ user: 1, createdAt: -1 })

/** The unread badge, and the category filters above the list. */
notificationSchema.index({ user: 1, readAt: 1, category: 1 })

/**
 * What the poller asks for once a minute: due, unsent, unclaimed.
 *
 * Partial, so the index holds only the small set still waiting rather than
 * every notification ever delivered.
 */
notificationSchema.index(
  { scheduledAt: 1 },
  { partialFilterExpression: { sentAt: { $exists: false } } },
)

/** Deduplication, scoped to the reader it would reach. */
notificationSchema.index({ user: 1, dedupeKey: 1, createdAt: -1 }, { sparse: true })

const Notification: Model<INotification> = mongoose.model<INotification>(
  'Notification',
  notificationSchema,
)

export default Notification
