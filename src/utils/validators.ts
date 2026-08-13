// Validates that a value is a Cloudinary delivery URL for THIS account.
// Stricter than a substring check: requires the exact host + cloud-name prefix
// so URLs like https://evil.com/res.cloudinary.com/<cloud>/... are rejected.
export const isCloudinaryUrl = (url: unknown): url is string => {
  if (typeof url !== 'string') return false
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME ?? ''
  if (!cloudName) return false
  return url.startsWith(`https://res.cloudinary.com/${cloudName}/`)
}
