import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { on, once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { WebSocket } from 'ws'
import { DEFAULT_LINEUP } from '../src/match-data.ts'
import { Delivery, DT } from '../src/cricket.ts'
import { ONLINE_WINDUP_MS, type OnlineServerMessage, type OnlineSnapshot } from '../src/online-contract.ts'
import { applyDelivery, newInnings, type Innings } from '../src/rules.ts'
import { startOnlineServer } from '../scripts/online-server.ts'

async function connect(url: string, pongDelay = 0) {
  const socket = new WebSocket(url, { autoPong: pongDelay === 0 })
  if (pongDelay) socket.on('ping', (data) => {
    setTimeout(() => { if (socket.readyState === WebSocket.OPEN) socket.pong(data) }, pongDelay)
  })
  const messages = on(socket, 'message', { close: ['close'], signal: AbortSignal.timeout(10_000) })
  await once(socket, 'open')
  async function read(check: (message: OnlineServerMessage) => boolean) {
    for (;;) {
      const next = await messages.next()
      assert.equal(next.done, false)
      const message: OnlineServerMessage = JSON.parse(String(next.value?.[0]))
      if (check(message)) return message
    }
  }
  return {
    send(message: unknown) { socket.send(JSON.stringify(message)) },
    async session() {
      const message = await read((entry) => entry.type === 'session')
      assert.equal(message.type, 'session')
      return message
    },
    async snapshot(check: (state: OnlineSnapshot) => boolean) {
      const message = await read((entry) => entry.type === 'snapshot' && check(entry.state))
      assert.equal(message.type, 'snapshot')
      return message.state
    },
    async ack(nextSeq: number) {
      const message = await read((entry) => entry.type === 'ack')
      assert.deepEqual(message, { type: 'ack', nextSeq })
    },
    async rejection(code: string, nextSeq: number | null) {
      const message = await read((entry) => entry.type === 'reject')
      assert.deepEqual(message, { type: 'reject', code, nextSeq })
    },
    async close() {
      const closed = once(socket, 'close')
      socket.close()
      await closed
    },
  }
}

function auditDelivery(event: OnlineSnapshot['last'], innings: Innings) {
  assert.ok(event)
  const { checksum, ...sealed } = event
  assert.equal(createHash('sha256').update(JSON.stringify(sealed)).digest('hex'), checksum)
  const { options, shot } = event.replay
  const sim = new Delivery(options)
  if (shot) {
    while (sim.tick < shot.tick && !sim.outcome) sim.step()
    assert.ok(sim.swing(shot.input))
  }
  for (let i = 0; i < 2_000 && !sim.outcome; i++) sim.step()
  assert.ok(sim.outcome)
  const score = applyDelivery(innings, sim.outcome)
  assert.deepEqual(score.history.at(-1), event.outcome)
  return score
}

test('quick play waits for a human, owns roles and sequences, and reconnects the same seat', async (t) => {
  let now = 1000
  const host = await startOnlineServer({ clock: () => now, toss: () => 0, nextSeed: () => 41 })
  t.after(host.close)
  const crossOrigin = new WebSocket(host.url, { origin: 'https://untrusted.example' })
  await assert.rejects(once(crossOrigin, 'open'), /server response: 401/)
  const a = await connect(host.url)
  a.send({ type: 'quick' })
  const session = await a.session()
  assert.equal(session.seat, 0)
  const waiting = await a.snapshot((state) => state.phase === 'lobby')
  assert.equal(waiting.overs, 5)
  assert.deepEqual(waiting.connected, [true, false])
  assert.equal(waiting.tossWinner, null)
  assert.equal(waiting.active, null)

  const privateHost = await connect(host.url)
  privateHost.send({ type: 'create', overs: 21 })
  await privateHost.rejection('invalid-message', null)
  privateHost.send({ type: 'create', overs: 20 })
  assert.notEqual((await privateHost.session()).room, session.room)
  assert.equal((await privateHost.snapshot((state) => state.phase === 'lobby')).overs, 20)

  const b = await connect(host.url)
  b.send({ type: 'quick' })
  const second = await b.session()
  assert.equal(second.seat, 1)
  assert.equal(second.room, session.room)
  const toss = await a.snapshot((state) => state.phase === 'toss')
  assert.deepEqual(toss, await b.snapshot((state) => state.phase === 'toss'))
  assert.deepEqual(toss.connected, [true, true])
  assert.equal(toss.tossWinner, 0)
  b.send({ type: 'toss', seq: 1, choice: 'bat' })
  await b.rejection('wrong-seat', 1)
  a.send({ type: 'toss', seq: 1, choice: 'bat' })
  await a.ack(2)
  const ready = await a.snapshot((state) => state.phase === 'ready')
  assert.equal(ready.battingSeat, 0)
  assert.equal(ready.delivery, 1)

  const bowl = { type: 'bowl', seq: 1, delivery: 1, kind: 'fast', line: 0, effort: 0.63 }
  a.send({ ...bowl, seq: 2 })
  await a.rejection('wrong-seat', 2)
  b.send({ ...bowl, seq: 2 })
  await b.rejection('out-of-order', 1)
  b.send({ ...bowl, seed: 41 })
  await b.rejection('invalid-message', 1)
  b.send(bowl)
  await b.ack(2)
  const windup = await a.snapshot((state) => state.phase === 'windup')
  assert.equal(windup.windupRemainingMs, ONLINE_WINDUP_MS)
  assert.equal(windup.active, null)
  b.send(bowl)
  await b.rejection('duplicate-sequence', 2)

  now += ONLINE_WINDUP_MS
  const released = await a.snapshot((state) => state.phase === 'flight')
  assert.equal(released.active?.tick, 0)
  await b.close()
  const disconnected = await a.snapshot((state) => !state.connected[1])
  assert.equal(disconnected.phase, 'flight')

  const stranger = await connect(host.url)
  stranger.send({ type: 'resume', room: session.room, token: 'A'.repeat(43) })
  await stranger.rejection('invalid-token', null)
  now += 200
  const resumed = await connect(host.url)
  resumed.send({ type: 'resume', room: session.room, token: second.token })
  assert.deepEqual(await resumed.session(), { ...second, nextSeq: 2 })
  const restored = await resumed.snapshot((state) => state.connected.every(Boolean))
  assert.equal(restored.delivery, 1)
  assert.equal(restored.active?.tick, 12)
  assert.ok(restored.revision > disconnected.revision)

  await resumed.close()
  await a.snapshot((state) => state.revision > restored.revision && !state.connected[1])
  now += 15_000
  const finished = await a.snapshot((state) => state.phase === 'complete')
  assert.deepEqual(finished.result, { winner: 0, reason: 'forfeit', margin: null })
})

test('private invite reaches a two-over score, reconstructs the sealed delivery, and settles a chase', async (t) => {
  let now = 1000
  const host = await startOnlineServer({ clock: () => now, toss: () => 1, nextSeed: () => 41 })
  t.after(host.close)
  const a = await connect(host.url)
  const b = await connect(host.url)
  a.send({ type: 'create', overs: 2 })
  const invite = await a.session()
  b.send({ type: 'join', room: invite.room })
  assert.equal((await b.session()).seat, 1)
  a.send({ type: 'approve', version: 1, lineup: DEFAULT_LINEUP.slice(0, 10) })
  await a.rejection('invalid-message', 1)
  b.send({ type: 'configure', version: 1, settings: { overs: 2, venue: 'harbor', pitch: 'green', weather: 'breezy' } })
  await b.rejection('wrong-seat', 1)
  a.send({ type: 'approve', version: 1, lineup: DEFAULT_LINEUP })
  await a.ack(1)
  b.send({ type: 'approve', version: 1, lineup: DEFAULT_LINEUP })
  await b.ack(1)
  await b.snapshot((state) => state.phase === 'toss')
  const third = await connect(host.url)
  third.send({ type: 'join', room: invite.room })
  await third.rejection('room-full', null)
  b.send({ type: 'toss', seq: 1, choice: 'bowl' })
  await b.ack(2)
  const ready = await a.snapshot((state) => state.phase === 'ready')
  assert.equal(ready.battingSeat, 0)
  assert.equal(ready.overs, 2)

  let firstAudit = newInnings(2)
  for (let delivery = 1; delivery <= 12; delivery++) {
    b.send({ type: 'bowl', seq: delivery + 1, delivery, kind: 'fast', line: delivery === 1 ? 0.2 : 0.62, effort: 0.63 })
    await b.ack(delivery + 2)
    now += ONLINE_WINDUP_MS
    const release = await a.snapshot((state) => state.delivery === delivery && state.phase === 'flight')
    assert.ok(release.active)
    assert.equal(release.active.options.seed, 41)
    if (delivery === 1) {
      const idealTick = new Delivery(release.active.options).contactTick
      now += idealTick * DT * 1000 + 0.1
      a.send({ type: 'swing', seq: 1, delivery, kind: 'drive', aim: 0, power: 0.87, tick: idealTick })
      await a.rejection('invalid-message', 1)
      a.send({ type: 'swing', seq: 1, delivery, kind: 'drive', aim: 0, power: 0.87 })
      await a.ack(2)
      const swung = await a.snapshot((state) => state.active?.shot?.tick === idealTick)
      assert.equal(swung.score.attempts, 0)
    }
    now += 12_000
    const next = await a.snapshot((state) => state.last?.delivery === delivery)
    firstAudit = auditDelivery(next.last, firstAudit)
    if (delivery === 1) {
      assert.ok(next.last?.replay.shot)
      assert.ok(next.last.outcome.batRuns > 0)
    }
    if (delivery < 12) assert.equal(next.score.runs, firstAudit.runs)
    else {
      assert.equal(next.firstInnings?.score.legalBalls, 12)
      assert.equal(next.firstInnings?.score.runs, firstAudit.runs)
      assert.equal(next.innings, 2)
      assert.equal(next.battingSeat, 1)
      assert.equal(next.score.target, (next.firstInnings?.score.runs ?? 0) + 1)
    }
  }

  const chaseStart = await b.snapshot((state) => state.innings === 2 && state.phase === 'ready')
  const target = chaseStart.score.target
  assert.ok(target && target <= 7)
  let chaseAudit = newInnings(2, target)
  for (let i = 0; i < target; i++) {
    const delivery = i + 13
    a.send({ type: 'bowl', seq: i + 2, delivery, kind: 'fast', line: 1.4, effort: 0.63 })
    await a.ack(i + 3)
    now += ONLINE_WINDUP_MS + 12_000
    const result = await a.snapshot((state) => state.last?.delivery === delivery)
    chaseAudit = auditDelivery(result.last, chaseAudit)
    assert.equal(result.score.runs, chaseAudit.runs)
    assert.equal(result.score.legalBalls, 0)
    assert.equal(result.score.extras.wide, i + 1)
    if (i + 1 === target) {
      assert.equal(result.phase, 'complete')
      assert.deepEqual(result.result, { winner: 1, reason: 'wickets', margin: 10 })
      assert.deepEqual(result, await b.snapshot((state) => state.phase === 'complete'))
      assert.deepEqual(result.wallets, [{ coins: 15, xp: 40 }, { coins: 30, xp: 40 }])
      a.send({ type: 'bowl', seq: i + 3, delivery: result.delivery, kind: 'fast', line: 0, effort: 0.63 })
      await a.rejection('wrong-phase', i + 3)
      a.send({ type: 'rematch', match: 1 })
      await a.ack(i + 3)
      b.send({ type: 'rematch', match: 1 })
      await b.ack(14)
      const nextMatch = await a.snapshot((state) => state.match === 2)
      assert.equal(nextMatch.room, invite.room)
      assert.equal(nextMatch.phase, 'lobby')
      assert.deepEqual(nextMatch.ready, [false, false])
      assert.deepEqual(nextMatch.wallets, result.wallets)
      assert.equal(nextMatch.score.runs, 0)
    }
  }
})


test('a server restart restores the accepted delivery and both guest identities', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'ccl-restart-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const databasePath = join(directory, 'online.sqlite')
  let now = 1000
  const options = { databasePath, clock: () => now, toss: () => 0 as const, nextSeed: () => 41 }
  const host = await startOnlineServer(options)
  t.after(host.close)
  const a = await connect(host.url)
  const b = await connect(host.url)
  a.send({ type: 'quick' })
  const one = await a.session()
  b.send({ type: 'quick' })
  const two = await b.session()
  a.send({ type: 'toss', seq: 1, choice: 'bat' })
  await a.ack(2)
  b.send({ type: 'bowl', seq: 1, delivery: 1, kind: 'fast', line: 0.2, effort: 0.63 })
  await b.ack(2)
  now += ONLINE_WINDUP_MS + 200
  const before = await a.snapshot((state) => state.active?.tick === 12)
  await host.close()
  const restoredHost = await startOnlineServer(options)
  t.after(restoredHost.close)
  const recoveredA = await connect(restoredHost.url)
  const recoveredB = await connect(restoredHost.url)
  recoveredA.send({ type: 'resume', room: one.room, token: one.token, account: one.account })
  assert.deepEqual(await recoveredA.session(), { ...one, nextSeq: 2 })
  recoveredB.send({ type: 'resume', room: two.room, token: two.token, account: two.account })
  assert.deepEqual(await recoveredB.session(), { ...two, nextSeq: 2 })
  const after = await recoveredA.snapshot((state) => state.connected.every(Boolean))
  assert.deepEqual(after.active, before.active)
  assert.deepEqual(after.score, before.score)
  now += 12_000
  const result = await recoveredA.snapshot((state) => state.last?.delivery === 1)
  assert.equal(result.score.attempts, 1)
})


