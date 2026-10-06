import express from 'express'

import {
  createAnnouncement,
  createCommunity,
  decideJoinRequest,
  deleteAnnouncement,
  discoverCommunities,
  getCommunity,
  joinCommunity,
  leaveCommunity,
  listActivity,
  listAnnouncements,
  listCommunityGroups,
  listJoinRequests,
  listMembers,
  listMyCommunities,
  reactToAnnouncement,
  removeMember,
  rotateInviteCode,
  setMemberRole,
  updateCommunity,
} from '../controllers/community.controller.js'
import {
  createChallenge,
  getChallengeBoard,
  joinChallenge,
  leaveChallenge,
  listChallenges,
} from '../controllers/challenge.controller.js'
import { authenticate } from '../middlewares/auth.middleware.js'

const router = express.Router()

// Everything here needs a caller: even discovery is scoped to "communities you
// are not already in", which is a question about somebody.
router.use(authenticate)

/**
 * @swagger
 * /api/communities:
 *   get:
 *     summary: The communities the caller belongs to
 *     tags: [Communities]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Communities with the caller's role in each }
 */
router.get('/', listMyCommunities)

/**
 * @swagger
 * /api/communities:
 *   post:
 *     summary: Create a community
 *     tags: [Communities]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: The new community, with the caller as owner }
 */
router.post('/', createCommunity)

/**
 * @swagger
 * /api/communities/discover:
 *   get:
 *     summary: Public communities the caller has not joined
 *     description: Backs the Discover tab, including its search box and category pills.
 *     tags: [Communities]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *     responses:
 *       200: { description: Public communities, most populous first }
 */
router.get('/discover', discoverCommunities)

/**
 * @swagger
 * /api/communities/join:
 *   post:
 *     summary: Join using an invite code
 *     tags: [Communities]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Joined }
 *       202: { description: A join request was raised for the admins }
 */
router.post('/join', joinCommunity)

router.get('/:communityId', getCommunity)
router.patch('/:communityId', updateCommunity)
router.post('/:communityId/join', joinCommunity)
router.delete('/:communityId/members/me', leaveCommunity)

router.get('/:communityId/members', listMembers)
router.patch('/:communityId/members/:userId/role', setMemberRole)
router.delete('/:communityId/members/:userId', removeMember)

router.get('/:communityId/requests', listJoinRequests)
router.patch('/:communityId/requests/:requestId', decideJoinRequest)

router.post('/:communityId/invite/rotate', rotateInviteCode)

router.get('/:communityId/groups', listCommunityGroups)
router.get('/:communityId/activity', listActivity)

router.get('/:communityId/announcements', listAnnouncements)
router.post('/:communityId/announcements', createAnnouncement)
router.post('/:communityId/announcements/:announcementId/react', reactToAnnouncement)
router.delete('/:communityId/announcements/:announcementId', deleteAnnouncement)

router.get('/:communityId/challenges', listChallenges)
router.post('/:communityId/challenges', createChallenge)
router.get('/:communityId/challenges/:challengeId/board', getChallengeBoard)
router.post('/:communityId/challenges/:challengeId/join', joinChallenge)
router.delete('/:communityId/challenges/:challengeId/join', leaveChallenge)

export default router
