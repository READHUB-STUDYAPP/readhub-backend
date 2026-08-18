import type { Request, Response } from 'express'
import crypto from 'node:crypto'
import bcrypt from 'bcrypt'
import { Types } from 'mongoose'
import User from '../models/User.js'
import Book from '../models/Books.js'
import ReadingSession from '../models/readingSession.js'
import UserStats from '../models/userStatistics.js'
import AdminInvite from '../models/AdminInvite.js'
import { sendAdminInvite } from '../services/sendAdminInvite.js'

const errMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// A reader is "active" if they've read within this many days.
const ACTIVE_DAYS = 14
const INVITE_TTL_DAYS = Number(process.env.ADMIN_INVITE_TTL_DAYS) || 3

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const sha256 = (v: string): string =>
  crypto.createHash('sha256').update(v).digest('hex')

const toInt = (v: unknown, def: number): number => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def
}

/* ============================ ADMIN MANAGEMENT ============================ */

// GET /api/admin/me — current admin's profile
export const getMe = async (req: Request, res: Response) => {
  try {
    const admin = await User.findById(req.user!.id)
      .select('username email role profilePicture createdAt')
      .lean()
    if (!admin) return res.status(404).json({ message: 'Admin not found' })
    return res.json({ admin })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

// POST /api/admin/invite — a logged-in admin invites another admin
export const inviteAdmin = async (req: Request, res: Response) => {
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase()
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ message: 'A valid email is required' })
    }

    const existing = await User.findOne({ email }).select('role').lean()
    if (existing?.role === 'admin') {
      return res.status(409).json({ message: 'This user is already an admin' })
    }

    // One active invite per email — clear any previous unaccepted ones.
    await AdminInvite.deleteMany({ email, acceptedAt: { $exists: false } })

    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000)

    await AdminInvite.create({
      email,
      tokenHash: sha256(token),
      invitedBy: req.user!.id,
      expiresAt,
    })

    const base = (
      process.env.ADMIN_APP_URL ||
      process.env.FRONTEND_URL ||
      ''
    ).replace(/\/$/, '')
    const acceptUrl = `${base}/admin/accept-invite?token=${token}`

    const inviter = await User.findById(req.user!.id).select('username').lean()
    const emailResult = await sendAdminInvite(
      email,
      acceptUrl,
      inviter?.username || 'A ReadHub admin',
    )

    return res.status(201).json({
      message: 'Admin invitation created',
      invite: { email, expiresAt },
      emailed: emailResult.success,
      // Returned so an admin can share the link manually (e.g. if email is
      // not yet configured). This endpoint is admin-only.
      acceptUrl,
    })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

