import type { Request, Response } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import {
  generateAccessToken,
  generateRefreshToken,
  type TokenPayload,
} from '../services/generateToken.js'
import { verifyGoogleToken } from '../services/GoogleAuth.js'
import {
  isAppleAuthConfigured,
  verifyAppleToken,
} from '../services/AppleAuth.js'
import { sendVerificationEmail } from '../services/sendVerificationEmail.js'
import VerificationCode from '../models/Verify-user.js'

const errMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * Refresh-cookie Max-Age in milliseconds, derived from the same
 * REFRESH_TOKEN_EXPIRES_IN that sets the refresh JWT's lifetime, so the cookie
 * and the token it carries never drift. Without an explicit maxAge the browser
 * treats it as a session cookie and drops it on close — even though the token
 * inside is still valid — so web sessions would not survive a browser restart.
 * Accepts a duration like `7d`, `12h`, `30m`, `45s`; defaults to 7 days.
 */
const refreshCookieMaxAgeMs = (): number => {
  const raw = (process.env.REFRESH_TOKEN_EXPIRES_IN ?? '7d').trim()
  const match = /^(\d+)\s*([smhd])$/.exec(raw)
  const units: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }
  return match ? Number(match[1]) * units[match[2]] : 7 * 86_400_000
}

/**
 * How the refresh cookie is scoped.
 *
 * `strict` looks like the safe answer and quietly breaks the session: the app
 * and the API are on different hosts, and a browser will not send a strict
 * cookie on a request to another origin. The web client therefore asked to
 * renew its access token and sent nothing to renew it with, so every reader
 * was signed out a quarter of an hour after signing in -- and a developer
 * running the app locally against a deployed API never stayed signed in at
 * all.
 *
 * `none` is what a cookie shared between an app and an API on separate hosts
 * has to be, and it requires `secure`. What it gives away is small and already
 * covered: another site can cause a browser to call this endpoint, but CORS
 * only returns the response to origins we name, so it cannot read the token it
 * asks for, and the endpoint changes nothing on its own.
 *
 * Over plain HTTP -- a backend running locally -- `none` would be rejected for
 * lacking `secure`, so `lax` is used there instead.
 */
const refreshCookieOptions = () => {
  const overHttps = process.env.NODE_ENV === 'production'

  return {
    httpOnly: true,
    secure: overHttps,
    sameSite: (overHttps ? 'none' : 'lax') as 'none' | 'lax',
    maxAge: refreshCookieMaxAgeMs(),
  }
}

/**
 * Native apps cannot use the httpOnly refresh cookie: there is no cookie jar to
 * read it from, and nothing persists it across launches. They send the refresh
 * token explicitly instead, so accept it from the body or an Authorization-style
 * header as well as the cookie. Web is unaffected and keeps using the cookie.
 */
/**
 * Lowercases and trims an address before it is used in a query.
 *
 * The schema declares `lowercase: true`, but Mongoose applies setters on write
 * only -- never to query filters. So an account created as "John@Example.com" is
 * stored as "john@example.com" and then `findOne({ email: "John@Example.com" })`
 * finds nothing: the user cannot sign in with the address they signed up with,
 * and a Google or Apple sign-in for the same person creates a second account
 * instead of linking to the first.
 */
const normalizeEmail = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : ''

const readRefreshToken = (req: Request): string | undefined =>
  req.cookies?.refreshToken ||
  (typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : undefined) ||
  (typeof req.headers['x-refresh-token'] === 'string'
    ? (req.headers['x-refresh-token'] as string)
    : undefined)

/**
 * Whether to return the refresh token in the response body.
 *
 * Only for clients that identify themselves as native. Returning it
 * unconditionally would hand the web app a token in JS-readable form and undo
 * the point of the httpOnly cookie.
 */
const wantsTokenInBody = (req: Request): boolean => {
  const client = req.headers['x-client-platform']
  return (
    typeof client === 'string' && ['ios', 'android', 'mobile'].includes(client.toLowerCase())
  )
}

