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
 *     responses:
 *       201:
 *         description: Note created successfully
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
