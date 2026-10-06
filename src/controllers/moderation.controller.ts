import type { Request, Response } from 'express'
import { Types } from 'mongoose'

import Buddy from '../models/buddy.js'
import BuddyMessage from '../models/buddyMessage.js'
import BuddyProfile from '../models/buddyProfile.js'
import BuddyRequest from '../models/buddyRequest.js'
import User from '../models/User.js'
import UserReport from '../models/userReport.js'

/**
 * The moderation desk behind Reading Buddy.
 *
 * Section 24 of the PRD asks for somewhere an administrator can see what has
 * been reported and act on it. These routes sit behind the existing admin
 * guard, and are deliberately narrow: look at the queue, read one report with
 * enough context to judge it, and record a decision. Anything heavier --
 * suspending accounts, editing other people's words -- already belongs to the
 * admin area and is not duplicated here.
 */

const errMessage = (error: unknown) => (error instanceof Error ? error.message : 'Unknown error')
const param = (value: unknown): string => (Array.isArray(value) ? value[0] : String(value ?? ''))

const PAGE_SIZE = 30

/** The queue: open reports first and oldest first, because waiting is the cost. */
export const listReports = async (req: Request, res: Response) => {
  try {
    const status = String(req.query.status ?? 'open')
    const skip = Math.max(0, Number(req.query.skip) || 0)

    const query: Record<string, unknown> = {}
    if (status !== 'all') query.status = status

    const [reports, total, counts] = await Promise.all([
      UserReport.find(query)
        .sort({ status: 1, createdAt: 1 })
        .skip(skip)
        .limit(PAGE_SIZE)
        .populate('reporter', 'username email')
        .populate('reported', 'username email')
        .populate('reviewedBy', 'username')
        .lean(),
      UserReport.countDocuments(query),
      UserReport.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    ])

    return res.json({
      reports,
      total,
      hasMore: skip + PAGE_SIZE < total,
      counts: Object.fromEntries(counts.map((row) => [row._id, row.count])),
    })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/**
 * One report, with what an administrator needs to judge it.
 *
 * That includes everything else filed against the same person: a single
 * complaint is ambiguous, and three of them from different people usually are
 * not. The reported reader's buddy profile comes along too, since an
 * inappropriate profile is one of the things being reported.
 */
export const getReport = async (req: Request, res: Response) => {
  try {
    const report = await UserReport.findById(param(req.params.reportId))
      .populate('reporter', 'username email')
      .populate('reported', 'username email')
      .populate('reviewedBy', 'username')
      .lean()

    if (!report) return res.status(404).json({ message: 'That report could not be found' })

    const [history, profile] = await Promise.all([
      UserReport.find({ reported: report.reported, _id: { $ne: report._id } })
        .sort({ createdAt: -1 })
        .limit(20)
        .select('reason surface status createdAt')
        .lean(),
      BuddyProfile.findOne({ user: report.reported }).lean(),
    ])

    // The message itself, when it still exists. The report carries a snapshot
    // either way, so a withdrawn message does not leave the desk empty-handed.
    let message = null
    if (report.surface === 'buddy-message' && report.sourceId) {
      message = await BuddyMessage.findById(report.sourceId).lean()
    }

    return res.json({ report, history, profile, message })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/** Record a decision. The resolution is written in the administrator's words. */
export const decideReport = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const statuses = ['reviewing', 'actioned', 'dismissed']
    const status = String(req.body?.status ?? '')
    if (!statuses.includes(status)) {
      return res.status(400).json({ message: 'Say what was decided' })
    }

    const report = await UserReport.findByIdAndUpdate(
      param(req.params.reportId),
      {
        $set: {
          status,
          reviewedBy: req.user.id,
          reviewedAt: new Date(),
          resolution: String(req.body?.resolution ?? '').slice(0, 1000) || undefined,
        },
      },
      { new: true },
    )

    if (!report) return res.status(404).json({ message: 'That report could not be found' })

    return res.json(report)
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/** Adoption and engagement, as section 24 asks for. */
export const buddyOverview = async (_req: Request, res: Response) => {
  try {
    const weekAgo = new Date(Date.now() - 7 * 86400000)

    const [profiles, activePairs, endedPairs, pendingRequests, openReports, activeThisWeek, accepted, sent] =
      await Promise.all([
        BuddyProfile.countDocuments({}),
        Buddy.countDocuments({ status: 'active' }),
        Buddy.countDocuments({ status: 'ended' }),
        BuddyRequest.countDocuments({ status: 'pending' }),
        UserReport.countDocuments({ status: 'open' }),
        Buddy.countDocuments({ status: 'active', lastMessageAt: { $gte: weekAgo } }),
        BuddyRequest.countDocuments({ status: 'accepted' }),
        BuddyRequest.countDocuments({}),
      ])

    return res.json({
      profiles,
      activePairs,
      endedPairs,
      pendingRequests,
      openReports,
      activeThisWeek,
      // The headline number from section 4: do requests actually turn into pairs?
      acceptanceRate: sent > 0 ? Math.round((accepted / sent) * 100) : 0,
    })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/** Live pairs, for an administrator looking into a specific complaint. */
export const listBuddyPairs = async (req: Request, res: Response) => {
  try {
    const skip = Math.max(0, Number(req.query.skip) || 0)
    const query: Record<string, unknown> = { status: String(req.query.status ?? 'active') }

    const userId = String(req.query.user ?? '')
    if (Types.ObjectId.isValid(userId)) query.users = userId

    const [pairs, total] = await Promise.all([
      Buddy.find(query)
        .sort({ startedAt: -1 })
        .skip(skip)
        .limit(PAGE_SIZE)
        .populate('users', 'username email')
        .populate('currentRead', 'bookTitle status')
        .lean(),
      Buddy.countDocuments(query),
    ])

    return res.json({ pairs, total, hasMore: skip + PAGE_SIZE < total })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/**
 * Hide a buddy profile from discovery.
 *
 * The lightest action that actually stops the harm being reported: the profile
 * stops being shown to anyone, the account keeps working, and nothing is
 * deleted. Heavier measures live in the admin area.
 */
export const hideBuddyProfile = async (req: Request, res: Response) => {
  try {
    const userId = param(req.params.userId)
    if (!Types.ObjectId.isValid(userId)) {
      return res.status(404).json({ message: 'That reader could not be found' })
    }

    const profile = await BuddyProfile.findOneAndUpdate(
      { user: userId },
      { $set: { discoverable: false, acceptingRequests: false } },
      { new: true },
    )
    if (!profile) return res.status(404).json({ message: 'That reader has no buddy profile' })

    const user = await User.findById(userId).select('username').lean()

    return res.json({
      message: `${user?.username ?? 'That reader'} has been taken out of Reading Buddy discovery`,
      profile,
    })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}
