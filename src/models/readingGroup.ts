import mongoose, { Schema, Document, Model, Types } from 'mongoose'

/**
 * A few readers on the same book.
 *
 * Any user can create one; there is no privileged role behind it. The creator
 * is the owner only in the sense that somebody has to be able to remove a
 * member or a book.
 *
 * Members, books and the schedule are embedded rather than kept in their own
 * collections. A group is small by design -- six friends or a study set, capped
 * below -- so the whole thing is one document read in one query, and the common
 * case ("show me my groups") never joins. Per-member reading positions are the
 * exception: they change constantly and are kept in their own collection so a
 * page turn does not rewrite the group.
 */

export interface IGroupMember {
  user: Types.ObjectId
  role: 'owner' | 'member'
  /**
   * Whether this member's own pages are shown to the group.
   *
   * Joining is what consent rests on, and this is the way back from it: a
   * member can go quiet without leaving and losing the schedule.
   */
  visible: boolean
  joinedAt: Date
}

export interface IGroupBook {
  book: Types.ObjectId
  addedBy: Types.ObjectId
  addedAt: Date
}

export interface IGroupTarget {
  book: Types.ObjectId
  targetPage: number
  dueAt: Date
}

export interface IReadingGroup extends Document {
  name: string
  description?: string
  createdBy: Types.ObjectId
  members: IGroupMember[]
  books: IGroupBook[]
  schedule: IGroupTarget[]
  /** What an invitation carries. Rotatable, so a leaked one can be revoked. */
  inviteCode: string
  createdAt: Date
  updatedAt: Date
}

/** Bounds that keep a group a group, and its document small enough to embed. */
export const MAX_MEMBERS = 50
export const MAX_BOOKS = 25

const memberSchema = new Schema<IGroupMember>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['owner', 'member'], default: 'member' },
    visible: { type: Boolean, default: true },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false },
)

const groupBookSchema = new Schema<IGroupBook>(
  {
    book: { type: Schema.Types.ObjectId, ref: 'Book', required: true },
    addedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false },
)

const targetSchema = new Schema<IGroupTarget>(
  {
    book: { type: Schema.Types.ObjectId, ref: 'Book', required: true },
    targetPage: { type: Number, required: true, min: 1 },
    dueAt: { type: Date, required: true },
  },
  { _id: false },
)

const readingGroupSchema = new Schema<IReadingGroup>(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 400 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    members: { type: [memberSchema], default: [] },
    books: { type: [groupBookSchema], default: [] },
    schedule: { type: [targetSchema], default: [] },
    inviteCode: { type: String, required: true },
  },
  { timestamps: true },
)

// "Which groups am I in" is the query behind the whole feature and runs on
// every visit to the tab. A multikey index over the embedded members answers it
// without touching a document that does not belong to the caller.
readingGroupSchema.index({ 'members.user': 1, updatedAt: -1 })

// Joining looks a group up by nothing else, and two groups must never share a
// code.
readingGroupSchema.index({ inviteCode: 1 }, { unique: true })

const ReadingGroup: Model<IReadingGroup> = mongoose.model<IReadingGroup>(
  'ReadingGroup',
  readingGroupSchema,
)

export default ReadingGroup
