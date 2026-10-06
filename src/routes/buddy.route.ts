import express from 'express'

import {
  blockUser,
  cancelRequest,
  discoverBuddies,
  endBuddy,
  getBuddyProfile,
  getMyProfile,
  listBlocked,
  listMyBuddies,
  listRequests,
  reportUser,
  respondToRequest,
  saveMyProfile,
  sendRequest,
  unblockUser,
} from '../controllers/buddy.controller.js'
import {
  abandonRead,
  listReads,
  startRead,
  updateProgress,
  updateReadGoal,
} from '../controllers/buddyRead.controller.js'
import {
  deleteMessage,
  listMessages,
  postMessage,
  reactToMessage,
} from '../controllers/buddyMessage.controller.js'
import { authenticate } from '../middlewares/auth.middleware.js'

const router = express.Router()

// Every route here is about one named reader and the people they may reach, so
// none of it makes sense without a caller.
router.use(authenticate)

/**
 * @swagger
 * /api/buddies/profile:
 *   get:
 *     summary: The caller's Reading Buddy profile, limits and current usage
 *     tags: [Reading Buddy]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Profile (null when not set up yet), limits and options }
 */
router.get('/profile', getMyProfile)

/**
 * @swagger
 * /api/buddies/profile:
 *   put:
 *     summary: Create or update the caller's Reading Buddy profile
 *     tags: [Reading Buddy]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: The saved profile }
 */
router.put('/profile', saveMyProfile)

/**
 * @swagger
 * /api/buddies/discover:
 *   get:
 *     summary: Compatible readers, scored and sorted
 *     tags: [Reading Buddy]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: filter
 *         schema: { type: string, enum: [recommended, same-book, same-goal, same-genre] }
 *     responses:
 *       200: { description: Scored recommendations }
 *       409: { description: The caller has no buddy profile yet }
 */
router.get('/discover', discoverBuddies)

/* -------------------------------------------------------------- requests */

router.get('/requests', listRequests)
router.patch('/requests/:requestId', respondToRequest)
router.delete('/requests/:requestId', cancelRequest)

/* ------------------------------------------------------- safety controls */

// Before `/:buddyId`, or "blocked" would be read as a buddy id.
router.get('/blocked', listBlocked)
router.post('/users/:userId/block', blockUser)
router.delete('/users/:userId/block', unblockUser)
router.post('/users/:userId/report', reportUser)

/* --------------------------------------------------------- other readers */

router.get('/users/:userId', getBuddyProfile)
router.post('/users/:userId/request', sendRequest)

/* ------------------------------------------------------------ my buddies */

/**
 * @swagger
 * /api/buddies:
 *   get:
 *     summary: The caller's active buddies
 *     tags: [Reading Buddy]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Active pairs with the current shared read }
 */
router.get('/', listMyBuddies)
router.delete('/:buddyId', endBuddy)

/* --------------------------------------------------------- shared reading */

router.get('/:buddyId/reads', listReads)
router.post('/:buddyId/reads', startRead)
router.patch('/:buddyId/reads/:readId/progress', updateProgress)
router.patch('/:buddyId/reads/:readId/goal', updateReadGoal)
router.delete('/:buddyId/reads/:readId', abandonRead)

/* ------------------------------------------------------------ the chat */

router.get('/:buddyId/messages', listMessages)
router.post('/:buddyId/messages', postMessage)
router.post('/:buddyId/messages/:messageId/react', reactToMessage)
router.delete('/:buddyId/messages/:messageId', deleteMessage)

export default router
