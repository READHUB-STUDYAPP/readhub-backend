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
// The checksum settings are not optional here, and are the same two the
// presign client below needs. Left at their defaults, the SDK adds
// `x-amz-checksum-mode: ENABLED` to every GetObject *and lists it among the
// signed headers*. Anything between us and MinIO that drops that header -- a
// proxy, an older gateway -- leaves MinIO recomputing the signature over a set
// of headers that no longer matches, and it answers "The request signature we
// calculated does not match the signature you provided", which reads as a
// credentials problem and is not one. That is what stopped a reader opening an
// EPUB: the download 500'd with a message about signing keys.
//
// Verified rather than assumed: with the defaults the SDK sends and signs that
// header; with WHEN_REQUIRED it sends neither.
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
