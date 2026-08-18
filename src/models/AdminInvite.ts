import mongoose, { Schema, Document, Model, Types } from 'mongoose'

// A pending invitation for someone to become an admin. The raw token is only
// ever sent to the invitee (email / link); we store its SHA-256 hash so a DB
// leak can't be replayed. Unaccepted invites are auto-removed at `expiresAt`
// by the TTL index.
export interface IAdminInvite extends Document {
  email: string
  tokenHash: string
  role: 'admin'
  invitedBy: Types.ObjectId
  expiresAt: Date
  acceptedAt?: Date
  createdAt: Date
  updatedAt: Date
}

const adminInviteSchema = new Schema<IAdminInvite>(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    tokenHash: {
      type: String,
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ['admin'],
      default: 'admin',
    },
    invitedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // TTL: MongoDB removes the doc once `expiresAt` passes.
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
    acceptedAt: {
      type: Date,
    },
  },
  { timestamps: true },
)

const AdminInvite: Model<IAdminInvite> = mongoose.model<IAdminInvite>(
  'AdminInvite',
  adminInviteSchema,
)

export default AdminInvite
