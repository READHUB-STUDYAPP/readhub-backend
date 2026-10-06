import express from 'express'

import {
  buddyOverview,
  decideReport,
  getReport,
  hideBuddyProfile,
  listBuddyPairs,
  listReports,
} from '../controllers/moderation.controller.js'
import { authenticate } from '../middlewares/auth.middleware.js'
import { requireAdmin } from '../middlewares/rbac.js'

const router = express.Router()

// Everything behind this desk is somebody else's private business, looked at
// because it was reported. Authenticated and admin-only, with no exceptions.
router.use(authenticate, requireAdmin)

router.get('/overview', buddyOverview)
router.get('/reports', listReports)
router.get('/reports/:reportId', getReport)
router.patch('/reports/:reportId', decideReport)
router.get('/buddy-pairs', listBuddyPairs)
router.post('/buddy-profiles/:userId/hide', hideBuddyProfile)

export default router
