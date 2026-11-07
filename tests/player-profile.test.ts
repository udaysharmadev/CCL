import assert from 'node:assert/strict'
import { test, beforeEach } from 'node:test'
import { DEFAULT_LINEUP, ROSTER, OPPONENT_NAMES, OPPONENT_BOWLERS, lineupError } from '../src/match-data.ts'
import { ACTION_LABELS, BOWLING_TYPES, PLAYER_ROLES, canKeepWicket, canPlayerBowl, compatibleActions, defaultPlayerProfile, isSpinBowler, localBattingStyle, migratePlayerProfile, playerRatings, validatePlayerProfile, type PlayerProfile } from '../src/player-profile.ts'
import { PLAYER_BACKUP_KEY, PLAYER_STORE_KEY, getPlayerProfile, getPlayerProfiles, getPlayerStats, localLineupError, profileStoreWarning, recordPlayerMatch, savePlayerProfile, snapshotPlayerProfiles } from '../src/player-store.ts'
import { newInnings } from '../src/rules.ts'

const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } })
beforeEach(() => storage.clear())

for (const { name } of ROSTER) test(`default ${name} is a complete, valid cricket profile`, () => {
  const profile = defaultPlayerProfile(name)
  assert.deepEqual(validatePlayerProfile(profile), [])
  assert.equal(profile.id, name)
  assert.ok(Object.keys(profile.batting).length >= 10)
  assert.ok(Object.keys(profile.bowling).length >= 20)
  assert.ok(compatibleActions(profile.bowling.type).includes(profile.bowling.action))
})

test('opponent roster has explicit specialist identities, a qualified keeper and mixed arm/hand profiles', () => {
  const opponents = OPPONENT_NAMES.map(defaultPlayerProfile)
  for (const profile of opponents) assert.deepEqual(validatePlayerProfile(profile), [], profile.id)
  assert.equal(opponents.filter(canKeepWicket).length, 1)
  for (const id of OPPONENT_BOWLERS) assert.equal(defaultPlayerProfile(id).bowling.capability, 'specialist')
  assert.ok(opponents.some(p => p.batting.hand === 'left'))
  assert.ok(opponents.some(p => p.bowling.arm === 'left' && canPlayerBowl(p)))
  assert.ok(opponents.some(p => isSpinBowler(p) && canPlayerBowl(p)))
  assert.ok(opponents.some(p => !isSpinBowler(p) && canPlayerBowl(p)))
  assert.ok(opponents.some(p => !canPlayerBowl(p)))
})

