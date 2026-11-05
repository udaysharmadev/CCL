import type { Contact, DeadBallReason, DeliveryOutcome, Wicket } from './rules.ts'
import { judgeExtras, judgeLbw, projectToStumps, LEG_STUMP, OFF_STUMP } from './laws.ts'

export const DT = 1 / 60
export const PITCH_LENGTH = 20.12
export const BOUNDARY = 64
const CIRCULAR_BOUNDARY = Object.freeze({ x: BOUNDARY, z: BOUNDARY })
export const KEEPER = Object.freeze({ x: 0, y: 0, z: -3.7 })
export const FIELDERS = [
  { x: 5, y: 0, z: -7 },
  { x: 19, y: 0, z: 1 },
  { x: 27, y: 0, z: 22 },
  { x: 10, y: 0, z: 33 },
  { x: -11, y: 0, z: 32 },
  { x: -28, y: 0, z: 17 },
  { x: -25, y: 0, z: -6 },
  { x: -12, y: 0, z: -37 },
  { x: 34, y: 0, z: -32 },
] as const satisfies readonly Vec3[]
export const SHOTS = [
  'drive', 'cut', 'pull', 'loft', 'defend', 'cover-drive', 'on-drive',
  'flick', 'sweep', 'reverse-sweep', 'ramp', 'hook',
  'off-drive', 'square-drive', 'backfoot-punch', 'backfoot-defense', 'late-cut', 'upper-cut', 'square-cut', 'leg-glance', 'paddle-sweep', 'slog-sweep', 'slog', 'inside-out', 'helicopter', 'scoop', 'reverse-scoop', 'switch-hit', 'reverse-ramp', 'duck', 'leave',
] as const
export const DELIVERIES = ['fast', 'length', 'yorker', 'spin', 'inswing', 'outswing', 'bouncer', 'legspin'] as const
export const FIELD_PRESETS = ['balanced', 'attack', 'powerplay', 'pace-ring', 'leg-trap', 'boundary',
  'standard', 'catching', 'attacking', 'deep-set'] as const
export const PITCH_PRESETS = ['dry', 'green', 'hard', 'dusty'] as const
export const WEATHER_PRESETS = ['clear', 'overcast', 'breezy'] as const

/**
 * The named fielding positions, in metres from the striker's stumps.
 *
 * The game uses +x for the off side and -x for the leg side, so the slips,
 * gully, point and third man sit on the off side behind the stumps while fine
 * leg sits on the leg side. The keeper is handled separately.
 */
export const FIELD_POSITIONS = [
  { name: 'Slip', x: 0.9, z: -1.6 },
  { name: 'Second Slip', x: 2.4, z: -2.1 },
  { name: 'Gully', x: 5.4, z: -3.4 },
  { name: 'Point', x: 16.5, z: 1.2 },
  { name: 'Backward Point', x: 20.5, z: -6.5 },
  { name: 'Cover Point', x: 15.5, z: 6.5 },
  { name: 'Cover', x: 10.5, z: 10.5 },
  { name: 'Extra Cover', x: 6.4, z: 14.5 },
  { name: 'Mid Off', x: 3.1, z: 18.2 },
  { name: 'Mid On', x: -3.1, z: 18.2 },
  { name: 'Mid Wicket', x: -11.6, z: 12.0 },
  { name: 'Square Leg', x: -13.6, z: 2.2 },
  { name: 'Fine Leg', x: -6.6, z: -3.2 },
  { name: 'Third Man', x: 17.5, z: -8.5 },
  { name: 'Long Off', x: 12.0, z: 46.0 },
  { name: 'Long On', x: -12.0, z: 46.0 },
  { name: 'Deep Point', x: 24.0, z: 20.0 },
  { name: 'Deep Cover', x: 17.5, z: 26.0 },
  { name: 'Deep Mid Wicket', x: -25.0, z: 32.0 },
  { name: 'Deep Square Leg', x: -30.0, z: 13.0 },
  { name: 'Cow Corner', x: -27.0, z: 39.0 },
  { name: 'Deep Third Man', x: 24.0, z: -18.0 },
] as const

export type FieldPositionName = (typeof FIELD_POSITIONS)[number]['name']

export type Vec3 = { x: number; y: number; z: number }
export type Shot = (typeof SHOTS)[number]
export type DeliveryKind = (typeof DELIVERIES)[number]
export type FieldPreset = (typeof FIELD_PRESETS)[number]
export type PitchPreset = (typeof PITCH_PRESETS)[number]
export type WeatherPreset = (typeof WEATHER_PRESETS)[number]
export type BoundaryDimensions = Readonly<{ x: number; z: number }>
export type ShotInput = { kind: Shot; aim: number; power?: number }
export type DeliveryOptions = {
  seed: number
  kind: DeliveryKind
  line?: number
  effort?: number
  freeHit?: boolean
  field?: FieldPreset
  maxOutside?: number
  fieldLayout?: readonly Vec3[]
  pitch?: PitchPreset
  weather?: WeatherPreset
  boundary?: BoundaryDimensions
  runningMode?: 'manual'
  fieldingMode?: 'manual'
  /** The name of the bowler, used to attribute the figures on the scorecard. */
  bowler?: string
  /** How worn the pitch is, from 0 for fresh to 1 for a used pitch. */
  pitchWear?: number
  /** The running pace of the two batters as a multiplier on the shared pace. */
  runnerPace?: readonly [number, number]
  /** How much this bowler moves the ball in the air, as a multiplier. */
  swing?: number
  /** How much this bowler turns the ball off the pitch, as a multiplier. */
  turn?: number
  /**
   * The contact window as a multiplier. One is the standard window, a larger
   * value is more forgiving and a smaller value demands more precision.
   */
  timingWindow?: number
}
export type Timing = 'early' | 'good' | 'perfect' | 'late'
export type FieldingCommand = { type: 'select'; index: number } | { type: 'move'; x: number; z: number } | { type: 'chase' } | { type: 'throw'; end: 'striker' | 'bowler' }
export type DeliveryAction = 'hold' | 'approach' | 'chase' | 'pickup' | 'return' | 'break' | 'stump' | 'complete'

export const SHOT_LABELS: Readonly<Record<Shot, string>> = {
  drive: 'Drive', cut: 'Cut', pull: 'Pull', loft: 'Loft', defend: 'Defend',
  'cover-drive': 'Cover Drive', 'on-drive': 'On Drive', flick: 'Flick', sweep: 'Sweep',
  'reverse-sweep': 'Reverse Sweep', ramp: 'Ramp', hook: 'Hook',
  'off-drive': 'Off Drive',
  'square-drive': 'Square Drive',
  'backfoot-punch': 'Back-foot Punch',
  'backfoot-defense': 'Back-foot Defense',
  'late-cut': 'Late Cut',
  'upper-cut': 'Upper Cut',
  'square-cut': 'Square Cut',
  'leg-glance': 'Leg Glance',
  'paddle-sweep': 'Paddle Sweep',
  'slog-sweep': 'Slog Sweep',
  'slog': 'Slog',
  'inside-out': 'Inside Out',
  'helicopter': 'Helicopter',
  'scoop': 'Scoop',
  'reverse-scoop': 'Reverse Scoop',
  'switch-hit': 'Switch Hit',
  'reverse-ramp': 'Reverse Ramp',
  'duck': 'Duck',
  'leave': 'Leave',
}
export const SHOT_ANGLES: Readonly<Record<Shot, number>> = {
  drive: 0, cut: 1.12, pull: -1.03, loft: 0, defend: 0,
  'cover-drive': 0.64, 'on-drive': -0.45, flick: -1.16, sweep: -1.52,
  'reverse-sweep': 1.46, ramp: 2.84, hook: -1.93,
  'off-drive': 0.3,
  'square-drive': 1.02,
  'backfoot-punch': 0.55,
  'backfoot-defense': 0,
  'late-cut': 2.05,
  'upper-cut': 1.95,
  'square-cut': 1.57,
  'leg-glance': -2.35,
  'paddle-sweep': -2.35,
  'slog-sweep': -1.13,
  'slog': -0.65,
  'inside-out': 0.82,
  'helicopter': -0.48,
  'scoop': -2.95,
  'reverse-scoop': 2.75,
  'switch-hit': 1.3,
  'reverse-ramp': 2.9,
  'duck': 0,
  'leave': 0,
}
export const DELIVERY_LABELS: Readonly<Record<DeliveryKind, string>> = {
  fast: 'Fast', length: 'Length', yorker: 'Yorker', spin: 'Spin',
  inswing: 'Inswing', outswing: 'Outswing', bouncer: 'Bouncer', legspin: 'Leg Spin',
}
export const FIELD_LABELS: Readonly<Record<FieldPreset, string>> = {
  balanced: 'Balanced', attack: 'Attack', powerplay: 'Powerplay', 'pace-ring': 'Pace Ring',
  'leg-trap': 'Leg Trap', boundary: 'Boundary Defence',
  standard: 'Test Standard', catching: 'Catching', attacking: 'Attacking Ring', 'deep-set': 'Deep Set',
}
export const PITCH_LABELS: Readonly<Record<PitchPreset, string>> = {
  dry: 'Dry', green: 'Green', hard: 'Hard', dusty: 'Dusty',
}
export const WEATHER_LABELS: Readonly<Record<WeatherPreset, string>> = {
  clear: 'Clear', overcast: 'Overcast', breezy: 'Breezy',
}

