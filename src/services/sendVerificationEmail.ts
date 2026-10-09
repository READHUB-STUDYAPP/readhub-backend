import { randomInt } from 'node:crypto'
import VerificationCode from '../models/Verify-user.js'
import { sendEmail, type SendResult } from './email.js'
import { codeBlock, emailLayout } from './emailLayout.js'

/**
 * Six-digit password-reset code.
 *
 * randomInt, not Math.random: Math.random is a non-cryptographic PRNG whose
 * output is predictable from previous values, and this code is the only thing
 * standing between an attacker and a password reset. Same reasoning the admin
 * invite flow already follows with randomBytes.
 */
const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function generateCode(): string {
  return randomInt(100000, 1000000).toString()
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
    const html = emailLayout({
      heading: 'Verify your ReadHub email',
      bodyHtml: `
        <p style="margin:0">Hi ${escapeHtml(firstName)}, use this code to verify your ReadHub account:</p>
        ${codeBlock(code)}`,
      footnote: "This code expires in 10 minutes. If you did not ask for it, you can ignore this email.",
      // Deliberately no unsubscribe: a verification code has to arrive
      // whatever else a reader has turned off.
    })

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
