import type { Request, Response } from 'express'
import fs from 'fs/promises'
import { createReadStream } from 'fs'
import { s3, GetObjectCommand, PutObjectCommand, S3_BUCKET, presignPut, publicUrl, buildKey } from '../config/s3.js'
import { isStoredFileUrl } from '../utils/validators.js'
import Book from '../models/Books.js'
import ReadingSession from '../models/readingSession.js'
import UserStats from '../models/userStatistics.js'
import Notes from '../models/Notes.js'

const errMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const generatePdfSignature = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Unauthorized' })

    const allowed = ['pdf', 'epub', 'doc', 'docx', 'txt']
    const contentType = String(req.query.contentType || 'application/octet-stream').toLowerCase()
    const requestedExt = String(req.query.ext || '').toLowerCase().replace(/^\./, '')
    const ext = contentType === 'application/epub+zip' ? 'epub' : requestedExt || 'pdf'
    if (!allowed.includes(ext)) {
      return res.status(400).json({ message: 'Unsupported file type' })
    }
    const key = buildKey('documents', req.user.id, ext)
    const uploadUrl = await presignPut(key, contentType)

    // Frontend PUTs the file to `uploadUrl`, then saves `publicUrl` on the book.
    res.json({ uploadUrl, method: 'PUT', key, contentType, publicUrl: publicUrl(key) })
  } catch (error) {
    res.status(500).json({ error: errMessage(error) })
  }
}

export const uploadBook = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Unauthorized' })
    const { title, coverImageUrl, fileUrl, pages } = req.body
    if (!title || !coverImageUrl || !fileUrl || !pages) {
      return res.status(400).json({ message: 'All fields are required' })
    }
    if (!isStoredFileUrl(coverImageUrl)) {
      return res.status(400).json({ error: 'Invalid image source' })
    }
    if (!isStoredFileUrl(fileUrl)) {
      return res.status(400).json({ error: 'Invalid file source' })
    }
    const newBook = new Book({
      title,
      coverImageUrl,
      fileUrl,
      pages,
      uploadedBy: req.user.id,
    })
    await newBook.save()
    res
      .status(201)
      .json({ message: 'Book uploaded successfully', book: newBook })
  } catch (error) {
    console.error('Error uploading book:', error)
    res.status(500).json({ message: `Error uploading book ${errMessage(error)}` })
  }
}

export const getBooks = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Unauthorized' })
    const books = await Book.find({ uploadedBy: req.user.id }).sort({
      createdAt: -1,
    })
    if (!books || books.length === 0) {
      return res
        .status(200)
        .json({ message: 'No books found for this user', books: [] })
    }

    res.json(books)
  } catch (error) {
    return res
      .status(500)
      .json({ message: 'Error from Book API', error: errMessage(error) })
  }
}

export const getBookContent = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Unauthorized' })

    const book = await Book.findOne({ _id: req.params.bookId, uploadedBy: req.user.id })
      .select('fileUrl')
      .lean()
    if (!book) return res.status(404).json({ message: 'Book not found' })

    const marker = `/${S3_BUCKET}/`
    const markerIndex = book.fileUrl.indexOf(marker)
    if (markerIndex < 0) return res.status(400).json({ message: 'Invalid stored file URL' })
    const key = book.fileUrl.slice(markerIndex + marker.length)
    const object = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }))

    res.setHeader('Content-Type', 'application/epub+zip')
    res.setHeader('Content-Disposition', 'inline')
    if (object.ContentLength !== undefined) res.setHeader('Content-Length', String(object.ContentLength))
    const body = object.Body as unknown as { pipe?: (destination: Response) => void } | undefined
    if (!body?.pipe) {
      return res.status(500).json({ message: 'Stored book content is unavailable' })
    }
    body.pipe(res)
  } catch (error) {
    return res.status(500).json({ message: `Error reading book ${errMessage(error)}` })
  }
}

