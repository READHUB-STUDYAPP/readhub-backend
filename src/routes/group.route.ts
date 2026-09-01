import express from 'express'
import {
  addBook,
  createGroup,
  getGroup,
  joinGroup,
  leaveGroup,
  listGroups,
  recordProgress,
  removeBook,
  rotateInvite,
  setTarget,
  setVisibility,
} from '../controllers/group.controller.js'
import { authenticate } from '../middlewares/auth.middleware.js'

const router = express.Router()

// Every route needs a caller: a group is private to its members, and joining is
// something a signed-in reader does for themselves.
router.use(authenticate)

router.post('/', createGroup)
router.get('/', listGroups)

// Before `/:groupId`, or "join" would be read as a group id.
router.post('/join', joinGroup)

router.get('/:groupId', getGroup)
router.delete('/:groupId/members/me', leaveGroup)
router.patch('/:groupId/visibility', setVisibility)
router.post('/:groupId/invite', rotateInvite)
router.post('/:groupId/books', addBook)
router.delete('/:groupId/books/:bookId', removeBook)
router.post('/:groupId/schedule', setTarget)
router.put('/:groupId/progress', recordProgress)

export default router
