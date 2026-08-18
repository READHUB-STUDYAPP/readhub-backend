// Sends an admin-invite email via Brevo's transactional API using inline HTML
// (no Brevo template required). Best-effort: returns success:false instead of
// throwing so the invite endpoint can still surface the accept link when email
// isn't configured.
interface SendResult {
  success: boolean
  error?: string
}

export async function sendAdminInvite(
  email: string,
  acceptUrl: string,
  invitedByName: string,
): Promise<SendResult> {
  try {
    if (!process.env.BREVO_API_KEY || !process.env.EMAIL_FROM) {
      return { success: false, error: 'Email not configured' }
    }

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:auto;padding:24px;color:#1a1a1a">
        <h2 style="margin:0 0 16px">You're invited to administer ReadHub</h2>
        <p style="margin:0 0 16px">${invitedByName} has invited you to join the ReadHub admin dashboard.</p>
        <p style="margin:0 0 24px">Click below to set up your admin account:</p>
        <p style="margin:0 0 24px">
          <a href="${acceptUrl}"
             style="background:#2f6bff;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block">
            Accept invite
          </a>
        </p>
        <p style="margin:0;color:#5f5f61;font-size:14px">
          Or paste this link into your browser:<br />${acceptUrl}
        </p>
        <p style="margin:16px 0 0;color:#5f5f61;font-size:14px">
          This invitation expires soon. If you weren't expecting it, you can ignore this email.
        </p>
      </div>`

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': process.env.BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender: { email: process.env.EMAIL_FROM, name: 'ReadHub' },
        to: [{ email }],
        subject: 'You have been invited to administer ReadHub',
        htmlContent: html,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(JSON.stringify(errorData))
    }

    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Error sending admin invite:', message)
    return { success: false, error: message }
  }
}
