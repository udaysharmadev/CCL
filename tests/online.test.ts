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
import { DeliveryReplay } from '../src/delivery-replay.ts'
import { ONLINE_WINDUP_MS, type OnlineServerMessage, type OnlineSnapshot, type OnlineScore } from '../src/online-contract.ts'
import { applyDelivery, newInnings, type Innings } from '../src/rules.ts'
import { startOnlineServer } from '../scripts/online-server.ts'
import { createMatchStore } from '../scripts/match-store.ts'

async function connect(url: string, pongDelay = 0, beforePong?: () => void) {
  const socket = new WebSocket(url, { autoPong: pongDelay === 0 })
  let pongSent = Promise.resolve()
  if (pongDelay) {
    let confirmPong: () => void
    pongSent = new Promise<void>((resolve) => { confirmPong = resolve })
    socket.on('ping', (data) => {
      setTimeout(() => {
        if (socket.readyState !== WebSocket.OPEN) return
        beforePong?.()
        socket.pong(data)
        confirmPong()
      }, pongDelay)
    })
  }
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
    pongSent,
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
  const replay = new DeliveryReplay(event.replay)
  assert.ok(replay.advanceTo(2000))
  const sim = replay.sim
  assert.ok(sim.outcome)
  const score = applyDelivery(innings, sim.outcome)
  assert.deepEqual(score.history.at(-1), event.outcome)
  return score
}

function assertScore(actual: OnlineScore, expected: Innings) {
  const { history, target, ...score } = expected
  assert.deepEqual(actual, { ...score, target: target ?? null, recent: history.slice(-6) })
}

