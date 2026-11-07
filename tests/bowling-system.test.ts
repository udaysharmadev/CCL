import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Delivery, type DeliveryOptions } from '../src/cricket.ts'
import { defaultPlayerProfile } from '../src/player-profile.ts'
import { BOWLING_VARIATIONS, availableVariations, bowlingKind, bowlingReleasePoint, chooseAIDelivery, createBowlingExecution, type BowlingControls, type BowlingVariation } from '../src/bowling.ts'
import { DeliveryReplay } from '../src/delivery-replay.ts'
import { applyDelivery, type DeliveryOutcome } from '../src/rules.ts'
import { activeOverBowler, availableBatters, bowlerEligibility, chooseAIBowler, chooseNextBatter, chooseOpeningPair, createManagedInnings, needsBowlerSelection } from '../src/match-selection.ts'

function options(id = 'Rao', variation: BowlingVariation = 'stock', controls: Partial<BowlingControls> = {}, seed = 41): DeliveryOptions {
  const p = defaultPlayerProfile(id)
  const bowling = createBowlingExecution(p, { variation, line: .1, length: BOWLING_VARIATIONS[variation].length,
    power: .8, release: .95, movement: .8, side: 'over', batterHand: 'right', ...controls })
  return { seed, kind: bowlingKind(bowling), bowling, bowler: p.identity.displayName, bowlerId: p.id, runningMode: 'manual' }
}
const players = ['Mehta', 'Rao', 'Singh', 'Iyer', 'Patel', 'Khan', 'Shah', 'Gill', 'Das', 'Reddy', 'Joshi'].map(defaultPlayerProfile)
const dot: DeliveryOutcome = { batRuns: 0, wide: 0, noBall: 0, byes: 0, legByes: 0, wicket: null, completedRuns: 0, reason: 'collected', contact: 'miss', bowler: 'Rao', bowlerId: 'Rao' }
const managed = (overs = 5, target?: number) => createManagedInnings(overs, target, players)

for (const [id, family] of [['Rao', 'pace'], ['Sen', 'pace'], ['Das', 'pace'], ['Patel', 'spin'], ['Shah', 'spin'], ['Dutt', 'spin'], ['Joshi', 'spin']] as const) {
  test(`${id} exposes only compatible ${family} variations and each settles reproducibly`, () => {
    const variants = availableVariations(defaultPlayerProfile(id))
    assert.ok(variants.length >= 4)
    assert.ok(variants.every(v => v.family === family))
    for (const v of variants.filter(v => !v.locked)) {
      const input = options(id, v.id)
      const first = new Delivery(input), second = new Delivery(JSON.parse(JSON.stringify(input)))
      for (let tick = 0; tick < 1200 && !first.outcome; tick++) { first.step(); second.step(); assert.deepEqual(first.ball, second.ball) }
      assert.ok(first.outcome, `${id}/${v.id} must settle`)
      assert.deepEqual(first.outcome, second.outcome)
      assert.equal(first.outcome.bowlerId, id)
    }
  })
}

test('none cannot bowl; occasional capability remains usable, and specialist deliveries show requirements', () => {
  assert.equal(availableVariations(defaultPlayerProfile('Mehta')).length, 0)
  assert.ok(availableVariations(defaultPlayerProfile('Singh')).some(v => !v.locked))
  const p = defaultPlayerProfile('Patel'); p.bowling.variationMastery = 40
  assert.match(availableVariations(p).find(v => v.id === 'doosra')!.reason, /75/)
  assert.throws(() => createBowlingExecution(p, { ...options('Patel', 'off-break').bowling!, variation: 'doosra' }), /75/)
  assert.throws(() => options('Patel', 'stock'), /incompatible/)
  assert.throws(() => options('Dutt', 'doosra'), /incompatible/)
})

