/** Versioned cricket identity. Rendering and live match statistics never own profiles. */
import { battingStyle, bowlingStyle, type BattingStyle } from './players.ts'

export const PLAYER_SCHEMA_VERSION = 2 as const
export const PLAYER_ROLES = ['specialist-batter', 'opening-batter', 'top-order-batter', 'middle-order-batter', 'finisher', 'wicketkeeper-batter', 'specialist-fast-bowler', 'specialist-spin-bowler', 'all-rounder', 'batting-all-rounder', 'bowling-all-rounder'] as const
export type PlayerRole = typeof PLAYER_ROLES[number]
export const BOWLING_TYPES = ['fast', 'medium-fast', 'medium', 'off-spin', 'leg-spin', 'left-arm-orthodox', 'left-arm-wrist-spin'] as const
export type BowlingType = typeof BOWLING_TYPES[number]
export const BOWLING_ACTIONS = ['high-arm', 'sling', 'smooth', 'side-on', 'finger-spin', 'wrist-spin'] as const
export type BowlingAction = typeof BOWLING_ACTIONS[number]
export const BOWLING_CAPABILITIES = ['none', 'occasional', 'regular', 'specialist'] as const
export const SKIN_TONES = ['#f0c9a4', '#d9a67d', '#bc895d', '#a56f49', '#805038', '#573729'] as const
export const BATTING_STYLES = ['balanced', 'accumulator', 'aggressive', 'power-hitter', 'technical'] as const
export type Hand = 'right' | 'left'

export type PlayerProfile = {
  version: typeof PLAYER_SCHEMA_VERSION
  /** Immutable roster key; renaming never changes an innings, lineup or online ID. */
  id: string
  identity: { fullName: string; displayName: string; jerseyName: string; jerseyNumber: number; captain: boolean; viceCaptain: boolean; skinTone: string }
  role: PlayerRole
  details: string
  batting: { hand: Hand; style: typeof BATTING_STYLES[number]; position: number; skill: number; power: number; timing: number; technique: number; shotControl: number; running: number; consistency: number; aggression: number }
  bowling: { capability: typeof BOWLING_CAPABILITIES[number]; arm: Hand; type: BowlingType; action: BowlingAction; skill: number; maxPace: number; paceControl: number; accuracy: number; control: number; swing: number; reverseSwing: number; seam: number; yorker: number; bouncer: number; slowerBall: number; spin: number; flight: number; drift: number; turn: number; variationMastery: number; stamina: number; consistency: number }
  fielding: { rating: number; catching: number; throwingAccuracy: number; throwingPower: number; agility: number; reflexes: number; groundFielding: number; wicketkeeping: number }
  /** Unknown fields from pre-v2 records are retained when migrating. */
  legacy?: Record<string, unknown>
}

export const ROLE_LABELS: Record<PlayerRole, string> = {
  'specialist-batter': 'Specialist batter', 'opening-batter': 'Opening batter', 'top-order-batter': 'Top-order batter', 'middle-order-batter': 'Middle-order batter', finisher: 'Finisher', 'wicketkeeper-batter': 'Wicketkeeper-batter', 'specialist-fast-bowler': 'Fast bowler', 'specialist-spin-bowler': 'Spin bowler', 'all-rounder': 'All-rounder', 'batting-all-rounder': 'Batting all-rounder', 'bowling-all-rounder': 'Bowling all-rounder',
}
export const BOWLING_TYPE_LABELS: Record<BowlingType, string> = { fast: 'Fast', 'medium-fast': 'Medium-fast', medium: 'Medium', 'off-spin': 'Off-spin', 'leg-spin': 'Leg-spin', 'left-arm-orthodox': 'Orthodox spin', 'left-arm-wrist-spin': 'Wrist-spin' }
export const ACTION_LABELS: Record<BowlingAction, string> = { 'high-arm': 'High arm', sling: 'Sling', smooth: 'Smooth approach', 'side-on': 'Side-on', 'finger-spin': 'Finger spin', 'wrist-spin': 'Wrist spin' }

