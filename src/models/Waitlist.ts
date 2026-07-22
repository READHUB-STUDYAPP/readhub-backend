import mongoose, { Schema, Document, Model } from 'mongoose'

export interface IWaitList extends Document {
  email: string
  dateJoined: Date
  createdAt: Date
  updatedAt: Date
}

const waitListSchema = new Schema<IWaitList>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    dateJoined: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
)

const WaitList: Model<IWaitList> = mongoose.model<IWaitList>(
  'WaitList',
  waitListSchema,
)

export default WaitList