function formation(...positions: readonly (readonly [number, number])[]): readonly Readonly<Vec3>[] {
  return Object.freeze(positions.map(([x, z]) => Object.freeze({ x, y: 0, z })))
}

const FORMATIONS: Readonly<Record<FieldPreset, readonly Readonly<Vec3>[]>> = {
  balanced: FIELDERS,
  attack: formation([2.8, -3.8], [5.4, -3.2], [8, -2], [-4, 2], [13, 5], [-11, 11], [13, 19], [-12, 25], [21, 30]),
  powerplay: formation([5, -6], [15, 0], [20, 8], [16, 23], [8, 32], [-11, 25], [-19, 5], [-12, -32], [11, 49]),
  'pace-ring': formation([4, -5], [17, -7], [24, 7], [19, 22], [3, 34], [-14, 29], [-22, 13], [-20, -2], [-8, -24]),
  'leg-trap': formation([5, -5], [18, 4], [17, 23], [6, 29], [-7, 6], [-14, 17], [-23, 4], [-34, -9], [-11, -32]),
  boundary: formation([4, -6], [16, 5], [-16, 6], [-12, 23], [44, 13], [22, 49], [-20, 51], [-44, 16], [16, -32]),
  // Real named positions. Nine fielders, the keeper stands behind the stumps.
  standard: formation([0.9, -1.6], [5.4, -3.4], [16.5, 1.2], [15.5, 6.5], [10.5, 10.5], [6.4, 14.5], [3.1, 18.2], [-3.1, 18.2], [-11.6, 12]),
  catching: formation([0.9, -1.6], [2.4, -2.1], [5.4, -3.4], [13.5, 2.5], [14.5, 7.5], [8.5, 12], [3.1, 18.2], [-3.1, 18.2], [-10.5, 12.5]),
  attacking: formation([0.9, -1.6], [5.4, -3.4], [12.5, 2.5], [13.5, 7.5], [7.5, 13], [3.1, 18.2], [-3.1, 18.2], [-11.6, 12], [-24, 31]),
  'deep-set': formation([0.9, -1.6], [5.4, -3.4], [14.5, 7.5], [3.1, 18.2], [-3.1, 18.2], [17.5, 26], [24, 20], [-25, 32], [12, 45]),
}

/** The name of the closest named position to a spot on the field. */
export function positionName(spot: Vec3): FieldPositionName {
  let best: FieldPositionName = 'Cover'
  let least = Infinity
  for (const position of FIELD_POSITIONS) {
    const gap = Math.hypot(position.x - spot.x, position.z - spot.z)
    if (gap < least) {
      least = gap
      best = position.name
    }
  }
  return best
}

export function fieldPositions(preset: FieldPreset = 'balanced', maxOutside?: number, layout?: readonly Vec3[]) {
  const positions = layout?.length === 9 && layout.every(p => Number.isFinite(p.x) && Number.isFinite(p.z))
    ? layout : FORMATIONS[preset]
  if (maxOutside === undefined) return positions
  let outside = 0
  return positions.map((spot) => {
    const end = Math.max(0, Math.min(PITCH_LENGTH, spot.z))
    const radius = Math.hypot(spot.x, spot.z - end)
    if (radius <= 27.43 || ++outside <= maxOutside) return spot
    const scale = 26.9 / radius
    return { x: spot.x * scale, y: 0, z: end + (spot.z - end) * scale }
  })
}

const GRAVITY = 9.81
const BALL_RADIUS = 0.036
const CONTACT_Z = 0.46
const WICKET_HEIGHT = 0.711
const FIELDER_SPEED = 6.7
const KEEPER_SPEED = 4.5
const RUN_SECONDS = 3.05
const PICKUP_TICKS = 16
const CONTACT_LEAD = 4

/**
 * The batter's front pad and thigh. A ball that passes through this zone strikes
 * the person rather than the bat, which is how leg before wicket happens.
 *
 * The pad sits on the leg side of the stumps but a batter reaching across can
 * bring the outer edge past the middle stump, so the zone reaches a little to
 * the off side. Above pad height the ball passes over the thigh.
 */
const PAD_MIN_X = -0.44
const PAD_MAX_X = 0.28
const PAD_TOP = 0.70
/** How sharply the pad sends the ball away from the stumps. */
const PAD_SQUIRT = 1.6
/** How much pace the pad takes off the ball. */
const PAD_RETAIN = 0.35
/** The downward kick the pad gives the ball. */
const PAD_DROP = 2.8
/** How far the keeper can reach to either side when collecting. */
const KEEPER_REACH = 1.30
/** How likely the keeper is to fumble the ball when it beats the bat. */
const FUMBLE_RISING = 0.24
const FUMBLE_FLAT = 0.09

type BowlingRecipe = { speed: number; bounce: number; restitution: number; turn: number; swing?: number }

const BOWLING: Readonly<Record<DeliveryKind, BowlingRecipe>> = {
  fast: { speed: 29, bounce: 8.4, restitution: 0.48, turn: 0.35 },
  length: { speed: 24, bounce: 6.2, restitution: 0.46, turn: 0.65 },
  yorker: { speed: 28, bounce: 1.25, restitution: 0.32, turn: 0.12 },
  spin: { speed: 16.5, bounce: 5.1, restitution: 0.48, turn: 3.15 },
  inswing: { speed: 27, bounce: 4.4, restitution: 0.43, turn: 0.33, swing: -4.1 },
  outswing: { speed: 26.5, bounce: 5.4, restitution: 0.46, turn: 0.36, swing: 4.35 },
  bouncer: { speed: 27.8, bounce: 11.4, restitution: 0.53, turn: 0.28 },
  legspin: { speed: 15.2, bounce: 5.7, restitution: 0.54, turn: -4.25 },
}

export function bounceLength(kind: DeliveryKind) {
  return BOWLING[kind].bounce
}

export function isSpinDelivery(kind: DeliveryKind) {
  return kind === 'spin' || kind === 'legspin'
}

type Stroke = {
  speed: number; lift: number; height: number; tolerance: number
  line?: number; timingPenalty?: number; liftBoost?: number
  /** How likely this stroke is to bring the bat down on the batter's own stumps. */
  wicketRisk?: number
}

