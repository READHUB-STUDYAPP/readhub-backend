import Book from '../models/Books.js'
import Notification from '../models/notification.js'
import NotificationPreference from '../models/notificationPreference.js'
import ReadingSession from '../models/readingSession.js'
import Reminder from '../models/reminder.js'
import User from '../models/User.js'
import { sendEmail } from './email.js'
import { dateStampIn, deliver, escapeHtml, notify, preferencesFor } from './notification.service.js'
import { runBuddyAccountability } from './buddyAccountability.js'

/**
 * The clock behind notifications.
 *
 * A minute tick that does four things: deliver what has come due, fire the
 * reading reminders people set for themselves, and -- once a day -- run the two
 * email tracks that reach readers who have stopped coming back.
 *
 * There is no queue server behind this. Scheduled rows live in Mongo with an
 * index on `scheduledAt`, and this polls them. That is a deliberate trade: one
 * indexed query a minute, against standing up Redis and a worker on a box
 * already carrying four stacks. `claimedAt` is what keeps it correct if the API
 * is ever scaled past one instance -- a row is claimed by a conditional update
 * before it is sent, so two pollers cannot both send it.
 *
 * Every daily job is idempotent through a dedupe key rather than a job-run
 * marker, so running the sweep twice sends nothing twice.
 */

const TICK_MS = 60 * 1000

/** How many due rows one tick will take. Bounds the work per minute. */
const BATCH = 100

/** The rungs of the inactivity ladder, in days since the last reading session. */
const INACTIVITY_RUNGS = [7, 21, 60]

let timer: NodeJS.Timeout | null = null
let running = false

export function startNotificationScheduler(): void {
  if (timer) return
  timer = setInterval(() => {
    void tick()
  }, TICK_MS)
  // Node should be able to exit on a signal without waiting for this.
  timer.unref?.()
  console.log('[notifications] scheduler started')
}

export function stopNotificationScheduler(): void {
  if (timer) clearInterval(timer)
  timer = null
}

/** Exported so a test or an admin action can run one pass deterministically. */
export async function tick(now = new Date()): Promise<void> {
  // Skip rather than queue: if a pass is slow, the next minute picks up where
  // it left off. Overlapping passes would fight over the same rows.
  if (running) return
  running = true

  try {
    await deliverDue(now)
    await fireReadingReminders(now)
    await runDailyEmailTracks(now)
    await runDailyBuddySweep(now)
  } catch (error) {
    console.error('[notifications] tick failed', error)
  } finally {
    running = false
  }
}

/** Anything whose time has come, claimed one row at a time, then delivered. */
async function deliverDue(now: Date): Promise<void> {
  for (let sent = 0; sent < BATCH; sent += 1) {
    const claimed = await Notification.findOneAndUpdate(
      {
        scheduledAt: { $lte: now },
        sentAt: { $exists: false },
        cancelledAt: { $exists: false },
        claimedAt: { $exists: false },
      },
      { $set: { claimedAt: now } },
      { new: true, sort: { scheduledAt: 1 } },
    )

    if (!claimed) return

    // A reminder that is no longer worth sending is dropped rather than
    // delivered late.
    if (claimed.expiresAt && claimed.expiresAt < now) {
      claimed.cancelledAt = now
      await claimed.save()
      continue
    }

    await deliver(claimed)
  }
}

/**
 * Reading reminders, fired at the local minute each reader chose.
 *
 * `minuteOfDay` is local, so the sweep asks each distinct timezone what time it
 * is there and queries that minute. A handful of indexed lookups a minute,
 * rather than reading every reminder to check the clock.
 */
