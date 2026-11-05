import { randomInt } from 'node:crypto'
import { once } from 'node:events'
import { WebSocket, WebSocketServer } from 'ws'
import { DELIVERIES, DT, Delivery, SHOTS, type DeliveryKind, type ShotInput } from '../src/cricket.ts'
import { applyDelivery, newInnings, RULE_PROFILE, type DeliveryOutcome } from '../src/rules.ts'

type Role = 'bowler' | 'batter'
type Plan = { kind: DeliveryKind; line: number; effort: number }
type Replay = { seed: number; plan: Plan; freeHit: boolean; swing?: { tick: number; input: ShotInput } }
type Intent =
  | { seq: number; delivery: number; type: 'bowl'; plan: Plan }
  | { seq: number; delivery: number; type: 'swing'; shot: ShotInput }

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function bounded(value: unknown, low: number, high: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high
}

function pick<T extends string>(choices: readonly T[], value: unknown) {
  return choices.find((choice) => choice === value)
}

function parseIntent(value: unknown): Intent | null {
  if (!record(value)) return null
  const { seq, delivery, type, kind, line, effort, aim, power } = value
  if (!bounded(seq, 1, Number.MAX_SAFE_INTEGER) || !Number.isInteger(seq) ||
      !bounded(delivery, 1, Number.MAX_SAFE_INTEGER) || !Number.isInteger(delivery)) return null

  // Identity, timing, seed and results are owned by the host. Reject extra fields at this boundary.
  if (Object.keys(value).length !== 6) return null
  if (type === 'bowl') {
    const variant = pick(DELIVERIES, kind)
    if (variant && bounded(line, -1.4, 1.4) && bounded(effort, 0, 1)) {
      return { seq, delivery, type, plan: { kind: variant, line, effort } }
    }
  }
  if (type === 'swing') {
    const technique = pick(SHOTS, kind)
    if (technique && bounded(aim, -Math.PI, Math.PI) && bounded(power, 0, 1)) {
      return { seq, delivery, type, shot: { kind: technique, aim, power } }
    }
  }
  return null
}

export async function startAuthoritySpike(port = 0, nextSeed = () => randomInt(0x1_0000_0000)) {
  const server = new WebSocketServer({ host: '127.0.0.1', port, path: '/authority-spike', maxPayload: 1024 })
  const peers = new Map<Role, WebSocket>()
  const stepMs = DT * 1000
  let innings = newInnings()
  let revision = 0
  let active: {
    sim: Delivery
    started: number
    replay: Replay
  } | null = null
  let last: { delivery: number; outcome: DeliveryOutcome; replay: Replay } | null = null
  let timer: ReturnType<typeof setInterval> | undefined

  function snapshot() {
    const { runs, wickets, legalBalls, attempts, freeHit, complete } = innings
    return {
      revision,
      rulesProfile: RULE_PROFILE,
      phase: complete ? 'complete' : active ? 'flight' : 'await-bowl',
      delivery: complete ? attempts : attempts + 1,
      tick: active?.sim.tick ?? null,
      score: { runs, wickets, legalBalls, attempts, freeHit },
      last,
    }
  }

  function broadcast() {
    revision += 1
    const data = JSON.stringify({ type: 'snapshot', state: snapshot() })
    for (const peer of peers.values()) {
      if (peer.readyState === WebSocket.OPEN) peer.send(data)
    }
  }

  function advance() {
    if (!active) return
    const { sim, started, replay } = active
    const due = Math.floor((performance.now() - started) / stepMs)
    while (sim.tick < due && !sim.outcome) sim.step()
    if (sim.outcome) {
      innings = applyDelivery(innings, sim.outcome)
      last = { delivery: innings.attempts, outcome: sim.outcome, replay }
      active = null
      clearInterval(timer)
      broadcast()
    }
  }

  server.on('connection', (socket) => {
    socket.on('error', () => socket.terminate())
    // ponytail: two localhost seats. Public rooms need authenticated role and reconnect tokens.
    const role = !peers.has('bowler') ? 'bowler' : !peers.has('batter') ? 'batter' : null
    if (!role) {
      socket.close(1008, 'room full')
      return
    }
    peers.set(role, socket)
    socket.once('close', () => peers.delete(role))
    socket.send(JSON.stringify({ type: 'hello', role, state: snapshot() }))

    let acceptedSequence = 0
    const reject = (code: string) => socket.send(JSON.stringify({ type: 'reject', code }))
    socket.on('message', (data, binary) => {
      let input: unknown
      try {
        if (binary) return reject('invalid-intent')
        input = JSON.parse(data.toString())
      } catch {
        return reject('invalid-intent')
      }
      const intent = parseIntent(input)
      if (!intent) return reject('invalid-intent')
      if (intent.seq <= acceptedSequence) return reject('duplicate-sequence')
      if (intent.seq !== acceptedSequence + 1) return reject('out-of-order')
      if ((intent.type === 'bowl' ? 'bowler' : 'batter') !== role) return reject('wrong-role')
      if (peers.size !== 2) return reject('waiting-for-peer')

      advance()
      if (innings.complete || intent.delivery !== innings.attempts + 1) return reject('wrong-delivery')

      if (intent.type === 'bowl') {
        if (active) return reject('delivery-active')
        const seed = nextSeed()
        const { freeHit } = innings
        active = {
          sim: new Delivery({ ...intent.plan, seed, freeHit }),
          started: performance.now(),
          replay: { seed, plan: intent.plan, freeHit },
        }
        timer = setInterval(advance, stepMs)
      } else {
        if (!active) return reject('no-active-delivery')
        if (!active.sim.swing(intent.shot)) return reject('swing-unavailable')
        active.replay.swing = { tick: active.sim.tick, input: intent.shot }
      }
      acceptedSequence = intent.seq
      broadcast()
    })
  })

  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing authority spike TCP address')
  return {
    url: `ws://127.0.0.1:${address.port}/authority-spike`,
    async close() {
      clearInterval(timer)
      for (const socket of server.clients) socket.terminate()
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    },
  }
}

if (import.meta.main) {
  const spike = await startAuthoritySpike(8787)
  console.log(`Local authority spike listening on ${spike.url}`)
}