const SEEDS: Record<string, { role: PlayerRole; type: BowlingType; hand?: Hand; arm?: Hand; action?: BowlingAction; capability?: PlayerProfile['bowling']['capability']; number: number }> = {
  Mehta: { role: 'opening-batter', type: 'medium', number: 7, capability: 'none' },
  Rao: { role: 'specialist-fast-bowler', type: 'fast', number: 18, action: 'high-arm' },
  Singh: { role: 'top-order-batter', type: 'medium', number: 10, hand: 'left', capability: 'occasional' },
  Iyer: { role: 'wicketkeeper-batter', type: 'off-spin', number: 4, capability: 'none' },
  Patel: { role: 'specialist-spin-bowler', type: 'off-spin', number: 23 },
  Khan: { role: 'specialist-fast-bowler', type: 'fast', number: 11, arm: 'left', action: 'sling' },
  Shah: { role: 'specialist-spin-bowler', type: 'leg-spin', number: 19 },
  Gill: { role: 'opening-batter', type: 'medium', number: 77, capability: 'none' },
  Das: { role: 'bowling-all-rounder', type: 'medium-fast', number: 31, action: 'side-on' },
  Reddy: { role: 'middle-order-batter', type: 'medium', number: 9, hand: 'left', capability: 'occasional' },
  Joshi: { role: 'batting-all-rounder', type: 'left-arm-wrist-spin', number: 26, hand: 'left', arm: 'left', capability: 'regular' },
  Nair: { role: 'wicketkeeper-batter', type: 'off-spin', number: 8, capability: 'none' },
  Dutt: { role: 'specialist-spin-bowler', type: 'left-arm-orthodox', number: 44, arm: 'left' },
  Sen: { role: 'specialist-fast-bowler', type: 'medium', number: 55, arm: 'left', action: 'smooth' },
  Roy: { role: 'finisher', type: 'medium-fast', number: 99, capability: 'occasional' },
  Hayes: { role: 'opening-batter', type: 'medium', number: 3, capability: 'none' },
  Reed: { role: 'top-order-batter', type: 'medium', number: 12, hand: 'left', capability: 'occasional' },
  Ward: { role: 'specialist-fast-bowler', type: 'fast', number: 28, action: 'high-arm' },
  Mills: { role: 'specialist-fast-bowler', type: 'medium-fast', number: 17, arm: 'left', action: 'smooth' },
  Cole: { role: 'specialist-spin-bowler', type: 'off-spin', number: 6 },
  Nash: { role: 'wicketkeeper-batter', type: 'medium', number: 1, capability: 'none' },
  Bell: { role: 'specialist-spin-bowler', type: 'left-arm-orthodox', number: 21, hand: 'left', arm: 'left' },
  Frost: { role: 'middle-order-batter', type: 'medium', number: 14, capability: 'none' },
  Pike: { role: 'finisher', type: 'medium', number: 35, hand: 'left', capability: 'none' },
  King: { role: 'specialist-spin-bowler', type: 'leg-spin', number: 8 },
  Banks: { role: 'batting-all-rounder', type: 'medium', number: 47, arm: 'left', capability: 'occasional', action: 'side-on' },
}

export function isSpinType(type: BowlingType) { return ['off-spin', 'leg-spin', 'left-arm-orthodox', 'left-arm-wrist-spin'].includes(type) }
export function isSpinBowler(profile: PlayerProfile) { return isSpinType(profile.bowling.type) }
export function compatibleActions(type: BowlingType): readonly BowlingAction[] {
  if (type === 'off-spin' || type === 'left-arm-orthodox') return ['finger-spin', 'side-on']
  if (type === 'leg-spin' || type === 'left-arm-wrist-spin') return ['wrist-spin', 'side-on']
  return ['high-arm', 'sling', 'smooth', 'side-on']
}
export function bowlingLabel(profile: PlayerProfile) {
  return profile.bowling.capability === 'none' ? 'Does not bowl' : `${profile.bowling.arm === 'left' ? 'Left' : 'Right'}-arm ${BOWLING_TYPE_LABELS[profile.bowling.type].toLowerCase()}`
}