export const updateBookProgress = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Unauthorized' })
    const { bookId } = req.params
    const { lastPageRead, status } = req.body
    const book = await Book.findOne({ _id: bookId, uploadedBy: req.user.id })
    if (!book) {
      return res.status(404).json({ message: 'Book not found' })
    }
    if (lastPageRead !== undefined) {
      // The furthest page wins. The same book may be read on the web and on a
      // phone that was offline, and whichever syncs last would otherwise drag
      // the other backwards -- a reader watching their progress undo itself.
      // Going back to re-read is still possible; it just is not synced as a
      // loss of progress.
      const incoming = Number(lastPageRead)
      if (Number.isFinite(incoming)) {
        book.lastPageRead = Math.max(incoming, Number(book.lastPageRead) || 0)
      }
    }
    if (status) {
      book.status = status
    }
    await book.save()
    res.json({ message: 'Book progress updated successfully', book })
  } catch (error) {
    return res
      .status(500)
      .json({ message: 'Error updating book progress', error: errMessage(error) })
  }
}

export const bookStatus = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Unauthorized' })

    const readingBooks = await Book.find({
      uploadedBy: req.user.id,
      status: 'reading',
    })
    const completedBooks = await Book.find({
      uploadedBy: req.user.id,
      status: 'completed',
    })

    res.json({
      reading: readingBooks,
      completed: completedBooks,
    })
  } catch (error) {
    return res
      .status(500)
      .json({ message: 'Error fetching book status', error: errMessage(error) })
  }
}

export const deleteBook = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Unauthorized' })
    const { bookId } = req.params
    const book = await Book.findOneAndDelete({
      _id: bookId,
      uploadedBy: req.user.id,
    })
    if (!book) {
      return res.status(404).json({ message: 'Book not found' })
    }
    await Notes.deleteMany({ book: bookId, user: req.user.id })
    await ReadingSession.deleteMany({ book: bookId, user: req.user.id })
    res.json({ message: 'Book deleted successfully' })
  } catch (error) {
    return res
      .status(500)
      .json({ message: 'Error deleting book', error: errMessage(error) })
  }
}

export const startReading = async (req: Request, res: Response) => {
  try {
    const { bookId, startPage } = req.body
    // When the reading actually began. Present for a session recorded offline
    // and replayed later; absent for one happening right now.
    const startedAt = clientTime(req.body?.startTime, new Date())

    // Reuse only an "open" session; otherwise create a new one (keeps history for stats/graphs).
    let readingBook = await ReadingSession.findOne({
      book: bookId,
      user: req.user!.id,
      $or: [{ endTime: { $exists: false } }, { endTime: null }],
    })

    if (!readingBook) {
      readingBook = await ReadingSession.create({
        user: req.user!.id,
        book: bookId,
        startTime: startedAt,
        startPage,
      })
    } else {
      readingBook.startPage = startPage
      readingBook.startTime = startedAt
      await readingBook.save()
    }

    // Update streak on "start reading" (counts as reading for the day). The
    // day is the one the reading happened on, which for a session replayed
    // from a phone's offline queue is not necessarily today.
    const now = startedAt
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)
    const todayStartTime = todayStart.getTime()

    let stats = await UserStats.findOne({ user: req.user!.id })
    if (!stats) {
      stats = await UserStats.create({ user: req.user!.id })
    }

    const lastStartTime = stats.lastReadingDate
      ? new Date(stats.lastReadingDate).setHours(0, 0, 0, 0)
      : null

    if (lastStartTime !== todayStartTime) {
      // New day: reset today's minutes counter
      stats.todayReadingMinutes = 0

      const yesterdayStart = new Date(todayStart)
      yesterdayStart.setDate(yesterdayStart.getDate() - 1)
      const yesterdayStartTime = yesterdayStart.getTime()

      if (lastStartTime === yesterdayStartTime) {
        stats.currentStreak = (stats.currentStreak || 0) + 1
      } else {
        stats.currentStreak = 1
      }

      if (stats.currentStreak > (stats.bestStreak || 0)) {
        stats.bestStreak = stats.currentStreak
      }
    }

    stats.lastReadingDate = now
    await stats.save()

    return res.status(201).json({
      message: 'Session recorded',
      session: readingBook,
    })
  } catch (error) {
    console.log(errMessage(error))
    return res.status(500).json({ message: errMessage(error) })
  }
}

