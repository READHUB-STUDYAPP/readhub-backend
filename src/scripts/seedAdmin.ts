// Seeds (or updates) the initial admin directly in the database.
//
//   npm run seed:admin        (dev, via tsx)
//   node dist/scripts/seedAdmin.js   (after build)
//
// Reads from env:
//   SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD  (required)
//   SEED_ADMIN_USERNAME                     (optional, defaults from email)
//
// Idempotent: if the email already exists it is promoted to admin and its
// password reset to the provided value.
import dotenv from 'dotenv'
dotenv.config()

import mongoose from 'mongoose'
import bcrypt from 'bcrypt'
import User from '../models/User.js'

async function main(): Promise<void> {
  const email = (process.env.SEED_ADMIN_EMAIL ?? '').trim().toLowerCase()
  const password = process.env.SEED_ADMIN_PASSWORD ?? ''
  const username =
    (process.env.SEED_ADMIN_USERNAME ?? '').trim() || email.split('@')[0] || 'admin'

  if (!email || !password) {
    console.error(
      'Missing SEED_ADMIN_EMAIL or SEED_ADMIN_PASSWORD in the environment.',
    )
    process.exit(1)
  }
  if (password.length < 6) {
    console.error('SEED_ADMIN_PASSWORD must be at least 6 characters.')
    process.exit(1)
  }

  const uri = process.env.MONGODB_URI
  if (!uri) {
    console.error('Missing MONGODB_URI in the environment.')
    process.exit(1)
  }

  await mongoose.connect(uri)
  try {
    const hashedPassword = await bcrypt.hash(password, 12)
    const existing = await User.findOne({ email })

    if (existing) {
      existing.role = 'admin'
      existing.password = hashedPassword
      if (!existing.provider.includes('local')) existing.provider.push('local')
      await existing.save()
      console.log(`Updated existing user "${email}" to admin.`)
    } else {
      await User.create({
        username,
        email,
        password: hashedPassword,
        provider: ['local'],
        role: 'admin',
      })
      console.log(`Created admin "${email}" (username: ${username}).`)
    }
  } finally {
    await mongoose.disconnect()
  }
}

main().catch((err) => {
  console.error('Seed failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
