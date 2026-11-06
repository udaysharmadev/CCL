import { createHash, randomBytes, randomInt } from 'node:crypto'
import { createServer } from 'node:http'
import { readFile, stat as statFile } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { dirname, resolve, sep, extname } from 'node:path'
import { createMatchStore } from './match-store.ts'
import { DEFAULT_LINEUP, DEFAULT_ROOM_SETTINGS, parseRoomSettings, lineupError, isBowler, VENUE_BOUNDARIES, type RoomSettings } from '../src/match-data.ts'
import { updateDuoOwners, type DuoOwners } from '../src/duo.ts'
import { battingStyle } from '../src/players.ts'
import { once } from 'node:events'
import { WebSocket, WebSocketServer } from 'ws'
import { DELIVERIES, DT, Delivery, FIELD_PRESETS, SHOTS, type DeliveryOptions, type FieldPreset } from '../src/cricket.ts'
import { DeliveryReplay, deliveryCommands } from '../src/delivery-replay.ts'
import { applyDelivery, newInnings, RULE_PROFILE, WICKETS_PER_INNINGS, outsideLimit, bowlerIndex, type Innings } from '../src/rules.ts'
import {
  MAX_PRIVATE_OVERS, MIN_PRIVATE_OVERS, ONLINE_PATH, ONLINE_PORT, ONLINE_WINDUP_MS, QUICK_OVERS,
  type OnlineClientMessage, type OnlineIntent, type OnlineMode, type OnlinePhase, type OnlineRejectCode,
  type OnlineDeliveryCommand, type OnlineReplay, type OnlineResult, type OnlineScore, type OnlineSeat, type OnlineServerMessage, type OnlineSnapshot,
} from '../src/online-contract.ts'

const HOST = '127.0.0.1'
const STEP_MS = DT * 1000
const PUBLISH_MS = 50
const MAX_INPUT_GRACE_MS = 100
const LOBBY_GRACE_MS = 60_000
const MATCH_GRACE_MS = 15_000
const RESULT_TTL_MS = 300_000
const MAX_ROOMS = 128
const MAX_BUFFERED_BYTES = 256 * 1024
const ROOM_PATTERN = /^[A-Za-z0-9_-]{12}$/
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

type Member = {
  socket: WebSocket | null
  token: string
  account: string
  nextSeq: number
  disconnectedUntil: number | null
}

type Ball = {
  options: DeliveryOptions
  releaseAt: number
  sim: Delivery | null
  version: 2
  commands: readonly OnlineDeliveryCommand[]
}

type Room = {
  id: string
  match: number
  settings: RoomSettings
  settingsVersion: number
  ready: [boolean, boolean]
  lineups: [string[], string[]]
  rematch: [boolean, boolean]
  mode: OnlineMode
  duoOwners: DuoOwners
  duoSwap: { version: number; votes: [boolean, boolean] }
  partnerCall?: { seat: OnlineSeat; call: 'run' | 'wait' | 'no'; at: number }
  overs: number
  phase: OnlinePhase
  seats: [Member | null, Member | null]
  revision: number
  lastSentAt: number
  tossWinner: OnlineSeat | null
  battingSeat: OnlineSeat | null
  delivery: number
  innings: 1 | 2
  score: Innings
  firstInnings: OnlineSnapshot['firstInnings']
  ball: Ball | null
  last: OnlineSnapshot['last']
  result: OnlineResult | null
  finishedAt: number | null
}

type ServerOptions = {
  port?: number
  databasePath?: string
  bindHost?: string
  allowedOrigins?: readonly string[]
  staticDirectory?: string
  clock?: () => number
  nextSeed?: () => number
  toss?: () => OnlineSeat
}

function inRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function positiveInteger(value: unknown): value is number {
  return inRange(value, 1, Number.MAX_SAFE_INTEGER) && Number.isInteger(value)
}