async function fireReadingReminders(now: Date): Promise<void> {
  const timezones = await Reminder.distinct('timezone', { enabled: true })

  for (const timezone of timezones) {
    const today = dateStampIn(timezone, now)
    const minuteNow = localMinute(timezone, now)

    const due = await Reminder.find({
      enabled: true,
      timezone,
      minuteOfDay: minuteNow,
      $or: [{ lastFiredOn: { $exists: false } }, { lastFiredOn: { $ne: today } }],
    }).limit(BATCH)

    for (const reminder of due) {
      if (!fallsToday(reminder.frequency, reminder.days, timezone, now)) continue

      // Claim the day before sending, so a slow send cannot double-fire.
      const claimed = await Reminder.findOneAndUpdate(
        { _id: reminder._id, lastFiredOn: { $ne: today } },
        { $set: { lastFiredOn: today } },
        { new: true },
      )
      if (!claimed) continue

      // Someone who has already read today does not need telling to start.
      const readToday = await hasReadSince(String(reminder.user), startOfDay(timezone, now))
      if (readToday) continue

      const book = await Book.findOne({ uploadedBy: reminder.user, lastPageRead: { $gt: 0 } })
        .sort({ updatedAt: -1 })
        .select('title lastPageRead pages')
        .lean()

      await notify({
        user: reminder.user,
        type: 'READING_REMINDER',
        category: 'reading',
        priority: 'high',
        title: 'Time to read',
        message: book
          ? `You are on page ${book.lastPageRead} of ${book.title}. ${reminder.targetMinutes} minutes is all it takes.`
          : `You planned to read for ${reminder.targetMinutes} minutes today. Let's get started.`,
        actionRoute: book ? 'reader' : 'library',
        actionId: book ? String(book._id) : undefined,
        dedupeKey: `reading-reminder:${today}`,
        // A reminder to read today is worthless tomorrow.
        expiresAt: endOfDay(timezone, now),
      })
    }
  }
}

/**
 * The two tracks that reach people who are not coming back on their own.
 *
 * Gated to one pass a day by the hour, and made safe to repeat by the dedupe
 * keys below -- a second pass on the same day creates nothing.
 */
async function runDailyEmailTracks(now: Date): Promise<void> {
  // Mid-morning UTC: late enough that most of West Africa is awake, early
  // enough that it is not an evening interruption.
  if (now.getUTCHours() !== 9 || now.getUTCMinutes() !== 0) return

  await sendInactivityNudges(now)
  await sendFortnightlyResume(now)
}

/**
 * The Reading Buddy sweeps, an hour after the email tracks.
 *
 * Deliberately not the same hour: both walk a lot of rows, and there is no
 * reason to make one minute of the day carry all of it.
 */
async function runDailyBuddySweep(now: Date): Promise<void> {
  if (now.getUTCHours() !== 10 || now.getUTCMinutes() !== 0) return

  await runBuddyAccountability(now)
}

/**
 * Day 7, 21 and 60 since the last reading session, then silence.
 *
 * The ladder resets whenever someone reads, because the rung is computed from
 * their last session rather than counted up from a stored position.
 */
async function sendInactivityNudges(now: Date): Promise<void> {
  for (const rung of INACTIVITY_RUNGS) {
    const windowStart = new Date(now.getTime() - (rung + 1) * 86400000)
    const windowEnd = new Date(now.getTime() - rung * 86400000)

    // People whose most recent session falls in this one-day window are
    // exactly `rung` days idle today, which is what makes each rung fire once.
    const candidates = await ReadingSession.aggregate<{ _id: unknown; lastRead: Date }>([
      { $group: { _id: '$user', lastRead: { $max: '$endTime' } } },
      { $match: { lastRead: { $gte: windowStart, $lt: windowEnd } } },
      { $limit: 500 },
    ])

    for (const candidate of candidates) {
      await sendNudge(String(candidate._id), rung, now)
    }
  }
}

