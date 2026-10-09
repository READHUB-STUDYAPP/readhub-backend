import crypto from 'crypto'
import type { Request, Response } from 'express'
import { isValidObjectId, Types } from 'mongoose'

import Announcement from '../models/announcement.js'
import Community, { INVITE_CODE_LENGTH } from '../models/community.js'
import CommunityActivity, {
  ACTIVITY_TTL_DAYS,
  type ActivityType,
} from '../models/communityActivity.js'
import Challenge from '../models/challenge.js'
import ChallengeParticipant from '../models/challengeParticipant.js'
import CommunityJoinRequest from '../models/communityJoinRequest.js'
import CommunityMember, {
  can,
  type CommunityPermission,
  type CommunityRole,
} from '../models/communityMember.js'
import ReadingGroup from '../models/readingGroup.js'
import User from '../models/User.js'
import { notifyMany } from '../services/notification.service.js'

/**
 * Communities: the umbrella a set of reading groups belongs to.
 *
 * Two rules shape most of what follows.
 *
 *   Membership is checked, not assumed.  Every read of a private community
 *                                        starts by resolving the caller's
 *                                        membership, because visibility and
 *                                        permission are different questions and
 *                                        both have to be answered.
 *   Counts are denormalised, not joined.  `memberCount` and `groupCount` live
 *                                        on the community so the list screen is
 *                                        one query. They are display figures;
 *                                        `communityMember` remains the truth.
 */

const errMessage = (error: unknown) => (error instanceof Error ? error.message : 'Unknown error')

/** Express types a route param as `string | string[]`; ours are always one. */
const param = (value: unknown): string => (Array.isArray(value) ? value[0] : String(value ?? ''))

const PAGE_SIZE = 30

/** Unambiguous in speech and on a poster: no O/0, no I/1. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function newInviteCode(): string {
  const bytes = crypto.randomBytes(INVITE_CODE_LENGTH)
  let code = ''
  for (let i = 0; i < INVITE_CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  }
  return code
}

/** The caller's membership, or null when they are not in it. */
async function membershipOf(communityId: string, userId: string) {
  return CommunityMember.findOne({ community: communityId, user: userId }).lean()
}

/** Guard used by every write: resolves membership and checks the capability. */
async function requirePermission(
  communityId: string,
  userId: string,
  permission: CommunityPermission,
): Promise<{ ok: true; role: CommunityRole } | { ok: false; status: number; message: string }> {
  const membership = await membershipOf(communityId, userId)
  if (!membership) return { ok: false, status: 404, message: 'Community not found' }
  if (!can(membership.role, permission)) {
    return { ok: false, status: 403, message: 'You do not have permission to do that' }
  }
  return { ok: true, role: membership.role }
}

/** Append to the Activities tab. Never allowed to fail a request. */
export async function recordActivity(input: {
  community: Types.ObjectId | string
  actor?: Types.ObjectId | string
  actorName: string
  type: ActivityType
  subject?: string
  targetRoute?: string
  targetId?: string
}): Promise<void> {
  try {
    await CommunityActivity.create({
      ...input,
      expiresAt: new Date(Date.now() + ACTIVITY_TTL_DAYS * 86400000),
    })
  } catch (error) {
    console.error('[community] activity not recorded', error)
  }
}

/* -------------------------------------------------------------- creation */

export const createCommunity = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const { name, description, logoUrl, category, visibility, joinPolicy } = req.body
    if (!name || String(name).trim().length === 0) {
      return res.status(400).json({ message: 'A community needs a name' })
    }

    const community = await Community.create({
      name: String(name).trim(),
      description,
      logoUrl,
      category: category ?? 'other',
      visibility: visibility ?? 'private',
      joinPolicy: joinPolicy ?? 'open',
      createdBy: req.user.id,
      inviteCode: newInviteCode(),
      memberCount: 1,
    })

    // The creator is the owner. Written separately rather than embedded,
    // because membership is its own collection.
    await CommunityMember.create({
      community: community._id,
      user: req.user.id,
      role: 'owner',
    })

    return res.status(201).json(community)
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/* ------------------------------------------------------------- listing */

/** The reader's own communities, for "My Communities". */
export const listMyCommunities = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const memberships = await CommunityMember.find({ user: req.user.id })
      .sort({ updatedAt: -1 })
      .limit(PAGE_SIZE)
      .lean()

    if (memberships.length === 0) return res.json([])

    const communities = await Community.find({
      _id: { $in: memberships.map((m) => m.community) },
    }).lean()

    const roleOf = new Map(memberships.map((m) => [String(m.community), m.role]))

    // Ordered by the membership list, so "most recently active" holds.
    const ordered = memberships
      .map((m) => communities.find((c) => String(c._id) === String(m.community)))
      .filter(Boolean)
      .map((community) => ({ ...community, myRole: roleOf.get(String(community!._id)) }))

    return res.json(ordered)
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/**
 * Public communities the reader is not already in.
 *
 * Backs "Discover Communities", including its category pills and search box.
 */
