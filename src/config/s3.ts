import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
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

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || '',
    secretAccessKey: process.env.S3_SECRET_KEY || '',
  },
  forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false',
})

/** Public delivery URL for a stored object (bucket is public-read, path-style). */
export const publicUrl = (key: string): string => `${S3_PUBLIC_URL}/${S3_BUCKET}/${key}`

/** A short-lived presigned PUT the browser can upload straight to. */
export const presignPut = async (
  key: string,
  contentType: string,
  expiresIn = 600,
): Promise<string> =>
  getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, ContentType: contentType }),
    { expiresIn },
  )

/** Namespaced, collision-free object key: <folder>/<userId>/<uuid>.<ext>. */
export const buildKey = (folder: string, userId: string, ext: string): string =>
  `${folder}/${userId}/${randomUUID()}.${(ext || '').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin'}`

export { s3, PutObjectCommand }
export default s3
