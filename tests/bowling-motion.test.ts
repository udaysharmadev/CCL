import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Scene, MeshLambertMaterial, MeshBasicMaterial, Vector3 } from 'three'
import { athlete, batterPose, bowlingPose } from '../src/stadium.ts'
import { sampleBowlingMotion } from '../src/bowling-motion.ts'
import { defaultPlayerProfile, compatibleActions } from '../src/player-profile.ts'
import { createBowlingExecution, bowlingReleasePoint, availableVariations } from '../src/bowling.ts'
import { Delivery, SHOTS } from '../src/cricket.ts'

function rig(role: 'batter' | 'bowler') {
  const surface = new MeshLambertMaterial()
  return athlete(new Scene(), { shirt: surface, pants: surface, trim: surface }, role, 1, new MeshBasicMaterial())
}

test('eight arm/style actions join the real release point over and around the wicket', () => {
  const actor = rig('bowler')
  for (const id of ['Rao', 'Khan', 'Das', 'Sen', 'Patel', 'Shah', 'Dutt', 'Joshi']) {
    const player = defaultPlayerProfile(id)
    for (const action of compatibleActions(player.bowling.type)) for (const side of ['over', 'around'] as const) {
      player.bowling.action = action
      const execution = createBowlingExecution(player, { variation: availableVariations(player)[0].id, line: .1, length: 5.5,
        power: .7, movement: .6, release: .95, side, batterHand: 'right' })
      const endpoint = bowlingReleasePoint(execution)
      const motion = bowlingPose(actor, 1, 'windup', 1, 0, execution, endpoint)
      actor.base.updateWorldMatrix(true, true)
      const hand = actor.arms[motion.armIndex].hand.getWorldPosition(new Vector3())
      assert.ok(hand.distanceTo(new Vector3(endpoint.x, endpoint.y, endpoint.z)) < .00001, `${id} ${action} ${side}: release is attached to active hand`)
      assert.equal(motion.armIndex, player.bowling.arm === 'left' ? 1 : 0)
      assert.equal(motion.frontFootIndex, player.bowling.arm === 'left' ? 0 : 1)
      const planted = actor.legs[motion.frontFootIndex].ankle.getWorldPosition(new Vector3())
      assert.ok(Math.abs(planted.y - .065 * 1.28) < .00001, `${id}: front foot grounded at release`)
    }
  }
})

test('last windup and first flight have identical hand positions; physics remains unchanged', () => {
  const player = defaultPlayerProfile('Khan')
  const execution = createBowlingExecution(player, { variation: 'stock', line: .2, length: 6.2, power: .8,
    movement: .6, release: .9, side: 'around', batterHand: 'left' })
  const delivery = new Delivery({ seed: 73, kind: 'fast', bowling: execution })
  const control = new Delivery({ seed: 73, kind: 'fast', bowling: execution })
  const actor = rig('bowler')
  bowlingPose(actor, 2.7, 'windup', 1, 0, execution, delivery.release.position)
  actor.base.updateWorldMatrix(true, true)
  const last = actor.arms[1].hand.getWorldPosition(new Vector3())
  bowlingPose(actor, 2.7, 'flight', 1, 0, execution, delivery.release.position)
  actor.base.updateWorldMatrix(true, true)
  assert.ok(last.distanceTo(actor.arms[1].hand.getWorldPosition(new Vector3())) < .00001)
  for (let tick = 0; tick < 90; tick++) {
    bowlingPose(actor, 3 + tick / 60, 'flight', 1, tick / 60, execution, delivery.release.position)
    delivery.step(); control.step()
    assert.deepEqual(delivery.ball, control.ball)
  }
})

test('pace, medium, finger and wrist action choreography is distinct and repeatable', () => {
  const samples = ['Rao', 'Sen', 'Patel', 'Shah'].map(id => {
    const player = defaultPlayerProfile(id)
    const result = sampleBowlingMotion(player.bowling, 'windup', .76)
    assert.deepEqual(result, sampleBowlingMotion(player.bowling, 'windup', .76))
    assert.equal(result.stage, 'gather')
    return result
  })
  assert.equal(new Set(samples.map(s => s.runDistance)).size, 4)
  assert.ok(samples[0].runAmount > samples[2].runAmount)
  assert.notEqual(samples[2].wrist, samples[3].wrist)
  assert.notEqual(samples[2].twist, samples[3].twist)
  for (const [progress, stage] of [[0, 'mark'], [.3, 'run'], [.72, 'gather'], [.85, 'plant'], [.98, 'release']] as const)
    assert.equal(sampleBowlingMotion(defaultPlayerProfile('Rao').bowling, 'windup', progress).stage, stage)
  assert.equal(sampleBowlingMotion(defaultPlayerProfile('Rao').bowling, 'flight', 1, .2).stage, 'follow-through')
  assert.equal(sampleBowlingMotion(defaultPlayerProfile('Rao').bowling, 'flight', 1, 1).stage, 'recover')
})

