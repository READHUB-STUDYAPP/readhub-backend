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
import { emailLayout } from './emailLayout.js'

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
  /**
   * Set when the caller has already consulted a preference of its own.
   *
   * The two re-engagement tracks do: the scheduler checks `inactivityEmails`
   * and `fortnightlyResumeEmail`, and whether the reader has used the
   * one-click unsubscribe, before it gets here. The category toggle then
   * checked a *second*, different switch -- `categories.reading.email`, which
   * defaults to false -- and dropped the message. Two switches disagreeing,
   * and the result was that no reading reminder was ever sent to anybody.
   *
   * This says: that decision has been made, by something that knows more about
   * this message than a category does. Quiet hours and deduplication still
   * apply.
   */
  governedByOwnPreference?: boolean
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
  // A notification is a consequence of something that already happened. If
  // sending one fails -- a bad enum, a push service refusing, the database
  // briefly unavailable -- the thing it was announcing is still true, and
  // taking the caller's request down with it turns a missing notification into
  // a failed join, a lost message, or a book that would not start. So this
  // never throws: it reports and returns null, exactly as it does when the
  // reader has simply switched the category off.
  try {
    return await send(input)
  } catch (error) {
    console.error('[notifications] could not send', input.type, error)
    return null
  }
}

async function send(input: NotifyInput): Promise<INotification | null> {
  const preference = await preferencesFor(input.user)
  const priority = input.priority ?? 'normal'
  const critical = priority === 'critical'

  const toggles = preference.categories?.[input.category]

  // Everything except account and security matters is the reader's choice --
  // unless a dedicated preference has already made the choice for this one.
  if (!critical && !input.governedByOwnPreference && toggles && !toggles.inApp && !toggles.push && !toggles.email) {
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
  const channels = critical || input.governedByOwnPreference
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
    /**
     * High, for everything a reader is meant to actually see.
     *
     * This used to send 'high' only for critical and 'normal' for the rest,
     * which meant almost nothing arrived. Expo maps this straight onto FCM's
     * priority, and a normal-priority message is one Android is free to hold
     * until the app next happens to wake -- which, for a backgrounded app on a
     * phone with ordinary battery management, can be hours or never. Measured
     * on a Galaxy S10e against one device token: three high-priority sends all
     * arrived, two normal-priority sends never did, seconds apart with
     * identical payloads, and Expo reported `ok` for all five. The receipt says
     * FCM accepted it; it says nothing about the phone showing it.
     *
     * High for all of them, the `low` tier included. An earlier version of
     * this kept `low` at normal on the assumption nothing sent it. Six senders
     * do, and they are the ones it matters most for: reading reminders, buddy
     * nudges, weekly recaps, a badge being earned. Those are exactly the
     * notifications nobody is sitting in the app waiting for, so a message
     * Android may hold indefinitely is one that never arrives at all.
     *
     * `priority` still does work here -- it decides what overrides quiet hours
     * and how rows are ordered. It simply stops deciding whether the phone is
     * ever told. If a row was worth writing and a notification worth posting,
     * it was worth delivering.
     */
    priority: 'high',
    /**
     * The channel the app creates on first launch. Without it Expo falls back
     * to a channel of its own, which the reader cannot find in settings to
     * tune or silence.
     */
    channelId: 'default',
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

/**
 * The one place a notification becomes an email.
 *
 * It used to send `<p>message</p>` and nothing else -- no logo, no link to the
 * thing it was about, no way to stop receiving them. The scheduler worked
 * around that by sending its own, better, parallel email, which meant two
 * senders for one message and, once the delivery gate was fixed, would have
 * meant two emails landing for every reminder.
 *
 * So there is one sender now. It carries the brand, a link to whatever the
 * notification points at, and -- for anything that is not an account or
 * security matter -- the one-click unsubscribe, honoured without a login.
 */
async function sendNotificationEmail(notification: INotification): Promise<void> {
  const populated = await Notification.findById(notification._id)
    .populate<{ user: { email?: string; username?: string } }>('user', 'email username')
    .lean()

  const email = populated?.user?.email
  if (!email) return

  const base = (process.env.FRONTEND_URL ?? 'https://app.readhub.study').replace(/\/$/, '')

  // `actionRoute` is a route name the clients understand rather than a path,
  // so only the ones with an obvious web destination become a link.
  const WEB_ROUTES: Record<string, string> = {
    reader: '/library',
    library: '/library',
    'community-challenges': '/communities',
    '/buddies': '/buddies',
    '/communities': '/communities',
    '/profile': '/profile',
    '/buddies/requests': '/buddies?tab=requests',
  }
  const path = notification.actionRoute ? WEB_ROUTES[notification.actionRoute] : undefined

  // Account and security mail must arrive whatever else is switched off, so it
  // is the one kind that carries no unsubscribe.
  const unsubscribeUrl =
    notification.priority === 'critical' || notification.category === 'system'
      ? undefined
      : `${base}/unsubscribe?u=${encodeURIComponent(String(notification.user))}`

  await sendEmail({
    to: email,
    subject: notification.title,
    html: emailLayout({
      heading: notification.title,
      bodyHtml: `<p style="margin:0">${escapeHtml(notification.message)}</p>`,
      action: path ? { label: 'Open ReadHub', url: `${base}${path}` } : undefined,
      unsubscribeUrl,
    }),
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