async function quickMatch(host: Awaited<ReturnType<typeof startOnlineServer>>, pongDelay = 0, beforePong?: () => void) {
  const batter = await connect(host.url, pongDelay, beforePong)
  const bowler = await connect(host.url)
  batter.send({ type: 'quick' })
  const battingSession = await batter.session()
  bowler.send({ type: 'quick' })
  const bowlingSession = await bowler.session()
  batter.send({ type: 'toss', seq: 1, choice: 'bat' })
  await batter.ack(2)
  return { batter, bowler, battingSession, bowlingSession }
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
  const hosts: Awaited<ReturnType<typeof startOnlineServer>>[] = []
  t.after(async () => {
    for (const host of hosts) await host.close()
    rmSync(directory, { recursive: true, force: true })
  })
  const databasePath = join(directory, 'online.sqlite')
  let now = 1000
  const options = { databasePath, clock: () => now, toss: () => 0 as const, nextSeed: () => 41 }
  const host = await startOnlineServer(options)
  hosts.push(host)
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
  hosts.push(restoredHost)
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

test('H1: seed 41 run at tick 10 survives a 75 ms delayed pong and drive at tick 35', async (t) => {
  let now = 1000
  let measuredTime = 0
  t.mock.method(performance, 'now', () => measuredTime)
  const host = await startOnlineServer({ clock: () => now, toss: () => 0, nextSeed: () => 41 })
  t.after(host.close)
  const batter = await connect(host.url, 75, () => { measuredTime = 75 })
  const bowler = await connect(host.url)
  batter.send({ type: 'quick' })
  await batter.session()
  bowler.send({ type: 'quick' })
  await bowler.session()
  batter.send({ type: 'toss', seq: 1, choice: 'bat' })
  await batter.ack(2)
  await batter.pongSent
  bowler.send({ type: 'bowl', seq: 1, delivery: 1, kind: 'fast', line: 0, effort: 0.63 })
  await bowler.ack(2)
  const releaseAt = now + ONLINE_WINDUP_MS
  now = releaseAt + 10 * DT * 1000 + 0.1
  batter.send({ type: 'running', seq: 2, delivery: 1, running: true })
  await batter.ack(3)
  now = releaseAt + 35 * DT * 1000 + 0.1
  batter.send({ type: 'swing', seq: 3, delivery: 1, kind: 'drive', aim: 0.7, power: 0.4 })
  await batter.ack(4)
  now += 12_000
  const finished = await batter.snapshot((state) => state.last?.delivery === 1)
  assert.ok(finished.last)
  const { replay, outcome } = finished.last
  assert.equal(replay.shot?.tick, 31)
  assert.deepEqual(replay.runs, [{ tick: 10, running: true }])
  const reconstruction = new DeliveryReplay(replay)
  assert.ok(reconstruction.advanceTo(2000))
  const sim = reconstruction.sim
  assert.ok(sim.outcome)
  const score = applyDelivery(newInnings(5), sim.outcome)
  t.diagnostic(JSON.stringify({ shotTick: replay.shot?.tick, live: outcome, replay: sim.outcome,
    liveScore: { runs: finished.score.runs, wickets: finished.score.wickets, striker: finished.score.striker, nonStriker: finished.score.nonStriker },
    replayScore: { runs: score.runs, wickets: score.wickets, striker: score.striker, nonStriker: score.nonStriker } }))
  assert.deepEqual(outcome, sim.outcome)
  assert.equal(outcome.batRuns, 1)
  assert.equal(outcome.completedRuns, 1)
  assert.equal(outcome.wicket, null)
  assertScore(finished.score, score)
})

test('H5: an authoritative overthrow survives restart, replay and reconnect without a second award', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'ccl-overthrow-recovery-'))
  const hosts: Awaited<ReturnType<typeof startOnlineServer>>[] = []
  t.after(async () => {
    for (const host of hosts) await host.close()
    rmSync(directory, { recursive: true, force: true })
  })
  let now = 1000
  t.mock.method(performance, 'now', () => 0)
  const options = { databasePath: join(directory, 'room.sqlite'), clock: () => now, toss: () => 0 as const, nextSeed: () => 8 }
  let host = await startOnlineServer(options)
  hosts.push(host)
  let { batter, bowler, battingSession, bowlingSession } = await quickMatch(host)
  bowler.send({ type: 'bowl', seq: 1, delivery: 1, kind: 'fast', line: .44, effort: .63 })
  await bowler.ack(2)
  const releaseAt = now + ONLINE_WINDUP_MS
  const run = { type: 'running', seq: 2, delivery: 1, running: true }
  const swing = { type: 'swing', seq: 3, delivery: 1, kind: 'drive', aim: 0, power: .7 }
  now = releaseAt + 10 * DT * 1000 + .1
  batter.send(run)
  await batter.ack(3)
  now = releaseAt + 37 * DT * 1000 + .1
  batter.send(swing)
  await batter.ack(4)
  now = releaseAt + 600 * DT * 1000 + .1
  const before = await batter.snapshot((state) => state.active?.tick === 600)
  assert.equal(before.active?.phase, 'field')
  assert.equal(before.score.attempts, 0)

  await host.close()
  host = await startOnlineServer(options)
  hosts.push(host)
  batter = await connect(host.url)
  bowler = await connect(host.url)
  batter.send({ type: 'resume', room: battingSession.room, token: battingSession.token })
  assert.equal((await batter.session()).nextSeq, 4)
  bowler.send({ type: 'resume', room: bowlingSession.room, token: bowlingSession.token })
  assert.equal((await bowler.session()).nextSeq, 2)
  const restored = await batter.snapshot((state) => state.connected.every(Boolean))
  assert.deepEqual(restored.active, before.active)
  assert.deepEqual(restored.score, before.score)
  batter.send(run)
  await batter.rejection('duplicate-sequence', 4)
  batter.send(swing)
  await batter.rejection('duplicate-sequence', 4)

  now = releaseAt + 1500 * DT * 1000
  const settled = await batter.snapshot((state) => state.last?.delivery === 1)
  assert.ok(settled.last)
  const { outcome, replay } = settled.last
  assert.equal(outcome.batRuns, 1)
  assert.equal(outcome.completedRuns, 1)
  assert.equal(outcome.overthrowRuns, 1)
  assert.equal(outcome.penalty ?? 0, 0, 'the sealed outcome keeps the overthrow separate')
  assert.equal(outcome.wicket, null)
  assert.equal(replay.shot?.tick, 37)
  assert.deepEqual(replay.runs, [{ tick: 10, running: true }])
  const reconstructed = auditDelivery(settled.last, newInnings(5))
  assertScore(settled.score, reconstructed)
  assert.equal(settled.score.runs, 2)
  assert.equal(settled.score.batting[0].runs, 1)
  assert.equal(settled.score.bowling[0].runs, 2)
  assert.deepEqual([settled.score.striker, settled.score.nonStriker], [2, 1])
  assert.equal(settled.score.attempts, 1)
  assert.equal(settled.score.recent.length, 1)
  const sealed = JSON.stringify(settled.last)

  await batter.close()
  batter = await connect(host.url)
  batter.send({ type: 'resume', room: battingSession.room, token: battingSession.token })
  assert.equal((await batter.session()).nextSeq, 4)
  const reconnected = await batter.snapshot((state) => state.connected.every(Boolean))
  assert.deepEqual(reconnected.score, settled.score)
  assert.equal(JSON.stringify(reconnected.last), sealed, 'recovery preserves the sealed outcome and checksum')
  batter.send(run)
  await batter.rejection('duplicate-sequence', 4)
  batter.send({ ...run, seq: 4 })
  await batter.rejection('stale-delivery', 4)
  t.diagnostic(JSON.stringify({ seed: 8, runTick: 10, swingTick: 37, checkpointTick: 600,
    outcome, total: settled.score.runs, batter: settled.score.batting[0].runs,
    extras: settled.score.extras, bowler: settled.score.bowling[0].runs }))
  assert.equal(settled.score.extras.penalty, 1, 'the overthrow must appear in authoritative scorecard extras')
  assert.equal(settled.score.batting.reduce((sum, batter) => sum + batter.runs, 0) +
    Object.values(settled.score.extras).reduce((sum, value) => sum + value, 0), settled.score.runs)
})

