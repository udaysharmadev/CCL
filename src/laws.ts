/**
 * Real cricket law adjudication.
 *
 * This module is deliberately pure: it takes the physical facts of a delivery and
 * returns the umpire's decision. It imports nothing, renders nothing and stores
 * nothing, which is what lets the browser, the authoritative match server and the
 * test suite all reach identical verdicts from identical facts.
 *
 * References
 * - MCC Laws of Cricket, 2017 Code (4th edition, effective 1 October 2026)
 * - ICC Men's T20I Playing Conditions, effective October 2026
 *
 * Geometry note: the game uses +x for the off side and -x for the leg side, so a
 * right-handed batter's front pad sits on the leg side of the stumps.
 */

/** Half the width of the wicket: nine inches between the outer edges of the stumps. */
export const STUMP_HALF_WIDTH = 0.1143
/** Twenty-eight inches. */
export const STUMP_HEIGHT = 0.711
/** A men's cricket ball is about 36 mm in radius. */
export const BALL_RADIUS = 0.036
/** Four feet in front of the bowling crease: the popping crease. */
export const POPPING_CREASE = 1.22
/** Twenty-two yards between the bowling creases. */
export const PITCH_LENGTH = 20.12
/** The circle used for fielding restrictions, measured from the centre stump. */
export const RESTRICTION_CIRCLE = 27.43
/** Standard gravity. */
export const GRAVITY = 9.81

/** The off stump is on the +x side; the leg stump is on the -x side. */
export const OFF_STUMP = STUMP_HALF_WIDTH
export const LEG_STUMP = -STUMP_HALF_WIDTH

export type Vec3 = { x: number; y: number; z: number }

/**
 * Every way a batter can be dismissed. The 2026 Code renumbered the dismissal
 * laws; these names follow the substance of the Laws rather than their numbers so
 * that they survive the next renumbering.
 */
export type Dismissal =
  | 'bowled'
  | 'caught'
  | 'lbw'
  | 'stumped'
  | 'hit-wicket'
  | 'run-out'
  | 'obstructing-the-field'
  | 'obstructing-a-fielder'
  | 'timed-out'
  | 'retired-out'

export const DISMISSAL_LABELS: Readonly<Record<Dismissal, string>> = {
  bowled: 'Bowled',
  caught: 'Caught',
  lbw: 'LBW',
  stumped: 'Stumped',
  'hit-wicket': 'Hit wicket',
  'run-out': 'Run out',
  'obstructing-the-field': 'Obstructing the field',
  'obstructing-a-fielder': 'Obstructing a fielder',
  'timed-out': 'Timed out',
  'retired-out': 'Retired out',
}

/**
 * The dismissals that survive a free hit. On a free hit the batter may only be
 * dismissed run out, out obstructing the field, out hit the ball twice, timed out
 * or retired out.
 */
export const FREE_HIT_SAFE: Readonly<Record<Dismissal, boolean>> = {
  bowled: false,
  caught: false,
  lbw: false,
  stumped: false,
  'hit-wicket': false,
  'run-out': true,
  'obstructing-the-field': true,
  'obstructing-a-fielder': true,
  'timed-out': true,
  'retired-out': true,
}

export function freeHitAllows(dismissal: Dismissal) {
  return FREE_HIT_SAFE[dismissal]
}

// ---------------------------------------------------------------------------
// Wicket geometry
// ---------------------------------------------------------------------------

/**
 * How much of the ball would overlap the stumps if it crossed the wicket line at
 * this horizontal position. Ball tracking reports this as a percentage; half the
 * ball overlapping is the threshold below which the decision is an umpire's call.
 */
export function stumpPortion(ballX: number, radius = BALL_RADIUS) {
  const half = STUMP_HALF_WIDTH
  const overlap = Math.min(ballX + radius, half) - Math.max(ballX - radius, -half)
  return Math.max(0, Math.min(1, overlap / (2 * radius)))
}

/**
 * Project a ballistic path forward to the wicket line and report whether it would
 * strike the stumps, and how much of the ball would be covered. Drag is ignored:
 * over the final half metre it cannot change the verdict.
 */
export function projectToStumps(
  origin: Vec3,
  velocity: Vec3,
  options: { gravity?: number; radius?: number } = {},
) {
  const gravity = options.gravity ?? GRAVITY
  const radius = options.radius ?? BALL_RADIUS
  if (!(velocity.z < 0)) return { hits: false, portion: 0, at: null }
  const time = origin.z / -velocity.z
  const x = origin.x + velocity.x * time
  const y = origin.y + velocity.y * time - 0.5 * gravity * time * time
  const portion = stumpPortion(x, radius)
  const hits = Math.abs(x) <= STUMP_HALF_WIDTH + radius && y <= STUMP_HEIGHT + radius && y >= 0
  return { hits, portion, at: { x, y, z: 0 } }
}

