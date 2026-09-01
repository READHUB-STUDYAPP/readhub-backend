import crypto from 'crypto'
import { Request, Response } from 'express'
import { Types } from 'mongoose'

import Book from '../models/Books.js'
import GroupProgress from '../models/groupProgress.js'
import ReadingGroup, { MAX_BOOKS, MAX_MEMBERS } from '../models/readingGroup.js'

/**
 * Reading groups.
 *
 * Any user can create one. There is no privileged role and no invite from us --
 * a reader makes a group, shares its code, and whoever accepts is in.
 *
 * The rules the endpoints enforce, in one place because they are the feature:
 *
 *   Joining is an act.       Nobody can be added by someone else. The only way
 *                            in is to present a code yourself, which is what
 *                            makes "joining is consent" mean anything.
 *   Visibility is reversible. A member can hide their pages without leaving.
 *   Leaving takes it with you. Positions are deleted, not orphaned.
 *   The group holds the book. Members read the group's entry, so removing the
 *                            book removes the access.
 *
 * On query cost: every read here is bounded and indexed. A group is capped at
 * 50 members and 25 books, member lists come from one indexed lookup, and the
 * group screen reads all positions in a single query rather than one per
 * member. Nothing iterates a collection.
 */

const errMessage = (error: unknown) => (error instanceof Error ? error.message : 'Unknown error')

/** Short, unambiguous, and awkward to guess. No 0/O or 1/I. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function makeInviteCode(): string {
  const bytes = crypto.randomBytes(8)
  let code = ''
  for (let i = 0; i < 8; i += 1) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  return code
}

/**
 * The id of a reference, whether or not it has been populated.
 *
 * `members.user` is an ObjectId on a document read for writing and a user
 * object on one read for display. Comparing without this silently fails on the
 * populated shape -- `String({...})` is "[object Object]", which matches
 * nobody.
 */
function idOf(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  const populated = value as { _id?: unknown }
  return String(populated._id ?? value)
}

interface MemberLike {
  user: unknown
  role: string
  visible?: boolean
}

/** The caller's membership, or null when they are not in the group. */
function membershipOf<T extends { members: MemberLike[] }>(
  group: T,
  userId: string,
): MemberLike | null {
  return group.members.find((member) => idOf(member.user) === String(userId)) ?? null
}

export const createGroup = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id
    const name = String(req.body?.name ?? '').trim()

    if (!name) {
      return res.status(400).json({ message: 'A group needs a name' })
    }

    // Retried rather than checked-then-written: two people creating a group at
    // the same moment could otherwise pass the same check and collide on the
    // unique index.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const group = await ReadingGroup.create({
          name,
          description: String(req.body?.description ?? '').trim() || undefined,
          createdBy: userId,
          members: [{ user: userId, role: 'owner', visible: true, joinedAt: new Date() }],
          inviteCode: makeInviteCode(),
        })

        return res.status(201).json({ group })
      } catch (error) {
        const duplicate = (error as { code?: number })?.code === 11000
        if (!duplicate) throw error
      }
    }

    return res.status(500).json({ message: 'Could not allocate an invite code' })
  } catch (error) {
    return res.status(500).json({ message: 'Error creating group', error: errMessage(error) })
  }
}

/**
 * The groups the caller belongs to.
 *
 * One indexed query, and deliberately without books or the schedule: the list
 * screen shows a name, a member count and a book count, so sending the rest
 * would be paying to serialise what nothing renders.
 */
export const listGroups = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id

    const groups = await ReadingGroup.find({ 'members.user': userId })
      .select('name description createdBy members books updatedAt')
      .sort({ updatedAt: -1 })
      .limit(100)
      .populate('members.user', 'username profilePicture')
      .lean()

    return res.json({
      groups: groups.map((group) => ({
        _id: group._id,
        name: group.name,
        description: group.description,
        memberCount: group.members.length,
        bookCount: group.books.length,
        members: group.members.slice(0, 5).map((member) => member.user),
        updatedAt: group.updatedAt,
      })),
    })
  } catch (error) {
    return res.status(500).json({ message: 'Error loading groups', error: errMessage(error) })
  }
}

/**
 * One group, with everything its screen draws.
 *
 * Three queries whatever the size of the group: the group, its books, and every
 * member's position in one go. A per-member or per-book query here would be the
 * obvious way to write it and would cost fifty round trips on a full group.
 */
