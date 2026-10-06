import Buddy from '../models/buddy.js'
import BuddyRead from '../models/buddyRead.js'
import User from '../models/User.js'
import { notify } from './notification.service.js'

/**
 * The accountability half of Reading Buddy: the sweeps that run without anyone
 * pressing anything.
 *
 * Section 13 of the PRD sets the tone these have to hit, and it is the hard
 * part: "encourage rather than shame". So the wording here never counts what
 * somebody failed to do. A missed target is addressed as the book waiting, not
 * as days lost; a buddy ahead of you is never described as ahead. The one rule
 * that keeps this honest is that no message here contains a number the reader
 * did not already know about themselves.
 *
 * All three sweeps are idempotent through dedupe keys built from a date stamp,
 * so running a pass twice sends nothing twice -- which matters because the tick
 * that calls them has no memory of whether it already ran today.
 */

/** The day, as a key. Fine at UTC: these sweeps fire on a fixed UTC hour. */
function dayStamp(now: Date): string {
  return now.toISOString().slice(0, 10)
}

/** The ISO-ish week, as a key, for anything that should land once a week. */
function weekStamp(now: Date): string {
  return String(Math.floor(now.getTime() / (7 * 86400000)))
}

/**
 * A gentle word when a shared target date has gone by.
 *
 * Fires once per read per day, and only while the read is still open. The pair
 * are told together, because a target is something they set together and
 * singling one of them out is exactly the shaming the PRD rules out.
 */
export async function nudgeOverdueReads(now: Date): Promise<number> {
  const overdue = await BuddyRead.find({
    status: 'active',
    targetDate: { $lt: now },
  })
    .limit(200)
    .lean()

  let sent = 0

  for (const read of overdue) {
    const buddy = await Buddy.findOne({ _id: read.buddy, status: 'active' }).lean()
    if (!buddy) continue

    for (const user of buddy.users) {
      const mine = read.progress.find((row) => String(row.user) === String(user))
      // Somebody who has already finished their part does not need a nudge
      // about it.
      if (read.targetPage && mine && mine.page >= read.targetPage) continue

      const delivered = await notify({
        user: String(user),
        type: 'BUDDY_NUDGE',
        category: 'buddies',
        title: `${read.bookTitle} is waiting`,
        message: 'Your shared target date has passed. Pick it back up whenever you can -- or set a new date together.',
        priority: 'low',
        actionRoute: '/buddies',
        actionId: String(buddy._id),
        dedupeKey: `buddy-nudge:${read._id}:${String(user)}:${dayStamp(now)}`,
      })
      if (delivered) sent += 1
    }
  }

  return sent
}

/**
 * The weekly recap.
 *
 * Reports what the pair did, not what they missed. A week with no reading gets
 * no recap at all rather than a recap of zero -- an email saying "you read
 * nothing this week" is the single most discouraging thing this feature could
 * send, and the cheapest way never to send it is not to generate it.
 */
export async function sendWeeklyRecaps(now: Date): Promise<number> {
  const weekAgo = new Date(now.getTime() - 7 * 86400000)

  const pairs = await Buddy.find({ status: 'active' }).limit(500).lean()
  let sent = 0

  for (const buddy of pairs) {
    const read = buddy.currentRead
      ? await BuddyRead.findOne({ _id: buddy.currentRead, status: 'active' }).lean()
      : null

    if (!read) continue

    // Did anything actually move this week?
    const moved = read.progress.some((row) => row.updatedAt >= weekAgo && row.page > 0)
    if (!moved) continue

    for (const user of buddy.users) {
      const mine = read.progress.find((row) => String(row.user) === String(user))
      const pages = mine?.page ?? 0

      const delivered = await notify({
        user: String(user),
        type: 'BUDDY_WEEKLY_RECAP',
        category: 'buddies',
        title: `Your week on ${read.bookTitle}`,
        message: read.targetPage
          ? `You are on page ${pages} of ${read.targetPage}. Keep going at whatever pace suits you.`
          : `You are on page ${pages}. Keep going at whatever pace suits you.`,
        priority: 'low',
        actionRoute: '/buddies',
        actionId: String(buddy._id),
        dedupeKey: `buddy-recap:${buddy._id}:${String(user)}:${weekStamp(now)}`,
      })
      if (delivered) sent += 1
    }
  }

  return sent
}

/**
 * A prompt to a pair who have gone quiet.
 *
 * Two weeks with nothing said and nothing read. Sent once a week after that,
 * and framed as an opening rather than a reprimand -- the most likely reason a
 * pair went quiet is that neither wanted to be the one to speak first.
 */
export async function promptInactivePairs(now: Date): Promise<number> {
  const twoWeeksAgo = new Date(now.getTime() - 14 * 86400000)

  const quiet = await Buddy.find({
    status: 'active',
    $or: [{ lastMessageAt: { $lt: twoWeeksAgo } }, { lastMessageAt: { $exists: false } }],
    startedAt: { $lt: twoWeeksAgo },
  })
    .limit(300)
    .lean()

  let sent = 0

  for (const buddy of quiet) {
    const users = await User.find({ _id: { $in: buddy.users } })
      .select('username')
      .lean()
    const byId = new Map(users.map((user) => [String(user._id), user.username]))

    for (const user of buddy.users) {
      const otherId = buddy.users.map(String).find((id) => id !== String(user))
      const otherName = otherId ? (byId.get(otherId) ?? 'your buddy') : 'your buddy'

      const delivered = await notify({
        user: String(user),
        type: 'BUDDY_INACTIVE',
        category: 'buddies',
        title: `Say hello to ${otherName}`,
        message: 'It has been a quiet couple of weeks. Share what you are reading and see where it goes.',
        priority: 'low',
        actionRoute: '/buddies',
        actionId: String(buddy._id),
        dedupeKey: `buddy-quiet:${buddy._id}:${String(user)}:${weekStamp(now)}`,
      })
      if (delivered) sent += 1
    }
  }

  return sent
}

/**
 * One daily pass over all three.
 *
 * Called from the notification tick at a fixed hour rather than on every
 * minute: none of this is time-critical, and a sweep over every pair is not
 * something to run sixty times an hour.
 */
export async function runBuddyAccountability(now: Date): Promise<void> {
  try {
    await nudgeOverdueReads(now)
    await promptInactivePairs(now)
    // Recaps go out on Sunday evening, when the week is actually over.
    if (now.getUTCDay() === 0) await sendWeeklyRecaps(now)
  } catch (error) {
    console.error('[buddies] accountability sweep failed', error)
  }
}
