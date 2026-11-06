import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Delivery, type DeliveryOptions } from '../src/cricket.ts'
import { deliveryCommands, DeliveryReplay } from '../src/delivery-replay.ts'
import type { OnlineDeliveryCommand, OnlineInputHistory } from '../src/online-contract.ts'
import { applyDelivery, newInnings } from '../src/rules.ts'

const options: DeliveryOptions = {
  seed: 41, kind: 'fast', line: 0.2, effort: 0.63, maxOutside: 2, runningMode: 'manual',
}
const input = { kind: 'drive' as const, aim: 0.7, power: 0.4 }
const run = (tick: number, seq: number, running = true): OnlineDeliveryCommand => ({ type: 'running', tick, seq, running })
const shot = (tick: number, seq: number): OnlineDeliveryCommand => ({ type: 'swing', tick, seq, input })

function stepTo(sim: Delivery, tick: number) {
  while (sim.tick < tick && !sim.outcome) sim.step()
  assert.equal(sim.tick, tick)
}

// Drive a separate live simulation directly, in the fixture's intended order.
function liveDelivery(commands: readonly OnlineDeliveryCommand[]) {
  const sim = new Delivery(options)
  for (const command of commands) {
    stepTo(sim, command.tick)
    assert.ok(command.type === 'swing' ? sim.swing(command.input) : sim.setRunning(command.running))
  }
  return sim
}

function finish(sim: Delivery) {
  while (!sim.outcome && sim.tick < 2_000) sim.step()
  assert.ok(sim.outcome)
  return sim.outcome
}

function simulationState(sim: Delivery) {
  // Compare serializable simulation state, excluding per-instance RNG function identity.
  return { ...JSON.parse(JSON.stringify(sim)), pendingRuns: sim.pendingRuns,
    runnersReturning: sim.runnersReturning, runnerPositions: sim.runnerPositions }
}

function assertParity(commands: readonly OnlineDeliveryCommand[]) {
  const live = liveDelivery(commands)
  const replay = new DeliveryReplay({ options, version: 2, commands: [...commands].reverse() })
  assert.ok(replay.advanceTo(live.tick))
  assert.deepEqual(simulationState(replay.sim), simulationState(live))
  assert.ok(replay.advanceTo(2_000))
  assert.deepEqual(replay.sim.outcome, finish(live))
  assert.deepEqual(simulationState(replay.sim), simulationState(live))
  assert.deepEqual(applyDelivery(newInnings(5), replay.sim.outcome!), applyDelivery(newInnings(5), live.outcome!))
  return replay
}

test('reconstruction preserves a run accepted before a delayed swing', () => {
  const commands = [run(10, 2), shot(32, 3)]
  const replay = new DeliveryReplay({ options, version: 2, commands })
  assert.ok(replay.advanceTo(32))
  assert.equal(replay.sim.pendingRuns, 1)
  assert.ok(replay.sim.runnerProgress > 0)
  const completed = assertParity(commands)
  assert.equal(completed.sim.outcome?.batRuns, 1)
  assert.equal(completed.sim.outcome?.completedRuns, 1)
  assert.equal(completed.sim.outcome?.wicket, null)
})

test('multiple queued runs survive reconstruction without duplicating calls', () => {
  const commands = [run(10, 2), run(11, 3), run(12, 4), shot(32, 5)]
  const replay = new DeliveryReplay({ options, version: 2, commands })
  assert.ok(replay.advanceTo(12))
  assert.equal(replay.sim.pendingRuns, 3)
  assert.ok(replay.advanceTo(12))
  assert.ok(replay.advanceTo(11))
  assert.equal(replay.sim.pendingRuns, 3)
  assertParity(commands)
})

test('turn-back before swing preserves runner progress and clears the queue', () => {
  const commands = [run(0, 2), run(1, 3), run(25, 4, false), shot(32, 5)]
  const replay = new DeliveryReplay({ options, version: 2, commands })
  assert.ok(replay.advanceTo(25))
  const progress = replay.sim.runnerProgress
  assert.ok(progress > 0)
  assert.equal(replay.sim.runnersReturning, true)
  assert.equal(replay.sim.pendingRuns, 0)
  assert.ok(replay.advanceTo(26))
  assert.ok(replay.sim.runnerProgress < progress)
  assertParity(commands)
})

test('cancel before swing cancels queued runs before the runners leave their crease', () => {
  const commands = [run(10, 2), run(11, 3), run(12, 4, false), shot(32, 5)]
  const replay = new DeliveryReplay({ options, version: 2, commands })
  assert.ok(replay.advanceTo(12))
  assert.equal(replay.sim.pendingRuns, 0)
  assert.equal(replay.sim.runnersReturning, false)
  assert.equal(replay.sim.runnerProgress, 0)
  assertParity(commands)
})