export const discoverCommunities = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const { q, category } = req.query
    const mine = await CommunityMember.find({ user: req.user.id }).select('community').lean()

    const filter: Record<string, unknown> = {
      visibility: 'public',
      _id: { $nin: mine.map((m) => m.community) },
    }
    if (category && category !== 'all') filter.category = category
    if (q && String(q).trim()) filter.$text = { $search: String(q).trim() }

    const communities = await Community.find(filter)
      .sort({ memberCount: -1 })
      .limit(PAGE_SIZE)
      .lean()

    return res.json(communities)
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/* ---------------------------------------------------------------- detail */

export const getCommunity = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const communityId = param(req.params.communityId)
    if (!isValidObjectId(communityId)) {
      return res.status(400).json({ message: 'Invalid community id' })
    }

    const community = await Community.findById(communityId).lean()
    if (!community) return res.status(404).json({ message: 'Community not found' })

    const membership = await membershipOf(communityId, req.user.id)

    // A hidden community does not exist to anyone outside it, and a private one
    // shows only enough to decide whether to join.
    if (!membership && community.visibility === 'hidden') {
      return res.status(404).json({ message: 'Community not found' })
    }

    return res.json({
      ...community,
      myRole: membership?.role ?? null,
      isMember: Boolean(membership),
      // The invite code is a key, so it goes only to people who may invite.
      inviteCode: can(membership?.role, 'inviteMembers') ? community.inviteCode : undefined,
    })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

export const updateCommunity = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const communityId = param(req.params.communityId)
    const allowed = await requirePermission(communityId, req.user.id, 'editCommunity')
    if (!allowed.ok) return res.status(allowed.status).json({ message: allowed.message })

    const fields = [
      'name',
      'description',
      'logoUrl',
      'coverUrl',
      'category',
      'visibility',
      'joinPolicy',
      'postPolicy',
      'membersVisible',
    ]
    const update: Record<string, unknown> = {}
    for (const field of fields) {
      if (req.body[field] !== undefined) update[field] = req.body[field]
    }

    const community = await Community.findByIdAndUpdate(communityId, { $set: update }, { new: true })
    return res.json(community)
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/* --------------------------------------------------------------- joining */

export const joinCommunity = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const code = String(req.body?.code ?? '').trim().toUpperCase()
    const communityId = param(req.params.communityId)

    const community = code
      ? await Community.findOne({ inviteCode: code })
      : await Community.findById(communityId)

    if (!community) return res.status(404).json({ message: 'That community could not be found' })

    const existing = await membershipOf(String(community._id), req.user.id)
    if (existing) return res.json({ message: 'Already a member', community })

    // Invite-only means the code is the invitation; without one, ask.
    if (community.joinPolicy === 'invite' && !code) {
      return res.status(403).json({ message: 'This community is invitation only' })
    }

    if (community.joinPolicy === 'approval' && !code) {
      await CommunityJoinRequest.findOneAndUpdate(
        { community: community._id, user: req.user.id, status: 'pending' },
        { $setOnInsert: { community: community._id, user: req.user.id, status: 'pending' } },
        { upsert: true, new: true },
      )
      return res.status(202).json({ message: 'Your request has been sent to the admins' })
    }

    // Two joins can race -- a double-tapped button, a retried request, or a
    // client effect that fires twice -- and both would pass the membership
    // check above before either had written. The unique index on
    // {community, user} is what actually decides, so a duplicate here means
    // the other one won and this caller is already in. That is a success for
    // them, not an error.
    try {
      await CommunityMember.create({ community: community._id, user: req.user.id, role: 'member' })
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        return res.json({ message: 'Already a member', community })
      }
      throw error
    }

    await Community.updateOne({ _id: community._id }, { $inc: { memberCount: 1 } })

    const user = await User.findById(req.user.id).select('username').lean()
    await recordActivity({
      community: community._id,
      actor: req.user.id,
      actorName: user?.username ?? 'A reader',
      type: 'MEMBER_JOINED',
    })

    return res.status(201).json({ message: 'Welcome', community })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

