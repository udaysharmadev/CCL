import { freeHitAllows, type Dismissal } from './laws.ts'

export const RULE_PROFILE = 'arcade_short_v1'
export const BALLS_PER_OVER = 6
export const WICKETS_PER_INNINGS = 10

export type Contact = 'middle' | 'edge' | 'miss'
export type Wicket = Dismissal
export type DeadBallReason =
  | 'bowled' | 'caught' | 'lbw' | 'stumped' | 'hit-wicket'
  | 'boundary' | 'fielded' | 'collected' | 'run-out' | 'hit-pad'

type Extras = { wide: number; noBall: number; byes: number; legByes: number; penalty: number }

/** Per-batter figures for the scorecard. */
export type BatterStats = Readonly<{
  name: string
  playerId?: string
  runs: number
  balls: number
  fours: number
  sixes: number
  dismissed: boolean
  dismissal: Wicket | null
  /** How the batter was dismissed, in words. */
  dismissalText: string
}>

/** Per-bowler figures for the scorecard. */
export type BowlerStats = Readonly<{
  name: string
  playerId?: string
  balls: number
  runs: number
  wickets: number
  maidens: number
  wides: number
  noBalls: number
}>

export type Partnership = Readonly<{
  batter: number
  partner: number
  runs: number
  balls: number
}>

export type FallOfWicket = Readonly<{
  batter: number
  runs: number
  overs: number
}>

export type DeliveryOutcome = Readonly<Omit<Extras, 'penalty'> & {
  /** Penalty runs awarded to the batting side. */
  penalty?: number
  batRuns: number
  wicket: Wicket | null
  completedRuns: number
  reason: DeadBallReason
  contact: Contact
  /** Identity at the start of the delivery; absent on legacy striker dismissals. */
  dismissedBatter?: 'striker' | 'nonStriker'
  /** Whether the pair crossed during the unfinished run at a run-out. */
  crossed?: boolean
  /** Whether the ball struck the batter without the bat. */
  padContact?: boolean
  /** Whether the batter offered a stroke at the delivery. */
  shotOffered?: boolean
  /** Extra runs awarded for an overthrow. */
  overthrowRuns?: number
  /** Why the delivery was called a no ball. */
  noBallReason?: string
  /** Why the delivery was called wide. */
  wideReason?: string
  /** The name of the bowler who delivered it. */
  bowler?: string
  bowlerId?: string
}>

export type Innings = Readonly<{
  runs: number
  wickets: number
  legalBalls: number
  attempts: number
  freeHit: boolean
  striker: number
  nonStriker: number
  history: readonly DeliveryOutcome[]
  complete: boolean
  overs: number
  target: number | undefined
  extras: Extras
  batting: readonly BatterStats[]
  bowling: readonly BowlerStats[]
  partnerships: readonly Partnership[]
  fallOfWickets: readonly FallOfWicket[]
  /** Total runs scored from the bat and from extras, kept for the run rate. */
  lastOverRuns: readonly number[]
  /** Opt-in local selection state; historical and online innings omit it. */
  selection?: Readonly<{
    battingOrder: readonly number[]
    entered: readonly number[]
    pendingBatter: 'striker' | 'nonStriker' | null
  }>
}>

export function newInnings(overs = 2, target?: number, lineup: readonly string[] = []): Innings {
  return {
    runs: 0, wickets: 0, legalBalls: 0, attempts: 0, freeHit: false,
    striker: 1, nonStriker: 2, history: [], complete: false, overs, target,
    extras: { wide: 0, noBall: 0, byes: 0, legByes: 0, penalty: 0 },
    batting: lineup.map((name, index) => ({
      name, runs: 0, balls: 0, fours: 0, sixes: 0, dismissed: false, dismissal: null, dismissalText: 'not out',
    })),
    bowling: [],
    partnerships: [],
    fallOfWickets: [],
    lastOverRuns: [],
  }
}

export function formatOvers(legalBalls: number): string {
  return `${Math.floor(legalBalls / BALLS_PER_OVER)}.${legalBalls % BALLS_PER_OVER}`
}

function baseDeliveryToken(outcome: DeliveryOutcome): string {
  if (outcome.wicket) return 'W'
  if (outcome.noBall) return outcome.batRuns ? `Nb+${outcome.batRuns}` : 'Nb'
  if (outcome.wide) return outcome.wide > 1 ? `${outcome.wide}Wd` : 'Wd'
  if (outcome.byes) return `${outcome.byes}B`
  if (outcome.legByes) return `${outcome.legByes}Lb`
  return outcome.batRuns ? String(outcome.batRuns) : '•'
}

export function deliveryToken(outcome: DeliveryOutcome): string {
  const token = baseDeliveryToken(outcome)
  if (!outcome.overthrowRuns) return token
  return `${token === '•' ? '' : `${token}+`}${outcome.overthrowRuns}OT`
}

const DISMISSAL_TEXT: Readonly<Record<Wicket, string>> = {
  bowled: 'bowled',
  caught: 'caught',
  lbw: 'lbw',
  stumped: 'stumped',
  'hit-wicket': 'hit wicket',
  'run-out': 'run out',
  'obstructing-the-field': 'obstructing the field',
  'obstructing-a-fielder': 'obstructing a fielder',
  'timed-out': 'timed out',
  'retired-out': 'retired out',
}

