import type { Request, Response } from 'express'
import { Types } from 'mongoose'

import Book from '../models/Books.js'
import Buddy, { pairKeyOf, pairUsers } from '../models/buddy.js'
import BuddyProfile, {
  BUDDY_PURPOSES,
  MAX_FAVOURITE_BOOKS,
  MAX_GENRES,
  READING_PACES,
  READING_TIMES,
} from '../models/buddyProfile.js'
import BuddyRequest from '../models/buddyRequest.js'
import User from '../models/User.js'
import UserBlock from '../models/userBlock.js'
import UserReport, {
  REPORT_REASONS,
  type ReportReason,
  type ReportSurface,
} from '../models/userReport.js'
import { limitsFor } from '../services/buddyLimits.js'
import { scoreMatch } from '../services/buddyMatching.js'
import { cancelPending, notify } from '../services/notification.service.js'

const errMessage = (error: unknown) => (error instanceof Error ? error.message : 'Unknown error')

/** Express types a route param as `string | string[]`; ours are always one. */
const param = (value: unknown): string => (Array.isArray(value) ? value[0] : String(value ?? ''))

const DISCOVER_POOL = 120
const DISCOVER_PAGE = 20

/* ------------------------------------------------------------------ shared */

/**
 * Everyone this reader should never be shown, in either direction.
 *
 * One query rather than two because the answer is one set, and every caller
 * wants it whole: a block hides the pair from each other, so which way round it
 * was made does not matter at the point of filtering.
 */
async function blockedIds(userId: string): Promise<Set<string>> {
  const blocks = await UserBlock.find({
    $or: [{ blocker: userId }, { blocked: userId }],
  })
    .select('blocker blocked')
    .lean()

  const ids = new Set<string>()
  for (const block of blocks) {
    ids.add(String(block.blocker))
    ids.add(String(block.blocked))
  }
  ids.delete(userId)
  return ids
}

interface PublicProfileSource {
  user: unknown
  bio?: string
  genres: string[]
  favouriteBooks: string[]
  currentBooks: unknown[]
  preferredTime: string
  pace: string
  monthlyGoal: number
  purpose: string
  school?: string
  lastActiveAt: Date
}

/**
 * The public shape of a buddy profile: what its owner chose to publish.
 *
 * Deliberately a whitelist rather than a redaction. The PRD's rule is that
 * discovery must not leak anything a reader did not put in their profile, and
 * the only way to keep that true as fields are added is for new fields to be
 * invisible until someone writes them in here.
 */
function publicProfile(
  profile: PublicProfileSource,
  user?: { _id?: unknown; username?: string; profilePicture?: string } | null,
) {
  return {
    user: {
      _id: String(user?._id ?? profile.user),
      username: user?.username ?? 'A reader',
      profilePicture: user?.profilePicture,
    },
    bio: profile.bio,
    genres: profile.genres,
    favouriteBooks: profile.favouriteBooks,
    preferredTime: profile.preferredTime,
    pace: profile.pace,
    monthlyGoal: profile.monthlyGoal,
    purpose: profile.purpose,
    school: profile.school,
    lastActiveAt: profile.lastActiveAt,
  }
}

/** Keep the profile's activity stamp honest without making the caller care. */
async function touch(userId: string) {
  await BuddyProfile.updateOne({ user: userId }, { $set: { lastActiveAt: new Date() } })
}

/** The vocabularies the form needs, so the client never hardcodes an enum. */
function optionLists() {
  return {
    readingTimes: READING_TIMES,
    paces: READING_PACES,
    purposes: BUDDY_PURPOSES,
    maxGenres: MAX_GENRES,
    maxFavouriteBooks: MAX_FAVOURITE_BOOKS,
  }
}

/* ----------------------------------------------------------------- profile */

export const getMyProfile = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const profile = await BuddyProfile.findOne({ user: req.user.id }).lean()
    const user = await User.findById(req.user.id).select('role').lean()
    const limits = limitsFor(user)

    if (!profile) {
      // Not an error: this is how "I have not joined Reading Buddy" is spelled.
      return res.json({ profile: null, limits, options: optionLists() })
    }

    const [activeBuddies, pendingRequests] = await Promise.all([
      Buddy.countDocuments({ users: req.user.id, status: 'active' }),
      BuddyRequest.countDocuments({ from: req.user.id, status: 'pending' }),
    ])

    return res.json({
      profile,
      limits,
      usage: { activeBuddies, pendingRequests },
      options: optionLists(),
    })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

