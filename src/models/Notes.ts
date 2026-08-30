import mongoose, { Schema, Document, Model, Types } from 'mongoose'

/**
 * Where a highlight sits in the page's text.
 *
 * Offsets are character positions in the page's extracted text, which is what
 * pdf.js produces deterministically for a given file, so both clients derive
 * the same numbers. They are optional because a client cannot always compute
 * them -- a selection spanning several text spans, or a reader that has no text
 * layer at all -- and `text` is then the anchor of last resort: the client
 * finds the passage by matching it. Storing both is what lets a highlight
 * survive being opened on a different device.
 */
export interface INoteHighlight {
  text: string
  color: string
  startOffset?: number
  endOffset?: number
}

export interface INote extends Document {
  book: Types.ObjectId
  page: number
  content: string
  highlight?: INoteHighlight
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
    // Absent on a note typed by hand; present when the note came from
    // highlighting a passage, so the reader can paint it again on return.
    highlight: {
      type: new Schema<INoteHighlight>(
        {
          text: { type: String, required: true },
          color: { type: String, required: true, default: 'yellow' },
          startOffset: { type: Number },
          endOffset: { type: Number },
        },
        { _id: false },
      ),
      required: false,
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
