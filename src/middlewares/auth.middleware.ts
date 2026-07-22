import jwt from 'jsonwebtoken'
import type { Request, Response, NextFunction } from 'express'
import type { AuthUser } from '../types/express.js'

export const authenticate = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const authHeader = req.headers.authorization

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization token missing' })
    return
  }

  const token = authHeader.split(' ')[1] as string

  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET as string)
    req.user = decoded as AuthUser
    next()
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Access token expired' })
      return
    }
    const details = err instanceof Error ? err.message : String(err)
    res.status(401).json({ error: 'Invalid access token', details })
  }
}
