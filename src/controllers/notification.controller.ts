import type { Request, Response } from 'express'

import DeviceToken from '../models/deviceToken.js'
import Notification, { type NotificationCategory } from '../models/notification.js'
import NotificationPreference from '../models/notificationPreference.js'
import Reminder from '../models/reminder.js'
import { preferencesFor } from '../services/notification.service.js'

/**
 * The notification centre, the settings behind it, and the reminders a reader
 * sets for themselves.
 *
 * Reading the centre is deliberately cheap: one indexed query for the page and
 * one count for the badge. Grouping happens here rather than at write time,
 * because what counts as "three replies to your discussion" depends on what the
 * reader has already seen.
 */

const errMessage = (error: unknown) => (error instanceof Error ? error.message : 'Unknown error')

const param = (value: unknown): string => (Array.isArray(value) ? value[0] : String(value ?? ''))

const PAGE_SIZE = 30

const CATEGORIES: NotificationCategory[] = [
  'reading',
  'community',
  'groups',
  'challenges',
  'events',
  'books',
  'system',
]

/** The notification centre: one page, newest first, plus the unread badge. */
export const listNotifications = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const category = String(req.query.category ?? 'all')
    const before = req.query.before ? new Date(String(req.query.before)) : null

    const filter: Record<string, unknown> = {
      user: req.user.id,
      cancelledAt: { $exists: false },
      // A queued notification is not news until it has been sent.
      sentAt: { $exists: true },
    }
    if (category !== 'all' && CATEGORIES.includes(category as NotificationCategory)) {
      filter.category = category
    }
    if (before && !Number.isNaN(before.getTime())) filter.createdAt = { $lt: before }

    const notifications = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .limit(PAGE_SIZE + 1)
      .lean()

    const hasMore = notifications.length > PAGE_SIZE
    const page = hasMore ? notifications.slice(0, PAGE_SIZE) : notifications

    const unread = await Notification.countDocuments({
      user: req.user.id,
      readAt: { $exists: false },
      sentAt: { $exists: true },
      cancelledAt: { $exists: false },
    })

    return res.json({ notifications: group(page), hasMore, unread })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/**
 * Collapse runs of the same type against the same target.
 *
 * "3 new replies to your discussion" rather than three rows, which is what
 * section 16 asks for. Only unread rows are collapsed: once something has been
 * read it has earned its own line in the history.
 */
function group(notifications: Record<string, any>[]): Record<string, any>[] {
  const out: Record<string, any>[] = []

  for (const notification of notifications) {
    const previous = out[out.length - 1]
    const sameThing =
      previous &&
      !previous.readAt &&
      !notification.readAt &&
      previous.type === notification.type &&
      previous.actionId === notification.actionId &&
      notification.actionId

    if (sameThing) {
      previous.groupedCount = (previous.groupedCount ?? 1) + 1
      previous.groupedIds = [...(previous.groupedIds ?? [previous._id]), notification._id]
    } else {
      out.push({ ...notification })
    }
  }

  return out
}

export const markRead = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const id = param(req.params.notificationId)
    await Notification.updateOne(
      { _id: id, user: req.user.id, readAt: { $exists: false } },
      { $set: { readAt: new Date() } },
    )
    return res.json({ message: 'Marked as read' })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

export const markAllRead = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const result = await Notification.updateMany(
      { user: req.user.id, readAt: { $exists: false } },
      { $set: { readAt: new Date() } },
    )
    return res.json({ message: 'All caught up', updated: result.modifiedCount })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/* ----------------------------------------------------------- preferences */

export const getPreferences = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })
    return res.json(await preferencesFor(req.user.id))
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