export const saveMyProfile = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const body = req.body ?? {}
    const update: Record<string, unknown> = { lastActiveAt: new Date() }

    if (body.bio !== undefined) update.bio = String(body.bio).slice(0, 300)
    if (body.school !== undefined) update.school = String(body.school).slice(0, 120)

    if (Array.isArray(body.genres)) {
      update.genres = body.genres
        .map((genre: unknown) => String(genre).trim())
        .filter(Boolean)
        .slice(0, MAX_GENRES)
    }

    if (Array.isArray(body.favouriteBooks)) {
      update.favouriteBooks = body.favouriteBooks
        .map((title: unknown) => String(title).trim())
        .filter(Boolean)
        .slice(0, MAX_FAVOURITE_BOOKS)
    }

    if (Array.isArray(body.currentBooks)) {
      update.currentBooks = body.currentBooks
        .filter((id: unknown) => Types.ObjectId.isValid(String(id)))
        .slice(0, 20)
    }

    if (READING_TIMES.includes(body.preferredTime)) update.preferredTime = body.preferredTime
    if (READING_PACES.includes(body.pace)) update.pace = body.pace
    if (BUDDY_PURPOSES.includes(body.purpose)) update.purpose = body.purpose

    if (body.monthlyGoal !== undefined) {
      const goal = Number(body.monthlyGoal)
      if (Number.isFinite(goal)) update.monthlyGoal = Math.min(60, Math.max(1, Math.round(goal)))
    }

    if (body.discoverable !== undefined) update.discoverable = Boolean(body.discoverable)
    if (body.acceptingRequests !== undefined) {
      update.acceptingRequests = Boolean(body.acceptingRequests)
    }

    const profile = await BuddyProfile.findOneAndUpdate(
      { user: req.user.id },
      { $set: update, $setOnInsert: { user: req.user.id } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )

    return res.json(profile)
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/* --------------------------------------------------------------- discovery */

/**
 * Readers worth suggesting, scored and sorted.
 *
 * The pool is capped and scored in memory. Scoring in the database would need a
 * stored score for every pair of readers, kept fresh as either side edits their
 * profile -- a great deal of writing to support a list most people look at
 * once. Capping the pool keeps that honest: the cap is the thing to raise when
 * the user base grows, and the shape does not change.
 */
export const discoverBuddies = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const me = await BuddyProfile.findOne({ user: req.user.id }).lean()
    if (!me) {
      return res.status(409).json({
        message: 'Set up your Reading Buddy profile first',
        needsProfile: true,
      })
    }

    const filter = String(req.query.filter ?? 'recommended')
    const skip = Math.max(0, Number(req.query.skip) || 0)

    const excluded = await blockedIds(req.user.id)
    excluded.add(req.user.id)

    // Anyone already connected to me, or mid-conversation about it, is not a
    // recommendation -- they are already further along than that.
    const [pairs, requests] = await Promise.all([
      Buddy.find({ users: req.user.id, status: 'active' }).select('users').lean(),
      BuddyRequest.find({
        $or: [{ from: req.user.id }, { to: req.user.id }],
        status: 'pending',
      })
        .select('from to')
        .lean(),
    ])
    for (const pair of pairs) for (const id of pair.users) excluded.add(String(id))
    for (const request of requests) {
      excluded.add(String(request.from))
      excluded.add(String(request.to))
    }

    const query: Record<string, unknown> = {
      user: { $nin: [...excluded].map((id) => new Types.ObjectId(id)) },
      discoverable: true,
      acceptingRequests: true,
    }

    // The filters are narrowings of the same list, so they share one path.
    if (filter === 'same-book' && me.currentBooks?.length) {
      query.currentBooks = { $in: me.currentBooks }
    } else if (filter === 'same-goal') {
      query.monthlyGoal = { $gte: Math.max(1, me.monthlyGoal - 1), $lte: me.monthlyGoal + 1 }
    } else if (filter === 'same-genre' && me.genres?.length) {
      query.genres = { $in: me.genres }
    }

    const pool = await BuddyProfile.find(query)
      .sort({ lastActiveAt: -1 })
      .limit(DISCOVER_POOL)
      .lean()

    // Titles for the "you are both reading X" line, fetched once for the page.
    const bookIds = new Set<string>()
    for (const candidate of pool) {
      for (const id of candidate.currentBooks ?? []) {
        if ((me.currentBooks ?? []).some((mine) => String(mine) === String(id))) {
          bookIds.add(String(id))
        }
      }
    }
    const books = bookIds.size
      ? await Book.find({ _id: { $in: [...bookIds] } })
          .select('title')
          .lean()
      : []
    const titles = new Map(books.map((book) => [String(book._id), String(book.title)]))

    const users = await User.find({ _id: { $in: pool.map((entry) => entry.user) } })
      .select('username profilePicture')
      .lean()
    const byId = new Map(users.map((user) => [String(user._id), user]))

    const scored = pool
      .map((candidate) => {
        const match = scoreMatch(me, candidate, titles)
        return {
          ...publicProfile(candidate, byId.get(String(candidate.user))),
          match: {
            score: match.score,
            explanation: match.explanation,
            reasons: match.reasons,
            sharedGenres: match.sharedGenres,
          },
        }
      })
      .sort((a, b) => b.match.score - a.match.score)

    await touch(req.user.id)

    return res.json({
      results: scored.slice(skip, skip + DISCOVER_PAGE),
      total: scored.length,
      hasMore: skip + DISCOVER_PAGE < scored.length,
    })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/** One reader's public buddy profile, with why they were suggested. */
export const getBuddyProfile = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const userId = param(req.params.userId)
    if (!Types.ObjectId.isValid(userId)) {
      return res.status(404).json({ message: 'That reader could not be found' })
    }

    // A block hides both ways, and says nothing about why.
    const blocked = await blockedIds(req.user.id)
    if (blocked.has(userId)) {
      return res.status(404).json({ message: 'That reader could not be found' })
    }

    const profile = await BuddyProfile.findOne({ user: userId }).lean()
    if (!profile) return res.status(404).json({ message: 'That reader could not be found' })

    const [user, me, existingPair, pendingRequest] = await Promise.all([
      User.findById(userId).select('username profilePicture').lean(),
      BuddyProfile.findOne({ user: req.user.id }).lean(),
      Buddy.findOne({ pair: pairKeyOf(req.user.id, userId), status: 'active' }).lean(),
      BuddyRequest.findOne({
        $or: [
          { from: req.user.id, to: userId },
          { from: userId, to: req.user.id },
        ],
        status: 'pending',
      }).lean(),
    ])

    const match = me ? scoreMatch(me, profile) : null

    let relationship: Record<string, string> = { state: 'none' }
    if (existingPair) {
      relationship = { state: 'buddies', buddyId: String(existingPair._id) }
    } else if (pendingRequest) {
      relationship = {
        state: String(pendingRequest.from) === req.user.id ? 'request-sent' : 'request-received',
        requestId: String(pendingRequest._id),
      }
    }

    return res.json({
      ...publicProfile(profile, user),
      acceptingRequests: profile.acceptingRequests,
      match: match && {
        score: match.score,
        explanation: match.explanation,
        reasons: match.reasons,
      },
      relationship,
    })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/* ---------------------------------------------------------------- requests */

export const sendRequest = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const toId = param(req.params.userId)
    if (!Types.ObjectId.isValid(toId) || toId === req.user.id) {
      return res.status(400).json({ message: 'That is not someone you can ask' })
    }

    const blocked = await blockedIds(req.user.id)
    if (blocked.has(toId)) {
      return res.status(404).json({ message: 'That reader could not be found' })
    }

    const [me, them, user] = await Promise.all([
      BuddyProfile.findOne({ user: req.user.id }).lean(),
      BuddyProfile.findOne({ user: toId }).lean(),
      User.findById(req.user.id).select('username role').lean(),
    ])

    if (!me) {
      return res.status(409).json({
        message: 'Set up your Reading Buddy profile first',
        needsProfile: true,
      })
    }
    if (!them) return res.status(404).json({ message: 'That reader could not be found' })
    if (!them.acceptingRequests) {
      return res.status(409).json({ message: 'This reader is not taking new buddies right now' })
    }

    const limits = limitsFor(user)

    const [activeBuddies, pending, already] = await Promise.all([
      Buddy.countDocuments({ users: req.user.id, status: 'active' }),
      BuddyRequest.countDocuments({ from: req.user.id, status: 'pending' }),
      Buddy.findOne({ pair: pairKeyOf(req.user.id, toId), status: 'active' }).lean(),
    ])

    if (already) return res.status(409).json({ message: 'You are already buddies' })

    if (activeBuddies >= limits.activeBuddies) {
      return res.status(403).json({
        message:
          limits.tier === 'free'
            ? 'You can have one reading buddy at a time. End your current one to start another.'
            : 'You have reached your buddy limit.',
        limit: 'activeBuddies',
        limits,
      })
    }

    if (pending >= limits.pendingRequests) {
      return res.status(429).json({
        message: `You have ${pending} requests waiting for an answer. Give those a moment first.`,
        limit: 'pendingRequests',
        limits,
      })
    }

    const match = scoreMatch(me, them)

    // Two taps on Send arrive as two requests and both pass the checks above.
    // The partial unique index is what decides; losing it means the request is
    // already in flight, which is what the sender wanted either way.
    let request
    try {
      request = await BuddyRequest.create({
        from: req.user.id,
        to: toId,
        message: String(req.body?.message ?? '').slice(0, 300) || undefined,
        matchScore: match.score,
      })
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        const existing = await BuddyRequest.findOne({
          from: req.user.id,
          to: toId,
          status: 'pending',
        }).lean()
        return res.json({ message: 'Your request is already waiting for an answer', request: existing })
      }
      throw error
    }

    await notify({
      user: toId,
      type: 'BUDDY_REQUEST',
      category: 'buddies',
      title: 'New reading buddy request',
      message: `${user?.username ?? 'A reader'} would like to be your reading buddy.`,
      actionRoute: '/buddies/requests',
      actionId: String(request._id),
      dedupeKey: `buddy-request:${request._id}`,
    })

    await touch(req.user.id)

    return res.status(201).json(request)
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

