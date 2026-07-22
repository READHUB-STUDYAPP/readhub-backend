// Augments Express's Request with the authenticated user attached by the
// `authenticate` middleware (decoded JWT payload).
import 'express'

export interface AuthUser {
  id: string
  iat?: number
  exp?: number
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

export {}