test('all eight arm/style combinations have an appropriate physical profile', () => {
  for (const type of BOWLING_TYPES) for (const arm of ['right', 'left'] as const) {
    if ((type.startsWith('left-arm') && arm !== 'left') || (['off-spin', 'leg-spin'].includes(type) && arm !== 'right')) continue
    const p = defaultPlayerProfile('Rao')
    p.bowling.type = type; p.bowling.arm = arm; p.bowling.action = compatibleActions(type)[0]
    p.role = isSpinBowler(p) ? 'specialist-spin-bowler' : 'specialist-fast-bowler'
    p.bowling.maxPace = isSpinBowler(p) ? 90 : type === 'medium' ? 122 : type === 'medium-fast' ? 136 : 151
    assert.deepEqual(validatePlayerProfile(p), [], `${arm} ${type}`)
    assert.ok(ACTION_LABELS[p.bowling.action])
  }
})
test('batting hand is independent from bowling arm', () => {
  for (const hand of ['right', 'left'] as const) for (const arm of ['right', 'left'] as const) {
    const p = defaultPlayerProfile('Das'); p.batting.hand = hand; p.bowling.arm = arm
    assert.deepEqual(validatePlayerProfile(p), [])
  }
})
test('each player role can carry a valid appropriate configuration', () => {
  for (const role of PLAYER_ROLES) {
    const p = defaultPlayerProfile(role === 'specialist-spin-bowler' ? 'Patel' : 'Rao')
    p.role = role; p.fielding.wicketkeeping = 70
    assert.deepEqual(validatePlayerProfile(p), [], role)
  }
})
test('a batter without bowling capability is not a bowler', () => {
  assert.equal(canPlayerBowl(defaultPlayerProfile('Mehta')), false)
  assert.equal(playerRatings(defaultPlayerProfile('Mehta')).bowling, 0)
  assert.equal(canPlayerBowl(defaultPlayerProfile('Singh')), true)
  assert.equal(canPlayerBowl(defaultPlayerProfile('Joshi')), true)
})
test('keeper eligibility is a capability rather than a cosmetic role label', () => {
  const p = defaultPlayerProfile('Iyer')
  assert.ok(canKeepWicket(p))
  p.fielding.wicketkeeping = 49
  assert.equal(canKeepWicket(p), false)
  assert.match(validatePlayerProfile(p).join(), /requires at least 50/)
})
test('specialist and all-rounder roles reject impossible capabilities', () => {
  const specialist = defaultPlayerProfile('Rao'); specialist.bowling.capability = 'none'
  assert.match(validatePlayerProfile(specialist).join(), /specialist capability/)
  const allrounder = defaultPlayerProfile('Das'); allrounder.batting.skill = 10
  assert.match(validatePlayerProfile(allrounder).join(), /usable batting/)
  const wrong = defaultPlayerProfile('Patel'); wrong.role = 'specialist-fast-bowler'
  assert.match(validatePlayerProfile(wrong).join(), /pace bowling type/)
})
test('spin arm and action conflicts are rejected', () => {
  const p = defaultPlayerProfile('Patel'); p.bowling.arm = 'left'; p.bowling.action = 'sling'
  const errors = validatePlayerProfile(p).join()
  assert.match(errors, /left-arm orthodox/); assert.match(errors, /action does not match/)
})
test('medium pace cannot silently adopt elite fast speed', () => {
  const p = defaultPlayerProfile('Sen'); p.bowling.maxPace = 160
  assert.match(validatePlayerProfile(p).join(), /100–135 km\/h/)
})
test('invalid names, jersey numbers, ratings and enum values are rejected', () => {
  const p = defaultPlayerProfile('Mehta')
  p.identity.displayName = '<script>'; p.identity.jerseyName = 'A'.repeat(15); p.identity.jerseyNumber = 100
  p.batting.timing = Number.NaN; p.batting.hand = 'ambidextrous' as 'right'
  const errors = validatePlayerProfile(p).join()
  assert.match(errors, /Display name/); assert.match(errors, /Jersey name/); assert.match(errors, /Jersey number/); assert.match(errors, /timing/); assert.match(errors, /batting hand/)
})
test('Unicode names and ordinary name punctuation renderable as text are valid', () => {
  const p = defaultPlayerProfile('Mehta'); p.identity.fullName = 'José O’Neill-Sen'; p.identity.displayName = 'José Sen'; p.identity.jerseyName = 'JOSÉ'
  assert.deepEqual(validatePlayerProfile(p), [])
})
test('full/display/jersey name and number changes persist under stable identity', () => {
  const p = getPlayerProfile('Mehta')
  p.identity.fullName = 'Arjun Mehta'; p.identity.displayName = 'A. Mehta'; p.identity.jerseyName = 'ARJUN'; p.identity.jerseyNumber = 42
  assert.deepEqual(savePlayerProfile(p), { ok: true, errors: [] })
  assert.deepEqual(getPlayerProfile('Mehta'), p)
  assert.equal(getPlayerProfile('A. Mehta').id, 'A. Mehta')
  assert.ok(getPlayerProfiles().some(p => p.id === 'Mehta'))
})
test('match profile snapshots are detached from later edits', () => {
  const snapshot = snapshotPlayerProfiles(DEFAULT_LINEUP)
  const p = getPlayerProfile('Rao'); p.identity.displayName = 'R. Rao'; p.bowling.accuracy = 99; savePlayerProfile(p)
  assert.equal(snapshot.Rao.identity.displayName, 'Rao')
  assert.notEqual(snapshot.Rao.bowling.accuracy, getPlayerProfile('Rao').bowling.accuracy)
  snapshot.Rao.identity.displayName = 'Snapshot'
  assert.equal(getPlayerProfile('Rao').identity.displayName, 'R. Rao')
})
test('captain and vice captain reassignment remains unique', () => {
  const p = getPlayerProfile('Khan'); p.identity.captain = true
  assert.ok(savePlayerProfile(p).ok)
  assert.deepEqual(getPlayerProfiles().filter(p => p.identity.captain).map(p => p.id), ['Khan'])
  const q = getPlayerProfile('Patel'); q.identity.viceCaptain = true; savePlayerProfile(q)
  assert.deepEqual(getPlayerProfiles().filter(p => p.identity.viceCaptain).map(p => p.id), ['Patel'])
})
test('invalid editing is rejected without overwriting stored data', () => {
  const p = getPlayerProfile('Rao'); savePlayerProfile(p)
  const before = storage.get(PLAYER_STORE_KEY)
  p.bowling.maxPace = 300
  assert.equal(savePlayerProfile(p).ok, false)
  assert.equal(storage.get(PLAYER_STORE_KEY), before)
})
test('legacy optional profile fields gain defaults and retain unknown information', () => {
  const raw = { name: 'Rao', batting: { power: .92, running: 1.1 }, bowling: { accuracy: .64, kinds: ['fast'] }, hometown: 'Pune' }
  const migrated = migratePlayerProfile(raw)
  assert.equal(migrated.batting.power, 92); assert.equal(migrated.batting.running, 70); assert.equal(migrated.bowling.accuracy, 64)
  assert.equal(migrated.legacy?.hometown, 'Pune')
  assert.deepEqual(validatePlayerProfile(migrated), [])
  assert.deepEqual(raw, { name: 'Rao', batting: { power: .92, running: 1.1 }, bowling: { accuracy: .64, kinds: ['fast'] }, hometown: 'Pune' })
})
test('legacy store retains an original backup before the first migration save', () => {
  const old = JSON.stringify([{ name: 'Rao', club: 'Original club' }]); storage.set(PLAYER_STORE_KEY, old)
  const p = getPlayerProfile('Rao'); p.identity.jerseyName = 'PACE'; assert.ok(savePlayerProfile(p).ok)
  assert.equal(storage.get(PLAYER_BACKUP_KEY), old)
  assert.equal(getPlayerProfile('Rao').legacy?.club, 'Original club')
})
test('corrupt data produces a warning and is preserved in backup', () => {
  storage.set(PLAYER_STORE_KEY, '{broken')
  assert.match(profileStoreWarning(), /could not be read/)
  assert.ok(savePlayerProfile(defaultPlayerProfile('Rao')).ok)
  assert.equal(storage.get(PLAYER_BACKUP_KEY), '{broken')
})
test('mismatched stable IDs and invalid current schemas are never accepted as another player', () => {
  const raw = defaultPlayerProfile('Khan')
  storage.set(PLAYER_STORE_KEY, JSON.stringify({ version: 2, profiles: { Rao: raw } }))
  assert.equal(getPlayerProfile('Rao').id, 'Rao')
  assert.match(profileStoreWarning(), /Invalid saved profiles/)
  assert.throws(() => migratePlayerProfile(raw, 'Rao'), /does not match/)
  assert.throws(() => migratePlayerProfile({ ...raw, version: 3 }, 'Khan'), /Unsupported player schema/)
  assert.throws(() => migratePlayerProfile(null, 'Rao'), /must be an object/)
})
test('local lineup validates bowling and wicketkeeping attributes independently from online fixed roles', () => {
  assert.equal(localLineupError(DEFAULT_LINEUP), '')
  const ids = ['Mehta', 'Singh', 'Iyer', 'Rao', 'Patel', 'Khan', 'Shah', 'Gill', 'Reddy', 'Joshi', 'Roy']
  assert.equal(localLineupError(ids), '')
  assert.match(lineupError(ids), /five bowlers/)
  assert.match(localLineupError(DEFAULT_LINEUP.slice(1)), /exactly 11/)
  const keeper = getPlayerProfile('Iyer'); keeper.role = 'specialist-batter'; keeper.fielding.wicketkeeping = 20; savePlayerProfile(keeper)
  assert.match(localLineupError(DEFAULT_LINEUP), /wicketkeeping/)
})
test('local batting conversion preserves existing individual runner paces', () => {
  assert.equal(localBattingStyle(defaultPlayerProfile('Sen')).running, 1.14)
  assert.equal(localBattingStyle(defaultPlayerProfile('Roy')).running, .94)
  assert.ok(localBattingStyle(defaultPlayerProfile('Gill')).power > localBattingStyle(defaultPlayerProfile('Sen')).power)
})
test('completed local career stats are idempotent and independent of editable profile values', () => {
  const base = newInnings(2, undefined, DEFAULT_LINEUP)
  const innings = { ...base, batting: base.batting.map((b, i) => i ? b : { ...b, runs: 27, balls: 15, fours: 3, sixes: 1 }), bowling: [{ name: 'Rao', balls: 6, runs: 8, wickets: 2, maidens: 0, wides: 0, noBalls: 0 }] }
  const profiles = snapshotPlayerProfiles(DEFAULT_LINEUP)
  assert.ok(recordPlayerMatch('match-1', [innings], profiles)); assert.ok(recordPlayerMatch('match-1', [innings], profiles))
  assert.equal(getPlayerStats('Mehta').runs, 27); assert.equal(getPlayerStats('Mehta').matches, 1)
  assert.equal(getPlayerStats('Rao').wickets, 2); assert.equal(getPlayerStats('Rao').conceded, 8)
  const p = getPlayerProfile('Mehta'); p.identity.displayName = 'New name'; savePlayerProfile(p)
  assert.equal(getPlayerStats('Mehta').runs, 27)
})

test('duplicate display names never merge separate player career identities', () => {
  const profiles = snapshotPlayerProfiles(['Mehta', 'Rao'])
  profiles.Mehta.identity.displayName = profiles.Rao.identity.displayName = 'Same name'
  const base = newInnings(2, undefined, ['Same name', 'Same name'])
  const innings = { ...base, batting: base.batting.map((b, i) => ({ ...b, playerId: i ? 'Rao' : 'Mehta', runs: i ? 4 : 19 })), bowling: [{ name: 'Same name', playerId: 'Rao', balls: 6, runs: 9, wickets: 1, maidens: 0, wides: 0, noBalls: 0 }] }
  recordPlayerMatch('same-name-match', [innings], profiles)
  assert.equal(getPlayerStats('Mehta').runs, 19); assert.equal(getPlayerStats('Rao').runs, 4)
  assert.equal(getPlayerStats('Mehta').wickets, 0); assert.equal(getPlayerStats('Rao').wickets, 1)
})
