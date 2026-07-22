import express from 'express'
import { generatePictureSignature } from '../controllers/userProfile.controller.js'
import { generatePdfSignature } from '../controllers/book.controller.js'
import { authenticate } from '../middlewares/auth.middleware.js'

const router = express.Router()

// Cloudinary signature generation route
router.get('/image', authenticate, generatePictureSignature)
router.get('/pdf', authenticate, generatePdfSignature)

export default router
