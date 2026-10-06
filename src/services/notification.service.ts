import { Types } from 'mongoose'

import DeviceToken, { MAX_PUSH_FAILURES } from '../models/deviceToken.js'
import Notification, {
  type INotification,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationPriority,
  type NotificationType,
} from '../models/notification.js'
import NotificationPreference, {
  type INotificationPreference,
} from '../models/notificationPreference.js'
import { sendEmail } from './email.js'

/**
 * The one way anything in ReadHub tells a reader something.
 *
 * Every caller hands over an intent -- who, what type, what it says, where it
 * goes -- and this decides the rest: whether the reader wants it, which
 * channels to use, whether it is a duplicate, and whether now is a reasonable
 * hour. Callers deliberately cannot reach the channels directly, because the
 * rules in section 26 of the PRD only hold if there is a single door.
 */

export interface NotifyInput {
  user: Types.ObjectId | string
  type: NotificationType
  category: NotificationCategory
  title: string
  message: string
  priority?: NotificationPriority
  actionRoute?: string
  actionId?: string
  icon?: string
  /** Same key within the window below means the same event told twice. */
  dedupeKey?: string
  /** Future date queues it; omitted means now. */
  scheduledAt?: Date
  expiresAt?: Date
  /** Channels to consider. Preferences still apply to each. */
  channels?: NotificationChannel[]
}

/** How long a dedupe key suppresses a repeat. */
const DEDUPE_WINDOW_MS = 6 * 60 * 60 * 1000

/** Expo's push endpoint. No SDK: it is one POST with a JSON array. */
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

/**
 * The reader's settings, created on first use.
 *
 * Upserted rather than required at signup, so every existing account behaves
 * as though it had defaults from the start.
 */
export async function preferencesFor(user: Types.ObjectId | string) {
  return NotificationPreference.findOneAndUpdate(
    { user },
    { $setOnInsert: { user } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  )
}

/** Minutes from midnight, in the reader's own zone. */
function minuteOfDayIn(timezone: string, when: Date): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(when)
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
    return hour * 60 + minute
  } catch {
    // An unknown zone should not stop a notification; UTC is a safe fallback.
    return when.getUTCHours() * 60 + when.getUTCMinutes()
  }
}

/** `YYYY-MM-DD` where the reader is, which is what "today" has to mean. */
export function dateStampIn(timezone: string, when = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(when)
  } catch {
    return when.toISOString().slice(0, 10)
  }
}

/**
 * Whether `when` falls inside the reader's quiet hours.
 *
 * Handles the ordinary case of a window that wraps midnight -- 22:00 to 07:00
 * is two ranges on a clock, not one.
 */
export function inQuietHours(preference: INotificationPreference, when: Date): boolean {
  const start = preference.quietHoursStart
  const end = preference.quietHoursEnd
  if (start == null || end == null || start === end) return false

  const now = minuteOfDayIn(preference.timezone, when)
  return start < end ? now >= start && now < end : now >= start || now < end
}

/** The next moment outside quiet hours, for holding a notification back. */
function endOfQuietHours(preference: INotificationPreference, from: Date): Date {
  const end = preference.quietHoursEnd ?? 0
  const now = minuteOfDayIn(preference.timezone, from)
  const minutesUntil = end > now ? end - now : 24 * 60 - now + end
  return new Date(from.getTime() + minutesUntil * 60 * 1000)
}

/**
 * Create a notification, subject to every rule that protects the reader.
 *
 * Returns the row when one was created and null when it was suppressed, so a
 * caller can tell the difference between "told them" and "decided not to".
 */
export async function notify(input: NotifyInput): Promise<INotification | null> {
  const preference = await preferencesFor(input.user)
  const priority = input.priority ?? 'normal'
  const critical = priority === 'critical'

  const toggles = preference.categories?.[input.category]

  // Everything except account and security matters is the reader's choice.
  if (!critical && toggles && !toggles.inApp && !toggles.push && !toggles.email) {
    return null
  }

  // Duplicate suppression: the same event, told twice, within the window.
  if (input.dedupeKey) {
    const recent = await Notification.findOne({
      user: input.user,
      dedupeKey: input.dedupeKey,
      createdAt: { $gte: new Date(Date.now() - DEDUPE_WINDOW_MS) },
    })
      .select('_id')
      .lean()
    if (recent) return null
  }

  const wanted = input.channels ?? ['in_app', 'push']
  const channels = critical
    ? wanted
    : wanted.filter((channel) => {
        if (!toggles) return true
        if (channel === 'in_app') return toggles.inApp
        if (channel === 'push') return toggles.push
        return toggles.email
      })

  if (channels.length === 0) return null

  // Quiet hours delay rather than drop: the reader still wants to know, just
  // not at 3am. Critical notifications ignore the window entirely.
  let scheduledAt = input.scheduledAt
  const now = new Date()
  if (!critical && !scheduledAt && inQuietHours(preference, now)) {
    scheduledAt = endOfQuietHours(preference, now)
  }

  const notification = await Notification.create({
    user: input.user,
    type: input.type,
    category: input.category,
    title: input.title,
    message: input.message,
    icon: input.icon,
    actionRoute: input.actionRoute,
    actionId: input.actionId,
    priority,
    channels,
    dedupeKey: input.dedupeKey,
    scheduledAt,
    expiresAt: input.expiresAt,
  })

  // Nothing scheduled goes out now; the scheduler owns the rest.
  if (!scheduledAt) await deliver(notification)

  return notification
}

