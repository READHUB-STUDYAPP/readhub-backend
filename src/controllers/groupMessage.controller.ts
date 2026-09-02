import { Request, Response } from 'express'
import { Types } from 'mongoose'

import GroupMessage, { MAX_MESSAGE_LENGTH } from '../models/groupMessage.js'
import ReadingGroup from '../models/readingGroup.js'
import User from '../models/User.js'

/**
 * Comments in a reading group.
 *
 * The rules that matter here are about what happens to a conversation when the
 * people in it change:
 *
 *   A message outlives its author.  Leaving the group, being removed from it,
 *                                  or closing an account entirely leaves every
 *                                  comment in place. A thread that loses half
 *                                  its messages stops making sense to the
 *                                  people who stayed.
 *   Withdrawing leaves a tombstone. The row survives so replies beneath it
 *                                  still have a parent to hang from.
 *   Only members can read or write. A conversation is private to the group; a
 *                                  former member keeps their messages there but
 *                                  cannot add more or read on.
 *
 * Reading is bounded: one page of messages, one aggregate for reply counts, one
 * lookup for the parents being quoted, and one for which authors are still
 * members. Four queries for a page of any size, rather than a handful per
 * message.
 */

const errMessage = (error: unknown) => (error instanceof Error ? error.message : 'Unknown error')

const PAGE_SIZE = 40

/** What a reader sees in place of a name that is gone. */
const FORMER_MEMBER = 'Former member'

function idOf(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  const populated = value as { _id?: unknown }
  return String(populated._id ?? value)
}

/** The caller's membership, or null when they are not in the group. */
async function requireMembership(groupId: unknown, userId: string) {
  const id = String(groupId ?? '')
  if (!Types.ObjectId.isValid(id)) return null

  const group = await ReadingGroup.findOne({ _id: id, 'members.user': userId })
    .select('_id members books')
    .lean()

  return group ?? null
}

/**
 * Lists a group's comments, newest first.
 *
 * `before` is the cursor: pass the `createdAt` of the oldest message you have
 * and the next page comes back. A page is capped, so a group with ten thousand
 * comments costs the same as one with ten.
 */
export const listMessages = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id
    const groupId = String(req.params.groupId ?? '')

    const group = await requireMembership(groupId, userId)
    if (!group) return res.status(404).json({ message: 'Group not found' })

    const filter: Record<string, unknown> = { group: groupId }

    // A thread opened from the reader is about one book.
    if (req.query.book && Types.ObjectId.isValid(String(req.query.book))) {
      filter.book = String(req.query.book)
    }

    const before = req.query.before ? new Date(String(req.query.before)) : null
    if (before && !Number.isNaN(before.getTime())) {
      filter.createdAt = { $lt: before }
    }

    const limit = Math.min(Number(req.query.limit) || PAGE_SIZE, PAGE_SIZE)

    const messages = await GroupMessage.find(filter)
      .select('group book page replyTo author authorName body deletedAt editedAt createdAt')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()

    if (messages.length === 0) {
      return res.json({ messages: [], hasMore: false })
    }

    const ids = messages.map((message) => message._id)
    const parentIds = messages
      .map((message) => message.replyTo)
      .filter((id): id is Types.ObjectId => Boolean(id))
    const authorIds = [...new Set(messages.map((message) => idOf(message.author)).filter(Boolean))]

    const [replyCounts, parents, existingAuthors] = await Promise.all([
      // How many replies each message on this page has.
      GroupMessage.aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: { replyTo: { $in: ids }, deletedAt: { $exists: false } } },
        { $group: { _id: '$replyTo', count: { $sum: 1 } } },
      ]),

      // The messages being replied to, for the quoted line above a reply.
      parentIds.length
        ? GroupMessage.find({ _id: { $in: parentIds } })
            .select('authorName body deletedAt')
            .lean()
        : Promise.resolve([]),

      // Which authors still have an account. One query, not one per message.
      authorIds.length
        ? User.find({ _id: { $in: authorIds } })
            .select('_id username profilePicture')
            .lean()
        : Promise.resolve([]),
    ])

    const counts = new Map(replyCounts.map((row) => [String(row._id), row.count]))
    const parentById = new Map(parents.map((parent) => [String(parent._id), parent]))
    const accounts = new Map(existingAuthors.map((account) => [String(account._id), account]))
    const memberIds = new Set(group.members.map((member) => idOf(member.user)))

    return res.json({
      messages: messages.map((message) => {
        const authorId = idOf(message.author)
        const account = accounts.get(authorId)
        const parent = message.replyTo ? parentById.get(String(message.replyTo)) : null

        return {
          _id: message._id,
          book: message.book ?? null,
          page: message.page ?? null,
          // Withheld rather than blanked: the body of a withdrawn message
          // should not travel to anyone's device.
          body: message.deletedAt ? null : message.body,
          deleted: Boolean(message.deletedAt),
          editedAt: message.editedAt ?? null,
          createdAt: message.createdAt,

          author: authorId || null,
          // The account's current name if it still exists, the snapshot if the
          // account is gone.
          authorName: account?.username ?? message.authorName ?? FORMER_MEMBER,
          authorAvatar: account?.profilePicture ?? null,
          /** False once they leave, so the group can see who is still here. */
          authorIsMember: Boolean(authorId) && memberIds.has(authorId),
          /** True when the account itself is gone. */
          authorDeleted: Boolean(authorId) && !account,

          replyTo: parent
            ? {
                _id: parent._id,
                authorName: parent.authorName,
                body: parent.deletedAt ? null : parent.body,
                deleted: Boolean(parent.deletedAt),
              }
            : null,
          replyCount: counts.get(String(message._id)) ?? 0,
        }
      }),
      hasMore: messages.length === limit,
    })
  } catch (error) {
    return res.status(500).json({ message: 'Error loading comments', error: errMessage(error) })
  }
}

