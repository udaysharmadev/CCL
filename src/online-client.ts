import { ONLINE_PATH, ONLINE_PORT, type OnlineControl, type OnlineHandshake, type OnlineIntent, type OnlineRejectCode, type OnlineSeat, type OnlineServerMessage, type OnlineSnapshot } from './online-contract.ts'

const ACCOUNT_KEY = 'ccl.online.account.v1'
const SESSION_KEY = 'ccl.online.v1'
const ROOM_PATTERN = /^[A-Za-z0-9_-]{12}$/
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
export type OnlineCommand = {
  [Type in OnlineIntent['type']]: Omit<Extract<OnlineIntent, { type: Type }>, 'seq'>
}[OnlineIntent['type']]
export type OnlineConnectionStatus = 'connecting' | 'reconnecting' | 'unavailable' | 'closed'
type Resume = Extract<OnlineHandshake, { type: 'resume' }>

export function roomCode(value: string | null) {
  return value && ROOM_PATTERN.test(value) ? value : null
}

export function rememberedRoom(): Resume | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null')
    if (value && typeof value === 'object' && 'room' in value && 'token' in value &&
        typeof value.room === 'string' && ROOM_PATTERN.test(value.room) &&
        typeof value.token === 'string' && TOKEN_PATTERN.test(value.token)) {
      return { type: 'resume', room: value.room, token: value.token }
    }
  } catch { /* Reconnection can still work while this page stays open. */ }
  return null
}

function remember(session: Resume | null) {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
    else sessionStorage.removeItem(SESSION_KEY)
  } catch { /* Session storage is optional in a private iframe. */ }
}

function endpoint() {
  const configured = import.meta.env.VITE_CCL_ONLINE_URL?.trim()
  if (!configured && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
    return `ws://127.0.0.1:${ONLINE_PORT}${ONLINE_PATH}`
  }
  if (configured) {
    try {
      const url = new URL(configured)
      if (url.protocol === 'wss:' || (url.protocol === 'ws:' && location.protocol === 'http:')) return url.href
    } catch { /* The lobby reports an unavailable endpoint. */ }
  }
  return location.protocol === 'https:' ? `wss://${location.host}${ONLINE_PATH}` : null
}

/**
 * The control messages carry their own concurrency token, so they must not be
 * given a sequence number. Listing them explicitly means a new control message
 * is never silently rejected by the server.
 */
const CONTROL_MESSAGES = new Set(['configure', 'approve', 'rematch', 'swap', 'next', 'call'])

function isControl(command: OnlineCommand | OnlineControl) {
  return CONTROL_MESSAGES.has(command.type)
}

export function connectOnline(first: OnlineHandshake, events: {
  snapshot: (snapshot: OnlineSnapshot, seat: OnlineSeat) => void
  status: (status: OnlineConnectionStatus) => void
  reject: (code: OnlineRejectCode, connected: boolean) => void
}) {
  const url = endpoint()
  let socket: WebSocket | undefined
  let resume: Resume | null = first.type === 'resume' ? first : null
  let seat: OnlineSeat | undefined
  let nextSeq = 1
  let pending = false
  let stopped = false
  let retryUntil = 0
  let revision = 0
  let timer: number | undefined
  let handshakeTimer: number | undefined

  function stop(forget = true) {
    stopped = true
    window.clearTimeout(timer)
    window.clearTimeout(handshakeTimer)
    socket?.close()
    if (forget) remember(null)
  }

  function open(handshake: OnlineHandshake) {
    if (stopped) return
    if (!url) {
      timer = window.setTimeout(() => events.status('unavailable'))
      return
    }
    events.status(handshake.type === 'resume' ? 'reconnecting' : 'connecting')
    const connection = new WebSocket(url)
    socket = connection
    seat = undefined
    pending = false
    handshakeTimer = window.setTimeout(() => connection.close(), 4500)
    connection.addEventListener('open', () => connection.send(JSON.stringify((() => {
      try {
        const account = localStorage.getItem(ACCOUNT_KEY)
        return account && TOKEN_PATTERN.test(account) ? { ...handshake, account } : handshake
      } catch { return handshake }
    })())), { once: true })
    connection.addEventListener('message', (event) => {
      if (stopped || socket !== connection || typeof event.data !== 'string') return
      let message: OnlineServerMessage
      try { message = JSON.parse(event.data) } catch { return }
      if (!message || typeof message !== 'object') return
      if (message.type === 'session') {
        window.clearTimeout(handshakeTimer)
        if (!ROOM_PATTERN.test(message.room) || !TOKEN_PATTERN.test(message.token) ||
            (message.seat !== 0 && message.seat !== 1) || !Number.isSafeInteger(message.nextSeq)) {
          stop()
          events.status('closed')
          return
        }
        if (message.account && TOKEN_PATTERN.test(message.account)) {
          try { localStorage.setItem(ACCOUNT_KEY, message.account) } catch { /* The session token remains usable. */ }
        }
        resume = { type: 'resume', room: message.room, token: message.token }
        remember(resume)
        seat = message.seat
        nextSeq = message.nextSeq
        retryUntil = 0
      } else if (message.type === 'snapshot' && seat !== undefined && message.state?.room === resume?.room &&
                 message.state.revision > revision) {
        revision = message.state.revision
        events.snapshot(message.state, seat)
      } else if (message.type === 'ack') {
        nextSeq = message.nextSeq
        pending = false
      } else if (message.type === 'reject') {
        pending = false
        if (message.nextSeq !== null) nextSeq = message.nextSeq
        if (seat === undefined && message.code === 'seat-online' && resume) {
          connection.close()
          return
        }
        if (seat === undefined) stop()
        events.reject(message.code, seat !== undefined)
      }
    })
    connection.addEventListener('close', () => {
      if (stopped || socket !== connection) return
      window.clearTimeout(handshakeTimer)
      if (!resume) {
        events.status('unavailable')
        return
      }
      // The server holds a seat for fifteen seconds during a match, so the
      // client waits longer than that before giving up on the seat.
      retryUntil ||= performance.now() + 20_000
      if (performance.now() >= retryUntil) {
        stop()
        events.status('closed')
        return
      }
      const rejoin = resume
      timer = window.setTimeout(() => open(rejoin), 500)
      events.status('reconnecting')
    }, { once: true })
  }

  open(first)
  return {
    stop,
    send(command: OnlineCommand | OnlineControl) {
      if (seat === undefined || pending || socket?.readyState !== WebSocket.OPEN) return false
      pending = true
      socket.send(JSON.stringify(isControl(command) ? command : { ...command, seq: nextSeq }))
      return true
    },
  }
}
