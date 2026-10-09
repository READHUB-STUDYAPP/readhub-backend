import { Types } from 'mongoose'

import Achievement from '../models/achievement.js'
import Book from '../models/Books.js'
import Buddy from '../models/buddy.js'
import ChallengeParticipant from '../models/challengeParticipant.js'
import Note from '../models/Notes.js'
import UserStats from '../models/userStatistics.js'
import { notify } from './notification.service.js'

/**
 * Badges: what they are, when they are given, and how a profile reads them.
 *
 * The catalogue is a table rather than code because adding a badge should be
 * one entry, not a deploy of new UI -- the clients render whatever this
 * returns, including the label and the sentence explaining how it was earned.
 *
 * Two rules the whole file follows, both from the PRD's "accountability, not
 * pressure":
 *
 *  - Badges are for things done, never for things missed. There is no badge
 *    for breaking a streak and none for falling behind.
 *  - Nothing is ever taken away. Rows are written once and never deleted, so
 *    a streak that ends does not erase the streak that happened.
 */

export type AchievementCategory = 'reading' | 'books' | 'community' | 'buddies'

export interface BadgeDefinition {
  key: string
  label: string
  /** What the reader did, in their own terms. Shown under the label. */
  earnedBy: string
  category: AchievementCategory
  icon: string
}

/**
 * Eight, not thirty.
 *
 * A wall of mostly-unearned badges reads as a list of things you have failed
 * to do, which is the opposite of the point. These cover the five things the
 * app can honestly observe -- consistency, volume, company, a shared finish,
 * and a challenge seen through -- and leave room to add more once there is
 * evidence of which ones people actually care about.
 */
export const BADGES: BadgeDefinition[] = [
  {
    key: 'streak-7',
    label: 'Seven days running',
    earnedBy: 'Read on seven days in a row',
    category: 'reading',
    icon: '🔥',
  },
  {
    key: 'streak-30',
    label: 'A month of reading',
    earnedBy: 'Read on thirty days in a row',
    category: 'reading',
    icon: '🏅',
  },
  {
    key: 'minutes-1000',
    label: 'A thousand minutes',
    earnedBy: 'Spent a thousand minutes reading',
    category: 'reading',
    icon: '⏳',
  },
  {
    key: 'books-1',
    label: 'First book finished',
    earnedBy: 'Finished a book',
    category: 'books',
    icon: '📖',
  },
  {
    key: 'books-10',
    label: 'Ten books in',
    earnedBy: 'Finished ten books',
    category: 'books',
    icon: '📚',
  },
  {
    key: 'notes-25',
    label: 'Marginalia',
    earnedBy: 'Wrote twenty-five notes while reading',
    category: 'books',
    icon: '✍️',
  },
  {
    key: 'first-buddy',
    label: 'Found a reading buddy',
    earnedBy: 'Started reading with someone',
    category: 'buddies',
    icon: '🤝',
  },
  {
    key: 'buddy-read-1',
    label: 'Finished together',
    earnedBy: 'Read a book to the end with a buddy',
    category: 'buddies',
    icon: '🎉',
  },
  {
    key: 'challenge-1',
    label: 'Challenge complete',
    earnedBy: 'Saw a community challenge through',
    category: 'community',
    icon: '🏆',
  },
]

const BY_KEY = new Map(BADGES.map((badge) => [badge.key, badge]))

/**
 * Give a badge, once.
 *
 * Returns true only when this call is the one that earned it, which is what
 * makes the notification below fire exactly once however many callers race.
 * The unique index decides; a duplicate means somebody else got there first,
 * and that is a success for the reader either way.
 *
 * Never throws. A badge is a decoration on something that already happened --
 * finishing a book must not fail because the celebration did.
 */
export async function award(
  user: Types.ObjectId | string,
  key: string,
  value?: number,
): Promise<boolean> {
  const badge = BY_KEY.get(key)
  if (!badge) return false

  try {
    await Achievement.create({ user, key, value, earnedAt: new Date() })
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return false
    console.error('[achievements] could not award', key, error)
    return false
  }

  await notify({
    user,
    type: 'STREAK_MILESTONE',
    category: 'reading',
    title: badge.label,
    message: `${badge.earnedBy}. Nicely done.`,
    priority: 'low',
    actionRoute: '/profile',
    dedupeKey: `achievement:${key}:${String(user)}`,
  })

  return true
}

/* ------------------------------------------------------------- the checks */

