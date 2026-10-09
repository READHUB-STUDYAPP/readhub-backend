// Sends an admin-invite email via Resend using inline HTML. Best-effort: returns
// success:false instead of throwing so the invite endpoint can still surface the
// accept link when email isn't configured.
import { sendEmail, type SendResult } from './email.js'
import { emailLayout } from './emailLayout.js'

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export async function sendAdminInvite(
  email: string,
  acceptUrl: string,
  invitedByName: string,
): Promise<SendResult> {
  const html = emailLayout({
    heading: 'You have been invited to administer ReadHub',
    bodyHtml: `
      <p style="margin:0 0 12px">${escapeHtml(invitedByName)} has invited you to the ReadHub admin dashboard.</p>
      <p style="margin:0">Set up your admin account below.</p>`,
    action: { label: 'Accept invite', url: acceptUrl },
    footnote: `Or paste this link into your browser: ${acceptUrl}  --  the invitation expires soon, and you can ignore this email if you were not expecting it.`,
  })

  return sendEmail({
    to: email,
    subject: 'You have been invited to administer ReadHub',
    html,
  })
}
