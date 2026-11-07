import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Delivery, PITCH_LENGTH, type DeliveryOptions } from '../src/cricket.ts'
import { DeliveryReplay } from '../src/delivery-replay.ts'
import type { OnlineDeliveryCommand } from '../src/online-contract.ts'
import { applyDelivery, newInnings } from '../src/rules.ts'
import { overSummary, totalRuns } from '../src/scorecard.ts'

// All fixtures use the real seeded no-ball draw, physics, keeper, runners and
// finalizer. No private field, random draw, completed-run count or outcome is set.
const byeOptions: DeliveryOptions = {
  seed: 12, kind: 'yorker', line: .4, effort: 1, fieldingMode: 'manual', bowler: 'Mehta',
}
const legByeOptions: DeliveryOptions = {
  seed: 13, kind: 'fast', line: -.2, effort: 1, fieldingMode: 'manual', bowler: 'Mehta',
}
const nearCrease = 1.22
const farCrease = PITCH_LENGTH - nearCrease

function stepTo(sim: Delivery, tick: number) {
  while (sim.tick < tick && !sim.outcome) sim.step()
  assert.equal(sim.tick, tick)
}

function finish(sim: Delivery) {
  while (!sim.outcome && sim.tick < 1500) sim.step()
  assert.ok(sim.outcome, 'the production delivery must reach a dead ball')
  return sim
}

function fumble(options: DeliveryOptions = byeOptions) {
  const sim = new Delivery(options)
  stepTo(sim, 44)
  assert.equal(sim.parried, false)
  sim.step()
  assert.equal(sim.tick, 45)
  assert.equal(sim.action, 'chase')
  assert.equal(sim.parried, true)
  assert.equal(sim.contact, 'miss')
  assert.equal(sim.padContact, false)
  assert.equal(sim.completedRuns, 0)
  assert.deepEqual([sim.runnerProgress, sim.partnerProgress], [0, 0])
  assert.deepEqual(sim.runnerPositions, [nearCrease, farCrease - sim.backedUp])
  return sim
}

function scored(sim: Delivery, expected: {
  bat?: number; byes?: number; legByes?: number; overthrow?: number; completed: number; wickets?: number
}) {
  assert.ok(sim.outcome)
  const { bat = 0, byes = 0, legByes = 0, overthrow = 0, completed, wickets = 0 } = expected
  const outcome = sim.outcome
  assert.equal(outcome.noBall, 1, 'one automatic penalty from the natural no-ball draw')
  assert.equal(outcome.wide, 0)
  assert.equal(outcome.batRuns, bat)
  assert.equal(outcome.byes, byes)
  assert.equal(outcome.legByes, legByes)
  assert.equal(outcome.overthrowRuns ?? 0, overthrow)
  assert.equal(outcome.penalty ?? 0, 0)
  assert.equal(outcome.completedRuns, completed)
  assert.equal(sim.completedRuns, completed)
  const innings = applyDelivery(newInnings(2, undefined, ['A', 'B', 'C']), outcome)
  assert.equal(innings.runs, 1 + bat + byes + legByes + overthrow)
  assert.equal(totalRuns(outcome), innings.runs, 'scorecard and reducer use the same components')
  assert.deepEqual(innings.extras, { wide: 0, noBall: 1, byes, legByes, penalty: overthrow })
  assert.equal(innings.batting.reduce((runs, batter) => runs + batter.runs, 0) +
    Object.values(innings.extras).reduce((a, b) => a + b, 0), innings.runs)
  assert.equal(innings.batting[0].runs, bat)
  assert.equal(innings.batting[0].balls, 0)
  assert.deepEqual(innings.bowling, [{
    name: 'Mehta', balls: 0, runs: 1 + bat + overthrow, wickets: 0, maidens: 0, wides: 0, noBalls: 1,
  }])
  assert.equal(innings.legalBalls, 0)
  assert.equal(innings.attempts, 1)
  assert.equal(innings.wickets, wickets)
  assert.equal(innings.freeHit, true)
  assert.equal(innings.complete, false)
  assert.deepEqual(innings.history, [outcome])
  assert.equal(innings.partnerships[0].runs, innings.runs)
  assert.equal(innings.partnerships[0].balls, 0)
  const overs = overSummary(innings)
  assert.equal(overs.length, 1)
  assert.equal(overs[0].runs, innings.runs)
  assert.equal(overs[0].legal, 0)
  return innings
}

test('H4: a collected no-ball records exactly its automatic penalty', () => {
  const sim = finish(new Delivery({ seed: 6, kind: 'fast', line: .4, effort: 1, bowler: 'Mehta' }))
  assert.equal(sim.tick, 44)
  assert.equal(sim.outcome?.reason, 'collected')
  const innings = scored(sim, { completed: 0 })
  assert.deepEqual([innings.striker, innings.nonStriker], [1, 2])
})