export const getGroup = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id

    const group = await ReadingGroup.findById(req.params.groupId)
      .populate('members.user', 'username profilePicture')
      .lean()

    if (!group) return res.status(404).json({ message: 'Group not found' })
    if (!membershipOf(group, userId)) {
      // Not "forbidden": which groups exist is not something a non-member needs
      // to learn from us.
      return res.status(404).json({ message: 'Group not found' })
    }

    const bookIds = group.books.map((entry) => entry.book)

    const [books, positions] = await Promise.all([
      Book.find({ _id: { $in: bookIds } })
        .select('title coverImageUrl fileUrl pages')
        .lean(),
      GroupProgress.find({ group: group._id }).select('book user lastPageRead minutes').lean(),
    ])

    // Members who have opted out are still shown as members -- the group can
    // see they are taking part -- but their pages are withheld here rather than
    // in the client, so they never leave the server.
    const hidden = new Set(
      group.members.filter((member) => member.visible === false).map((member) => idOf(member.user)),
    )

    return res.json({
      group: {
        _id: group._id,
        name: group.name,
        description: group.description,
        inviteCode: group.inviteCode,
        createdBy: group.createdBy,
        members: group.members,
        schedule: group.schedule,
        books: group.books.map((entry) => ({
          ...entry,
          detail: books.find((book) => String(book._id) === String(entry.book)) ?? null,
        })),
        progress: positions.filter((position) => !hidden.has(String(position.user))),
      },
    })
  } catch (error) {
    return res.status(500).json({ message: 'Error loading group', error: errMessage(error) })
  }
}

/**
 * Joins a group by presenting its code.
 *
 * The only way in. There is no endpoint that adds somebody else, because the
 * consent model rests on the reader doing this themselves.
 */
export const joinGroup = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id
    const code = String(req.body?.inviteCode ?? '')
      .trim()
      .toUpperCase()

    if (!code) return res.status(400).json({ message: 'An invite code is required' })

    const group = await ReadingGroup.findOne({ inviteCode: code })
    if (!group) return res.status(404).json({ message: 'That invite code does not match a group' })

    if (membershipOf(group, userId)) {
      return res.json({ group })
    }

    if (group.members.length >= MAX_MEMBERS) {
      return res.status(409).json({ message: 'This group is full' })
    }

    group.members.push({
      user: new Types.ObjectId(userId),
      role: 'member',
      visible: true,
      joinedAt: new Date(),
    })
    await group.save()

    return res.status(201).json({ group })
  } catch (error) {
    return res.status(500).json({ message: 'Error joining group', error: errMessage(error) })
  }
}

/** Leaves, taking every position in the group with it. */
export const leaveGroup = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id
    const groupId = req.params.groupId

    const group = await ReadingGroup.findById(groupId)
    if (!group) return res.status(404).json({ message: 'Group not found' })

    const membership = membershipOf(group, userId)
    if (!membership) return res.status(404).json({ message: 'Group not found' })

    // The last owner leaving would strand the group with nobody able to manage
    // it, so the group goes with them.
    const owners = group.members.filter((member) => member.role === 'owner')
    if (membership.role === 'owner' && owners.length === 1) {
      await Promise.all([
        ReadingGroup.deleteOne({ _id: groupId }),
        GroupProgress.deleteMany({ group: groupId }),
      ])
      return res.json({ message: 'Group deleted' })
    }

    group.members = group.members.filter(
      (member) => idOf(member.user) !== String(userId),
    ) as typeof group.members
    await group.save()

    // Nothing of theirs is left behind in a group they have left.
    await GroupProgress.deleteMany({ group: groupId, user: userId })

    return res.json({ message: 'Left group' })
  } catch (error) {
    return res.status(500).json({ message: 'Error leaving group', error: errMessage(error) })
  }
}

/** Shows or hides the caller's own pages within one group. */
export const setVisibility = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id
    const visible = Boolean(req.body?.visible)

    // A positional update rather than load-modify-save: it touches one field of
    // one member and cannot lose a concurrent change to the rest of the group.
    const result = await ReadingGroup.updateOne(
      { _id: req.params.groupId, 'members.user': userId },
      { $set: { 'members.$.visible': visible } },
    )

    if (result.matchedCount === 0) return res.status(404).json({ message: 'Group not found' })
    return res.json({ visible })
  } catch (error) {
    return res.status(500).json({ message: 'Error updating visibility', error: errMessage(error) })
  }
}

/** Adds a book the caller owns to the group. */
export const addBook = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id
    const { bookId } = req.body ?? {}

    if (!bookId || !Types.ObjectId.isValid(String(bookId))) {
      return res.status(400).json({ message: 'A book is required' })
    }

    // Only a book of your own may be shared into a group.
    const book = await Book.findOne({ _id: bookId, uploadedBy: userId }).select('_id').lean()
    if (!book) return res.status(404).json({ message: 'Book not found in your library' })

    const group = await ReadingGroup.findOne({ _id: req.params.groupId, 'members.user': userId })
    if (!group) return res.status(404).json({ message: 'Group not found' })

    if (group.books.some((entry) => String(entry.book) === String(bookId))) {
      return res.json({ group })
    }

    if (group.books.length >= MAX_BOOKS) {
      return res.status(409).json({ message: 'This group already holds the most books it can' })
    }

    group.books.push({
      book: new Types.ObjectId(String(bookId)),
      addedBy: new Types.ObjectId(userId),
      addedAt: new Date(),
    })
    await group.save()

    return res.status(201).json({ group })
  } catch (error) {
    return res.status(500).json({ message: 'Error adding book', error: errMessage(error) })
  }
}