const runningHistories = [
  { name: 'queued runs before swing', runs: [[10, true], [10, true], [10, true]] },
  { name: 'turn-back before swing', runs: [[10, true], [20, false]] },
  { name: 'cancel queued runs before movement', runs: [[10, true], [10, true], [10, false]] },
  { name: 'multiple commands on the swing tick', runs: [[31, true], [31, false], [31, true]] },
  { name: 'running commands after the backdated swing tick', runs: [[10, true], [33, true], [35, false]] },
] as const

for (const fixture of runningHistories) test(`authoritative replay preserves ${fixture.name}`, async (t) => {
  let now = 1000
  let measuredTime = 0
  t.mock.method(performance, 'now', () => measuredTime)
  const host = await startOnlineServer({ clock: () => now, toss: () => 0, nextSeed: () => 41 })
  t.after(host.close)
  const { batter, bowler } = await quickMatch(host, 75, () => { measuredTime = 75 })
  await batter.pongSent
  bowler.send({ type: 'bowl', seq: 1, delivery: 1, kind: 'fast', line: 0, effort: 0.63 })
  await bowler.ack(2)
  const releaseAt = now + ONLINE_WINDUP_MS
  let seq = 2
  for (const [tick, running] of fixture.runs) {
    now = releaseAt + tick * DT * 1000 + 0.1
    batter.send({ type: 'running', seq, delivery: 1, running })
    await batter.ack(++seq)
  }
  now = releaseAt + 35 * DT * 1000 + 0.1
  const input = { kind: 'drive', aim: 0.7, power: 0.4 } as const
  batter.send({ type: 'swing', seq, delivery: 1, ...input })
  await batter.ack(++seq)
  const accepted = await batter.snapshot((state) => Boolean(state.active?.shot))
  assert.ok(accepted.active)
  assert.equal(accepted.active.shot?.tick, 31)
  assert.equal(accepted.active.version, 2)
  if (accepted.active.version !== 2) assert.fail('Expected ordered command history')
  const expectedCommands = [
    ...fixture.runs.map(([tick, running], index) => ({ type: 'running', tick, seq: index + 2, running })),
    { type: 'swing', tick: 31, seq: seq - 1, input },
  ].sort((a, b) => a.tick - b.tick || a.seq - b.seq)
  assert.deepEqual(accepted.active.commands, expectedCommands)
  // Independent fixture runner: do not use the production reconstruction for the oracle.
  const expected = new Delivery(accepted.active.options)
  while (!expected.outcome && expected.tick < 2000) {
    for (const [tick, running] of fixture.runs) if (tick === expected.tick) assert.ok(expected.setRunning(running))
    if (expected.tick === 31) assert.ok(expected.swing(input))
    expected.step()
  }
  assert.ok(expected.outcome)
  now += 12_000
  const settled = await batter.snapshot((state) => state.last?.delivery === 1)
  assert.deepEqual(settled.last?.outcome, expected.outcome)
  assertScore(settled.score, applyDelivery(newInnings(5), expected.outcome))
  assertScore(settled.score, auditDelivery(settled.last, newInnings(5)))
})

