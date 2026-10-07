import type { Request, Response } from 'express'
import { Types } from 'mongoose'

import Book from '../models/Books.js'
import Buddy from '../models/buddy.js'
import BuddyRead from '../models/buddyRead.js'
import User from '../models/User.js'
import { checkBuddyBadges } from '../services/achievements.js'
import { notify } from '../services/notification.service.js'

const errMessage = (error: unknown) => (error instanceof Error ? error.message : 'Unknown error')
const param = (value: unknown): string => (Array.isArray(value) ? value[0] : String(value ?? ''))

/**
 * The pair, if the caller is in it.
 *
 * Returns null for both "no such pair" and "not yours", and every caller turns
 * that into the same 404. A 403 here would confirm that a given buddy space
 * exists, which is not something a stranger should be able to learn.
 */
async function myBuddy(buddyId: string, userId: string) {
  if (!Types.ObjectId.isValid(buddyId)) return null
  return Buddy.findOne({ _id: buddyId, users: userId, status: 'active' })
}

/** The other half of a pair. */
function partnerOf(users: unknown[], meId: string): string | undefined {
  return users.map(String).find((id) => id !== meId)
}

/* ------------------------------------------------------------------- reads */

export const listReads = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const buddy = await myBuddy(param(req.params.buddyId), req.user.id)
    if (!buddy) return res.status(404).json({ message: 'That buddy space could not be found' })

    const reads = await BuddyRead.find({ buddy: buddy._id })
      .sort({ startedAt: -1 })
      .populate('book', 'title author coverImage pageCount')
      .lean()

    return res.json(reads)
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/**
 * Start reading something together.
 *
 * One live read at a time per pair. Two books in flight turns a shared goal
 * into two private ones, and the progress bar stops meaning anything -- so an
 * existing active read has to be finished or set aside first, and the caller is
 * told which it is rather than being given a bare refusal.
 */
export const startRead = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const buddy = await myBuddy(param(req.params.buddyId), req.user.id)
    if (!buddy) return res.status(404).json({ message: 'That buddy space could not be found' })

    const bookId = String(req.body?.book ?? '')
    if (!Types.ObjectId.isValid(bookId)) {
      return res.status(400).json({ message: 'Choose a book to read together' })
    }

    const book = await Book.findById(bookId).select('title pageCount').lean()
    if (!book) return res.status(404).json({ message: 'That book could not be found' })

    const existing = await BuddyRead.findOne({ buddy: buddy._id, status: 'active' }).lean()
    if (existing) {
      return res.status(409).json({
        message: `You are already reading ${existing.bookTitle} together. Finish or set that aside first.`,
        currentRead: existing,
      })
    }

    const targetPage = Number(req.body?.targetPage)
    const targetDate = req.body?.targetDate ? new Date(req.body.targetDate) : undefined

    if (targetDate && Number.isNaN(targetDate.getTime())) {
      return res.status(400).json({ message: 'That target date could not be read' })
    }

    const read = await BuddyRead.create({
      buddy: buddy._id,
      book: bookId,
      bookTitle: book.title,
      targetPage: Number.isFinite(targetPage) && targetPage > 0 ? Math.round(targetPage) : undefined,
      targetDate,
      // Both sides start at zero, so the space has something to draw from the
      // moment it is created rather than after the first update.
      progress: buddy.users.map((user) => ({ user, page: 0, updatedAt: new Date() })),
      createdBy: req.user.id,
    })

    buddy.currentRead = read._id as Types.ObjectId
    await buddy.save()

    const me = await User.findById(req.user.id).select('username').lean()
    const partner = partnerOf(buddy.users, req.user.id)

    if (partner) {
      await notify({
        user: partner,
        type: 'BUDDY_READ_STARTED',
        category: 'buddies',
        title: 'A new book to read together',
        message: `${me?.username ?? 'Your buddy'} started ${book.title}. Set your pace and get going.`,
        actionRoute: '/buddies',
        actionId: String(buddy._id),
        dedupeKey: `buddy-read:${read._id}`,
      })
    }

    return res.status(201).json(read)
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/**
 * Record how far the caller has got.
 *
 * Only ever the caller's own entry: a buddy updating their partner's progress
 * would make the number meaningless, however well meant.
 */
