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
import { sendVerificationEmail } from '../services/sendVerificationEmail.js'
import VerificationCode from '../models/Verify-user.js'

const errMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const register = async (req: Request, res: Response) => {
  try {
    const { username, email, password } = req.body
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

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required' })
    }

    const user = await User.findOne({ email })
    if (!user) {
      return res.status(400).json({ message: 'Invalid email or password' })
    }

    if (!user.password || !user.provider.includes('local')) {
      return res.status(400).json({ message: 'Login with Google' })
    }

    const isMatch = await bcrypt.compare(password, user.password)
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid email or password' })
    }

    const accessToken = generateAccessToken({ id: user._id })

    const refreshToken = generateRefreshToken({ id: user._id })

    await User.updateOne({ _id: user._id }, { $set: { refreshToken } })

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    })

    return res.status(200).json({
      message: 'Login successful',
      accessToken,
      role: user.role,
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

    const { sub: googleId, email, name, email_verified } = payload

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

    await User.updateOne({ _id: user._id }, { $set: { refreshToken } })

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    })

    return res.status(200).json({
      message: 'Google authentication successful',
      accessToken,
    })
  } catch (err) {
    return res.status(500).json({ error: 'Google authentication failed' })
  }
}

export const refreshToken = async (req: Request, res: Response) => {
  try {
    const refreshToken = req.cookies?.refreshToken
    if (!refreshToken)
      return res.status(401).json({ message: 'Refresh token missing' })

    const tokenExists = await User.findOne({ refreshToken })
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
    const refreshToken = req.cookies?.refreshToken
    if (!refreshToken) {
      return res.status(401).json({ message: 'Refresh token missing' })
    }
    await User.updateOne({ refreshToken }, { $unset: { refreshToken: 1 } })
    res.clearCookie('refreshToken')
    res.json({ message: 'User logged out successfully' })
  } catch (error) {
    res.status(500).json({ message: errMessage(error) })
  }
}

export const passwordOTP = async (req: Request, res: Response) => {
  try {
    const { email } = req.body

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
    const { email, password, code } = req.body

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
    await User.updateOne({ email }, { $set: { password: hashedPassword } })

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
