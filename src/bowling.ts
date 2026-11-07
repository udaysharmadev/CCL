import type { DeliveryKind, Vec3 } from './cricket.ts'
import type { PlayerProfile } from './player-profile.ts'
import { compatibleActions } from './player-profile.ts'
import type { Innings } from './rules.ts'

export type BowlingVariation = 'stock' | 'inswing' | 'outswing' | 'reverse-swing' | 'yorker' | 'toe-yorker' | 'bouncer' | 'short-ball' | 'slower-ball' | 'off-cutter' | 'leg-cutter' | 'cross-seam' | 'off-break' | 'leg-break' | 'googly' | 'doosra' | 'top-spinner' | 'arm-ball' | 'slider' | 'flipper'
export type BowlingSide = 'over' | 'around'
export type BattingHand = 'right' | 'left'
export type BowlingControls = {
  variation: BowlingVariation
  /** Batter-relative metres: positive is off side, negative is leg side. */
  line: number
  /** Metres from the striker's stumps at the intended first bounce. */
  length: number
  power: number
  /** Timing quality: 1 is centered; 0 is a missed execution window. */
  release: number
  /** Seam presentation for pace; revolutions/flight for spin. */
  movement: number
  side: BowlingSide
  batterHand: BattingHand
  workload?: number
}
export type VariationDescriptor = { id: BowlingVariation; label: string; family: 'pace' | 'spin'; defaultLength: number; description: string; locked: boolean; reason: string }
type BowlingRatings = PlayerProfile['bowling']
/** Immutable, versioned delivery input. Replays never re-read an edited player. */
export type BowlingExecution = Readonly<BowlingControls & {
  version: 1
  playerId: string
  arm: 'right' | 'left'
  type: BowlingRatings['type']
  action: string
  attributes: Readonly<BowlingRatings>
  workload: number
}>

type VariationRecipe = { label: string; family: 'pace' | 'spin'; length: number; speed: number; turn: number; swing: number; bounce: number; description: string }
const PACE = 'pace', SPIN = 'spin'
export const BOWLING_VARIATIONS: Readonly<Record<BowlingVariation, VariationRecipe>> = {
  stock: { label: 'Stock ball', family: PACE, length: 6.2, speed: 1, turn: .16, swing: 0, bounce: .47, description: 'Upright seam, stock pace and bounce.' },
  inswing: { label: 'Inswinger', family: PACE, length: 4.7, speed: .97, turn: .08, swing: -1, bounce: .45, description: 'Curves into the batter in the air.' },
  outswing: { label: 'Outswinger', family: PACE, length: 5.6, speed: .96, turn: .08, swing: 1, bounce: .47, description: 'Curves away from the batter in the air.' },
  'reverse-swing': { label: 'Reverse swing', family: PACE, length: 3.7, speed: 1, turn: .08, swing: -1.22, bounce: .43, description: 'Later, sharper inward movement at high pace.' },
  yorker: { label: 'Yorker', family: PACE, length: 1.3, speed: .99, turn: .05, swing: 0, bounce: .32, description: 'Targets the base of the stumps.' },
  'toe-yorker': { label: 'Toe yorker', family: PACE, length: .85, speed: 1, turn: .02, swing: -.2, bounce: .29, description: 'Very full, demanding precise execution.' },
  bouncer: { label: 'Bouncer', family: PACE, length: 11.4, speed: .99, turn: .08, swing: 0, bounce: .56, description: 'Steep bounce from a short length.' },
  'short-ball': { label: 'Short ball', family: PACE, length: 9.2, speed: .97, turn: .15, swing: 0, bounce: .50, description: 'Pushes the batter onto the back foot.' },
  'slower-ball': { label: 'Slower ball', family: PACE, length: 5.4, speed: .73, turn: .08, swing: .15, bounce: .43, description: 'Disguises a substantial reduction in pace.' },
  'off-cutter': { label: 'Off cutter', family: PACE, length: 5.5, speed: .85, turn: -.85, swing: -.1, bounce: .43, description: 'Finger-cut seam grips toward the bowling arm side.' },
  'leg-cutter': { label: 'Leg cutter', family: PACE, length: 5.9, speed: .84, turn: .9, swing: .1, bounce: .46, description: 'Opposite seam rotation changes direction off the pitch.' },
  'cross-seam': { label: 'Cross seam', family: PACE, length: 6.4, speed: .96, turn: .28, swing: 0, bounce: .53, description: 'Reduced swing with steeper seam bounce.' },
  'off-break': { label: 'Off break', family: SPIN, length: 5.1, speed: 1, turn: -1, swing: .45, bounce: .48, description: 'Finger spin turns into a right-hander from a right arm.' },
  'leg-break': { label: 'Leg break', family: SPIN, length: 5.7, speed: .95, turn: 1.2, swing: -.5, bounce: .53, description: 'Wrist spin turns away from a right-hander from a right arm.' },
  googly: { label: 'Googly', family: SPIN, length: 5.2, speed: .94, turn: -1.05, swing: .28, bounce: .51, description: 'Wrist-spin variation that turns opposite to the leg break.' },
  doosra: { label: 'Doosra', family: SPIN, length: 5.4, speed: .96, turn: 1.05, swing: -.3, bounce: .50, description: 'Finger-spin variation that turns opposite to the off break.' },
  'top-spinner': { label: 'Top spinner', family: SPIN, length: 5.7, speed: .98, turn: .03, swing: 0, bounce: .65, description: 'Overspin produces dip and extra bounce, little lateral turn.' },
  'arm-ball': { label: 'Arm ball', family: SPIN, length: 4.8, speed: 1.14, turn: .02, swing: -.48, bounce: .40, description: 'Quicker seam-up ball follows the arm with little turn.' },
  slider: { label: 'Slider', family: SPIN, length: 5.2, speed: 1.12, turn: .12, swing: .06, bounce: .34, description: 'Backspin skids through lower and quicker.' },
  flipper: { label: 'Flipper', family: SPIN, length: 5.4, speed: 1.16, turn: .03, swing: 0, bounce: .29, description: 'Squeezed wrist-spin variation stays low after pitching.' },
}