test('run-up accelerates into a continuous approach and finishes exactly at the release mark', () => {
  for (const id of ['Rao', 'Khan', 'Sen', 'Patel', 'Shah']) {
    const appearance = defaultPlayerProfile(id).bowling
    let previous = sampleBowlingMotion(appearance, 'windup', 0)
    for (let frame = 1; frame <= 300; frame++) {
      const motion = sampleBowlingMotion(appearance, 'windup', frame / 300)
      assert.ok(motion.distanceRemaining <= previous.distanceRemaining + 1e-9, `${id}: approach never reverses`)
      assert.ok(previous.distanceRemaining - motion.distanceRemaining < .05, `${id}: no root jump`)
      assert.ok(Object.values(motion).every(value => typeof value !== 'number' || Number.isFinite(value)))
      previous = motion
    }
    assert.equal(previous.distanceRemaining, 0)
    assert.equal(previous.armCircle, 1)
    assert.equal(previous.gather, 0)
    const start = sampleBowlingMotion(appearance, 'flight', 1, 0)
    assert.equal(start.distanceRemaining, previous.distanceRemaining)
    assert.equal(start.armCircle, previous.armCircle)
    assert.equal(start.lean, previous.lean)
    assert.equal(start.twist, previous.twist)
    assert.ok(sampleBowlingMotion(appearance, 'flight', 1, .4).armCircle > 1, `${id}: arm completes its wheel after release`)
  }
})

test('delivery hand, hips and shoes remain continuous through the full action and recovery', () => {
  const actor = rig('bowler')
  for (const id of ['Rao', 'Khan', 'Patel', 'Shah']) {
    const player = defaultPlayerProfile(id)
    const execution = createBowlingExecution(player, { variation: availableVariations(player)[0].id,
      line: .1, length: 5.5, power: .8, movement: .6, release: 1, side: 'over', batterHand: 'right' })
    const endpoint = bowlingReleasePoint(execution)
    let previousHand: Vector3 | undefined
    let previousRoot: Vector3 | undefined
    let plantedFoot: Vector3 | undefined
    for (let frame = 0; frame <= 270; frame++) {
      const following = frame > 180
      const age = following ? (frame - 180) / 60 : 0
      const motion = bowlingPose(actor, 0, following ? 'flight' : 'windup', following ? 1 : frame / 180, age, execution, endpoint)
      actor.base.updateWorldMatrix(true, true)
      const hand = actor.arms[motion.armIndex].hand.getWorldPosition(new Vector3())
      if (previousHand) assert.ok(previousHand.distanceTo(hand) < .22, `${id} frame ${frame}: hand does not pop`)
      if (previousRoot) assert.ok(previousRoot.distanceTo(actor.base.position) < .085, `${id} frame ${frame}: hips do not teleport`)
      for (const leg of actor.legs) assert.ok(leg.ankle.getWorldPosition(new Vector3()).y >= .07, `${id}: shoes stay above the surface`)
      if (frame === 180) plantedFoot = actor.legs[motion.frontFootIndex].ankle.getWorldPosition(new Vector3())
      if (frame >= 180 && frame <= 187) {
        const frontFoot = actor.legs[motion.frontFootIndex].ankle.getWorldPosition(new Vector3())
        assert.ok(Math.abs(frontFoot.y - .065 * 1.28) < .00001,
          `${id}: front foot braces the first follow-through frames`)
        assert.ok(frontFoot.distanceTo(plantedFoot!) < .00001, `${id}: braced shoe does not slide`)
      }
      previousHand = hand
      previousRoot = actor.base.position.clone()
    }
  }
})

test('left batting reverses stance, leading foot and top/bottom hands without negative model scale', () => {
  const actor = rig('batter')
  actor.base.position.set(-.57, 0, .08)
  batterPose(actor, 0, undefined, 'drive', -.65, undefined, 1, 'left')
  actor.base.updateWorldMatrix(true, true)
  assert.equal(actor.base.scale.x, 1)
  assert.equal(actor.base.rotation.y, 1.32)
  const frontBefore = actor.legs[0].ankle.getWorldPosition(new Vector3())
  batterPose(actor, 0, 5 / 60, 'drive', -.65, { x: -.1, y: .55, z: .46 }, 1, 'left')
  actor.base.updateWorldMatrix(true, true)
  assert.ok(actor.legs[0].ankle.getWorldPosition(new Vector3()).z > frontBefore.z + .3)
  actor.arms.forEach((arm, i) => {
    const glove = arm.hand.getWorldPosition(new Vector3())
    const grip = actor.bat!.localToWorld(new Vector3(0, i === 0 ? -.045 : -.145, 0))
    assert.ok(glove.distanceTo(grip) < .00001)
  })
})

test('all left-handed strokes keep planted feet and both hands attached to their swapped grips', () => {
  const actor = rig('batter')
  actor.base.position.set(-.57, 0, .08)
  for (const shot of SHOTS) for (const frame of [0, 5, 18, 42, 66]) {
    batterPose(actor, 0, frame / 60, shot, -.65, { x: -.1, y: .55, z: .46 }, 1, 'left')
    actor.base.updateWorldMatrix(true, true)
    actor.arms.forEach((arm, i) => assert.ok(arm.hand.getWorldPosition(new Vector3()).distanceTo(
      actor.bat!.localToWorld(new Vector3(0, i === 0 ? -.045 : -.145, 0))) < .00001, `${shot}: attached grip`))
    actor.legs.forEach(leg => assert.ok(Math.abs(leg.ankle.getWorldPosition(new Vector3()).y - .065) < .00001, `${shot}: planted feet`))
  }
})

test('left-handed drive, sweep, pull and scoop meet the physical ball at contact', () => {
  const actor = rig('batter')
  actor.base.position.set(-.57, 0, .08)
  for (const [shot, y, angle] of [['cover-drive', .55, -.65], ['sweep', .25, 1.4], ['pull', 1.05, 1.4], ['scoop', .4, -2.6]] as const) {
    batterPose(actor, 0, 5 / 60, shot, angle, { x: -.1, y, z: .46 }, 1, 'left')
    actor.base.updateWorldMatrix(true, true)
    assert.ok(actor.bat!.localToWorld(new Vector3(0, -.525, 0)).distanceTo(new Vector3(-.1, y, .46)) < .001, shot)
  }
})
