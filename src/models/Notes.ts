import mongoose, { Schema, Document, Model, Types } from 'mongoose'

export interface INote extends Document {
  book: Types.ObjectId
  page: number
  content: string
  createdBy: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const noteSchema = new Schema<INote>(
  {
    book: {
      type: Schema.Types.ObjectId,
      ref: 'Book',
      required: true,
    },
    page: {
      type: Number,
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true },
)

const Notes: Model<INote> = mongoose.model<INote>('Notes', noteSchema)

export default Notes
