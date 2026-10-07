import type { Request, Response } from 'express'

import { BADGES, achievementsFor, readingSummaryFor } from '../services/achievements.js'

const errMessage = (error: unknown) => (error instanceof Error ? error.message : 'Unknown error')

/**
 * The caller's own badges.
 *
 * Returns the catalogue alongside them so a client can show what else there is
 * to aim for on the reader's *own* profile -- which is encouragement -- while
 * the public profile returns only what was earned, because a stranger's page
 * listing what they have not managed is nobody's business.
 */
export const getMyAchievements = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' })

    const [earned, reading] = await Promise.all([
      achievementsFor(req.user.id),
      readingSummaryFor(req.user.id),
    ])

    const earnedKeys = new Set(earned.map((badge) => badge.key))

    return res.json({
      earned,
      reading,
      available: BADGES.filter((badge) => !earnedKeys.has(badge.key)),
    })
  } catch (error) {
    return res.status(500).json({ message: errMessage(error) })
  }
}
