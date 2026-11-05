import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BOUNDARY, DELIVERIES, Delivery, FIELDERS, FIELD_PRESETS, fieldPositions, PITCH_LENGTH,
  PITCH_PRESETS, SHOT_ANGLES, SHOTS, WEATHER_PRESETS,
} from '../src/cricket.ts'
import type { DeliveryOptions, ShotInput } from '../src/cricket.ts'
import { applyDelivery, formatOvers, newInnings, outsideLimit, powerplayBalls, bowlerIndex } from '../src/rules.ts'
import type { DeliveryOutcome } from '../src/rules.ts'

const dot: DeliveryOutcome = {
  batRuns: 0, wide: 0, noBall: 0, byes: 0, legByes: 0,
  wicket: null, completedRuns: 0, reason: 'collected', contact: 'miss',
}

function resolve(options: DeliveryOptions, shot?: ShotInput, offset = 0) {
  const delivery = new Delivery(options)
  const trace = []
  let frame = 0
  while (delivery.phase !== 'dead' && frame++ < 1200) {
    if (shot && delivery.tick === delivery.contactTick + offset) assert.ok(delivery.swing(shot))
    delivery.step()
    trace.push({
      ball: { ...delivery.ball },
      fielders: delivery.fielders.map((fielder) => ({ ...fielder })),
      keeper: { ...delivery.keeper },
      action: delivery.action,
      grounded: delivery.grounded,
    })
  }
  assert.ok(delivery.outcome, 'delivery must reach a dead-ball outcome')
  return { delivery, trace, outcome: delivery.outcome }
}

test('same seed supports a miss, edge, middle, boundary and catch with deterministic replay', () => {
  const options = { seed: 41, kind: 'fast' } as const
  const drive = { kind: 'drive', aim: 0, power: 1 } as const
  const miss = resolve(options)
  const edge = resolve(options, drive, -6)
  const four = resolve(options, drive)
  const catchResult = resolve(options, { ...drive, aim: 0.94 })
  const six = resolve(options, { ...drive, kind: 'loft' })

  assert.equal(miss.outcome.contact, 'miss')
  assert.equal(edge.outcome.contact, 'edge')
  assert.equal(four.outcome.contact, 'middle')
  assert.equal(four.outcome.batRuns, 4)
  assert.equal(catchResult.outcome.wicket, 'caught')
  assert.equal(six.outcome.batRuns, 6)
  assert.deepEqual(four.trace, resolve(options, drive).trace)
  assert.deepEqual(catchResult.trace, resolve(options, { ...drive, aim: 0.94 }).trace)
  assert.deepEqual(edge.outcome, resolve(options, drive, -6).outcome)

  const ball = six.delivery.ball
  assert.ok(Math.abs(Math.hypot(ball.x, ball.z - PITCH_LENGTH / 2) - BOUNDARY) < 1e-9)
  assert.equal(six.delivery.grounded, false)
  assert.equal(four.delivery.grounded, true)
})

test('delivery presets differ in flight and a yorker hits a distinct, low contact point', () => {
  const releases = DELIVERIES.map((kind) => new Delivery({ seed: 5, kind }))
  const [fast, length, yorker, spin] = releases
  assert.ok(fast && length && yorker && spin)
  assert.ok(yorker.projectedContact.y < length.projectedContact.y)
  assert.ok(length.projectedContact.y < fast.projectedContact.y)
  assert.ok(spin.contactTick > length.contactTick)
  assert.ok(fast.contactTick < length.contactTick)
  assert.equal(FIELDERS.length, 9)
})

test('all eight deliveries reach the bat with distinct pace, height or line', () => {
  const releases = DELIVERIES.map((kind) => new Delivery({ seed: 41, kind, line: 0 }))
  const [fast, , , spin, inswing, outswing, bouncer, legspin] = releases
  assert.equal(releases.length, 8)
  assert.equal(new Set(releases.map(({ contactTick, projectedContact }) => JSON.stringify([contactTick, projectedContact]))).size, 8)
  assert.ok(inswing.projectedContact.x < 0 && outswing.projectedContact.x > 0)
  assert.ok(bouncer.projectedContact.y > fast.projectedContact.y)
  assert.ok(legspin.projectedContact.x < 0 && spin.projectedContact.x > 0)
  assert.equal(legspin.keeper.z, spin.keeper.z)
})

test('every attacking technique has a distinct launch on a suitable delivery', () => {
  const playable = SHOTS.filter(k => k !== 'duck' && k !== 'leave')
  const launches = playable.map(kind => {
    for (const bowling of DELIVERIES) {
      const delivery = new Delivery({ seed: 41, kind: bowling, line: 0 })
      while (delivery.tick < delivery.contactTick) delivery.step()
      delivery.swing({ kind, aim: 0, power: 1 })
      while (delivery.contact === null && !delivery.outcome) delivery.step()
      if (delivery.contact === 'middle') return JSON.stringify(delivery.velocity)
    }
    assert.fail(`No suitable delivery for ${kind}`)
  })
  assert.equal(SHOTS.length, 31)
  assert.equal(new Set(launches).size, playable.length)
})

