import express from 'express'

import {
  decideAuthorVerification,
  followAuthor,
  getAuthor,
  getAuthorDashboard,
  getMyAuthorProfile,
  listAuthors,
  listBook,
  listPendingAuthors,
  listReviews,
  requestVerification,
  unlistBook,
  upsertAuthorProfile,
  upsertReview,
} from '../controllers/author.controller.js'
import { authenticate } from '../middlewares/auth.middleware.js'
import { requireAdmin } from '../middlewares/rbac.js'

const router = express.Router()

router.use(authenticate)

/**
 * @swagger
 * /api/authors/me:
 *   get:
 *     summary: The caller's own author profile
 *     tags: [Authors]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: The profile, or null if they have not made one }
 */
router.get('/me', getMyAuthorProfile)
router.put('/me', upsertAuthorProfile)
router.post('/me/verify', requestVerification)
router.get('/me/dashboard', getAuthorDashboard)

router.post('/me/books', listBook)
router.delete('/me/books/:bookId', unlistBook)

/**
 * @swagger
 * /api/authors/pending:
 *   get:
 *     summary: The verification queue
 *     description: Admin only. Verification is a human judgement about authorship.
 *     tags: [Authors]
 *     security: [{ bearerAuth: [] }]
 */
router.get('/pending', requireAdmin, listPendingAuthors)
router.patch('/:authorId/verification', requireAdmin, decideAuthorVerification)

router.get('/', listAuthors)
router.get('/:authorId', getAuthor)
router.post('/:authorId/follow', followAuthor)

router.get('/books/:bookId/reviews', listReviews)
router.put('/books/:bookId/reviews', upsertReview)

export default router
