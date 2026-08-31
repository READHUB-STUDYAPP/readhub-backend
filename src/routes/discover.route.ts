import express from 'express'
import {
  addToLibrary,
  getRecommended,
  getTrending,
  setVisibility,
} from '../controllers/discover.controller.js'
import { authenticate } from '../middlewares/auth.middleware.js'

const router = express.Router()

router.use(authenticate)

/**
 * @swagger
 * /api/discover/trending:
 *   get:
 *     summary: Books readers are reading, among those shared publicly
 *     description: >
 *       Ranked by how many *distinct* readers opened the book in the last 30
 *       days, so one person reading repeatedly counts once. Only books whose
 *       uploader turned sharing on are eligible. The uploader is never
 *       returned: sharing a book is not publishing who owns it.
 *     tags: [Discover]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 12
 *           maximum: 50
 *     responses:
 *       200:
 *         description: Books, each with a reader count and whether it is already in your library
 *       401:
 *         description: Unauthorized
 */
router.get('/trending', getTrending)

/**
 * @swagger
 * /api/discover/recommended:
 *   get:
 *     summary: Shared books the reader does not already have
 *     description: >
 *       Ranked the same way as trending, excluding both the reader's own
 *       uploads and anything they have already added. Books nobody has read yet
 *       still appear, last, rather than being filtered out.
 *     tags: [Discover]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 12
 *           maximum: 50
 *     responses:
 *       200:
 *         description: Books not yet in the reader's library
 *       401:
 *         description: Unauthorized
 */
router.get('/recommended', getRecommended)

/**
 * @swagger
 * /api/discover/{bookId}/add:
 *   post:
 *     summary: Copy a shared book into your library
 *     description: >
 *       Creates your own copy, so reading progress and notes stay yours and the
 *       original remains owned by whoever uploaded it. The copy starts
 *       unshared, whatever the original's setting. Adding twice returns the
 *       copy you already have rather than making a second one.
 *     tags: [Discover]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       201:
 *         description: Added
 *       200:
 *         description: Already in your library
 *       400:
 *         description: Invalid id, or the book is already yours
 *       404:
 *         description: Not found, or not shared
 */
router.post('/:bookId/add', addToLibrary)

/**
 * @swagger
 * /api/discover/{bookId}/visibility:
 *   patch:
 *     summary: Share one of your books, or stop sharing it
 *     description: >
 *       Only the uploader can change this, and only for their own book. Turning
 *       it off withdraws the book from Explore immediately; copies other
 *       readers have already taken are left alone, as those are their libraries
 *       now.
 *     tags: [Discover]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [isPublic]
 *             properties:
 *               isPublic:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Sharing updated
 *       400:
 *         description: isPublic must be a boolean
 *       404:
 *         description: Not your book
 */
router.patch('/:bookId/visibility', setVisibility)

export default router