test('invalid, duplicate, stale and wrong-seat running and swing commands cannot change accepted history', async (t) => {
  let now = 1000
  t.mock.method(performance, 'now', () => 0)
  const host = await startOnlineServer({ clock: () => now, toss: () => 0, nextSeed: () => 41 })
  t.after(host.close)
  const { batter, bowler } = await quickMatch(host)
  bowler.send({ type: 'bowl', seq: 1, delivery: 1, kind: 'fast', line: 0, effort: 0.63 })
  await bowler.ack(2)
  const releaseAt = now + ONLINE_WINDUP_MS
  now = releaseAt + 10 * DT * 1000 + 0.1
  const run = { type: 'running', seq: 2, delivery: 1, running: true }
  const swing = { type: 'swing', seq: 2, delivery: 1, kind: 'drive', aim: 0.7, power: 0.4 }
  for (const command of [run, swing]) {
    bowler.send(command)
    await bowler.rejection('wrong-seat', 2)
    batter.send({ ...command, delivery: 2 })
    await batter.rejection('stale-delivery', 2)
    batter.send({ ...command, seq: 3 })
    await batter.rejection('out-of-order', 2)
    batter.send({ ...command, tick: 10 })
    await batter.rejection('invalid-message', 2)
  }
  batter.send(run)
  await batter.ack(3)
  batter.send(run)
  await batter.rejection('duplicate-sequence', 3)
  now = releaseAt + 35 * DT * 1000 + 0.1
  batter.send({ ...swing, seq: 3 })
  await batter.ack(4)
  batter.send({ ...swing, seq: 3 })
  await batter.rejection('duplicate-sequence', 4)
  batter.send({ ...swing, seq: 4 })
  await batter.rejection('swing-closed', 4)
  batter.send({ ...run, seq: 4, running: false })
  await batter.ack(5)
  const accepted = await batter.snapshot((state) => state.active?.runs?.length === 2)
  assert.ok(accepted.active?.version === 2)
  assert.deepEqual(accepted.active.commands.map(({ tick, seq, type }) => ({ tick, seq, type })), [
    { tick: 10, seq: 2, type: 'running' }, { tick: 35, seq: 3, type: 'swing' }, { tick: 35, seq: 4, type: 'running' },
  ])
  now += 12_000
  const settled = await batter.snapshot((state) => state.last?.delivery === 1)
  assertScore(settled.score, auditDelivery(settled.last, newInnings(5)))
})

test('a backdated swing cannot discard an accepted run by ending the delivery earlier', async (t) => {
  let now = 1000
  let measuredTime = 0
  t.mock.method(performance, 'now', () => measuredTime)
  const host = await startOnlineServer({ clock: () => now, toss: () => 0, nextSeed: () => 37 })
  t.after(host.close)
  const { batter, bowler } = await quickMatch(host, 75, () => { measuredTime = 75 })
  await batter.pongSent
  bowler.send({ type: 'bowl', seq: 1, delivery: 1, kind: 'yorker', line: 0, effort: 0.63 })
  await bowler.ack(2)
  now += ONLINE_WINDUP_MS + 41 * DT * 1000 + 0.1
  batter.send({ type: 'running', seq: 2, delivery: 1, running: true })
  await batter.ack(3)
  // Backdating this hook to tick 37 produces hit-wicket at tick 40, before
  // the accepted run. The server must retain the original delivery and seq.
  batter.send({ type: 'swing', seq: 3, delivery: 1, kind: 'hook', aim: 0, power: 1 })
  await batter.rejection('swing-closed', 3)
  batter.send({ type: 'running', seq: 3, delivery: 1, running: false })
  await batter.ack(4)
  const accepted = await batter.snapshot((state) => state.active?.runs?.length === 2)
  assert.ok(accepted.active?.version === 2)
  assert.equal(accepted.active.shot, null)
  assert.deepEqual(accepted.active.commands, [
    { type: 'running', tick: 41, seq: 2, running: true },
    { type: 'running', tick: 41, seq: 3, running: false },
  ])
  now += 12_000
  const settled = await batter.snapshot((state) => state.last?.delivery === 1)
  assert.equal(settled.last?.outcome.wicket, 'bowled')
  assert.equal(settled.last?.outcome.shotOffered, false)
  assertScore(settled.score, auditDelivery(settled.last, newInnings(5)))
})