export function isSpinBowler(profile: Pick<PlayerProfile, 'bowling'>) {
  return !['fast', 'medium-fast', 'medium'].includes(profile.bowling.type)
}

export function availableVariations(profile: Pick<PlayerProfile, 'bowling'>): VariationDescriptor[] {
  const b = profile.bowling
  if (b.capability === 'none' || b.skill < 20) return []
  const wrist = b.type === 'leg-spin' || b.type === 'left-arm-wrist-spin'
  const ids: BowlingVariation[] = isSpinBowler(profile)
    ? wrist ? ['leg-break', 'googly', 'top-spinner', 'slider', 'flipper']
      : b.type === 'left-arm-orthodox' ? ['off-break', 'arm-ball', 'top-spinner', 'slider']
        : ['off-break', 'doosra', 'top-spinner', 'arm-ball']
    : ['stock', 'inswing', 'outswing', 'yorker', 'bouncer', 'short-ball', 'slower-ball', 'off-cutter', 'leg-cutter', 'cross-seam', 'toe-yorker', 'reverse-swing']
  return ids.map(id => {
    let reason = ''
    if (id === 'reverse-swing' && (b.reverseSwing < 55 || b.maxPace < 125)) reason = 'Requires reverse swing 55 and maximum pace 125 km/h.'
    if (id === 'toe-yorker' && b.yorker < 60) reason = 'Requires yorker accuracy 60.'
    if (id === 'doosra' && b.variationMastery < 75) reason = 'Requires variation mastery 75.'
    if (id === 'flipper' && b.variationMastery < 65) reason = 'Requires variation mastery 65.'
    if (id === 'googly' && b.variationMastery < 45) reason = 'Requires variation mastery 45.'
    if ((id === 'inswing' || id === 'outswing') && b.swing < 25) reason = 'Requires swing 25.'
    const recipe = BOWLING_VARIATIONS[id]
    return { id, label: id === 'off-break' && b.type === 'left-arm-orthodox' ? 'Orthodox turn' : recipe.label, family: recipe.family, defaultLength: recipe.length, description: recipe.description, locked: Boolean(reason), reason }
  })
}

const within = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max