/**
 * The reading badges, checked when a session ends.
 *
 * Called from the one place that already knows the streak just moved, rather
 * than from a nightly sweep that would have to recompute everybody's. The
 * event is where the knowledge is.
 */
export async function checkReadingBadges(user: Types.ObjectId | string): Promise<void> {
  try {
    const stats = await UserStats.findOne({ user }).lean()
    if (!stats) return

    if ((stats.currentStreak ?? 0) >= 7) await award(user, 'streak-7', stats.currentStreak)
    if ((stats.currentStreak ?? 0) >= 30) await award(user, 'streak-30', stats.currentStreak)
    if ((stats.totalMinutesRead ?? 0) >= 1000) {
      await award(user, 'minutes-1000', stats.totalMinutesRead)
    }
  } catch (error) {
    console.error('[achievements] reading check failed', error)
  }
}

/** The book badges, checked when one is marked finished. */
export async function checkBookBadges(user: Types.ObjectId | string): Promise<void> {
  try {
    const finished = await Book.countDocuments({ uploadedBy: user, status: 'completed' })
    if (finished >= 1) await award(user, 'books-1', finished)
    if (finished >= 10) await award(user, 'books-10', finished)
  } catch (error) {
    console.error('[achievements] book check failed', error)
  }
}

/** Checked when a note is written. */
export async function checkNoteBadges(user: Types.ObjectId | string): Promise<void> {
  try {
    // `createdBy`, not `user`. Mongoose does not type-check a query filter, so
    // the wrong field name here is a count that silently returns 0 forever and
    // a badge nobody can earn -- which the compiler is perfectly happy with.
    const notes = await Note.countDocuments({ createdBy: user })
    if (notes >= 25) await award(user, 'notes-25', notes)
  } catch (error) {
    console.error('[achievements] note check failed', error)
  }
}

/** Checked when a buddy pair is made, and when a shared read is finished. */
export async function checkBuddyBadges(user: Types.ObjectId | string): Promise<void> {
  try {
    const pairs = await Buddy.find({ users: user }).select('completedReads').lean()
    if (pairs.length >= 1) await award(user, 'first-buddy', pairs.length)

    const together = pairs.reduce((sum, pair) => sum + (pair.completedReads ?? 0), 0)
    if (together >= 1) await award(user, 'buddy-read-1', together)
  } catch (error) {
    console.error('[achievements] buddy check failed', error)
  }
}

/** Checked when a challenge is completed. */
export async function checkChallengeBadges(user: Types.ObjectId | string): Promise<void> {
  try {
    const done = await ChallengeParticipant.countDocuments({
      user,
      completedAt: { $exists: true },
    })
    if (done >= 1) await award(user, 'challenge-1', done)
  } catch (error) {
    console.error('[achievements] challenge check failed', error)
  }
}

/* --------------------------------------------------------------- reading */

export interface AchievementView {
  key: string
  label: string
  earnedBy: string
  category: AchievementCategory
  icon: string
  earnedAt: Date
  value?: number
}

/**
 * One reader's badges, newest first, joined to the catalogue.
 *
 * Only earned ones. A profile showing every badge with most of them greyed out
 * turns somebody else's page into a list of what they have not managed, which
 * is nobody's business and no fun to look at.
 *
 * A key with no catalogue entry is skipped rather than shown raw, so removing
 * a badge from the table retires it quietly instead of leaving `streak-7`
 * sitting on a profile.
 */
export async function achievementsFor(
  user: Types.ObjectId | string,
): Promise<AchievementView[]> {
  const rows = await Achievement.find({ user }).sort({ earnedAt: -1 }).lean()

  return rows.flatMap((row) => {
    const badge = BY_KEY.get(row.key)
    if (!badge) return []
    return [{ ...badge, earnedAt: row.earnedAt, value: row.value }]
  })
}

/**
 * The live figures a profile shows beside the badges.
 *
 * Derived every time, never stored: these are the "how are you doing now"
 * half, and a stored copy of them is a stale copy waiting to happen.
 */
export async function readingSummaryFor(user: Types.ObjectId | string) {
  const [stats, booksFinished] = await Promise.all([
    UserStats.findOne({ user }).lean(),
    Book.countDocuments({ uploadedBy: user, status: 'completed' }),
  ])

  return {
    currentStreak: stats?.currentStreak ?? 0,
    bestStreak: stats?.bestStreak ?? 0,
    totalMinutesRead: stats?.totalMinutesRead ?? 0,
    booksFinished,
  }
}
