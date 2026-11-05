import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { on, once } from 'node:events'
import { test } from 'node:test'
import { WebSocket } from 'ws'
import { Delivery, DT } from '../src/cricket.ts'
import { DEFAULT_LINEUP } from '../src/match-data.ts'
import { ONLINE_WINDUP_MS, type OnlineServerMessage, type OnlineSnapshot, type OnlineReplay } from '../src/online-contract.ts'
import { applyDelivery, newInnings } from '../src/rules.ts'
import { startOnlineServer } from '../scripts/online-server.ts'

async function peer(url: string) {
  const socket = new WebSocket(url)
  const events = on(socket, 'message', { signal: AbortSignal.timeout(10000), close: ['close'] })
  await once(socket, 'open')
  async function read(check: (message: OnlineServerMessage) => boolean) {
    for (;;) {
      const event = await events.next()
      if (event.done) throw new Error('Peer closed before expected event')
      const message: OnlineServerMessage = JSON.parse(String(event.value?.[0]))
      if (check(message)) return message
    }
  }
  return {
    send(value: object) { socket.send(JSON.stringify(value)) },
    async session() {
      const message = await read((message) => message.type === 'session')
      assert.equal(message.type, 'session')
      return message
    },
    async state(check: (state: OnlineSnapshot) => boolean) {
      const message = await read((message) => message.type === 'snapshot' && check(message.state))
      assert.equal(message.type, 'snapshot')
      return message.state
    },
    async ack() { return read((message) => message.type === 'ack') },
    async rejected(code: string) {
      const message = await read((message) => message.type === 'reject')
      assert.equal(message.type, 'reject')
      assert.equal(message.code, code)
    },
    async close() {
      const done = once(socket, 'close')
      socket.close()
      await done
    },
  }
}

function replay(record: OnlineReplay) {
  const sim = new Delivery(record.options)
  for (let tick = 0; tick < 900 && !sim.outcome; tick++) {
    if (record.shot?.tick === sim.tick) sim.swing(record.shot.input)
    for (const control of record.runs ?? []) if (control.tick === sim.tick) sim.setRunning(control.running)
    sim.step()
  }
  assert.ok(sim.outcome)
  return sim.outcome
}

test('Duo shares one innings with legal strike ownership, tactical calls, running replay, reconnect and rematch', async (t) => {
  let now = 1000
  const host = await startOnlineServer({ clock: () => now, nextSeed: () => 41 })
  t.after(host.close)
  const peers = [await peer(host.url), await peer(host.url)]
  peers[0].send({ type: 'create-duo', overs: 2 })
  const session = await peers[0].session()
  peers[1].send({ type: 'join', room: session.room })
  await peers[1].session()
  for (const client of peers) {
    client.send({ type: 'approve', version: 1, lineup: DEFAULT_LINEUP })
    await client.ack()
  }
  let state: OnlineSnapshot = await peers[0].state((state) => state.phase === 'ready')
  assert.equal(state.mode, 'duo')
  assert.equal(state.tossWinner, null)
  assert.equal(state.battingSeat, 0)
  const seq = [1, 1]
  let audit = newInnings(2)
  for (let delivery = 1; delivery <= 12; delivery++) {
    const striker: 0 | 1 | null = state.battingSeat
    assert.ok(striker === 0 || striker === 1)
    const partner: 0 | 1 = striker === 0 ? 1 : 0
    peers[partner].send({ type: 'next', match: 1, delivery })
    await peers[partner].ack()
    now += ONLINE_WINDUP_MS
    const release = await peers[striker].state((state) => state.delivery === delivery && state.phase === 'flight')
    assert.ok(release.active)
    const shot = { type: 'swing', seq: seq[striker], delivery, kind: 'defend', aim: -1.35, power: 0.7 }
    if (delivery === 1 || delivery === 2 || delivery === 7 || delivery === 8) {
      const ideal = new Delivery(release.active.options).contactTick
      now += ideal * DT * 1000 + .1
      if (delivery === 1) {
        peers[partner].send({ ...shot, seq: seq[partner] })
        await peers[partner].rejected('wrong-seat')
      }
      peers[striker].send({ ...shot, kind: delivery === 2 ? 'loft' : delivery === 8 ? 'drive' : 'defend',
        aim: delivery === 2 ? 0 : delivery === 8 ? -1 : -1.35, power: delivery === 8 ? 1 : .7 })
      await peers[striker].ack()
      seq[striker]++
      if (delivery === 1 || delivery === 7) {
        now += 6 * DT * 1000
        await peers[striker].state((state) => state.active?.phase === 'field')
        peers[striker].send({ type: 'running', seq: seq[striker]++, delivery, running: true })
        await peers[striker].ack()
      }
      if (delivery === 2) {
        now += 6 * DT * 1000
        await peers[striker].state((state) => state.active?.phase === 'field')
        peers[partner].send({ type: 'call', match: 1, delivery, call: 'wait' })
        await peers[partner].ack()
        const called: OnlineSnapshot = await peers[striker].state((state) => state.partnerCall?.call === 'wait')
        assert.equal(called.partnerCall?.seat, partner)
        peers[striker].send({ type: 'running', seq: seq[striker]++, delivery, running: false })
        await peers[striker].ack()
        now += 100
        peers[striker].send({ type: 'running', seq: seq[striker]++, delivery, running: true })
        await peers[striker].ack()
      }
    }
    now += 12_000
    state = await peers[0].state((state) => state.last?.delivery === delivery)
    assert.ok(state.last)
    assert.deepEqual(replay(state.last.replay), state.last.outcome)
    audit = applyDelivery(audit, state.last.outcome)
    assert.equal(state.score.runs, audit.runs)
    if (delivery === 1) {
      assert.equal(state.last.outcome.completedRuns, 1)
      assert.equal(state.battingSeat, 1)
    }
    if (delivery === 2) assert.equal(state.last.replay.runs?.length, 2)
    if (delivery === 3) {
      await peers[0].close()
      peers[0] = await peer(host.url)
      peers[0].send({ type: 'resume', room: session.room, token: session.token })
      assert.equal((await peers[0].session()).nextSeq, seq[0])
      state = await peers[0].state((state) => state.connected.every(Boolean))
    }
    if (delivery === 6) assert.equal(state.battingSeat, 0)
    if (delivery === 7) assert.equal(state.battingSeat, 1)
    if (delivery === 8) {
      assert.equal(state.last?.outcome.wicket, 'caught')
      assert.equal(state.score.striker, 3)
      assert.equal(state.battingSeat, 1, 'new batter inherits the dismissed participant')
    }
  }
  assert.equal(state.phase, 'complete')
  assert.equal(state.innings, 1)
  assert.equal(state.firstInnings, null)
  assert.equal(state.result?.reason, 'duo')
  assert.deepEqual(state.wallets, [{ coins: 15, xp: 40 }, { coins: 15, xp: 40 }])
  for (const client of peers) {
    client.send({ type: 'rematch', match: 1 })
    await client.ack()
  }
  const rematch = await peers[0].state((state) => state.match === 2)
  assert.equal(rematch.room, session.room)
  assert.equal(rematch.phase, 'lobby')
  assert.deepEqual(rematch.ready, [false, false])
})

