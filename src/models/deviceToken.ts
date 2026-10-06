import mongoose, { Schema, Document, Model, Types } from 'mongoose'

/**
 * Where to reach one reader's phone.
 *
 * One row per device, not per reader: someone with a phone and a tablet should
 * hear on both, and signing out of one should silence only that one.
 *
 * `failureCount` is how dead tokens are retired. A push service answers with a
 * permanent error for an app that was uninstalled, and a token that keeps
 * failing is a device that no longer exists -- retiring it keeps the send batch
 * honest rather than slowly filling with addresses nobody is at.
 */

export type DevicePlatform = 'ios' | 'android' | 'web'

export interface IDeviceToken extends Document {
  user: Types.ObjectId
  /** Expo push token. The clients obtain it; the server never derives it. */
  token: string
  platform: DevicePlatform
  enabled: boolean
  lastSeenAt: Date
  failureCount: number
  createdAt: Date
  updatedAt: Date
}

/** Retire a token after this many consecutive permanent failures. */
export const MAX_PUSH_FAILURES = 3

const deviceTokenSchema = new Schema<IDeviceToken>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    token: { type: String, required: true, unique: true },
    platform: { type: String, required: true, enum: ['ios', 'android', 'web'] },
    enabled: { type: Boolean, default: true },
    lastSeenAt: { type: Date, default: Date.now },
    failureCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
)

/** Every live device for one reader, which is what a send needs. */
deviceTokenSchema.index({ user: 1, enabled: 1 })

const DeviceToken: Model<IDeviceToken> = mongoose.model<IDeviceToken>(
  'DeviceToken',
  deviceTokenSchema,
)

export default DeviceToken