function parseMessage(value: unknown): OnlineClientMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input: Record<string, unknown> = Object.fromEntries(Object.entries(value))
  if ('account' in input) {
    const { account, ...rest } = input
    if (typeof account !== 'string' || !TOKEN_PATTERN.test(account)) return null
    const parsed = parseMessage(rest)
    return parsed && ['quick', 'create', 'create-duo', 'join', 'resume'].includes(parsed.type)
      ? { ...parsed, account } as OnlineClientMessage : null
  }
  const { type, room, token, overs, seq, choice, delivery, kind, line, effort, aim, power, version, settings, lineup, match, running, call, approve } = input
  const keyCount = Object.keys(input).length
  if (type === 'quick' && keyCount === 1) return { type }
  if ((type === 'create' || type === 'create-duo') && keyCount === 2 &&
    inRange(overs, MIN_PRIVATE_OVERS, MAX_PRIVATE_OVERS) && Number.isInteger(overs)) return { type, overs }
  if (typeof room === 'string' && ROOM_PATTERN.test(room)) {
    if (type === 'join' && keyCount === 2) return { type, room }
    if (type === 'resume' && keyCount === 3 && typeof token === 'string' && TOKEN_PATTERN.test(token)) {
      return { type, room, token }
    }
  }
  if (type === 'configure' && keyCount === 3 && positiveInteger(version)) {
    const config = parseRoomSettings(settings)
    return config ? { type, version, settings: config } : null
  }
  if (type === 'approve' && keyCount === 3 && positiveInteger(version) && Array.isArray(lineup) &&
      lineup.every((name) => typeof name === 'string') && !lineupError(lineup)) return { type, version, lineup }
  if (type === 'rematch' && keyCount === 2 && positiveInteger(match)) return { type, match }
  if (type === 'swap' && keyCount === 5 && positiveInteger(match) && positiveInteger(delivery) &&
      positiveInteger(version) && typeof approve === 'boolean') return { type, match, delivery, version, approve }
  if (type === 'next' && keyCount === 3 && positiveInteger(match) && positiveInteger(delivery)) return { type, match, delivery }
  if (type === 'call' && keyCount === 4 && positiveInteger(match) && positiveInteger(delivery) &&
      (call === 'run' || call === 'wait' || call === 'no')) return { type, match, delivery, call }
  if (!positiveInteger(seq)) return null
  if (type === 'running' && keyCount === 4 && positiveInteger(delivery) && typeof running === 'boolean') return { type, seq, delivery, running }
  if (type === 'toss' && keyCount === 3 && (choice === 'bat' || choice === 'bowl')) return { type, seq, choice }
  // The bowl intent may carry an optional field preset and nothing else.
  if (type === 'bowl') {
    const allowed = ['type', 'seq', 'delivery', 'kind', 'line', 'effort', 'field']
    const keys = Object.keys(input)
    if (keys.length < 6 || keys.length > 7) return null
    if (!keys.every((key) => allowed.includes(key))) return null
    if (!positiveInteger(delivery)) return null
    if (!inRange(line, -1.4, 1.4) || !inRange(effort, 0, 1)) return null
    const variant = DELIVERIES.find((entry) => entry === kind)
    if (!variant) return null
    const field = 'field' in input ? input.field : undefined
    if (field !== undefined && !FIELD_PRESETS.includes(field as FieldPreset)) return null
    return field === undefined
      ? { type, seq, delivery, kind: variant, line, effort }
      : { type, seq, delivery, kind: variant, line, effort, field: field as FieldPreset }
  }
  if (keyCount !== 6 || !positiveInteger(delivery)) return null
  if (type === 'swing' && inRange(aim, -Math.PI, Math.PI) && inRange(power, 0, 1)) {
    const variant = SHOTS.find((entry) => entry === kind)
    if (variant) return { type, seq, delivery, kind: variant, aim, power }
  }
  return null
}

function other(seat: OnlineSeat): OnlineSeat {
  return seat === 0 ? 1 : 0
}

/** The running pace of the two batters on strike, from their player profiles. */
function runnerPace(room: Room, battingSeat: OnlineSeat): [number, number] {
  const lineup = room.lineups[battingSeat]
  return [
    battingStyle(lineup[room.score.striker - 1] ?? '').running,
    battingStyle(lineup[room.score.nonStriker - 1] ?? '').running,
  ]
}

function isConnected(member: Member | null) {
  return member?.socket?.readyState === WebSocket.OPEN
}

function scoreView({ history, target, ...score }: Innings): OnlineScore {
  return { ...score, target: target ?? null, recent: history.slice(-6) }
}

function replayView(ball: Ball): OnlineReplay {
  const swing = ball.commands.find((command) => command.type === 'swing')
  const runs = ball.commands.filter((command) => command.type === 'running')
    .map(({ tick, running }) => ({ tick, running }))
  return {
    version: 2, options: ball.options, commands: ball.commands,
    shot: swing ? { tick: swing.tick, input: swing.input } : null,
    ...(runs.length ? { runs } : {}),
  }
}

function allowLocalOrigin(origin: string) {
  if (!origin) return true
  try {
    const { protocol, hostname } = new URL(origin)
    return (protocol === 'http:' || protocol === 'https:') &&
      (hostname === 'localhost' || hostname === HOST || hostname === '[::1]')
  } catch {
    return false
  }
}

