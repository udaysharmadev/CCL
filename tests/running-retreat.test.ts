import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Delivery, PITCH_LENGTH, type DeliveryOptions } from '../src/cricket.ts'
import { DeliveryReplay } from '../src/delivery-replay.ts'
import type { OnlineDeliveryCommand } from '../src/online-contract.ts'
import { applyDelivery, newInnings } from '../src/rules.ts'

// Real physics and public controls only. The faster striker grounds at tick
// 203, then waits while the slower partner continues until the turn at 250.
const options: DeliveryOptions = {
  seed: 8, kind: 'fast', line: .44, effort: .63, bowler: 'Mehta',
  runningMode: 'manual', runnerPace: [1.25, .8],
}
const input = { kind: 'drive' as const, aim: 0, power: .7 }
const near = 1.22
const far = PITCH_LENGTH - near

function stepTo(sim: Delivery, tick: number) {
  while (sim.tick < tick && !sim.outcome) sim.step()
  assert.equal(sim.tick, tick)
}

function start(overrides: Partial<DeliveryOptions> = {}, runTick = 39) {
  const sim = new Delivery({ ...options, ...overrides })
  if (runTick < 37) {
    stepTo(sim, runTick)
    assert.ok(sim.setRunning(true))
  }
  stepTo(sim, 37)
  assert.ok(sim.swing(input))
  if (runTick >= 37) {
    stepTo(sim, runTick)
    assert.ok(sim.setRunning(true))
  }
  return sim
}

function finish(sim: Delivery) {
  while (!sim.outcome && sim.tick < 1500) sim.step()
  assert.ok(sim.outcome, 'the production delivery must finish')
  return applyDelivery(newInnings(), sim.outcome)
}

