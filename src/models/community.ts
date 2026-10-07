import mongoose, { Schema, Document, Model, Types } from 'mongoose'

/**
 * The umbrella a set of reading groups belongs to.
 *
 * A school, a department, a fellowship, a set of friends. The community itself
 * holds almost nothing: a name, how to find it, and who may do what. The
 * reading lives in the groups beneath it, and that is deliberate -- the product
 * rule in the PRD is that a community exists to return people to a book, not to
 * become a place they scroll.
 *
 * Members are NOT embedded here, unlike `readingGroup`. A group is six friends
 * and fits in one document; a community is meant to hold a university. Embedding
 * would put every join through a rewrite of the same document, make two
 * simultaneous joins contend, and eventually meet the 16MB ceiling. They live in
 * `communityMember` instead, which is why that collection carries the indexes
 * rather than this one.
 */

export type CommunityCategory =
  | 'book-club'
  | 'school'
  | 'university'
  | 'student-organization'
  | 'department'
  | 'class'
  | 'friends'
  | 'professional'
  | 'personal-development'
  | 'other'

/**
 * Who can find the community, which is separate from who can join it.
 *
 * `public`  listed in discovery, anyone may request or join per joinPolicy.
 * `private` not listed; reachable with a link or code.
 * `hidden`  not listed and not reachable by code; invitation only.
 */
export type CommunityVisibility = 'public' | 'private' | 'hidden'

/** How someone gets in once they have found it. */
export type CommunityJoinPolicy = 'open' | 'approval' | 'invite'

/** Who may start a conversation at community level. */
export type CommunityPostPolicy = 'members' | 'admins'

export interface ICommunity extends Document {
  name: string
  description?: string
  logoUrl?: string
  /**
   * The wide image behind the community's name.
   *
   * Separate from logoUrl because they are different pictures doing
   * different jobs: a logo is small, square and shown beside the name in a
   * list, a cover is wide and sits behind it. One field used for both gives
   * a banner cropped from a square, or a list avatar cropped from a
   * landscape -- either way, something stretched.
   */
  coverUrl?: string
  category: CommunityCategory
  visibility: CommunityVisibility
  joinPolicy: CommunityJoinPolicy
  postPolicy: CommunityPostPolicy
  /** Whether the member list is visible to members, or only to admins. */
  membersVisible: boolean
  createdBy: Types.ObjectId
  /** What an invitation link or a spoken code carries. Rotatable. */
  inviteCode: string
  /**
   * Denormalised so the communities list does not count members per row.
   *
   * Maintained by the controllers on join and leave. It is a display figure,
   * not a source of truth -- `communityMember` is -- so a drift of one after a
   * crash costs nothing and is corrected on the next recount.
   */
  memberCount: number
  groupCount: number
  /**
   * Set when this community was created by the migration that gave every
   * pre-existing reading group a home, rather than by a person.
   *
   * Kept permanently: it is how the backfill stays idempotent, how a rollback
   * finds what it made, and how the apps know to explain to an owner why they
   * have a community they never created.
   */
  migratedFromGroup?: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

/** Long enough to be unguessable, short enough to read down a phone. */
export const INVITE_CODE_LENGTH = 8

const communitySchema = new Schema<ICommunity>(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 500 },
    logoUrl: { type: String, trim: true },
    coverUrl: { type: String, trim: true },
    category: {
      type: String,
      required: true,
      enum: [
        'book-club',
        'school',
        'university',
        'student-organization',
        'department',
        'class',
        'friends',
        'professional',
        'personal-development',
        'other',
      ],
      default: 'other',
    },
    visibility: {
      type: String,
      required: true,
      enum: ['public', 'private', 'hidden'],
      default: 'private',
    },
    joinPolicy: {
      type: String,
      required: true,
      enum: ['open', 'approval', 'invite'],
      default: 'open',
    },
    postPolicy: {
      type: String,
      required: true,
      enum: ['members', 'admins'],
      default: 'members',
    },
    membersVisible: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    inviteCode: { type: String, required: true, unique: true },
    memberCount: { type: Number, default: 0, min: 0 },
    groupCount: { type: Number, default: 0, min: 0 },
    migratedFromGroup: { type: Schema.Types.ObjectId, ref: 'ReadingGroup', index: true },
  },
  { timestamps: true },
)

/**
 * Discovery, which only ever asks about public communities.
 *
 * Partial, so the far larger set of private and hidden communities is not
 * carried in an index that can never return them.
 */
communitySchema.index(
  { category: 1, memberCount: -1 },
  { partialFilterExpression: { visibility: 'public' } },
)

/** Search by name within discovery. Same reasoning for the partial filter. */
communitySchema.index(
  { name: 'text', description: 'text' },
  { partialFilterExpression: { visibility: 'public' } },
)

const Community: Model<ICommunity> = mongoose.model<ICommunity>('Community', communitySchema)

export default Community