test('H4: a completed batter run remains separate from the no-ball penalty', () => {
  const sim = new Delivery({ seed: 6, kind: 'fast', line: .4, effort: 1, bowler: 'Mehta' })
  stepTo(sim, 32)
  assert.equal(sim.contactTick, 32)
  assert.ok(sim.swing({ kind: 'defend', aim: -1.35, power: .7 }))
  stepTo(sim, 235)
  assert.equal(sim.completedRuns, 0)
  sim.step()
  assert.equal(sim.completedRuns, 1)
  finish(sim)
  assert.equal(sim.tick, 237)
  assert.equal(sim.outcome?.contact, 'middle')
  const innings = scored(sim, { bat: 1, completed: 1 })
  assert.deepEqual([innings.striker, innings.nonStriker], [2, 1])
})

test('H4/H3: an incomplete keeper-fumble attempt on a no-ball scores only the penalty', () => {
  const sim = fumble({ ...byeOptions, fieldingMode: undefined })
  finish(sim)
  assert.equal(sim.tick, 83)
  assert.ok(sim.runnerProgress > 0 && sim.runnerProgress < .5)
  assert.ok(sim.partnerProgress > 0 && sim.partnerProgress < .5)
  const innings = scored(sim, { completed: 0 })
  assert.deepEqual([innings.striker, innings.nonStriker], [1, 2])
})

test('H4: a completed bye survives no-ball finalization after running stops', () => {
  const sim = fumble()
  stepTo(sim, 244)
  assert.equal(sim.completedRuns, 0)
  sim.step()
  assert.equal(sim.completedRuns, 1)
  assert.deepEqual(sim.runnerPositions, [farCrease, nearCrease])
  assert.ok(sim.setRunning(false))
  finish(sim)
  assert.equal(sim.tick, 604)
  assert.equal(sim.outcome?.reason, 'fielded')
  const innings = scored(sim, { byes: 1, completed: 1 })
  assert.deepEqual([innings.striker, innings.nonStriker], [2, 1])
})

test('H4: a no-ball beyond the wide line preserves a completed bye without adding a wide', () => {
  const sim = fumble({ ...byeOptions, line: 1.4 })
  assert.ok(sim.projectedContact.x > 1.11, 'outside the existing pace-bowling wide threshold')
  stepTo(sim, 245)
  assert.equal(sim.completedRuns, 1)
  assert.ok(sim.setRunning(false))
  finish(sim)
  assert.equal(sim.tick, 607)
  const innings = scored(sim, { byes: 1, completed: 1 })
  assert.deepEqual([innings.striker, innings.nonStriker], [2, 1])
})

test('H4: multiple completed byes survive a permitted run-out on a no-ball', () => {
  const sim = fumble()
  stepTo(sim, 245)
  assert.equal(sim.completedRuns, 1)
  stepTo(sim, 427)
  assert.equal(sim.completedRuns, 1)
  sim.step()
  assert.equal(sim.completedRuns, 2)
  assert.deepEqual(sim.runnerPositions, [nearCrease, farCrease])
  finish(sim)
  assert.equal(sim.tick, 604)
  assert.ok(sim.runnerProgress > .96 && sim.runnerProgress < 1)
  assert.ok(sim.partnerProgress > .96 && sim.partnerProgress < 1)
  assert.equal(sim.outcome?.wicket, 'run-out')
  assert.equal(sim.outcome?.dismissedBatter, 'nonStriker')
  assert.equal(sim.outcome?.crossed, true)
  const innings = scored(sim, { byes: 2, completed: 2, wickets: 1 })
  assert.equal(innings.batting[0].dismissed, false)
  assert.equal(innings.batting[1].dismissed, true)
  assert.deepEqual(innings.fallOfWickets, [{ batter: 2, runs: 3, overs: 0 }])
  assert.deepEqual([innings.striker, innings.nonStriker], [3, 1])
})

// The natural fumble occurs at 45, first grounding at 245 and second at 428.
// A keeper-end throw takes 73 ticks from the accepted control to the bail break.
for (const [throwTick, endTick, completed, wicket] of [
  [171, 244, 0, 'run-out'],
  [172, 245, 1, null],
  [173, 246, 1, 'run-out'],
  [355, 428, 2, null],
] as const) {
  test(`H4/H3: no-ball throw at ${throwTick}, wicket break at ${endTick}, counts ${completed} grounded runs`, () => {
    const sim = fumble()
    stepTo(sim, throwTick)
    assert.ok(sim.fieldControl({ type: 'throw', end: 'striker' }))
    finish(sim)
    assert.equal(sim.tick, endTick)
    assert.equal(sim.wicketBroken, true)
    assert.equal(sim.outcome?.wicket, wicket)
    const innings = scored(sim, { byes: completed, completed, wickets: Number(wicket !== null) })
    if (wicket) {
      assert.ok(sim.runnerPositions.every(z => z > nearCrease && z < farCrease))
      assert.equal(sim.outcome?.dismissedBatter, 'nonStriker')
      assert.deepEqual([innings.striker, innings.nonStriker], [3, 1])
    } else {
      assert.deepEqual([sim.runnerProgress, sim.partnerProgress], [0, 0])
      assert.deepEqual(sim.runnerPositions, completed === 1 ? [farCrease, nearCrease] : [nearCrease, farCrease])
      assert.deepEqual([innings.striker, innings.nonStriker], completed === 1 ? [2, 1] : [1, 2])
    }
  })
}