async function sendNudge(userId: string, rung: number, now: Date): Promise<void> {
  const preference = await preferencesFor(userId)
  if (!preference.inactivityEmails || preference.unsubscribedFromNudgesAt) return

  const user = await User.findById(userId).select('email username').lean()
  if (!user?.email) return

  const book = await Book.findOne({ uploadedBy: userId, lastPageRead: { $gt: 0 } })
    .sort({ updatedAt: -1 })
    .select('title lastPageRead pages')
    .lean()

  // An empty library and an abandoned book are different problems, and a
  // message that ignores the difference reads as a form letter.
  const subject = book ? `Your book is still waiting` : `Ready to start reading?`
  const body = book
    ? `You stopped on page ${book.lastPageRead} of ${escapeHtml(book.title)}. Picking it up again takes a few minutes.`
    : `You have not started a book on ReadHub yet. Even ten minutes of reading a day adds up faster than you would think.`

  await notify({
    user: userId,
    type: 'CONTINUE_READING',
    category: 'reading',
    priority: 'low',
    title: subject,
    message: body,
    actionRoute: book ? 'reader' : 'library',
    actionId: book ? String(book._id) : undefined,
    // One per rung, ever: the key carries the rung, and the window only
    // matters within a day.
    dedupeKey: `inactivity:${rung}:${dateStampIn(preference.timezone, now)}`,
    channels: ['email'],
    // `inactivityEmails` and the unsubscribe stamp were both checked above.
    // Without this the category toggle overrules them and nothing is sent.
    governedByOwnPreference: true,
  })
}

/**
 * Every fortnight, to anyone with a book in progress.
 *
 * The dedupe key carries the fortnight, so the daily pass sends this once per
 * two weeks without storing a schedule per reader.
 */
async function sendFortnightlyResume(now: Date): Promise<void> {
  const fortnight = Math.floor(now.getTime() / (14 * 86400000))

  // Only readers who have something to resume, and who have been quiet for a
  // few days -- someone reading this week does not need chasing.
  const quietSince = new Date(now.getTime() - 4 * 86400000)

  const inProgress = await Book.find({ lastPageRead: { $gt: 0 }, updatedAt: { $lt: quietSince } })
    .sort({ updatedAt: -1 })
    .select('title lastPageRead pages uploadedBy')
    .limit(1000)
    .lean()

  // One book per reader: the most recent, not a digest of every half-finished
  // thing they own.
  const seen = new Set<string>()

  for (const book of inProgress) {
    const userId = String(book.uploadedBy)
    if (seen.has(userId)) continue
    seen.add(userId)

    const preference = await preferencesFor(userId)
    if (!preference.fortnightlyResumeEmail || preference.unsubscribedFromNudgesAt) continue

    const user = await User.findById(userId).select('email').lean()
    if (!user?.email) continue

    const remaining = Math.max(0, (book.pages ?? 0) - (book.lastPageRead ?? 0))
    const subject = `Carry on where you stopped`
    const body = `You are on page ${book.lastPageRead} of ${escapeHtml(book.title)}${
      remaining > 0 ? ` -- ${remaining} pages to go` : ''
    }.`

    await notify({
      user: userId,
      type: 'CONTINUE_READING',
      category: 'reading',
      priority: 'low',
      title: subject,
      message: body,
      actionRoute: 'reader',
      actionId: String(book._id),
      dedupeKey: `resume:${fortnight}`,
      channels: ['email'],
      // Same as above: `fortnightlyResumeEmail` has already decided.
      governedByOwnPreference: true,
    })
  }
}


/* ------------------------------------------------------------------ helpers */

function localMinute(timezone: string, when: Date): number {
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
    return when.getUTCHours() * 60 + when.getUTCMinutes()
  }
}

function weekdayIn(timezone: string, when: Date): number {
  const name = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'short' }).format(
    when,
  )
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name)
}

function fallsToday(
  frequency: string,
  days: number[],
  timezone: string,
  when: Date,
): boolean {
  const day = weekdayIn(timezone, when)
  if (frequency === 'daily') return true
  if (frequency === 'weekdays') return day >= 1 && day <= 5
  if (frequency === 'weekends') return day === 0 || day === 6
  return days.includes(day)
}

function startOfDay(timezone: string, when: Date): Date {
  const stamp = dateStampIn(timezone, when)
  return new Date(`${stamp}T00:00:00Z`)
}

function endOfDay(timezone: string, when: Date): Date {
  return new Date(startOfDay(timezone, when).getTime() + 86400000)
}

async function hasReadSince(user: string, since: Date): Promise<boolean> {
  const session = await ReadingSession.findOne({ user, endTime: { $gte: since } })
    .select('_id')
    .lean()
  return Boolean(session)
}