export function dismissalText(wicket: Wicket) {
  return DISMISSAL_TEXT[wicket]
}

function blankBatter(name: string): BatterStats {
  return { name, runs: 0, balls: 0, fours: 0, sixes: 0, dismissed: false, dismissal: null, dismissalText: 'not out' }
}

export function applyDelivery(state: Innings, outcome: DeliveryOutcome): Innings {
  if (state.complete) return state
  if (state.selection?.pendingBatter) throw new Error('Select the incoming batter before the next delivery.')

  const { noBall, byes, legByes, completedRuns } = outcome
  const wide = noBall ? 0 : outcome.wide
  const batRuns = wide ? 0 : outcome.batRuns
  const legal = !wide && !noBall
  // A free hit protects the batter from every dismissal except run out,
  // obstructing the field, obstructing a fielder, timed out and retired out.
  const dismissalRestricted = state.freeHit || !legal
  const wicket = dismissalRestricted && outcome.wicket && !freeHitAllows(outcome.wicket) ? null : outcome.wicket
  const legalBalls = state.legalBalls + Number(legal)
  const wickets = state.wickets + Number(wicket !== null)
  const overthrowRuns = outcome.overthrowRuns ?? 0
  const penaltyRuns = outcome.penalty ?? 0
  const runs = state.runs + batRuns + wide + noBall + byes + legByes + overthrowRuns + penaltyRuns
  const complete = legalBalls >= state.overs * BALLS_PER_OVER || wickets >= WICKETS_PER_INNINGS ||
    (state.target !== undefined && runs >= state.target)

  let striker = state.striker
  let nonStriker = state.nonStriker
  let pendingBatter: 'striker' | 'nonStriker' | null = null
  if ((!wicket || wicket === 'run-out') && completedRuns % 2) {
    [striker, nonStriker] = [nonStriker, striker]
  }
  if (wicket === 'run-out' && outcome.crossed) [striker, nonStriker] = [nonStriker, striker]
  const dismissed = outcome.dismissedBatter ?? 'striker'
  if (wicket && wickets < WICKETS_PER_INNINGS && (!state.selection || !complete)) {
    const gone = state[dismissed]
    const incoming = state.selection && !complete ? 0 : wickets + 2
    if (striker === gone) { striker = incoming; if (incoming === 0) pendingBatter = 'striker' }
    else { nonStriker = incoming; if (incoming === 0) pendingBatter = 'nonStriker' }
  }
  if (legal && legalBalls % BALLS_PER_OVER === 0) {
    [striker, nonStriker] = [nonStriker, striker]
    if (pendingBatter) pendingBatter = pendingBatter === 'striker' ? 'nonStriker' : 'striker'
  }

  // ---- Scorecard bookkeeping -------------------------------------------------
  const batting = state.batting.map((batter) => ({ ...batter }))
  const bowling = state.bowling.map((bowler) => ({ ...bowler }))
  const setBatter = (index: number, change: (batter: BatterStats) => BatterStats) => {
    const position = index - 1
    if (position < 0) return
    batting[position] = change(batting[position] ?? blankBatter(''))
  }
  const batterOnStrike = state.striker
  const bowlerName = outcome.bowler ?? ''

  if (bowlerName) {
    const existing = bowling.findIndex((bowler) => outcome.bowlerId ? bowler.playerId === outcome.bowlerId : bowler.name === bowlerName)
    const figure: BowlerStats = existing >= 0 ? bowling[existing] : {
      name: bowlerName, balls: 0, runs: 0, wickets: 0, maidens: 0, wides: 0, noBalls: 0,
      ...(outcome.bowlerId ? { playerId: outcome.bowlerId } : {}),
    }
    const next: BowlerStats = {
      ...figure,
      balls: figure.balls + Number(legal),
      // Byes and leg byes are charged to the team, not to the bowler.
      runs: figure.runs + batRuns + overthrowRuns + wide + noBall,
      wickets: figure.wickets + Number(wicket !== null && wicket !== 'run-out'),
      wides: figure.wides + wide,
      noBalls: figure.noBalls + noBall,
    }
    if (legal && legalBalls % BALLS_PER_OVER === 0) {
      const over = [outcome]
      let balls = 1
      for (let index = state.history.length - 1; index >= 0; index--) {
        const ball = state.history[index]
        if (!ball.wide && !ball.noBall && balls === BALLS_PER_OVER) break
        over.unshift(ball)
        if (!ball.wide && !ball.noBall) balls++
      }
      if (over.every(ball => (ball.bowler ?? bowlerName) === bowlerName &&
        ball.batRuns + ball.wide + ball.noBall + (ball.overthrowRuns ?? 0) === 0)) {
        bowling[existing >= 0 ? existing : bowling.length] = { ...next, maidens: next.maidens + 1 }
      } else if (existing >= 0) bowling[existing] = next
      else bowling.push(next)
    } else if (existing >= 0) bowling[existing] = next
    else bowling.push(next)
  }

  if (!wide) {
    const strikerWicket = wicket !== 'run-out' ? wicket : dismissed === 'striker' ? wicket : null
    setBatter(batterOnStrike, (batter) => ({
      ...batter, runs: batter.runs + batRuns, balls: batter.balls + Number(legal),
      fours: batter.fours + Number(batRuns === 4 && outcome.reason === 'boundary'),
      sixes: batter.sixes + Number(batRuns === 6 && outcome.reason === 'boundary'),
      dismissed: batter.dismissed || strikerWicket !== null,
      dismissal: strikerWicket ?? batter.dismissal,
      dismissalText: strikerWicket ? dismissalText(strikerWicket) : batter.dismissalText,
    }))
  }
  if (wicket === 'run-out') {
    setBatter(state[dismissed], batter => ({ ...batter, dismissed: true, dismissal: wicket, dismissalText: dismissalText(wicket) }))
  }

  const partnerships = [...state.partnerships]
  const lastPartnership = partnerships.at(-1)
  // A partnership continues through a change of strike; it only ends with a wicket.
  const samePair = lastPartnership !== undefined && (
    (lastPartnership.batter === batterOnStrike && lastPartnership.partner === state.nonStriker) ||
    (lastPartnership.batter === state.nonStriker && lastPartnership.partner === batterOnStrike))
  if (!samePair) partnerships.push({ batter: batterOnStrike, partner: state.nonStriker, runs: 0, balls: 0 })
  const current = partnerships.at(-1)!
  partnerships[partnerships.length - 1] = {
    ...current,
    runs: current.runs + batRuns + wide + noBall + byes + legByes + overthrowRuns + penaltyRuns,
    balls: current.balls + Number(legal),
  }

  const fallOfWickets = [...state.fallOfWickets]
  if (wicket) {
    fallOfWickets.push({ batter: state[dismissed], runs, overs: legalBalls })
  }

  const lastOverRuns = [...state.lastOverRuns]
  if (legal) {
    lastOverRuns.push(batRuns + byes + legByes + overthrowRuns)
    if (lastOverRuns.length > BALLS_PER_OVER) lastOverRuns.splice(0, lastOverRuns.length - BALLS_PER_OVER)
  }

  return {
    ...state, runs, wickets, legalBalls, striker, nonStriker, complete,
    attempts: state.attempts + 1,
    freeHit: Boolean(noBall) || (state.freeHit && !legal),
    history: [...state.history, { ...outcome, wide, batRuns, wicket }],
    extras: {
      wide: state.extras.wide + wide,
      noBall: state.extras.noBall + noBall,
      byes: state.extras.byes + byes,
      legByes: state.extras.legByes + legByes,
      // Both are penalty extras; keep their outcome fields separate because
      // only overthrows are charged to the bowler under the CCL rules.
      penalty: state.extras.penalty + penaltyRuns + overthrowRuns,
    },
    batting, bowling, partnerships, fallOfWickets, lastOverRuns,
    ...(state.selection ? { selection: { ...state.selection, pendingBatter } } : {}),
  }
}

