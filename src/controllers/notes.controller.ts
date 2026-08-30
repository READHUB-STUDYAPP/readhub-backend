import type { Request, Response } from 'express'
import { isValidObjectId } from 'mongoose'
import Book from '../models/Books.js'
import Notes from '../models/Notes.js'

const errMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const createNote = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: 'Unauthorized' })
    }

    const userId = req.user.id
    const { bookId, content, pageNumber, highlight } = req.body

    if (!bookId || !content || typeof pageNumber !== 'number') {
      return res.status(400).json({
        message: 'bookId, content, and valid pageNumber are required',
      })
    }

    // Validate that content is not empty or whitespace
    const trimmedContent = content.trim()
    if (trimmedContent.length === 0) {
      return res.status(400).json({
        message: 'Content cannot be empty or contain only whitespace',
      })
    }

    // Only allow notes on a book the user owns (prevents cross-user note writes).
    const checkBook = await Book.findOne({ _id: bookId, uploadedBy: userId })
    if (!checkBook) {
      return res.status(404).json({ message: 'Book not found' })
    }

    // A highlight is optional -- a note can be typed by hand. When present it
    // must carry the selected text, since that is the fallback the reader uses
    // to find the passage when the offsets do not apply.
    let highlightDoc
    if (highlight !== undefined && highlight !== null) {
      if (typeof highlight !== 'object') {
        return res.status(400).json({ message: 'highlight must be an object' })
      }

      const highlightText = String(highlight.text ?? '').trim()
      if (!highlightText) {
        return res
          .status(400)
          .json({ message: 'highlight.text is required when highlight is provided' })
      }

      const { startOffset, endOffset } = highlight
      const hasOffsets = startOffset !== undefined || endOffset !== undefined
      if (hasOffsets) {
        if (
          !Number.isInteger(startOffset) ||
          !Number.isInteger(endOffset) ||
          startOffset < 0 ||
          endOffset <= startOffset
        ) {
          return res.status(400).json({
            message:
              'highlight.startOffset and highlight.endOffset must be integers with endOffset greater than startOffset',
          })
        }
      }

      highlightDoc = {
        text: highlightText,
        color: String(highlight.color ?? 'yellow'),
        ...(hasOffsets ? { startOffset, endOffset } : {}),
      }
    }

    const newNote = new Notes({
      book: bookId,
      content: trimmedContent,
      page: pageNumber,
      createdBy: userId,
      ...(highlightDoc ? { highlight: highlightDoc } : {}),
    })

    await newNote.save()

    // The note itself, not just a message: the client needs its id to render
    // the highlight and to delete it again without refetching the whole list.
    return res.status(201).json({
      message: 'Note created successfully',
      note: newNote.toObject(),
    })
  } catch (error) {
    return res.status(500).json({
      message: `Error creating note: ${errMessage(error)}`,
    })
  }
}

export const deleteNote = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: 'Unauthorized' })
    }

    const note = await Notes.findById(req.params.id)

    if (!note) {
      return res.status(404).json({ message: 'Note not found' })
    }

    // Check ownership
    if (note.createdBy.toString() !== req.user.id) {
      return res
        .status(403)
        .json({ message: 'Not allowed to delete this note' })
    }

    await note.deleteOne()

    return res.json({ message: 'Note deleted successfully' })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

export const getAllNotes = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: 'Unauthorized' })
    }

    const userId = req.user.id

    // Filtered in the query rather than in JS. The reader asks for one page of
    // one book on every page turn, and fetching every note the user has ever
    // written to discard all but a few does not stay viable as a library grows.
    const filter: Record<string, unknown> = { createdBy: userId }

    if (req.query.bookId) {
      if (!isValidObjectId(req.query.bookId)) {
        return res.status(400).json({ message: 'bookId is not a valid id' })
      }
      filter.book = req.query.bookId
    }

    if (req.query.page !== undefined) {
      const page = Number(req.query.page)
      if (!Number.isInteger(page) || page < 0) {
        return res.status(400).json({ message: 'page must be a non-negative integer' })
      }
      filter.page = page
    }

    const notes = await Notes.find(filter)
      .populate({
        path: 'book',
        match: { uploadedBy: userId },
        select: 'title author',
      })
      .sort({ page: 1, createdAt: 1 })
      .lean()

    // `populate` with `match` leaves book null when it did not match, which is
    // how a note on a book the user no longer owns is excluded.
    const filteredNotes = notes.filter((note) => note.book !== null)

    return res.json(filteredNotes)
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

export const getNoteById = async (req: Request, res: Response) => {
  try {
    const note = await Notes.findOne({
      _id: req.params.id,
      createdBy: req.user!.id,
    }).lean()

    if (!note) {
      return res.status(404).json({ message: 'Note not found' })
    }

    res.json(note)
  } catch (error) {
    res.status(500).json({ message: errMessage(error) })
  }
}