// GET /api/admin/invites — list pending (unaccepted, unexpired) invites
export const listInvites = async (_req: Request, res: Response) => {
  try {
    const invites = await AdminInvite.find({
      acceptedAt: { $exists: false },
      expiresAt: { $gt: new Date() },
    })
      .populate('invitedBy', 'username email')
      .select('email invitedBy expiresAt createdAt')
      .sort({ createdAt: -1 })
      .lean()
    return res.json({ invites })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

// POST /api/admin/invite/accept — PUBLIC: invitee sets up their admin account
export const acceptInvite = async (req: Request, res: Response) => {
  try {
    const token = String(req.body?.token ?? '')
    const username = String(req.body?.username ?? '').trim()
    const password = String(req.body?.password ?? '')

    if (!token || !username || !password) {
      return res
        .status(400)
        .json({ message: 'token, username and password are required' })
    }
    if (password.length < 6) {
      return res
        .status(400)
        .json({ message: 'Password must be at least 6 characters' })
    }

    const invite = await AdminInvite.findOne({
      tokenHash: sha256(token),
      acceptedAt: { $exists: false },
    })
    if (!invite || invite.expiresAt < new Date()) {
      return res.status(400).json({ message: 'Invalid or expired invite' })
    }

    const hashedPassword = await bcrypt.hash(password, 12)
    const existing = await User.findOne({ email: invite.email })

    if (existing) {
      // Promote an existing account to admin and ensure it can log in locally.
      existing.role = 'admin'
      existing.password = hashedPassword
      if (!existing.provider.includes('local')) existing.provider.push('local')
      await existing.save()
    } else {
      await User.create({
        username,
        email: invite.email,
        password: hashedPassword,
        provider: ['local'],
        role: 'admin',
      })
    }

    invite.acceptedAt = new Date()
    await invite.save()

    return res.status(201).json({
      message: 'Admin account ready. You can now log in.',
    })
  } catch (error) {
    if ((error as { code?: number })?.code === 11000) {
      return res.status(409).json({ message: 'Username or email already in use' })
    }
    return res.status(500).json({ message: errMessage(error) })
  }
}

/* ============================== DASHBOARD =============================== */

// GET /api/admin/overview — headline stats + weekly chart + popular books + activity
export const getOverview = async (_req: Request, res: Response) => {
  try {
    const now = new Date()
    const startOfMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    )
    const activeSince = new Date(now.getTime() - ACTIVE_DAYS * 86400000)

    // Week window (Mon..Sun, UTC) for the reading chart.
    const utcMidnight = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    )
    const daysSinceMonday = (utcMidnight.getUTCDay() + 6) % 7
    const weekStart = new Date(utcMidnight)
    weekStart.setUTCDate(weekStart.getUTCDate() - daysSinceMonday)
    const weekEnd = new Date(weekStart)
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 7)

    const [
      totalReaders,
      newThisMonth,
      activeReaders,
      totalBooks,
      hoursAgg,
      weekAgg,
      popularBooks,
      recent,
    ] = await Promise.all([
      // Readers = non-admin users. `$ne: 'admin'` also covers legacy users
      // created before the `role` field existed (their role is undefined).
      User.countDocuments({ role: { $ne: 'admin' } }),
      User.countDocuments({
        role: { $ne: 'admin' },
        createdAt: { $gte: startOfMonth },
      }),
      UserStats.countDocuments({ lastReadingDate: { $gte: activeSince } }),
      Book.distinct('title').then((t) => t.length),
      UserStats.aggregate<{ _id: null; minutes: number }>([
        { $group: { _id: null, minutes: { $sum: '$totalMinutesRead' } } },
      ]),
      ReadingSession.aggregate<{ _id: number; minutes: number }>([
        {
          $match: {
            endTime: { $gte: weekStart, $lt: weekEnd },
            duration: { $type: 'number' },
          },
        },
        {
          $group: {
            _id: { $isoDayOfWeek: '$endTime' }, // 1=Mon..7=Sun
            minutes: { $sum: '$duration' },
          },
        },
      ]),
      Book.aggregate<{ title: string; readers: number; coverImageUrl: string }>([
        {
          $group: {
            _id: '$title',
            readers: { $addToSet: '$uploadedBy' },
            coverImageUrl: { $first: '$coverImageUrl' },
          },
        },
        {
          $project: {
            _id: 0,
            title: '$_id',
            coverImageUrl: 1,
            readers: { $size: '$readers' },
          },
        },
        { $sort: { readers: -1 } },
        { $limit: 5 },
      ]),
      ReadingSession.find({ endTime: { $ne: null } })
        .sort({ endTime: -1 })
        .limit(8)
        .populate('user', 'username')
        .populate('book', 'title')
        .select('user book duration endTime')
        .lean(),
    ])

    const weekMinutes = Array.from({ length: 7 }, () => 0)
    for (const row of weekAgg) {
      const idx = row._id - 1 // Mon=0..Sun=6
      if (idx >= 0 && idx < 7) weekMinutes[idx] = row.minutes
    }

    const recentActivity = recent.map((s) => {
      const u = s.user as unknown as { username?: string } | null
      const b = s.book as unknown as { title?: string } | null
      return {
        reader: u?.username ?? 'Unknown',
        book: b?.title ?? 'Unknown',
        minutes: s.duration ?? 0,
        at: s.endTime,
      }
    })

    return res.json({
      stats: {
        totalReaders,
        newReadersThisMonth: newThisMonth,
        activeReaders,
        totalBooks,
        totalReadingHours: Number(((hoursAgg[0]?.minutes ?? 0) / 60).toFixed(1)),
      },
      weekMinutes,
      popularBooks,
      recentActivity,
    })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

// GET /api/admin/readers — paginated readers with search/status/sort
export const getReaders = async (req: Request, res: Response) => {
  try {
    const page = toInt(req.query.page, 1)
    const limit = Math.min(toInt(req.query.limit, 20), 100)
    const skip = (page - 1) * limit
    const search = String(req.query.search ?? '').trim()
    const status = String(req.query.status ?? 'all') // active | inactive | all
    const sortDir = String(req.query.sort ?? 'newest') === 'oldest' ? 1 : -1
    const activeSince = new Date(Date.now() - ACTIVE_DAYS * 86400000)

    // Readers = non-admin users (also includes legacy users with no role field).
    const match: Record<string, unknown> = { role: { $ne: 'admin' } }
    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i')
      match.$or = [{ username: rx }, { email: rx }]
    }

    const statusStage =
      status === 'active' || status === 'inactive'
        ? [{ $match: { status } }]
        : []

    const result = await User.aggregate([
      { $match: match },
      {
        $lookup: {
          from: 'userstats',
          localField: '_id',
          foreignField: 'user',
          as: 'statsArr',
        },
      },
      { $addFields: { stats: { $arrayElemAt: ['$statsArr', 0] } } },
      {
        $lookup: {
          from: 'books',
          localField: '_id',
          foreignField: 'uploadedBy',
          as: 'bookDocs',
        },
      },
      {
        $addFields: {
          booksCount: { $size: '$bookDocs' },
          readingMinutes: { $ifNull: ['$stats.totalMinutesRead', 0] },
          lastActive: '$stats.lastReadingDate',
          status: {
            $cond: [
              {
                $and: [
                  { $ne: ['$stats.lastReadingDate', null] },
                  { $gte: ['$stats.lastReadingDate', activeSince] },
                ],
              },
              'active',
              'inactive',
            ],
          },
        },
      },
      ...statusStage,
      { $sort: { createdAt: sortDir } },
      {
        $facet: {
          data: [
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                _id: 1,
                username: 1,
                email: 1,
                profilePicture: 1,
                booksCount: 1,
                readingMinutes: 1,
                lastActive: 1,
                status: 1,
                createdAt: 1,
              },
            },
          ],
          meta: [{ $count: 'total' }],
        },
      },
    ])

    const data = (result[0]?.data ?? []) as Array<{
      _id: Types.ObjectId
      currentBook?: string | null
    }>
    const total = (result[0]?.meta?.[0]?.total ?? 0) as number

    // Attach each reader's current book (most recently updated "reading" book).
    const ids = data.map((r) => r._id)
    if (ids.length) {
      const reading = await Book.find({
        uploadedBy: { $in: ids },
        status: 'reading',
      })
        .sort({ updatedAt: -1 })
        .select('uploadedBy title')
        .lean()
      const currentByUser = new Map<string, string>()
      for (const b of reading) {
        const key = String(b.uploadedBy)
        if (!currentByUser.has(key)) currentByUser.set(key, b.title)
      }
      for (const r of data) {
        r.currentBook = currentByUser.get(String(r._id)) ?? null
      }
    }

    return res.json({
      data,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

// GET /api/admin/books — the library, de-duplicated by title, with reader counts
export const getBooks = async (req: Request, res: Response) => {
  try {
    const page = toInt(req.query.page, 1)
    const limit = Math.min(toInt(req.query.limit, 20), 100)
    const skip = (page - 1) * limit
    const search = String(req.query.search ?? '').trim()
    const status = String(req.query.status ?? 'all') // active | inactive | all
    const sortDir = String(req.query.sort ?? 'newest') === 'oldest' ? 1 : -1

    const preMatch = search
      ? [{ $match: { title: new RegExp(escapeRegex(search), 'i') } }]
      : []
    const statusStage =
      status === 'active' || status === 'inactive'
        ? [{ $match: { status } }]
        : []

    const result = await Book.aggregate([
      ...preMatch,
      {
        $group: {
          _id: '$title',
          readerSet: { $addToSet: '$uploadedBy' },
          coverImageUrl: { $first: '$coverImageUrl' },
          copies: { $sum: 1 },
          lastUpdated: { $max: '$updatedAt' },
        },
      },
      {
        $addFields: {
          readers: { $size: '$readerSet' },
          // No library-level status in the per-user Book model; derive one.
          status: {
            $cond: [{ $gt: [{ $size: '$readerSet' }, 0] }, 'active', 'inactive'],
          },
          // genre/author are not part of the current Book schema.
          genre: null,
          author: null,
        },
      },
      ...statusStage,
      { $sort: { lastUpdated: sortDir } },
      {
        $facet: {
          data: [
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                _id: 0,
                title: '$_id',
                coverImageUrl: 1,
                readers: 1,
                copies: 1,
                genre: 1,
                author: 1,
                status: 1,
                lastUpdated: 1,
              },
            },
          ],
          meta: [{ $count: 'total' }],
        },
      },
    ])

    const data = result[0]?.data ?? []
    const total = (result[0]?.meta?.[0]?.total ?? 0) as number

    return res.json({
      data,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}
