/**
 * Player identities.
 *
 * Every commercial cricket game treats its bowlers as interchangeable, and
 * players notice: "why is this bowler bowling 90 miles an hour?". This module
 * gives each player in the roster a style, so the bowler at the crease really
 * does bowl the ball the bowler would bowl.
 */

import type { DeliveryKind } from './cricket.ts'

export type BowlingStyle = {
  /** The deliveries this bowler uses, most used first. */
  kinds: readonly DeliveryKind[]
  /** How hard the bowler bowls, from 0.55 to 1. */
  effort: number
  /** How close the bowler bowls to the stumps, from 0 to 1. */
  accuracy: number
  /** The length the bowler favours. */
  length: 'full' | 'good' | 'short'
  /** How much the ball moves in the air, as a multiplier. */
  swing: number
  /** How much the ball turns off the pitch, as a multiplier. */
  turn: number
}

export type BattingStyle = {
  /** How well the batter times the ball, from 0 to 1. */
  timing: number
  /** How hard the batter hits, from 0 to 1. */
  power: number
  /** How much the batter risks, from 0 to 1. */
  aggression: number
  /** The batter's running speed as a multiplier on the shared pace. */
  running: number
}

export type PlayerProfile = {
  bowling?: BowlingStyle
  batting?: BattingStyle
}

const POWER: BowlingStyle = {
  kinds: ['fast', 'yorker', 'bouncer', 'length'], effort: 0.97, accuracy: 0.52,
  length: 'good', swing: 0.8, turn: 0.7,
}
const SWING: BowlingStyle = {
  kinds: ['inswing', 'outswing', 'fast', 'length'], effort: 0.78, accuracy: 0.62,
  length: 'good', swing: 1.35, turn: 0.6,
}
const LINE: BowlingStyle = {
  kinds: ['length', 'fast', 'yorker'], effort: 0.66, accuracy: 0.9,
  length: 'good', swing: 0.7, turn: 0.8,
}
const QUICK: BowlingStyle = {
  kinds: ['fast', 'length', 'bouncer'], effort: 0.72, accuracy: 0.74,
  length: 'short', swing: 0.9, turn: 0.7,
}
const OFF_SPIN: BowlingStyle = {
  kinds: ['spin', 'length'], effort: 0.6, accuracy: 0.8,
  length: 'good', swing: 0.3, turn: 1.3,
}
const LEG_SPIN: BowlingStyle = {
  kinds: ['legspin', 'spin'], effort: 0.6, accuracy: 0.78,
  length: 'good', swing: 0.3, turn: 1.45,
}
const CHINAMAN: BowlingStyle = {
  kinds: ['legspin', 'outswing', 'fast'], effort: 0.7, accuracy: 0.66,
  length: 'full', swing: 1.1, turn: 1.1,
}

const BATTING: Record<string, BattingStyle> = {
  Mehta: { timing: 0.72, power: 0.7, aggression: 0.6, running: 1.0 },
  Rao: { timing: 0.6, power: 0.55, aggression: 0.45, running: 1.06 },
  Singh: { timing: 0.78, power: 0.75, aggression: 0.68, running: 0.98 },
  Iyer: { timing: 0.62, power: 0.45, aggression: 0.4, running: 1.08 },
  Patel: { timing: 0.8, power: 0.5, aggression: 0.42, running: 0.96 },
  Khan: { timing: 0.66, power: 0.68, aggression: 0.62, running: 1.02 },
  Shah: { timing: 0.7, power: 0.52, aggression: 0.5, running: 1.0 },
  Gill: { timing: 0.84, power: 0.82, aggression: 0.66, running: 0.97 },
  Das: { timing: 0.58, power: 0.5, aggression: 0.38, running: 1.1 },
  Reddy: { timing: 0.68, power: 0.62, aggression: 0.52, running: 1.04 },
  Joshi: { timing: 0.6, power: 0.46, aggression: 0.36, running: 1.12 },
  Nair: { timing: 0.74, power: 0.58, aggression: 0.48, running: 1.05 },
  Dutt: { timing: 0.64, power: 0.64, aggression: 0.56, running: 1.0 },
  Sen: { timing: 0.56, power: 0.42, aggression: 0.34, running: 1.14 },
  Roy: { timing: 0.76, power: 0.86, aggression: 0.78, running: 0.94 },
}

/**
 * The bowling style of each player in the roster, chosen by their role.
 * The order matches the roster in `match-data.ts`.
 */
export const BOWLING_STYLES: Readonly<Record<string, BowlingStyle>> = {
  Mehta: LINE, Rao: POWER, Singh: LINE, Iyer: OFF_SPIN, Patel: OFF_SPIN,
  Khan: POWER, Shah: LEG_SPIN, Gill: LINE, Das: QUICK, Reddy: LINE,
  Joshi: CHINAMAN, Nair: OFF_SPIN, Dutt: SWING, Sen: SWING, Roy: SWING,
}

/** The style of a bowler, falling back to a steady medium pace. */
export function bowlingStyle(name: string): BowlingStyle {
  return BOWLING_STYLES[name] ?? LINE
}

/** The batting attributes of a player, falling back to an average batter. */
export function battingStyle(name: string): BattingStyle {
  return BATTING[name] ?? { timing: 0.68, power: 0.6, aggression: 0.5, running: 1 }
}

/**
 * The line a bowler of this style aims at, given the seed of the delivery.
 * A more accurate bowler bowls closer to the stumps.
 */
export function bowlingLine(style: BowlingStyle, random: number) {
  // A more accurate bowler keeps the ball closer to the stumps.
  const spread = 1.05 - style.accuracy * 0.55
  return (random - 0.5) * spread
}
