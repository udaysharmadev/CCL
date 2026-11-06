import type { Delivery, DeliveryKind, DeliveryOptions, FieldPreset, Shot, ShotInput } from './cricket.ts'
import type { DeliveryOutcome, Innings, RULE_PROFILE } from './rules.ts'
import type { RoomSettings } from './match-data.ts'

export const ONLINE_PATH = '/online'
export const ONLINE_PORT = 8788
export const QUICK_OVERS = 5
export const ONLINE_WINDUP_MS = 3000
export const MIN_PRIVATE_OVERS = 2
export const MAX_PRIVATE_OVERS = 20

export type OnlineSeat = 0 | 1
export type OnlineMode = 'quick' | 'private' | 'duo'
export type OnlinePhase = 'lobby' | 'toss' | 'ready' | 'windup' | 'flight' | 'complete'
export type OnlineTossChoice = 'bat' | 'bowl'

export type OnlineHandshake = (
  | { type: 'quick' }
  | { type: 'create'; overs: number }
  | { type: 'create-duo'; overs: number }
  | { type: 'join'; room: string }
  | { type: 'resume'; room: string; token: string }
) & { account?: string }

export type OnlineIntent =
  | { type: 'running'; seq: number; delivery: number; running: boolean }
  | { type: 'toss'; seq: number; choice: OnlineTossChoice }
  | { type: 'bowl'; seq: number; delivery: number; kind: DeliveryKind; line: number; effort: number; field?: FieldPreset }
  | { type: 'swing'; seq: number; delivery: number; kind: Shot; aim: number; power: number }

export type OnlineControl =
  | { type: 'configure'; version: number; settings: RoomSettings }
  | { type: 'approve'; version: number; lineup: string[] }
  | { type: 'rematch'; match: number }
  | { type: 'swap'; match: number; delivery: number; version: number; approve: boolean }
  | { type: 'next'; match: number; delivery: number }
  | { type: 'call'; match: number; delivery: number; call: 'run' | 'wait' | 'no' }
export type OnlineClientMessage = OnlineHandshake | OnlineIntent | OnlineControl
export type OnlineDeliveryCommand = Readonly<{ tick: number; seq: number } & (
  | { type: 'running'; running: boolean }
  | { type: 'swing'; input: ShotInput }
)>
type LegacyDeliveryInputs = Readonly<{
  runs?: readonly Readonly<{ tick: number; running: boolean }>[]
  shot: Readonly<{ tick: number; input: ShotInput }> | null
}>
export type OnlineInputHistory =
  | Readonly<{ version: 2; commands: readonly OnlineDeliveryCommand[] }>
  | (LegacyDeliveryInputs & Readonly<{ version?: 1 }>)
// shot/runs are compatibility views. Version 2 reconstructs exclusively from commands.
export type OnlineReplay = Readonly<{ options: DeliveryOptions }> & LegacyDeliveryInputs & OnlineInputHistory
export type OnlineActiveBall = OnlineReplay & Readonly<{
  tick: number
  phase: Delivery['phase']
}>

export type OnlineScore = Omit<Innings, 'history' | 'target'> & Readonly<{
  target: number | null
  recent: readonly DeliveryOutcome[]
}>

export type OnlineResult = Readonly<{
  winner: OnlineSeat | null
  reason: 'runs' | 'wickets' | 'tie' | 'forfeit' | 'abandoned' | 'duo'
  margin: number | null
}>

export type OnlineSnapshot = Readonly<{
  revision: number
  match: number
  bowler: string
  maxOutside: number
  settings: RoomSettings
  settingsVersion: number
  ready: readonly [boolean, boolean]
  lineups: readonly [readonly string[], readonly string[]]
  rematch: readonly [boolean, boolean]
  wallets: readonly [{ coins: number; xp: number }, { coins: number; xp: number }]
  rulesProfile: typeof RULE_PROFILE
  room: string
  mode: OnlineMode
  overs: number
  phase: OnlinePhase
  connected: readonly [boolean, boolean]
  tossWinner: OnlineSeat | null
  battingSeat: OnlineSeat | null
  duoSwap?: { version: number; votes: readonly [boolean, boolean] }
  partnerCall?: { seat: OnlineSeat; call: 'run' | 'wait' | 'no' } | null
  delivery: number
  innings: 1 | 2
  score: OnlineScore
  firstInnings: Readonly<{ battingSeat: OnlineSeat; score: OnlineScore }> | null
  bowlingKind: DeliveryKind | null
  windupRemainingMs: number | null
  active: OnlineActiveBall | null
  last: Readonly<{
    delivery: number
    innings: 1 | 2
    outcome: DeliveryOutcome
    replay: OnlineReplay
    checksum: string
  }> | null
  result: OnlineResult | null
}>

export type OnlineRejectCode =
  | 'invalid-message' | 'already-in-room' | 'room-not-found' | 'room-full' | 'invalid-token' | 'seat-online'
  | 'duplicate-sequence' | 'out-of-order' | 'wrong-phase' | 'wrong-seat' | 'waiting-for-peer'
  | 'stale-delivery' | 'swing-closed' | 'capacity' | 'rate-limit'

export type OnlineServerMessage =
  | { type: 'session'; room: string; token: string; account?: string; seat: OnlineSeat; nextSeq: number }
  | { type: 'snapshot'; state: OnlineSnapshot }
  | { type: 'ack'; nextSeq: number }
  | { type: 'reject'; code: OnlineRejectCode; nextSeq: number | null }
