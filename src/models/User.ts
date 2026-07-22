import mongoose, { Schema, Document, Model } from 'mongoose'

export interface IUser extends Document {
  username: string
  profilePicture?: string
  email: string
  password?: string
  googleId?: string
  provider: ('local' | 'google')[]
  refreshToken?: string
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
    provider: {
      type: [String],
      enum: ['local', 'google'],
      default: ['local'],
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
