import mongoose, { Schema, Document, Model } from 'mongoose'

export type UserRole = 'user' | 'admin'

export interface IUser extends Document {
  username: string
  profilePicture?: string
  email: string
  password?: string
  googleId?: string
  appleId?: string
  provider: ('local' | 'google' | 'apple')[]
  role: UserRole
  /** @deprecated Superseded by refreshTokens; kept so sessions issued before
   * the change keep working until they expire. */
  refreshToken?: string
  /** One entry per signed-in device. */
  refreshTokens: string[]
  createdAt: Date
  updatedAt: Date
}

const userSchema = new Schema<IUser>(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    profilePicture: {
      type: String,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    password: { type: String },
    googleId: { type: String },
    appleId: { type: String },
    provider: {
      type: [String],
      enum: ['local', 'google', 'apple'],
      default: ['local'],
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
      index: true,
    },
    // One token per signed-in device. A single field meant each login
    // overwrote the last, so signing in on the web silently invalidated the
    // phone's session and the next refresh there logged the user out.
    refreshTokens: {
      type: [String],
      default: [],
      index: true,
    },
    refreshToken: {
      type: String,
    },
  },
  {
    timestamps: true,
  },
)

const User: Model<IUser> = mongoose.model<IUser>('User', userSchema)

export default User