function close(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} should equal ${expected}`)
}

function home(sim: Delivery, completed = 0) {
  assert.deepEqual([sim.runnerProgress, sim.partnerProgress], [0, 0])
  const ends = completed % 2 ? [far, near] : [near, far]
  sim.runnerPositions.forEach((position, index) => close(position, ends[index]))
  assert.equal(sim.completedRuns, completed)
  assert.equal(sim.runnersReturning, false)
  assert.equal(sim.runnersMoving, false)
}

test('H6: the slower partner keeps retreating after the faster striker reaches home', () => {
  const sim = start()
  stepTo(sim, 202)
  assert.ok(sim.runnerProgress < 1)
  sim.step()
  assert.equal(sim.runnerProgress, 1)
  assert.ok(sim.partnerProgress < 1)
  assert.equal(sim.completedRuns, 0, 'one grounded batter does not complete a run')
  stepTo(sim, 250)
  close(sim.partnerProgress, .8480874316939869)
  assert.ok(sim.setRunning(false))
  stepTo(sim, 397)
  assert.equal(sim.runnerProgress, 0)
  close(sim.partnerProgress, .20546448087431704)
  assert.equal(sim.runnersReturning, true, 'the partner is still 3.63 metres short of home')
  assert.equal(sim.runnersMoving, true)
  const previous = sim.partnerProgress
  sim.step()
  assert.equal(sim.runnerProgress, 0, 'the grounded striker stays at the crease')
  assert.ok(sim.partnerProgress < previous, 'the slower partner must not freeze')
  stepTo(sim, 443)
  assert.ok(sim.partnerProgress > 0)
  assert.equal(sim.runnersReturning, true)
  sim.step()
  home(sim)
  const innings = finish(sim)
  assert.equal(sim.tick, 676)
  home(sim)
  assert.equal(sim.outcome?.completedRuns, 0)
  assert.equal(sim.outcome?.batRuns, 0)
  assert.equal(sim.outcome?.wicket, null)
  assert.equal(sim.outcome?.overthrowRuns, 1, 'the existing H5 penalty remains separate')
  assert.equal(innings.runs, 1)
  assert.deepEqual([innings.striker, innings.nonStriker], [1, 2])
})

for (const [label, pace] of [
  ['faster striker', [1.25, .8]],
  ['faster partner', [.8, 1.25]],
  ['roster speeds', [1.14, .94]],
] as const) {
  test(`H6: retreat remains coordinated with ${label}`, () => {
    const sim = start({ runnerPace: pace })
    stepTo(sim, 56)
    assert.deepEqual([sim.runnerProgress, sim.partnerProgress], [0, 0])
    sim.step()
    close(sim.runnerProgress / sim.partnerProgress, pace[0] / pace[1])
    stepTo(sim, 230)
    assert.equal(Math.max(sim.runnerProgress, sim.partnerProgress), 1)
    assert.ok(Math.min(sim.runnerProgress, sim.partnerProgress) < 1)
    assert.ok(sim.setRunning(false))
    while (sim.runnersReturning && !sim.outcome) {
      const [striker, partner] = [sim.runnerProgress, sim.partnerProgress]
      sim.step()
      assert.ok(sim.runnerProgress <= striker && sim.partnerProgress <= partner)
      assert.ok(sim.runnerPositions.every(position => position >= near - 1e-9 && position <= far + 1e-9))
      assert.equal(sim.completedRuns, 0)
    }
    home(sim)
    finish(sim)
    assert.equal(sim.outcome?.completedRuns, 0)
  })
}

for (const [label, turn] of [['before crossing', 100], ['after crossing', 180]] as const) {
  test(`H6: a turn ${label} returns both batters to their original ends without scoring`, () => {
    const sim = start()
    // Backing up gives the actual pair different initial crease positions.
    close(sim.runnerPositions[0], near)
    assert.ok(sim.runnerPositions[1] < far)
    stepTo(sim, turn)
    assert.equal(Math.min(sim.runnerProgress, sim.partnerProgress) >= .5, turn === 180)
    assert.ok(sim.setRunning(false))
    const positions = [...sim.runnerPositions]
    sim.step()
    assert.ok(sim.runnerPositions[0] < positions[0])
    assert.ok(sim.runnerPositions[1] > positions[1])
    while (sim.runnersReturning && !sim.outcome) sim.step()
    home(sim)
    finish(sim)
    assert.equal(sim.outcome?.batRuns, 0)
    assert.equal(sim.outcome?.wicket, null)
  })
}

test('H6: repeated turn-back commands clear the queue without reversing or restarting either runner', () => {
  const sim = start()
  assert.ok(sim.setRunning(true))
  assert.ok(sim.setRunning(true))
  assert.equal(sim.pendingRuns, 3)
  stepTo(sim, 250)
  assert.ok(sim.setRunning(false))
  for (let tick = 251; tick <= 450; tick++) {
    const positions = [...sim.runnerPositions]
    for (let repeat = 0; repeat < 3; repeat++) assert.ok(sim.setRunning(false))
    assert.deepEqual(sim.runnerPositions, positions, 'a command does not teleport either batter')
    assert.equal(sim.pendingRuns, 0)
    sim.step()
    assert.ok(sim.runnerPositions[0] <= positions[0] + 1e-9)
    assert.ok(sim.runnerPositions[1] >= positions[1] - 1e-9)
    assert.equal(sim.completedRuns, 0)
  }
  home(sim)
  finish(sim)
  assert.equal(sim.outcome?.completedRuns, 0)
})

test('H6: continuing a safe unequal-speed run waits for the slower batter to ground', () => {
  const sim = start()
  stepTo(sim, 284)
  assert.equal(sim.runnerProgress, 1)
  assert.ok(sim.partnerProgress > .99 && sim.partnerProgress < 1)
  assert.equal(sim.completedRuns, 0)
  sim.step()
  home(sim, 1)
  const innings = finish(sim)
  assert.equal(sim.outcome?.batRuns, 1)
  assert.equal(sim.outcome?.completedRuns, 1)
  assert.equal(sim.outcome?.wicket, null)
  assert.deepEqual([innings.striker, innings.nonStriker], [2, 1])
})

test('H6: abandoning a queued second run preserves only the first grounded run and its strike rotation', () => {
  const sim = start()
  assert.ok(sim.setRunning(true))
  stepTo(sim, 285)
  assert.equal(sim.completedRuns, 1)
  assert.deepEqual([sim.runnerProgress, sim.partnerProgress], [0, 0])
  stepTo(sim, 470)
  assert.equal(sim.runnerProgress, 1)
  assert.ok(sim.partnerProgress < 1)
  assert.ok(sim.setRunning(false))
  stepTo(sim, 617)
  assert.equal(sim.runnerProgress, 0)
  assert.ok(sim.partnerProgress > 0)
  assert.equal(sim.runnersReturning, true)
  close(sim.runnerPositions[0], far)
  stepTo(sim, 656)
  home(sim, 1)
  const innings = finish(sim)
  assert.equal(sim.outcome?.completedRuns, 1)
  assert.equal(sim.outcome?.batRuns, 1)
  assert.equal(sim.outcome?.wicket, null)
  assert.equal(innings.runs, 2, 'one completed run plus the unchanged overthrow penalty')
  assert.deepEqual([innings.striker, innings.nonStriker], [2, 1])
})

test('H6: an early call and retreat preserve approach movement and backing-up coordinates', () => {
  const sim = new Delivery(options)
  assert.ok(sim.setRunning(true))
  stepTo(sim, 25)
  assert.equal(sim.phase, 'flight')
  assert.ok(sim.runnerProgress > sim.partnerProgress && sim.partnerProgress > 0)
  assert.ok(sim.setRunning(false))
  stepTo(sim, 37)
  assert.deepEqual([sim.runnerProgress, sim.partnerProgress], [0, 0])
  assert.equal(sim.runnersReturning, false)
  assert.equal(sim.completedRuns, 0)
  close(sim.runnerPositions[0], near)
  // During approach the non-striker resumes the existing backing-up motion.
  close(sim.runnerPositions[1], far - sim.backedUp)
  assert.ok(sim.swing(input))
  finish(sim)
  assert.equal(sim.outcome?.completedRuns, 0)
})

for (const [end, pace, run, turn, wicketTick, out] of [
  ['bowler', [1.25, .8], 149, 363, 560, false],
  ['bowler', [1.25, .8], 148, 363, 560, true],
  ['striker', [.8, 1.25], 231, 462, 676, false],
  ['striker', [.8, 1.25], 230, 462, 676, true],
] as const) {
  test(`H6: retreat to ${end} end ${out ? 'one tick short is run out' : 'grounds on the wicket-break tick'}`, () => {
    const sim = new Delivery({ ...options, fieldingMode: 'manual', runnerPace: pace })
    while (sim.tick < wicketTick - 1) {
      if (sim.tick === 37) assert.ok(sim.swing(input))
      if (sim.tick === 39) assert.ok(sim.fieldControl({ type: 'chase' }))
      if (sim.tick === run) assert.ok(sim.setRunning(true))
      if (sim.tick === turn) {
        assert.equal(Math.max(sim.runnerProgress, sim.partnerProgress), 1)
        assert.equal(sim.completedRuns, 0)
        assert.ok(sim.setRunning(false))
      }
      if (sim.tick === 420) assert.ok(sim.fieldControl({ type: 'throw', end }))
      sim.step()
      assert.equal(sim.outcome, null)
    }
    assert.equal(sim.runnersReturning, true)
    assert.ok(end === 'bowler' ? sim.partnerProgress > 0 : sim.runnerProgress > 0)
    assert.equal(sim.completedRuns, 0)
    sim.step()
    assert.equal(sim.tick, wicketTick)
    assert.equal(sim.wicketBroken, true)
    assert.equal(sim.outcome?.wicket, out ? 'run-out' : null)
    assert.equal(sim.outcome?.completedRuns, 0)
    assert.equal(sim.outcome?.batRuns, 0)
    if (out) {
      assert.ok(end === 'bowler' ? sim.partnerProgress > 0 : sim.runnerProgress > 0)
      assert.equal(sim.outcome?.dismissedBatter, end === 'bowler' ? 'nonStriker' : 'striker')
      assert.equal(sim.outcome?.crossed, false)
    } else home(sim)
    const innings = finish(sim)
    assert.equal(innings.wickets, Number(out))
    assert.deepEqual([innings.striker, innings.nonStriker], out
      ? end === 'bowler' ? [1, 3] : [3, 2]
      : [1, 2])
  })
}

test('H6: an explicit Run after turning back resumes both runners without awarding the abandoned attempt', () => {
  const sim = start()
  stepTo(sim, 250)
  assert.ok(sim.setRunning(false))
  stepTo(sim, 410)
  assert.equal(sim.runnerProgress, 0)
  assert.ok(sim.partnerProgress > 0)
  assert.ok(sim.setRunning(true))
  const positions = [...sim.runnerPositions]
  sim.step()
  assert.equal(sim.runnersReturning, false)
  assert.ok(sim.runnerPositions[0] > positions[0])
  assert.ok(sim.runnerPositions[1] < positions[1])
  assert.equal(sim.completedRuns, 0)
  const innings = finish(sim)
  assert.equal(sim.outcome?.completedRuns, 1)
  assert.equal(sim.outcome?.batRuns, 1)
  assert.deepEqual([innings.striker, innings.nonStriker], [2, 1])
})

function state(sim: Delivery) {
  return { tick: sim.tick, action: sim.action, positions: [...sim.runnerPositions],
    progress: [sim.runnerProgress, sim.partnerProgress], returning: sim.runnersReturning,
    moving: sim.runnersMoving, pending: sim.pendingRuns, completed: sim.completedRuns,
    ball: { ...sim.ball }, keeper: { ...sim.keeper }, fielders: structuredClone(sim.fielders),
    wicketBroken: sim.wicketBroken, outcome: sim.outcome }
}

test('H6: same-tick calls and repeated reconstruction reproduce every retreat tick and final outcome', () => {
  const commands: OnlineDeliveryCommand[] = [
    { type: 'swing', tick: 37, seq: 1, input },
    { type: 'running', tick: 39, seq: 2, running: true },
    { type: 'running', tick: 250, seq: 3, running: true },
    { type: 'running', tick: 250, seq: 4, running: false },
    { type: 'running', tick: 250, seq: 5, running: false },
    { type: 'running', tick: 397, seq: 6, running: false },
  ]
  const live = new Delivery(options)
  const replay = new DeliveryReplay({ options, version: 2, commands: [...commands].reverse() })
  while (!live.outcome && live.tick < 1500) {
    for (const command of commands.filter(command => command.tick === live.tick)) {
      assert.ok(command.type === 'swing' ? live.swing(command.input) : live.setRunning(command.running))
    }
    assert.ok(replay.advanceTo(live.tick))
    assert.deepEqual(state(replay.sim), state(live))
    assert.ok(replay.advanceTo(live.tick), 'revisiting a tick cannot apply a command twice')
    assert.deepEqual(state(replay.sim), state(live))
    live.step()
  }
  assert.ok(live.outcome)
  assert.ok(replay.advanceTo(1500))
  assert.deepEqual(state(replay.sim), state(live))
  const saved = state(live)
  for (let repeat = 0; repeat < 10; repeat++) {
    live.step()
    assert.equal(live.setRunning(true), false)
    assert.equal(live.setRunning(false), false)
  }
  assert.deepEqual(state(live), saved, 'dead-ball updates cannot score an incomplete attempt')
  const rebuilt = new DeliveryReplay({ options, version: 2, commands })
  assert.ok(rebuilt.advanceTo(1500))
  assert.deepEqual(state(rebuilt.sim), saved)
  assert.deepEqual(applyDelivery(newInnings(), rebuilt.sim.outcome!), applyDelivery(newInnings(), live.outcome))
})