/**
 * Cancel anything still queued for this reader under a dedupe key.
 *
 * This is what stops the evening nudge after someone has already read -- the
 * PRD's rule that a reminder should not arrive once its action is done.
 */
export async function cancelPending(user: Types.ObjectId | string, dedupeKey: string) {
  await Notification.updateMany(
    { user, dedupeKey, sentAt: { $exists: false }, cancelledAt: { $exists: false } },
    { $set: { cancelledAt: new Date() } },
  )
}

/** Push and email for one row. In-app needs no delivery: the row *is* it. */
export async function deliver(notification: INotification): Promise<void> {
  const tasks: Promise<unknown>[] = []

  if (notification.channels.includes('push')) tasks.push(sendPush(notification))
  if (notification.channels.includes('email')) tasks.push(sendNotificationEmail(notification))

  // A failing channel must not hold up the others or the row's own bookkeeping.
  await Promise.allSettled(tasks)

  notification.sentAt = new Date()
  await notification.save()
}

async function sendPush(notification: INotification): Promise<void> {
  const devices = await DeviceToken.find({ user: notification.user, enabled: true }).lean()
  if (devices.length === 0) return

  const messages = devices.map((device) => ({
    to: device.token,
    title: notification.title,
    body: notification.message,
    sound: 'default',
    priority: notification.priority === 'critical' ? 'high' : 'normal',
    data: {
      notificationId: String(notification._id),
      route: notification.actionRoute,
      id: notification.actionId,
    },
  }))

  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    })
    const body = (await response.json()) as { data?: { status: string; details?: unknown }[] }

    // Retire tokens the service says are gone. A device that has uninstalled
    // the app answers the same way every time, so counting the failures and
    // disabling at the threshold keeps later batches honest.
    const results = body.data ?? []
    await Promise.all(
      results.map(async (result, index) => {
        const device = devices[index]
        if (!device) return
        if (result.status === 'error') {
          const failures = (device.failureCount ?? 0) + 1
          await DeviceToken.updateOne(
            { _id: device._id },
            failures >= MAX_PUSH_FAILURES
              ? { $set: { failureCount: failures, enabled: false } }
              : { $set: { failureCount: failures } },
          )
        } else if (device.failureCount) {
          await DeviceToken.updateOne({ _id: device._id }, { $set: { failureCount: 0 } })
        }
      }),
    )
  } catch (error) {
    // A push outage is not a reason to fail the notification; the in-app row
    // is already written and the reader will see it when they next look.
    console.error('[notifications] push failed', error)
  }
}

async function sendNotificationEmail(notification: INotification): Promise<void> {
  const populated = await Notification.findById(notification._id)
    .populate<{ user: { email?: string; username?: string } }>('user', 'email username')
    .lean()

  const email = populated?.user?.email
  if (!email) return

  await sendEmail({
    to: email,
    subject: notification.title,
    html: `<p>${escapeHtml(notification.message)}</p>`,
  })
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Tell many people the same thing.
 *
 * Used by announcements and group events. Runs in batches so a community of
 * thousands does not open thousands of concurrent sends, and so one bad row
 * cannot take the rest down with it.
 */
export async function notifyMany(
  users: (Types.ObjectId | string)[],
  input: Omit<NotifyInput, 'user'>,
): Promise<number> {
  const BATCH = 50
  let created = 0

  for (let index = 0; index < users.length; index += BATCH) {
    const batch = users.slice(index, index + BATCH)
    const results = await Promise.allSettled(
      batch.map((user) => notify({ ...input, user })),
    )
    created += results.filter((r) => r.status === 'fulfilled' && r.value).length
  }

  return created
}
