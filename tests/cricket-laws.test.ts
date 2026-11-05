import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DELIVERIES, Delivery, FIELD_POSITIONS, FIELD_PRESETS, fieldPositions, positionName, type DeliveryKind,
} from '../src/cricket.ts'
import { judgeLbw } from '../src/laws.ts'
import { applyDelivery, newInnings, type DeliveryOutcome } from '../src/rules.ts'

const dot: DeliveryOutcome = {
  batRuns: 0, wide: 0, noBall: 0, byes: 0, legByes: 0,
  wicket: null, completedRuns: 0, reason: 'collected', contact: 'miss',
}

/** Play a delivery out with an optional stroke and report everything it produced. */
function play(seed: number, kind: DeliveryKind, options: {
  line?: number
  swingAt?: number
  shot?: { kind: 'defend' | 'loft' | 'hook' | 'cut' | 'drive'; aim?: number; power?: number }
  run?: (sim: Delivery) => void
  runningMode?: 'manual'
} = {}) {
  const sim = new Delivery({
    seed, kind, line: options.line, effort: 0.63,
    ...(options.runningMode ? { runningMode: options.runningMode } : {}),
  })
  while (!sim.outcome && sim.tick < 900) {
    if (options.swingAt !== undefined && sim.tick === sim.contactTick + options.swingAt) {
      sim.swing({ kind: options.shot?.kind ?? 'defend', aim: options.shot?.aim ?? 0, power: options.shot?.power ?? 0.7 })
    }
    options.run?.(sim)
    sim.step()
  }
  assert.ok(sim.outcome, 'the delivery must reach a dead ball')
  return { sim, outcome: sim.outcome }
}

test('the named fielding positions are real places on the ground', () => {
  assert.ok(FIELD_POSITIONS.length >= 20)
  const names = new Set(FIELD_POSITIONS.map((position) => position.name))
  assert.equal(names.size, FIELD_POSITIONS.length, 'every position has its own name')
  // The slips and third man sit on the off side behind the stumps, fine leg on
  // the leg side, and the ring positions square of the wicket.
  const slip = FIELD_POSITIONS.find((position) => position.name === 'Slip')!
  const fineLeg = FIELD_POSITIONS.find((position) => position.name === 'Fine Leg')!
  const thirdMan = FIELD_POSITIONS.find((position) => position.name === 'Third Man')!
  const midOff = FIELD_POSITIONS.find((position) => position.name === 'Mid Off')!
  assert.ok(slip.x > 0 && slip.z < 0, 'the slip stands behind the stumps on the off side')
  assert.ok(fineLeg.x < 0 && fineLeg.z < 0, 'fine leg stands behind the stumps on the leg side')
  assert.ok(thirdMan.x > 0 && thirdMan.z < 0, 'third man stands deep behind the stumps on the off side')
  assert.ok(midOff.x > 0 && midOff.z > 10, 'mid off stands straight down the ground on the off side')
  assert.equal(positionName({ x: 0.9, y: 0, z: -1.6 }), 'Slip')
  assert.equal(positionName({ x: -6.6, y: 0, z: -3.2 }), 'Fine Leg')
})

test('every field preset is a distinct set of nine named places', () => {
  const shapes = FIELD_PRESETS.map((preset) => JSON.stringify(fieldPositions(preset)))
  assert.equal(new Set(shapes).size, FIELD_PRESETS.length)
  for (const preset of FIELD_PRESETS) {
    const spots = fieldPositions(preset)
    assert.equal(spots.length, 9)
    for (const spot of spots) assert.ok(Number.isFinite(spot.x) && Number.isFinite(spot.z))
  }
})

test('a ball that strikes the pad can be given out leg before wicket', () => {
  let found = 0
  for (let seed = 0; seed < 120 && found < 1; seed++) {
    for (const kind of DELIVERIES) {
      const { sim, outcome } = play(seed, kind, { swingAt: -4, shot: { kind: 'hook' } })
      if (outcome.wicket === 'lbw') {
        found++
        assert.equal(outcome.contact, 'miss')
        assert.equal(outcome.padContact, true)
        assert.equal(sim.lbw?.out, true)
        // The appeal must satisfy the three point test.
        const decision = judgeLbw({
          pitchX: sim.pitchPoint?.x ?? null,
          impactX: sim.padImpact?.x ?? 0,
          batFirst: false,
          strokeOffered: Boolean(outcome.shotOffered),
          wouldHitStumps: true,
          portion: sim.lbw?.portion ?? 0,
        })
        assert.equal(decision.out, true)
      }
    }
  }
  assert.ok(found > 0, 'leg before wicket must be reachable')
})

test('a ball that pitches outside leg stump can never be leg before wicket', () => {
  const decision = judgeLbw({
    pitchX: -0.5, impactX: 0, batFirst: false, strokeOffered: true, wouldHitStumps: true, portion: 1,
  })
  assert.equal(decision.out, false)
  assert.equal(decision.reason, 'pitching-outside-leg')
})

test('a keeper fumble produces a bye, and a pad strike produces a leg bye', () => {
  let byes = 0
  let legByes = 0
  for (let seed = 0; seed < 400 && (byes === 0 || legByes === 0); seed++) {
    for (const kind of DELIVERIES) {
      const { outcome } = play(seed, kind, { swingAt: -4, shot: { kind: 'hook' } })
      if (outcome.byes) byes++
      if (outcome.legByes) legByes++
    }
  }
  assert.ok(byes > 0, 'byes must be reachable when the keeper fumbles')
  assert.ok(legByes > 0, 'leg byes must be reachable when the pad is struck')
})

test('attempting a run on a missed spinner is judged run-out at the wicket', () => {
  let stumped = 0
  for (let seed = 0; seed < 300 && stumped === 0; seed++) {
    for (const line of [-0.3, 0.1, 0.4]) {
      const { outcome } = play(seed, 'spin', {
        line, runningMode: 'manual',
        run: (sim) => { if (sim.tick === sim.contactTick) sim.setRunning(true) },
      })
      if (outcome.wicket === 'run-out') { stumped++; break }
    }
  }
  assert.ok(stumped > 0, 'keeper must run out a batter attempting a run')
})

test('a free hit still allows a run out but protects against every other dismissal', () => {
  let innings = newInnings(2, undefined, ['A', 'B'])
  innings = applyDelivery(innings, { ...dot, noBall: 1 })
  assert.equal(innings.freeHit, true)
  const protectedBall = applyDelivery(innings, { ...dot, wicket: 'lbw', reason: 'lbw' })
  assert.equal(protectedBall.wickets, 0, 'leg before wicket is not possible off a free hit')
  const runOut = applyDelivery(innings, { ...dot, wicket: 'run-out', reason: 'run-out', completedRuns: 1 })
  assert.equal(runOut.wickets, 1, 'a run out is still possible off a free hit')
})

test('the delivery is reproducible: the same seed and inputs give the same ball', () => {
  const first = play(41, 'length', { line: 0.2, swingAt: 2, shot: { kind: 'drive', power: 1 } })
  const second = play(41, 'length', { line: 0.2, swingAt: 2, shot: { kind: 'drive', power: 1 } })
  assert.deepEqual(first.outcome, second.outcome)
  assert.deepEqual(first.sim.ball, second.sim.ball)
})

test('the bowler is recorded so the scorecard can attribute the figures', () => {
  const sim = new Delivery({ seed: 41, kind: 'fast', bowler: 'Mehta' })
  while (!sim.outcome && sim.tick < 600) sim.step()
  assert.equal(sim.outcome?.bowler, 'Mehta')
})
