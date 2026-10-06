import mongoose, { Schema, Document, Model, Types } from 'mongoose'

/**
 * A reading time a reader has chosen for themselves.
 *
 * "Every day at 8pm for 20 minutes" is one row. The scheduler reads these to
 * decide who should hear from ReadHub in the next minute; it does not store a
 * row per future occurrence, because a recurring intention is one fact and
 * expanding it would mean rewriting the future every time someone moved it.
 *
 * `lastFiredOn` is a date stamp in the reader's own timezone rather than an
 * instant. It is what makes "already reminded today" answerable without a
 * second collection, and it is what section 26 needs to avoid nagging someone
 * twice in a day.
 */

export type ReminderFrequency = 'daily' | 'weekdays' | 'weekends' | 'custom'

export interface IReminder extends Document {
  user: Types.ObjectId
  frequency: ReminderFrequency
  /** 0 = Sunday. Used when frequency is `custom`. */
  days: number[]
  /** Minutes from midnight, local to the reader. */
  minuteOfDay: number
  /** What they told themselves they would do, echoed back in the reminder. */
  targetMinutes: number
  timezone: string
  enabled: boolean
  /** `YYYY-MM-DD` in the reader's zone, so a day is a day where they live. */
  lastFiredOn?: string
  createdAt: Date
  updatedAt: Date
}

const reminderSchema = new Schema<IReminder>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    frequency: {
      type: String,
      required: true,
      enum: ['daily', 'weekdays', 'weekends', 'custom'],
      default: 'daily',
    },
    days: { type: [Number], default: [] },
    minuteOfDay: { type: Number, required: true, min: 0, max: 1439 },
    targetMinutes: { type: Number, default: 20, min: 1, max: 600 },
    timezone: { type: String, default: 'Africa/Lagos' },
    enabled: { type: Boolean, default: true },
    lastFiredOn: { type: String },
  },
  { timestamps: true },
)

/**
 * The scheduler's sweep: every enabled reminder, once a minute.
 *
 * Partial on `enabled`, because a reminder someone switched off should not be
 * carried in the index the sweep walks.
 */
reminderSchema.index({ minuteOfDay: 1 }, { partialFilterExpression: { enabled: true } })

/** The reader's own list of reminders. */
reminderSchema.index({ user: 1, createdAt: -1 })

const Reminder: Model<IReminder> = mongoose.model<IReminder>('Reminder', reminderSchema)

export default Reminder
