import express from 'express'
import { authenticate } from '../middlewares/auth.middleware.js'
import {
  deleteUserProfile,
  getUserProfile,
  updateUserProfile,
} from '../controllers/userProfile.controller.js'

const router = express.Router()

/**
 * @swagger
 * /api/profile/update:
 *   patch:
 *     summary: Update logged-in user's profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *                 example: johndoe
 *               email:
 *                 type: string
 *                 example: johndoe@example.com
 *               profilePicture:
 *                 type: string
 *                 example: https://res.cloudinary.com/demo/image/upload/profile.jpg
 *     responses:
 *       200:
 *         description: User profile updated successfully
 *       400:
 *         description: Invalid input (e.g., invalid image URL)
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 */
router.patch('/update', authenticate, updateUserProfile)

/**
 * @swagger
 * /api/profile/:
 *   get:
 *     summary: Get logged-in user's profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile fetched successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 */
router.get('/', authenticate, getUserProfile)

/**
 * @swagger
 * /api/profile/delete:
 *   delete:
 *     summary: Delete logged-in user's profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile deleted successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 */
router.delete('/delete', authenticate, deleteUserProfile)

export default router