export const updatePreferences = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const update: Record<string, unknown> = {}

    // Categories arrive one at a time so a screen can toggle a single switch
    // without sending the whole tree back.
    if (req.body.categories && typeof req.body.categories === 'object') {
      for (const [category, toggles] of Object.entries(req.body.categories)) {
        if (!CATEGORIES.includes(category as NotificationCategory)) continue
        for (const [channel, value] of Object.entries(toggles as Record<string, unknown>)) {
          if (!['inApp', 'push', 'email'].includes(channel)) continue
          update[`categories.${category}.${channel}`] = value === true
        }
      }
    }

    for (const field of ['quietHoursStart', 'quietHoursEnd'] as const) {
      if (typeof req.body[field] === 'number') update[field] = req.body[field]
    }
    if (typeof req.body.timezone === 'string') update.timezone = req.body.timezone
    if (typeof req.body.inactivityEmails === 'boolean') {
      update.inactivityEmails = req.body.inactivityEmails
    }
    if (typeof req.body.fortnightlyResumeEmail === 'boolean') {
      update.fortnightlyResumeEmail = req.body.fortnightlyResumeEmail
    }

    const preference = await NotificationPreference.findOneAndUpdate(
      { user: req.user.id },
      { $set: update },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    )

    return res.json(preference)
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/**
 * One-click unsubscribe from the two nudge tracks.
 *
 * Deliberately unauthenticated: a mail client's unsubscribe button cannot log
 * in, and an unsubscribe that demands a password is one people report as spam
 * instead. It only ever switches the nudges off -- it cannot touch account or
 * security mail, and it cannot be used to change anything else.
 */
export const unsubscribeFromNudges = async (req: Request, res: Response) => {
  try {
    const user = param(req.query.u ?? req.body?.u)
    if (!user) return res.status(400).json({ message: 'Missing unsubscribe reference' })

    await NotificationPreference.findOneAndUpdate(
      { user },
      {
        $set: {
          inactivityEmails: false,
          fortnightlyResumeEmail: false,
          unsubscribedFromNudgesAt: new Date(),
        },
      },
      { upsert: true, setDefaultsOnInsert: true },
    )

    return res.json({
      message: 'You will not receive reading reminders by email. Account emails are unaffected.',
    })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/* -------------------------------------------------------------- reminders */

export const listReminders = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })
    return res.json(await Reminder.find({ user: req.user.id }).sort({ minuteOfDay: 1 }).lean())
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

export const createReminder = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const { frequency, days, minuteOfDay, targetMinutes, timezone } = req.body
    if (typeof minuteOfDay !== 'number' || minuteOfDay < 0 || minuteOfDay > 1439) {
      return res.status(400).json({ message: 'A reminder needs a time of day' })
    }

    const reminder = await Reminder.create({
      user: req.user.id,
      frequency: frequency ?? 'daily',
      days: Array.isArray(days) ? days : [],
      minuteOfDay,
      targetMinutes: targetMinutes ?? 20,
      timezone: timezone ?? 'Africa/Lagos',
    })

    return res.status(201).json(reminder)
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

export const updateReminder = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const id = param(req.params.reminderId)
    const update: Record<string, unknown> = {}
    for (const field of ['frequency', 'days', 'minuteOfDay', 'targetMinutes', 'timezone', 'enabled'] as const) {
      if (req.body[field] !== undefined) update[field] = req.body[field]
    }

    const reminder = await Reminder.findOneAndUpdate(
      { _id: id, user: req.user.id },
      { $set: update },
      { new: true },
    )
    if (!reminder) return res.status(404).json({ message: 'No such reminder' })

    return res.json(reminder)
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

export const deleteReminder = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    await Reminder.deleteOne({ _id: param(req.params.reminderId), user: req.user.id })
    return res.json({ message: 'Reminder removed' })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

/* ----------------------------------------------------------- push tokens */

/**
 * Register this device for push.
 *
 * Upserted on the token itself, so reinstalling the app or signing in as
 * someone else moves the device rather than leaving a second row that would
 * send one person's notifications to another's phone.
 */
export const registerDevice = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const { token, platform } = req.body
    if (!token || !['ios', 'android', 'web'].includes(platform)) {
      return res.status(400).json({ message: 'A push token and platform are required' })
    }

    const device = await DeviceToken.findOneAndUpdate(
      { token },
      {
        $set: {
          user: req.user.id,
          platform,
          enabled: true,
          failureCount: 0,
          lastSeenAt: new Date(),
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    )

    return res.status(201).json({ _id: device._id })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}

export const unregisterDevice = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    await DeviceToken.deleteOne({ token: param(req.body?.token), user: req.user.id })
    return res.json({ message: 'This device will no longer receive notifications' })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}