test('malformed controls, missing ratings and snapshot-kind mismatches are rejected', () => {
  for (const bad of [{ line: NaN }, { length: 30 }, { power: 2 }, { release: -.1 }, { movement: Infinity }, { workload: -1 }]) assert.throws(() => options('Rao', 'stock', bad))
  const p = defaultPlayerProfile('Rao'); delete (p.bowling as Partial<typeof p.bowling>).accuracy
  assert.throws(() => createBowlingExecution(p, options().bowling!))
  assert.throws(() => new Delivery({ ...options(), kind: 'spin' }), /disagree/)
  const corrupted = JSON.parse(JSON.stringify(options())); corrupted.bowling.version = 9
  assert.throws(() => new Delivery(corrupted), /snapshot/)
})

test('execution snapshots survive player editing without changing recorded flight', () => {
  const p = defaultPlayerProfile('Rao'), input = options().bowling!
  const b = createBowlingExecution(p, input)
  const before = new Delivery({ seed: 19, kind: bowlingKind(b), bowling: b })
  p.bowling.maxPace = 120; p.bowling.arm = 'left'; p.identity.displayName = 'Edited'
  const after = new Delivery({ seed: 19, kind: bowlingKind(b), bowling: b })
  assert.deepEqual(before.release, after.release)
  assert.ok(Object.isFrozen(b.attributes))
})

for (const arm of ['right', 'left'] as const) for (const hand of ['right', 'left'] as const) for (const side of ['over', 'around'] as const) {
  test(`${arm}-arm ${side} the wicket vs ${hand}-hand batter has the correct release and off-side target`, () => {
    const p = defaultPlayerProfile('Rao'); p.bowling.arm = arm
    const b = createBowlingExecution(p, { ...options().bowling!, line: .75, batterHand: hand, side })
    const d = new Delivery({ seed: 19, kind: bowlingKind(b), bowling: b })
    assert.deepEqual(d.release.position, bowlingReleasePoint(b))
    assert.equal(Math.sign(d.release.position.x), (arm === 'right' ? 1 : -1) * (side === 'over' ? 1 : -1))
    assert.ok(d.pitchPoint)
    assert.equal(Math.sign(d.pitchPoint.x), hand === 'right' ? 1 : -1)
    assert.ok(Math.abs(d.pitchPoint.x * (hand === 'right' ? 1 : -1) - .75) < .4)
  })
}

test('pace, medium pace, slower ball and spin have physically distinct speeds', () => {
  const fast = new Delivery(options()), medium = new Delivery(options('Sen')), slower = new Delivery(options('Rao', 'slower-ball')), spin = new Delivery(options('Patel', 'off-break'))
  assert.ok(-fast.velocity.z > -medium.velocity.z + 5)
  assert.ok(-fast.velocity.z > -slower.velocity.z + 8)
  assert.ok(spin.contactTick > fast.contactTick + 15)
  const soft = new Delivery(options('Rao', 'stock', { power: .1 }))
  assert.ok(-soft.velocity.z < -fast.velocity.z)
})

test('target length changes actual bounce, yorker and bouncer height', () => {
  const lengths = [.85, 3, 6.2, 8.5, 11.4]
  const balls = lengths.map(length => new Delivery(options('Rao', 'stock', { length, release: 1 })))
  balls.forEach((d, i) => assert.ok(Math.abs(d.pitchPoint!.z - lengths[i]) < .7))
  assert.ok(new Delivery(options('Rao', 'bouncer')).projectedContact.y > 1.1)
  assert.ok(new Delivery(options('Rao', 'yorker')).projectedContact.y < .25)
})

test('poor release and low accuracy widen measured target error across seeds', () => {
  const error = (release: number, accuracy: number) => Array.from({ length: 60 }, (_, seed) => {
    const p = defaultPlayerProfile('Rao'); p.bowling.accuracy = accuracy
    const b = createBowlingExecution(p, { ...options().bowling!, release })
    const d = new Delivery({ seed, kind: bowlingKind(b), bowling: b })
    return Math.abs(d.pitchPoint!.x - b.line)
  }).reduce((a, b) => a + b, 0)
  assert.ok(error(.05, 20) > error(1, 95) * 2)
})

