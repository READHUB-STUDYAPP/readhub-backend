/**
 * The shell every ReadHub email sits in.
 *
 * One layout rather than four hand-written ones. Before this, each sender
 * carried its own markup and its own idea of the brand blue -- the invite and
 * the verification code used #2f6bff, the reading nudge used #2d7ff9, and none
 * of them carried the logo at all. A person who gets a verification code and
 * then a reminder should be able to tell both came from the same product.
 *
 * Email is not the web. The rules this file follows, and why:
 *
 *  - Everything is inline styles on tables. Gmail strips <style> blocks and
 *    Outlook ignores most of flexbox and grid, so a layout built the way the
 *    app is built falls apart in exactly the clients most people read mail in.
 *  - Nothing depends on an image loading. Most clients block remote images
 *    until the reader allows them, so the logo sits beside a text wordmark and
 *    the header still reads as ReadHub with images off.
 *  - Colours are the real brand tokens, not approximations.
 */

/** The brand, as the app defines it in theme.css. */
export const BRAND = {
  primary: '#2d7ff9',
  strong: '#1b66c9',
  wash: '#e6f0fe',
  ink: '#0f172a',
  inkSoft: '#475569',
  inkFaint: '#64748b',
  line: '#e3e8f0',
  page: '#f5f7fb',
  surface: '#ffffff',
} as const

/** Where the app lives, for links and for the logo. */
function appBase(): string {
  return (process.env.FRONTEND_URL ?? 'https://app.readhub.study').replace(/\/$/, '')
}

export interface EmailLayoutOptions {
  /** The line at the top of the card. Plain text; escaped for you. */
  heading: string
  /**
   * The body, as HTML.
   *
   * HTML rather than text because callers legitimately need a little markup --
   * a verification code in a box, a paragraph and a list. Callers are
   * responsible for escaping anything that came from a person; the ones in
   * this codebase use `escapeHtml` for book titles and names.
   */
  bodyHtml: string
  /** An optional single call to action. */
  action?: { label: string; url: string }
  /** Shown small, under the action. For "this link expires" and the like. */
  footnote?: string
  /**
   * Adds the unsubscribe footer. Only for mail somebody can opt out of --
   * never on a verification code or a password reset, which have to arrive
   * whatever else the reader has turned off.
   */
  unsubscribeUrl?: string
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

export function emailLayout({
  heading,
  bodyHtml,
  action,
  footnote,
  unsubscribeUrl,
}: EmailLayoutOptions): string {
  const base = appBase()
  const logo = `${base}/ReadIcon.png`

  const actionHtml = action
    ? `
      <tr>
        <td style="padding:8px 32px 0">
          <!-- A table, not a styled <a>: Outlook will not honour padding on an
               inline element, and the button collapses to bare text. -->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td bgcolor="${BRAND.primary}" style="border-radius:999px">
                <a href="${action.url}"
                   style="display:inline-block;padding:13px 26px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:999px">
                  ${escapeHtml(action.label)}
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>`
    : ''

  const footnoteHtml = footnote
    ? `
      <tr>
        <td style="padding:20px 32px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:${BRAND.inkFaint}">
          ${escapeHtml(footnote)}
        </td>
      </tr>`
    : ''

  const unsubscribeHtml = unsubscribeUrl
    ? `
        <p style="margin:12px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:${BRAND.inkFaint}">
          You are getting this because reading reminders are on.
          <a href="${unsubscribeUrl}" style="color:${BRAND.strong}">Unsubscribe from reminders</a>.
          This does not affect account or security emails.
        </p>`
    : ''

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(heading)}</title>
  </head>
  <body style="margin:0;padding:0;background:${BRAND.page}">
    <!-- Hidden from view, shown in the inbox list beside the subject. -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(heading)}</div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.page}">
      <tr>
        <td align="center" style="padding:28px 12px">

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                 style="max-width:560px;background:${BRAND.surface};border:1px solid ${BRAND.line};border-radius:14px;overflow:hidden">

            <!-- Masthead. The wordmark is text so the header still reads with
                 images turned off, which is how most clients open mail. -->
            <tr>
              <td style="background:${BRAND.primary};padding:20px 32px">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="padding-right:12px" valign="middle">
                      <!-- On a white chip: the logo's own ground is the same
                           blue as this header, so without it the mark reads as
                           a book floating in the bar rather than as a logo. -->
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td bgcolor="#ffffff" style="border-radius:10px;padding:5px;line-height:0">
                            <img src="${logo}" width="30" height="30" alt=""
                                 style="display:block;width:30px;height:30px;border-radius:7px;border:0">
                          </td>
                        </tr>
                      </table>
                    </td>
                    <td valign="middle">
                      <span style="font-family:Arial,Helvetica,sans-serif;font-size:19px;font-weight:bold;color:#ffffff;letter-spacing:-0.2px">ReadHub</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:30px 32px 0">
                <h1 style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:21px;line-height:1.35;font-weight:bold;color:${BRAND.ink}">
                  ${escapeHtml(heading)}
                </h1>
              </td>
            </tr>

            <tr>
              <td style="padding:14px 32px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:${BRAND.inkSoft}">
                ${bodyHtml}
              </td>
            </tr>

            ${actionHtml}
            ${footnoteHtml}

            <tr>
              <td style="padding:28px 32px 30px">
                <div style="border-top:1px solid ${BRAND.line};padding-top:18px">
                  <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:${BRAND.inkFaint}">
                    ReadHub &mdash; read, track, stay consistent.
                  </p>
                  ${unsubscribeHtml}
                </div>
              </td>
            </tr>
          </table>

        </td>
      </tr>
    </table>
  </body>
</html>`
}

/**
 * A number or code shown as the point of the message.
 *
 * Its own helper because a verification code is the one thing in these emails
 * a person has to read character by character, and letter-spacing on a tinted
 * block is what makes that possible on a phone.
 */
export function codeBlock(code: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 4px">
      <tr>
        <td bgcolor="${BRAND.wash}" style="border-radius:10px;padding:16px 26px;font-family:'Courier New',Courier,monospace;font-size:30px;font-weight:bold;letter-spacing:8px;color:${BRAND.strong}">
          ${escapeHtml(code)}
        </td>
      </tr>
    </table>`
}
