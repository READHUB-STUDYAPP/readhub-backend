import mongoose, { Schema, Document, Model, Types } from 'mongoose'

export interface IUserStats extends Document {
  user: Types.ObjectId
  totalMinutesRead: number
  todayReadingMinutes: number
  dailyReadingGoal: number
  currentStreak: number
  bestStreak: number
  lastReadingDate?: Date
  createdAt: Date
  updatedAt: Date
}

const userStatsSchema = new Schema<IUserStats>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      unique: true,
    },

    totalMinutesRead: {
      type: Number,
      default: 0,
    },

    todayReadingMinutes: {
      type: Number,
      default: 0,
    },

    dailyReadingGoal: {
      type: Number,
      default: 30,
    },

    currentStreak: {
      type: Number,
      default: 0,
    },

    bestStreak: {
      type: Number,
      default: 0,
    },

    lastReadingDate: Date,
  },
  { timestamps: true },
)

const UserStats: Model<IUserStats> = mongoose.model<IUserStats>(
  'UserStats',
  userStatsSchema,
)

export default UserStats
