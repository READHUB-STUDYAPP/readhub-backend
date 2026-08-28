import { OAuth2Client, type TokenPayload } from 'google-auth-library'

/**
 * Google ID tokens are issued against the OAuth client that requested them, and
 * that client differs per platform. A token minted by the Android or iOS app
 * carries that platform's client id in `aud`, so verifying against the web
 * client id alone rejects every mobile sign-in with "Wrong recipient".
 *
 * The Android and iOS ids are optional: with nothing extra configured this
 * behaves exactly as before.
 */
const audiences = (): string[] =>
  [
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_ID_ANDROID,
    process.env.GOOGLE_CLIENT_ID_IOS,
  ].filter((id): id is string => Boolean(id))

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID)

export const verifyGoogleToken = async (
  token: string,
): Promise<TokenPayload | undefined> => {
  const allowed = audiences()

  if (allowed.length === 0) {
    throw new Error('No Google client id configured')
  }

  const ticket = await client.verifyIdToken({
    idToken: token,
    // google-auth-library accepts a list and matches the token's `aud` against
    // any entry, which is what lets one endpoint serve web and both mobile
    // platforms.
    audience: allowed,
  })

  return ticket.getPayload()
}