test('googly/doosra turn opposite to their stock ball; top-spinner, slider and flipper change bounce', () => {
  const ball = (id: string, variation: BowlingVariation) => new Delivery(options(id, variation, { line: 0, length: 5.5 }))
  assert.ok(ball('Shah', 'leg-break').projectedContact.x > ball('Shah', 'googly').projectedContact.x + .3)
  assert.ok(ball('Patel', 'doosra').projectedContact.x > ball('Patel', 'off-break').projectedContact.x + .3)
  assert.ok(ball('Shah', 'top-spinner').projectedContact.y > ball('Shah', 'slider').projectedContact.y + .3)
  assert.ok(ball('Shah', 'slider').projectedContact.y > ball('Shah', 'flipper').projectedContact.y)
  assert.ok(ball('Joshi', 'leg-break').projectedContact.x < ball('Joshi', 'googly').projectedContact.x)
})

test('swing, seam cutters and flight controls affect the actual trajectory', () => {
  const input = { line: 0, length: 5.5 }
  const inswing = new Delivery(options('Rao', 'inswing', input)), out = new Delivery(options('Rao', 'outswing', input))
  assert.ok(out.projectedContact.x > inswing.projectedContact.x)
  const off = new Delivery(options('Rao', 'off-cutter', input)), leg = new Delivery(options('Rao', 'leg-cutter', input))
  assert.ok(leg.projectedContact.x > off.projectedContact.x + .1)
  const loop = new Delivery(options('Patel', 'off-break', { movement: 1 })), flat = new Delivery(options('Patel', 'off-break', { movement: 0 }))
  assert.ok(loop.contactTick > flat.contactTick)
  assert.notEqual(loop.release.velocity.y, flat.release.velocity.y)
})

test('new bowling input replays with ordered shots/runs and never re-reads profiles', () => {
  const input = options('Patel', 'off-break'), direct = new Delivery(input)
  while (direct.tick < direct.contactTick) direct.step()
  const command = { type: 'swing' as const, seq: 1, tick: direct.tick, input: { kind: 'drive' as const, aim: .3, power: .8 } }
  direct.swing(command.input)
  while (!direct.outcome && direct.tick < 1200) direct.step()
  const replay = new DeliveryReplay({ options: JSON.parse(JSON.stringify(input)), version: 2, commands: [command] })
  assert.equal(replay.advanceTo(direct.tick), true)
  assert.deepEqual(replay.sim.outcome, direct.outcome)
  assert.deepEqual(replay.sim.ball, direct.ball)
})

test('bad execution can overstep and wides remain illegal in new simulation', () => {
  let noBalls = 0
  for (let seed = 0; seed < 90; seed++) {
    const d = new Delivery(options('Rao', 'stock', { power: 1, release: 0 }, seed))
    while (!d.outcome && d.tick < 1200) d.step()
    if (d.outcome?.noBall) noBalls++
  }
  assert.ok(noBalls > 0)
  const d = new Delivery(options('Rao', 'stock', { line: 1.4, release: 1 }))
  while (!d.outcome && d.tick < 1200) d.step()
  assert.equal(d.outcome?.wide, 1)
})

test('openers are distinct, preserve IDs, and cannot be changed after the first ball', () => {
  const s = chooseOpeningPair(managed(), 8, 3)
  assert.equal(s.batting[s.striker - 1].playerId, 'Gill')
  assert.equal(s.batting[s.nonStriker - 1].playerId, 'Singh')
  assert.throws(() => chooseOpeningPair(s, 3, 3))
  assert.throws(() => chooseOpeningPair(applyDelivery(s, dot), 1, 2))
})

