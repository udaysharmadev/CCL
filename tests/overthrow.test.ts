import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Delivery, type DeliveryOptions } from '../src/cricket.ts'
import { DeliveryReplay } from '../src/delivery-replay.ts'
import type { OnlineDeliveryCommand } from '../src/online-contract.ts'
import { applyDelivery, deliveryToken, newInnings, type Innings } from '../src/rules.ts'
import { overSummary, totalRuns } from '../src/scorecard.ts'

// Real seeded deliveries and public controls only: no assigned outcomes,
// completion counters, private state or replacement random generators.
const driveOptions: DeliveryOptions = { seed: 8, kind: 'fast', line: .44, effort: .63, bowler: 'Mehta' }
const shot: OnlineDeliveryCommand = { type: 'swing', tick: 37, seq: 1, input: { kind: 'drive', aim: 0, power: .7 } }
const byeOptions: DeliveryOptions = { seed: 451, kind: 'yorker', line: .4, effort: 1, fieldingMode: 'manual', bowler: 'Mehta' }
const lineup = ['A', 'B', 'C']
const fresh = () => newInnings(2, undefined, lineup)

function stepTo(sim: Delivery, tick: number) {
  while (sim.tick < tick && !sim.outcome) sim.step()
  assert.equal(sim.tick, tick)
}

function finish(sim: Delivery) {
  while (!sim.outcome && sim.tick < 1500) sim.step()
  assert.ok(sim.outcome, 'production simulation must settle')
  return sim
}

function play(options: DeliveryOptions, commands: OnlineDeliveryCommand[]) {
  const sim = new Delivery(options)
  for (const command of commands) {
    stepTo(sim, command.tick)
    assert.ok(command.type === 'swing' ? sim.swing(command.input) : sim.setRunning(command.running))
  }
  return finish(sim)
}

function reconcile(innings: Innings) {
  const batterRuns = innings.batting.reduce((runs, batter) => runs + batter.runs, 0)
  const extras = Object.values(innings.extras).reduce((a, b) => a + b, 0)
  assert.equal(batterRuns + extras, innings.runs, 'scorecard batter runs plus extras must explain every team run')
  assert.equal(innings.history.reduce((runs, ball) => runs + totalRuns(ball), 0), innings.runs)
  assert.equal(overSummary(innings).reduce((runs, over) => runs + over.runs, 0), innings.runs)
  assert.equal(innings.partnerships.reduce((runs, pair) => runs + pair.runs, 0), innings.runs)
}

function score(sim: Delivery, expected: {
  bat?: number; byes?: number; legByes?: number; noBall?: number; overthrow?: number; completed: number
}) {
  assert.ok(sim.outcome)
  const { bat = 0, byes = 0, legByes = 0, noBall = 0, overthrow = 1, completed } = expected
  const outcome = sim.outcome
  assert.equal(outcome.batRuns, bat)
  assert.equal(outcome.byes, byes)
  assert.equal(outcome.legByes, legByes)
  assert.equal(outcome.noBall, noBall)
  assert.equal(outcome.wide, 0)
  assert.equal(outcome.overthrowRuns ?? 0, overthrow)
  assert.equal(outcome.penalty ?? 0, 0, 'the aggregate must not copy the award into a second outcome field')
  assert.equal(outcome.completedRuns, completed)
  assert.equal(sim.completedRuns, completed)
  const before = fresh()
  const saved = JSON.stringify({ before, outcome })
  const innings = applyDelivery(before, outcome)
  assert.equal(JSON.stringify({ before, outcome }), saved, 'reduction leaves its inputs unchanged')
  assert.equal(innings.runs, bat + byes + legByes + noBall + overthrow)
  reconcile(innings)
  assert.deepEqual(innings.extras, { wide: 0, noBall, byes, legByes, penalty: overthrow })
  assert.equal(innings.batting[0].runs, bat)
  assert.equal(innings.batting[0].balls, noBall ? 0 : 1)
  assert.equal(innings.batting[0].fours, 0)
  assert.equal(innings.batting[0].sixes, 0)
  assert.deepEqual(innings.bowling, [{ name: 'Mehta', balls: noBall ? 0 : 1,
    runs: bat + noBall + overthrow, wickets: 0, maidens: 0, wides: 0, noBalls: noBall }])
  assert.equal(innings.wickets, Number(outcome.wicket !== null))
  assert.equal(innings.legalBalls, noBall ? 0 : 1)
  assert.equal(innings.freeHit, Boolean(noBall))
  assert.equal(innings.attempts, 1)
  assert.deepEqual(innings.history, [outcome])
  return innings
}

