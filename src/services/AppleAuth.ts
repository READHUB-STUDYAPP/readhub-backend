import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'

/**
 * Apple's public signing keys. `createRemoteJWKSet` caches them and refetches on
 * an unknown `kid`, which is what makes key rotation a non-event -- Apple rotates
 * without notice, and a pinned key would start rejecting every sign-in.
 */
const APPLE_JWKS = createRemoteJWKSet(
  new URL('https://appleid.apple.com/auth/keys'),
)

const APPLE_ISSUER = 'https://appleid.apple.com'

export interface AppleTokenPayload extends JWTPayload {
  /** Stable per-user identifier. The only reliable key for an Apple account. */
  sub: string
  email?: string
  email_verified?: boolean | string
  /** True when the address is Apple's private relay rather than the real one. */
  is_private_email?: boolean | string
}

/**
 * Audiences the identity token may be issued for.
 *
 * Native iOS sign-in issues tokens for the app's bundle id; Sign in with Apple
 * on the web issues them for a Services ID. They differ, so both are accepted.
 */
const audiences = (): string[] =>
  [process.env.APPLE_CLIENT_ID, process.env.APPLE_SERVICE_ID].filter(
    (id): id is string => Boolean(id),
  )

/**
 * Whether Apple sign-in can be served at all.
 *
 * Checked per request rather than at startup: the module must import cleanly
 * with no Apple configuration so the rest of the API keeps working. Note that
 * `createRemoteJWKSet` above only builds a resolver -- it makes no network call
 * until a token is actually verified, so an unconfigured deployment never
 * reaches Apple.
 */
export const isAppleAuthConfigured = (): boolean => audiences().length > 0

/**
 * Verifies an Apple identity token.
 *
 * Unlike Google's library there is no SDK doing this for us, so the checks are
 * explicit: Apple's signature via JWKS, the issuer, and the audience. Skipping
 * the audience check would accept a token minted for any other Apple app.
 */
export const verifyAppleToken = async (
  identityToken: string,
): Promise<AppleTokenPayload> => {
  const allowed = audiences()

  if (allowed.length === 0) {
    throw new Error('No Apple client id configured')
  }

  const { payload } = await jwtVerify(identityToken, APPLE_JWKS, {
    issuer: APPLE_ISSUER,
    audience: allowed,
  })

  if (!payload.sub) {
    throw new Error('Apple token has no subject')
  }

  return payload as AppleTokenPayload
}
