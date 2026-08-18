import express from 'express'
import { authenticate } from '../middlewares/auth.middleware.js'
import { requireAdmin } from '../middlewares/rbac.js'
import {
  getMe,
  inviteAdmin,
  listInvites,
  acceptInvite,
  getOverview,
  getReaders,
  getBooks,
} from '../controllers/admin.controller.js'

const router = express.Router()

/**
 * @swagger
 * tags:
 *   name: Admin
 *   description: Admin dashboard & admin management (RBAC-protected)
 */

/**
 * @swagger
 * /api/admin/invite/accept:
 *   post:
 *     summary: Accept an admin invitation and set up the admin account (public)
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, username, password]
 *             properties:
 *               token: { type: string }
 *               username: { type: string }
 *               password: { type: string, example: StrongPass123 }
 *     responses:
 *       201: { description: Admin account ready }
 *       400: { description: Invalid or expired invite / validation error }
 *       409: { description: Username or email already in use }
 */
// Public — the invitee is not an admin (or not logged in) yet.
router.post('/invite/accept', acceptInvite)

// Everything below requires a logged-in admin.
router.use(authenticate, requireAdmin)

/**
 * @swagger
 * /api/admin/me:
 *   get:
 *     summary: Get the current admin's profile
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Admin profile }
 *       403: { description: Admin access required }
 */
router.get('/me', getMe)

/**
 * @swagger
 * /api/admin/invite:
 *   post:
 *     summary: Invite another admin (emails an accept link)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, example: newadmin@example.com }
 *     responses:
 *       201: { description: Invitation created (returns acceptUrl) }
 *       400: { description: Invalid email }
 *       409: { description: User is already an admin }
 */
router.post('/invite', inviteAdmin)

/**
 * @swagger
 * /api/admin/invites:
 *   get:
 *     summary: List pending admin invitations
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Pending invites }
 */
router.get('/invites', listInvites)

/**
 * @swagger
 * /api/admin/overview:
 *   get:
 *     summary: Dashboard headline stats, weekly reading chart, popular books, recent activity
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Overview payload }
 */
router.get('/overview', getOverview)

/**
 * @swagger
 * /api/admin/readers:
 *   get:
 *     summary: Paginated readers list
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20 } }
 *       - { in: query, name: search, schema: { type: string } }
 *       - { in: query, name: status, schema: { type: string, enum: [all, active, inactive] } }
 *       - { in: query, name: sort, schema: { type: string, enum: [newest, oldest] } }
 *     responses:
 *       200: { description: Readers page }
 */
router.get('/readers', getReaders)

/**
 * @swagger
 * /api/admin/books:
 *   get:
 *     summary: Paginated library (books de-duplicated by title with reader counts)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20 } }
 *       - { in: query, name: search, schema: { type: string } }
 *       - { in: query, name: status, schema: { type: string, enum: [all, active, inactive] } }
 *       - { in: query, name: sort, schema: { type: string, enum: [newest, oldest] } }
 *     responses:
 *       200: { description: Books page }
 */
router.get('/books', getBooks)

export default router