export const listRequests = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const [incoming, outgoing] = await Promise.all([
      BuddyRequest.find({ to: req.user.id, status: 'pending' })
        .sort({ createdAt: -1 })
        .populate('from', 'username profilePicture')
        .lean(),
      BuddyRequest.find({ from: req.user.id, status: 'pending' })
        .sort({ createdAt: -1 })
        .populate('to', 'username profilePicture')
        .lean(),
    ])

    return res.json({ incoming, outgoing })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/**
 * Accept or decline a request.
 *
 * Accepting is the one place a buddy pair is created, so the limit is checked
 * again here rather than trusted from when the request was sent: a reader may
 * have filled their one slot in the time the request sat waiting.
 */
export const respondToRequest = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const requestId = param(req.params.requestId)
    const accept = Boolean(req.body?.accept)

    const request = await BuddyRequest.findOne({
      _id: requestId,
      to: req.user.id,
      status: 'pending',
    })
    if (!request) return res.status(404).json({ message: 'That request could not be found' })

    if (!accept) {
      request.status = 'declined'
      request.respondedAt = new Date()
      await request.save()
      // The sender is deliberately not told. A decline that arrives as a
      // notification is a rejection delivered twice.
      return res.json({ message: 'Request declined' })
    }

    const user = await User.findById(req.user.id).select('username role').lean()
    const limits = limitsFor(user)
    const activeBuddies = await Buddy.countDocuments({ users: req.user.id, status: 'active' })

    if (activeBuddies >= limits.activeBuddies) {
      return res.status(403).json({
        message:
          limits.tier === 'free'
            ? 'You already have a reading buddy. End that one first to accept this.'
            : 'You have reached your buddy limit.',
        limit: 'activeBuddies',
        limits,
      })
    }

    const senderId = String(request.from)
    const users = pairUsers(senderId, req.user.id)

    let buddy
    try {
      buddy = await Buddy.create({
        users,
        pair: pairKeyOf(senderId, req.user.id),
        startedAt: new Date(),
      })
    } catch (error) {
      // Both sides accepting at once, or a double tap. The pair exists either
      // way, which is what the caller was asking for.
      if ((error as { code?: number }).code === 11000) {
        buddy = await Buddy.findOne({ pair: pairKeyOf(senderId, req.user.id), status: 'active' })
      } else {
        throw error
      }
    }

    request.status = 'accepted'
    request.respondedAt = new Date()
    await request.save()

    await notify({
      user: senderId,
      type: 'BUDDY_REQUEST_ACCEPTED',
      category: 'buddies',
      title: 'You have a new reading buddy',
      message: `${user?.username ?? 'A reader'} accepted your request. Pick a book and set a goal together.`,
      actionRoute: '/buddies',
      actionId: String(buddy?._id ?? ''),
      dedupeKey: `buddy-accepted:${buddy?._id ?? requestId}`,
    })

    await touch(req.user.id)

    return res.status(201).json({ message: 'You are now buddies', buddy })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