// ---------------------------------------------------------------------------
// Leg before wicket
// ---------------------------------------------------------------------------

export type LbwFacts = {
  /** Horizontal position of the first landing, or null when the ball never landed. */
  pitchX: number | null
  /** Horizontal position where the ball struck the batter. */
  impactX: number
  /** Whether the bat or a glove touching the handle struck the ball first. */
  batFirst: boolean
  /** Whether the batter offered a stroke at the delivery. */
  strokeOffered: boolean
  /** Whether the ball was heading for the stumps but for the batter's person. */
  wouldHitStumps: boolean
  /** Fraction of the ball that would have covered the stumps, 0 to 1. */
  portion: number
}

export type LbwReason =
  | 'given'
  | 'bat-first'
  | 'not-pitched'
  | 'pitching-outside-leg'
  | 'impact-outside-leg'
  | 'impact-outside-off'
  | 'not-going-to-hit'

export type LbwDecision = {
  out: boolean
  reason: LbwReason
  /** True when the projection is marginal, which is an umpire's call on review. */
  umpiresCall: boolean
}

/**
 * Decide leg before wicket.
 *
 * The batter is out if the ball was not a no ball, it pitched in line with the
 * stumps or outside the off stump, it struck the person without the bat or a
 * glove touching the handle doing so first, and it was travelling towards the
 * stumps. When a stroke was offered the impact must be in line with the stumps;
 * when no stroke was offered an impact outside off stump is still eligible.
 */
export function judgeLbw(facts: LbwFacts): LbwDecision {
  if (facts.batFirst) return { out: false, reason: 'bat-first', umpiresCall: false }
  if (facts.pitchX === null) return { out: false, reason: 'not-pitched', umpiresCall: false }
  if (facts.pitchX < LEG_STUMP) {
    return { out: false, reason: 'pitching-outside-leg', umpiresCall: false }
  }
  if (facts.impactX < LEG_STUMP) {
    return { out: false, reason: 'impact-outside-leg', umpiresCall: false }
  }
  if (facts.strokeOffered && facts.impactX > OFF_STUMP) {
    return { out: false, reason: 'impact-outside-off', umpiresCall: false }
  }
  if (!facts.wouldHitStumps) {
    return { out: false, reason: 'not-going-to-hit', umpiresCall: false }
  }
  return { out: true, reason: 'given', umpiresCall: facts.portion < 0.5 }
}

// ---------------------------------------------------------------------------
// Wides and no balls
// ---------------------------------------------------------------------------

export type WideReason = 'too-wide' | 'over-head-height'

/**
 * A ball is wide when it passes so far outside the wicket that the batter could
 * not have reached it with a normal stroke, or when it passes over the wicket at
 * head height. A delivery above head height is a no ball rather than a wide under
 * the 2026 Code.
 */
export function judgeWide(facts: { line: number; reach: number; overHeadHeight?: boolean }) {
  if (facts.overHeadHeight) return null
  return Math.abs(facts.line) > facts.reach ? ('too-wide' as const) : null
}

export type NoBallReason =
  | 'overstepped'
  | 'front-foot'
  | 'dangerous-delivery'
  | 'bounced-twice'
  | 'field-restriction'

/**
 * A delivery is a no ball when the bowler oversteps, delivers from in front of the
 * crease, bowls dangerously above head height, lets the ball bounce twice, or has a
 * fielder outside the field of play at the moment of release.
 */
export function judgeNoBall(facts: {
  frontFootOverLine?: boolean
  overHeadHeight?: boolean
  bouncedTwice?: boolean
  fielderOutOfPlay?: boolean
}) {
  if (facts.fielderOutOfPlay) return 'field-restriction' as const
  if (facts.overHeadHeight) return 'dangerous-delivery' as const
  if (facts.bouncedTwice) return 'bounced-twice' as const
  if (facts.frontFootOverLine) return 'front-foot' as const
  return null
}

/**
 * Byes are credited when the ball passes the batter untouched. Leg byes are
 * credited when it strikes the person without the bat, but only when a stroke was
 * offered or the batter was trying to avoid the ball.
 */
export function judgeExtras(facts: {
  padContact: boolean
  strokeOffered: boolean
  avoiding: boolean
  runsCompleted: number
}): { byes: number; legByes: number } {
  if (facts.runsCompleted <= 0) return { byes: 0, legByes: 0 }
  if (!facts.padContact) return { byes: facts.runsCompleted, legByes: 0 }
  if (facts.strokeOffered || facts.avoiding) return { byes: 0, legByes: facts.runsCompleted }
  return { byes: 0, legByes: 0 }
}

// ---------------------------------------------------------------------------
// Overthrows and penalty runs
// ---------------------------------------------------------------------------

