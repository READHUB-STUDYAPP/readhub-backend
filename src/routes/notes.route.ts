import express from 'express'
import {
  createNote,
  deleteNote,
  getAllNotes,
  getNoteById,
} from '../controllers/notes.controller.js'
import { authenticate } from '../middlewares/auth.middleware.js'

const router = express.Router()

router.use(authenticate)

/**
 * @swagger
 * /api/notes:
 *   post:
 *     summary: Create a new note
 *     tags: [Notes]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - bookId
 *               - content
 *               - pageNumber
 *             properties:
 *               bookId:
 *                 type: string
 *                 example: 64f1c2a3b456789012345678
 *               content:
 *                 type: string
 *                 example: This chapter explains async programming.
 *               pageNumber:
 *                 type: number
 *                 example: 25
 *               highlight:
 *                 type: object
 *                 description: >
 *                   Present when the note came from highlighting a passage, so
 *                   the reader can paint it again on a later visit or on
 *                   another device. Offsets are character positions in the
 *                   page's extracted text and are optional; `text` is the
 *                   fallback anchor when they cannot be computed or no longer
 *                   apply.
 *                 required:
 *                   - text
 *                 properties:
 *                   text:
 *                     type: string
 *                     example: Habits are the compound interest of self-improvement.
 *                   color:
 *                     type: string
 *                     default: yellow
 *                     example: "#F5A623"
 *                   startOffset:
 *                     type: integer
 *                     example: 1042
 *                   endOffset:
 *                     type: integer
 *                     example: 1096
 *     responses:
 *       201:
 *         description: Note created successfully, returned as `note`
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Book not found
 */
router.post('/', createNote)

/**
 * @swagger
 * /api/notes:
 *   get:
 *     summary: Get all notes created by the logged-in user
 *     tags: [Notes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: bookId
 *         schema:
 *           type: string
 *         description: Only notes on this book.
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: >
 *           Only notes on this page. The reader asks for one page at a time on
 *           every page turn.
 *     responses:
 *       200:
 *         description: List of user's notes
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       401:
 *         description: Unauthorized
 */
router.get('/', getAllNotes)

/**
 * @swagger
 * /api/notes/{id}:
 *   get:
 *     summary: Get a specific note by ID
 *     tags: [Notes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: Note ID
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Note found
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Note not found
 */
router.get('/:id', getNoteById)

/**
 * @swagger
 * /api/notes/{id}:
 *   delete:
 *     summary: Delete a note created by the logged-in user
 *     tags: [Notes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: Note ID
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Note deleted successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Not allowed to delete this note
 *       404:
 *         description: Note not found
 */
router.delete('/:id', deleteNote)

export default router