/**
 * Removes a book from the group, and with it everyone's access.
 *
 * Whoever added it, or an owner. The positions go too: they describe reading in
 * a book the group no longer holds.
 */
export const removeBook = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id
    const { groupId, bookId } = req.params

    const group = await ReadingGroup.findById(groupId)
    if (!group) return res.status(404).json({ message: 'Group not found' })

    const membership = membershipOf(group, userId)
    if (!membership) return res.status(404).json({ message: 'Group not found' })

    const entry = group.books.find((item) => String(item.book) === String(bookId))
    if (!entry) return res.status(404).json({ message: 'That book is not in this group' })

    if (membership.role !== 'owner' && String(entry.addedBy) !== String(userId)) {
      return res.status(403).json({ message: 'Only the reader who added this book can remove it' })
    }

    group.books = group.books.filter(
      (item) => String(item.book) !== String(bookId),
    ) as typeof group.books
    group.schedule = group.schedule.filter(
      (target) => String(target.book) !== String(bookId),
    ) as typeof group.schedule
    await group.save()

    await GroupProgress.deleteMany({ group: groupId, book: bookId })

    return res.json({ message: 'Book removed' })
  } catch (error) {
    return res.status(500).json({ message: 'Error removing book', error: errMessage(error) })
  }
}

/** Sets what the group is aiming to have read, and by when. */
export const setTarget = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id
    const { bookId, targetPage, dueAt } = req.body ?? {}

    const page = Number(targetPage)
    const due = new Date(String(dueAt))

    if (!bookId || !Number.isFinite(page) || page < 1 || Number.isNaN(due.getTime())) {
      return res.status(400).json({ message: 'A book, a page and a date are required' })
    }

    const group = await ReadingGroup.findOne({ _id: req.params.groupId, 'members.user': userId })
    if (!group) return res.status(404).json({ message: 'Group not found' })

    if (!group.books.some((entry) => String(entry.book) === String(bookId))) {
      return res.status(400).json({ message: 'That book is not in this group' })
    }

    const existing = group.schedule.find((target) => String(target.book) === String(bookId))
    if (existing) {
      existing.targetPage = Math.round(page)
      existing.dueAt = due
    } else {
      group.schedule.push({
        book: new Types.ObjectId(String(bookId)),
        targetPage: Math.round(page),
        dueAt: due,
      })
    }

    await group.save()
    return res.json({ schedule: group.schedule })
  } catch (error) {
    return res.status(500).json({ message: 'Error setting target', error: errMessage(error) })
  }
}

/**
 * Records how far the caller has read in a group's book.
 *
 * An upsert against the unique key, so it is one round trip whether or not a
 * position exists, and two readers turning a page at the same moment cannot
 * produce two rows. Progress only ever moves forward, for the same reason it
 * does in a personal library: a phone syncing an old position should not undo
 * what the web already recorded.
 */
export const recordProgress = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id
    const { groupId } = req.params
    const { bookId, lastPageRead, minutes } = req.body ?? {}

    const page = Number(lastPageRead)
    if (!bookId || !Number.isFinite(page) || page < 0) {
      return res.status(400).json({ message: 'A book and a page are required' })
    }

    const member = await ReadingGroup.findOne({ _id: groupId, 'members.user': userId })
      .select('_id books')
      .lean()

    if (!member) return res.status(404).json({ message: 'Group not found' })
    if (!member.books.some((entry) => String(entry.book) === String(bookId))) {
      return res.status(400).json({ message: 'That book is not in this group' })
    }

    const read = Number(minutes)

    const progress = await GroupProgress.findOneAndUpdate(
      { group: groupId, book: bookId, user: userId },
      {
        $max: { lastPageRead: Math.round(page) },
        $inc: { minutes: Number.isFinite(read) && read > 0 ? Math.round(read) : 0 },
        $setOnInsert: { group: groupId, book: bookId, user: userId },
      },
      { upsert: true, new: true },
    ).lean()

    return res.json({ progress })
  } catch (error) {
    return res.status(500).json({ message: 'Error recording progress', error: errMessage(error) })
  }
}

/** Issues a new invite code, retiring the old one. */
export const rotateInvite = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id

    const group = await ReadingGroup.findOne({ _id: req.params.groupId, 'members.user': userId })
    if (!group) return res.status(404).json({ message: 'Group not found' })

    if (membershipOf(group, userId)?.role !== 'owner') {
      return res.status(403).json({ message: 'Only an owner can change the invite code' })
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      group.inviteCode = makeInviteCode()
      try {
        await group.save()
        return res.json({ inviteCode: group.inviteCode })
      } catch (error) {
        if ((error as { code?: number })?.code !== 11000) throw error
      }
    }

    return res.status(500).json({ message: 'Could not allocate an invite code' })
  } catch (error) {
    return res.status(500).json({ message: 'Error rotating invite', error: errMessage(error) })
  }
}
