import type { Request, Response } from 'express'
import { presignPut, publicUrl, buildKey } from '../config/s3.js'
import User from '../models/User.js'
import { isStoredFileUrl } from '../utils/validators.js'

const errMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const generatePictureSignature = async (
  req: Request,
  res: Response,
) => {
  try {
    if (!req.user!.id) {
      return res.status(401).json({ message: 'Unauthorized' })
    }

    const contentType = String(req.query.contentType || 'image/jpeg')
    const ext = String(req.query.ext || (contentType.split('/')[1] ?? 'jpg')).toLowerCase()
    const key = buildKey('profile_pictures', req.user!.id, ext)
    const uploadUrl = await presignPut(key, contentType)

    // Frontend PUTs the image to `uploadUrl`, then saves `publicUrl` as profilePicture.
    return res.json({ uploadUrl, method: 'PUT', key, contentType, publicUrl: publicUrl(key) })
  } catch (error) {
    return res.status(500).json({
      message: 'Failed to generate signature',
      error: errMessage(error),
    })
  }
}

export const updateUserProfile = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id
    const { username, email, profilePicture } = req.body

    const updateUser: {
      username?: string
      email?: string
      profilePicture?: string
    } = {}

    if (username) updateUser.username = username
    if (email) updateUser.email = email

    if (profilePicture) {
      if (!isStoredFileUrl(profilePicture)) {
        return res.status(400).json({ message: 'Invalid image source' })
      }

      updateUser.profilePicture = profilePicture
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updateUser },
      { new: true, runValidators: true },
    ).select('-password -refreshToken -googleId')

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found' })
    }

    res.status(200).json({ updatedUser })
  } catch (error) {
    res.status(500).json({ message: errMessage(error) })
  }
}

export const getUserProfile = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id
    const user = await User.findById(userId).select(
      '-password -refreshToken -googleId',
    )
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }
    res.status(200).json({ user })
  } catch (error) {
    res.status(500).json({ message: errMessage(error) })
  }
}

export const deleteUserProfile = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id
    const deletedUser = await User.findByIdAndDelete(userId)
    if (!deletedUser) {
      return res.status(404).json({ message: 'User not found' })
    }
    res.status(200).json({ message: 'User profile deleted successfully' })
  } catch (error) {
    res.status(500).json({ message: errMessage(error) })
  }
}
