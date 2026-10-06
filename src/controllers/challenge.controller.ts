import type { Request, Response } from 'express'
import { Types } from 'mongoose'

import Challenge from '../models/challenge.js'
import ChallengeParticipant from '../models/challengeParticipant.js'
import CommunityMember, { can } from '../models/communityMember.js'
import ReadingSession from '../models/readingSession.js'
import User from '../models/User.js'
import { dateStampIn } from '../services/notification.service.js'
import { notifyMany } from '../services/notification.service.js'
import { recordActivity } from './community.controller.js'

/**
 * Reading challenges inside a community.
 *
 * Progress is derived from reading sessions rather than self-reported, so a
 * challenge cannot be won by pressing a button. `recomputeProgress` is the only
 * writer of a participant's figures, and it is idempotent -- running it twice
 * for the same day counts that day once, which is what makes it safe to call on
 * every read.
 */

const errMessage = (error: unknown) => (error instanceof Error ? error.message : 'Unknown error')

const param = (value: unknown): string => (Array.isArray(value) ? value[0] : String(value ?? ''))

async function membershipOf(communityId: string, userId: string) {
  return CommunityMember.findOne({ community: communityId, user: userId }).lean()
}

export const listChallenges = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const communityId = param(req.params.communityId)
    const membership = await membershipOf(communityId, req.user.id)
    if (!membership) return res.status(404).json({ message: 'Community not found' })

    const challenges = await Challenge.find({ community: communityId })
      .sort({ endsAt: -1 })
      .limit(40)
      .lean()

    const mine = await ChallengeParticipant.find({
      user: req.user.id,
      challenge: { $in: challenges.map((c) => c._id) },
    }).lean()

    const joined = new Map(mine.map((p) => [String(p.challenge), p]))
    const now = new Date()

    return res.json(
      challenges.map((challenge) => ({
        ...challenge,
        active: challenge.startsAt <= now && challenge.endsAt >= now,
        joined: joined.has(String(challenge._id)),
        myProgress: joined.get(String(challenge._id)) ?? null,
      })),
    )
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

export const createChallenge = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const communityId = param(req.params.communityId)
    const membership = await membershipOf(communityId, req.user.id)
    if (!membership) return res.status(404).json({ message: 'Community not found' })
    if (!can(membership.role, 'createChallenge')) {
      return res.status(403).json({ message: 'You do not have permission to do that' })
    }

    const { title, description, goal, target, startsAt, endsAt } = req.body
    if (!title || !target || !startsAt || !endsAt) {
      return res.status(400).json({ message: 'A challenge needs a title, a target and dates' })
    }

    const start = new Date(startsAt)
    const end = new Date(endsAt)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return res.status(400).json({ message: 'The end date must come after the start date' })
    }

    const challenge = await Challenge.create({
      community: communityId,
      title: String(title).trim(),
      description,
      goal: goal ?? 'read-daily',
      target: Number(target),
      startsAt: start,
      endsAt: end,
      createdBy: req.user.id,
    })

    const members = await CommunityMember.find({ community: communityId }).select('user').lean()
    await notifyMany(
      members.map((m) => m.user).filter((user) => String(user) !== req.user!.id),
      {
        type: 'COMMUNITY_ANNOUNCEMENT',
        category: 'challenges',
        title: 'New challenge',
        message: String(title).trim(),
        actionRoute: 'community-challenges',
        actionId: String(communityId),
        dedupeKey: `challenge:${challenge._id}`,
      },
    )

    return res.status(201).json(challenge)
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