export const register = async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body
    const email = normalizeEmail(req.body.email)
    if (!username || !email || !password) {
      return res.status(400).json({ message: 'All fields are required' })
    }

    const existingUser = await User.findOne({
      $or: [{ email }, { username }],
    })

    if (existingUser) {
      return res
        .status(400)
        .json({ message: 'Email or username already in use' })
    }
    if (password.length < 6) {
      return res
        .status(400)
        .json({ message: 'Password must be at least 6 characters' })
    }

    const hashedPassword = await bcrypt.hash(password, 12)

    const newUser = new User({
      username,
      email,
      password: hashedPassword,
    })
    await newUser.save()
    return res.status(201).json({ message: 'User registered successfully' })
  } catch (error) {
    if ((error as { code?: number })?.code === 11000) {
      return res
        .status(400)
        .json({ message: 'Email or username already in use' })
    }
    return res.status(500).json({ message: errMessage(error) })
  }
}

/**
 * Signed-in devices kept per user. Beyond this the oldest is dropped, which
 * signs that device out -- a bound is needed because a token is added on every
 * sign-in and only removed on an explicit logout.
 */
const MAX_SESSIONS = 10

export const login = async (req: Request, res: Response) => {
  try {
    const { password } = req.body
    const email = normalizeEmail(req.body.email)

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required' })
    }

    const user = await User.findOne({ email })
    if (!user) {
      return res.status(400).json({ message: 'Invalid email or password' })
    }

    if (!user.password) {
      // No password has ever been set, so this account can only be reached
      // through the provider that created it. Name that provider rather than
      // assuming Google -- Apple sign-in reaches this branch too.
      //
      // Presence of a password is the whole test. Requiring 'local' in provider
      // as well used to lock out anyone who set a password through the reset
      // flow before that flow recorded it, and a verified reset already proves
      // ownership of the address.
      const social = user.provider.filter((p) => p !== 'local')
      const names = social.map((p) => (p === 'apple' ? 'Apple' : 'Google'))
      return res.status(400).json({
        message: names.length
          ? `Login with ${names.join(' or ')}`
          : 'Invalid email or password',
      })
    }

    const isMatch = await bcrypt.compare(password, user.password)
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid email or password' })
    }

    const accessToken = generateAccessToken({ id: user._id })

    const refreshToken = generateRefreshToken({ id: user._id })

    await User.updateOne({ _id: user._id }, {
      // Recorded per device. `$set` on a single field meant the newest sign-in
      // silently invalidated every other one, so using the web logged the phone
      // out at its next refresh. `$slice` bounds the list so it cannot grow
      // without limit as a user signs in over the years.
      $push: { refreshTokens: { $each: [refreshToken], $slice: -MAX_SESSIONS } },
    })

    res.cookie('refreshToken', refreshToken, {
      ...refreshCookieOptions(),
    })

    return res.status(200).json({
      message: 'Login successful',
      accessToken,
      role: user.role,
      ...(wantsTokenInBody(req) ? { refreshToken } : {}),
    })
  } catch (err) {
    return res.status(500).json({ message: 'Login failed' })
  }
}

export const googleAuth = async (req: Request, res: Response) => {
  try {
    const { idToken } = req.body
    if (!idToken) {
      return res.status(400).json({ error: 'Google token required' })
    }

    const payload = await verifyGoogleToken(idToken)
    if (!payload) {
      throw new Error('Invalid Google token')
    }

    const { sub: googleId, name, email_verified } = payload
    const email = normalizeEmail(payload.email)

    if (!email_verified) {
      return res.status(400).json({ error: 'Google email not verified' })
    }

    let user = await User.findOne({ email })

    if (user) {
      if (!user.provider.includes('google')) {
        user.googleId = googleId
        user.provider.push('google')
        await user.save()
      }
    }

    if (!user) {
      user = await User.create({
        email,
        username: name!.replace(/\s+/g, '').toLowerCase(),
        googleId,
        provider: ['google'],
      })
    }

    const accessToken = generateAccessToken({ id: user._id })

    const refreshToken = generateRefreshToken({ id: user._id })

    await User.updateOne({ _id: user._id }, {
      // Recorded per device. `$set` on a single field meant the newest sign-in
      // silently invalidated every other one, so using the web logged the phone
      // out at its next refresh. `$slice` bounds the list so it cannot grow
      // without limit as a user signs in over the years.
      $push: { refreshTokens: { $each: [refreshToken], $slice: -MAX_SESSIONS } },
    })

    res.cookie('refreshToken', refreshToken, {
      ...refreshCookieOptions(),
    })

    return res.status(200).json({
      message: 'Google authentication successful',
      accessToken,
      ...(wantsTokenInBody(req) ? { refreshToken } : {}),
    })
  } catch (err) {
    return res.status(500).json({ error: 'Google authentication failed' })
  }
}

