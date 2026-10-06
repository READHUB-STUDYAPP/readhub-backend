import type { IBuddyProfile, ReadingPace, ReadingTime } from '../models/buddyProfile.js'

/**
 * How well two readers suit each other, and why.
 *
 * Rules, not a model. The PRD asks for this explicitly and the reasoning is
 * worth keeping in view: a score a student cannot interrogate is a score they
 * cannot trust, and "82% match" means nothing without the sentence underneath
 * it. Every signal here can be explained in one clause, which is what makes the
 * explanation generatable rather than written by hand.
 *
 * Weights sum to 100. They are ordered by how much each one actually predicts
 * a pair reading together rather than by how easy it is to compute: shared
 * taste gets the most, because two people who like nothing in common run out of
 * things to say however well their schedules line up.
 */

export const WEIGHTS = {
  genres: 30,
  purpose: 20,
  pace: 15,
  goal: 15,
  time: 10,
  books: 10,
} as const

/** Reading times sit on a clock, so "near" is meaningful and worth part marks. */
const TIME_ORDER: ReadingTime[] = [
  'early-morning',
  'morning',
  'afternoon',
  'evening',
  'night',
]

const PACE_ORDER: ReadingPace[] = ['relaxed', 'steady', 'fast']

export interface MatchResult {
  score: number
  /** One sentence, assembled from whichever signals actually fired. */
  explanation: string
  /** The signals that contributed, strongest first. Lets a UI show chips. */
  reasons: string[]
  sharedGenres: string[]
  sharedBooks: string[]
}

const overlap = (a: string[] = [], b: string[] = []) => {
  const right = new Set(b.map((value) => value.toLowerCase().trim()))
  return a.filter((value) => right.has(value.toLowerCase().trim()))
}

/** A readable fragment for a list of things: "fantasy, memoir and poetry". */
function list(values: string[], limit = 3): string {
  const shown = values.slice(0, limit)
  if (shown.length <= 1) return shown[0] ?? ''
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
}

const TIME_WORDS: Record<ReadingTime, string> = {
  'early-morning': 'early morning',
  morning: 'morning',
  afternoon: 'afternoon',
  evening: 'evening',
  night: 'night',
  flexible: 'flexible',
}

const PURPOSE_WORDS: Record<string, string> = {
  accountability: 'keeping each other accountable',
  discussion: 'talking about what you read',
  casual: 'reading at an easy pace',
  'goal-focused': 'working towards a goal',
}

/**
 * Score one reader against another.
 *
 * `currentBookIds` are passed as strings rather than read off the profile so
 * the caller can decide what "currently reading" means -- the profile's own
 * list, or the live reading sessions -- without this function reaching into the
 * database.
 */
export function scoreMatch(
  me: Pick<
    IBuddyProfile,
    'genres' | 'purpose' | 'pace' | 'monthlyGoal' | 'preferredTime' | 'currentBooks'
  >,
  them: Pick<
    IBuddyProfile,
    'genres' | 'purpose' | 'pace' | 'monthlyGoal' | 'preferredTime' | 'currentBooks'
  >,
  bookTitles: Map<string, string> = new Map(),
): MatchResult {
  const reasons: string[] = []
  let score = 0

  // Taste. Scored against the smaller of the two lists, so someone who picked
  // three genres is not punished for matching someone who picked eight.
  const sharedGenres = overlap(me.genres, them.genres)
  const genreFloor = Math.min(me.genres?.length || 0, them.genres?.length || 0)
  if (genreFloor > 0 && sharedGenres.length > 0) {
    score += WEIGHTS.genres * (sharedGenres.length / genreFloor)
    reasons.push(`You both read ${list(sharedGenres)}`)
  }

  // What they each want out of it. A discussion partner paired with someone who
  // wants silent accountability is a pair that quietly stops talking.
  if (me.purpose === them.purpose) {
    score += WEIGHTS.purpose
    reasons.push(`You are both here for ${PURPOSE_WORDS[them.purpose] ?? them.purpose}`)
  }

  // Pace. Adjacent is most of the way there; opposite ends are not.
  const paceGap = Math.abs(PACE_ORDER.indexOf(me.pace) - PACE_ORDER.indexOf(them.pace))
  if (paceGap === 0) {
    score += WEIGHTS.pace
    reasons.push(`You read at a similar pace`)
  } else if (paceGap === 1) {
    score += WEIGHTS.pace * 0.5
  }

  // Goals, as a ratio rather than a difference: one book against two is a real
  // gap, nine against ten is not.
  const mine = Math.max(1, me.monthlyGoal || 1)
  const theirs = Math.max(1, them.monthlyGoal || 1)
  const goalRatio = Math.min(mine, theirs) / Math.max(mine, theirs)
  score += WEIGHTS.goal * goalRatio
  if (goalRatio >= 0.75) {
    reasons.push(`You are aiming for about the same number of books a month`)
  }

  // When they read. "Flexible" fits anyone, which is the point of choosing it.
  if (me.preferredTime === 'flexible' || them.preferredTime === 'flexible') {
    score += WEIGHTS.time * 0.6
  } else if (me.preferredTime === them.preferredTime) {
    score += WEIGHTS.time
    reasons.push(`You both prefer reading in the ${TIME_WORDS[them.preferredTime]}`)
  } else {
    const gap = Math.abs(
      TIME_ORDER.indexOf(me.preferredTime) - TIME_ORDER.indexOf(them.preferredTime),
    )
    if (gap === 1) score += WEIGHTS.time * 0.5
  }

  // Reading the same book right now is the strongest invitation there is, so it
  // is called out even though it carries fewer points than taste.
  const sharedBookIds = overlap(
    (me.currentBooks ?? []).map(String),
    (them.currentBooks ?? []).map(String),
  )
  if (sharedBookIds.length > 0) {
    score += WEIGHTS.books
    const titles = sharedBookIds.map((id) => bookTitles.get(id)).filter(Boolean) as string[]
    reasons.push(
      titles.length > 0
        ? `You are both reading ${list(titles, 2)}`
        : `You are reading the same book right now`,
    )
  }

  const rounded = Math.max(0, Math.min(100, Math.round(score)))

  // The sentence under the percentage. Two reasons is enough to be convincing;
  // more reads as a sales pitch.
  const explanation =
    reasons.length === 0
      ? 'You are both looking for a reading buddy.'
      : `${reasons.slice(0, 2).join('. ')}.`

  return {
    score: rounded,
    explanation,
    reasons,
    sharedGenres,
    sharedBooks: sharedBookIds,
  }
}
