import { Types } from 'mongoose'

import Buddy, { type IBuddy } from '../models/buddy.js'
import BuddyRead, { type IBuddyRead } from '../models/buddyRead.js'
import GroupProgress from '../models/groupProgress.js'
import ReadingGroup from '../models/readingGroup.js'
import User from '../models/User.js'
import { checkBuddyBadges } from './achievements.js'
import { notify } from './notification.service.js'

/**
 * Carrying a reader's position in a book out to everywhere it is shared.
 *
 * Reading happens in one place -- the reader opens a book and turns pages, and
 * the reader saves that position against their own copy. Everything else that
 * shows progress was reading a number somebody had to type in again by hand.
 *
 * For reading groups that meant nothing at all: `GroupProgress` is only ever
 * written by the group's own progress endpoint, and no client has ever called
 * it. Every member row on every group screen has been showing a position of
 * zero since the feature shipped, and the "behind by" maths on top of it was
 * working from that zero. For buddy reads it meant a text box asking "what page
 * are you on?" about a book the app was already tracking.
 *
 * So this runs from the one place a position is recorded, and fans it out. A
 * reader reads; their group and their buddy see it.
 *
 * Never throws. A book's own progress is the thing the reader is waiting on,
 * and it must not fail because a group they are in happens to be unreachable.
 */

/** Page numbers only move forward, matching the rule on the book itself. */
const furthest = (current: number, incoming: number) => Math.max(current, incoming)

/**
 * Applies a position to one shared read, including the finishing rules.
 *
 * Shared with the buddy progress endpoint rather than reimplemented, so a
 * position arriving automatically and one typed in by hand cannot disagree
 * about when somebody finished.
 */
export interface BuddyProgressOutcome {
  changed: boolean
  /** This reader has just reached the target for the first time. */
  justFinished: boolean
  /** Both readers are now at the target: the pair has finished the book. */
  everyoneDone: boolean
}

export function applyBuddyReadProgress(
  read: IBuddyRead,
  userId: string,
  page: number,
): BuddyProgressOutcome {
  const entry = read.progress.find((row) => String(row.user) === String(userId))
  const previous = entry?.page ?? 0
  const now = Math.round(page)

  if (entry && now <= previous) return { changed: false, justFinished: false, everyoneDone: false }

  if (entry) {
    entry.page = furthest(previous, now)
    entry.updatedAt = new Date()
  } else {
    read.progress.push({
      user: new Types.ObjectId(userId),
      page: now,
      updatedAt: new Date(),
    } as IBuddyRead['progress'][number])
  }

  const current = read.progress.find((row) => String(row.user) === String(userId))

  // Reaching the target is worth marking once, and only once.
  const target = read.targetPage
  const justFinished =
    target !== undefined && current !== undefined && !current.completedAt && current.page >= target

  if (justFinished && current) current.completedAt = new Date()

  // The pair finishes when both have. That is the moment worth celebrating.
  const everyoneDone =
    target !== undefined &&
    read.progress.length === 2 &&
    read.progress.every((row) => row.page >= target)

  if (everyoneDone && read.status === 'active') {
    read.status = 'completed'
    read.completedAt = new Date()
  }

  return { changed: true, justFinished, everyoneDone }
}


/** The other half of a pair. */
const partnerOf = (users: unknown[], meId: string): string | undefined =>
  users.map(String).find((id) => id !== meId)

/**
 * Tells the pair what just happened.
 *
 * Shared with the manual endpoint on purpose. Finishing a book by actually
 * reading it has to be celebrated exactly as loudly as finishing it by typing
 * a page number into a box -- and now that progress arrives on its own, the
 * automatic path is the one almost everybody will take.
 */
export async function announceBuddyProgress(
  read: IBuddyRead,
  buddy: IBuddy,
  userId: string,
  outcome: BuddyProgressOutcome,
): Promise<void> {
  if (!outcome.justFinished && !outcome.everyoneDone) return

  const partner = partnerOf(buddy.users, userId)

  if (outcome.everyoneDone) {
    buddy.currentRead = undefined
    buddy.completedReads += 1
    await buddy.save()

    for (const user of buddy.users) void checkBuddyBadges(String(user))

    // Both sides hear about it: a finish is the pair's, not one person's.
    await Promise.all(
      buddy.users.map((user) =>
        notify({
          user: String(user),
          type: 'BUDDY_READ_COMPLETED',
          category: 'buddies',
          title: `You both finished ${read.bookTitle}`,
          message: 'That is one more book read together. Pick the next one when you are ready.',
          actionRoute: '/buddies',
          actionId: String(buddy._id),
          dedupeKey: `buddy-read-done:${read._id}`,
        }),
      ),
    )
    return
  }

  if (partner) {
    const me = await User.findById(userId).select('username').lean()
    await notify({
      user: partner,
      type: 'BUDDY_MILESTONE',
      category: 'buddies',
      title: `${me?.username ?? 'Your buddy'} reached the target`,
      message: `They finished their part of ${read.bookTitle}. No rush -- carry on at your own pace.`,
      actionRoute: '/buddies',
      actionId: String(buddy._id),
      dedupeKey: `buddy-milestone:${read._id}:${userId}`,
    })
  }
}

/**
 * Pushes a freshly recorded page out to every group and buddy read that shares
 * this book with this reader.
 */
export async function syncSharedProgress(
  userId: string,
  bookId: Types.ObjectId | string,
  lastPageRead: number,
): Promise<void> {
  const page = Math.round(Number(lastPageRead))
  if (!Number.isFinite(page) || page < 0) return

  try {
    await Promise.all([syncGroups(userId, bookId, page), syncBuddyReads(userId, bookId, page)])
  } catch (error) {
    // The reader's own progress is already saved; this is the part that can be
    // picked up again on their next page turn.
    console.error('[progress] could not sync shared progress', error)
  }
}

async function syncGroups(
  userId: string,
  bookId: Types.ObjectId | string,
  page: number,
): Promise<void> {
  // Only groups that both contain this reader and are reading this book.
  const groups = await ReadingGroup.find({ 'members.user': userId, 'books.book': bookId })
    .select('_id')
    .lean()

  if (groups.length === 0) return

  await Promise.all(
    groups.map((group) =>
      GroupProgress.updateOne(
        { group: group._id, book: bookId, user: userId },
        // `$max` rather than `$set`: the same book may be read on the web and
        // on a phone that was offline, and whichever syncs last would
        // otherwise drag the other backwards.
        { $max: { lastPageRead: page } },
        { upsert: true },
      ),
    ),
  )
}

async function syncBuddyReads(
  userId: string,
  bookId: Types.ObjectId | string,
  page: number,
): Promise<void> {
  const pairs = await Buddy.find({ users: userId, status: 'active' }).select('_id').lean()
  if (pairs.length === 0) return

  const reads = await BuddyRead.find({
    buddy: { $in: pairs.map((pair) => pair._id) },
    book: bookId,
    status: 'active',
  })

  await Promise.all(
    reads.map(async (read) => {
      const outcome = applyBuddyReadProgress(read, userId, page)
      if (!outcome.changed) return

      await read.save()

      const buddy = await Buddy.findById(read.buddy)
      if (buddy) await announceBuddyProgress(read, buddy, userId, outcome)
    }),
  )
}
