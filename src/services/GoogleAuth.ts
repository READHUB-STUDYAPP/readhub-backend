import { OAuth2Client, type TokenPayload } from 'google-auth-library'

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID)

export const verifyGoogleToken = async (
  token: string,
): Promise<TokenPayload | undefined> => {
  const ticket = await client.verifyIdToken({
    idToken: token,
    audience: process.env.GOOGLE_CLIENT_ID,
  })

  return ticket.getPayload()
}
