import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Delivery, PITCH_LENGTH, type DeliveryOptions } from '../src/cricket.ts'
import { DeliveryReplay } from '../src/delivery-replay.ts'
import { applyDelivery, newInnings, type Innings } from '../src/rules.ts'

// This seed naturally fumbles a missed fast ball at tick 49. Assisted running
// starts eighteen ticks later; the automatic return ends the delivery at 87.
const options: DeliveryOptions = { seed: 13, kind: 'fast', line: .4, effort: .63 }
const nearCrease = 1.22
const farCrease = PITCH_LENGTH - nearCrease

function fumble(overrides: Partial<DeliveryOptions> = {}) {
  const sim = new Delivery({ ...options, ...overrides })
  while (sim.tick < 49 && !sim.outcome) sim.step()
  assert.equal(sim.tick, 49)
  assert.equal(sim.parried, true)
  assert.equal(sim.phase, 'field')
  assert.equal(sim.action, 'chase')
  assert.equal(sim.contact, 'miss')
  assert.equal(sim.padContact, false)
  assert.equal(sim.outcome, null)
  return sim
}

function stepTo(sim: Delivery, tick: number) {
  while (sim.tick < tick && !sim.outcome) sim.step()
  assert.equal(sim.tick, tick)
}

function finish(sim: Delivery, innings: Innings = newInnings()) {
  while (!sim.outcome && sim.tick < 1500) sim.step()
  assert.ok(sim.outcome, 'the production delivery must finish')
  return applyDelivery(innings, sim.outcome)
}

test('H3: a keeper fumble cannot complete a run or exchange the batters ends', () => {
  const sim = fumble()
  assert.equal(sim.runnerProgress, 0)
  assert.equal(sim.partnerProgress, 0)
  assert.equal(sim.completedRuns, 0, 'neither batter has traversed the pitch')
  assert.deepEqual(sim.runnerPositions, [nearCrease, farCrease - sim.backedUp])
})

test('H3: finalization excludes the incomplete run after the keeper fumble', () => {
  const sim = fumble()
  const innings = finish(sim)
  assert.equal(sim.tick, 87)
  assert.ok(sim.runnerProgress > 0 && sim.runnerProgress < .5)
  assert.ok(sim.partnerProgress > 0 && sim.partnerProgress < .5)
  assert.equal(sim.outcome?.reason, 'fielded')
  assert.equal(sim.outcome?.completedRuns, 0)
  assert.equal(sim.outcome?.byes, 0)
  assert.equal(innings.runs, 0)
  assert.equal(innings.wickets, 0)
  assert.deepEqual([innings.striker, innings.nonStriker], [1, 2])
})

test('a fumble with assisted running stopped scores no run', () => {
  const sim = fumble()
  assert.ok(sim.setRunning(false))
  const innings = finish(sim)
  assert.equal(sim.runnerProgress, 0)
  assert.equal(sim.partnerProgress, 0)
  assert.equal(sim.completedRuns, 0)
  assert.equal(sim.outcome?.byes, 0)
  assert.equal(innings.runs, 0)
  assert.deepEqual([innings.striker, innings.nonStriker], [1, 2])
})

test('after a fumble both batters must ground, including the slower partner', () => {
  const sim = fumble({ fieldingMode: 'manual', runnerPace: [1.25, .8] })
  stepTo(sim, 294)
  assert.equal(sim.runnerProgress, 1, 'the faster batter is at the far crease')
  assert.ok(sim.partnerProgress > .99 && sim.partnerProgress < 1)
  assert.ok(Math.abs(sim.runnerPositions[0] - farCrease) < 1e-9)
  assert.ok(sim.runnerPositions[1] > nearCrease)
  assert.equal(sim.completedRuns, 0, 'one grounded batter is insufficient')
  sim.step()
  assert.equal(sim.tick, 295)
  assert.equal(sim.completedRuns, 1)
  assert.equal(sim.runnerProgress, 0)
  assert.equal(sim.partnerProgress, 0)
  assert.deepEqual(sim.runnerPositions, [farCrease, nearCrease])
  assert.ok(sim.setRunning(false))
  const innings = finish(sim)
  assert.equal(sim.outcome?.completedRuns, 1)
  assert.equal(sim.outcome?.byes, 1)
  assert.equal(innings.runs, 1)
  assert.equal(innings.wickets, 0)
  assert.deepEqual([innings.striker, innings.nonStriker], [2, 1])
})

test('crossing after a fumble does not score an incomplete run at a wicket', () => {
  const sim = fumble({ fieldingMode: 'manual' })
  stepTo(sim, 130)
  assert.ok(sim.fieldControl({ type: 'throw', end: 'striker' }))
  const innings = finish(sim)
  assert.equal(sim.tick, 203)
  assert.ok(sim.runnerProgress > .5 && sim.runnerProgress < 1)
  assert.ok(sim.partnerProgress > .5 && sim.partnerProgress < 1)
  assert.ok(sim.runnerPositions.every(z => z > nearCrease && z < farCrease))
  assert.equal(sim.outcome?.crossed, true)
  assert.equal(sim.outcome?.dismissedBatter, 'nonStriker')
  assert.equal(sim.outcome?.completedRuns, 0)
  assert.equal(sim.outcome?.byes, 0)
  assert.equal(innings.runs, 0)
  assert.equal(innings.wickets, 1)
  assert.deepEqual([innings.striker, innings.nonStriker], [3, 1])
})