export const leaveCommunity = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const communityId = param(req.params.communityId)
    const membership = await membershipOf(communityId, req.user.id)
    if (!membership) return res.status(404).json({ message: 'Community not found' })

    // The last owner cannot simply walk out and leave it unadministered.
    if (membership.role === 'owner') {
      const owners = await CommunityMember.countDocuments({ community: communityId, role: 'owner' })
      if (owners <= 1) {
        return res.status(409).json({
          message: 'You are the only owner. Make someone else an owner first, or delete the community.',
        })
      }
    }

    await CommunityMember.deleteOne({ _id: membership._id })
    await Community.updateOne({ _id: communityId }, { $inc: { memberCount: -1 } })

    return res.json({ message: 'You have left the community' })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/**
 * Delete a community.
 *
 * The permission ladder has promised this since communities were built --
 * `deleteCommunity: RANK.owner` -- with nothing wired to it, so the only way
 * to get rid of one was to make it private and leave it there. That is not the
 * same thing, and it has meant abandoned communities accumulating where
 * readers can still stumble into them by invite code.
 *
 * What goes, and what does not:
 *
 *   Goes.  The community, its memberships, announcements, challenges and the
 *          participation in them, join requests, and the activity feed. None
 *          of it means anything without the community above it.
 *   Stays. The reading groups. A group has its own members, its own books and
 *          its own conversation; the community is an umbrella over it, and
 *          taking the umbrella away must not destroy what was under it. They
 *          are detached and carry on as standalone groups, which is exactly
 *          what they were before communities existed.
 *
 * The caller must send the community's name back. This is irreversible and
 * takes a lot with it, and an owner who has typed the name is an owner who
 * meant this one rather than the one above it in a list.
 */
export const deleteCommunity = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const communityId = param(req.params.communityId)
    const allowed = await requirePermission(communityId, req.user.id, 'deleteCommunity')
    if (!allowed.ok) return res.status(allowed.status).json({ message: allowed.message })

    const community = await Community.findById(communityId).lean()
    if (!community) return res.status(404).json({ message: 'Community not found' })

    const confirm = String(req.body?.confirm ?? '').trim()
    if (confirm !== community.name) {
      return res.status(400).json({
        message: 'Type the community name to confirm. This cannot be undone.',
      })
    }

    // Groups first, and detached rather than deleted -- if anything below
    // fails, the worst outcome is a group that briefly has no community, not a
    // group that is gone.
    const detached = await ReadingGroup.updateMany(
      { community: communityId },
      { $unset: { community: '' } },
    )

    const [members, announcements, challenges, participants, requests, activity] =
      await Promise.all([
        CommunityMember.deleteMany({ community: communityId }),
        Announcement.deleteMany({ community: communityId }),
        Challenge.deleteMany({ community: communityId }),
        ChallengeParticipant.deleteMany({ community: communityId }),
        CommunityJoinRequest.deleteMany({ community: communityId }),
        CommunityActivity.deleteMany({ community: communityId }),
      ])

    await Community.deleteOne({ _id: communityId })

    return res.json({
      message: `${community.name} has been deleted`,
      removed: {
        members: members.deletedCount ?? 0,
        announcements: announcements.deletedCount ?? 0,
        challenges: challenges.deletedCount ?? 0,
        challengeParticipants: participants.deletedCount ?? 0,
        joinRequests: requests.deletedCount ?? 0,
        activity: activity.deletedCount ?? 0,
      },
      groupsDetached: detached.modifiedCount ?? 0,
    })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/* --------------------------------------------------------------- members */

export const listMembers = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const communityId = param(req.params.communityId)
    const membership = await membershipOf(communityId, req.user.id)
    if (!membership) return res.status(404).json({ message: 'Community not found' })

    const community = await Community.findById(communityId).select('membersVisible').lean()
    if (!community) return res.status(404).json({ message: 'Community not found' })

    // A community may hide its roll from ordinary members.
    if (!community.membersVisible && !can(membership.role, 'manageMembers')) {
      return res.status(403).json({ message: 'The member list is not public in this community' })
    }

    const { q } = req.query
    const members = await CommunityMember.find({ community: communityId })
      .sort({ role: 1, joinedAt: 1 })
      .limit(200)
      .populate<{ user: { _id: unknown; username?: string; email?: string } }>('user', 'username')
      .lean()

    const search = String(q ?? '').trim().toLowerCase()
    const filtered = search
      ? members.filter((m) => (m.user?.username ?? '').toLowerCase().includes(search))
      : members

    return res.json(
      filtered.map((m) => ({
        _id: m._id,
        user: m.user,
        role: m.role,
        joinedAt: m.joinedAt,
      })),
    )
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

