import mongoose, { Schema, Document, Model, Types } from 'mongoose'

/**
 * One reader following one author.
 *
 * Its own collection rather than an array on either side: a popular author's
 * follower list is unbounded, and a reader's following list is read far less
 * often than it is written to. Two indexes answer both directions.
 */

export interface IAuthorFollow extends Document {
  author: Types.ObjectId
  user: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const authorFollowSchema = new Schema<IAuthorFollow>(
  {
    author: { type: Schema.Types.ObjectId, ref: 'AuthorProfile', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
)

/** Follow once, enforced by the database rather than by a read-then-write. */
authorFollowSchema.index({ author: 1, user: 1 }, { unique: true })

/** "Authors I follow", for the reader's own feed. */
authorFollowSchema.index({ user: 1, createdAt: -1 })

const AuthorFollow: Model<IAuthorFollow> = mongoose.model<IAuthorFollow>(
  'AuthorFollow',
  authorFollowSchema,
)

export default AuthorFollow