for (const recovery of ['reconnect', 'restart'] as const) for (const phase of ['windup', 'flight', 'field'] as const) {
  test(`${recovery} during ${phase} preserves accepted commands and settles exactly once`, async (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'ccl-replay-recovery-'))
    const hosts: Awaited<ReturnType<typeof startOnlineServer>>[] = []
    t.after(async () => {
      for (const host of hosts) await host.close()
      rmSync(directory, { recursive: true, force: true })
    })
    let now = 1000
    t.mock.method(performance, 'now', () => 0)
    const options = { databasePath: join(directory, 'room.sqlite'), clock: () => now, toss: () => 0 as const, nextSeed: () => 41 }
    let host = await startOnlineServer(options)
    hosts.push(host)
    let { batter, bowler, battingSession, bowlingSession } = await quickMatch(host)
    bowler.send({ type: 'bowl', seq: 1, delivery: 1, kind: 'fast', line: 0, effort: 0.63 })
    await bowler.ack(2)
    const releaseAt = now + ONLINE_WINDUP_MS
    let seq = 2
    if (phase !== 'windup') {
      now = releaseAt + 10 * DT * 1000 + 0.1
      for (let i = 0; i < 2; i++) {
        batter.send({ type: 'running', seq, delivery: 1, running: true })
        await batter.ack(++seq)
      }
      if (phase === 'field') {
        now = releaseAt + 35 * DT * 1000 + 0.1
        batter.send({ type: 'swing', seq, delivery: 1, kind: 'drive', aim: 0.7, power: 0.4 })
        await batter.ack(++seq)
        now = releaseAt + 60 * DT * 1000 + 0.1
      }
    }
    const before = await batter.snapshot((state) => phase === 'windup' ? state.phase === phase
      : state.active?.tick === (phase === 'field' ? 60 : 10) && state.active?.runs?.length === 2)
    if (phase !== 'windup') assert.equal(before.active?.phase, phase)
    if (recovery === 'restart') {
      await host.close()
      host = await startOnlineServer(options)
      hosts.push(host)
    } else {
      await batter.close()
      await bowler.close()
    }
    batter = await connect(host.url)
    bowler = await connect(host.url)
    batter.send({ type: 'resume', room: battingSession.room, token: battingSession.token })
    assert.equal((await batter.session()).nextSeq, seq)
    bowler.send({ type: 'resume', room: bowlingSession.room, token: bowlingSession.token })
    assert.equal((await bowler.session()).nextSeq, 2)
    const restored = await batter.snapshot((state) => state.connected.every(Boolean))
    assert.deepEqual(restored.active, before.active)
    assert.deepEqual(restored.score, before.score)
    assert.equal(restored.windupRemainingMs, before.windupRemainingMs)
    if (phase !== 'windup') {
      batter.send({ type: 'running', seq: 2, delivery: 1, running: true })
      await batter.rejection('duplicate-sequence', seq)
    }
    if (phase !== 'field') {
      now = releaseAt + 35 * DT * 1000 + 0.1
      batter.send({ type: 'swing', seq, delivery: 1, kind: 'drive', aim: 0.7, power: 0.4 })
      await batter.ack(++seq)
    }
    now += 12_000
    const settled = await batter.snapshot((state) => state.last?.delivery === 1)
    assertScore(settled.score, auditDelivery(settled.last, newInnings(5)))
    assert.equal(settled.score.attempts, 1)
    assert.deepEqual(settled.wallets, [{ coins: 0, xp: 0 }, { coins: 0, xp: 0 }])
    await batter.close()
    batter = await connect(host.url)
    batter.send({ type: 'resume', room: battingSession.room, token: battingSession.token })
    assert.equal((await batter.session()).nextSeq, seq)
    const afterSettlement = await batter.snapshot((state) => state.connected.every(Boolean))
    assert.deepEqual(afterSettlement.score, settled.score)
    assert.deepEqual(afterSettlement.last, settled.last)
    assert.deepEqual(afterSettlement.wallets, settled.wallets)
  })
}