export const setMemberRole = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const communityId = param(req.params.communityId)
    const userId = param(req.params.userId)
    const role = req.body?.role as CommunityRole

    if (!['owner', 'admin', 'moderator', 'member'].includes(role)) {
      return res.status(400).json({ message: 'Unknown role' })
    }

    const allowed = await requirePermission(communityId, req.user.id, 'assignRoles')
    if (!allowed.ok) return res.status(allowed.status).json({ message: allowed.message })

    const target = await CommunityMember.findOneAndUpdate(
      { community: communityId, user: userId },
      { $set: { role } },
      { new: true },
    )
    if (!target) return res.status(404).json({ message: 'That person is not a member' })

    return res.json(target)
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

export const removeMember = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const communityId = param(req.params.communityId)
    const userId = param(req.params.userId)
    const allowed = await requirePermission(communityId, req.user.id, 'manageMembers')
    if (!allowed.ok) return res.status(allowed.status).json({ message: allowed.message })

    const target = await CommunityMember.findOne({ community: communityId, user: userId })
    if (!target) return res.status(404).json({ message: 'That person is not a member' })
    if (target.role === 'owner') {
      return res.status(403).json({ message: 'An owner cannot be removed' })
    }

    await CommunityMember.deleteOne({ _id: target._id })
    await Community.updateOne({ _id: communityId }, { $inc: { memberCount: -1 } })

    return res.json({ message: 'Member removed' })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/* --------------------------------------------------------- join requests */

export const listJoinRequests = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const communityId = param(req.params.communityId)
    const allowed = await requirePermission(communityId, req.user.id, 'manageMembers')
    if (!allowed.ok) return res.status(allowed.status).json({ message: allowed.message })

    const requests = await CommunityJoinRequest.find({ community: communityId, status: 'pending' })
      .sort({ createdAt: -1 })
      .populate('user', 'username')
      .lean()

    return res.json(requests)
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

export const decideJoinRequest = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const communityId = param(req.params.communityId)
    const requestId = param(req.params.requestId)
    const approve = req.body?.approve === true

    const allowed = await requirePermission(communityId, req.user.id, 'manageMembers')
    if (!allowed.ok) return res.status(allowed.status).json({ message: allowed.message })

    const request = await CommunityJoinRequest.findOne({
      _id: requestId,
      community: communityId,
      status: 'pending',
    })
    if (!request) return res.status(404).json({ message: 'No such request' })

    request.status = approve ? 'approved' : 'declined'
    request.decidedBy = new Types.ObjectId(req.user.id)
    request.decidedAt = new Date()
    await request.save()

    if (approve) {
      await CommunityMember.updateOne(
        { community: communityId, user: request.user },
        { $setOnInsert: { community: communityId, user: request.user, role: 'member' } },
        { upsert: true },
      )
      await Community.updateOne({ _id: communityId }, { $inc: { memberCount: 1 } })

      const community = await Community.findById(communityId).select('name').lean()
      await notifyMany([request.user], {
        type: 'COMMUNITY_JOIN_APPROVED',
        category: 'community',
        title: 'You are in',
        message: `Your request to join ${community?.name ?? 'the community'} was approved.`,
        actionRoute: 'community',
        actionId: String(communityId),
      })
    }

    return res.json(request)
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/* --------------------------------------------------------------- invites */

export const rotateInviteCode = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const communityId = param(req.params.communityId)
    const allowed = await requirePermission(communityId, req.user.id, 'editCommunity')
    if (!allowed.ok) return res.status(allowed.status).json({ message: allowed.message })

    const community = await Community.findByIdAndUpdate(
      communityId,
      { $set: { inviteCode: newInviteCode() } },
      { new: true },
    )
    return res.json({ inviteCode: community?.inviteCode })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/* -------------------------------------------------------------- activity */