/** Stable, pure defaults also support legacy opponent names and saved replays. */
export function defaultPlayerProfile(id: string): PlayerProfile {
  const hash = [...id].reduce((n, c) => n + c.charCodeAt(0), 0)
  const seed = SEEDS[id] ?? { role: 'all-rounder' as const, type: (['fast', 'off-spin', 'medium', 'leg-spin', 'left-arm-orthodox'] as const)[hash % 5], number: hash % 100 }
  const bat = battingStyle(id), bowl = bowlingStyle(id), spin = isSpinType(seed.type)
  const arm = seed.type.startsWith('left-arm') ? 'left' : seed.arm ?? 'right'
  const capability = seed.capability ?? (seed.role.includes('all-rounder') ? 'regular' : 'specialist')
  const skill = capability === 'none' ? 0 : capability === 'occasional' ? 43 : capability === 'regular' ? 68 : 79 + hash % 13
  return {
    version: PLAYER_SCHEMA_VERSION, id,
    identity: { fullName: id, displayName: id, jerseyName: id.toUpperCase().slice(0, 14), jerseyNumber: seed.number, captain: id === 'Mehta', viceCaptain: id === 'Iyer', skinTone: SKIN_TONES[hash % SKIN_TONES.length] },
    role: seed.role, details: '',
    batting: { hand: seed.hand ?? 'right', style: bat.aggression > .65 ? 'aggressive' : 'balanced', position: Object.keys(SEEDS).indexOf(id) < 0 ? 5 : Math.min(11, (Object.keys(SEEDS).indexOf(id) >= 15 ? Object.keys(SEEDS).indexOf(id) - 15 : Object.keys(SEEDS).indexOf(id)) + 1), skill: Math.round((bat.timing + bat.power) * 50), power: Math.round(bat.power * 100), timing: Math.round(bat.timing * 100), technique: Math.round(bat.timing * 100), shotControl: 72, running: Math.round((bat.running - .75) * 200), consistency: 75, aggression: Math.round(bat.aggression * 100) },
    bowling: { capability, arm, type: seed.type, action: seed.action ?? compatibleActions(seed.type)[0], skill, maxPace: spin ? 92 : seed.type === 'medium' ? 122 : seed.type === 'medium-fast' ? 136 : 151, paceControl: 73, accuracy: Math.round(bowl.accuracy * 100), control: 77, swing: spin ? 20 : Math.round(bowl.swing * 56), reverseSwing: spin ? 0 : 65 + hash % 20, seam: spin ? 22 : 68 + hash % 17, yorker: spin ? 15 : 68 + hash % 24, bouncer: spin ? 15 : 67 + hash % 22, slowerBall: spin ? 35 : 66 + hash % 25, spin: spin ? 78 + hash % 15 : 22, flight: spin ? 80 : 30, drift: spin ? 75 + hash % 13 : 22, turn: spin ? 82 + hash % 13 : 25, variationMastery: skill ? Math.max(35, skill - 5) : 0, stamina: 83 + hash % 13, consistency: 74 },
    fielding: { rating: 73, catching: 76, throwingAccuracy: 75, throwingPower: 72, agility: 78, reflexes: 77, groundFielding: 76, wicketkeeping: seed.role === 'wicketkeeper-batter' ? 87 : 12 },
  }
}