test('same-tick commands use sequence order and consume the target tick only once', () => {
  const commands = [run(32, 2), run(32, 3), run(32, 4, false), shot(32, 5), run(32, 6)]
  const replay = new DeliveryReplay({ options, version: 2, commands: [...commands].reverse() })
  let steps = 0
  assert.ok(replay.advanceTo(32, () => steps++))
  assert.equal(steps, 32)
  assert.equal(replay.sim.pendingRuns, 1)
  assert.equal(replay.sim.swingTick, 32)
  assert.ok(replay.advanceTo(32, () => steps++))
  assert.equal(steps, 32)
  assert.equal(replay.sim.pendingRuns, 1)
  assertParity(commands)
})

test('command ordering is stable across storage order and sorts backdated ticks before sequences', () => {
  const commands = [run(10, 2), shot(32, 5), run(34, 3), run(34, 4, false)]
  const scrambled = [commands[2], commands[0], commands[3], commands[1]]
  const saved = structuredClone(scrambled)
  assert.deepEqual(deliveryCommands({ version: 2, commands: scrambled }), commands)
  assert.deepEqual(deliveryCommands({ version: 2, commands: [...scrambled].reverse() }), commands)
  assert.deepEqual(scrambled, saved, 'normalization must not mutate stored history')
  assertParity(commands)
})

test('incremental replay and reconstruction from a checkpoint produce the same continued delivery', () => {
  const commands = [run(10, 2), shot(32, 3), run(70, 4), run(95, 5, false)]
  const source = { options, version: 2 as const, commands }
  const replay = new DeliveryReplay(source)
  for (const tick of [0, 10, 32, 65, 70, 95]) {
    assert.ok(replay.advanceTo(tick))
    const restored = new DeliveryReplay(JSON.parse(JSON.stringify(source)))
    assert.ok(restored.advanceTo(tick))
    assert.deepEqual(simulationState(restored.sim), simulationState(replay.sim))
    assert.ok(restored.advanceTo(tick))
    assert.deepEqual(simulationState(restored.sim), simulationState(replay.sim), 'checkpoint commands must not run twice')
  }
  assertParity(commands)
})

test('reconstruction reports commands invalidated by an earlier delivery outcome', () => {
  const baseline = new DeliveryReplay({ options, version: 2, commands: [] })
  assert.ok(baseline.advanceTo(2_000))
  assert.ok(baseline.sim.outcome)
  const unreachable = baseline.sim.tick + 1
  const replay = new DeliveryReplay({ options, version: 2, commands: [run(unreachable, 2)] })
  assert.ok(replay.advanceTo(unreachable - 1))
  assert.equal(replay.advanceTo(unreachable), false)
  assert.equal(replay.advanceTo(2_000), false, 'failed histories cannot later appear valid')
  const invalidAtOutcome = new DeliveryReplay({ options, version: 2, commands: [run(baseline.sim.tick, 2)] })
  assert.equal(invalidAtOutcome.advanceTo(2_000), false)
})

test('legacy histories preserve shot-first ordering, running array order and their original representation', () => {
  const legacy = { options, shot: { tick: 32, input }, runs: [
    { tick: 32, running: true }, { tick: 32, running: false }, { tick: 32, running: true },
  ] }
  const stored = JSON.stringify(legacy)
  const normalized = deliveryCommands(legacy)
  assert.deepEqual(normalized, [shot(32, 1), run(32, 2), run(32, 3, false), run(32, 4)])
  const replay = new DeliveryReplay(legacy)
  assert.ok(replay.advanceTo(32))
  assert.equal(replay.sim.pendingRuns, 1)
  assert.equal(JSON.stringify(legacy), stored)
  assert.deepEqual(deliveryCommands({ ...legacy, version: 1 }), normalized)
  assertParity(normalized)
})

test('version 2 uses the accepted history even if compatibility views disagree', () => {
  const source = { options, version: 2 as const, commands: [run(10, 2), shot(32, 3)],
    runs: [{ tick: 10, running: false }], shot: null }
  const replay = new DeliveryReplay(source)
  assert.ok(replay.advanceTo(32))
  assert.equal(replay.sim.pendingRuns, 1)
  assert.equal(replay.sim.swingTick, 32)
  assert.ok(replay.advanceTo(2_000))
  assert.deepEqual(replay.sim.outcome, finish(liveDelivery(source.commands)))
})

test('duplicate sequences, duplicate swings, invalid ticks and unknown versions fail explicitly', () => {
  assert.throws(() => deliveryCommands({ version: 2, commands: [run(10, 2), run(11, 2)] }), /Duplicate.*sequence/)
  assert.throws(() => deliveryCommands({ version: 2, commands: [shot(30, 2), shot(32, 3)] }), /Duplicate.*swing/)
  for (const command of [run(-1, 2), run(1.5, 2), run(Infinity, 2), run(1, 0), run(1, 1.5)]) {
    assert.throws(() => deliveryCommands({ version: 2, commands: [command] }), /Invalid.*tick or sequence/)
  }
  assert.throws(() => deliveryCommands({ version: 3, commands: [] } as unknown as OnlineInputHistory), /Unsupported.*version/)
})