test('pitch, weather and field presets change the seeded match physics', () => {
  const pitches = PITCH_PRESETS.map((pitch) => new Delivery({ seed: 41, kind: 'spin', line: 0, pitch }))
  const weather = WEATHER_PRESETS.map((condition) => new Delivery({ seed: 41, kind: 'outswing', line: 0, weather: condition }))
  const [dry, , hard, dusty] = pitches
  assert.ok(dusty.projectedContact.y < dry.projectedContact.y && hard.projectedContact.y > dry.projectedContact.y)
  assert.equal(new Set(weather.map((delivery) => delivery.projectedContact.x)).size, 3)

  const formations = FIELD_PRESETS.map((field) => fieldPositions(field))
  assert.equal(new Set(formations.map((fielders) => JSON.stringify(fielders))).size, FIELD_PRESETS.length)
  assert.ok(formations.every((fielders) => fielders.length === 9 && fielders.every(({ x, z }) =>
    Math.hypot(x / 57, (z - PITCH_LENGTH / 2) / 64) < 1)))
  const shot = { kind: 'drive', aim: 0.3, power: 1 } as const
  assert.equal(resolve({ seed: 41, kind: 'fast', field: 'attack' }, shot).outcome.batRuns, 4)
  assert.equal(resolve({ seed: 41, kind: 'fast', field: 'boundary' }, shot).outcome.reason, 'fielded')
  const settings = { seed: 41, kind: 'fast', pitch: 'green', weather: 'breezy', field: 'boundary' } as const
  assert.deepEqual(resolve(settings, shot).trace, resolve(settings, shot).trace)
})

test('venue rope crossings use the configured ellipse', () => {
  const options = { seed: 41, kind: 'fast' } as const
  const shot = { kind: 'loft', aim: Math.PI / 2, power: 1 } as const
  const circle = resolve(options, shot)
  const oval = resolve({ ...options, boundary: { x: 57, z: 64 } }, shot)
  const { x, z } = oval.delivery.ball
  assert.ok(oval.delivery.tick < circle.delivery.tick)
  assert.ok(Math.abs(Math.hypot(x / 57, (z - PITCH_LENGTH / 2) / 64) - 1) < 1e-9)
  assert.equal(oval.outcome.batRuns, 6)
  assert.deepEqual(resolve({ ...options, boundary: { x: NaN, z: 64 } }, shot).trace, circle.trace)
})

test('keeper, fielder chase and throw are stepped before the ball is scored', () => {
  const options = { seed: 41, kind: 'fast' } as const
  const missed = resolve(options)
  assert.equal(missed.outcome.reason, 'collected')
  assert.ok(Math.abs(missed.delivery.keeper.x) > 0.25)

  const fielded = resolve(options, { kind: 'drive', aim: 0.44, power: 1 })
  assert.equal(fielded.outcome.reason, 'fielded')
  assert.ok(fielded.trace.some((frame) => frame.action === 'pickup'))
  assert.ok(fielded.trace.some((frame) => frame.action === 'return'))
  const fielder = fielded.delivery.fielders[fielded.delivery.activeFielder]
  assert.ok(fielder)
  assert.notDeepEqual(fielder, FIELDERS[fielded.delivery.activeFielder])
  assert.equal(fielded.delivery.swing({ kind: 'drive', aim: 0 }), false)
})

test('an untouched wide is illegal and a no-ball or free hit cannot be bowled or caught', () => {
  const wide = resolve({ seed: 41, kind: 'fast', line: 1.4 }).outcome
  const noBall = resolve({ seed: 6, kind: 'length', line: 0, effort: 1 }).outcome
  const bowled = resolve({ seed: 6, kind: 'length', line: 0 }).outcome
  const freeHit = resolve({ seed: 6, kind: 'length', line: 0, freeHit: true }).outcome
  assert.equal(wide.wide, 1)
  assert.equal(noBall.reason, 'bowled')
  assert.equal(noBall.noBall, 1)
  assert.equal(noBall.wicket, null)
  assert.equal(bowled.wicket, 'bowled')
  assert.equal(freeHit.reason, 'bowled')
  assert.equal(freeHit.wicket, null)
  const catchOnFreeHit = resolve(
    { seed: 41, kind: 'fast', freeHit: true },
    { kind: 'drive', aim: 0.94, power: 1 },
  ).outcome
  assert.equal(catchOnFreeHit.wicket, null)
  assert.equal(catchOnFreeHit.reason, 'fielded')
})