/**
 * Sign in with Apple.
 *
 * Two things differ from Google and both matter:
 *
 * 1. Apple returns the user's name only on the *very first* authorisation, and
 *    never again. The client forwards it as `fullName`; if this account is new
 *    and it was not sent, there is no way to recover it later.
 * 2. The address may be an Apple private relay
 *    (`...@privaterelay.appleid.com`). It is deliverable and stable, so it is
 *    stored as-is, but it must not be treated as the user's real address.
 *
 * Matching is on `sub`, not email: a user can hide their address, and a relay
 * address is not the same string as one they may already have registered with.
 */
export const appleAuth = async (req: Request, res: Response) => {
  try {
    // Explicit and distinguishable from a bad token: the client can hide the
    // Apple button instead of showing the user a failure it cannot act on.
    if (!isAppleAuthConfigured()) {
      return res
        .status(503)
        .json({ error: 'Apple sign-in is not configured on this server' })
    }

    const { identityToken, fullName } = req.body

    if (!identityToken) {
      return res.status(400).json({ error: 'Apple identity token required' })
    }

    const payload = await verifyAppleToken(identityToken)
    const appleId = payload.sub
    const email = normalizeEmail(payload.email)

    // `email_verified` and `is_private_email` arrive as booleans or strings
    // depending on the flow, so both forms are handled.
    const emailVerified =
      payload.email_verified === true || payload.email_verified === 'true'

    let user = await User.findOne({ appleId })

    // Fall back to email so a user who signed up with a password and later used
    // Apple lands on one account instead of a duplicate.
    if (!user && email) {
      user = await User.findOne({ email })
    }

    if (user) {
      if (!user.provider.includes('apple')) {
        user.appleId = appleId
        user.provider.push('apple')
        await user.save()
      }
      if (!user.appleId) {
        user.appleId = appleId
        await user.save()
      }
    }

    if (!user) {
      if (!email) {
        return res
          .status(400)
          .json({ error: 'Apple account did not provide an email address' })
      }
      if (!emailVerified) {
        return res.status(400).json({ error: 'Apple email not verified' })
      }

      // Apple gives no username. Derive one and make it unique, since username
      // is indexed and unique in the schema.
      const base = (fullName || email.split('@')[0])
        .toString()
        .replace(/[^a-zA-Z0-9]/g, '')
        .toLowerCase()
        .slice(0, 20)

      let username = base || `reader${Date.now().toString().slice(-6)}`
      if (await User.findOne({ username })) {
        username = `${username}${Date.now().toString().slice(-4)}`
      }

      user = await User.create({
        email,
        username,
        appleId,
        provider: ['apple'],
      })
    }

    const accessToken = generateAccessToken({ id: user._id })
    const refreshToken = generateRefreshToken({ id: user._id })

    await User.updateOne({ _id: user._id }, {
      // Recorded per device. `$set` on a single field meant the newest sign-in
      // silently invalidated every other one, so using the web logged the phone
      // out at its next refresh. `$slice` bounds the list so it cannot grow
      // without limit as a user signs in over the years.
      $push: { refreshTokens: { $each: [refreshToken], $slice: -MAX_SESSIONS } },
    })

    res.cookie('refreshToken', refreshToken, {
      ...refreshCookieOptions(),
    })

    return res.status(200).json({
      message: 'Apple authentication successful',
      accessToken,
      ...(wantsTokenInBody(req) ? { refreshToken } : {}),
    })
  } catch (err) {
    return res
      .status(400)
      .json({ error: 'Apple authentication failed', detail: errMessage(err) })
  }
}

