import mongoose, { Schema, Document, Model, Types } from 'mongoose'

/**
 * Someone asking to join a community that requires approval.
 *
 * Kept after the decision rather than deleted, so an admin can see that a
 * person was turned away before and a reapplication is a visible second ask
 * rather than an identical first one.
 */

export type JoinRequestStatus = 'pending' | 'approved' | 'declined'

export interface ICommunityJoinRequest extends Document {
  community: Types.ObjectId
  user: Types.ObjectId
  status: JoinRequestStatus
  message?: string
  decidedBy?: Types.ObjectId
  decidedAt?: Date
  createdAt: Date
  updatedAt: Date
}

const joinRequestSchema = new Schema<ICommunityJoinRequest>(
  {
    community: { type: Schema.Types.ObjectId, ref: 'Community', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      required: true,
      enum: ['pending', 'approved', 'declined'],
      default: 'pending',
    },
    message: { type: String, trim: true, maxlength: 300 },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedAt: { type: Date },
  },
  { timestamps: true },
)

/**
 * One request in flight per person per community.
 *
 * Partial on `pending`, so a declined request does not block asking again later
 * while a pending one does -- which is the behaviour an admin expects from a
 * queue.
 */
joinRequestSchema.index(
  { community: 1, user: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } },
)

/** The admin's queue for one community. */
joinRequestSchema.index({ community: 1, status: 1, createdAt: -1 })

const CommunityJoinRequest: Model<ICommunityJoinRequest> = mongoose.model<ICommunityJoinRequest>(
  'CommunityJoinRequest',
  joinRequestSchema,
)

export default CommunityJoinRequest