const STROKES: Readonly<Record<Shot, Stroke>> = {
  drive: { speed: 35, lift: 0.10, height: 0.42, tolerance: 0.79, wicketRisk: 0.012 },
  cut: { speed: 34, lift: 0.12, height: 1.04, tolerance: 0.65, liftBoost: 0.4, wicketRisk: 0.016 },
  pull: { speed: 36, lift: 0.24, height: 1.04, tolerance: 0.75, liftBoost: 0.4, wicketRisk: 0.02 },
  loft: { speed: 36, lift: 0.54, height: 0.62, tolerance: 0.78 },
  defend: { speed: 8, lift: -0.18, height: 0.65, tolerance: 1.35, timingPenalty: 0.045, wicketRisk: 0.004 },
  'cover-drive': { speed: 35.8, lift: 0.09, height: 0.45, tolerance: 0.7, line: 0.24 },
  'on-drive': { speed: 34.2, lift: 0.08, height: 0.34, tolerance: 0.65, line: -0.19 },
  flick: { speed: 27.8, lift: 0.2, height: 0.52, tolerance: 0.68, line: -0.29 },
  sweep: { speed: 29.4, lift: 0.07, height: 0.27, tolerance: 0.58, line: -0.20 },
  'reverse-sweep': { speed: 28.4, lift: 0.13, height: 0.36, tolerance: 0.54, line: 0.22, timingPenalty: 0.116 },
  ramp: { speed: 25, lift: 0.69, height: 0.37, tolerance: 0.59, timingPenalty: 0.115 },
  'off-drive': { speed: 34.8, lift: 0.085, height: 0.46, tolerance: 0.78 },
  'square-drive': { speed: 34.5, lift: 0.11, height: 0.46, tolerance: 0.72 },
  'backfoot-punch': { speed: 30.5, lift: 0.08, height: 0.88, tolerance: 0.8 },
  'backfoot-defense': { speed: 7.5, lift: -0.12, height: 1.05, tolerance: 1.1 },
  'late-cut': { speed: 24.5, lift: 0.12, height: 0.85, tolerance: 0.75 },
  'upper-cut': { speed: 32.8, lift: 0.58, height: 1.35, tolerance: 0.72 },
  'square-cut': { speed: 33.5, lift: 0.13, height: 1.04, tolerance: 0.7 },
  'leg-glance': { speed: 21, lift: 0.08, height: 0.5, tolerance: 0.8 },
  'paddle-sweep': { speed: 18.5, lift: 0.15, height: 0.35, tolerance: 0.73 },
  'slog-sweep': { speed: 37, lift: 0.58, height: 0.38, tolerance: 0.72 },
  'slog': { speed: 38, lift: 0.51, height: 0.65, tolerance: 0.72 },
  'inside-out': { speed: 36.8, lift: 0.47, height: 0.6, tolerance: 0.8 },
  'helicopter': { speed: 38.2, lift: 0.61, height: 0.3, tolerance: 0.74 },
  'scoop': { speed: 23.7, lift: 0.77, height: 0.45, tolerance: 0.72 },
  'reverse-scoop': { speed: 24.2, lift: 0.75, height: 0.48, tolerance: 0.68 },
  'switch-hit': { speed: 34.9, lift: 0.48, height: 0.6, tolerance: 0.72 },
  'reverse-ramp': { speed: 26, lift: 0.72, height: 0.8, tolerance: 0.7 },
  'duck': { speed: 0, lift: 0, height: 0.2, tolerance: 0.1 },
  'leave': { speed: 0, lift: 0, height: 0.65, tolerance: 0.1 },
  hook: { speed: 36.4, lift: 0.43, height: 1.42, tolerance: 0.64, line: -0.11, timingPenalty: 0.113, wicketRisk: 0.022 },
}

const PITCH: Readonly<Record<PitchPreset, { bounce: number; seam: number; spin: number; rollDrag?: number }>> = {
  dry: { bounce: 1, seam: 1, spin: 1 },
  green: { bounce: 1.04, seam: 1.34, spin: 0.93, rollDrag: 0.63 },
  hard: { bounce: 1.15, seam: 0.94, spin: 0.9, rollDrag: 0.48 },
  dusty: { bounce: 0.85, seam: 0.93, spin: 1.29, rollDrag: 0.70 },
}

const WEATHER: Readonly<Record<WeatherPreset, { swing: number; wind?: number; seam: number }>> = {
  clear: { swing: 1, seam: 1 },
  overcast: { swing: 1.32, seam: 1.14 },
  breezy: { swing: 1.08, seam: 1, wind: 0.36 },
}

type Motion = { ball: Vec3; velocity: Vec3; grounded: boolean }
type Ground = { drag: number; restitution: number; turn: number; swing?: number; wind?: number; rollDrag?: number }
type Interception = { index: number; point: Vec3; tick: number }

function clamp(value: number, low: number, high: number) {
  return Math.max(low, Math.min(high, value))
}

function seededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), state | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

function mix(a: Vec3, b: Vec3, progress: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * progress,
    y: a.y + (b.y - a.y) * progress,
    z: a.z + (b.z - a.z) * progress,
  }
}

function atZ(previous: Vec3, next: Vec3, z: number) {
  return mix(previous, next, (z - previous.z) / (next.z - previous.z))
}