export function createBowlingExecution(profile: PlayerProfile, controls: BowlingControls): BowlingExecution {
  const b = profile.bowling
  if (!b || !['right', 'left'].includes(b.arm) || !['none', 'occasional', 'regular', 'specialist'].includes(b.capability) ||
      !['fast', 'medium-fast', 'medium', 'off-spin', 'leg-spin', 'left-arm-orthodox', 'left-arm-wrist-spin'].includes(b.type) ||
      typeof b.action !== 'string' || !within(b.maxPace, 60, 165) ||
      ['skill', 'paceControl', 'accuracy', 'control', 'swing', 'reverseSwing', 'seam', 'yorker', 'bouncer', 'slowerBall', 'spin', 'flight', 'drift', 'turn', 'variationMastery', 'stamina', 'consistency'].some(key => !within(b[key as keyof BowlingRatings], 0, 100))) throw new Error('Invalid bowling attributes.')
  if (!compatibleActions(b.type).includes(b.action) || (b.type.startsWith('left-arm') && b.arm !== 'left') ||
      ((b.type === 'off-spin' || b.type === 'leg-spin') && b.arm !== 'right')) throw new Error('Bowling arm and action must match the bowling type.')
  const minimumPace = isSpinBowler(profile) ? 60 : 100
  const maximumPace = isSpinBowler(profile) ? 115 : b.type === 'medium' ? 135 : b.type === 'medium-fast' ? 148 : 165
  if (!within(b.maxPace, minimumPace, maximumPace)) throw new Error('Maximum pace is incompatible with the bowling type.')
  const variation = availableVariations(profile).find(item => item.id === controls.variation)
  if (!variation || variation.locked) throw new Error(variation?.reason || 'This delivery is incompatible with the bowler.')
  if (!within(controls.line, -1.4, 1.4) || !within(controls.length, .6, 12.5) ||
      !within(controls.power, 0, 1) || !within(controls.release, 0, 1) || !within(controls.movement, 0, 1) ||
      !['over', 'around'].includes(controls.side) || !['left', 'right'].includes(controls.batterHand) ||
      !within(controls.workload ?? 0, 0, 120)) throw new Error('Invalid bowling execution controls.')
  return Object.freeze({ ...controls, version: 1, playerId: profile.id, arm: profile.bowling.arm,
    type: profile.bowling.type, action: profile.bowling.action, workload: controls.workload ?? 0,
    attributes: Object.freeze({ ...profile.bowling }) })
}

/** Validate persisted command snapshots without depending on the live profile store. */
export function validateBowlingExecution(value: BowlingExecution): void {
  if (!value || value.version !== 1 || typeof value.playerId !== 'string' || !value.attributes ||
      value.arm !== value.attributes.arm || value.type !== value.attributes.type || value.action !== value.attributes.action) throw new Error('Invalid bowling snapshot.')
  for (const [key, valueRating] of Object.entries(value.attributes)) {
    if (typeof valueRating === 'number' && !within(valueRating, 0, key === 'maxPace' ? 165 : 100)) throw new Error('Invalid bowling attributes.')
  }
  createBowlingExecution({ id: value.playerId, bowling: value.attributes } as PlayerProfile, value)
}

export function bowlingKind(execution: BowlingExecution): DeliveryKind {
  if (BOWLING_VARIATIONS[execution.variation].family === 'spin') return execution.type === 'leg-spin' || execution.type === 'left-arm-wrist-spin' ? 'legspin' : 'spin'
  return execution.variation === 'yorker' || execution.variation === 'toe-yorker' ? 'yorker'
    : execution.variation === 'bouncer' || execution.variation === 'short-ball' ? 'bouncer'
      : execution.variation === 'inswing' || execution.variation === 'reverse-swing' ? 'inswing'
        : execution.variation === 'outswing' ? 'outswing' : execution.type === 'medium' ? 'length' : 'fast'
}

export function bowlingReleasePoint(execution: Pick<BowlingExecution, 'arm' | 'side' | 'type' | 'action'>): Vec3 {
  const spin = !['fast', 'medium-fast', 'medium'].includes(execution.type)
  const sling = execution.action.includes('sling')
  return {
    x: (execution.arm === 'right' ? 1 : -1) * (execution.side === 'over' ? .48 : -.92),
    y: (spin ? 1.95 : execution.type === 'medium' ? 2.0 : 2.06) - (sling ? .16 : 0),
    z: 18.29,
  }
}

export type ResolvedBowling = { release: Vec3; speed: number; length: number; line: number; turn: number; swing: number; restitution: number; noBall: boolean; flight: number; quality: number; stamina: number; lateSwing: boolean }

