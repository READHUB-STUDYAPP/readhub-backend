import dotenv from 'dotenv'
dotenv.config()

// Transactional email via Resend (https://resend.com/docs/api-reference/emails).
// Best-effort: returns { success:false } instead of throwing so callers can
// degrade gracefully (e.g. still surface an invite link when email is unconfigured).
export interface SendResult {
  success: boolean
  error?: string
}

interface SendEmailOptions {
  to: string
  subject: string
  html: string
}

export async function sendEmail({ to, subject, html }: SendEmailOptions): Promise<SendResult> {
  try {
    const apiKey = process.env.RESEND_API_KEY
    const emailFrom = process.env.EMAIL_FROM

    if (!apiKey || !emailFrom) {
      return { success: false, error: 'Email not configured (RESEND_API_KEY / EMAIL_FROM)' }
    }

    // Resend expects `from` as either "email" or "Name <email>".
    const from = emailFrom.includes('<') ? emailFrom : `ReadHub <${emailFrom}>`

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ from, to, subject, html }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(JSON.stringify(errorData))
    }

    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Error sending email via Resend:', message)
    return { success: false, error: message }
  }
}
