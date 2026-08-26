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
      book.lastPageRead = lastPageRead
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
        startTime: new Date(),
        startPage,
      })
    } else {
      readingBook.startPage = startPage
      readingBook.startTime = new Date()
      await readingBook.save()
    }

    // Update streak on "start reading" (counts as reading for the day)
    const now = new Date()
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
    const { sessionId, endPage } = req.body
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

    const endTime = new Date()
    session.endTime = endTime

    const duration = (endTime.getTime() - session.startTime.getTime()) / 1000 / 60
    const durationMin = Math.round(duration)
    session.duration = durationMin
    session.endPage = endPage
    session.pagesRead = endPage - session.startPage!

    await session.save()

    // UPDATE USER STATS
    const today = new Date()
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

    const lastReadingStartTime = userStats?.lastReadingDate
      ? new Date(userStats.lastReadingDate).setHours(0, 0, 0, 0)
      : null
    const goalLockedToday = lastReadingStartTime === localTodayStartTime

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
      goalLockedToday,
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

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const todayStartTime = todayStart.getTime()
    const lastStartTime = stats.lastReadingDate
      ? new Date(stats.lastReadingDate).setHours(0, 0, 0, 0)
      : null

    // Once a user has started reading for the day, lock the reading goal until the next day.
    if (lastStartTime === todayStartTime) {
      return res.status(403).json({
        message: 'Daily reading goal is locked until tomorrow',
      })
    }

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
