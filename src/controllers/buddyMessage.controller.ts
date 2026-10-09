import type { Request, Response } from 'express'
import { Types } from 'mongoose'

import Buddy from '../models/buddy.js'
import BuddyMessage, {
  MAX_BUDDY_MESSAGE_LENGTH,
  type BuddyMessageKind,
} from '../models/buddyMessage.js'
import User from '../models/User.js'
import { notify } from '../services/notification.service.js'

const errMessage = (error: unknown) => (error instanceof Error ? error.message : 'Unknown error')
const param = (value: unknown): string => (Array.isArray(value) ? value[0] : String(value ?? ''))

const PAGE_SIZE = 40

async function myBuddy(buddyId: string, userId: string) {
  if (!Types.ObjectId.isValid(buddyId)) return null
  return Buddy.findOne({ _id: buddyId, users: userId, status: 'active' })
}

function partnerOf(users: unknown[], meId: string): string | undefined {
  return users.map(String).find((id) => id !== meId)
}

export const listMessages = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const buddy = await myBuddy(param(req.params.buddyId), req.user.id)
    if (!buddy) return res.status(404).json({ message: 'That buddy space could not be found' })

    const before = req.query.before ? new Date(String(req.query.before)) : null
    const query: Record<string, unknown> = { buddy: buddy._id }
    if (before && !Number.isNaN(before.getTime())) query.createdAt = { $lt: before }

    const messages = await BuddyMessage.find(query)
      .sort({ createdAt: -1 })
      .limit(PAGE_SIZE + 1)
      .lean()

    const hasMore = messages.length > PAGE_SIZE
    const page = hasMore ? messages.slice(0, PAGE_SIZE) : messages

    // Opening the conversation is what marks it read. Anything else needs the
    // client to remember to say so, and clients forget.
    await BuddyMessage.updateMany(
      { buddy: buddy._id, author: { $ne: req.user.id }, readAt: { $exists: false } },
      { $set: { readAt: new Date() } },
    )

    return res.json({
      // Oldest first, which is the order a conversation is read in.
      messages: page.reverse(),
      hasMore,
    })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/**
 * Say something.
 *
 * The notification is deliberately not the message text. A buddy space is
 * private, and a push notification is shown on a lock screen to whoever is
 * holding the phone -- so it says that there is something to read, not what it
 * says.
 */
export const postMessage = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const buddy = await myBuddy(param(req.params.buddyId), req.user.id)
    if (!buddy) return res.status(404).json({ message: 'That buddy space could not be found' })

    const body = String(req.body?.body ?? '').trim()
    if (!body) return res.status(400).json({ message: 'Write something first' })
    if (body.length > MAX_BUDDY_MESSAGE_LENGTH) {
      return res.status(400).json({ message: 'That message is too long' })
    }

    const kinds: BuddyMessageKind[] = ['text', 'quote', 'note', 'milestone']
    const asked = String(req.body?.kind ?? 'text') as BuddyMessageKind
    const kind: BuddyMessageKind = kinds.includes(asked) ? asked : 'text'

    const me = await User.findById(req.user.id).select('username').lean()

    const message = await BuddyMessage.create({
      buddy: buddy._id,
      author: req.user.id,
      authorName: me?.username ?? 'A reader',
      kind,
      body,
      book: Types.ObjectId.isValid(String(req.body?.book)) ? String(req.body.book) : undefined,
      page: Number.isFinite(Number(req.body?.page)) ? Number(req.body.page) : undefined,
    })

    buddy.lastMessageAt = new Date()
    await buddy.save()

    const partner = partnerOf(buddy.users, req.user.id)
    if (partner) {
      await notify({
        user: partner,
        type: 'BUDDY_MESSAGE',
        category: 'buddies',
        title: `${me?.username ?? 'Your buddy'} sent a message`,
        message: 'Open your buddy space to read it.',
        actionRoute: '/buddies',
        actionId: String(buddy._id),
        // One nudge per conversation per hour, however much is said in it.
        dedupeKey: `buddy-message:${buddy._id}:${Math.floor(Date.now() / 3600000)}`,
      })
    }

    return res.status(201).json(message)
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/** React, or take the reaction back. Tapping the same emoji twice undoes it. */
export const reactToMessage = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const buddy = await myBuddy(param(req.params.buddyId), req.user.id)
    if (!buddy) return res.status(404).json({ message: 'That buddy space could not be found' })

    const emoji = String(req.body?.emoji ?? '').slice(0, 8)
    if (!emoji) return res.status(400).json({ message: 'Pick a reaction' })

    const message = await BuddyMessage.findOne({
      _id: param(req.params.messageId),
      buddy: buddy._id,
    })
    if (!message) return res.status(404).json({ message: 'That message could not be found' })

    const existing = message.reactions.findIndex(
      (reaction) => String(reaction.user) === req.user!.id && reaction.emoji === emoji,
    )

    if (existing >= 0) {
      message.reactions.splice(existing, 1)
    } else {
      message.reactions.push({ emoji, user: new Types.ObjectId(req.user.id) })
    }

    await message.save()
    return res.json(message)
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/**
 * Withdraw a message.
 *
 * A tombstone, not a delete -- the row stays so the conversation around it
 * still reads in order, and so a reported message cannot be made to vanish
 * before anyone has looked at it.
 */
export const deleteMessage = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const buddy = await myBuddy(param(req.params.buddyId), req.user.id)
    if (!buddy) return res.status(404).json({ message: 'That buddy space could not be found' })

    const message = await BuddyMessage.findOneAndUpdate(
      { _id: param(req.params.messageId), buddy: buddy._id, author: req.user.id },
      { $set: { deletedAt: new Date(), body: 'This message was withdrawn' } },
      { new: true },
    )
    if (!message) return res.status(404).json({ message: 'That message could not be found' })

    return res.json(message)
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}
