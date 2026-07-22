import express from 'express'
import {
  login,
  logout,
  register,
  passwordTokenVerification,
  resetPassword,
  refreshToken,
  googleAuth,
  passwordOTP,
} from '../controllers/auth.controller.js'

const router = express.Router()

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - email
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *                 example: johndoe
 *               email:
 *                 type: string
 *                 example: johndoe@example.com
 *               password:
 *                 type: string
 *                 example: myStrongPassword123
 *     responses:
 *       201:
 *         description: User registered successfully
 *       400:
 *         description: Validation error or email/username already exists
 */
router.post('/register', register)

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login with email and password
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 example: johndoe@example.com
 *               password:
 *                 type: string
 *                 example: myStrongPassword123
 *     responses:
 *       200:
 *         description: Login successful, returns accessToken
 *       400:
 *         description: Invalid credentials
 */
router.post('/login', login)

/**
 * @swagger
 * /api/auth/google:
 *   post:
 *     summary: Authenticate or register using Google
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - idToken
 *             properties:
 *               idToken:
 *                 type: string
 *                 example: your-google-id-token
 *     responses:
 *       200:
 *         description: Google authentication successful
 *       400:
 *         description: Invalid token or email not verified
 */
router.post('/google', googleAuth)

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     summary: Refresh access token using refresh token cookie
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Returns new accessToken
 *       401:
 *         description: Refresh token missing
 *       403:
 *         description: Invalid refresh token
 */
router.post('/refresh', refreshToken)

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Logout user and clear refresh token
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: User logged out successfully
 *       401:
 *         description: Refresh token missing
 */
router.post('/logout', logout)

/**
 * @swagger
 * /api/auth/forget-password:
 *   post:
 *     summary: Request password reset OTP
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 example: johndoe@example.com
 *     responses:
 *       201:
 *         description: Verification code sent
 *       400:
 *         description: Validation error
 *       401:
 *         description: User not found
 */
router.post('/forget-password', passwordOTP)

/**
 * @swagger
 * /api/auth/password-token-verification:
 *   post:
 *     summary: Verify OTP code for password reset
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - code
 *             properties:
 *               code:
 *                 type: string
 *                 example: 123456
 *     responses:
 *       200:
 *         description: Code is valid
 *       400:
 *         description: Invalid or expired code
 */
router.post('/password-token-verification', passwordTokenVerification)

/**
 * @swagger
 * /api/auth/reset-password:
 *   patch:
 *     summary: Reset password using OTP code
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *               - code
 *             properties:
 *               email:
 *                 type: string
 *                 example: johndoe@example.com
 *               password:
 *                 type: string
 *                 example: NewStrongPassword123
 *               code:
 *                 type: string
 *                 example: 123456
 *     responses:
 *       200:
 *         description: Password reset successfully
 *       400:
 *         description: Validation error or invalid code
 *       404:
 *         description: User not found
 */
router.patch('/reset-password', resetPassword)

export default router