for (const dismissedBatter of ['striker', 'nonStriker'] as const) for (const overEnd of [false, true]) {
  test(`managed ${dismissedBatter} run-out${overEnd ? ' ending an over' : ''} pauses for the correct replacement`, () => {
    let s = chooseOpeningPair(managed(), 8, 3)
    if (overEnd) for (let i = 0; i < 5; i++) s = applyDelivery(s, dot)
    const survivor = dismissedBatter === 'striker' ? 3 : 8
    s = applyDelivery(s, { ...dot, wicket: 'run-out', reason: 'run-out', dismissedBatter, completedRuns: 1, batRuns: 1 })
    assert.ok(s.selection?.pendingBatter)
    assert.ok([s.striker, s.nonStriker].includes(survivor))
    assert.ok([s.striker, s.nonStriker].includes(0))
    assert.throws(() => applyDelivery(s, dot), /incoming/)
    assert.equal(availableBatters(s).includes(dismissedBatter === 'striker' ? 8 : 3), false)
    s = chooseNextBatter(s, 1)
    assert.equal(s.selection?.pendingBatter, null)
    assert.ok([s.striker, s.nonStriker].includes(1))
    assert.ok([s.striker, s.nonStriker].includes(survivor))
  })
}

test('custom opener order reaches ten wickets without reusing an entered player', () => {
  let s = chooseOpeningPair(managed(20), 8, 3)
  for (let i = 0; i < 10; i++) {
    s = applyDelivery(s, { ...dot, wicket: 'bowled', reason: 'bowled' })
    if (!s.complete) s = chooseNextBatter(s, availableBatters(s)[0])
  }
  assert.equal(s.wickets, 10); assert.equal(s.complete, true); assert.equal(s.selection?.pendingBatter, null)
  assert.equal(s.batting.filter(b => b.dismissed).length, 10)
})

test('innings ending mid-over never requests a replacement or next bowler', () => {
  const s = applyDelivery(managed(5, 1), { ...dot, batRuns: 1, completedRuns: 1, wicket: 'run-out', reason: 'run-out' })
  assert.equal(s.complete, true)
  assert.equal(s.selection?.pendingBatter, null)
  assert.equal(needsBowlerSelection(s), false)
  assert.equal(chooseAIBowler(players, s, 'right'), null)
})

test('bowler selection waits for six legal balls; illegal balls lock the current over', () => {
  let s = managed()
  assert.equal(needsBowlerSelection(s), true)
  assert.equal(needsBowlerSelection(s, { playerId: 'Rao', over: 0 }), false)
  for (let i = 0; i < 5; i++) s = applyDelivery(s, dot)
  for (const extra of [{ wide: 1 }, { noBall: 1 }]) {
    s = applyDelivery(s, { ...dot, ...extra })
    assert.equal(needsBowlerSelection(s), false)
    assert.equal(activeOverBowler(s), 'Rao')
    assert.match(bowlerEligibility(defaultPlayerProfile('Khan'), s).reason, /finish/)
  }
  s = applyDelivery(s, dot)
  assert.equal(needsBowlerSelection(s, { playerId: 'Rao', over: 0 }), true)
  assert.match(bowlerEligibility(defaultPlayerProfile('Rao'), s).reason, /consecutive/)
  s = applyDelivery(s, { ...dot, bowlerId: 'Khan', bowler: 'Khan', wide: 1 })
  assert.equal(activeOverBowler(s), 'Khan')
  assert.equal(needsBowlerSelection(s), false)
})

test('AI respects legal selection and quotas across every 2–20-over format', () => {
  for (let overs = 2; overs <= 20; overs++) {
    let s = managed(overs), previous: string | null = null
    for (let over = 0; over < overs; over++) {
      const p = chooseAIBowler(players, s, over % 2 ? 'left' : 'right')
      assert.ok(p, `${overs} overs, over ${over} needs a legal bowler`)
      assert.notEqual(p.id, previous)
      assert.ok(bowlerEligibility(p, s).eligible)
      for (let ball = 0; ball < 6; ball++) s = applyDelivery(s, { ...dot, bowlerId: p.id, bowler: p.identity.displayName })
      previous = p.id
    }
    assert.ok(s.bowling.every(b => b.balls <= Math.ceil(overs / 5) * 6))
    assert.equal(s.complete, true)
  }
})