export const listActivity = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const communityId = param(req.params.communityId)
    const membership = await membershipOf(communityId, req.user.id)
    if (!membership) return res.status(404).json({ message: 'Community not found' })

    const activity = await CommunityActivity.find({ community: communityId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean()

    return res.json(activity)
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/* ---------------------------------------------------------------- groups */

/** The reading groups inside a community, with the caller's membership. */
export const listCommunityGroups = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const communityId = param(req.params.communityId)
    const membership = await membershipOf(communityId, req.user.id)
    if (!membership) return res.status(404).json({ message: 'Community not found' })

    const groups = await ReadingGroup.find({ community: communityId })
      .sort({ updatedAt: -1 })
      .lean()

    return res.json(
      groups.map((group) => ({
        _id: group._id,
        name: group.name,
        description: group.description,
        memberCount: group.members?.length ?? 0,
        bookCount: group.books?.length ?? 0,
        joined: (group.members ?? []).some((m) => String(m.user) === req.user!.id),
      })),
    )
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/* --------------------------------------------------------- announcements */

export const listAnnouncements = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const communityId = param(req.params.communityId)
    const membership = await membershipOf(communityId, req.user.id)
    if (!membership) return res.status(404).json({ message: 'Community not found' })

    const announcements = await Announcement.find({
      community: communityId,
      deletedAt: { $exists: false },
    })
      .sort({ pinned: -1, createdAt: -1 })
      .limit(PAGE_SIZE)
      .lean()

    return res.json(
      announcements.map((announcement) => ({
        ...announcement,
        // Reactions are returned as counts plus whether the caller is in them,
        // rather than the whole list of who reacted.
        reactions: summariseReactions(announcement.reactions ?? [], req.user!.id),
      })),
    )
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

function summariseReactions(
  reactions: { user: unknown; emoji: string }[],
  callerId: string,
): { emoji: string; count: number; mine: boolean }[] {
  const byEmoji = new Map<string, { count: number; mine: boolean }>()
  for (const reaction of reactions) {
    const entry = byEmoji.get(reaction.emoji) ?? { count: 0, mine: false }
    entry.count += 1
    if (String(reaction.user) === callerId) entry.mine = true
    byEmoji.set(reaction.emoji, entry)
  }
  return [...byEmoji.entries()].map(([emoji, value]) => ({ emoji, ...value }))
}

export const createAnnouncement = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const communityId = param(req.params.communityId)
    const { title, body, pinned, repliesEnabled } = req.body

    if (!title || !body) return res.status(400).json({ message: 'A title and a message are required' })

    const allowed = await requirePermission(communityId, req.user.id, 'postAnnouncement')
    if (!allowed.ok) return res.status(allowed.status).json({ message: allowed.message })

    const author = await User.findById(req.user.id).select('username').lean()
    const announcement = await Announcement.create({
      community: communityId,
      author: req.user.id,
      authorName: author?.username ?? 'Admin',
      title: String(title).trim(),
      body: String(body),
      pinned: pinned === true,
      repliesEnabled: repliesEnabled !== false,
    })

    // Everyone hears about it, except the person who wrote it.
    const members = await CommunityMember.find({ community: communityId })
      .select('user')
      .lean()
    const community = await Community.findById(communityId).select('name').lean()

    await notifyMany(
      members.map((m) => m.user).filter((user) => String(user) !== req.user!.id),
      {
        type: 'COMMUNITY_ANNOUNCEMENT',
        category: 'community',
        title: community?.name ?? 'Community announcement',
        message: String(title).trim(),
        actionRoute: 'community-announcements',
        actionId: String(communityId),
        dedupeKey: `announcement:${announcement._id}`,
      },
    )

    await recordActivity({
      community: communityId,
      actor: req.user.id,
      actorName: author?.username ?? 'Admin',
      type: 'ANNOUNCEMENT_POSTED',
      subject: String(title).trim(),
      targetRoute: 'community-announcements',
      targetId: String(communityId),
    })

    return res.status(201).json(announcement)
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

export const reactToAnnouncement = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const communityId = param(req.params.communityId)
    const announcementId = param(req.params.announcementId)
    const emoji = String(req.body?.emoji ?? '').trim()
    if (!emoji) return res.status(400).json({ message: 'Which reaction?' })

    const membership = await membershipOf(communityId, req.user.id)
    if (!membership) return res.status(404).json({ message: 'Community not found' })

    const announcement = await Announcement.findOne({ _id: announcementId, community: communityId })
    if (!announcement) return res.status(404).json({ message: 'No such announcement' })

    // Reacting again with the same emoji takes it back, which is what tapping
    // an already-lit reaction means everywhere else.
    const mine = announcement.reactions.findIndex(
      (reaction) => String(reaction.user) === req.user!.id && reaction.emoji === emoji,
    )
    if (mine >= 0) announcement.reactions.splice(mine, 1)
    else announcement.reactions.push({ user: new Types.ObjectId(req.user.id), emoji, at: new Date() })

    await announcement.save()
    return res.json({ reactions: summariseReactions(announcement.reactions, req.user.id) })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

export const deleteAnnouncement = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const communityId = param(req.params.communityId)
    const announcementId = param(req.params.announcementId)
    const allowed = await requirePermission(communityId, req.user.id, 'postAnnouncement')
    if (!allowed.ok) return res.status(allowed.status).json({ message: allowed.message })

    await Announcement.updateOne(
      { _id: announcementId, community: communityId },
      { $set: { deletedAt: new Date() } },
    )
    return res.json({ message: 'Announcement removed' })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}