for (const [label, stop, completed] of [
  ['without a running attempt', 39, 0],
  ['after a completed single', 270, 1],
] as const) {
  test(`H5: a natural overthrow ${label} reconciles as one penalty extra`, () => {
    const sim = play(driveOptions, [shot, { type: 'running', tick: stop, seq: 2, running: false }])
    assert.equal(sim.tick, 619)
    assert.equal(sim.outcome?.reason, 'fielded')
    assert.equal(sim.outcome?.wicket, null)
    assert.deepEqual([sim.runnerProgress, sim.partnerProgress], [0, 0])
    const innings = score(sim, { bat: completed, completed })
    assert.deepEqual([innings.striker, innings.nonStriker], completed ? [2, 1] : [1, 2], 'penalty does not rotate strike')
  })
}

test('H5: running before and during the overthrow retains two completions and excludes the unfinished third', () => {
  const sim = new Delivery(driveOptions)
  stepTo(sim, 37)
  assert.ok(sim.swing(shot.input))
  stepTo(sim, 269)
  assert.equal(sim.completedRuns, 0)
  sim.step()
  assert.equal(sim.completedRuns, 1)
  stepTo(sim, 427)
  assert.equal(sim.action, 'return')
  assert.equal(sim.completedRuns, 1)
  sim.step() // The seeded overthrow draw occurs once on the first return step.
  assert.equal(sim.tick, 428)
  assert.equal(sim.completedRuns, 1)
  assert.ok(sim.runnerProgress > .8 && sim.runnerProgress < 1)
  stepTo(sim, 452)
  assert.equal(sim.completedRuns, 1)
  sim.step()
  assert.equal(sim.completedRuns, 2)
  finish(sim)
  assert.equal(sim.tick, 619)
  assert.ok(sim.runnerProgress > .9 && sim.runnerProgress < 1)
  assert.ok(sim.partnerProgress > .9 && sim.partnerProgress < 1)
  const innings = score(sim, { bat: 2, completed: 2 })
  assert.deepEqual([innings.striker, innings.nonStriker], [1, 2])
})

test('H5/H3/H4: a keeper fumble, no-ball, completed bye and overthrow remain distinct', () => {
  const sim = new Delivery(byeOptions)
  stepTo(sim, 45)
  assert.equal(sim.parried, true)
  assert.equal(sim.completedRuns, 0)
  assert.deepEqual([sim.runnerProgress, sim.partnerProgress], [0, 0])
  stepTo(sim, 245)
  assert.equal(sim.completedRuns, 1)
  assert.ok(sim.setRunning(false))
  finish(sim)
  assert.equal(sim.tick, 604)
  const innings = score(sim, { noBall: 1, byes: 1, completed: 1 })
  assert.deepEqual([innings.striker, innings.nonStriker], [2, 1])
})

test('H5: eligible leg-byes and overthrow are separate extras with different bowler attribution', () => {
  const sim = new Delivery({ seed: 726, kind: 'fast', line: -.2, effort: 1, fieldingMode: 'manual', bowler: 'Mehta' })
  stepTo(sim, 29)
  assert.ok(sim.swing({ kind: 'hook', aim: 0, power: .7 }))
  stepTo(sim, 62)
  assert.ok(sim.fieldControl({ type: 'chase' }))
  stepTo(sim, 262)
  assert.equal(sim.completedRuns, 1)
  assert.ok(sim.setRunning(false))
  finish(sim)
  assert.equal(sim.tick, 670)
  assert.equal(sim.outcome?.padContact, true)
  assert.equal(sim.outcome?.shotOffered, true)
  const innings = score(sim, { legByes: 1, completed: 1 })
  assert.deepEqual([innings.striker, innings.nonStriker], [2, 1])
})

