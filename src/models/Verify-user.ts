import mongoose, { Schema, Document, Model } from 'mongoose'

export interface IVerificationCode extends Document {
  email: string
  code: string
  expiresAt: Date
}

const verificationCodeSchema = new Schema<IVerificationCode>({
  email: { type: String, required: true, unique: true, index: true },
  code: { type: String, required: true, index: true },
  expiresAt: { type: Date, required: true, index: true, expires: 0 },
})

const VerificationCode: Model<IVerificationCode> =
  mongoose.model<IVerificationCode>('VerificationCode', verificationCodeSchema)

export default VerificationCode