test('six legal balls per over, extras, free hit carry and alternating strike', () => {
  let innings = newInnings()
  for (let i = 0; i < 5; i++) innings = applyDelivery(innings, dot)
  assert.equal(formatOvers(innings.legalBalls), '0.5')
  innings = applyDelivery(innings, { ...dot, noBall: 1, batRuns: 1, completedRuns: 1 })
  assert.equal(innings.striker, 2)
  assert.equal(innings.freeHit, true)
  for (let i = 0; i < 2; i++) innings = applyDelivery(innings, { ...dot, wide: 1 })
  assert.equal(innings.freeHit, true)
  innings = applyDelivery(innings, { ...dot, wicket: 'bowled' })
  assert.equal(innings.attempts, 9)
  assert.equal(innings.runs, 4)
  assert.deepEqual(innings.extras, { wide: 2, noBall: 1, byes: 0, legByes: 0, penalty: 0 })
  assert.equal(formatOvers(innings.legalBalls), '1.0')
  assert.equal(innings.wickets, 0)
  assert.equal(innings.freeHit, false)
  assert.equal(innings.striker, 1)
})

test('the innings ends at the legal ball cap, ten wickets, or a successful chase', () => {
  let twoOvers = newInnings()
  for (let i = 0; i < 12; i++) twoOvers = applyDelivery(twoOvers, dot)
  assert.equal(twoOvers.complete, true)
  assert.equal(formatOvers(twoOvers.legalBalls), '2.0')
  assert.strictEqual(applyDelivery(twoOvers, { ...dot, batRuns: 6 }), twoOvers)

  let allOut = newInnings()
  for (let i = 0; i < 10; i++) allOut = applyDelivery(allOut, { ...dot, wicket: 'bowled' })
  assert.equal(allOut.complete, true)
  assert.equal(allOut.wickets, 10)

  const chase = applyDelivery(newInnings(2, 4), { ...dot, batRuns: 4, contact: 'middle' })
  assert.equal(chase.complete, true)
  assert.equal(chase.legalBalls, 1)
  assert.equal(chase.runs, 4)
})

test('300 seeded deliveries settle and score consistently from canonical event history', () => {
  let innings = newInnings()
  for (let seed = 0; seed < 300; seed++) {
    if (innings.complete) innings = newInnings()
    const kind = DELIVERIES[seed % DELIVERIES.length] ?? 'fast'
    const shot = SHOTS[seed % SHOTS.length]
    const result = resolve(
      {
        seed, kind, line: (seed % 17 - 8) / 5, effort: (seed % 13) / 12, freeHit: innings.freeHit,
        field: FIELD_PRESETS[seed % FIELD_PRESETS.length], pitch: PITCH_PRESETS[seed % PITCH_PRESETS.length],
        weather: WEATHER_PRESETS[seed % WEATHER_PRESETS.length],
      },
      { kind: shot, aim: SHOT_ANGLES[shot], power: 0.7 },
      seed % 13 - 9,
    )
    innings = applyDelivery(innings, result.outcome)
    const history = innings.history
    const recomputed = history.reduce((runs, ball) =>
      runs + ball.batRuns + ball.wide + ball.noBall + ball.byes + ball.legByes +
      (ball.overthrowRuns ?? 0) + (ball.penalty ?? 0), 0)
    assert.equal(innings.runs, recomputed)
    assert.equal(innings.legalBalls, history.filter((ball) => !ball.wide && !ball.noBall).length)
    assert.equal(innings.wickets, history.filter((ball) => ball.wicket).length)
    assert.ok(innings.runs >= 0 && innings.legalBalls <= 12 && innings.wickets <= 10)
  }
})


test('powerplay table, field caps and five-bowler rotation hold for 2–20 overs', () => {
  assert.equal(powerplayBalls(5), 9)
  assert.equal(powerplayBalls(20), 36)
  for (let overs = 2; overs <= 20; overs++) {
    const bowlerOvers = [0, 0, 0, 0, 0]
    for (let over = 0; over < overs; over++) {
      const index = bowlerIndex(over * 6)
      bowlerOvers[index]++
      if (over) assert.notEqual(index, bowlerIndex((over - 1) * 6))
    }
    assert.ok(bowlerOvers.every((count) => count <= Math.ceil(overs / 5)))
    for (const ball of [0, powerplayBalls(overs) - 1, powerplayBalls(overs), overs * 6 - 1]) {
      const cap = outsideLimit(overs, ball)
      for (const field of FIELD_PRESETS) {
        const sim = new Delivery({ seed: 41, kind: 'fast', field, maxOutside: cap })
        const outside = sim.fielders.filter((spot) => {
          const end = Math.max(0, Math.min(PITCH_LENGTH, spot.z))
          return Math.hypot(spot.x, spot.z - end) > 27.43
        })
        assert.ok(outside.length <= cap)
      }
    }
  }
})