/** Posts a comment, optionally about a book, a page, or in reply to another. */
export const createMessage = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id
    const groupId = String(req.params.groupId ?? '')

    const group = await requireMembership(groupId, userId)
    if (!group) return res.status(404).json({ message: 'Group not found' })

    const body = String(req.body?.body ?? '').trim()
    if (!body) return res.status(400).json({ message: 'A comment cannot be empty' })
    if (body.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ message: `A comment is at most ${MAX_MESSAGE_LENGTH} characters` })
    }

    const { book, page, replyTo } = req.body ?? {}

    // A comment about a book the group does not hold would be orphaned from the
    // moment it was written.
    if (book) {
      if (!Types.ObjectId.isValid(String(book))) {
        return res.status(400).json({ message: 'That book is not valid' })
      }
      if (!group.books.some((entry) => idOf(entry.book) === String(book))) {
        return res.status(400).json({ message: 'That book is not in this group' })
      }
    }

    // Replies stay inside their own group, and cannot be attached to a
    // withdrawn message -- there would be nothing to answer.
    if (replyTo) {
      if (!Types.ObjectId.isValid(String(replyTo))) {
        return res.status(400).json({ message: 'That comment is not valid' })
      }

      const parent = await GroupMessage.findOne({ _id: replyTo, group: groupId })
        .select('_id deletedAt')
        .lean()

      if (!parent) return res.status(404).json({ message: 'That comment no longer exists' })
      if (parent.deletedAt) {
        return res.status(409).json({ message: 'That comment was removed' })
      }
    }

    // The name is copied in now, so the message can still say who wrote it
    // after the account is gone.
    const account = await User.findById(userId).select('username').lean()

    const message = await GroupMessage.create({
      group: groupId,
      book: book || undefined,
      page: Number.isFinite(Number(page)) && Number(page) > 0 ? Math.round(Number(page)) : undefined,
      replyTo: replyTo || undefined,
      author: userId,
      authorName: account?.username || FORMER_MEMBER,
      body,
    })

    // Bumps the group, so "my groups" sorts by real activity rather than by
    // when somebody last changed a setting.
    await ReadingGroup.updateOne({ _id: groupId }, { $set: { updatedAt: new Date() } })

    return res.status(201).json({ message })
  } catch (error) {
    return res.status(500).json({ message: 'Error posting comment', error: errMessage(error) })
  }
}

/** Edits a comment. Only its author, and only while it stands. */
export const editMessage = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id
    const groupId = String(req.params.groupId ?? '')
    const messageId = String(req.params.messageId ?? '')

    const group = await requireMembership(groupId, userId)
    if (!group) return res.status(404).json({ message: 'Group not found' })

    const body = String(req.body?.body ?? '').trim()
    if (!body) return res.status(400).json({ message: 'A comment cannot be empty' })
    if (body.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ message: `A comment is at most ${MAX_MESSAGE_LENGTH} characters` })
    }

    const message = await GroupMessage.findOne({ _id: messageId, group: groupId })
    if (!message) return res.status(404).json({ message: 'That comment no longer exists' })
    if (message.deletedAt) return res.status(409).json({ message: 'That comment was removed' })
    if (idOf(message.author) !== String(userId)) {
      return res.status(403).json({ message: 'Only the author can edit a comment' })
    }

    message.body = body
    message.editedAt = new Date()
    await message.save()

    return res.json({ message })
  } catch (error) {
    return res.status(500).json({ message: 'Error editing comment', error: errMessage(error) })
  }
}

/**
 * Withdraws a comment, leaving a tombstone.
 *
 * The author or an owner. The row is kept rather than removed so replies
 * beneath it still have a parent -- deleting it outright would silently take
 * other people's messages out of the conversation with it.
 */
export const deleteMessage = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id
    const groupId = String(req.params.groupId ?? '')
    const messageId = String(req.params.messageId ?? '')

    const group = await requireMembership(groupId, userId)
    if (!group) return res.status(404).json({ message: 'Group not found' })

    const message = await GroupMessage.findOne({ _id: messageId, group: groupId })
    if (!message) return res.status(404).json({ message: 'That comment no longer exists' })
    if (message.deletedAt) return res.json({ message: 'Already removed' })

    const isAuthor = idOf(message.author) === String(userId)
    const isOwner = group.members.some(
      (member) => idOf(member.user) === String(userId) && member.role === 'owner',
    )

    if (!isAuthor && !isOwner) {
      return res.status(403).json({ message: 'Only the author or an owner can remove a comment' })
    }

    message.deletedAt = new Date()
    // The text goes; the row, its author's name and its place in the thread
    // stay. Keeping the body of a withdrawn comment on the server would defeat
    // the point of withdrawing it.
    message.body = ''
    await message.save()

    return res.json({ message: 'Comment removed' })
  } catch (error) {
    return res.status(500).json({ message: 'Error removing comment', error: errMessage(error) })
  }
}