// Adopted reduction table from ICC Men's T20I October 2026 clause 28.7.6.
// One-over training and 2–4 over matches use the game's six-ball powerplay.
export function powerplayBalls(overs: number) {
  const reduced = [9, 11, 13, 14, 16, 18, 20, 22, 23, 25, 27, 29, 31, 32, 34, 36]
  return overs < 5 ? 6 : reduced[Math.min(20, overs) - 5]
}

export function outsideLimit(overs: number, legalBalls: number) {
  return legalBalls < powerplayBalls(overs) ? 2 : 5
}

// The five eligible bowlers rotate automatically. This prevents consecutive
// overs and limits each bowler to ceil(overs / 5), including reduced innings.
export function bowlerIndex(legalBalls: number) {
  return Math.floor(legalBalls / BALLS_PER_OVER) % 5
}

/** The number of overs each bowler may bowl in an innings of this length. */
export function bowlerQuota(overs: number) {
  return Math.max(1, Math.floor(overs / 5) || 1)
}

/**
 * The bowler who should bowl next over. The five eligible bowlers rotate, but a
 * bowler who bowled the previous over or has used up their quota is skipped.
 */
export function nextBowler(facts: {
  eligible: readonly number[]
  previousBowler: number | null
  oversBowled: readonly number[]
  inningsOvers: number
  legalBalls: number
}) {
  const quota = bowlerQuota(facts.inningsOvers)
  const start = Math.floor(facts.legalBalls / BALLS_PER_OVER) % facts.eligible.length
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

/** The run rate so far and the rate required to win a chase. */
export function runRates(innings: Innings) {
  const balls = Math.max(1, innings.legalBalls)
  const current = (innings.runs / balls) * 6
  const ballsLeft = innings.overs * BALLS_PER_OVER - innings.legalBalls
  const required = innings.target === undefined || ballsLeft <= 0
    ? null
    : Math.max(0, (innings.target - innings.runs) / ballsLeft) * 6
  return { current, required }
}
