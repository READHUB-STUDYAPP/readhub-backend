import mongoose, { Schema, Document, Model, Types } from 'mongoose'

/**
 * One person's membership of one community.
 *
 * Its own collection rather than an array on the community, because a community
 * is meant to scale to a university. Embedding would mean every join rewrites
 * one ever-growing document, two joins at once contend on it, and at some point
 * it meets Mongo's 16MB ceiling. Here a join is an insert that touches nothing
 * anyone else is reading.
 *
 * The roles are a ladder, not a set: owner > admin > moderator > member. A
 * permission check asks whether the holder's rank clears the bar, so adding a
 * capability later means naming the rank that unlocks it rather than editing
 * every role's list.
 */

export type CommunityRole = 'owner' | 'admin' | 'moderator' | 'member'

export interface ICommunityMember extends Document {
  community: Types.ObjectId
  user: Types.ObjectId
  role: CommunityRole
  /**
   * Whether this member's reading is shown to the community.
   *
   * Joining is what consent rests on; this is the way back from it without
   * leaving. Mirrors the same field on a reading group member.
   */
  visible: boolean
  joinedAt: Date
  /** Set when the migration moved this person across from a reading group. */
  migrated?: boolean
  createdAt: Date
  updatedAt: Date
}

/** Rank order. Higher clears every bar a lower rank clears. */
const RANK: Record<CommunityRole, number> = {
  owner: 3,
  admin: 2,
  moderator: 1,
  member: 0,
}

/**
 * What each capability costs, named once.
 *
 * The PRD lists permissions per role; expressing them as the minimum rank keeps
 * them in one readable place and makes "can a moderator do this?" answerable by
 * reading a single line rather than four lists.
 */
export const PERMISSION_RANK = {
  createGroup: RANK.moderator,
  deleteGroup: RANK.admin,
  postAnnouncement: RANK.admin,
  moderateDiscussion: RANK.moderator,
  inviteMembers: RANK.member,
  manageMembers: RANK.admin,
  createChallenge: RANK.moderator,
  editCommunity: RANK.admin,
  assignRoles: RANK.owner,
  deleteCommunity: RANK.owner,
} as const

export type CommunityPermission = keyof typeof PERMISSION_RANK

/** Whether a role clears the bar for a capability. */
export function can(role: CommunityRole | undefined, permission: CommunityPermission): boolean {
  if (!role) return false
  return RANK[role] >= PERMISSION_RANK[permission]
}

const communityMemberSchema = new Schema<ICommunityMember>(
  {
    community: { type: Schema.Types.ObjectId, ref: 'Community', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: {
      type: String,
      required: true,
      enum: ['owner', 'admin', 'moderator', 'member'],
      default: 'member',
    },
    visible: { type: Boolean, default: true },
    joinedAt: { type: Date, default: Date.now },
    migrated: { type: Boolean },
  },
  { timestamps: true },
)

/**
 * One membership per person per community, enforced by the database.
 *
 * Also the index that answers "is this caller a member, and what may they do",
 * which runs before almost every community request.
 */
communityMemberSchema.index({ community: 1, user: 1 }, { unique: true })

/** The member list, and finding the admins to notify. */
communityMemberSchema.index({ community: 1, role: 1, joinedAt: -1 })

/** "Which communities am I in", for the reader's own list. */
communityMemberSchema.index({ user: 1, updatedAt: -1 })

const CommunityMember: Model<ICommunityMember> = mongoose.model<ICommunityMember>(
  'CommunityMember',
  communityMemberSchema,
)

export default CommunityMember
