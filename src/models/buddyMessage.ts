import mongoose, { Schema, Document, Model, Types } from 'mongoose'

/**
 * A line in a buddy conversation.
 *
 * Shaped after GroupMessage, and for the same reason: the author's name is
 * copied in at write time so a message still says who wrote it even if that
 * account is later deleted, and withdrawal is a soft delete so nothing that
 * replies to it is left hanging.
 *
 * `kind` is what keeps the conversation reading-focused rather than letting it
 * drift into a general messenger. A quote or a progress note renders as itself,
 * not as someone typing the same thing by hand.
 */

export type BuddyMessageKind = 'text' | 'quote' | 'note' | 'milestone'

export interface IBuddyMessage extends Document {
  buddy: Types.ObjectId
  author?: Types.ObjectId
  authorName: string
  kind: BuddyMessageKind
  body: string
  /** The book this is about, for a comment made while reading. */
  book?: Types.ObjectId
  page?: number
  /** Emoji to the readers who sent them. Two people, so this stays small. */
  reactions: { emoji: string; user: Types.ObjectId }[]
  readAt?: Date
  deletedAt?: Date
  createdAt: Date
  updatedAt: Date
}

export const MAX_BUDDY_MESSAGE_LENGTH = 2000

const buddyMessageSchema = new Schema<IBuddyMessage>(
  {
    buddy: { type: Schema.Types.ObjectId, ref: 'Buddy', required: true },
    author: { type: Schema.Types.ObjectId, ref: 'User' },
    authorName: { type: String, required: true, trim: true, maxlength: 120 },
    kind: { type: String, enum: ['text', 'quote', 'note', 'milestone'], default: 'text' },
    body: { type: String, required: true, trim: true, maxlength: MAX_BUDDY_MESSAGE_LENGTH },
    book: { type: Schema.Types.ObjectId, ref: 'Book' },
    page: { type: Number, min: 1 },
    reactions: {
      type: [
        {
          _id: false,
          emoji: { type: String, required: true, maxlength: 8 },
          user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        },
      ],
      default: [],
    },
    readAt: { type: Date },
    deletedAt: { type: Date },
  },
  { timestamps: true },
)

// The conversation, newest first, in pages.
buddyMessageSchema.index({ buddy: 1, createdAt: -1 })

// The unread count, which every buddy list row asks for.
buddyMessageSchema.index(
  { buddy: 1, author: 1, readAt: 1 },
  { partialFilterExpression: { deletedAt: { $exists: false } } },
)

const BuddyMessage: Model<IBuddyMessage> = mongoose.model<IBuddyMessage>(
  'BuddyMessage',
  buddyMessageSchema,
)

export default BuddyMessage