test('persisted legacy active-ball inputs migrate and accept further commands without sequence collisions', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'ccl-legacy-replay-'))
  const hosts: Awaited<ReturnType<typeof startOnlineServer>>[] = []
  t.after(async () => {
    for (const host of hosts) await host.close()
    rmSync(directory, { recursive: true, force: true })
  })
  let now = 1000
  t.mock.method(performance, 'now', () => 0)
  const settings = { databasePath: join(directory, 'room.sqlite'), clock: () => now, toss: () => 0 as const, nextSeed: () => 41 }
  let host = await startOnlineServer(settings)
  hosts.push(host)
  let { batter, bowler, battingSession, bowlingSession } = await quickMatch(host)
  bowler.send({ type: 'bowl', seq: 1, delivery: 1, kind: 'fast', line: 0, effort: 0.63 })
  await bowler.ack(2)
  const releaseAt = now + ONLINE_WINDUP_MS
  now = releaseAt + 10 * DT * 1000 + 0.1
  for (const seq of [2, 3]) {
    batter.send({ type: 'running', seq, delivery: 1, running: true })
    await batter.ack(seq + 1)
  }
  now = releaseAt + 35 * DT * 1000 + 0.1
  const input = { kind: 'drive', aim: 0.7, power: 0.4 } as const
  batter.send({ type: 'swing', seq: 4, delivery: 1, ...input })
  await batter.ack(5)
  now = releaseAt + 60 * DT * 1000 + 0.1
  const before = await batter.snapshot((state) => state.active?.tick === 60)
  const active = before.active
  assert.ok(active?.shot)
  assert.equal(active.phase, 'field')
  await host.close()

  // Rewrite only the active ball to the actual unversioned storage shape.
  const legacyBall = { options: active.options, releaseAt, sim: { tick: active.tick }, shot: active.shot, runs: active.runs }
  const store = createMatchStore(settings.databasePath)
  try {
    const row = store.load().find(({ id }) => id === battingSession.room)
    assert.ok(row)
    const saved = JSON.parse(row.state)
    saved.ball = legacyBall
    store.commit(row.id, JSON.stringify(saved))
  } finally { store.close() }

  host = await startOnlineServer(settings)
  hosts.push(host)
  batter = await connect(host.url)
  bowler = await connect(host.url)
  batter.send({ type: 'resume', room: battingSession.room, token: battingSession.token })
  assert.equal((await batter.session()).nextSeq, 5)
  bowler.send({ type: 'resume', room: bowlingSession.room, token: bowlingSession.token })
  assert.equal((await bowler.session()).nextSeq, 2)
  const resumed = await batter.snapshot((state) => state.connected.every(Boolean))
  assert.ok(resumed.active?.version === 2)
  assert.deepEqual(resumed.score, before.score)
  assert.deepEqual(resumed.active.commands, [
    { type: 'running', tick: 10, seq: 2, running: true },
    { type: 'running', tick: 10, seq: 3, running: true },
    { type: 'swing', tick: 35, seq: 1, input },
  ])
  const reconstruction = new DeliveryReplay(resumed.active)
  assert.ok(reconstruction.advanceTo(resumed.active.tick))
  const expected = new Delivery(active.options)
  while (expected.tick < 60) {
    if (expected.tick === 10) { assert.ok(expected.setRunning(true)); assert.ok(expected.setRunning(true)) }
    if (expected.tick === 35) assert.ok(expected.swing(input))
    expected.step()
  }
  assert.equal(reconstruction.sim.pendingRuns, 2)
  assert.equal(reconstruction.sim.runnerProgress, expected.runnerProgress)
  assert.equal(reconstruction.sim.partnerProgress, expected.partnerProgress)
  assert.deepEqual(reconstruction.sim.runnerPositions, expected.runnerPositions)
  assert.ok(reconstruction.sim.runnerProgress > 0)

  batter.send({ type: 'running', seq: 4, delivery: 1, running: false })
  await batter.rejection('duplicate-sequence', 5)
  batter.send({ type: 'running', seq: 5, delivery: 1, running: false })
  await batter.ack(6)
  assert.ok(expected.setRunning(false))
  const continued = await batter.snapshot((state) => state.active?.runs?.length === 3)
  assert.ok(continued.active?.version === 2)
  assert.deepEqual(continued.active.commands, [...resumed.active.commands,
    { type: 'running', tick: 60, seq: 5, running: false }])
  while (!expected.outcome && expected.tick < 2000) expected.step()
  assert.ok(expected.outcome)
  now += 12_000
  const settled = await batter.snapshot((state) => state.last?.delivery === 1)
  assert.deepEqual(settled.last?.outcome, expected.outcome)
  assertScore(settled.score, applyDelivery(newInnings(5), expected.outcome))
  assertScore(settled.score, auditDelivery(settled.last, newInnings(5)))
})