test('H4: three legitimate leg-byes are retained separately from the no-ball', () => {
  const sim = new Delivery(legByeOptions)
  stepTo(sim, 29)
  assert.equal(sim.contactTick, 33)
  assert.ok(sim.swing({ kind: 'hook', aim: 0, power: .7 }))
  for (const [tick, completed] of [[262, 1], [445, 2], [628, 3]] as const) {
    stepTo(sim, tick - 1)
    assert.equal(sim.completedRuns, completed - 1)
    sim.step()
    assert.equal(sim.completedRuns, completed)
  }
  finish(sim)
  assert.equal(sim.tick, 663)
  assert.equal(sim.outcome?.contact, 'miss')
  assert.equal(sim.outcome?.padContact, true)
  assert.equal(sim.outcome?.shotOffered, true)
  const innings = scored(sim, { legByes: 3, completed: 3 })
  assert.deepEqual([innings.striker, innings.nonStriker], [2, 1])
})

test('H4: pad contact without an offered stroke does not become byes or leg-byes', () => {
  const sim = finish(new Delivery(legByeOptions))
  assert.equal(sim.tick, 663)
  assert.equal(sim.outcome?.padContact, true)
  assert.equal(sim.outcome?.shotOffered, false)
  scored(sim, { completed: 3 })
})

test('H4: the no-ball still suppresses a bowled dismissal', () => {
  const sim = finish(new Delivery({ seed: 6, kind: 'fast', line: .1, effort: 1, bowler: 'Mehta' }))
  assert.equal(sim.tick, 37)
  assert.equal(sim.outcome?.reason, 'bowled')
  assert.equal(sim.outcome?.wicket, null)
  const innings = scored(sim, { completed: 0 })
  assert.equal(innings.batting[0].dismissed, false)
  assert.deepEqual([innings.striker, innings.nonStriker], [1, 2])
})

test('H4: a no-ball, completed bye and overthrow remain three separate scoring components', () => {
  const sim = fumble({ ...byeOptions, seed: 451 })
  stepTo(sim, 245)
  assert.equal(sim.completedRuns, 1)
  assert.ok(sim.setRunning(false))
  finish(sim)
  assert.equal(sim.tick, 604)
  assert.equal(sim.outcome?.reason, 'fielded')
  const innings = scored(sim, { byes: 1, overthrow: 1, completed: 1 })
  assert.deepEqual([innings.striker, innings.nonStriker], [2, 1])
})

for (const [label, options, commands, byes, legByes, completed] of [
  ['bye', byeOptions, [{ type: 'running', tick: 245, seq: 1, running: false }], 1, 0, 1],
  ['leg-byes', legByeOptions, [{ type: 'swing', tick: 29, seq: 1, input: { kind: 'hook', aim: 0, power: .7 } }], 0, 3, 3],
] satisfies [string, DeliveryOptions, OnlineDeliveryCommand[], number, number, number][]) {
  test(`H4/H1: serialized ${label} replay preserves accepted commands and repeated targets do not duplicate completion`, () => {
    const source = { options, version: 2 as const, commands }
    const live = new Delivery(options)
    while (!live.outcome && live.tick < 1500) {
      for (const command of commands) if (command.tick === live.tick) {
        assert.ok(command.type === 'swing' ? live.swing(command.input) : live.setRunning(command.running))
      }
      live.step()
    }
    const innings = scored(live, { byes, legByes, completed })
    const record = JSON.parse(JSON.stringify(source)) as typeof source
    const replay = new DeliveryReplay(record)
    for (const tick of [29, 29, 44, 45, 244, 245, 245, 262, 428, 628, 1500, 1500]) {
      assert.ok(replay.advanceTo(tick))
    }
    assert.deepEqual(replay.commands, commands)
    assert.deepEqual(record, source, 'reconstruction must not rewrite accepted history')
    assert.deepEqual(replay.sim.outcome, live.outcome)
    assert.deepEqual(replay.sim.runnerPositions, live.runnerPositions)
    assert.deepEqual(applyDelivery(newInnings(2, undefined, ['A', 'B', 'C']), replay.sim.outcome!), innings)
    const sealed = JSON.parse(JSON.stringify(live.outcome))
    const finalTick = live.tick
    for (let repeat = 0; repeat < 10; repeat++) live.step()
    assert.equal(live.tick, finalTick)
    assert.equal(live.completedRuns, completed)
    assert.deepEqual(live.outcome, sealed)
    // applyDelivery is a reducer, not an idempotent event store. The browser
    // smoke covers the controller's once-only commit across UI replay.
    assert.equal(innings.attempts, 1)
    assert.equal(innings.history.length, 1)
  })
}