test('H5: turning back an incomplete manual attempt earns only the overthrow penalty', () => {
  const sim = new Delivery({ ...driveOptions, runningMode: 'manual' })
  stepTo(sim, 37)
  assert.ok(sim.swing(shot.input))
  stepTo(sim, 39)
  assert.ok(sim.setRunning(true))
  stepTo(sim, 100)
  const progress = sim.runnerProgress
  assert.ok(progress > .2 && progress < .3)
  assert.ok(sim.setRunning(false))
  sim.step()
  assert.ok(sim.runnerProgress < progress)
  stepTo(sim, 144)
  assert.deepEqual([sim.runnerProgress, sim.partnerProgress], [0, 0])
  finish(sim)
  assert.equal(sim.tick, 676)
  const innings = score(sim, { completed: 0 })
  assert.deepEqual([innings.striker, innings.nonStriker], [1, 2])
})

for (const end of ['striker', 'bowler'] as const) {
  test(`H5: a run-out at the ${end} end preserves completed bat runs and dismissal identity`, () => {
    const sim = new Delivery({ ...driveOptions, runningMode: 'manual', fieldingMode: 'manual' })
    stepTo(sim, 37)
    assert.ok(sim.swing(shot.input))
    stepTo(sim, 39)
    assert.ok(sim.setRunning(true))
    assert.ok(sim.fieldControl({ type: 'chase' }))
    stepTo(sim, 450)
    assert.equal(sim.completedRuns, 1)
    assert.ok(sim.fieldControl({ type: 'throw', end }))
    stepTo(sim, 550)
    assert.ok(sim.setRunning(true))
    finish(sim)
    assert.equal(sim.tick, end === 'striker' ? 700 : 584)
    assert.equal(sim.outcome?.wicket, 'run-out')
    assert.equal(sim.outcome?.dismissedBatter, 'striker')
    assert.equal(sim.outcome?.crossed, end === 'striker')
    const innings = score(sim, { bat: 1, completed: 1, overthrow: 0 })
    assert.equal(innings.batting[0].dismissed, true)
    assert.equal(innings.batting[1].dismissed, false)
    assert.deepEqual([innings.striker, innings.nonStriker], end === 'striker' ? [3, 2] : [2, 3])
  })
}

for (const [throwTick, finalTick, completed, out] of [
  [171, 244, 0, true], [172, 245, 1, false], [173, 246, 1, true], [355, 428, 2, false],
] as const) {
  test(`H5/H3: keeper return called at ${throwTick} preserves grounding and wicket ordering at ${finalTick}`, () => {
    const sim = new Delivery(byeOptions)
    stepTo(sim, throwTick)
    assert.ok(sim.fieldControl({ type: 'throw', end: 'striker' }))
    finish(sim)
    assert.equal(sim.tick, finalTick)
    assert.equal(sim.wicketBroken, true)
    assert.equal(sim.outcome?.wicket, out ? 'run-out' : null)
    assert.equal(sim.outcome?.reason, out ? 'run-out' : 'fielded')
    const innings = score(sim, { noBall: 1, byes: completed, completed, overthrow: out ? 0 : 1 })
    if (out) {
      assert.equal(sim.outcome?.dismissedBatter, 'nonStriker')
      assert.equal(sim.outcome?.crossed, completed === 0)
      assert.equal(innings.batting[1].dismissed, true)
      assert.deepEqual(innings.fallOfWickets, [{ batter: 2, runs: innings.runs, overs: 0 }])
      assert.deepEqual([innings.striker, innings.nonStriker], [3, 1])
    } else {
      assert.deepEqual([sim.runnerProgress, sim.partnerProgress], [0, 0])
      assert.deepEqual([innings.striker, innings.nonStriker], completed % 2 ? [2, 1] : [1, 2])
    }
  })
}

