import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Delivery, type Shot } from '../src/cricket.ts'
import { newSixChallenge, scoreSix, SIX_ATTEMPTS } from '../src/six-challenge.ts'

function ball(kind: Shot, aim = 0, offset = 0) {
  const delivery = new Delivery({ seed: 41, kind: 'fast', line: 0.2 })
  for (let tick = 0; tick < 900 && !delivery.outcome; tick++) {
    if (delivery.tick === delivery.contactTick + offset) delivery.swing({ kind, aim, power: 1 })
    delivery.step()
  }
  assert.ok(delivery.outcome)
  return delivery
}

test('six distance measures first landing past the rope and replays identically', () => {
  const six = ball('loft')
  assert.equal(six.outcome?.batRuns, 6)
  assert.ok(six.landingDistance && six.landingDistance > Math.hypot(six.ball.x, six.ball.z - 0.46))
  assert.equal(six.landingDistance, ball('loft').landingDistance)
  const four = ball('drive')
  assert.equal(four.outcome?.batRuns, 4)
  assert.ok(four.landingDistance && four.landingDistance < Math.hypot(four.ball.x, four.ball.z - 0.46))
})

test('only full-flight sixes score and every attempt is committed once', () => {
  const initial = newSixChallenge()
  const unresolved = new Delivery({ seed: 41, kind: 'fast' })
  assert.strictEqual(scoreSix(initial, 1, unresolved), initial)
  const first = scoreSix(initial, 1, ball('loft'))
  assert.ok(first.points >= 245)
  assert.equal(first.streak, 1)
  assert.strictEqual(scoreSix(first, 1, ball('loft')), first)
  const second = scoreSix(first, 2, ball('drive'))
  assert.equal(second.points, first.points)
  assert.equal(second.streak, 0)
  assert.equal(second.attempts[1].validSix, false)
  let end = second
  for (let id = 3; id <= SIX_ATTEMPTS; id++) end = scoreSix(end, id, ball('loft'))
  assert.equal(end.complete, true)
  assert.equal(end.attempts.length, 5)
  assert.strictEqual(scoreSix(end, 6, ball('loft')), end)
  assert.equal(end.longest, first.longest)
})

test('precision and timing change points while a caught loft earns none', () => {
  const straight = scoreSix(newSixChallenge(), 1, ball('loft'))
  const angled = scoreSix(newSixChallenge(), 1, ball('loft', -0.65))
  assert.ok(angled.attempts[0].validSix)
  assert.ok(straight.points > angled.points)
  const caught = ball('drive', 0.94)
  assert.equal(caught.outcome?.wicket, 'caught')
  assert.equal(scoreSix(newSixChallenge(), 1, caught).points, 0)
  const mistimed = scoreSix(newSixChallenge(), 1, ball('loft', 0, -3))
  assert.ok(straight.points > mistimed.points)
})