export type OverthrowFacts = {
  /** Runs the batters completed before the overthrow happened. */
  completed: number
  /** Whether the throw was an attempt to hit the stumps rather than a misfield. */
  attempted: boolean
  /** Whether the overthrow itself broke the wicket. */
  brokeWicket: boolean
}

/**
 * An overthrow adds the runs already completed plus one penalty run. A misfield
 * is not an overthrow. The 2026 Code defines an overthrow as an attempt to direct
 * the ball towards the stumps to stop runs being scored or to attempt a run out.
 */
export function overthrowRuns(facts: OverthrowFacts) {
  if (!facts.attempted) return facts.completed
  return facts.completed + (facts.brokeWicket ? 1 : 1)
}

// ---------------------------------------------------------------------------
// Bowling rotation
// ---------------------------------------------------------------------------

/** A bowler may not bowl more than one fifth of the innings. */
export function bowlerQuota(overs: number) {
  return Math.max(1, Math.floor(overs / 5) || 1)
}

/**
 * Whether a bowler may bowl the next over. A bowler may not bowl two
 * consecutive overs and may not exceed one fifth of the innings.
 */
export function bowlerIsLegal(
  facts: { bowler: number; previousBowler: number | null; oversBowled: number; inningsOvers: number },
) {
  if (facts.previousBowler !== null && facts.bowler === facts.previousBowler) return false
  return facts.oversBowled < bowlerQuota(facts.inningsOvers)
}

/**
 * The bowler who should bowl next. The five eligible bowlers rotate automatically,
 * skipping anyone who bowled the previous over or has used up their quota.
 */
export function nextBowler(facts: {
  eligible: readonly number[]
  previousBowler: number | null
  oversBowled: readonly number[]
  inningsOvers: number
  legalBalls: number
}) {
  const quota = bowlerQuota(facts.inningsOvers)
  const start = Math.floor(facts.legalBalls / 6) % facts.eligible.length
  for (let step = 0; step < facts.eligible.length; step++) {
    const index = (start + step) % facts.eligible.length
    const bowler = facts.eligible[index]
    if (bowler === undefined) continue
    if (facts.previousBowler !== null && bowler === facts.previousBowler) continue
    if ((facts.oversBowled[index] ?? 0) >= quota) continue
    return index
  }
  return facts.eligible.length ? 0 : -1
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export type ReviewableDecision = 'lbw' | 'caught' | 'bowled' | 'run-out' | 'stumped'

export type ReviewOutcome = {
  /** Whether the original decision was changed. */
  changed: boolean
  /** Whether the reviewing side keeps the review. An umpire's call does not cost it. */
  reviewRetained: boolean
  /** The decision after review. */
  decision: 'out' | 'not-out'
  /** The reviewable element that was checked. */
  checked: ReviewableDecision
}

/**
 * Apply a review to a decision.
 *
 * When ball tracking shows the ball only marginally covering the stumps, or the
 * impact was marginal, the on-field decision stands and the reviewing side keeps
 * its review. This is the umpire's call, and the 2026 playing conditions no longer
 * charge a team for an unsuccessful umpire's call.
 */
export function applyReview(facts: {
  original: 'out' | 'not-out'
  /** The reviewed decision under ball tracking or ultra edge. */
  reviewed: 'out' | 'not-out'
  checked: ReviewableDecision
  /** True when the projection was marginal, which makes it an umpire's call. */
  umpiresCall: boolean
}): ReviewOutcome {
  if (facts.umpiresCall) {
    return { changed: false, reviewRetained: true, decision: facts.original, checked: facts.checked }
  }
  return {
    changed: facts.reviewed !== facts.original,
    reviewRetained: false,
    decision: facts.reviewed,
    checked: facts.checked,
  }
}

// ---------------------------------------------------------------------------
// Strike rotation
// ---------------------------------------------------------------------------

/**
 * Work out who faces the next ball.
 *
 * Odd runs completed swap the strike. A run out that happened after the batters
 * crossed also swaps the strike. At the end of an over the strike always changes.
 * The dismissed batter is replaced by the next in the order.
 */
export function nextStrike(facts: {
  striker: number
  nonStriker: number
  completedRuns: number
  crossed: boolean
  dismissed: 'striker' | 'nonStriker' | null
  nextBatter: number
  endOfOver: boolean
}) {
  let striker = facts.striker
  let nonStriker = facts.nonStriker
  if (facts.dismissed) {
    // The incoming batter takes strike and the survivor becomes the non-striker.
    // The runs completed before the dismissal decide which end each is on.
    const survivor = facts.dismissed === 'striker' ? nonStriker : striker
    striker = facts.nextBatter
    nonStriker = survivor
  } else if (facts.completedRuns % 2 === 1) {
    [striker, nonStriker] = [nonStriker, striker]
  }
  if (facts.endOfOver) [striker, nonStriker] = [nonStriker, striker]
  return { striker, nonStriker }
}
