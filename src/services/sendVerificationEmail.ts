import VerificationCode from '../models/Verify-user.js'
import { sendEmail, type SendResult } from './email.js'

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

export async function sendVerificationEmail(
  email: string,
  fullName: string,
): Promise<SendResult> {
  try {
    await VerificationCode.findOneAndDelete({ email })

    const code = generateCode()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

    await VerificationCode.create({ email, code, expiresAt })

    const firstName = (fullName || '').trim().split(' ')[0] || 'there'
    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:auto;padding:24px;color:#1a1a1a">
        <h2 style="margin:0 0 16px">Verify your ReadHub email</h2>
        <p style="margin:0 0 16px">Hi ${firstName}, use this code to verify your ReadHub account:</p>
        <p style="margin:0 0 24px;text-align:center">
          <span style="display:inline-block;font-size:32px;font-weight:700;letter-spacing:8px;background:#f2f4ff;color:#2f6bff;padding:14px 24px;border-radius:10px">${code}</span>
        </p>
        <p style="margin:0;color:#5f5f61;font-size:14px">
          This code expires in 10 minutes. If you didn't request it, you can ignore this email.
        </p>
      </div>`

    return await sendEmail({
      to: email,
      subject: 'Your ReadHub verification code',
      html,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Error sending verification email:', message)
    return { success: false, error: message }
  }
}