test('AI delivery decisions stay within capabilities, use death yorkers and vary spin', () => {
  let s = managed(5)
  for (let i = 0; i < 20; i++) s = applyDelivery(s, dot)
  const death = chooseAIDelivery(defaultPlayerProfile('Rao'), s, 41, 'left')
  assert.equal(death.variation, 'yorker')
  const first = chooseAIDelivery(defaultPlayerProfile('Shah'), s, 19, 'left')
  const next = chooseAIDelivery(defaultPlayerProfile('Shah'), s, 19, 'left', first.variation)
  assert.notEqual(next.variation, first.variation)
  assert.ok(availableVariations(defaultPlayerProfile('Shah')).some(v => v.id === next.variation && !v.locked))
})

test('same display name never merges stable bowler identities', () => {
  const s = applyDelivery(applyDelivery(managed(), { ...dot, bowler: 'Alex', bowlerId: 'Rao' }), { ...dot, bowler: 'Alex', bowlerId: 'Khan' })
  assert.equal(s.bowling.length, 2)
  assert.deepEqual(s.bowling.map(b => b.playerId), ['Rao', 'Khan'])
})

test('batting power changes struck speed while the recorded shot input stays exact', () => {
  const run = (power: number) => {
    const batting = { ...defaultPlayerProfile('Gill').batting, power, technique: 100, shotControl: 100, consistency: 100 }
    const d = new Delivery({ seed: 41, kind: 'fast', line: 0, batting })
    while (d.tick < d.contactTick) d.step()
    const input = { kind: 'drive' as const, aim: .2, power: .8 }
    assert.ok(d.swing(input))
    while (d.contact === null && !d.outcome) d.step()
    assert.deepEqual(input, { kind: 'drive', aim: .2, power: .8 })
    assert.equal(d.contact, 'middle')
    return Math.hypot(d.velocity.x, d.velocity.z)
  }
  assert.ok(run(100) > run(20) * 1.3)
})

test('batting timing, technique and consistency alter the contact window', () => {
  const run = (rating: number) => {
    const batting = { ...defaultPlayerProfile('Gill').batting, timing: rating, skill: rating, technique: rating, consistency: rating, shotControl: 100 }
    const d = new Delivery({ seed: 41, kind: 'fast', line: 0, batting })
    while (d.tick < d.contactTick + 3) d.step()
    d.swing({ kind: 'drive', aim: 0, power: .6 })
    while (d.contactEventTick === null && !d.outcome) d.step()
    return d.timing
  }
  assert.equal(run(100), 'good')
  assert.equal(run(20), 'late')
})

test('fielder agility, reflexes, pickup and throwing ratings change live collection and return timing', () => {
  const run = (rating: number) => {
    const f = defaultPlayerProfile('Iyer').fielding
    for (const key of Object.keys(f) as (keyof typeof f)[]) f[key] = rating
    const d = new Delivery({ seed: 41, kind: 'length', line: .2, runningMode: 'manual', fielding: { fielders: Array.from({ length: 9 }, () => ({ ...f })), keeper: { ...f } } })
    let pickup = 0, returning = 0
    while (!d.outcome && d.tick < 1200) {
      if (d.tick === d.contactTick) d.swing({ kind: 'defend', aim: .4, power: .7 })
      d.step()
      if (!pickup && d.action === 'pickup') pickup = d.tick
      if (!returning && d.action === 'return') returning = d.tick
    }
    assert.equal(d.outcome?.reason, 'fielded')
    assert.ok(pickup > 0 && returning > pickup)
    return { pickup, returning, tick: d.tick }
  }
  const quick = run(100), slow = run(20)
  assert.ok(quick.pickup < slow.pickup)
  assert.ok(quick.returning - quick.pickup < slow.returning - slow.pickup)
  assert.ok(quick.tick - quick.returning < slow.tick - slow.returning)
})

