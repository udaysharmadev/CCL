import { ROSTER } from './match-data.ts'
import { save, stored } from './platform.ts'
import { canKeepWicket, canPlayerBowl, defaultPlayerProfile, migratePlayerProfile, validatePlayerProfile, type PlayerProfile } from './player-profile.ts'
import type { Innings } from './rules.ts'

export const PLAYER_STORE_KEY = 'ccl.players.v2'
export const PLAYER_BACKUP_KEY = 'ccl.players.legacy-backup.v1'
const STATS_KEY = 'ccl.player-stats.v1'
type Envelope = { version: 2; profiles: Record<string, unknown> }
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

function readEnvelope(): { envelope: Envelope; source: string | null; warning: string } {
  const source = stored(PLAYER_STORE_KEY)
  if (!source) return { envelope: { version: 2, profiles: {} }, source, warning: '' }
  try {
    const parsed: unknown = JSON.parse(source)
    if (record(parsed) && record(parsed.profiles)) return { envelope: { version: 2, profiles: parsed.profiles }, source, warning: parsed.version === 2 ? '' : 'Legacy profiles receive current defaults; the original data is backed up when you save.' }
    if (Array.isArray(parsed)) return { envelope: { version: 2, profiles: Object.fromEntries(parsed.filter(record).map(p => [String(p.id ?? p.name), p])) }, source, warning: 'Legacy profiles receive current defaults; the original data is backed up when you save.' }
    if (record(parsed)) return { envelope: { version: 2, profiles: parsed }, source, warning: 'Legacy profiles receive current defaults; the original data is backed up when you save.' }
  } catch { /* The original value is kept until a backup succeeds. */ }
  return { envelope: { version: 2, profiles: {} }, source, warning: 'Saved profile data could not be read. Original data will be backed up before any new save.' }
}

export function getPlayerProfile(id: string): PlayerProfile {
  const raw = readEnvelope().envelope.profiles[id]
  if (raw === undefined) return defaultPlayerProfile(id)
  try { return migratePlayerProfile(raw, id) } catch { return defaultPlayerProfile(id) }
}
export function getPlayerProfiles() { return ROSTER.map(({ name }) => getPlayerProfile(name)) }
/** Capture once at the start of a local match. Renames cannot mutate a live card. */
export function snapshotPlayerProfiles(ids: readonly string[]): Record<string, PlayerProfile> {
  return Object.fromEntries(ids.map(id => [id, getPlayerProfile(id)]))
}
export function profileStoreWarning() {
  const { envelope, warning } = readEnvelope()
  const invalid = Object.entries(envelope.profiles).flatMap(([id, value]) => {
    try { migratePlayerProfile(value, id); return [] } catch { return [id] }
  })
  return [warning, invalid.length ? `Invalid saved profiles (${invalid.join(', ')}) use safe defaults. Original records remain stored.` : ''].filter(Boolean).join(' ')
}
export function savePlayerProfile(profile: PlayerProfile): { ok: boolean; errors: string[] } {
  const errors = validatePlayerProfile(profile)
  if (!ROSTER.some(p => p.name === profile.id)) errors.push('Only a player in this squad can be edited.')
  if (errors.length) return { ok: false, errors }
  const read = readEnvelope()
  const profiles = { ...read.envelope.profiles }
  // Retain the full original envelope once, including records the current version
  // cannot interpret. A failed backup must not overwrite the user's only copy.
  if (read.source && !stored(PLAYER_BACKUP_KEY) && !save(PLAYER_BACKUP_KEY, read.source)) return { ok: false, errors: ['Could not back up the existing profiles. Free storage space and try again.'] }
  for (const player of getPlayerProfiles()) {
    if (player.id === profile.id) continue
    if (profile.identity.captain && player.identity.captain) { player.identity.captain = false; profiles[player.id] = player }
    if (profile.identity.viceCaptain && player.identity.viceCaptain) { player.identity.viceCaptain = false; profiles[player.id] = player }
  }
  profiles[profile.id] = structuredClone(profile)
  const ok = save(PLAYER_STORE_KEY, JSON.stringify({ version: 2, profiles }))
  return { ok, errors: ok ? [] : ['Could not save this player. Your existing profile is unchanged.'] }
}

export function localLineupError(ids: readonly string[]) {
  if (ids.length !== 11 || new Set(ids).size !== 11 || ids.some(id => !ROSTER.some(p => p.name === id))) return 'Choose exactly 11 distinct players.'
  const profiles = ids.map(getPlayerProfile)
  if (!profiles.some(canKeepWicket)) return 'Select a player with at least 50 wicketkeeping ability.'
  if (profiles.filter(canPlayerBowl).length < 5) return 'Select at least five players with bowling capability.'
  return ''
}

export type PlayerCareerStats = { matches: number; runs: number; ballsFaced: number; fours: number; sixes: number; wickets: number; ballsBowled: number; conceded: number; bestRuns: number }
export const EMPTY_PLAYER_STATS: PlayerCareerStats = { matches: 0, runs: 0, ballsFaced: 0, fours: 0, sixes: 0, wickets: 0, ballsBowled: 0, conceded: 0, bestRuns: 0 }
type StatsEnvelope = { version: 1; matches: string[]; players: Record<string, PlayerCareerStats> }
function statsEnvelope(): StatsEnvelope {
  try {
    const value = JSON.parse(stored(STATS_KEY) ?? 'null')
    if (record(value) && value.version === 1 && Array.isArray(value.matches) && record(value.players)) return value as StatsEnvelope
  } catch { /* No previous player-level career. */ }
  return { version: 1, matches: [], players: {} }
}
export function getPlayerStats(id: string): PlayerCareerStats {
  const raw = statsEnvelope().players[id]
  return Object.fromEntries(Object.entries(EMPTY_PLAYER_STATS).map(([key, fallback]) => [key, raw && Number.isSafeInteger(raw[key as keyof PlayerCareerStats]) && raw[key as keyof PlayerCareerStats] >= 0 ? raw[key as keyof PlayerCareerStats] : fallback])) as PlayerCareerStats
}
/** Local completed-match aggregation; online sealed results are never rewritten. */
export function recordPlayerMatch(matchId: string, innings: readonly Innings[], profiles: Record<string, PlayerProfile>): boolean {
  const data = statsEnvelope()
  if (data.matches.includes(matchId)) return true
  const identities = Object.values(profiles)
  for (const profile of identities) {
    const matches = (entry: { playerId?: string; name: string }) => entry.playerId
      ? entry.playerId === profile.id
      : entry.name === profile.id || (entry.name === profile.identity.displayName && identities.filter(p => p.identity.displayName === entry.name).length === 1)
    const batting = innings.flatMap(i => i.batting).filter(matches)
    const bowling = innings.flatMap(i => i.bowling).filter(matches)
    if (!batting.length && !bowling.length) continue
    const stats = getPlayerStats(profile.id)
    stats.matches++
    for (const b of batting) { stats.runs += b.runs; stats.ballsFaced += b.balls; stats.fours += b.fours; stats.sixes += b.sixes; stats.bestRuns = Math.max(stats.bestRuns, b.runs) }
    for (const b of bowling) { stats.wickets += b.wickets; stats.ballsBowled += b.balls; stats.conceded += b.runs }
    data.players[profile.id] = stats
  }
  data.matches.push(matchId)
  // Keep every idempotency key: removing an old key could double count a replay.
  return save(STATS_KEY, JSON.stringify(data))
}