function distance(a: Vec3, b: Vec3) {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

function configuredBoundary(boundary: BoundaryDimensions | undefined) {
  if (!boundary || ![boundary.x, boundary.z].every((axis) => Number.isFinite(axis) && axis >= 50 && axis <= 90)) {
    return CIRCULAR_BOUNDARY
  }
  return { ...boundary }
}

function beyondBoundary(ball: Vec3, boundary: BoundaryDimensions, margin = 0) {
  const z = ball.z - PITCH_LENGTH / 2
  if (boundary.x === boundary.z) return Math.hypot(ball.x, z) >= boundary.x - margin
  return Math.hypot(ball.x / (boundary.x - margin), z / (boundary.z - margin)) >= 1
}

function boundaryCrossing(previous: Vec3, next: Vec3, boundary: BoundaryDimensions): number {
  if (!beyondBoundary(next, boundary)) return Infinity
  // Scale an ellipse to a unit circle for the swept intersection. Preserve the
  // original arithmetic on round grounds so existing replays stay bit exact.
  const circular = boundary.x === boundary.z
  const xScale = circular ? 1 : boundary.x
  const zScale = circular ? 1 : boundary.z
  const radius = circular ? boundary.x : 1
  const x = previous.x / xScale
  const z = (previous.z - PITCH_LENGTH / 2) / zScale
  const dx = next.x / xScale - x
  const dz = (next.z - previous.z) / zScale
  const span = dx ** 2 + dz ** 2
  const projection = x * dx + z * dz
  return (-projection + Math.sqrt(projection ** 2 - span * (x ** 2 + z ** 2 - radius ** 2))) / span
}

function moveToward(player: Vec3, point: Vec3, speed: number) {
  const gap = distance(player, point)
  const progress = gap ? Math.min(1, speed * DT / gap) : 0
  player.x += (point.x - player.x) * progress
  player.z += (point.z - player.z) * progress
}

function advance(motion: Motion, ground: Ground) {
  const { ball, velocity } = motion
  const speed = Math.hypot(velocity.x, velocity.y, velocity.z)
  const rolling = velocity.y === 0 && ball.y === BALL_RADIUS
  const drag = rolling ? ground.rollDrag ?? 0.58 : ground.drag * speed
  let lateral = motion.grounded ? ground.turn : ground.swing ?? 0
  if (!rolling && ground.wind) lateral += ground.wind
  velocity.x += (lateral - velocity.x * drag) * DT
  velocity.z -= velocity.z * drag * DT
  if (ball.y > BALL_RADIUS || velocity.y !== 0) {
    velocity.y -= (GRAVITY + velocity.y * drag) * DT
  }
  const newHeight = ball.y + velocity.y * DT
  if (newHeight <= BALL_RADIUS && velocity.y < 0) {
    const hit = (ball.y - BALL_RADIUS) / (ball.y - newHeight)
    const remainder = 1 - hit
    const retention = motion.grounded ? 0.87 : 0.93
    velocity.y = Math.abs(velocity.y * ground.restitution)
    if (velocity.y < 0.58) velocity.y = 0
    ball.x += velocity.x * (hit + remainder * retention) * DT
    ball.z += velocity.z * (hit + remainder * retention) * DT
    ball.y = BALL_RADIUS + velocity.y * remainder * DT
    velocity.x *= retention
    velocity.z *= retention
    motion.grounded = true
    return hit
  }
  ball.x += velocity.x * DT
  ball.z += velocity.z * DT
  ball.y = Math.max(BALL_RADIUS, newHeight)
  return Infinity
}

const OUTFIELD = { drag: 0.0025, restitution: 0.30, turn: 0 }

/** Visual continuation of a sealed boundary. It never changes the delivery or score. */
export class BoundaryFlight implements Motion {
  readonly ball: Vec3
  readonly velocity: Vec3
  grounded: boolean
  tick = 0
  landedAt: number | null
  settled = false
  private support = 0
  private readonly ground: Ground

  constructor(motion: Motion, ground: Ground) {
    this.ball = { ...motion.ball }
    this.velocity = { ...motion.velocity }
    this.grounded = motion.grounded
    this.landedAt = motion.grounded ? 0 : null
    this.ground = { ...ground }
  }

  get presenting() { return !this.settled && (this.landedAt === null || this.tick - this.landedAt < 90) }

  step(surface: (point: Vec3) => number = () => 0) {
    if (this.settled) return
    const previous = { ...this.ball }
    this.ball.y -= this.support
    const bounce = advance(this, this.ground)
    this.ball.y += this.support
    this.tick++
    const floor = surface(this.ball)
    if (floor > previous.y + .10 && this.ball.y < floor + BALL_RADIUS) {
      // Advertising boards / risers: a low ball rebounds instead of tunnelling.
      const radius = Math.hypot(this.ball.x, this.ball.z - PITCH_LENGTH / 2)
      const nx = this.ball.x / radius, nz = (this.ball.z - PITCH_LENGTH / 2) / radius
      const outward = this.velocity.x * nx + this.velocity.z * nz
      if (outward > 0) { this.velocity.x -= 1.45 * outward * nx; this.velocity.z -= 1.45 * outward * nz }
      this.ball.x = previous.x; this.ball.z = previous.z
      this.landedAt ??= this.tick
    } else if (this.ball.y <= floor + BALL_RADIUS && this.velocity.y < 0) {
      this.ball.y = floor + BALL_RADIUS
      this.velocity.y = Math.abs(this.velocity.y) * .28
      if (this.velocity.y < .58) this.velocity.y = 0
      this.velocity.x *= .78; this.velocity.z *= .78
      this.grounded = true
      this.support = floor
      this.landedAt ??= this.tick
    } else if (bounce <= 1) this.landedAt ??= this.tick
    if (floor < this.support - .05) this.support = floor
    if (this.tick >= 900 || this.grounded && Math.hypot(this.velocity.x, this.velocity.y, this.velocity.z) < .25) {
      this.settled = true
      this.velocity.x = this.velocity.y = this.velocity.z = 0
    }
  }
}

export class Delivery implements Motion {
  readonly kind: DeliveryKind
  readonly seed: number
  readonly options: DeliveryOptions
  readonly contactTick: number
  readonly projectedContact: Vec3
  readonly fielders: Vec3[]
  readonly keeper: Vec3 = { ...KEEPER }
  readonly ball: Vec3
  readonly velocity: Vec3
  readonly manualRunning: boolean
  tick = 0
  phase: 'flight' | 'field' | 'dead' = 'flight'
  action: DeliveryAction = 'approach'
  grounded = false
  contact: Contact | null = null
  timing: Timing | null = null
  outcome: DeliveryOutcome | null = null
  activeFielder = -1
  swingTick: number | null = null
  contactEventTick: number | null = null
  batImpact: Vec3 | null = null
  runnerProgress = 0
  /** The non-striker's progress through the current run. */
  partnerProgress = 0
  completedRuns = 0
  wicketBroken = false
  landingDistance: number | null = null
  launchAzimuth: number | null = null
  /** Where the ball first landed, used to decide leg before wicket. */
  pitchPoint: Vec3 | null = null
  /** Whether the ball struck the batter without the bat. */
  padContact = false
  /** Whether the batter offered a stroke at the delivery. */
  shotOffered = false
  /** Where the ball struck the batter, when it struck the pad. */
  padImpact: Vec3 | null = null
  /** The umpire's finding on a leg before wicket appeal. */
  lbw: {
    out: boolean
    reason: string
    portion: number
    umpiresCall: boolean
    /** What the ball tracking would show the third umpire. */
    tracking: { out: boolean; pitched: string; impact: string; wickets: string }
  } | null = null
  /** Whether the batter is out of his ground and can be stumped. */
  batterOutOfGround = false
  /** Whether the keeper has parried the ball away, so the batters may run. */
  parried = false

  private readonly bowlingGround: Ground
  private readonly outfieldGround: Ground
  private readonly boundary: BoundaryDimensions
  private readonly noBall: boolean
  private readonly freeHit: boolean
  private readonly drift: number
  private readonly missDistance: number
  private fieldDestination: Vec3 | null = null
  private followBall = false
  private requestedThrow: 'striker' | 'bowler' | null = null
  private throwTick = 0
  private running = true
  private retreating = false
  private queuedRuns = 0
  private breakTick: number | null = null
  private input: ShotInput | null = null
  private chase: Interception | null = null
  private pickTick = 0
  private fieldTick = 0
  private returnStart: Vec3 | null = null
  private returnTicks = 0
  private lbwProjection: { hits: boolean; portion: number } | null = null
  private stumpTick = 0
  private runStartTick: number | null = null
  private lateSwing = false
  /** How far the non-striker has backed up from his crease, in metres. */
  private backUp = 0
  private backUpAtContact = 0
  throwTarget: 'striker' | 'bowler' = 'striker'
  private throwReleased = false
  /** Whether the throw was overhit, which costs a penalty run. */
  private overthrow = false
  private readonly fumbleRandom: () => number
  private readonly fieldRandom: () => number

  constructor(options: DeliveryOptions) {
    this.kind = options.kind
    this.seed = options.seed >>> 0
    this.options = options
    // Separate generators keep the fumble and the fielding decisions
    // independent of the delivery draw while staying reproducible from the seed.
    this.fumbleRandom = seededRandom((this.seed ^ 0x5f3a91c7) >>> 0)
    this.fieldRandom = seededRandom((this.seed ^ 0x1b873593) >>> 0)
    this.freeHit = options.freeHit ?? false
    this.manualRunning = options.runningMode === 'manual'
    this.running = !this.manualRunning
    this.fielders = fieldPositions(options.field, options.maxOutside, options.fieldLayout).map((spot) => ({ ...spot }))
    this.boundary = configuredBoundary(options.boundary)
    const random = seededRandom(this.seed)
    const recipe = BOWLING[this.kind]
    const surface = PITCH[options.pitch ?? 'dry']
    // A worn pitch bounces less, turns more and grips less for seam.
    const wear = clamp(options.pitchWear ?? 0, 0, 1)
    const pitch = {
      bounce: surface.bounce * (1 - wear * 0.24),
      seam: surface.seam * (1 - wear * 0.38),
      spin: surface.spin * (1 + wear * 0.5),
      ...(surface.rollDrag === undefined ? {} : { rollDrag: surface.rollDrag }),
    }
    const weather = WEATHER[options.weather ?? 'clear']
    const spin = isSpinDelivery(this.kind)
    const effort = clamp(options.effort ?? 0.63, 0, 1)
    const randomLine = (random() - 0.5) * 1.06
    const releaseSide = random() < 0.5 ? -1 : 1
    const releaseX = releaseSide * 0.28
    const speed = recipe.speed * (0.88 + effort * 0.19) * (0.975 + random() * 0.05)
    const releaseZ = PITCH_LENGTH - 1.83
    const releaseY = 2.06
    const length = recipe.bounce + (random() - 0.5) * 0.60
    const bounceTime = (releaseZ - length) / speed
    const flyTime = (releaseZ - CONTACT_Z) / speed
    const line = clamp(options.line ?? randomLine, -1.4, 1.4)
    const lateralError = (random() - 0.5) * (0.10 + Math.max(0, effort - 0.75) * 0.52)
    const turn = recipe.turn * releaseSide * (spin ? pitch.spin : pitch.seam * weather.seam) * (options.turn ?? 1)
    const swing = (recipe.swing ?? 0) * weather.swing * (options.swing ?? 1)
    const afterBounce = Math.max(0, flyTime - bounceTime)
    // The nominal aim partially compensates for swing. The pre-bounce curve
    // stays visible and still has a small effect on the final line.
    const swingOffset = swing * bounceTime * (flyTime - bounceTime / 2) * 0.73
    this.noBall = effort >= 0.92 && random() < (effort - 0.83) * 1.6
    this.drift = (random() - 0.5) * 0.23
    this.missDistance = spin ? 1.02 : 1.11
    this.bowlingGround = { drag: 0.001, restitution: recipe.restitution * pitch.bounce, turn, swing, wind: weather.wind, rollDrag: pitch.rollDrag }
    this.outfieldGround = weather.wind ? { ...OUTFIELD, wind: weather.wind } : OUTFIELD
    this.ball = { x: releaseX, y: releaseY, z: releaseZ }
    this.velocity = {
      x: (line + lateralError - releaseX - 0.5 * turn * afterBounce ** 2 - swingOffset) / flyTime,
      y: (BALL_RADIUS - releaseY + GRAVITY * bounceTime ** 2 / 2) / bounceTime,
      z: -speed,
    }
    if (spin) this.keeper.z = -2.2

    // Run the same fixed-step bowling model ahead for the swing cue. Physics
    // still decides contact from the real crossing and the recorded swing.
    const forecast = { ball: { ...this.ball }, velocity: { ...this.velocity }, grounded: false }
    let tick = 0
    let previous = forecast.ball
    while (forecast.ball.z > CONTACT_Z && tick < 180) {
      previous = { ...forecast.ball }
      const landing = advance(forecast, this.bowlingGround)
      if (landing <= 1 && !this.pitchPoint) {
        // Recover the point of the first landing before the retention step.
        const fraction = landing / (landing + (1 - landing) * 0.93)
        this.pitchPoint = mix(previous, forecast.ball, fraction)
      }
      tick++
    }
    this.projectedContact = atZ(previous, forecast.ball, CONTACT_Z)
    this.contactTick = tick - CONTACT_LEAD
  }

  swing(input: ShotInput): boolean {
    if (this.phase !== 'flight' || this.input || !Number.isFinite(input.aim) ||
      !Object.hasOwn(STROKES, input.kind)) return false
    // A stroke may be played while the ball is still travelling towards the
    // batter, and a late stroke may still be played after the ball has passed
    // the bat but before it reaches the stumps: the bat takes time to come down.
    if (this.contact !== null && !(this.contact === 'miss' && this.ball.z > 0)) return false
    this.input = {
      kind: input.kind,
      aim: input.aim,
      power: Number.isFinite(input.power) ? clamp(input.power ?? 0.75, 0, 1) : 0.75,
    }
    // Offering a stroke matters for leg before wicket: an impact outside off
    // stump is only eligible when the batter played no shot at all.
    this.shotOffered = input.kind !== 'leave' && input.kind !== 'duck'
    this.swingTick = this.tick
    if (this.contact !== null) this.lateSwing = true
    return true
  }

  get runnersMoving() {
    return this.phase === 'field' && (this.running || this.retreating)
  }

  get runnersReturning() {
    return this.retreating
  }

  get pendingRuns() {
    return this.queuedRuns + Number(this.running)
  }

  /** How far the swing was from the perfect contact, in milliseconds. */
  get timingErrorMs(): number | null {
    if (this.swingTick === null) return null
    return Math.round(Math.abs(this.swingTick - this.contactTick) * DT * 1000)
  }

  /**
   * Grounded foot positions of the pair, measured along the pitch.
   *
   * The two batters run at their own pace, so one can be further down the pitch
   * than the other. The direction reverses with each completed run, and the
   * non-striker is short of his crease while he is backed up.
   */
  get runnerPositions(): readonly [number, number] {
    const travel = PITCH_LENGTH - 2.44
    const forward = this.completedRuns % 2 === 0
    const striker = forward
      ? 1.22 + this.runnerProgress * travel
      : PITCH_LENGTH - 1.22 - this.runnerProgress * travel
    // The non-striker is short of his crease only while he is backed up at the
    // bowler's end. Once he has run, he is grounded at the other end.
    const backing = forward && this.partnerProgress <= 1e-6 ? this.backUp : 0
    const partner = forward
      ? PITCH_LENGTH - 1.22 - this.partnerProgress * travel - backing
      : 1.22 + this.partnerProgress * travel + backing
    return [striker, partner]
  }

  /** How far the non-striker has backed up from his crease, in metres. */
  get backedUp() {
    return this.backUp
  }

  /** How far the non-striker was backed up when the ball was released. */
  get backedUpAtContact() {
    return this.backUpAtContact
  }

  setRunning(running: boolean) {
    // A batter backing up against a spinner may set off before the ball is
    // bowled, which is how a dismissal is stumped.
    if (this.phase !== 'field' && !(this.manualRunning && this.phase === 'flight')) return false
    if (this.manualRunning) {
      if (running && this.running) this.queuedRuns = Math.min(5, this.queuedRuns + 1)
      if (!running) this.queuedRuns = 0
      this.retreating = !running && (this.runnerProgress > 0 || this.partnerProgress > 0)
      if (running && this.runStartTick === null) this.runStartTick = this.tick
    }
    this.running = running
    return true
  }

  get manualFielding() { return this.options.fieldingMode === 'manual' }

  fieldControl(command: FieldingCommand): boolean {
    if (!this.manualFielding || this.phase !== 'field') return false
    if (command.type === 'throw') {
      if ((command.end !== 'striker' && command.end !== 'bowler') || (this.action !== 'pickup' && this.action !== 'hold')) return false
      this.requestedThrow = command.end
      return true
    }
    if (this.action !== 'chase') return false
    if (command.type === 'select') {
      if (!Number.isInteger(command.index) || command.index < 0 || command.index > this.fielders.length) return false
      this.activeFielder = command.index
      this.fieldDestination = null
      this.followBall = false
      return true
    }
    if (command.type === 'chase') {
      this.followBall = true
      return true
    }
    if (!Number.isFinite(command.x) || !Number.isFinite(command.z)) return false
    const destination = { x: command.x, y: 0, z: command.z }
    if (beyondBoundary(destination, this.boundary, .6)) return false
    this.fieldDestination = destination
    this.followBall = false
    return true
  }

  boundaryFlight() {
    return this.outcome?.reason === 'boundary' ? new BoundaryFlight(this, this.outfieldGround) : null
  }

  step() {
    if (this.phase === 'dead') return
    this.tick++
    if (this.phase === 'flight') this.stepApproach()
    else if (this.action === 'chase') this.stepChase()
    else if (this.action === 'pickup' || this.action === 'hold') this.stepPickup()
    else if (this.action === 'return') this.stepReturn()
    else if (this.action === 'break') this.stepBreak()
    else if (this.action === 'stump') this.stepStump()
  }

  private stepApproach() {
    const previous = { ...this.ball }
    advance(this, this.bowlingGround)
    // The non-striker backs up against a spinner, which leaves him short of his
    // crease and open to a run out at the bowler's end.
    const backingLimit = isSpinDelivery(this.kind) ? 0.5 : 0.18
    if (this.contactEventTick === null) this.backUp = Math.min(backingLimit, this.backUp + DT * backingLimit * 2)
    // A batter who has set off backing up keeps moving while the ball is in flight.
    if (this.manualRunning) this.advanceRunners()
    if (this.ball.z < 4) {
      moveToward(this.keeper, { x: this.projectedContact.x, y: 0, z: this.keeper.z }, KEEPER_SPEED)
    }
    if (previous.z > CONTACT_Z && this.ball.z <= CONTACT_Z) {
      this.contactEventTick = this.tick
      this.backUpAtContact = this.backUp
      const impact = atZ(previous, this.ball, CONTACT_Z)
      if (this.resolveBat(impact)) return
      this.resolvePad(impact)
    }
    if (previous.z > 0 && this.ball.z <= 0) {
      const impact = atZ(previous, this.ball, 0)
      if (this.lateSwing) {
        // The stroke was played late but the ball had not yet reached the
        // stumps. It is struck where the ball actually is.
        this.lateSwing = false
        if (this.resolveBat({ ...impact })) return
      }
      if (Math.abs(impact.x) <= 0.116 + BALL_RADIUS && impact.y <= WICKET_HEIGHT + BALL_RADIUS) {
        Object.assign(this.ball, impact)
        this.finish('bowled', 0, 'bowled')
        return
      }
      // The ball missed the stumps. If it struck the person, the umpire decides
      // whether it would have gone on to hit the wicket.
      if (this.padContact && this.lbwProjection) {
        this.resolveLbw()
        if (this.lbw?.out) {
          Object.assign(this.ball, impact)
          this.finish('lbw', 0, 'lbw')
          return
        }
      }
    }
    if (previous.z > this.keeper.z + 0.34 && this.ball.z <= this.keeper.z + 0.34) {
      const caught = atZ(previous, this.ball, this.keeper.z + 0.34)
      if (Math.abs(caught.x) <= KEEPER_REACH) {
        Object.assign(this.ball, caught)
        if (this.manualRunning) {
          // A run attempt is a run-out, not a stumping. Keep the ball live until
          // the keeper reaches the wicket; returning to the crease can save it.
          this.phase = 'field'
          this.action = 'break'
          this.fieldTick = this.tick
          this.activeFielder = this.fielders.length
          return
        }
        if (this.batterOutOfGround) {
          // The batter has left his ground and the keeper is behind the stumps.
          this.phase = 'field'
          this.action = 'stump'
          this.stumpTick = this.tick
          return
        }
        if (this.contact === 'miss' && this.fumbles()) {
          // The keeper has fumbled a ball that beat the bat. The ball is played
          // away towards the leg side and the batters are safe, because the
          // keeper never had the ball under control.
          this.velocity.z *= 0.1
          this.velocity.y = 0
          this.velocity.x = -5
          this.parried = true
          if (!this.manualRunning) this.completedRuns = 1
          this.runnerProgress = 0
          this.phase = 'field'
          this.action = 'chase'
          this.fieldTick = this.tick
          this.chase = this.pickInterception()
          this.activeFielder = this.chase?.index ?? -1
          return
        }
        this.finish('collected', 0, null)
        return
      }
      // The keeper cannot reach it at all. The ball runs away to the outfield
      // and the batters are sent after it.
      Object.assign(this.ball, caught)
      this.velocity.z *= 0.1
      this.velocity.y = 0
      this.velocity.x = -5
      this.parried = true
      this.phase = 'field'
      this.action = 'chase'
      this.fieldTick = this.tick
      this.chase = this.pickInterception()
      this.activeFielder = this.chase?.index ?? -1
    }
  }

  /**
   * Whether the keeper fumbles the ball. A rising ball is much harder to hold
   * than a flat one, and a quicker delivery gives less time to settle the hands.
   */
  private fumbles() {
    const rising = this.velocity.y > 0.2
    const quick = Math.abs(this.velocity.z) > 26
    const chance = (rising ? FUMBLE_RISING : FUMBLE_FLAT) * (quick ? 1.3 : 1)
    return this.fumbleRandom() < chance
  }

  /**
   * The ball reached the batter without the bat. If it passed through the pad
   * the ball is deflected and the umpire is asked whether it was heading for the
   * stumps, which is what leg before wicket turns on.
   */
  private resolvePad(impact: Vec3) {
    this.contact = 'miss'
    if (impact.y > PAD_TOP || impact.x < PAD_MIN_X || impact.x > PAD_MAX_X) return
    this.padContact = true
    this.padImpact = { ...impact }
    // The path the ball would have taken without the pad in the way.
    this.lbwProjection = projectToStumps(impact, { x: this.velocity.x, y: this.velocity.y, z: this.velocity.z })
    // The pad turns the ball away from the stumps and kills most of its pace.
    const away = Math.abs(impact.x) < 0.03 ? 0 : Math.sign(impact.x) * PAD_SQUIRT
    this.velocity.x = this.velocity.x * 0.25 + away
    this.velocity.z *= PAD_RETAIN
    this.velocity.y = -PAD_DROP
  }

  /**
   * Whether the bat comes down on the batter's own wicket. A defensive stroke
   * played at a straight ball is the classic way to do it.
   */
  private clipsOwnWicket(distanceFromIdeal: number, impact: Vec3) {
    if (this.noBall || this.freeHit || !this.input) return false
    if (Math.abs(impact.x) > 0.45) return false
    const risk = STROKES[this.input.kind].wicketRisk
    if (!risk) return false
    const chance = risk * (this.input.power ?? 0.75) * (1 + Math.min(distanceFromIdeal, 9) / 12)
    return this.fieldRandom() < chance
  }

  /** The umpire's decision on a leg before wicket appeal. */
  private resolveLbw() {
    const projection = this.lbwProjection
    const impact = this.padImpact
    if (!projection || !impact) return
    const pitchX = this.pitchPoint?.x ?? null
    const facts = {
      pitchX,
      impactX: impact.x,
      batFirst: false,
      strokeOffered: this.shotOffered,
      wouldHitStumps: projection.hits,
      portion: projection.portion,
    }
    // Ball tracking sees the exact impact. The on-field umpire judges it by eye
    // and can be a few centimetres out, which is what a review exists to fix.
    const tracking = judgeLbw(facts)
    const perceived = judgeLbw({ ...facts, impactX: impact.x + (this.fieldRandom() - 0.5) * 0.09 })
    this.lbw = {
      out: perceived.out,
      reason: perceived.reason,
      portion: projection.portion,
      umpiresCall: perceived.umpiresCall,
      tracking: {
        out: tracking.out,
        pitched: pitchX === null ? 'no landing'
          : pitchX < LEG_STUMP ? 'outside leg stump'
            : pitchX > OFF_STUMP ? 'outside off stump' : 'in line',
        impact: facts.impactX < LEG_STUMP ? 'outside leg stump'
          : facts.impactX > OFF_STUMP ? 'outside off stump' : 'in line',
        wickets: projection.hits
          ? (projection.portion >= 0.5 ? 'hitting the stumps' : 'clips the stumps')
          : 'missing the stumps',
      },
    }
  }

  private resolveBat(impact: Vec3) {
    if (!this.input || this.swingTick === null) return false
    if (this.input.kind === 'leave' || this.input.kind === 'duck') return false
    const error = this.swingTick - this.contactTick
    const distanceFromIdeal = Math.abs(error)
    // The contact window can be widened or tightened by the player.
    const window = Math.max(0.4, this.options.timingWindow ?? 1)
    this.timing = distanceFromIdeal <= window ? 'perfect'
      : distanceFromIdeal <= window * 3 ? 'good' : error < 0 ? 'early' : 'late'
    const stroke = STROKES[this.input.kind]
    const heightError = Math.abs(impact.y - stroke.height) / stroke.tolerance
    const lineError = Math.abs(impact.x - (stroke.line ?? 0)) / 0.96
    const batOverlap = Math.hypot(lineError * 0.82, heightError * 0.70)
      + (distanceFromIdeal / window) * (stroke.timingPenalty ?? 0.099)
    if (distanceFromIdeal > 9 * window || impact.y > 1.75 || Math.abs(impact.x) > 0.99 || batOverlap > 1.14) {
      // The bat missed the ball. Coming down hard near the stumps it may still
      // clip them, which is a dismissal of its own.
      if (this.clipsOwnWicket(distanceFromIdeal, impact)) {
        this.contact = 'miss'
        this.finish('hit-wicket', 0, 'hit-wicket')
        return true
      }
      return false
    }

    this.contact = batOverlap <= 0.69 ? 'middle' : 'edge'
    this.batImpact = { ...impact }
    const { aim, power = 0.75 } = this.input
    const edge = this.contact === 'edge'
    const horizontal = edge
      ? (impact.x > 0 ? 1 : -1) * (2.32 + this.drift) + Math.sin(aim) * 0.28
      : aim + this.drift * distanceFromIdeal / 6
    const lift = edge ? 0.43 + this.drift * 0.3 : stroke.lift
    const incomingPace = Math.abs(this.velocity.z)
    const speed = edge
      ? 9.5 + incomingPace * 0.23 + power * 2.5
      : (stroke.speed + (incomingPace - 24) * 0.16) * (0.82 + power * 0.21 - distanceFromIdeal * 0.023)
    const forward = Math.cos(lift) * speed
    Object.assign(this.ball, impact)
    this.velocity.x = Math.sin(horizontal) * forward
    this.velocity.z = Math.cos(horizontal) * forward
    this.velocity.y = Math.sin(lift) * speed + (edge ? 0 : stroke.liftBoost ?? 0)
    this.launchAzimuth = Math.atan2(this.velocity.x, this.velocity.z)
    const forecast: Motion = { ball: { ...impact }, velocity: { ...this.velocity }, grounded: false }
    for (let tick = 0; tick < 900; tick++) {
      const previous = { ...forecast.ball }
      const hit = advance(forecast, this.outfieldGround)
      if (hit <= 1) {
        // advance() retains 93% of horizontal speed after this first bounce.
        // Recover the crossing point before the remainder of that same step.
        const fraction = hit / (hit + (1 - hit) * 0.93)
        const landing = mix(previous, forecast.ball, fraction)
        this.landingDistance = Math.hypot(landing.x - impact.x, landing.z - impact.z)
        break
      }
    }
    this.phase = 'field'
    this.action = 'chase'
    this.grounded = false
    this.fieldTick = this.tick
    this.chase = this.pickInterception()
    this.activeFielder = this.chase?.index ?? -1
    return true
  }

  private pickInterception(): Interception | null {
    const forecast = { ball: { ...this.ball }, velocity: { ...this.velocity }, grounded: this.grounded }
    let best: Interception | null = null
    let leastGap = Infinity
    const defenders = [...this.fielders, this.keeper]
    for (let tick = 1; tick <= 360; tick++) {
      advance(forecast, this.outfieldGround)
      const point = forecast.ball
      if (beyondBoundary(point, this.boundary, 0.6)) break
      if (point.y > 2.25 || tick % 3 !== 0) continue
      for (const [index, fielder] of defenders.entries()) {
        const keeper = index === this.fielders.length
        if (keeper && point.z > -0.3) continue
        const speed = keeper ? KEEPER_SPEED : FIELDER_SPEED
        const reaction = this.tick === this.fieldTick ? (keeper ? 0.10 : 0.16) : 0
        const reachable = Math.max(0, tick * DT - reaction) * speed + (forecast.grounded ? 0.72 : 0.56)
        const gap = distance(fielder, point) - reachable
        if (gap <= 0) return { index, point: { ...point }, tick: this.tick + tick }
        if (gap < leastGap) {
          best = { index, point: { ...point }, tick: this.tick + tick }
          leastGap = gap
        }
      }
    }
    return best
  }

  private stepChase() {
    const previous = { ...this.ball }
    const groundedBefore = this.grounded
    const bounceAt = advance(this, this.outfieldGround)
    const boundaryAt = boundaryCrossing(previous, this.ball, this.boundary)
    let chase = this.chase
    if (this.manualFielding) {
      if (this.followBall && this.chase && this.tick > this.chase.tick + 8) this.chase = this.pickInterception()
      const destination = this.followBall ? this.chase?.point ?? this.ball : this.fieldDestination
      chase = { index: this.activeFielder, point: destination ?? this.fielders[this.activeFielder] ?? this.keeper, tick: this.tick }
    }
    if (chase) {
      const keeper = chase.index === this.fielders.length
      const fielder = keeper ? this.keeper : this.fielders[chase.index]
      const speed = keeper ? KEEPER_SPEED : FIELDER_SPEED
      if (fielder && this.tick - this.fieldTick > (keeper ? 6 : 10)) {
        moveToward(fielder, chase.point, speed)
        // Sweep the ball segment against the fielder's reach, since a hard
        // shot may travel farther than a glove radius in a single tick.
        const dx = this.ball.x - previous.x
        const dz = this.ball.z - previous.z
        const span = dx ** 2 + dz ** 2
        const along = span ? clamp(((fielder.x - previous.x) * dx + (fielder.z - previous.z) * dz) / span, 0, 1) : 0
        const closest = mix(previous, this.ball, along)
        if (along < boundaryAt && !beyondBoundary(fielder, this.boundary, 0.35) &&
          distance(fielder, closest) <= 0.78 && closest.y <= 2.25) {
          Object.assign(this.ball, closest)
          if (!groundedBefore && along < bounceAt && !this.noBall && !this.freeHit) {
            this.finish('caught', 0, 'caught')
            return
          }
          this.pickTick = this.tick
          this.action = 'pickup'
        }
      }
    }
    if (this.action === 'chase' && boundaryAt <= 1) {
      Object.assign(this.ball, mix(previous, this.ball, boundaryAt))
      this.finish('boundary', groundedBefore || bounceAt <= boundaryAt ? 4 : 6, null)
      return
    }
    if (!this.manualFielding && this.action === 'chase' && chase && this.tick > chase.tick + 8) {
      this.chase = this.pickInterception()
      this.activeFielder = this.chase?.index ?? -1
    }
    this.advanceRunners()
    if (this.tick - this.fieldTick > 600) this.finish('fielded', this.completedRuns, null)
  }

  private stepPickup() {
    this.advanceRunners()
    if (this.tick - this.pickTick < PICKUP_TICKS) return
    if (this.manualFielding && !this.requestedThrow) {
      this.action = 'hold'
      // A held ball remains live while the batters run. Return to the keeper
      // after eight seconds if no throw was called, so the match can continue.
      if (this.tick - this.pickTick < 480) return
      this.requestedThrow = 'striker'
    }
    this.returnStart = { ...this.ball, y: 1.18 }
    this.throwTarget = this.requestedThrow ?? (this.backUp > 0.3 && this.fieldRandom() < 0.06 ? 'bowler' : 'striker')
    const target = this.throwTarget === 'bowler' ? { x: 0, y: 0, z: PITCH_LENGTH } : KEEPER
    this.returnTicks = Math.max(15, Math.ceil(distance(this.returnStart, target) / (24 * DT)))
    this.throwTick = this.tick
    this.action = 'return'
  }

  private stepReturn() {
    this.advanceRunners()
    const elapsed = this.tick - this.throwTick
    const start = this.returnStart
    if (!start) return
    if (!this.throwReleased) {
      this.throwReleased = true
      // An overthrow is an attempt to direct the ball at the stumps that goes
      // wrong. The batting side is awarded one penalty run for it.
      if (this.fieldRandom() < 0.07) this.overthrow = true
    }
    const bowlerEnd = this.throwTarget === 'bowler'
    const end = bowlerEnd
      ? { x: 0, y: 0.85, z: PITCH_LENGTH - 0.15 }
      : { x: this.keeper.x, y: 0.85, z: this.keeper.z + 0.36 }
    const progress = Math.min(1, elapsed / this.returnTicks)
    const ball = mix(start, end, progress)
    ball.y += Math.sin(progress * Math.PI) * Math.min(2.3, this.returnTicks * 0.024)
    Object.assign(this.ball, ball)
    if (progress < 1) return
    if (bowlerEnd) {
      // The throw has gone to the bowler's end. The non-striker is out if he
      // has not grounded behind his crease.
      this.wicketBroken = true
      if (this.manualFielding) Object.assign(this.ball, { x: 0, y: WICKET_HEIGHT, z: PITCH_LENGTH })
      const out = this.runnerPositions.every(z => z < PITCH_LENGTH - 1.22 - 1e-9)
      this.finish(out ? 'run-out' : 'fielded', this.completedRuns, out ? 'run-out' : null)
      if (out && this.outcome) {
        const crossed = Math.min(this.runnerProgress, this.partnerProgress) >= .5
        const originalStrikerAtBowler = (this.completedRuns % 2 !== 0) !== crossed
        this.outcome = { ...this.outcome, dismissedBatter: originalStrikerAtBowler ? 'striker' : 'nonStriker', crossed }
      }
      return
    }
    if (this.manualRunning || this.manualFielding) this.action = 'break'
    else this.finish('fielded', this.completedRuns, null)
  }

  private stepBreak() {
    this.advanceRunners()
    // The keeper must carry the returned ball to the wicket before removing
    // a bail. Reaching the crease on this tick takes precedence over dismissal.
    moveToward(this.keeper, { x: 0, y: 0, z: -0.4 }, KEEPER_SPEED)
    if (Math.hypot(this.keeper.x, this.keeper.z + 0.4) < 0.001) this.breakTick ??= this.tick
    const progress = this.breakTick === null ? 0 : Math.min(1, (this.tick - this.breakTick) / 12)
    Object.assign(this.ball, { x: this.keeper.x, y: 0.85 + (WICKET_HEIGHT - 0.85) * progress,
      z: this.keeper.z + 0.36 + 0.04 * progress })
    if (progress < 1) return
    this.wicketBroken = true
    const out = this.runnerPositions.every((z) => z > 1.22 + 1e-9)
    this.finish(out ? 'run-out' : 'fielded', this.completedRuns, out ? 'run-out' : null)
    if (out && this.outcome) {
      const crossed = Math.min(this.runnerProgress, this.partnerProgress) >= 0.5
      const originalStrikerAtKeeper = (this.completedRuns % 2 === 0) !== crossed
      this.outcome = { ...this.outcome, dismissedBatter: originalStrikerAtKeeper ? 'striker' : 'nonStriker', crossed }
    }
  }

  /**
   * The keeper gathers the ball and breaks the wicket without touching it. The
   * batter is out stumped only if he is still out of his ground when the bails
   * come off.
   */
  private stepStump() {
    this.advanceRunners()
    moveToward(this.keeper, { x: 0, y: 0, z: -0.4 }, KEEPER_SPEED)
    const progress = Math.min(1, (this.tick - this.stumpTick) / 16)
    Object.assign(this.ball, {
      x: this.keeper.x, y: 0.85 + (WICKET_HEIGHT - 0.85) * progress, z: this.keeper.z + 0.36 + 0.04 * progress,
    })
    if (progress < 1) return
    if (this.batterOutOfGround) {
      this.wicketBroken = true
      this.finish('stumped', 0, 'stumped')
      return
    }
    this.finish('collected', 0, null)
  }

  private advanceRunners() {
    // The striker is out of his ground once he has left the popping crease.
    this.batterOutOfGround = this.runnerPositions[0] > 1.22 + 1e-9 && this.runnerPositions[0] < PITCH_LENGTH - 1.22 - 1e-9
    // A batter who sets off abandons his backing up and returns to his crease.
    if (this.runnerProgress > 1e-6) this.backUp = 0
    const pace = this.options.runnerPace ?? [1, 1]
    if (this.manualRunning) {
      const start = this.runStartTick ?? this.fieldTick
      if ((!this.running && !this.retreating) || this.tick - start < 18) return
      const step = (this.retreating ? -1 : 1) * DT / RUN_SECONDS
      this.runnerProgress = clamp(this.runnerProgress + step * pace[0], 0, 1)
      this.partnerProgress = clamp(this.partnerProgress + step * pace[1], 0, 1)
      // A run is only scored when both batters reach the far crease.
      if (this.runnerProgress >= 1 - 1e-9 && this.partnerProgress >= 1 - 1e-9) {
        this.completedRuns++
        this.runnerProgress = 0
        this.partnerProgress = 0
        this.running = this.queuedRuns > 0
        this.queuedRuns = Math.max(0, this.queuedRuns - 1)
      } else if (this.runnerProgress <= 0 || this.partnerProgress <= 0) {
        this.runnerProgress = Math.max(0, this.runnerProgress)
        this.partnerProgress = Math.max(0, this.partnerProgress)
        if (this.runnerProgress <= 0) this.retreating = false
      }
      return
    }
    // Assisted running only starts once the shot hits the turf, or straight
    // away when the keeper has parried the ball away. Runs are earned when the
    // pair completes a full pitch traversal before collection.
    const mayStart = this.grounded || this.action !== 'chase' || this.parried
    if (!this.running || !mayStart || this.tick - this.fieldTick < 18) return
    this.runnerProgress = clamp(this.runnerProgress + (DT / RUN_SECONDS) * pace[0], 0, 1)
    this.partnerProgress = clamp(this.partnerProgress + (DT / RUN_SECONDS) * pace[1], 0, 1)
    if (this.runnerProgress >= 1 && this.partnerProgress >= 1) {
      this.completedRuns++
      this.runnerProgress = 0
      this.partnerProgress = 0
    }
  }

  private finish(reason: DeadBallReason, batRuns: number, wicket: Wicket | null) {
    const contact = this.contact ?? 'miss'
    const wide = !this.noBall && contact === 'miss' && !this.padContact && Math.abs(this.projectedContact.x) > this.missDistance
    // Runs off a ball that never reached the bat are byes, or leg byes when the
    // ball struck the person and a stroke was offered. A boundary the bat never
    // touched is credited the same way.
    const boundaryRuns = reason === 'boundary' ? batRuns : 0
    const extras = contact === 'miss' && !wide && !this.noBall
      ? judgeExtras({
        padContact: this.padContact,
        strokeOffered: this.shotOffered,
        avoiding: this.shotOffered,
        runsCompleted: this.completedRuns + boundaryRuns,
      })
      : { byes: 0, legByes: 0 }
    const scored = contact === 'miss' ? 0 : batRuns
    this.outcome = {
      batRuns: scored, wide: Number(wide), noBall: Number(this.noBall),
      byes: extras.byes, legByes: extras.legByes,
      wicket: (this.noBall || this.freeHit || wide) && wicket !== 'run-out' ? null : wicket,
      completedRuns: reason === 'fielded' || reason === 'run-out' ? this.completedRuns : 0,
      reason, contact,
      padContact: this.padContact,
      shotOffered: this.shotOffered,
      // An overthrow adds one penalty run on top of the runs already scored.
      ...(this.overthrow && reason === 'fielded' ? { overthrowRuns: 1 } : {}),
      ...(this.options.bowler ? { bowler: this.options.bowler } : {}),
    }
    this.contact = contact
    this.phase = 'dead'
    this.action = 'complete'
  }
}