test('batting and fielding snapshots reject invalid ratings and incomplete field teams', () => {
  assert.throws(() => new Delivery({ seed: 41, kind: 'fast', batting: { ...defaultPlayerProfile('Gill').batting, timing: NaN } }), /batting/)
  assert.throws(() => new Delivery({ seed: 41, kind: 'fast', fielding: { fielders: [], keeper: defaultPlayerProfile('Iyer').fielding } }), /fielding/)
  const p = defaultPlayerProfile('Patel'); p.bowling.arm = 'left'
  assert.throws(() => createBowlingExecution(p, options('Patel', 'off-break').bowling!), /arm/)
  const medium = defaultPlayerProfile('Sen'); medium.bowling.maxPace = 151
  assert.throws(() => createBowlingExecution(medium, options('Sen').bowling!), /pace/)
})

test('a new bouncer above head height is a no-ball and cannot dismiss the batter', () => {
  const d = new Delivery({ ...options('Rao', 'bouncer', { length: 12.5, power: .9, release: 1 }), pitch: 'hard' })
  assert.ok(d.projectedContact.y > 1.85)
  while (!d.outcome && d.tick < 1200) d.step()
  assert.equal(d.outcome?.noBall, 1)
  assert.equal(d.outcome?.noBallReason, 'dangerous-delivery')
  assert.equal(d.outcome?.wicket, null)
  assert.match(d.bowlingFeedback!.details, /head height/)
})

test('selection reserves a legal final rotation instead of stranding the last bowler', () => {
  const pool = ['Rao', 'Patel', 'Khan', 'Shah', 'Das'].map(defaultPlayerProfile)
  let s = managed(10)
  for (const id of ['Rao', 'Patel', 'Khan', 'Shah', 'Rao', 'Patel', 'Khan']) {
    for (let i = 0; i < 6; i++) s = applyDelivery(s, { ...dot, bowler: id, bowlerId: id })
  }
  assert.equal(bowlerEligibility(pool[3], s).eligible, true, 'The immediate quota alone appears legal')
  assert.match(bowlerEligibility(pool[3], s, pool).reason, /remaining overs/)
  assert.equal(bowlerEligibility(pool[4], s, pool).eligible, true)
  for (let over = 7; over < 10; over++) {
    const p = chooseAIBowler(pool, s, 'right'); assert.ok(p)
    for (let i = 0; i < 6; i++) s = applyDelivery(s, { ...dot, bowler: p.id, bowlerId: p.id })
  }
  assert.equal(s.complete, true)
  assert.ok(s.bowling.every(b => b.balls === 12))
})

test('AI workload uses stable IDs even when another display name equals that ID', () => {
  const p = defaultPlayerProfile('Rao')
  const s = applyDelivery(managed(), { ...dot, bowler: 'Rao', bowlerId: 'Khan' })
  assert.equal(chooseAIDelivery(p, s, 41, 'right').workload, 0)
})

test('all variations honor configured maximum pace and the minimum bowling skill', () => {
  for (const id of ['Rao', 'Sen', 'Shah', 'Patel']) {
    const p = defaultPlayerProfile(id)
    for (const v of availableVariations(p).filter(v => !v.locked)) {
      const d = new Delivery(options(id, v.id, { power: 1, release: 1, movement: 0 }))
      assert.ok(-d.release.velocity.z * 3.6 <= p.bowling.maxPace + 1e-9, `${id}/${v.id} exceeded the configured maximum`)
    }
  }
  const p = defaultPlayerProfile('Rao'); p.bowling.skill = 19
  assert.equal(availableVariations(p).length, 0)
  assert.throws(() => createBowlingExecution(p, options().bowling!))
})