export const endReading = async (req: Request, res: Response) => {
  try {
    const { sessionId, endPage, durationMinutes } = req.body
    const userId = req.user!.id

    // Scope to the requesting user so one user cannot end/alter another's session.
    const session = await ReadingSession.findOne({ _id: sessionId, user: userId })

    if (!session) {
      return res.status(404).json({ message: 'Session not found' })
    }

    // Prevent double-ending the same session (would double-count minutes).
    if (session.endTime) {
      return res.json(session)
    }

    // The session's own start is the floor: an end before it would produce
    // negative minutes.
    const endTime = clientTime(req.body?.endTime, new Date())
    session.endTime = endTime < session.startTime ? new Date() : endTime

    // Wall clock from start to now. This is an upper bound on reading, not a
    // measure of it: it counts every minute the reader sat in the background or
    // behind a locked screen.
    const elapsed = (session.endTime.getTime() - session.startTime.getTime()) / 1000 / 60
    const elapsedMin = Math.round(elapsed)

    // A client that tracks foreground time can report what was actually read.
    // It is trusted only to report *less*: pauses can only subtract, so a value
    // above the elapsed wall clock is impossible and is clamped rather than
    // believed. Without a client figure the wall clock stands, as before.
    const reported = Number(durationMinutes)
    const durationMin =
      Number.isFinite(reported) && reported >= 0
        ? Math.min(Math.round(reported), elapsedMin)
        : elapsedMin
    session.duration = durationMin
    session.endPage = endPage
    session.pagesRead = endPage - session.startPage!

    await session.save()

    // UPDATE USER STATS, against the day the reading happened rather than the
    // day it reached the server.
    const today = new Date(session.endTime)
    today.setHours(0, 0, 0, 0)

    let stats = await UserStats.findOne({ user: userId })

    if (!stats) {
      stats = await UserStats.create({ user: userId })
    }

    stats.totalMinutesRead += durationMin

    const now = new Date()
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)
    const todayStartTime = todayStart.getTime()

    const lastStartTime = stats.lastReadingDate
      ? new Date(stats.lastReadingDate).setHours(0, 0, 0, 0)
      : null

    if (lastStartTime !== todayStartTime) {
      stats.todayReadingMinutes = 0

      const yesterdayStart = new Date(todayStart)
      yesterdayStart.setDate(yesterdayStart.getDate() - 1)
      const yesterdayStartTime = yesterdayStart.getTime()

      if (lastStartTime === yesterdayStartTime) {
        stats.currentStreak = (stats.currentStreak || 0) + 1
      } else {
        stats.currentStreak = 1
      }

      if (stats.currentStreak > (stats.bestStreak || 0)) {
        stats.bestStreak = stats.currentStreak
      }
    }

    stats.todayReadingMinutes += durationMin
    stats.lastReadingDate = now

    await stats.save()

    res.json(session)
  } catch (error) {
    console.log(errMessage(error))
    res.status(500).json({ message: errMessage(error) })
  }
}

export const getStatistics = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id

    const localTodayStart = new Date()
    localTodayStart.setHours(0, 0, 0, 0)
    const localTodayStartTime = localTodayStart.getTime()

    const now = new Date()
    const utcMidnight = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    )
    const utcDay = utcMidnight.getUTCDay() // 0=Sun..6=Sat
    const daysSinceMonday = (utcDay + 6) % 7 // Mon=0..Sun=6
    const weekStart = new Date(utcMidnight)
    weekStart.setUTCDate(weekStart.getUTCDate() - daysSinceMonday)
    const weekEnd = new Date(weekStart)
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 7)

    const [userStats, completedBooks, currentlyReading, weekSessions] =
      await Promise.all([
        UserStats.findOne({ user: userId }).lean(),

        Book.countDocuments({
          uploadedBy: userId,
          status: 'completed',
        }),

        Book.countDocuments({
          uploadedBy: userId,
          status: 'reading',
        }),

        ReadingSession.find({
          user: userId,
          endTime: { $gte: weekStart, $lt: weekEnd },
          // "number" is a valid MongoDB $type alias but absent from Mongoose's TS union.
          duration: { $type: 'number' as unknown as 'double' },
        })
          .select('duration endTime')
          .lean(),
      ])

    const dailyGoal = userStats?.dailyReadingGoal || 30
    const weekMinutes = Array.from({ length: 7 }, () => 0)

    ;(weekSessions || []).forEach((s) => {
      if (!s?.endTime) return
      const d = new Date(s.endTime)
      const idx = (d.getUTCDay() + 6) % 7 // Mon=0..Sun=6
      const minutes = Number(s.duration || 0)
      if (!Number.isFinite(minutes) || minutes <= 0) return
      weekMinutes[idx] += minutes
    })

    res.status(200).json({
      dailyGoal,
      todayReadingMinutes: userStats?.todayReadingMinutes || 0,
      totalHoursRead: Number(
        ((userStats?.totalMinutesRead || 0) / 60).toFixed(1),
      ),
      currentStreak: userStats?.currentStreak || 0,
      bestStreak: userStats?.bestStreak || 0,
      completedBooks,
      currentlyReading,
      weekMinutes,
    })
  } catch (error) {
    res.status(500).json({
      message: 'Error fetching statistics',
      error: errMessage(error),
    })
  }
}