export const updateProgress = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const buddy = await myBuddy(param(req.params.buddyId), req.user.id)
    if (!buddy) return res.status(404).json({ message: 'That buddy space could not be found' })

    const read = await BuddyRead.findOne({
      _id: param(req.params.readId),
      buddy: buddy._id,
      status: 'active',
    })
    if (!read) return res.status(404).json({ message: 'That shared read could not be found' })

    const page = Number(req.body?.page)
    if (!Number.isFinite(page) || page < 0) {
      return res.status(400).json({ message: 'That page number could not be read' })
    }

    const entry = read.progress.find((row) => String(row.user) === req.user!.id)
    const previous = entry?.page ?? 0
    const now = Math.round(page)

    if (entry) {
      entry.page = now
      entry.updatedAt = new Date()
    } else {
      read.progress.push({ user: new Types.ObjectId(req.user.id), page: now, updatedAt: new Date() })
    }

    // Reaching the target is worth marking once, and only once.
    const target = read.targetPage
    const justFinished =
      target !== undefined && now >= target && previous < target && !entry?.completedAt

    if (justFinished && entry) entry.completedAt = new Date()

    // The pair finishes when both have. That is the moment worth celebrating.
    const everyoneDone =
      target !== undefined &&
      read.progress.length === 2 &&
      read.progress.every((row) => row.page >= target)

    if (everyoneDone && read.status === 'active') {
      read.status = 'completed'
      read.completedAt = new Date()
    }

    await read.save()

    const me = await User.findById(req.user.id).select('username').lean()
    const partner = partnerOf(buddy.users, req.user.id)

    if (everyoneDone) {
      buddy.currentRead = undefined
      buddy.completedReads += 1
      await buddy.save()

      for (const user of buddy.users) void checkBuddyBadges(String(user))

      // Both sides hear about it: a finish is the pair's, not one person's.
      await Promise.all(
        buddy.users.map((user) =>
          notify({
            user: String(user),
            type: 'BUDDY_READ_COMPLETED',
            category: 'buddies',
            title: `You both finished ${read.bookTitle}`,
            message: 'That is one more book read together. Pick the next one when you are ready.',
            actionRoute: '/buddies',
            actionId: String(buddy._id),
            dedupeKey: `buddy-read-done:${read._id}`,
          }),
        ),
      )
    } else if (justFinished && partner) {
      await notify({
        user: partner,
        type: 'BUDDY_MILESTONE',
        category: 'buddies',
        title: `${me?.username ?? 'Your buddy'} reached the target`,
        message: `They finished their part of ${read.bookTitle}. No rush -- carry on at your own pace.`,
        actionRoute: '/buddies',
        actionId: String(buddy._id),
        dedupeKey: `buddy-milestone:${read._id}:${req.user.id}`,
      })
    }

    return res.json(read)
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/** Set a read aside without pretending it was finished. */
export const abandonRead = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const buddy = await myBuddy(param(req.params.buddyId), req.user.id)
    if (!buddy) return res.status(404).json({ message: 'That buddy space could not be found' })

    const read = await BuddyRead.findOneAndUpdate(
      { _id: param(req.params.readId), buddy: buddy._id, status: 'active' },
      { $set: { status: 'abandoned' } },
      { new: true },
    )
    if (!read) return res.status(404).json({ message: 'That shared read could not be found' })

    if (String(buddy.currentRead) === String(read._id)) {
      buddy.currentRead = undefined
      await buddy.save()
    }

    return res.json({ message: 'Set aside', read })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/** Change the goal after the fact -- a date slips, a target was optimistic. */
export const updateReadGoal = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const buddy = await myBuddy(param(req.params.buddyId), req.user.id)
    if (!buddy) return res.status(404).json({ message: 'That buddy space could not be found' })

    const update: Record<string, unknown> = {}

    if (req.body?.targetPage !== undefined) {
      const targetPage = Number(req.body.targetPage)
      if (!Number.isFinite(targetPage) || targetPage < 1) {
        return res.status(400).json({ message: 'That target could not be read' })
      }
      update.targetPage = Math.round(targetPage)
    }

    if (req.body?.targetDate !== undefined) {
      const targetDate = new Date(req.body.targetDate)
      if (Number.isNaN(targetDate.getTime())) {
        return res.status(400).json({ message: 'That target date could not be read' })
      }
      update.targetDate = targetDate
    }

    const read = await BuddyRead.findOneAndUpdate(
      { _id: param(req.params.readId), buddy: buddy._id, status: 'active' },
      { $set: update },
      { new: true },
    )
    if (!read) return res.status(404).json({ message: 'That shared read could not be found' })

    return res.json(read)
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}