export async function startOnlineServer({
  port = 0,
  databasePath = ':memory:',
  bindHost = HOST,
  allowedOrigins = [],
  staticDirectory = resolve('dist'),
  clock = () => performance.timeOrigin + performance.now(),
  nextSeed = () => randomInt(0x1_0000_0000),
  toss = () => randomInt(2) === 0 ? 0 : 1,
}: ServerOptions = {}) {
  const root = resolve(staticDirectory)
  const types: Record<string, string> = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
  }
  const http = createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405).end()
      return
    }
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end('{"status":"ok"}')
      return
    }
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
      const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
      if (!file.startsWith(root + sep) || pathname.includes('\0')) {
        response.writeHead(404).end()
        return
      }
      let data = await readFile(file)
      // A route with no file extension falls back to the single page, so a deep
      // link such as /?room=... or /settings works.
      let served = file
      if (!extname(file) && !pathname.endsWith('/')) {
        served = resolve(root, 'index.html')
        data = await readFile(served)
      }
      const stat = await statFile(served)
      const etag = `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`
      if (request.headers['if-none-match'] === etag) {
        response.writeHead(304, { etag }).end()
        return
      }
      response.writeHead(200, {
        'content-type': types[extname(served)] ?? 'application/octet-stream',
        'x-content-type-options': 'nosniff',
        etag,
        'cache-control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      })
      response.end(request.method === 'HEAD' ? undefined : data)
    } catch { response.writeHead(404).end() }
  })
  const server = new WebSocketServer({
    server: http, path: ONLINE_PATH, maxPayload: 4096,
    verifyClient: ({ origin }: { origin: string }) => allowLocalOrigin(origin) || allowedOrigins.includes(origin),
  })
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 })
  const store = createMatchStore(databasePath)
  const rooms = new Map<string, Room>()
  const clients = new Map<WebSocket, { alive: boolean; joined: boolean; pingAt: number; rtt: number; nonce: string }>()
  const seatIndices = [0, 1] as const

  for (const row of store.load()) {
    const saved = JSON.parse(row.state) as Room
    saved.duoSwap = { version: (saved.duoSwap?.version ?? 0) + 1, votes: [false, false] }
    for (const member of saved.seats) {
      if (member) {
        member.account ??= member.token
        store.register(member.account)
        member.socket = null
        member.disconnectedUntil ??= clock() + MATCH_GRACE_MS
      }
    }
    if (saved.ball) {
      const ball = saved.ball
      // Unversioned saves have no cross-type sequence: migrate their historical
      // shot-before-runs ordering once. Keep already sealed events unchanged.
      const commands = deliveryCommands(ball as Ball | OnlineReplay)
      const replay = new DeliveryReplay({ options: ball.options, version: 2, commands })
      if (ball.sim && !replay.advanceTo(ball.sim.tick)) throw new Error('Could not reconstruct accepted delivery')
      saved.ball = { options: ball.options, releaseAt: ball.releaseAt, version: 2, commands, sim: ball.sim ? replay.sim : null }
    }
    rooms.set(saved.id, saved)
  }

  function send(socket: WebSocket | null, message: OnlineServerMessage) {
    if (socket?.readyState !== WebSocket.OPEN) return
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      socket.terminate()
      return
    }
    socket.send(JSON.stringify(message))
  }

  function state(room: Room, now: number): OnlineSnapshot {
    const ball = room.ball
    const active = ball?.sim ? { ...replayView(ball), tick: ball.sim.tick, phase: ball.sim.phase } : null
    return {
      duoSwap: room.mode === 'duo' ? room.duoSwap : undefined,
      partnerCall: room.partnerCall && now - room.partnerCall.at < 2500
        ? { seat: room.partnerCall.seat, call: room.partnerCall.call } : null,
      bowler: room.mode === 'duo' ? 'AI attack' : (room.seats[room.battingSeat === 0 ? 1 : 0] && room.lineups[room.battingSeat === 0 ? 1 : 0].filter(isBowler)[bowlerIndex(room.score.legalBalls)]) || 'Bowler',
      maxOutside: outsideLimit(room.overs, room.score.legalBalls),
      match: room.match, settings: room.settings, settingsVersion: room.settingsVersion,
      ready: room.ready, lineups: room.lineups, rematch: room.rematch,
      wallets: [store.wallet(room.seats[0]?.account ?? ''), store.wallet(room.seats[1]?.account ?? '')],
      revision: room.revision, rulesProfile: RULE_PROFILE, room: room.id, mode: room.mode, overs: room.overs,
      phase: room.phase, connected: [isConnected(room.seats[0]), isConnected(room.seats[1])],
      tossWinner: room.tossWinner, battingSeat: room.battingSeat, delivery: room.delivery, innings: room.innings,
      score: scoreView(room.score), firstInnings: room.firstInnings,
      bowlingKind: ball?.options.kind ?? null,
      windupRemainingMs: room.phase === 'windup' && ball ? Math.max(0, Math.ceil(ball.releaseAt - now)) : null,
      active, last: room.last, result: room.result,
    }
  }

  function checkpoint(room: Room) {
    const awards = room.phase === 'complete' && room.result &&
      ['runs', 'wickets', 'tie', 'duo'].includes(room.result.reason)
      ? room.seats.flatMap((member, seat) => member ? [{
        match: room.id + '/' + room.match, token: member.account,
        coins: room.result?.winner === seat ? 30 : 15, xp: 40,
      }] : []) : []
    try {
      store.commit(room.id, JSON.stringify(room, (key, value) => key === 'socket' ? null : value), awards,
        room.last ? { id: room.id + '/' + room.match + '/' + room.last.delivery, value: JSON.stringify(room.last) } : undefined)
    } catch (error) {
      // A storage failure must never take the match server down. The match
      // continues and the room is written again on the next tick.
      console.error('Could not persist the room.', error)
    }
  }

  function publish(room: Room, now: number) {
    room.revision++
    room.lastSentAt = now
    checkpoint(room)
    const message = { type: 'snapshot', state: state(room, now) } as const
    for (const member of room.seats) send(member?.socket ?? null, message)
  }

  function makeRoom(mode: OnlineMode, overs: number): Room {
    let id: string
    do { id = randomBytes(9).toString('base64url') } while (rooms.has(id))
    const room: Room = {
      id, match: 1, settings: { ...DEFAULT_ROOM_SETTINGS, overs }, settingsVersion: 1,
      ready: [false, false], lineups: [[...DEFAULT_LINEUP], [...DEFAULT_LINEUP]], rematch: [false, false],
      duoSwap: { version: 1, votes: [false, false] }, duoOwners: { 1: 0, 2: 1 }, mode, overs, phase: 'lobby', seats: [null, null], revision: 0, lastSentAt: 0,
      tossWinner: null, battingSeat: null, delivery: 1, innings: 1, score: newInnings(overs),
      firstInnings: null, ball: null, last: null, result: null, finishedAt: null,
    }
    rooms.set(id, room)
    return room
  }

  function finish(room: Room, result: OnlineResult, now: number) {
    room.ball = null
    room.phase = 'complete'
    room.result = result
    room.finishedAt = now
  }

  function settle(room: Room, ball: Ball, now: number) {
    const outcome = ball.sim?.outcome
    if (!outcome || room.battingSeat === null) return
    const previous = room.score
    room.score = applyDelivery(room.score, outcome)
    if (room.mode === 'duo') {
      room.duoOwners = updateDuoOwners(room.duoOwners, previous, room.score)
      room.battingSeat = room.duoOwners[room.score.striker]
    }
    const canonical = room.score.history.at(-1) ?? outcome
    const replay = replayView(ball)
    const event = { delivery: room.delivery, innings: room.innings, outcome: canonical, replay }
    const checksum = createHash('sha256').update(JSON.stringify(event)).digest('hex')
    room.last = { ...event, checksum }
    room.ball = null
    room.partnerCall = undefined
    room.delivery++
    room.phase = 'ready'
    if (!room.score.complete) return

    if (room.mode === 'duo') {
      finish(room, { winner: null, reason: 'duo', margin: room.score.runs }, now)
      return
    }
    if (room.innings === 1) {
      room.firstInnings = { battingSeat: room.battingSeat, score: scoreView(room.score) }
      room.score = newInnings(room.overs, room.score.runs + 1)
      room.battingSeat = other(room.battingSeat)
      room.innings = 2
      return
    }
    const difference = room.score.runs - (room.firstInnings?.score.runs ?? 0)
    if (difference > 0) {
      finish(room, { winner: room.battingSeat, reason: 'wickets', margin: WICKETS_PER_INNINGS - room.score.wickets }, now)
    } else if (difference < 0) {
      finish(room, { winner: other(room.battingSeat), reason: 'runs', margin: -difference }, now)
    } else {
      finish(room, { winner: null, reason: 'tie', margin: null }, now)
    }
  }

  function expire(room: Room, now: number) {
    if (room.phase === 'complete') {
      if (room.finishedAt !== null && now - room.finishedAt >= RESULT_TTL_MS) {
        rooms.delete(room.id); store.remove(room.id)
        for (const member of room.seats) member?.socket?.close(1000, 'room expired')
      }
      return
    }
    const expired = (member: Member | null) => member !== null &&
      member.disconnectedUntil !== null && member.disconnectedUntil <= now
    if (room.phase === 'lobby' || room.phase === 'toss') {
      let changed = false
      for (const index of seatIndices) {
        if (!expired(room.seats[index])) continue
        room.seats[index] = null
        room.ready = [false, false]
        changed = true
      }
      if (!changed) return
      if (room.seats.every((member) => member === null)) { rooms.delete(room.id); store.remove(room.id) }
      else {
        room.phase = 'lobby'
        room.tossWinner = null
        publish(room, now)
      }
      return
    }
    const abandonedSeat = seatIndices.find((index) => expired(room.seats[index]))
    if (abandonedSeat === undefined) return
    const opponent = room.seats[other(abandonedSeat)]
    if (isConnected(opponent)) {
      finish(room, { winner: room.mode === 'duo' ? null : other(abandonedSeat), reason: room.mode === 'duo' ? 'abandoned' : 'forfeit', margin: null }, now)
      publish(room, now)
    } else if (expired(opponent)) {
      finish(room, { winner: null, reason: 'abandoned', margin: null }, now)
      publish(room, now)
    }
  }

  function advance(room: Room, now: number) {
    expire(room, now)
    const ball = room.ball
    if (!ball) return
    let released = false
    if (!ball.sim && now >= ball.releaseAt) {
      ball.sim = new DeliveryReplay(ball).sim
      room.phase = 'flight'
      released = true
    }
    if (ball.sim) {
      const due = Math.floor((now - ball.releaseAt) / STEP_MS)
      while (ball.sim.tick < due && !ball.sim.outcome) ball.sim.step()
      if (ball.sim.outcome && now >= ball.releaseAt + ball.sim.tick * STEP_MS + MAX_INPUT_GRACE_MS) {
        settle(room, ball, now)
        publish(room, now)
        return
      }
    }
    if (released || now - room.lastSentAt >= PUBLISH_MS) publish(room, now)
  }

  function applyIntent(room: Room, index: OnlineSeat, intent: OnlineIntent, now: number): OnlineRejectCode | undefined {
    if (!room.seats.every(isConnected)) return 'waiting-for-peer'
    if (intent.type === 'toss') {
      if (room.phase !== 'toss') return 'wrong-phase'
      if (index !== room.tossWinner) return 'wrong-seat'
      room.battingSeat = intent.choice === 'bat' ? index : other(index)
      room.phase = 'ready'
      return
    }
    if (intent.delivery !== room.delivery) return 'stale-delivery'
    if (intent.type === 'running') {
      if (room.battingSeat !== index) return 'wrong-seat'
      const ball = room.ball
      if ((ball?.commands.filter((command) => command.type === 'running').length ?? 0) >= 64) return 'rate-limit'
      if (!ball?.sim?.setRunning(intent.running)) return 'wrong-phase'
      ball.commands = [...ball.commands, { type: 'running', tick: ball.sim.tick, seq: intent.seq, running: intent.running }]
      return
    }
    if (intent.type === 'bowl') {
      if (room.mode === 'duo') return 'wrong-seat'
      if (room.phase !== 'ready') return 'wrong-phase'
      if (index === room.battingSeat) return 'wrong-seat'
      room.ball = {
        options: {
          seed: nextSeed(), kind: intent.kind, line: intent.line, effort: intent.effort, runningMode: 'manual',
          freeHit: room.score.freeHit, maxOutside: outsideLimit(room.overs, room.score.legalBalls), pitch: room.settings.pitch, weather: room.settings.weather,
          boundary: VENUE_BOUNDARIES[room.settings.venue],
          ...(intent.field ? { field: intent.field } : {}),
          bowler: room.lineups[other(index)].filter(isBowler)[bowlerIndex(room.score.legalBalls)] ?? 'Bowler',
          pitchWear: Math.min(1, room.score.legalBalls / 96),
          runnerPace: runnerPace(room, other(index)),
        },
        releaseAt: now + ONLINE_WINDUP_MS, sim: null, version: 2, commands: [],
      }
      room.phase = 'windup'
      return
    }
    const ball = room.ball
    if (room.phase !== 'flight' || !ball?.sim) return 'wrong-phase'
    if (index !== room.battingSeat) return 'wrong-seat'
    const input = { kind: intent.kind, aim: intent.aim, power: intent.power }
    if (ball.commands.some((command) => command.type === 'swing')) return 'swing-closed'
    const socket = room.seats[index]?.socket
    const rtt = socket ? clients.get(socket)?.rtt ?? 0 : 0
    const lagTicks = Math.floor(Math.min(MAX_INPUT_GRACE_MS, rtt) / STEP_MS)
    const receiptTick = Math.floor((now - ball.releaseAt) / STEP_MS)
    const acceptedTick = Math.max(0, receiptTick - lagTicks)
    const candidate = new DeliveryReplay({
      options: ball.options, version: 2,
      commands: [...ball.commands, { type: 'swing', tick: acceptedTick, seq: intent.seq, input }],
    })
    // Rebuild the whole accepted history, including runs before and after the
    // backdated swing. Commit only if every command through receipt still applies.
    if (!candidate.advanceTo(receiptTick)) return 'swing-closed'
    ball.commands = candidate.commands
    ball.sim = candidate.sim
  }

  server.on('connection', (socket) => {
    if (server.clients.size > MAX_ROOMS * 2) {
      send(socket, { type: 'reject', code: 'capacity', nextSeq: null })
      socket.close(1013, 'server at capacity')
      return
    }
    let guestAccount: string | undefined
    let joinedRoom: Room | null = null
    let joinedSeat: OnlineSeat | null = null
    let windowStarted = performance.now()
    let messages = 0
    const heartbeat = { alive: true, joined: false, pingAt: performance.now(), rtt: 0, nonce: randomBytes(8).toString('hex') }
    clients.set(socket, heartbeat)
    socket.on('error', () => socket.terminate())
    socket.on('pong', (data) => {
      if (data.toString() !== heartbeat.nonce) return
      heartbeat.alive = true
      heartbeat.rtt = Math.max(0, Math.min(MAX_INPUT_GRACE_MS, performance.now() - heartbeat.pingAt))
    })

    function reject(code: OnlineRejectCode) {
      const nextSeq = joinedSeat !== null ? joinedRoom?.seats[joinedSeat]?.nextSeq ?? null : null
      send(socket, { type: 'reject', code, nextSeq })
    }

    function attach(room: Room, index: OnlineSeat) {
      const member = room.seats[index] ?? { socket: null, token: randomBytes(32).toString('base64url'), account: guestAccount ?? randomBytes(32).toString('base64url'), nextSeq: 1, disconnectedUntil: null }
      store.register(member.account)
      member.socket = socket
      member.disconnectedUntil = null
      room.seats[index] = member
      joinedRoom = room
      joinedSeat = index
      heartbeat.joined = true
      heartbeat.pingAt = performance.now()
      socket.ping(heartbeat.nonce)
      if (room.mode === 'quick' && room.phase === 'lobby' && room.seats.every(isConnected)) {
        room.phase = 'toss'
        room.tossWinner = toss()
      }
      checkpoint(room)
      send(socket, { type: 'session', room: room.id, token: member.token, account: member.account, seat: index, nextSeq: member.nextSeq })
      publish(room, clock())
    }

    socket.on('message', (raw, binary) => {
      const receivedAt = performance.now()
      if (receivedAt - windowStarted >= 1000) {
        windowStarted = receivedAt
        messages = 0
      }
      if (++messages > 48) {
        reject('rate-limit')
        socket.close(1008, 'rate limited')
        return
      }
      let message: OnlineClientMessage | null
      try {
        message = binary ? null : parseMessage(JSON.parse(raw.toString()))
      } catch {
        message = null
      }
      if (!message) return reject('invalid-message')
      const now = clock()
      if ('seq' in message) {
        if (!joinedRoom || joinedSeat === null) return reject('wrong-phase')
        const member = joinedRoom.seats[joinedSeat]
        if (!member || member.socket !== socket) return reject('wrong-seat')
        if (message.seq < member.nextSeq) return reject('duplicate-sequence')
        if (message.seq > member.nextSeq) return reject('out-of-order')
        advance(joinedRoom, now)
        const denial = applyIntent(joinedRoom, joinedSeat, message, now)
        if (denial) return reject(denial)
        member.nextSeq++
        checkpoint(joinedRoom)
        send(socket, { type: 'ack', nextSeq: member.nextSeq })
        publish(joinedRoom, now)
        return
      }
      if (message.type === 'configure' || message.type === 'approve' || message.type === 'rematch' || message.type === 'next' || message.type === 'call' || message.type === 'swap') {
        if (!joinedRoom || joinedSeat === null) return reject('wrong-phase')
        const room = joinedRoom
        if (message.type === 'swap') {
          if (room.mode !== 'duo' || room.phase !== 'ready' || room.match !== message.match ||
              room.delivery !== message.delivery || room.duoSwap.version !== message.version) return reject('wrong-phase')
          if (!room.seats.every(isConnected)) return reject('waiting-for-peer')
          room.duoSwap.votes[joinedSeat] = message.approve
          if (room.duoSwap.votes.every(Boolean)) {
            const { striker, nonStriker } = room.score
            const strikerOwner = room.duoOwners[striker]
            room.duoOwners[striker] = room.duoOwners[nonStriker]
            room.duoOwners[nonStriker] = strikerOwner
            room.battingSeat = room.duoOwners[striker]
            room.duoSwap = { version: room.duoSwap.version + 1, votes: [false, false] }
          }
        } else if (message.type === 'next' || message.type === 'call') {
          if (room.mode !== 'duo' || room.match !== message.match || room.delivery !== message.delivery) return reject('wrong-phase')
          if (!room.seats.every(isConnected)) return reject('waiting-for-peer')
          if (message.type === 'call') {
            if (room.phase !== 'flight' || joinedSeat === room.battingSeat) return reject('wrong-seat')
            room.partnerCall = { seat: joinedSeat, call: message.call, at: now }
          } else {
            if (room.phase !== 'ready') return reject('wrong-phase')
            room.duoSwap = { version: room.duoSwap.version + 1, votes: [false, false] }
            const seed = nextSeed()
            const kind = DELIVERIES[(seed >>> 16) % DELIVERIES.length]
            room.ball = { options: {
              seed, kind, effort: 0.63, freeHit: room.score.freeHit, runningMode: 'manual',
              pitch: room.settings.pitch, weather: room.settings.weather,
              maxOutside: outsideLimit(room.overs, room.score.legalBalls),
              boundary: VENUE_BOUNDARIES[room.settings.venue],
              bowler: 'AI attack',
              pitchWear: Math.min(1, room.score.legalBalls / 96),
              runnerPace: runnerPace(room, room.battingSeat ?? 0),
            }, releaseAt: now + ONLINE_WINDUP_MS, sim: null, version: 2, commands: [] }
            room.phase = 'windup'
            room.partnerCall = undefined
          }
        } else if (message.type === 'rematch') {
          if (room.phase !== 'complete' || message.match !== room.match) return reject('wrong-phase')
          room.rematch[joinedSeat] = true
          if (room.rematch.every(Boolean) && room.seats.every(isConnected)) {
            room.match++
            room.duoOwners = { 1: 0, 2: 1 }
            room.duoSwap = { version: room.duoSwap.version + 1, votes: [false, false] }
            room.partnerCall = undefined
            room.score = newInnings(room.overs)
            room.firstInnings = null
            room.ball = null
            room.last = null
            room.result = null
            room.finishedAt = null
            room.delivery = 1
            room.innings = 1
            room.battingSeat = null
            room.tossWinner = null
            room.rematch = [false, false]
            room.ready = [false, false]
            room.phase = room.mode === 'quick' ? 'toss' : 'lobby'
            if (room.phase === 'toss') room.tossWinner = toss()
          }
        } else {
          if (room.phase !== 'lobby' || room.mode === 'quick' || message.version !== room.settingsVersion) return reject('wrong-phase')
          if (message.type === 'configure') {
            if (joinedSeat !== 0) return reject('wrong-seat')
            room.settings = message.settings
            room.overs = message.settings.overs
            room.score = newInnings(room.overs)
            room.settingsVersion++
            room.ready = [false, false]
          } else {
            if (room.mode === 'duo' && joinedSeat === 1 && message.lineup.join() !== room.lineups[0].join()) return reject('invalid-message')
            if (room.mode === 'duo' && joinedSeat === 0 && message.lineup.join() !== room.lineups[0].join()) {
              room.ready = [false, false]
              room.settingsVersion++
            }
            room.lineups[joinedSeat] = [...message.lineup]
            room.ready[joinedSeat] = true
            if (room.ready.every(Boolean) && room.seats.every(isConnected)) {
              room.phase = room.mode === 'duo' ? 'ready' : 'toss'
              room.tossWinner = room.mode === 'duo' ? null : toss()
              if (room.mode === 'duo') room.battingSeat = 0
            }
          }
        }
        const member = room.seats[joinedSeat]
        checkpoint(room)
        send(socket, { type: 'ack', nextSeq: member?.nextSeq ?? 1 })
        publish(room, now)
        return
      }
      if (joinedRoom) return reject('already-in-room')
      if ('account' in message && message.account && !store.knows(message.account)) return reject('invalid-token')
      guestAccount = 'account' in message ? message.account : undefined
      if (message.type === 'create' || message.type === 'create-duo' || message.type === 'quick') {
        if (message.type === 'quick') {
          for (const room of rooms.values()) {
            if (room.mode !== 'quick' || room.phase !== 'lobby' || (guestAccount && room.seats.some((seat) => seat?.account === guestAccount))) continue
            const index = seatIndices.find((seat) => room.seats[seat] === null && isConnected(room.seats[other(seat)]))
            if (index !== undefined) {
              attach(room, index)
              return
            }
          }
        }
        if (rooms.size >= MAX_ROOMS) return reject('capacity')
        const room = message.type === 'quick' ? makeRoom('quick', QUICK_OVERS)
          : makeRoom(message.type === 'create-duo' ? 'duo' : 'private', message.overs)
        attach(room, 0)
        return
      }
      const room = rooms.get(message.room)
      if (!room || (message.type === 'join' && room.mode === 'quick')) return reject('room-not-found')
      advance(room, now)
      if (!rooms.has(room.id)) return reject('room-not-found')
      if (message.type === 'join') {
        if ((guestAccount && room.seats.some((seat) => seat?.account === guestAccount))) return reject('room-full')
        const index = seatIndices.find((seat) => room.seats[seat] === null)
        if (room.phase !== 'lobby' || index === undefined) return reject('room-full')
        attach(room, index)
        return
      }
      const index = seatIndices.find((seat) => room.seats[seat]?.token === message.token)
      if (index === undefined) return reject('invalid-token')
      const member = room.seats[index]
      if (isConnected(member)) return reject('seat-online')
      if (!member || member.disconnectedUntil === null || member.disconnectedUntil <= now) return reject('invalid-token')
      attach(room, index)
    })

    socket.once('close', () => {
      clients.delete(socket)
      if (!joinedRoom || joinedSeat === null || !rooms.has(joinedRoom.id)) return
      const member = joinedRoom.seats[joinedSeat]
      if (member?.socket !== socket) return
      const now = clock()
      const live = joinedRoom.phase === 'ready' || joinedRoom.phase === 'windup' || joinedRoom.phase === 'flight'
      member.socket = null
      if (joinedRoom.mode === 'duo') joinedRoom.duoSwap = { version: joinedRoom.duoSwap.version + 1, votes: [false, false] }
      member.disconnectedUntil = now + (live ? MATCH_GRACE_MS : LOBBY_GRACE_MS)
      publish(joinedRoom, now)
    })
  })

  http.listen(port, bindHost)
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing online server TCP address')
  const ticks = setInterval(() => {
    const now = clock()
    for (const room of rooms.values()) advance(room, now)
  }, STEP_MS)
  const heartbeats = setInterval(() => {
    for (const [socket, client] of clients) {
      if (!client.alive || !client.joined) socket.terminate()
      else if (socket.readyState === WebSocket.OPEN) {
        client.alive = false
        client.pingAt = performance.now()
        client.nonce = randomBytes(8).toString('hex')
        socket.ping(client.nonce)
      }
    }
  }, 10_000)

  let closed = false
  return {
    url: `ws://${bindHost === '0.0.0.0' ? '127.0.0.1' : bindHost}:${address.port}${ONLINE_PATH}`,
    async close() {
      if (closed) return
      closed = true
      clearInterval(ticks)
      clearInterval(heartbeats)
      for (const room of rooms.values()) {
        store.commit(room.id, JSON.stringify(room, (key, value) => key === 'socket' ? null : value))
      }
      rooms.clear()
      for (const socket of server.clients) socket.terminate()
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
      await new Promise<void>((resolve, reject) => http.close((error) => error ? reject(error) : resolve()))
      store.close()
    },
  }
}

if (import.meta.main) {
  const port = Number(process.argv[2] ?? process.env.PORT ?? ONLINE_PORT)
  if (!inRange(port, 0, 65_535) || !Number.isInteger(port)) throw new Error('Expected an integer TCP port')
  const host = await startOnlineServer({
    port, databasePath: process.env.CCL_DATABASE_PATH ?? '.data/online.sqlite',
    bindHost: process.env.CCL_BIND_HOST ?? HOST,
    allowedOrigins: (process.env.CCL_ALLOWED_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean),
  })
  console.log(`Online match server listening on ${host.url}`)
}