export const cancelRequest = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const requestId = param(req.params.requestId)
    const request = await BuddyRequest.findOneAndUpdate(
      { _id: requestId, from: req.user.id, status: 'pending' },
      { $set: { status: 'cancelled', respondedAt: new Date() } },
      { new: true },
    )
    if (!request) return res.status(404).json({ message: 'That request could not be found' })

    // Take back the notification too, where it has not been sent yet. A request
    // that was withdrawn should not still be sitting in someone's list.
    await cancelPending(String(request.to), `buddy-request:${request._id}`)

    return res.json({ message: 'Request withdrawn' })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/* ------------------------------------------------------------- my buddies */

export const listMyBuddies = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const buddies = await Buddy.find({ users: req.user.id, status: 'active' })
      .sort({ lastMessageAt: -1, startedAt: -1 })
      .populate('users', 'username profilePicture')
      .populate('currentRead', 'bookTitle targetPage targetDate progress status')
      .lean()

    const shaped = buddies.map((buddy) => {
      const other = (buddy.users as unknown as { _id: Types.ObjectId; username?: string }[]).find(
        (user) => String(user._id) !== req.user!.id,
      )
      return {
        _id: String(buddy._id),
        buddy: other,
        startedAt: buddy.startedAt,
        lastMessageAt: buddy.lastMessageAt,
        completedReads: buddy.completedReads,
        currentRead: buddy.currentRead,
      }
    })

    const user = await User.findById(req.user.id).select('role').lean()

    return res.json({ buddies: shaped, limits: limitsFor(user) })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

