import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'crypto'
import dotenv from 'dotenv'

dotenv.config()

// S3-compatible object storage (MinIO). Path-style + explicit endpoint so it
// works against MinIO as well as AWS S3. The bucket is public-read for delivery;
// uploads are authorized via short-lived presigned PUT URLs (browser uploads
// straight to storage, like the old Cloudinary signed-upload flow).
export const S3_BUCKET = process.env.S3_BUCKET || 'readhub'
export const S3_PUBLIC_URL = (process.env.S3_PUBLIC_URL || '').replace(/\/+$/, '')

const credentials = {
  accessKeyId: process.env.S3_ACCESS_KEY || '',
  secretAccessKey: process.env.S3_SECRET_KEY || '',
}
const region = process.env.S3_REGION || 'us-east-1'
const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false'

// Server-side client: talks to MinIO over the private container network
// (S3_ENDPOINT=http://minio:9000) for direct uploads/reads from the backend.
//
// The checksum settings match the presign client's. They are not what fixed
// the "SignatureDoesNotMatch" failures this comment used to claim -- that was
// DNS: `minio` resolved round-robin across both environments on the shared
// edge network, so half of these calls went to the other environment's MinIO,
// which rejects them because the credentials differ. Fixed in readhub-infra by
// addressing the container by name.
//
// They stay because they are still correct: they keep this client's requests
// identical in shape to the presigned ones, and MinIO rejected the SDK's
// default checksum behaviour on the upload side.
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region,
  credentials,
  forcePathStyle,
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
})

// Presign client: MUST sign against the PUBLIC endpoint the browser will hit
// (S3_PUBLIC_URL=https://files.<env>.readhub.study), otherwise the presigned URL
// points at the unreachable, HTTP-only internal host `minio:9000` (mixed content).
// WHEN_REQUIRED disables the SDK's default flexible checksum — otherwise a CRC32
// computed over the empty presign body is baked into the URL and MinIO rejects the
// browser's real-body PUT.
const s3Presign = new S3Client({
  endpoint: S3_PUBLIC_URL || process.env.S3_ENDPOINT,
  region,
  credentials,
  forcePathStyle,
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
})

/** Public delivery URL for a stored object (bucket is public-read, path-style). */
export const publicUrl = (key: string): string => `${S3_PUBLIC_URL}/${S3_BUCKET}/${key}`

/** A short-lived presigned PUT the browser can upload straight to (public host). */
export const presignPut = async (
  key: string,
  contentType: string,
  expiresIn = 600,
): Promise<string> =>
  getSignedUrl(
    s3Presign,
    new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, ContentType: contentType }),
    { expiresIn },
  )

/** Namespaced, collision-free object key: <folder>/<userId>/<uuid>.<ext>. */
export const buildKey = (folder: string, userId: string, ext: string): string =>
  `${folder}/${userId}/${randomUUID()}.${(ext || '').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin'}`

export { s3, PutObjectCommand, GetObjectCommand }
export default s3