export const joinChallenge = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const communityId = param(req.params.communityId)
    const challengeId = param(req.params.challengeId)

    const membership = await membershipOf(communityId, req.user.id)
    if (!membership) return res.status(404).json({ message: 'Community not found' })

    const challenge = await Challenge.findOne({ _id: challengeId, community: communityId })
    if (!challenge) return res.status(404).json({ message: 'No such challenge' })
    if (challenge.endsAt < new Date()) {
      return res.status(409).json({ message: 'That challenge has already finished' })
    }

    const existing = await ChallengeParticipant.findOne({
      challenge: challengeId,
      user: req.user.id,
    })
    if (existing) return res.json(existing)

    // Same race as joining a community: the unique index decides, and losing
    // it means someone already joined on this caller's behalf.
    let participant
    try {
      participant = await ChallengeParticipant.create({
        challenge: challengeId,
        community: communityId,
        user: req.user.id,
      })
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        const already = await ChallengeParticipant.findOne({
          challenge: challengeId,
          user: req.user.id,
        })
        return res.json(already)
      }
      throw error
    }

    await Challenge.updateOne({ _id: challengeId }, { $inc: { participantCount: 1 } })

    const user = await User.findById(req.user.id).select('username').lean()
    await recordActivity({
      community: communityId,
      actor: req.user.id,
      actorName: user?.username ?? 'A reader',
      type: 'CHALLENGE_JOINED',
      subject: challenge.title,
      targetRoute: 'community-challenges',
      targetId: communityId,
    })

    return res.status(201).json(participant)
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

export const leaveChallenge = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const challengeId = param(req.params.challengeId)
    const removed = await ChallengeParticipant.findOneAndDelete({
      challenge: challengeId,
      user: req.user.id,
    })
    if (removed) await Challenge.updateOne({ _id: challengeId }, { $inc: { participantCount: -1 } })

    return res.json({ message: 'You have left the challenge' })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/**
 * The board for one challenge.
 *
 * Recomputed from reading sessions before it is shown, so the figures are what
 * people actually did rather than what was last written down. Bounded to the
 * participants being displayed.
 */
export const getChallengeBoard = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const communityId = param(req.params.communityId)
    const challengeId = param(req.params.challengeId)

    const membership = await membershipOf(communityId, req.user.id)
    if (!membership) return res.status(404).json({ message: 'Community not found' })

    const challenge = await Challenge.findOne({ _id: challengeId, community: communityId }).lean()
    if (!challenge) return res.status(404).json({ message: 'No such challenge' })

    const participants = await ChallengeParticipant.find({ challenge: challengeId })
      .limit(100)
      .populate<{ user: { _id: unknown; username?: string } }>('user', 'username')
      .lean()

    await Promise.all(
      participants.map(async (participant) => {
        const fresh = await recomputeProgress(
          String(participant.user?._id ?? participant.user),
          challenge.startsAt,
          challenge.endsAt,
        )
        Object.assign(participant, fresh)
        await ChallengeParticipant.updateOne({ _id: participant._id }, { $set: fresh })
      }),
    )

    // Consistency first, as the PRD asks -- days read, not pages turned.
    participants.sort(
      (a, b) => b.daysActive.length - a.daysActive.length || b.minutesRead - a.minutesRead,
    )

    return res.json({ challenge, participants })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/**
 * What one person has actually done inside the window.
 *
 * Days are counted as distinct date stamps rather than session rows, so two
 * sittings in one evening are one day -- which is what a daily challenge means.
 */
async function recomputeProgress(userId: string, from: Date, to: Date) {
  const sessions = await ReadingSession.find({
    user: userId,
    endTime: { $gte: from, $lte: to },
  })
    .select('startTime endTime pagesRead')
    .lean()

  const days = new Set<string>()
  let minutes = 0
  let pages = 0

  for (const session of sessions) {
    const end = session.endTime ? new Date(session.endTime) : null
    if (!end) continue
    days.add(dateStampIn('Africa/Lagos', end))
    if (session.startTime) {
      minutes += Math.max(0, (end.getTime() - new Date(session.startTime).getTime()) / 60000)
    }
    pages += session.pagesRead ?? 0
  }

  return {
    daysActive: [...days],
    minutesRead: Math.round(minutes),
    pagesRead: pages,
  }
}
