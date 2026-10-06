import mongoose, { Schema, Document, Model, Types } from 'mongoose'

/**
 * One reader asking another to be their buddy.
 *
 * The row outlives its answer. A declined request is kept rather than deleted,
 * because "has this person already asked me?" is a question the spam rules need
 * answered, and a deleted row answers it wrongly.
 *
 * Duplicates are prevented by the index below rather than by a check in the
 * controller: two taps on Send arrive as two requests, and only the database
 * sees both at once.
 */

export type BuddyRequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled'

export interface IBuddyRequest extends Document {
  from: Types.ObjectId
  to: Types.ObjectId
  message?: string
  status: BuddyRequestStatus
  /** Why they were suggested, frozen at send time so the story stays true. */
  matchScore?: number
  respondedAt?: Date
  createdAt: Date
  updatedAt: Date
}

export const MAX_REQUEST_MESSAGE = 300

const buddyRequestSchema = new Schema<IBuddyRequest>(
  {
    from: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    to: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    message: { type: String, trim: true, maxlength: MAX_REQUEST_MESSAGE },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'declined', 'cancelled'],
      default: 'pending',
    },
    matchScore: { type: Number, min: 0, max: 100 },
    respondedAt: { type: Date },
  },
  { timestamps: true },
)

// At most one request in flight between two people in one direction. Answered
// requests are excluded so a declined ask can be made again later -- people
// change their minds, and a permanent block belongs in UserBlock, not here.
buddyRequestSchema.index(
  { from: 1, to: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } },
)

// The two inbox queries: what has been sent to me, and what I have sent.
buddyRequestSchema.index({ to: 1, status: 1, createdAt: -1 })
buddyRequestSchema.index({ from: 1, status: 1, createdAt: -1 })

const BuddyRequest: Model<IBuddyRequest> = mongoose.model<IBuddyRequest>(
  'BuddyRequest',
  buddyRequestSchema,
)

export default BuddyRequest
