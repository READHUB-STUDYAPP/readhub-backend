import express from 'express'
import {
  addToWaitlist,
  getWaitlistUsers,
} from '../controllers/waitlist.controller.js'

const router = express.Router()

router.post('/add', addToWaitlist)
router.get('/users', getWaitlistUsers)

export default router
