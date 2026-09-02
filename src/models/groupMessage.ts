import mongoose, { Schema, Document, Model, Types } from 'mongoose'

/**
 * A comment in a reading group.
 *
 * Kept whatever happens to the people in it. A conversation that loses half its
 * messages because somebody left the group -- or closed their account -- stops
 * making sense to everyone who stayed: replies answer nothing, and the thread
 * reads as though it were never there. So a message outlives its author.
 *
 * That is why the author's name is copied onto the message when it is written,
 * rather than only referenced. The reference may dangle -- the account it
 * points at can be deleted -- and the snapshot is what lets the message still
 * say who wrote it. Nothing else of the author is kept here.
 *
 * `deletedAt` is a soft delete for the same reason: a removed message leaves a
 * tombstone so the replies beneath it still have something to hang from.
 */
export interface IGroupMessage extends Document {
  group: Types.ObjectId
  /** The book being discussed, when the comment is about one. */
  book?: Types.ObjectId
  /** The page it refers to, for a comment made while reading. */
  page?: number
  /** The message being replied to. Null for a top-level comment. */
  replyTo?: Types.ObjectId

  /** May point at an account that no longer exists. */
  author?: Types.ObjectId
  /** Who wrote it, as they were called at the time. */
  authorName: string

  body: string
  /** Set when withdrawn. The row stays so replies keep their parent. */
  deletedAt?: Date
  editedAt?: Date
  createdAt: Date
  updatedAt: Date
}

export const MAX_MESSAGE_LENGTH = 2000

const groupMessageSchema = new Schema<IGroupMessage>(
  {
    group: { type: Schema.Types.ObjectId, ref: 'ReadingGroup', required: true },
    book: { type: Schema.Types.ObjectId, ref: 'Book' },
    page: { type: Number, min: 1 },
    replyTo: { type: Schema.Types.ObjectId, ref: 'GroupMessage' },

    // Deliberately not `required`: an account may be deleted while its messages
    // remain, and the message is still worth reading.
    author: { type: Schema.Types.ObjectId, ref: 'User' },
    authorName: { type: String, required: true, trim: true, maxlength: 120 },

    body: { type: String, required: true, trim: true, maxlength: MAX_MESSAGE_LENGTH },
    deletedAt: { type: Date },
    editedAt: { type: Date },
  },
  { timestamps: true },
)

// The conversation, newest first, in pages. Every read of a group's comments
// uses this; without it the collection is scanned as it grows.
groupMessageSchema.index({ group: 1, createdAt: -1 })

// The comments on one book within a group, for a thread opened from the reader.
groupMessageSchema.index({ group: 1, book: 1, createdAt: -1 })

// Replies to a message, for counting and for loading a thread.
groupMessageSchema.index({ replyTo: 1, createdAt: 1 })

const GroupMessage: Model<IGroupMessage> = mongoose.model<IGroupMessage>(
  'GroupMessage',
  groupMessageSchema,
)

export default GroupMessage
