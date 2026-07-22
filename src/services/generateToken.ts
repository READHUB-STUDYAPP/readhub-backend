import jwt, { type SignOptions } from 'jsonwebtoken'

export interface TokenPayload {
  id: string
  iat?: number
  exp?: number
}

const accessSecret = (): string => process.env.ACCESS_TOKEN_SECRET as string
const refreshSecret = (): string => process.env.REFRESH_TOKEN_SECRET as string
const expiresIn = (): SignOptions['expiresIn'] =>
  process.env.JWT_EXPIRES_IN as SignOptions['expiresIn']

export const generateAccessToken = (user: object): string => {
  return jwt.sign(user, accessSecret(), { expiresIn: expiresIn() })
}

export const generateRefreshToken = (user: object): string => {
  return jwt.sign(user, refreshSecret(), { expiresIn: expiresIn() })
}

export const verifyAccessToken = (token: string): string | jwt.JwtPayload => {
  try {
    return jwt.verify(token, accessSecret())
  } catch (err) {
    throw err
  }
}
