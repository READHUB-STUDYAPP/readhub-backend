import type { Request, Response } from 'express'
import cloudinary from '../config/cloudinary.js'
import User from '../models/User.js'

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

    const timestamp = Math.round(Date.now() / 1000)

    const paramsToSign = {
      timestamp,
      folder: 'profile_pictures',
    }

    const signature = cloudinary.utils.api_sign_request(
      paramsToSign,
      process.env.CLOUDINARY_API_SECRET as string,
    )

    return res.json({
      ...paramsToSign,
      signature,
      apiKey: process.env.CLOUDINARY_API_KEY,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    })
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
      if (
        !profilePicture.includes(
          `res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}`,
        )
      ) {
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
