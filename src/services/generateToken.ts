import jwt, { type SignOptions } from 'jsonwebtoken'

export interface TokenPayload {
  id: string
  iat?: number
  exp?: number
}

const accessSecret = (): string => process.env.ACCESS_TOKEN_SECRET as string
const refreshSecret = (): string => process.env.REFRESH_TOKEN_SECRET as string
/**
 * The access token is meant to be short-lived; it is replaced by refreshing.
 */
const accessExpiresIn = (): SignOptions['expiresIn'] =>
  (process.env.JWT_EXPIRES_IN as SignOptions['expiresIn']) ?? '15m'

/**
 * The refresh token has to outlive the access token by a wide margin -- that
 * is the entire point of it.
 *
 * Both used to read JWT_EXPIRES_IN, so with the usual 15m the refresh token
 * expired at the very moment the access token it was supposed to replace did.
 * Every refresh after the first fifteen minutes failed verification, answered
 * 403, and signed the user out. The session could never outlast one access
 * token, which read as being "logged out constantly".
 *
 * Defaulted rather than required, so an existing deployment that has not set
 * the new variable gets a working lifetime instead of the broken one.
 */
const refreshExpiresIn = (): SignOptions['expiresIn'] =>
  (process.env.REFRESH_TOKEN_EXPIRES_IN as SignOptions['expiresIn']) ?? '30d'

export const generateAccessToken = (user: object): string => {
  return jwt.sign(user, accessSecret(), { expiresIn: accessExpiresIn() })
}

export const generateRefreshToken = (user: object): string => {
  return jwt.sign(user, refreshSecret(), { expiresIn: refreshExpiresIn() })
}

export const verifyAccessToken = (token: string): string | jwt.JwtPayload => {
  try {
    return jwt.verify(token, accessSecret())
  } catch (err) {
    throw err
  }
}
