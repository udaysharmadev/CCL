import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Delivery, PITCH_LENGTH, type DeliveryOptions } from '../src/cricket.ts'
import { applyDelivery, newInnings, type DeliveryOutcome } from '../src/rules.ts'
import { updateDuoOwners } from '../src/duo.ts'

const options: DeliveryOptions = { seed: 41, kind: 'fast', effort: .63, maxOutside: 2, runningMode: 'manual' }

function play(controls: (sim: Delivery, fieldAge: number) => void = () => {}, settings = options) {
  const sim = new Delivery(settings)
  let fieldTick: number | undefined
  const actions = new Set<string>()
  while (!sim.outcome && sim.tick < 900) {
    if (sim.tick === sim.contactTick) sim.swing({ kind: 'defend', aim: -1.35, power: .7 })
    if (sim.phase === 'field') {
      fieldTick ??= sim.tick
      controls(sim, sim.tick - fieldTick)
    }
    actions.add(sim.action)
    sim.step()
  }
  assert.ok(sim.outcome)
  return { sim, outcome: sim.outcome, actions }
}

test('manual runs require a command and full traversal; further presses queue risky extra runs', () => {
  const wait = play()
  assert.equal(wait.outcome.batRuns, 0)
  assert.equal(wait.outcome.wicket, null)
  const single = play((sim, age) => { if (age === 0) sim.setRunning(true) })
  assert.equal(single.outcome.batRuns, 1)
  assert.equal(single.outcome.completedRuns, 1)
  assert.equal(single.outcome.wicket, null)
  assert.equal(single.sim.runnerProgress, 0)
  assert.equal(single.sim.runnersMoving, false)
  assert.ok(single.sim.runnerPositions[0] >= PITCH_LENGTH - 1.22 - 1e-9)
  assert.ok(single.sim.runnerPositions[1] <= 1.22 + 1e-9)
  const queued = play((sim, age) => {
    if (age === 0) { sim.setRunning(true); sim.setRunning(true) }
  })
  assert.equal(queued.outcome.batRuns, 1, 'unfinished second run earns no runs')
  assert.equal(queued.outcome.completedRuns, 1)
  assert.equal(queued.outcome.wicket, 'run-out')
  assert.ok(queued.actions.has('return') && queued.actions.has('break'))
  assert.ok(queued.sim.wicketBroken)
  assert.ok(queued.sim.runnerPositions.every((z) => z > 1.22 && z < PITCH_LENGTH - 1.22))
  assert.ok(Math.abs(queued.sim.ball.z) < 1e-9, 'ball reaches the striker wicket')
  assert.ok(Math.abs(queued.sim.keeper.z) < PITCH_LENGTH / 10, 'keeper has carried the ball to the wicket')
})

test('Turn back moves towards the prior crease, clears queued runs and can save the pair', () => {
  let beforeCancel = 0
  const canceled = play((sim, age) => {
    if (age === 0) { sim.setRunning(true); sim.setRunning(true) }
    if (age === 60) { beforeCancel = sim.runnerProgress; sim.setRunning(false) }
    if (age === 61) {
      assert.ok(sim.runnerProgress < beforeCancel)
      assert.ok(sim.runnersReturning && sim.runnersMoving)
    }
  })
  assert.equal(canceled.outcome.batRuns, 0)
  assert.equal(canceled.outcome.wicket, null)
  assert.equal(canceled.sim.runnerProgress, 0)
  const lateCancel = play((sim, age) => {
    if (age === 100) sim.setRunning(true)
    if (age === 230) sim.setRunning(false)
  })
  assert.equal(lateCancel.outcome.wicket, 'run-out', 'turning back does not grant instant safety')
  const savedSecond = play((sim, age) => {
    if (age === 0) { sim.setRunning(true); sim.setRunning(true) }
    if (age === 210) sim.setRunning(false)
  })
  assert.equal(savedSecond.outcome.batRuns, 1)
  assert.equal(savedSecond.outcome.wicket, null)
})

test('grounding on the wicket-break tick is safe; one tick short is a run-out', () => {
  const breakTick = play().sim.tick
  // The pair set off eighteen ticks after the call, and a run takes 183 ticks.
  const arrival = play((sim) => { if (sim.tick === breakTick - 200) sim.setRunning(true) })
  assert.equal(arrival.sim.tick, breakTick)
  assert.equal(arrival.outcome.batRuns, 1)
  assert.equal(arrival.outcome.wicket, null)
  const short = play((sim) => { if (sim.tick === breakTick - 199) sim.setRunning(true) })
  assert.equal(short.outcome.wicket, 'run-out')
  assert.equal(short.outcome.batRuns, 0)
  assert.ok(short.sim.runnerProgress > .99 && short.sim.runnerProgress < 1)
})

test('run-outs preserve runs, identify either batter, use crossing and inherit the dismissed Duo owner', () => {
  const beforeCrossing = play((sim, age) => { if (age === 180) sim.setRunning(true) }).outcome
  const afterCrossing = play((sim, age) => { if (age === 100) sim.setRunning(true) }).outcome
  assert.equal(beforeCrossing.dismissedBatter, 'striker')
  assert.equal(beforeCrossing.crossed, false)
  assert.equal(afterCrossing.dismissedBatter, 'nonStriker')
  assert.equal(afterCrossing.crossed, true)
  for (const [outcome, expectedOther, owner] of [
    [beforeCrossing, 2, 0], [afterCrossing, 1, 1],
  ] as const) {
    for (const balls of [0, 5]) {
      const previous = { ...newInnings(), legalBalls: balls, freeHit: true }
      const next = applyDelivery(previous, outcome)
      assert.equal(next.wickets, 1, 'free hit does not prevent a run-out')
      assert.equal(next.striker, balls === 5 ? expectedOther : 3)
      assert.equal(next.nonStriker, balls === 5 ? 3 : expectedOther)
      assert.equal(updateDuoOwners({ 1: 0, 2: 1 }, previous, next)[3], owner)
    }
  }
  const secondRun: DeliveryOutcome = { ...beforeCrossing, batRuns: 1, completedRuns: 1,
    noBall: 1, dismissedBatter: 'nonStriker' }
  const next = applyDelivery(newInnings(), secondRun)
  assert.equal(next.runs, 2)
  assert.equal(next.wickets, 1)
  assert.equal(next.legalBalls, 0)
  assert.equal(next.striker, 3)
  assert.equal(next.nonStriker, 1)
  const onFreeHit = play((sim, age) => { if (age === 100) sim.setRunning(true) }, { ...options, freeHit: true })
  const onNoBall = play((sim, age) => { if (age === 100) sim.setRunning(true) }, { ...options, seed: 6, kind: 'length', effort: 1 })
  assert.equal(onFreeHit.outcome.wicket, 'run-out')
  assert.equal(onNoBall.outcome.noBall, 1)
  assert.equal(onNoBall.outcome.wicket, 'run-out')
})

test('keeper collection stays live for a run attempt and a missed-ball run is run-out, not a dot', () => {
 const sim = new Delivery({seed:41,kind:'fast',line:.4,runningMode:'manual'})
 let called=false
 while(!sim.outcome && sim.tick<900) {
  if(sim.tick===sim.contactTick) { assert.ok(sim.setRunning(true)); called=true }
  sim.step()
 }
 assert.ok(called)
 assert.equal(sim.outcome?.wicket,'run-out')
 assert.equal(sim.outcome?.reason,'run-out')
 assert.ok(sim.wicketBroken)
 assert.ok(sim.runnerPositions.every(z => z>1.22))
})