/**
 * A timestamp a client says something happened at.
 *
 * Sessions read offline are replayed when the phone finds a network, sometimes
 * a day later, and they belong to the day they were read -- otherwise the
 * readers who read most, on the worst connections, are the ones whose streaks
 * break.
 *
 * The clock is the phone's, so it is believed only within limits: nothing in
 * the future, and nothing older than a few days. Outside that window the
 * server's own clock is used, which records the reading without letting a
 * wrong or deliberately altered clock rewrite history.
 */
const CLIENT_TIME_WINDOW_MS = 3 * 24 * 60 * 60 * 1000

function clientTime(value: unknown, fallback: Date): Date {
  if (typeof value !== 'string') return fallback

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return fallback

  const now = Date.now()
  if (parsed.getTime() > now) return fallback
  if (now - parsed.getTime() > CLIENT_TIME_WINDOW_MS) return fallback

  return parsed
}

export const updateDailyGoal = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id
    const dailyGoalRaw =
      req.body?.dailyGoal ?? req.body?.dailyReadingGoal ?? req.body?.goal

    const dailyGoal = Number(dailyGoalRaw)
    if (!Number.isFinite(dailyGoal) || dailyGoal < 0 || dailyGoal > 24 * 60) {
      return res.status(400).json({
        message: 'dailyGoal must be a number between 0 and 1440',
      })
    }

    const stats =
      (await UserStats.findOne({ user: userId })) ||
      (await UserStats.create({ user: userId }))

    // The goal is editable at any time.
    //
    // It used to lock for the rest of the day as soon as a session started, and
    // `lastReadingDate` is set by `startReading` on every session -- so anyone
    // who read daily could never change their goal again. The only day it could
    // be edited was a day they had not read at all.
    //
    // Nothing depended on the lock: the streak counts days with any reading at
    // all, not days the goal was met, so there was no target to game by moving
    // it. It only stopped people setting a target that suited them.
    stats.dailyReadingGoal = Math.round(dailyGoal)
    await stats.save()

    return res.status(200).json({ dailyGoal: stats.dailyReadingGoal })
  } catch (error) {
    return res.status(500).json({
      message: 'Error updating daily goal',
      error: errMessage(error),
    })
  }
}

// Upload a book file via backend (useful for large files where direct-to-Cloudinary browser upload may fail)
export const uploadBookFile = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Unauthorized' })
    if (!req.file?.path) {
      return res.status(400).json({ message: 'No file uploaded' })
    }

    const filePath = req.file.path

    try {
      const ext = req.file.originalname?.split('.').pop() || 'bin'
      const key = buildKey('documents', req.user.id, ext)
      await s3.send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: key,
          Body: createReadStream(filePath),
          ContentType: req.file.mimetype || 'application/octet-stream',
          ContentLength: req.file.size,
        }),
      )

      return res.status(200).json({ url: publicUrl(key), key, bytes: req.file.size })
    } finally {
      // Best-effort cleanup of temp file
      fs.unlink(filePath).catch(() => {})
    }
  } catch (error) {
    return res.status(500).json({
      message: 'Error uploading file',
      error: errMessage(error),
    })
  }
}