test('legacy assisted deliveries retain hold/resume behavior for saved replays', () => {
  const sim = new Delivery({ seed: 41, kind: 'fast', effort: .63, maxOutside: 2 })
  for (let step = 0; step < 300 && sim.runnerProgress === 0; step++) {
    if (sim.tick === sim.contactTick) sim.swing({ kind: 'defend', aim: -1.35, power: .7 })
    sim.step()
  }
  assert.ok(sim.runnerProgress > 0)
  const before = sim.runnerProgress
  assert.ok(sim.setRunning(false))
  assert.equal(sim.runnersMoving, false)
  for (let step = 0; step < 10; step++) sim.step()
  assert.equal(sim.runnerProgress, before)
  assert.equal(sim.completedRuns, 0)
  assert.ok(sim.setRunning(true))
  assert.equal(sim.runnersMoving, true)
  sim.step()
  assert.ok(sim.runnerProgress > before)
})

test('a live manual run survives server restart and seals the non-striker run-out with correct control', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'ccl-duo-run-out-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  let now = 1000
  const options = { databasePath: join(directory, 'room.sqlite'), clock: () => now, nextSeed: () => 41 }
  const host = await startOnlineServer(options)
  t.after(host.close)
  const a = await peer(host.url)
  const b = await peer(host.url)
  a.send({ type: 'create-duo', overs: 2 })
  const sessionA = await a.session()
  b.send({ type: 'join', room: sessionA.room })
  const sessionB = await b.session()
  for (const client of [a, b]) {
    client.send({ type: 'approve', version: 1, lineup: DEFAULT_LINEUP })
    await client.ack()
  }
  await a.state((state) => state.phase === 'ready')
  a.send({ type: 'next', match: 1, delivery: 1 })
  await a.ack()
  now += ONLINE_WINDUP_MS
  const release = await a.state((state) => Boolean(state.active))
  assert.ok(release.active)
  assert.equal(release.active.options.runningMode, 'manual')
  now += new Delivery(release.active.options).contactTick * DT * 1000 + .1
  a.send({ type: 'swing', seq: 1, delivery: 1, kind: 'defend', aim: -1.35, power: .7 })
  await a.ack()
  now += 104 * DT * 1000
  await a.state((state) => state.active?.phase === 'field')
  b.send({ type: 'running', seq: 1, delivery: 1, running: true })
  await b.rejected('wrong-seat')
  a.send({ type: 'running', seq: 2, delivery: 1, running: true })
  await a.ack()
  const running = await a.state((state) => state.active?.runs?.length === 1)
  a.send({ type: 'running', seq: 2, delivery: 1, running: true })
  await a.rejected('duplicate-sequence')
  await host.close()
  const restarted = await startOnlineServer(options)
  t.after(restarted.close)
  const recoveredA = await peer(restarted.url)
  const recoveredB = await peer(restarted.url)
  recoveredA.send({ type: 'resume', room: sessionA.room, token: sessionA.token })
  assert.equal((await recoveredA.session()).nextSeq, 3)
  recoveredB.send({ type: 'resume', room: sessionB.room, token: sessionB.token })
  await recoveredB.session()
  const restored = await recoveredA.state((state) => state.connected.every(Boolean))
  assert.deepEqual(restored.active, running.active)
  now += 12_000
  const settled = await recoveredA.state((state) => state.last?.delivery === 1)
  assert.ok(settled.last)
  assert.equal(settled.last.outcome.wicket, 'run-out')
  assert.equal(settled.last.outcome.dismissedBatter, 'nonStriker')
  assert.equal(settled.last.outcome.completedRuns, 0)
  assert.equal(settled.score.runs, 0)
  assert.equal(settled.score.striker, 3)
  assert.equal(settled.score.nonStriker, 1)
  assert.equal(settled.battingSeat, 1, 'replacement inherits the dismissed partner')
  assert.deepEqual(replay(settled.last.replay), settled.last.outcome)
  assert.deepEqual(settled.wallets, [{ coins: 0, xp: 0 }, { coins: 0, xp: 0 }])
})


