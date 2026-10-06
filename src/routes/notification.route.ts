import express from 'express'

import {
  createReminder,
  deleteReminder,
  getPreferences,
  listNotifications,
  listReminders,
  markAllRead,
  markRead,
  registerDevice,
  unregisterDevice,
  unsubscribeFromNudges,
  updatePreferences,
  updateReminder,
} from '../controllers/notification.controller.js'
import { authenticate } from '../middlewares/auth.middleware.js'

const router = express.Router()

/**
 * Unsubscribe is deliberately before `authenticate`.
 *
 * A mail client's one-click unsubscribe cannot sign in, and an unsubscribe that
 * demands a password is one people report as spam instead. It can only switch
 * the two nudge tracks off, and never touches account or security mail.
 *
 * @swagger
 * /api/notifications/unsubscribe:
 *   post:
 *     summary: Turn off reading-reminder emails without signing in
 *     tags: [Notifications]
 *     responses:
 *       200: { description: Reminder emails are off; account email is unaffected }
 */
router.post('/unsubscribe', unsubscribeFromNudges)
router.get('/unsubscribe', unsubscribeFromNudges)

router.use(authenticate)

/**
 * @swagger
 * /api/notifications:
 *   get:
 *     summary: The notification centre
 *     description: >
 *       One page newest-first, with runs of the same unread event collapsed
 *       into a single row, plus the unread badge count.
 *     tags: [Notifications]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: category
 *         schema: { type: string, enum: [all, reading, community, groups, challenges, events, books, system] }
 *     responses:
 *       200: { description: Notifications, hasMore and the unread count }
 */
router.get('/', listNotifications)
router.post('/read-all', markAllRead)
router.post('/:notificationId/read', markRead)

router.get('/preferences', getPreferences)
router.patch('/preferences', updatePreferences)

router.get('/reminders', listReminders)
router.post('/reminders', createReminder)
router.patch('/reminders/:reminderId', updateReminder)
router.delete('/reminders/:reminderId', deleteReminder)

router.post('/devices', registerDevice)
router.delete('/devices', unregisterDevice)

export default router
