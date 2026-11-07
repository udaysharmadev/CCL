import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPlayerMotion, samplePlayerMotion, createFieldingMotion, sampleFieldingMotion } from '../src/player-motion.ts'
import { Delivery, DT, type DeliveryOptions } from '../src/cricket.ts'

test('locomotion follows each athlete’s distance, settles on arrival and reuses its state', () => {
  const fast = createPlayerMotion()
  const slow = createPlayerMotion()
  samplePlayerMotion(fast, 0, 0, 0)
  samplePlayerMotion(slow, 0, 0, 0)
  for (let tick = 1; tick <= 60; tick++) {
    assert.equal(samplePlayerMotion(fast, 0, tick * DT * 7, tick * DT), fast)
    samplePlayerMotion(slow, 0, tick * DT * 4.5, tick * DT)
  }
  assert.ok(fast.speed > slow.speed)
  assert.ok(fast.amount > slow.amount)
  assert.notEqual(fast.phase, slow.phase, 'different paces must not share one synchronized stride')
  const arrivedPhase = fast.phase
  for (let tick = 61; tick <= 90; tick++) {
    samplePlayerMotion(fast, 0, 7, tick * DT)
    samplePlayerMotion(slow, 0, tick * DT * 4.5, tick * DT)
  }
  assert.equal(fast.phase, arrivedPhase, 'a planted runner does not keep cycling their feet')
  assert.equal(fast.amount, 0)
  assert.ok(slow.amount > .7)
})

test('turns take the shortest bounded rotation instead of snapping 180 degrees', () => {
  const motion = createPlayerMotion(Math.PI - .05)
  samplePlayerMotion(motion, 0, 0, 0)
  samplePlayerMotion(motion, -.01, -.1, DT)
  assert.ok(Math.abs(motion.yaw - Math.PI) < .2, 'angle wrap does not spin around the long way')
  const prior = motion.yaw
  samplePlayerMotion(motion, -.01, 0, DT * 2)
  assert.ok(Math.abs(motion.yaw - prior) <= 12 * DT + 1e-12)
  assert.ok(Math.abs(motion.yaw) > 2, 'turn-back begins with a pivot, not a snapped heading')
  for (let tick = 3; tick < 35; tick++) samplePlayerMotion(motion, -.01, (tick - 2) * .1, tick * DT)
  assert.ok(Math.abs(Math.sin(motion.yaw)) < 1e-10)
  assert.ok(Math.cos(motion.yaw) > .999)
})

test('duplicate rendered ticks freeze movement and rewinds clear velocity and pose history', () => {
  const motion = createPlayerMotion(.4, .7)
  samplePlayerMotion(motion, 0, 0, 0)
  for (let tick = 1; tick <= 30; tick++) samplePlayerMotion(motion, 0, tick * .1, tick * DT)
  const paused = { ...motion }
  for (let render = 0; render < 120; render++) samplePlayerMotion(motion, 0, 3, .5)
  assert.deepEqual(motion, paused)
  samplePlayerMotion(motion, 0, 0, 0)
  assert.equal(motion.phase, .7)
  assert.equal(motion.yaw, .4)
  assert.equal(motion.speed, 0)
  assert.equal(motion.lift, 0)
})

test('new deliveries and field-layout jumps do not produce spurious sprint poses', () => {
  const motion = createPlayerMotion()
  samplePlayerMotion(motion, 0, 0, 0)
  samplePlayerMotion(motion, 30, 30, DT)
  assert.equal(motion.amount, 0)
  samplePlayerMotion(motion, 30.1, 30, DT * 2)
  assert.ok(motion.amount > 0)
  samplePlayerMotion(motion, -10, 17, DT * 3, true)
  assert.equal(motion.speed, 0)
  assert.equal(motion.swing, 0)
})