const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const choice = (value: unknown, choices: readonly string[]) => typeof value === 'string' && choices.includes(value)
const rating = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
const validName = (value: unknown, max: number) => typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= max && /^[\p{L}\p{M}\p{N} .'’()\-]+$/u.test(value)

/** Strict editing validation. Incompatible roles/actions are errors, never silent coercion. */
export function validatePlayerProfile(value: unknown): string[] {
  if (!object(value)) return ['Profile must be an object.']
  const errors: string[] = []
  if (value.version !== PLAYER_SCHEMA_VERSION) errors.push('Unsupported player schema version.')
  if (typeof value.id !== 'string' || !value.id.trim() || value.id.length > 64 || /[<>\x00-\x1f]/.test(value.id)) errors.push('Invalid player identity.')
  if (!object(value.identity)) errors.push('Player identity is required.')
  else {
    for (const [key, limit] of [['fullName', 36], ['displayName', 24], ['jerseyName', 14]] as const) if (!validName(value.identity[key], limit)) errors.push(`${key === 'fullName' ? 'Full name' : key === 'displayName' ? 'Display name' : 'Jersey name'} must contain 1–${limit} letters, numbers or name punctuation.`)
    if (!Number.isInteger(value.identity.jerseyNumber) || Number(value.identity.jerseyNumber) < 0 || Number(value.identity.jerseyNumber) > 99) errors.push('Jersey number must be an integer from 0 to 99.')
    if (typeof value.identity.captain !== 'boolean' || typeof value.identity.viceCaptain !== 'boolean') errors.push('Captain and vice-captain must be true or false.')
    if (value.identity.captain && value.identity.viceCaptain) errors.push('A player cannot be captain and vice-captain together.')
    if (!choice(value.identity.skinTone, SKIN_TONES)) errors.push('Choose an available appearance.')
  }
  if (!choice(value.role, PLAYER_ROLES)) errors.push('Choose a supported player role.')
  if (typeof value.details !== 'string' || value.details.length > 240 || /[<>\x00-\x08\x0b-\x1f]/.test(value.details)) errors.push('Profile details must be plain text up to 240 characters.')
  if (!object(value.batting)) errors.push('Batting attributes are required.')
  else {
    if (!choice(value.batting.hand, ['left', 'right'])) errors.push('Choose a batting hand.')
    if (!choice(value.batting.style, BATTING_STYLES)) errors.push('Choose a batting style.')
    if (!Number.isInteger(value.batting.position) || Number(value.batting.position) < 1 || Number(value.batting.position) > 11) errors.push('Batting position must be 1–11.')
    for (const key of ['skill', 'power', 'timing', 'technique', 'shotControl', 'running', 'consistency', 'aggression']) if (!rating(value.batting[key])) errors.push(`Batting ${key} must be 0–100.`)
  }
  if (!object(value.bowling)) errors.push('Bowling attributes are required.')
  else {
    const b = value.bowling
    if (!choice(b.capability, BOWLING_CAPABILITIES)) errors.push('Choose a bowling capability.')
    if (!choice(b.arm, ['left', 'right'])) errors.push('Choose a bowling arm.')
    if (!choice(b.type, BOWLING_TYPES)) errors.push('Choose a bowling type.')
    else {
      const type = b.type as BowlingType
      if (!choice(b.action, compatibleActions(type))) errors.push('Bowling action does not match this bowling type.')
      if ((type.startsWith('left-arm') && b.arm !== 'left') || ((type === 'off-spin' || type === 'leg-spin') && b.arm !== 'right')) errors.push('Use left-arm orthodox or wrist-spin for a left-arm spinner; off-spin and leg-spin are right-arm styles.')
      const maximum = isSpinType(type) ? 115 : type === 'medium' ? 135 : type === 'medium-fast' ? 148 : 165
      const minimum = isSpinType(type) ? 60 : 100
      if (typeof b.maxPace !== 'number' || !Number.isFinite(b.maxPace) || b.maxPace < minimum || b.maxPace > maximum) errors.push(`${BOWLING_TYPE_LABELS[type]} maximum pace must be ${minimum}–${maximum} km/h.`)
    }
    for (const key of ['skill', 'paceControl', 'accuracy', 'control', 'swing', 'reverseSwing', 'seam', 'yorker', 'bouncer', 'slowerBall', 'spin', 'flight', 'drift', 'turn', 'variationMastery', 'stamina', 'consistency']) if (!rating(b[key])) errors.push(`Bowling ${key} must be 0–100.`)
    if (b.capability !== 'none' && Number(b.skill) < 20) errors.push('A player who bowls needs at least 20 bowling skill.')
  }
  if (!object(value.fielding)) errors.push('Fielding attributes are required.')
  else for (const key of ['rating', 'catching', 'throwingAccuracy', 'throwingPower', 'agility', 'reflexes', 'groundFielding', 'wicketkeeping']) if (!rating(value.fielding[key])) errors.push(`Fielding ${key} must be 0–100.`)
  if (object(value.bowling) && object(value.batting) && object(value.fielding)) {
    const role = String(value.role), b = value.bowling
    if (role === 'wicketkeeper-batter' && Number(value.fielding.wicketkeeping) < 50) errors.push('A wicketkeeper-batter requires at least 50 wicketkeeping ability.')
    if (role.includes('all-rounder') && (b.capability === 'none' || Number(b.skill) < 35 || Number(value.batting.skill) < 35)) errors.push('An all-rounder needs usable batting and bowling skills of at least 35.')
    if (role.startsWith('specialist-') && role.endsWith('-bowler') && (b.capability !== 'specialist' || Number(b.skill) < 50)) errors.push('A specialist bowler requires specialist capability and at least 50 bowling skill.')
    if (choice(b.type, BOWLING_TYPES) && role === 'specialist-fast-bowler' && isSpinType(b.type as BowlingType)) errors.push('A specialist fast bowler needs a pace bowling type.')
    if (choice(b.type, BOWLING_TYPES) && role === 'specialist-spin-bowler' && !isSpinType(b.type as BowlingType)) errors.push('A specialist spin bowler needs a spin bowling type.')
  }
  return errors
}

/** Missing attributes receive defaults; original legacy fields remain attached. */
export function migratePlayerProfile(value: unknown, id?: string): PlayerProfile {
  if (value !== undefined && !object(value)) throw new Error('Saved player profile must be an object.')
  const source = object(value) ? value : {}
  if (source.version !== undefined && source.version !== 1 && source.version !== PLAYER_SCHEMA_VERSION) throw new Error('Unsupported player schema version; original data must be retained.')
  const key = id ?? (typeof source.id === 'string' ? source.id : typeof source.name === 'string' ? source.name : 'Player')
  const base = defaultPlayerProfile(key)
  if (source.version === PLAYER_SCHEMA_VERSION) {
    const errors = validatePlayerProfile(source)
    if (id !== undefined && source.id !== id) errors.push('Saved profile identity does not match its roster key.')
    if (errors.length) throw new Error(errors.join(' '))
    return structuredClone(source) as PlayerProfile
  }
  const identity = object(source.identity) ? source.identity : {}
  const batting = object(source.batting) ? source.batting : {}
  const bowling = object(source.bowling) ? source.bowling : {}
  const fielding = object(source.fielding) ? source.fielding : {}
  const profile: PlayerProfile = { ...base, identity: { ...base.identity, ...identity }, batting: { ...base.batting, ...batting }, bowling: { ...base.bowling, ...bowling }, fielding: { ...base.fielding, ...fielding }, legacy: structuredClone(source) }
  if (typeof source.name === 'string') profile.identity.fullName = profile.identity.displayName = source.name
  if (choice(source.role, PLAYER_ROLES)) profile.role = source.role as PlayerRole
  // Original player module used fractions and a running multiplier. A v1 record
  // with no version follows that convention; explicitly versioned records do not.
  if (!source.version) {
    for (const k of ['timing', 'power', 'aggression'] as const) if (typeof batting[k] === 'number' && batting[k] <= 1) profile.batting[k] = Math.round(batting[k] * 100)
    if (typeof batting.running === 'number' && batting.running < 2) profile.batting.running = Math.max(0, Math.min(100, Math.round((batting.running - .75) * 200)))
    if (typeof bowling.accuracy === 'number' && bowling.accuracy <= 1) profile.bowling.accuracy = Math.round(bowling.accuracy * 100)
    if (typeof bowling.swing === 'number' && bowling.swing <= 2) profile.bowling.swing = Math.min(100, Math.round(bowling.swing * 56))
    if (typeof bowling.turn === 'number' && bowling.turn <= 2) profile.bowling.turn = Math.min(100, Math.round(bowling.turn * 62))
  }
  const errors = validatePlayerProfile(profile)
  if (errors.length) throw new Error(errors.join(' '))
  return profile
}

export function canPlayerBowl(profile: PlayerProfile) { return profile.bowling.capability !== 'none' && profile.bowling.skill >= 20 }
export function canKeepWicket(profile: PlayerProfile) { return profile.fielding.wicketkeeping >= 50 }
export function playerRatings(profile: PlayerProfile) {
  const batting = Math.round((profile.batting.skill * 2 + profile.batting.timing + profile.batting.power + profile.batting.technique) / 5)
  const bowling = canPlayerBowl(profile) ? Math.round((profile.bowling.skill * 2 + profile.bowling.accuracy + profile.bowling.control + (isSpinBowler(profile) ? profile.bowling.spin : profile.bowling.paceControl)) / 5) : 0
  const fielding = profile.fielding.rating
  return { batting, bowling, fielding, overall: Math.round((Math.max(batting, bowling) * 2 + Math.min(batting, bowling) + fielding) / 4) }
}
export function localBattingStyle(profile: PlayerProfile): BattingStyle {
  return { timing: profile.batting.timing / 100, power: profile.batting.power / 100, aggression: profile.batting.aggression / 100, running: Number((.75 + profile.batting.running / 200).toFixed(3)) }
}