export const refreshToken = async (req: Request, res: Response) => {
  try {
    const refreshToken = readRefreshToken(req)
    if (!refreshToken)
      return res.status(401).json({ message: 'Refresh token missing' })

    // Either store: `refreshToken` holds sessions issued before this became a
    // list, and they should keep working rather than being signed out on deploy.
    const tokenExists = await User.findOne({
      $or: [{ refreshTokens: refreshToken }, { refreshToken }],
    })
    if (!tokenExists)
      return res.status(403).json({ message: 'Invalid refresh token' })

    jwt.verify(
      refreshToken,
      process.env.REFRESH_TOKEN_SECRET as string,
      (err: jwt.VerifyErrors | null, user: unknown) => {
        if (err)
          return res.status(403).json({ message: 'Invalid refresh token' })

        const { id } = user as TokenPayload
        const newAccessToken = generateAccessToken({ id })
        res.json({ accessToken: newAccessToken })
      },
    )
  } catch (error) {
    res.status(500).json({ message: errMessage(error) })
  }
}

export const logout = async (req: Request, res: Response) => {
  try {
    const refreshToken = readRefreshToken(req)
    if (!refreshToken) {
      return res.status(401).json({ message: 'Refresh token missing' })
    }
    // Ends this device's session only. Clearing every token would sign the
    // user out of their other devices as a side effect of logging out here.
    await User.updateOne(
      { $or: [{ refreshTokens: refreshToken }, { refreshToken }] },
      { $pull: { refreshTokens: refreshToken }, $unset: { refreshToken: 1 } },
    )
    res.clearCookie('refreshToken')
    res.json({ message: 'User logged out successfully' })
  } catch (error) {
    res.status(500).json({ message: errMessage(error) })
  }
}

export const passwordOTP = async (req: Request, res: Response) => {
  try {
    const email = normalizeEmail(req.body.email)

    if (!email) {
      return res.status(409).json({ message: 'Email is required' })
    }

    const user = await User.findOne({ email })
    if (!user) {
      return res
        .status(401)
        .json({ message: 'User not found, please register' })
    }
    const username = user.username

    res.status(201).json({
      message: `Verification code sent to ${email}, check your inbox or spam folder`,
    })

    sendVerificationEmail(email, username)
  } catch (error) {
    return res.status(500).json({
      message: `Error in forget password API ${errMessage(error)}`,
    })
  }
}

export const resetPassword = async (req: Request, res: Response) => {
  try {
    const { password, code } = req.body
    const email = normalizeEmail(req.body.email)

    if (!email || !password || !code) {
      return res
        .status(400)
        .json({ message: 'Email, password, and code are required' })
    }

    const user = await User.findOne({ email })
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    const verificationRecord = await VerificationCode.findOne({ email, code })
    if (!verificationRecord) {
      return res.status(400).json({ message: 'Invalid or expired code' })
    }

    // Reject (and clear) an expired code rather than relying solely on the TTL sweep.
    if (verificationRecord.expiresAt < new Date()) {
      await VerificationCode.deleteOne({ _id: verificationRecord._id })
      return res.status(400).json({ message: 'Invalid or expired code' })
    }

    const hashedPassword = await bcrypt.hash(password, 12)
    // Setting a password through the code-verified reset flow *is* creating
    // local credentials, so the provider list has to say so. Without this an
    // account created through Google gets a password it can never use: login
    // also requires 'local' in provider, and nothing else ever adds it.
    // Written in the same update as the password so the two cannot diverge.
    await User.updateOne(
      { email },
      {
        $set: { password: hashedPassword },
        $addToSet: { provider: 'local' },
      },
    )

    // Consume the code so it cannot be reused.
    await VerificationCode.deleteOne({ _id: verificationRecord._id })

    res.json({ message: 'Password reset successfully' })
  } catch (error) {
    console.error('Error resetting password:', error)
    return res.status(500).json({
      message: `Error from server: ${errMessage(error)}`,
    })
  }
}

export const passwordTokenVerification = async (
  req: Request,
  res: Response,
) => {
  try {
    const { code } = req.body
    if (!code) {
      return res.status(400).json({ message: 'Code is required' })
    }

    const record = await VerificationCode.findOne({ code })

    if (!record) {
      return res.status(400).json({ message: 'Invalid or expired code' })
    }

    if (record.expiresAt < new Date()) {
      await VerificationCode.deleteOne({ _id: record._id })
      return res.status(400).json({ message: 'Code has expired' })
    }

    return res.status(200).json({ message: 'Code is valid' })
  } catch (error) {
    console.error('Error verifying code:', error)
    return res.status(500).json({
      message: `Error from server: ${errMessage(error)}`,
    })
  }
}
