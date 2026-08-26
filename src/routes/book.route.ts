import express, { type Request, type Response, type NextFunction } from 'express'
import multer from 'multer'
import os from 'os'
import {
  uploadBook,
  deleteBook,
  getBooks,
  updateBookProgress,
  bookStatus,
  startReading,
  endReading,
  getStatistics,
  updateDailyGoal,
  uploadBookFile,
  getBookContent,
} from '../controllers/book.controller.js'
import { authenticate } from '../middlewares/auth.middleware.js'

const router = express.Router()
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
})

/**
 * @swagger
 * /api/book/upload:
 *   post:
 *     summary: Upload a new book
 *     tags: [Books]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - coverImageUrl
 *               - fileUrl
 *               - pages
 *             properties:
 *               title:
 *                 type: string
 *                 example: Atomic Habits
 *               coverImageUrl:
 *                 type: string
 *                 example: https://res.cloudinary.com/demo/image/upload/book.jpg
 *               fileUrl:
 *                 type: string
 *                 example: https://res.cloudinary.com/demo/raw/upload/book.pdf
 *               pages:
 *                 type: number
 *                 example: 320
 *     responses:
 *       201:
 *         description: Book uploaded successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.post('/upload', authenticate, uploadBook)
// Backend-mediated upload for large files (avoids browser/CORS limitations)
router.post(
  '/upload-file',
  authenticate,
  (req: Request, res: Response, next: NextFunction) => {
    upload.single('file')(req, res, (err: any) => {
      if (!err) return next()
      return res.status(400).json({
        message: 'File upload failed',
        error: err.message,
        code: err.code,
      })
    })
  },
  uploadBookFile,
)
/**
 * @swagger
 * /api/book:
 *   get:
 *     summary: Get all books uploaded by the logged-in user
 *     tags: [Books]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of user's books
 *       401:
 *         description: Unauthorized
 */
router.get('/', authenticate, getBooks)
router.get('/:bookId/content', authenticate, getBookContent)
/**
 * @swagger
 * /api/book/{bookId}:
 *   put:
 *     summary: Update book reading progress or status
 *     tags: [Books]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookId
 *         required: true
 *         description: ID of the book
 *         schema:
 *           type: string
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               lastPageRead:
 *                 type: number
 *                 example: 120
 *               status:
 *                 type: string
 *                 example: reading
 *     responses:
 *       200:
 *         description: Book progress updated successfully
 *       404:
 *         description: Book not found
 *       401:
 *         description: Unauthorized
 */
router.put('/:bookId', authenticate, updateBookProgress)
/**
 * @swagger
 * /api/book/status:
 *   get:
 *     summary: Get books grouped by reading and completed status
 *     tags: [Books]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Reading and completed books
 *       401:
 *         description: Unauthorized
 */
router.get('/status', authenticate, bookStatus)
/**
 * @swagger
 * /api/book/{bookId}:
 *   delete:
 *     summary: Delete a book uploaded by the logged-in user
 *     tags: [Books]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookId
 *         required: true
 *         description: ID of the book
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Book deleted successfully
 *       404:
 *         description: Book not found
 *       401:
 *         description: Unauthorized
 */
router.delete('/:bookId', authenticate, deleteBook)

/**
 * @swagger
 * /api/book/start:
 *   post:
 *     summary: Start a reading session
 *     tags: [Books]
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
 *               - startPage
 *             properties:
 *               bookId:
 *                 type: string
 *                 description: ID of the book being read
 *                 example: 64f1b2c9a1234567890abcd1
 *               startPage:
 *                 type: number
 *                 description: Page where the user started reading
 *                 example: 1
 *     responses:
 *       201:
 *         description: Reading session started successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Session recorded
 *                 session:
 *                   type: object
 *                   properties:
 *                     _id:
 *                       type: string
 *                     user:
 *                       type: string
 *                     book:
 *                       type: string
 *                     startPage:
 *                       type: number
 *                     startTime:
 *                       type: string
 *                       format: date-time
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/start', authenticate, startReading)
/**
 * @swagger
 * /api/book/end:
 *   post:
 *     summary: End a reading session
 *     tags: [Books]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sessionId
 *               - endPage
 *             properties:
 *               sessionId:
 *                 type: string
 *                 description: ID of the reading session
 *                 example: 64f1b2c9a1234567890abcd1
 *               endPage:
 *                 type: number
 *                 description: The page where the user stopped reading
 *                 example: 120
 *     responses:
 *       200:
 *         description: Reading session ended successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 _id:
 *                   type: string
 *                 startPage:
 *                   type: number
 *                 endPage:
 *                   type: number
 *                 pagesRead:
 *                   type: number
 *                 duration:
 *                   type: number
 *                 startTime:
 *                   type: string
 *                   format: date-time
 *                 endTime:
 *                   type: string
 *                   format: date-time
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Reading session not found
 *       500:
 *         description: Server error
 */
router.post('/end', authenticate, endReading)
router.patch('/goal', authenticate, updateDailyGoal)

/**
 * @swagger
 * /api/book/stats:
 *   get:
 *     summary: Get user reading statistics
 *     tags: [Books]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Successfully retrieved user statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 dailyGoal:
 *                   type: number
 *                   example: 30
 *                   description: Daily reading goal in minutes
 *                 todayReadingMinutes:
 *                   type: number
 *                   example: 45
 *                   description: Total minutes read today
 *                 totalHoursRead:
 *                   type: number
 *                   example: 120.5
 *                   description: Total reading hours accumulated
 *                 currentStreak:
 *                   type: number
 *                   example: 7
 *                   description: Current reading streak in days
 *                 bestStreak:
 *                   type: number
 *                   example: 14
 *                   description: Longest reading streak achieved
 *                 completedBooks:
 *                   type: number
 *                   example: 12
 *                   description: Total books completed
 *                 currentlyReading:
 *                   type: number
 *                   example: 3
 *                   description: Books currently being read
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Error fetching statistics
 */
router.get('/stats', authenticate, getStatistics)

export default router
