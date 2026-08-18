import type { Request, Response, NextFunction } from 'express'
import User from '../models/User.js'

// RBAC gate for admin-only routes. Runs AFTER `authenticate` (which sets
// req.user.id from the JWT). The role is verified against the database on every
// request — not trusted from the token — so revoking an admin takes effect
// immediately without waiting for the access token to expire.
export const requireAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.user?.id
    if (!userId) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }

    const user = await User.findById(userId).select('role').lean()
    if (!user || user.role !== 'admin') {
      res.status(403).json({ message: 'Admin access required' })
      return
    }

    req.user!.role = 'admin'
    next()
  } catch {
    res.status(500).json({ message: 'Authorization check failed' })
  }
}