test('Duo control swap requires both votes and rejects stale or live-ball consent across restart', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'ccl-duo-swap-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const databasePath = join(directory, 'room.sqlite')
  let now = 1000
  const options = { databasePath, clock: () => now, nextSeed: () => 41 }
  const host = await startOnlineServer(options)
  t.after(host.close)
  const a = await peer(host.url)
  const b = await peer(host.url)
  a.send({ type: 'create-duo', overs: 2 })
  const sessionA = await a.session()
  b.send({ type: 'join', room: sessionA.room })
  const sessionB = await b.session()
  for (const client of [a, b]) {
    client.send({ type: 'approve', version: 1, lineup: DEFAULT_LINEUP })
    await client.ack()
  }
  const ready = await a.state((state) => state.phase === 'ready')
  assert.ok(ready.duoSwap)
  const command = { type: 'swap', match: 1, delivery: 1, version: ready.duoSwap.version, approve: true }
  a.send(command)
  await a.ack()
  const requested = await a.state((state) => Boolean(state.duoSwap?.votes[0]))
  assert.equal(requested.battingSeat, 0)
  a.send(command)
  await a.ack()
  assert.equal((await a.state((state) => state.revision > requested.revision)).battingSeat, 0)
  a.send({ ...command, approve: false })
  await a.ack()
  const canceled = await a.state((state) => !state.duoSwap?.votes[0])
  assert.equal(canceled.battingSeat, 0)
  a.send(command)
  await a.ack()
  b.send(command)
  await b.ack()
  const swapped = await a.state((state) => state.battingSeat === 1)
  assert.deepEqual(swapped.score, ready.score)
  assert.equal(swapped.delivery, 1)
  assert.deepEqual(swapped.wallets, ready.wallets)
  assert.deepEqual(swapped.duoSwap?.votes, [false, false])
  assert.equal(swapped.duoSwap?.version, command.version + 1)
  a.send(command)
  await a.rejected('wrong-phase')

  const pending = { ...command, version: swapped.duoSwap!.version }
  a.send(pending)
  await a.ack()
  await a.state((state) => Boolean(state.duoSwap?.votes[0]))
  await host.close()
  const restarted = await startOnlineServer(options)
  t.after(restarted.close)
  const recoveredA = await peer(restarted.url)
  let recoveredB = await peer(restarted.url)
  recoveredA.send({ type: 'resume', room: sessionA.room, token: sessionA.token })
  await recoveredA.session()
  recoveredB.send({ type: 'resume', room: sessionB.room, token: sessionB.token })
  await recoveredB.session()
  const recovered = await recoveredA.state((state) => state.connected.every(Boolean))
  assert.equal(recovered.battingSeat, 1)
  assert.deepEqual(recovered.duoSwap?.votes, [false, false])
  recoveredB.send(pending)
  await recoveredB.rejected('wrong-phase')

  recoveredA.send({ ...pending, version: recovered.duoSwap!.version })
  await recoveredA.ack()
  await recoveredB.close()
  const disconnected = await recoveredA.state((state) => !state.connected[1])
  assert.deepEqual(disconnected.duoSwap?.votes, [false, false])
  recoveredB = await peer(restarted.url)
  recoveredB.send({ type: 'resume', room: sessionB.room, token: sessionB.token })
  await recoveredB.session()
  const rejoined = await recoveredA.state((state) => state.connected.every(Boolean) && state.duoSwap!.version > recovered.duoSwap!.version)
  recoveredA.send({ ...pending, version: rejoined.duoSwap!.version })
  await recoveredA.ack()
  recoveredB.send({ type: 'next', match: 1, delivery: 1 })
  await recoveredB.ack()
  const windup = await recoveredA.state((state) => state.phase === 'windup')
  assert.deepEqual(windup.duoSwap?.votes, [false, false])
  recoveredB.send({ ...pending, version: windup.duoSwap!.version })
  await recoveredB.rejected('wrong-phase')
  now += ONLINE_WINDUP_MS + 12_000
  const settled = await recoveredA.state((state) => state.last?.delivery === 1)
  assert.equal(settled.score.attempts, 1)
})
