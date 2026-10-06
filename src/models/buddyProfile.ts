import mongoose, { Schema, Document, Model, Types } from 'mongoose'

/**
 * What a reader is willing to say about themselves in order to be matched.
 *
 * Separate from User on purpose. Reading Buddy is opt-in -- most of the app
 * works without ever touching it -- and the absence of a row is what "I have
 * not joined" means. Folding these fields into User would make every account
 * carry a half-filled buddy profile and leave no way to tell a reader who
 * declined from one who has not looked yet.
 *
 * Everything here is deliberately public to other buddy users. The PRD is
 * explicit that nothing sensitive may leak into discovery, so the rule is that
 * this document holds only what somebody chose to put in it, and the matching
 * and discovery code never reaches past it into User or the reading history.
 */

export type ReadingTime =
  | 'early-morning'
  | 'morning'
  | 'afternoon'
  | 'evening'
  | 'night'
  | 'flexible'

export type ReadingPace = 'relaxed' | 'steady' | 'fast'

export type BuddyPurpose = 'accountability' | 'discussion' | 'casual' | 'goal-focused'

export const READING_TIMES: ReadingTime[] = [
  'early-morning',
  'morning',
  'afternoon',
  'evening',
  'night',
  'flexible',
]

export const READING_PACES: ReadingPace[] = ['relaxed', 'steady', 'fast']

export const BUDDY_PURPOSES: BuddyPurpose[] = [
  'accountability',
  'discussion',
  'casual',
  'goal-focused',
]

export interface IBuddyProfile extends Document {
  user: Types.ObjectId
  bio?: string
  genres: string[]
  /** Titles the reader typed, not ids -- a favourite need not be in the catalogue. */
  favouriteBooks: string[]
  /** Books from the catalogue they are reading now. Feeds "reading the same book". */
  currentBooks: Types.ObjectId[]
  preferredTime: ReadingTime
  pace: ReadingPace
  /** Books a month. The shared unit for "similar goals". */
  monthlyGoal: number
  purpose: BuddyPurpose
  school?: string
  /**
   * Off means "keep me out of discovery". The profile stays, so turning it
   * back on does not mean filling the form in again.
   */
  discoverable: boolean
  /** Off means "I have enough buddies" without having to delete anything. */
  acceptingRequests: boolean
  /** Touched whenever the reader does something buddy-shaped. Ranks matches. */
  lastActiveAt: Date
  createdAt: Date
  updatedAt: Date
}

export const MAX_BIO_LENGTH = 300
export const MAX_GENRES = 8
export const MAX_FAVOURITE_BOOKS = 10

const buddyProfileSchema = new Schema<IBuddyProfile>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    bio: { type: String, trim: true, maxlength: MAX_BIO_LENGTH },
    genres: [{ type: String, trim: true, maxlength: 40 }],
    favouriteBooks: [{ type: String, trim: true, maxlength: 160 }],
    currentBooks: [{ type: Schema.Types.ObjectId, ref: 'Book' }],
    preferredTime: { type: String, enum: READING_TIMES, default: 'flexible' },
    pace: { type: String, enum: READING_PACES, default: 'steady' },
    monthlyGoal: { type: Number, min: 1, max: 60, default: 2 },
    purpose: { type: String, enum: BUDDY_PURPOSES, default: 'accountability' },
    school: { type: String, trim: true, maxlength: 120 },
    discoverable: { type: Boolean, default: true },
    acceptingRequests: { type: Boolean, default: true },
    lastActiveAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
)

// Discovery reads "everyone open to being found, most recently active first",
// then scores the page in memory. Scoring in the database would mean a stored
// score per pair, which is a lot of rows to keep fresh for a list most readers
// look at once.
buddyProfileSchema.index(
  { lastActiveAt: -1 },
  { partialFilterExpression: { discoverable: true } },
)

// Narrowing by genre before scoring is what keeps that page small as the user
// base grows.
buddyProfileSchema.index({ genres: 1, lastActiveAt: -1 })

// "People reading the same book as me."
buddyProfileSchema.index({ currentBooks: 1 })

const BuddyProfile: Model<IBuddyProfile> = mongoose.model<IBuddyProfile>(
  'BuddyProfile',
  buddyProfileSchema,
)

export default BuddyProfile