test('H5: repeated throw requests and dead-ball steps cannot multiply the overthrow award', () => {
  const sim = new Delivery(byeOptions)
  stepTo(sim, 172)
  for (let repeat = 0; repeat < 5; repeat++) assert.ok(sim.fieldControl({ type: 'throw', end: 'striker' }))
  sim.step()
  assert.equal(sim.action, 'return')
  assert.equal(sim.fieldControl({ type: 'throw', end: 'striker' }), false)
  finish(sim)
  assert.equal(sim.tick, 245)
  const innings = score(sim, { noBall: 1, byes: 1, completed: 1 })
  const outcome = JSON.stringify(sim.outcome)
  for (let repeat = 0; repeat < 20; repeat++) sim.step()
  assert.equal(sim.tick, 245)
  assert.equal(sim.fieldControl({ type: 'throw', end: 'striker' }), false)
  assert.equal(JSON.stringify(sim.outcome), outcome)
  assert.deepEqual(applyDelivery(fresh(), sim.outcome!), innings)
})

for (const version of [undefined, 1, 2] as const) {
  test(`H5/H1: replay version ${version ?? 'legacy'} preserves the outcome and consumes overthrow once`, () => {
    const commands: OnlineDeliveryCommand[] = [shot, { type: 'running', tick: 270, seq: 2, running: false }]
    const live = play(driveOptions, commands)
    const innings = score(live, { bat: 1, completed: 1 })
    const source = version === 2 ? { options: driveOptions, version, commands }
      : { options: driveOptions, version, shot: { tick: 37, input: shot.input }, runs: [{ tick: 270, running: false }] }
    const serialized = JSON.stringify(source)
    const stored = JSON.parse(serialized)
    const replay = new DeliveryReplay(stored)
    for (const tick of [37, 37, 270, 270, 427, 428, 428, 619, 1500, 1500]) assert.ok(replay.advanceTo(tick))
    assert.equal(JSON.stringify(stored), serialized, 'legacy records are not rewritten')
    assert.deepEqual(replay.sim.outcome, live.outcome)
    assert.deepEqual(replay.sim.runnerPositions, live.runnerPositions)
    assert.deepEqual(applyDelivery(fresh(), replay.sim.outcome!), innings)
    assert.equal(replay.sim.completedRuns, 1)
    assert.equal(replay.sim.tick, 619)
  })
}

test('H5: overthrows accumulate across an over without earning a maiden or rotating strike as penalties', () => {
  const sim = play(driveOptions, [shot, { type: 'running', tick: 39, seq: 2, running: false }])
  assert.ok(sim.outcome)
  let innings = fresh()
  // Six separate identical seeded deliveries, not duplicate processing of one event.
  for (let ball = 0; ball < 6; ball++) innings = applyDelivery(innings, sim.outcome)
  reconcile(innings)
  assert.equal(innings.runs, 6)
  assert.equal(innings.extras.penalty, 6)
  assert.equal(innings.bowling[0].runs, 6)
  assert.equal(innings.bowling[0].maidens, 0)
  assert.deepEqual([innings.striker, innings.nonStriker], [2, 1], 'only the end of the over changes ends')
})

test('H5: scorecard delivery tokens show the separate overthrow award instead of a dot or an unexplained total', () => {
  for (const [stop, token] of [[39, '1OT'], [270, '1+1OT']] as const) {
    const sim = play(driveOptions, [shot, { type: 'running', tick: stop, seq: 2, running: false }])
    assert.equal(deliveryToken(sim.outcome!), token)
  }
  const byes = play(byeOptions, [{ type: 'running', tick: 245, seq: 1, running: false }])
  assert.equal(deliveryToken(byes.outcome!), 'Nb+1OT')
})