export const endBuddy = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const buddyId = param(req.params.buddyId)
    const buddy = await Buddy.findOneAndUpdate(
      { _id: buddyId, users: req.user.id, status: 'active' },
      { $set: { status: 'ended', endedAt: new Date(), endedBy: req.user.id } },
      { new: true },
    )
    if (!buddy) return res.status(404).json({ message: 'That buddy could not be found' })

    return res.json({ message: 'Buddy removed' })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/* -------------------------------------------------------- safety and trust */

/**
 * Block someone.
 *
 * Blocking also ends whatever is live between the two: a block that leaves the
 * pair intact leaves the blocked reader able to post into a shared space, which
 * is exactly what the person blocking was trying to stop. Any pending request
 * in either direction goes with it.
 */
export const blockUser = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const userId = param(req.params.userId)
    if (!Types.ObjectId.isValid(userId) || userId === req.user.id) {
      return res.status(400).json({ message: 'That is not someone you can block' })
    }

    try {
      await UserBlock.create({
        blocker: req.user.id,
        blocked: userId,
        reason: String(req.body?.reason ?? '').slice(0, 300) || undefined,
      })
    } catch (error) {
      // Already blocked is the state the caller asked for.
      if ((error as { code?: number }).code !== 11000) throw error
    }

    await Promise.all([
      Buddy.updateOne(
        { pair: pairKeyOf(req.user.id, userId), status: 'active' },
        { $set: { status: 'ended', endedAt: new Date(), endedBy: req.user.id } },
      ),
      BuddyRequest.updateMany(
        {
          $or: [
            { from: req.user.id, to: userId },
            { from: userId, to: req.user.id },
          ],
          status: 'pending',
        },
        { $set: { status: 'cancelled', respondedAt: new Date() } },
      ),
    ])

    return res.json({ message: 'Blocked' })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

export const unblockUser = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    await UserBlock.deleteOne({ blocker: req.user.id, blocked: param(req.params.userId) })
    return res.json({ message: 'Unblocked' })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

export const listBlocked = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const blocks = await UserBlock.find({ blocker: req.user.id })
      .sort({ createdAt: -1 })
      .populate('blocked', 'username profilePicture')
      .lean()

    return res.json(blocks)
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

export const reportUser = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const userId = param(req.params.userId)
    if (!Types.ObjectId.isValid(userId) || userId === req.user.id) {
      return res.status(400).json({ message: 'That is not someone you can report' })
    }

    const reason = String(req.body?.reason ?? '') as ReportReason
    if (!REPORT_REASONS.includes(reason)) {
      return res.status(400).json({ message: 'Choose a reason for the report' })
    }

    const surfaces: ReportSurface[] = ['buddy-profile', 'buddy-message', 'buddy-space']
    const asked = String(req.body?.surface ?? 'buddy-profile') as ReportSurface
    const surface: ReportSurface = surfaces.includes(asked) ? asked : 'buddy-profile'

    try {
      await UserReport.create({
        reporter: req.user.id,
        reported: userId,
        surface,
        reason,
        details: String(req.body?.details ?? '').slice(0, 1000) || undefined,
        evidence: String(req.body?.evidence ?? '').slice(0, 2000) || undefined,
        sourceId: Types.ObjectId.isValid(String(req.body?.sourceId))
          ? String(req.body.sourceId)
          : undefined,
      })
    } catch (error) {
      // One open report per person per surface. A second tap is the same
      // complaint, and the reporter should be told it landed either way.
      if ((error as { code?: number }).code !== 11000) throw error
    }

    return res.status(201).json({
      message: 'Thank you. Our team will review this.',
    })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}
