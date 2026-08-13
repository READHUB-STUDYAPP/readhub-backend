import { S3_BUCKET, S3_PUBLIC_URL } from '../config/s3.js'

// Validates that a value is a public delivery URL for THIS storage bucket.
// Stricter than a substring check: requires the exact public host + bucket
// prefix so URLs like https://evil.com/<public-host>/... are rejected.
export const isStoredFileUrl = (url: unknown): url is string => {
  if (typeof url !== 'string') return false
  if (!S3_PUBLIC_URL) return false
  return url.startsWith(`${S3_PUBLIC_URL}/${S3_BUCKET}/`)
}