/** Called with Delivery's seeded generator; contains no rendering or wall-clock state. */
export function resolveBowling(execution: BowlingExecution, random: () => number): ResolvedBowling {
  validateBowlingExecution(execution)
  const b = execution.attributes, v = BOWLING_VARIATIONS[execution.variation]
  const spin = v.family === 'spin'
  const hand = execution.batterHand === 'right' ? 1 : -1
  const arm = execution.arm === 'right' ? 1 : -1
  const stamina = Math.max(.42, 1 - execution.workload / (78 + b.stamina * 1.8))
  const control = (b.control + b.paceControl + b.consistency) / 300
  const effortError = Math.max(0, execution.power - .82) * (1 - control) * 1.7
  const accuracy = b.accuracy / 100
  const specialist = ['yorker', 'toe-yorker'].includes(execution.variation) ? b.yorker
    : ['short-ball', 'bouncer'].includes(execution.variation) ? b.bouncer
      : execution.variation === 'slower-ball' ? b.slowerBall : b.skill
  const quality = Math.max(0, Math.min(1, execution.release * .64 + specialist / 100 * .22 + control * .14 - effortError))
  const spread = .045 + (1 - accuracy) * .28 + (1 - quality) * .62 + (1 - stamina) * .35
  const line = (execution.line + (random() - .5) * 2 * spread) * hand
  const length = Math.max(.6, Math.min(12.5, execution.length + (random() - .5) * 2 * (.12 + (1 - quality) * 1.8 + (1 - accuracy) * .5)))
  const paceRange = spin ? .69 + execution.power * .28 : .78 + execution.power * .22
  const speed = Math.min(b.maxPace / 3.6, (b.maxPace / 3.6) * paceRange * v.speed * (.91 + stamina * .09) * (.993 + random() * .014))
  const variationSkill = .45 + b.variationMastery / 100 * .55
  const movement = execution.movement * (.45 + quality * .55)
  const turn = v.turn * arm * (spin ? (2.2 + b.turn / 100 * 2.6) * (b.spin / 100) : (.6 + b.seam / 100) * 1.8) * movement * variationSkill
  const swingRating = execution.variation === 'reverse-swing' ? b.reverseSwing : spin ? b.drift : b.swing
  const swing = v.swing * (spin ? arm : hand) * (spin ? 1.8 : 4.8) * swingRating / 100 * movement
  const noBall = execution.power > .94 && execution.release < .3 && random() < (.3 - execution.release) * (.7 + (1 - control))
  return { release: bowlingReleasePoint(execution), speed, length, line, turn, swing, restitution: v.bounce,
    noBall, flight: spin ? execution.movement * b.flight / 100 * .75 : 0, quality, stamina, lateSwing: execution.variation === 'reverse-swing' }
}

export function releaseFeedback(execution: BowlingExecution, pitchPoint: Vec3 | null, projectedContact: Vec3) {
  const hand = execution.batterHand === 'right' ? 1 : -1
  const lineError = pitchPoint ? Math.abs(pitchPoint.x * hand - execution.line) : 0
  const lengthError = pitchPoint ? pitchPoint.z - execution.length : 0
  const quality = execution.release >= .88 ? 'Perfect release' : execution.release >= .57 ? 'Good release' : 'Poor release'
  const details = projectedContact.y > 1.85 ? 'Above head height · no ball' : Math.abs(projectedContact.x) > 1.11 ? 'Wide line'
    : lengthError > .8 ? 'Short of target' : lengthError < -.8 ? 'Overpitched'
      : lineError > .35 ? 'Inaccurate line' : execution.power > .94 && execution.release < .4 ? 'Excessive power' : 'Target executed'
  return { quality, details, lineError, lengthError }
}

/** Seed bits choose among tactical alternatives; AI uses exactly the player's controls. */
export function chooseAIDelivery(profile: PlayerProfile, innings: Innings, seed: number, batterHand: BattingHand, previousVariation?: BowlingVariation): BowlingExecution {
  const allowed = availableVariations(profile).filter(item => !item.locked)
  if (!allowed.length) throw new Error('No legal deliveries for this player.')
  const late = innings.legalBalls >= Math.max(6, innings.overs * 6 - 12)
  const spin = isSpinBowler(profile)
  const threatening = innings.target !== undefined && (innings.target - innings.runs) / Math.max(1, innings.overs * 6 - innings.legalBalls) > 1.3
  let choices = allowed.filter(item => item.id !== previousVariation)
  if (!choices.length) choices = allowed
  const yorker = choices.find(item => item.id === 'yorker')
  const v = !spin && (late || threatening) && yorker && seed % 3 !== 0 ? yorker : choices[(seed >>> 12) % choices.length]
  const b = profile.bowling
  return createBowlingExecution(profile, {
    variation: v.id, line: (batterHand === 'left' ? .24 : .18) + (((seed >>> 5) % 7) - 3) * .085,
    length: v.defaultLength, power: Math.min(.94, .58 + b.paceControl / 100 * .22 + ((seed >>> 19) % 9) * .014),
    release: Math.min(.96, .35 + (b.control + b.consistency) / 200 * .55 + ((seed >>> 3) % 11) * .01),
    movement: spin ? .55 + ((seed >>> 8) % 7) * .065 : .5 + b.swing / 200,
    side: profile.bowling.arm === batterHand && seed % 5 === 0 ? 'around' : 'over', batterHand,
    workload: innings.bowling.find(item => item.playerId === profile.id || !item.playerId && item.name === profile.id)?.balls ?? 0,
  })
}