test('additional runs after a fumble count only full traversals and survive a later run-out', () => {
  const sim = fumble({ fieldingMode: 'manual' })
  stepTo(sim, 248)
  assert.equal(sim.completedRuns, 0)
  sim.step()
  assert.equal(sim.completedRuns, 1)
  assert.deepEqual(sim.runnerPositions, [farCrease, nearCrease])
  stepTo(sim, 431)
  assert.equal(sim.completedRuns, 1, 'the unfinished second run is not scored')
  sim.step()
  assert.equal(sim.completedRuns, 2)
  assert.deepEqual(sim.runnerPositions, [nearCrease, farCrease])
  const innings = finish(sim)
  assert.equal(sim.tick, 608)
  assert.ok(sim.runnerProgress > .96 && sim.runnerProgress < 1)
  assert.ok(sim.partnerProgress > .96 && sim.partnerProgress < 1)
  assert.equal(sim.outcome?.completedRuns, 2, 'the unfinished third run is excluded')
  assert.equal(sim.outcome?.byes, 2)
  assert.equal(sim.outcome?.wicket, 'run-out')
  assert.equal(sim.outcome?.dismissedBatter, 'nonStriker')
  assert.equal(innings.runs, 2)
  assert.equal(innings.wickets, 1)
  assert.deepEqual([innings.striker, innings.nonStriker], [3, 1])
})

// Fumbles occur during approach, before assisted running can start. The
// reachable same-tick race is subsequent grounding versus the wicket break.
for (const [throwTick, endTick, runs, wicket] of [
  [175, 248, 0, 'run-out'],
  [176, 249, 1, null],
  [177, 250, 1, 'run-out'],
  [359, 432, 2, null],
] as const) {
  test(`post-fumble throw at ${throwTick}: wicket break at ${endTick} scores ${runs} completed runs`, () => {
    const sim = fumble({ fieldingMode: 'manual' })
    stepTo(sim, throwTick)
    assert.ok(sim.fieldControl({ type: 'throw', end: 'striker' }))
    const innings = finish(sim)
    assert.equal(sim.tick, endTick)
    assert.equal(sim.wicketBroken, true)
    assert.equal(sim.outcome?.wicket, wicket)
    assert.equal(sim.outcome?.completedRuns, runs)
    assert.equal(sim.outcome?.byes, runs)
    assert.equal(innings.runs, runs)
    if (wicket) {
      assert.ok(sim.runnerPositions.every(z => z > nearCrease && z < farCrease))
      assert.equal(sim.outcome?.dismissedBatter, 'nonStriker')
      assert.deepEqual([innings.striker, innings.nonStriker], [3, 1])
    } else {
      assert.equal(sim.runnerProgress, 0)
      assert.equal(sim.partnerProgress, 0)
      assert.deepEqual(sim.runnerPositions, runs === 1 ? [farCrease, nearCrease] : [nearCrease, farCrease])
      assert.deepEqual([innings.striker, innings.nonStriker], runs === 1 ? [2, 1] : [1, 2])
    }
  })
}

test('a later delivery fumble preserves a previously completed single and strike', () => {
  const single = fumble({ fieldingMode: 'manual' })
  stepTo(single, 176)
  assert.ok(single.fieldControl({ type: 'throw', end: 'striker' }))
  const before = finish(single)
  assert.equal(before.runs, 1)
  const next = fumble()
  const after = finish(next, before)
  assert.equal(next.outcome?.completedRuns, 0)
  assert.equal(after.runs, 1)
  assert.equal(after.legalBalls, 2)
  assert.deepEqual([after.striker, after.nonStriker], [before.striker, before.nonStriker])
})

test('a fumble and normal completion are not counted twice across replay or dead-ball updates', () => {
  const settings: DeliveryOptions = { ...options, fieldingMode: 'manual' }
  const live = fumble(settings)
  stepTo(live, 249)
  assert.equal(live.completedRuns, 1)
  assert.ok(live.setRunning(false))
  const innings = finish(live)
  const replay = new DeliveryReplay({ options: settings, version: 2,
    commands: [{ type: 'running', tick: 249, seq: 1, running: false }] })
  for (const tick of [48, 49, 49, 248, 249, 249, 250, 1500, 1500]) {
    assert.ok(replay.advanceTo(tick))
    assert.equal(replay.sim.completedRuns, tick < 249 ? 0 : 1)
  }
  assert.deepEqual(replay.sim.outcome, live.outcome)
  assert.deepEqual(replay.sim.runnerPositions, live.runnerPositions)
  assert.deepEqual(applyDelivery(newInnings(), replay.sim.outcome!), innings)
  const final = structuredClone(live.outcome)
  const finalTick = live.tick
  for (let repeat = 0; repeat < 10; repeat++) live.step()
  assert.equal(live.tick, finalTick)
  assert.equal(live.completedRuns, 1)
  assert.deepEqual(live.outcome, final)
})

test('manual keeper collection retains its existing run-out path for the fumble seed', () => {
  const sim = new Delivery({ ...options, runningMode: 'manual' })
  stepTo(sim, sim.contactTick)
  assert.ok(sim.setRunning(true))
  const innings = finish(sim)
  assert.equal(sim.parried, false, 'manual keeper collection precedes the assisted fumble branch')
  assert.equal(sim.outcome?.wicket, 'run-out')
  assert.equal(sim.outcome?.completedRuns, 0)
  assert.equal(innings.runs, 0)
  assert.equal(innings.wickets, 1)
})
