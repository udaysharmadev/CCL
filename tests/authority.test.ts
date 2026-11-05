import assert from 'node:assert/strict'
import { on, once } from 'node:events'
import { test } from 'node:test'
import { Delivery } from '../src/cricket.ts'
import { applyDelivery, newInnings } from '../src/rules.ts'
import { startAuthoritySpike } from '../scripts/authority-spike.ts'

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function object(value: unknown): Record<string, unknown> {
  assert.ok(isObject(value))
  return value
}

function connect(url: string) {
  const socket = new WebSocket(url)
  const messages = on(socket, 'message', { close: ['close'], signal: AbortSignal.timeout(8_000) })
  return {
    send: (intent: object) => socket.send(JSON.stringify(intent)),
    async read(type: string) {
      const next = await messages.next()
      assert.equal(next.done, false)
      const [event] = next.value ?? []
      assert.ok(event instanceof MessageEvent && typeof event.data === 'string')
      const message = object(JSON.parse(event.data))
      assert.equal(message.type, type)
      return message
    },
  }
}

test('authority spike seals a real delivery and rejects forged, stale and wrong-role intents', async (t) => {
  const seed = 41
  const host = await startAuthoritySpike(0, () => seed)
  t.after(host.close)
  const bowler = connect(host.url)
  const bowlerHello = await bowler.read('hello')
  const batter = connect(host.url)
  const bowl = { type: 'bowl', seq: 1, delivery: 1, kind: 'fast', line: 0, effort: 0.63 }
  const shot = { kind: 'drive', aim: 0, power: 1 } as const
  const swing = { type: 'swing', seq: 1, delivery: 1, ...shot }

  const batterHello = await batter.read('hello')
  assert.equal(bowlerHello.role, 'bowler')
  assert.equal(batterHello.role, 'batter')
  assert.deepEqual(bowlerHello.state, batterHello.state)

  const extra = new WebSocket(host.url)
  const [extraClose] = await once(extra, 'close', { signal: AbortSignal.timeout(2_000) })
  assert.equal(extraClose.code, 1008)

  bowler.send({ ...bowl, runs: 600 })
  assert.equal((await bowler.read('reject')).code, 'invalid-intent')
  bowler.send({ ...bowl, effort: -1 })
  assert.equal((await bowler.read('reject')).code, 'invalid-intent')
  bowler.send({ ...bowl, seq: 2 })
  assert.equal((await bowler.read('reject')).code, 'out-of-order')
  batter.send(bowl)
  assert.equal((await batter.read('reject')).code, 'wrong-role')
  batter.send(swing)
  assert.equal((await batter.read('reject')).code, 'no-active-delivery')

  bowler.send(bowl)
  const released = await batter.read('snapshot')
  assert.deepEqual(await bowler.read('snapshot'), released)
  const releasedState = object(released.state)
  assert.equal(releasedState.revision, 1)
  assert.equal(releasedState.phase, 'flight')
  assert.equal(releasedState.last, null)

  bowler.send(bowl)
  assert.equal((await bowler.read('reject')).code, 'duplicate-sequence')
  batter.send({ ...swing, tick: 30 })
  assert.equal((await batter.read('reject')).code, 'invalid-intent')
  batter.send(swing)
  const swung = await batter.read('snapshot')
  assert.deepEqual(await bowler.read('snapshot'), swung)
  const swungState = object(swung.state)
  assert.equal(swungState.revision, 2)
  const tick = swungState.tick
  assert.ok(typeof tick === 'number' && Number.isInteger(tick))

  const dead = await batter.read('snapshot')
  assert.deepEqual(await bowler.read('snapshot'), dead)
  const deadState = object(dead.state)
  assert.equal(deadState.revision, 3)
  assert.equal(deadState.phase, 'await-bowl')
  assert.equal(deadState.delivery, 2)

  const sim = new Delivery({ seed, kind: 'fast', line: 0, effort: 0.63 })
  while (sim.tick < tick) sim.step()
  assert.ok(sim.swing(shot))
  for (let step = 0; step < 2_000 && !sim.outcome; step++) sim.step()
  assert.ok(sim.outcome)
  const { runs, wickets, legalBalls, attempts, freeHit } = applyDelivery(newInnings(), sim.outcome)
  assert.deepEqual(deadState.score, { runs, wickets, legalBalls, attempts, freeHit })
  assert.deepEqual(object(deadState.last).outcome, sim.outcome)
  assert.deepEqual(object(deadState.last).replay, {
    seed, plan: { kind: 'fast', line: 0, effort: 0.63 }, freeHit: false, swing: { tick, input: shot },
  })

  bowler.send({ ...bowl, seq: 2 })
  assert.equal((await bowler.read('reject')).code, 'wrong-delivery')
})
