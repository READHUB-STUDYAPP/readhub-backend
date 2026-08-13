import type { Request, Response, NextFunction } from 'express'

// Recursively removes keys that MongoDB could interpret as query operators
// ($-prefixed) or dotted paths. This blocks NoSQL operator injection via the
// request body (e.g. { "code": { "$ne": null } }) while leaving normal
// string/number/array payloads untouched.
function stripOperators(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) stripOperators(item)
    return
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    for (const key of Object.keys(obj)) {
      if (key.startsWith('$') || key.includes('.')) {
        delete obj[key]
      } else {
        stripOperators(obj[key])
      }
    }
  }
}

export const sanitizeBody = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  if (req.body) stripOperators(req.body)
  next()
}