test('fielding transitions gather the ball, prepare the throw and recover after release', () => {
  const motion = createFieldingMotion()
  assert.equal(sampleFieldingMotion(motion, 'pickup', 4), motion)
  assert.ok(motion.crouch > .2)
  const pickup = motion.throwArm
  sampleFieldingMotion(motion, 'pickup', 4.25)
  assert.ok(motion.crouch < .06)
  assert.ok(motion.throwArm < pickup)
  sampleFieldingMotion(motion, 'hold', 4.3)
  const held = { ...motion }
  sampleFieldingMotion(motion, 'hold', 8)
  assert.equal(motion.throwArm, held.throwArm, 'manual possession holds a stable set position')
  sampleFieldingMotion(motion, 'return', 8.1)
  sampleFieldingMotion(motion, 'return', 8.3)
  assert.ok(motion.throwArm > 0, 'throw follows through across the body')
  sampleFieldingMotion(motion, 'return', 8.9)
  assert.equal(motion.throwArm, 0)
  assert.equal(motion.twist, 0)
  sampleFieldingMotion(motion, 'pickup', 1, true)
  assert.ok(motion.crouch > .2, 'replay starts the pickup sequence afresh')
})

const retreatOptions: DeliveryOptions = {
  seed: 8, kind: 'fast', line: .44, effort: .63, bowler: 'Mehta',
  runningMode: 'manual', runnerPace: [1.25, .8],
}

test('H6 presentation: faster batter rests while slower partner finishes a real coordinated retreat', () => {
  const sim = new Delivery(retreatOptions)
  const control = new Delivery(retreatOptions)
  const striker = createPlayerMotion()
  const partner = createPlayerMotion(Math.PI, .7)
  let sawFirstArrival = false
  let sawStrikerHome = false
  while (!sim.outcome && sim.tick < 1000) {
    for (const delivery of [sim, control]) {
      if (delivery.tick === 37) delivery.swing({ kind: 'drive', aim: 0, power: .7 })
      if (delivery.tick === 39) delivery.setRunning(true)
      if (delivery.tick === 250) delivery.setRunning(false)
    }
    const positions = sim.runnerPositions
    samplePlayerMotion(striker, .57, positions[0], sim.tick * DT)
    samplePlayerMotion(partner, -.84, positions[1], sim.tick * DT)
    // Multiple RAFs between fixed simulation ticks have no effect on the pose.
    const phase = striker.phase
    samplePlayerMotion(striker, .57, positions[0], sim.tick * DT)
    assert.equal(striker.phase, phase)
    if (sim.tick === 240) {
      sawFirstArrival = true
      assert.equal(sim.runnerProgress, 1)
      assert.ok(sim.partnerProgress < 1)
      assert.equal(striker.amount, 0)
      assert.ok(partner.amount > .7)
      assert.equal(sim.completedRuns, 0)
    }
    if (sim.tick === 432) {
      sawStrikerHome = true
      assert.equal(sim.runnerProgress, 0)
      assert.ok(sim.partnerProgress > 0)
      assert.equal(striker.amount, 0)
      assert.ok(partner.amount > .7, 'partner keeps its own return stride after the striker is home')
      assert.equal(sim.runnersReturning, true)
    }
    sim.step()
    control.step()
    assert.deepEqual(sim.runnerPositions, control.runnerPositions)
    assert.deepEqual(sim.ball, control.ball)
    assert.equal(sim.completedRuns, control.completedRuns)
  }
  assert.ok(sawFirstArrival && sawStrikerHome)
  assert.equal(sim.tick, 676)
  assert.deepEqual(sim.outcome, control.outcome, 'render observations cannot alter physics, random draws or scoring')
  assert.equal(sim.outcome?.completedRuns, 0)
})

test('reconstructing the same delivery produces the same movement observations after a reset', () => {
  const motion = createPlayerMotion(0, .37)
  function record() {
    const delivery = new Delivery(retreatOptions)
    const samples: number[][] = []
    while (delivery.tick <= 480) {
      if (delivery.tick === 37) delivery.swing({ kind: 'drive', aim: 0, power: .7 })
      if (delivery.tick === 39) delivery.setRunning(true)
      if (delivery.tick === 250) delivery.setRunning(false)
      samplePlayerMotion(motion, 0, delivery.runnerPositions[0], delivery.tick * DT, delivery.tick === 0)
      samples.push([motion.speed, motion.phase, motion.yaw, motion.swing, motion.lift])
      delivery.step()
    }
    return samples
  }
  assert.deepEqual(record(), record())
})
