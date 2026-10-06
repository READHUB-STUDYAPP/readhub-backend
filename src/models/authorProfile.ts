import mongoose, { Schema, Document, Model, Types } from 'mongoose'

/**
 * A writer's public face on ReadHub.
 *
 * Separate from `User` rather than a flag on it: most readers will never have
 * one, the fields are entirely different, and a profile is reviewed by a human
 * before it is public. Keeping it apart means the review state lives with the
 * thing being reviewed.
 *
 * Verification is deliberately manual. The claim being checked is "this person
 * wrote these books", which no automated signal answers -- so it goes through
 * the admin panel that already reviews readers and books.
 */

export type AuthorVerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected'

export interface IAuthorProfile extends Document {
  user: Types.ObjectId
  penName: string
  bio?: string
  photoUrl?: string
  genres: string[]
  location?: string
  website?: string
  /** Social and storefront links, kept as given rather than parsed. */
  links: string[]
  status: AuthorVerificationStatus
  /** Why a rejection happened, so the writer can answer it. */
  reviewNote?: string
  reviewedBy?: Types.ObjectId
  reviewedAt?: Date
  /** Denormalised for listings. Corrected on the next recount if it drifts. */
  followerCount: number
  bookCount: number
  createdAt: Date
  updatedAt: Date
}

const authorProfileSchema = new Schema<IAuthorProfile>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    penName: { type: String, required: true, trim: true, maxlength: 80 },
    bio: { type: String, trim: true, maxlength: 1200 },
    photoUrl: { type: String, trim: true },
    genres: { type: [String], default: [] },
    location: { type: String, trim: true, maxlength: 120 },
    website: { type: String, trim: true },
    links: { type: [String], default: [] },
    status: {
      type: String,
      required: true,
      enum: ['unverified', 'pending', 'verified', 'rejected'],
      default: 'unverified',
    },
    reviewNote: { type: String, maxlength: 500 },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    followerCount: { type: Number, default: 0, min: 0 },
    bookCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
)

/** The admin review queue. */
authorProfileSchema.index({ status: 1, updatedAt: -1 })

/** Browsing verified authors, and searching them by name. */
authorProfileSchema.index(
  { penName: 'text', bio: 'text' },
  { partialFilterExpression: { status: 'verified' } },
)

const AuthorProfile: Model<IAuthorProfile> = mongoose.model<IAuthorProfile>(
  'AuthorProfile',
  authorProfileSchema,
)

export default AuthorProfile
