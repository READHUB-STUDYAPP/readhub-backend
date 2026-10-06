import mongoose, { Schema, Document, Model, Types } from 'mongoose'

import type { NotificationCategory } from './notification.js'

/**
 * What one reader has agreed to hear about, and when.
 *
 * One row per reader rather than one per category: the whole set is read on
 * every send decision, so keeping it in a single document makes that one
 * lookup. The categories are few and fixed, so the document cannot grow.
 *
 * Absence means defaults, and the defaults are generous but quiet -- everything
 * on except the two re-engagement email tracks, which a reader who has not
 * asked for mail should not receive simply because they signed up.
 */

export interface IChannelToggle {
  inApp: boolean
  push: boolean
  email: boolean
}

export interface INotificationPreference extends Document {
  user: Types.ObjectId
  categories: Record<NotificationCategory, IChannelToggle>
  /**
   * Non-critical notifications are held outside this window and released at
   * its end. Stored as minutes from midnight in the reader's own timezone,
   * because "10pm" means different instants for different people.
   */
  quietHoursStart?: number
  quietHoursEnd?: number
  /** IANA zone. Everything time-of-day is computed against this. */
  timezone: string
  /** The two tracks that reach people who did not just do something. */
  inactivityEmails: boolean
  fortnightlyResumeEmail: boolean
  /**
   * Set when a reader uses the one-click unsubscribe in an email.
   *
   * Separate from the two flags above because it must be honoured without a
   * login, and must never touch transactional mail -- unsubscribing from nudges
   * cannot stop a password reset arriving.
   */
  unsubscribedFromNudgesAt?: Date
  createdAt: Date
  updatedAt: Date
}

const toggle = () => ({
  inApp: { type: Boolean, default: true },
  push: { type: Boolean, default: true },
  email: { type: Boolean, default: false },
})

const preferenceSchema = new Schema<INotificationPreference>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    categories: {
      reading: toggle(),
      community: toggle(),
      groups: toggle(),
      challenges: toggle(),
      events: toggle(),
      buddies: toggle(),
      books: toggle(),
      // Account and security matters always reach the reader by mail, which is
      // the only channel that still works when they have lost access.
      system: {
        inApp: { type: Boolean, default: true },
        push: { type: Boolean, default: true },
        email: { type: Boolean, default: true },
      },
    },
    quietHoursStart: { type: Number, min: 0, max: 1439, default: 22 * 60 },
    quietHoursEnd: { type: Number, min: 0, max: 1439, default: 7 * 60 },
    timezone: { type: String, default: 'Africa/Lagos' },
    inactivityEmails: { type: Boolean, default: true },
    fortnightlyResumeEmail: { type: Boolean, default: true },
    unsubscribedFromNudgesAt: { type: Date },
  },
  { timestamps: true },
)

const NotificationPreference: Model<INotificationPreference> =
  mongoose.model<INotificationPreference>('NotificationPreference', preferenceSchema)

export default NotificationPreference