test('host-measured round trip bounds swing compensation without trusting a client clock', async (t) => {
  let now = 1000
  const host = await startOnlineServer({ clock: () => now, toss: () => 0, nextSeed: () => 41 })
  t.after(host.close)
  const batter = await connect(host.url, 75)
  const bowler = await connect(host.url)
  batter.send({ type: 'quick' })
  await batter.session()
  bowler.send({ type: 'quick' })
  await bowler.session()
  batter.send({ type: 'toss', seq: 1, choice: 'bat' })
  await batter.ack(2)
  await delay(110)
  bowler.send({ type: 'bowl', seq: 1, delivery: 1, kind: 'fast', line: 0.2, effort: 0.63 })
  await bowler.ack(2)
  now += ONLINE_WINDUP_MS
  const release = await batter.snapshot((state) => state.phase === 'flight')
  assert.ok(release.active)
  const contactTick = new Delivery(release.active.options).contactTick
  const receiptTick = contactTick + 4
  now += receiptTick * DT * 1000 + 0.1
  batter.send({ type: 'swing', seq: 2, delivery: 1, kind: 'drive', aim: 0, power: 1 })
  await batter.ack(3)
  const swung = await batter.snapshot((state) => Boolean(state.active?.shot))
  assert.ok(swung.active?.shot)
  const adjustment = receiptTick - swung.active.shot.tick
  assert.ok(adjustment >= 4 && adjustment <= 6)
  now += 12_000
  const finished = await batter.snapshot((state) => state.last?.delivery === 1)
  const score = auditDelivery(finished.last, newInnings(5))
  assert.equal(score.runs, finished.score.runs)
})
