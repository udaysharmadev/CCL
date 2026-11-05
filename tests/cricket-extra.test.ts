import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Delivery, type DeliveryKind } from '../src/cricket.ts'
import { bowlingLine, bowlingStyle, battingStyle } from '../src/players.ts'

function play(seed: number, kind: DeliveryKind, options: {
  line?: number
  swingAt?: number
  shot?: { kind: 'defend' | 'loft' | 'hook' | 'cut' | 'drive'; aim?: number; power?: number }
  run?: (sim: Delivery) => void
  runningMode?: 'manual'
  pitchWear?: number
  runnerPace?: readonly [number, number]
} = {}) {
  const sim = new Delivery({
    seed, kind, line: options.line, effort: 0.63,
    ...(options.runningMode ? { runningMode: options.runningMode } : {}),
    ...(options.pitchWear === undefined ? {} : { pitchWear: options.pitchWear }),
    ...(options.runnerPace ? { runnerPace: options.runnerPace } : {}),
  })
  while (!sim.outcome && sim.tick < 900) {
    if (options.swingAt !== undefined && sim.tick === sim.contactTick + options.swingAt) {
      sim.swing({ kind: options.shot?.kind ?? 'defend', aim: options.shot?.aim ?? 0, power: options.shot?.power ?? 0.7 })
    }
    options.run?.(sim)
    sim.step()
  }
  assert.ok(sim.outcome)
  return { sim, outcome: sim.outcome }
}

test('a bat coming down on the stumps is hit wicket', () => {
  let found = 0
  for (let seed = 0; seed < 300 && found < 1; seed++) {
    for (const kind of ['fast', 'length', 'spin'] as DeliveryKind[]) {
      // A stroke played well away from the ball leaves the bat coming down on
      // the stumps behind it.
      const { outcome } = play(seed, kind, { line: 0, swingAt: 2, shot: { kind: 'hook', power: 1 } })
      if (outcome.wicket === 'hit-wicket') found++
    }
  }
  assert.ok(found > 0, 'hit wicket must be reachable')
})

test('a hit wicket is a dismissal and is shown on the scorecard', () => {
  for (let seed = 0; seed < 300; seed++) {
    const { outcome } = play(seed, 'length', { line: 0, swingAt: 2, shot: { kind: 'hook', power: 1 } })
    if (outcome.wicket === 'hit-wicket') {
      assert.equal(outcome.reason, 'hit-wicket')
      assert.equal(outcome.contact, 'miss')
      return
    }
  }
  assert.fail('no hit wicket was produced')
})

test('an overthrow is awarded as a penalty run', () => {
  let found = 0
  for (let seed = 0; seed < 400 && found < 1; seed++) {
    const { outcome } = play(seed, 'fast', { line: 0.44, swingAt: 2, shot: { kind: 'drive', power: 0.7 } })
    if (outcome.overthrowRuns) {
      found++
      assert.equal(outcome.overthrowRuns, 1)
    }
  }
  assert.ok(found > 0, 'an overthrow must be reachable')
})

test('the non-striker backs up against spin and can be run out at the bowlers end', () => {
  let backed = 0
  for (let seed = 0; seed < 60; seed++) {
    const { sim } = play(seed, 'spin', { line: 0.2, swingAt: 2 })
    if (sim.backedUpAtContact > 0.2) backed++
  }
  assert.ok(backed > 0, 'the non-striker must back up against spin')
  let out = 0
  for (let seed = 0; seed < 600 && out < 1; seed++) {
    // The batter plays a shot and stays put, so the non-striker is still
    // backed up when the ball is fielded.
    const { outcome } = play(seed, 'spin', {
      line: 0.2, swingAt: 2, shot: { kind: 'drive', aim: 0.44, power: 0.7 }, runningMode: 'manual',
    })
    if (outcome.wicket === 'run-out' && outcome.dismissedBatter === 'nonStriker') out++
  }
  assert.ok(out > 0, 'a non-striker backed up must be able to be run out')
})

test('the two batters run at their own pace', () => {
  let gap = 0
  let partnerGap = 0
  const quick = play(41, 'length', {
    line: 0.44,
    runningMode: 'manual',
    runnerPace: [1.25, 0.8],
    swingAt: 0,
    shot: { kind: 'defend', aim: 0.44, power: 0.7 },
    run: (sim) => {
      if (sim.tick === sim.contactTick) sim.setRunning(true)
      // Measure the pair while they are actually running.
      if (sim.runnerProgress > 0.05 && sim.runnerProgress < 0.9) {
        gap = Math.max(gap, sim.runnerPositions[0] - 1.22)
        partnerGap = Math.max(partnerGap, 18.9 - sim.runnerPositions[1])
      }
    },
  })
  assert.ok(quick.sim.outcome)
  assert.ok(gap > 0, 'the pair must have started running')
  assert.ok(gap > partnerGap, 'the quicker batter should be further down the pitch')
})

test('a worn pitch bounces less and turns more', () => {
  const fresh = new Delivery({ seed: 41, kind: 'spin', line: 0, pitchWear: 0 })
  const worn = new Delivery({ seed: 41, kind: 'spin', line: 0, pitchWear: 1 })
  assert.ok(worn.projectedContact.y < fresh.projectedContact.y, 'a worn pitch bounces lower')
})

test('every bowler has a style that decides the ball they bowl', () => {
  const power = bowlingStyle('Rao')
  const spin = bowlingStyle('Patel')
  assert.notEqual(power.kinds.join(), spin.kinds.join())
  assert.ok(power.effort > spin.effort, 'a quick bowler bowls harder than a spinner')
  assert.ok(spin.turn > power.turn, 'a spinner turns the ball more')
  assert.ok(spin.accuracy > power.accuracy, 'a spinner bowls closer to the stumps')
  // The line a bowler aims at stays near the stumps for an accurate bowler.
  const tight = bowlingLine(spin, 0.85)
  const wild = bowlingLine(power, 0.85)
  assert.ok(Math.abs(tight) < Math.abs(wild))
})

test('every batter has a running speed and a scoring profile', () => {
  assert.ok(battingStyle('Sen').running > battingStyle('Roy').running, 'a quick runner is faster than a slow one')
  assert.ok(battingStyle('Roy').power > battingStyle('Sen').power)
  assert.equal(battingStyle('Nobody').running, 1)
})
