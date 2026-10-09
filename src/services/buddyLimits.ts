/**
 * How much of Reading Buddy one account may use.
 *
 * There is no payment system yet, so every reader is on the free tier today.
 * The limits still live behind this one function rather than as bare numbers in
 * the controllers, because the PRD's requirement is that limits are *enforced*,
 * and the thing that makes that true later is having exactly one place that
 * decides. When a tier arrives, it is read here and nothing else changes.
 *
 * The free numbers are chosen to let the feature prove itself: one buddy is the
 * relationship the MVP is testing, and five outstanding requests is enough to
 * ask around without becoming a way to message strangers in bulk.
 */

export type BuddyTier = 'free' | 'premium'

export interface BuddyLimits {
  tier: BuddyTier
  /** Live pairs allowed at once. */
  activeBuddies: number
  /** Requests that may sit unanswered at once. */
  pendingRequests: number
  /** Whether the extra discovery filters are available. */
  advancedFilters: boolean
}

const FREE: BuddyLimits = {
  tier: 'free',
  activeBuddies: 1,
  pendingRequests: 5,
  advancedFilters: false,
}

const PREMIUM: BuddyLimits = {
  tier: 'premium',
  activeBuddies: 10,
  pendingRequests: 25,
  advancedFilters: true,
}

/**
 * The limits for one account.
 *
 * Takes the user rather than an id so the caller passes what it already has.
 * Administrators are given the premium shape -- not as a perk, but so that
 * anyone moderating the feature can actually reach the pairs they moderate.
 */
export function limitsFor(user?: { role?: string } | null): BuddyLimits {
  // `admin` is the only elevated role the User model defines.
  if (user?.role === 'admin') return PREMIUM
  return FREE
}

export { FREE as FREE_LIMITS, PREMIUM as PREMIUM_LIMITS }
