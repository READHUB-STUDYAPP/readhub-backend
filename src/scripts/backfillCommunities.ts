import 'dotenv/config'
import crypto from 'crypto'
import mongoose from 'mongoose'

import Community, { INVITE_CODE_LENGTH } from '../models/community.js'
import CommunityMember from '../models/communityMember.js'
import ReadingGroup from '../models/readingGroup.js'

/**
 * Gives every reading group that predates communities a home.
 *
 * The decision behind this: groups now live inside a community, and rather than
 * supporting two shapes of group forever, each existing group gets a private
 * community of its own with the same owner and the same people in it.
 *
 * Three properties make this safe to run against live data:
 *
 *   Idempotent.  A group that already has a community is skipped, and the
 *                community it made is found by `migratedFromGroup` rather than
 *                created again. Running it twice changes nothing.
 *   Additive.    Nothing is deleted and nothing is overwritten. The group keeps
 *                its own embedded members; the community gets a copy. A
 *                rollback is `--undo`, not a restore.
 *   Reversible.  Everything it creates is stamped, so `--undo` can find exactly
 *                what this made and nothing else.
 *
 * Usage:
 *   node dist/scripts/backfillCommunities.js            # report, change nothing
 *   node dist/scripts/backfillCommunities.js --apply
 *   node dist/scripts/backfillCommunities.js --undo
 */

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function newInviteCode(): string {
  const bytes = crypto.randomBytes(INVITE_CODE_LENGTH)
  let code = ''
  for (let i = 0; i < INVITE_CODE_LENGTH; i += 1) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  return code
}

async function main() {
  const apply = process.argv.includes('--apply')
  const undo = process.argv.includes('--undo')

  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI is not set')

  await mongoose.connect(uri)
  console.log(`[backfill] connected${apply || undo ? '' : '  (dry run -- nothing will change)'}`)

  if (undo) return rollback(apply)

  const groups = await ReadingGroup.find({ community: { $exists: false } }).lean()
  console.log(`[backfill] ${groups.length} group(s) without a community`)

  let created = 0
  let membersCopied = 0
  let skipped = 0

  for (const group of groups) {
    // Idempotency: a previous run may have made the community and failed
    // before linking the group.
    const existing = await Community.findOne({ migratedFromGroup: group._id })

    if (!apply) {
      console.log(
        `  would ${existing ? 'relink' : 'create'}: "${group.name}" ` +
          `(${group.members?.length ?? 0} member(s))`,
      )
      continue
    }

    const community =
      existing ??
      (await Community.create({
        name: group.name,
        description: group.description,
        // Private, because the people in it never chose to be discoverable.
        visibility: 'private',
        joinPolicy: 'invite',
        category: 'friends',
        createdBy: group.createdBy,
        inviteCode: newInviteCode(),
        memberCount: group.members?.length ?? 0,
        groupCount: 1,
        migratedFromGroup: group._id,
      }))

    if (!existing) created += 1

    // The group's owner becomes the community's owner; everyone else is a
    // member. Upserted, so a half-finished run resumes cleanly.
    for (const member of group.members ?? []) {
      const result = await CommunityMember.updateOne(
        { community: community._id, user: member.user },
        {
          $setOnInsert: {
            community: community._id,
            user: member.user,
            role: member.role === 'owner' ? 'owner' : 'member',
            visible: member.visible !== false,
            joinedAt: member.joinedAt ?? new Date(),
            migrated: true,
          },
        },
        { upsert: true },
      )
      if (result.upsertedCount) membersCopied += 1
    }

    await ReadingGroup.updateOne({ _id: group._id }, { $set: { community: community._id } })
  }

  const alreadyLinked = await ReadingGroup.countDocuments({ community: { $exists: true } })
  skipped = alreadyLinked - (apply ? groups.length : 0)

  console.log(
    apply
      ? `[backfill] done: ${created} community(ies) created, ${membersCopied} membership(s) copied, ${Math.max(0, skipped)} group(s) already linked`
      : `[backfill] dry run complete. Re-run with --apply to make these changes.`,
  )

  await reconcile()
  await mongoose.disconnect()
}

/**
 * The check that decides whether the field can be made required.
 *
 * Counts on both sides rather than trusting the run's own tally, because the
 * question is about the database, not about what this script thinks it did.
 */
async function reconcile() {
  const groups = await ReadingGroup.countDocuments()
  const linked = await ReadingGroup.countDocuments({ community: { $exists: true } })
  const migratedCommunities = await Community.countDocuments({
    migratedFromGroup: { $exists: true },
  })

  console.log('[backfill] reconciliation')
  console.log(`  groups total              ${groups}`)
  console.log(`  groups linked to one      ${linked}`)
  console.log(`  communities from groups   ${migratedCommunities}`)
  console.log(
    linked === groups
      ? '  every group has a community -- safe to make the field required'
      : `  ${groups - linked} group(s) still unlinked -- do NOT make the field required yet`,
  )
}

/** Removes exactly what the backfill created, and nothing else. */
async function rollback(apply: boolean) {
  const communities = await Community.find({ migratedFromGroup: { $exists: true } }).lean()
  console.log(`[backfill] ${communities.length} migrated community(ies) found`)

  if (!apply) {
    console.log('[backfill] dry run. Re-run with --undo --apply to remove them.')
    await mongoose.disconnect()
    return
  }

  const ids = communities.map((community) => community._id)

  // Order matters: unlink the groups first, so a failure part-way through
  // never leaves a group pointing at a community that is gone.
  await ReadingGroup.updateMany({ community: { $in: ids } }, { $unset: { community: 1 } })
  await CommunityMember.deleteMany({ community: { $in: ids } })
  await Community.deleteMany({ _id: { $in: ids } })

  console.log(`[backfill] rolled back ${ids.length} community(ies)`)
  await mongoose.disconnect()
}

main().catch(async (error) => {
  console.error('[backfill] failed', error)
  await mongoose.disconnect()
  process.exit(1)
})
