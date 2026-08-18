// Sends an admin-invite email via Resend using inline HTML. Best-effort: returns
// success:false instead of throwing so the invite endpoint can still surface the
// accept link when email isn't configured.
import { sendEmail, type SendResult } from './email.js'

export async function sendAdminInvite(
  email: string,
  acceptUrl: string,
  invitedByName: string,
): Promise<SendResult> {
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

  return sendEmail({
    to: email,
    subject: 'You have been invited to administer ReadHub',
    html,
  })
}
