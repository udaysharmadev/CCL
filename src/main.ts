import './style.css'
import './clubhouse.css'
import './lobby.css'
import './menu-theme.css'
import { renderMatchScorecard, overSummary } from './scorecard.ts'
import { createFieldMap } from './field-map.ts'
import { swipeShot, type BattingMode } from './swipe.ts'
import {
  fieldPositions, KEEPER, PITCH_LENGTH, positionName, bounceLength, DELIVERIES, DELIVERY_LABELS, DT, Delivery, FIELD_LABELS, FIELD_PRESETS, SHOT_ANGLES, SHOT_LABELS, SHOTS,
  type DeliveryKind, type DeliveryOptions, type FieldPreset, type Shot, type ShotInput, type Vec3, type FieldingCommand,
} from './cricket.ts'
import { applyDelivery, BALLS_PER_OVER, deliveryToken, formatOvers, newInnings, outsideLimit, runRates, type DeliveryOutcome, type Innings } from './rules.ts'
import { createStadium, VENUE_BOUNDARIES, VENUE_NAMES, type StadiumFrame } from './stadium.ts'
import { mark, readTelemetry, sample } from './telemetry.ts'
import { initializePlatform, inviteLink, inviteRoom, leavePublishedRoom, publishRoom, save, setGameplay, setLoading, stored } from './platform.ts'
import { PITCH_LABELS, PITCH_PRESETS, WEATHER_LABELS, WEATHER_PRESETS } from './cricket.ts'
import { type RoomSettings } from './match-data.ts'
import { DEFAULT_SETTINGS, getLineup, getSettings, isBowler, setupMenus, type SoloSettings } from './setup.ts'
import { connectOnline, rememberedRoom, roomCode, type OnlineConnectionStatus } from './online-client.ts'
import { ONLINE_WINDUP_MS, type OnlineHandshake, type OnlineSeat, type OnlineSnapshot } from './online-contract.ts'
import { DeliveryReplay } from './delivery-replay.ts'
import { broadcastEvent, inningsMilestone } from './broadcast.ts'

import { newSixChallenge, scoreSix, SIX_ATTEMPTS, type SixChallenge } from './six-challenge.ts'
import { applyReview, DISMISSAL_LABELS } from './laws.ts'
import { battingStyle, bowlingLine, bowlingStyle } from './players.ts'
import { DEFAULT_SETTINGS as DEFAULT_PLAYER_SETTINGS, EMPTY_CAREER, TIMING_WINDOWS, loadCareer as loadCareerRecord, loadSettings, saveCareer, saveSettings, type CareerRecord, type Settings } from './settings.ts'

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Missing game element #${id}`)
  return node as T
}

const ui = {
  game: element('game'), stadium: element('stadium'), home: element('home'), venue: element('venue'),
  homeButton: element<HTMLButtonElement>('home-button'), solo: element<HTMLButtonElement>('solo-button'),
  training: element<HTMLButtonElement>('training-button'), sound: element<HTMLButtonElement>('sound-button'),
  setup: element<HTMLButtonElement>('setup-button'), lineup: element<HTMLButtonElement>('lineup-button'),
  six: element<HTMLButtonElement>('six-button'), online: element<HTMLButtonElement>('online-button'), progress: element('loading-progress'),
  pause: element<HTMLButtonElement>('pause-button'), loading: element('loading'), coins: element('coins'), xp: element('xp'),
  pauseLabel: element('pause-label'),
  scoreboard: element('scoreboard'), teamCode: element('team-code'), score: element('score'), overs: element('overs'),
  oversLimit: element('overs-limit'), chase: element('chase'), freeHit: element('free-hit'), stats: element('score-stats'),
  ribbon: element('ribbon'), matchId: element('match-id'), playfield: element('playfield'), targetLabel: element('target-label'),
  countdown: element('countdown'), callout: element('callout'), callTitle: element('call-title'), callDetail: element('call-detail'),
  callKicker: element('call-kicker'), milestone: element('match-milestone'),
  dock: element('control-dock'), batControls: element('bat-controls'), bowlControls: element('bowl-controls'),
  deliveries: element('deliveries'), timing: element('timing'), needle: element('timing-needle'),
  deliveryBank: element<HTMLSelectElement>('delivery-bank'), field: element<HTMLSelectElement>('field-select'), fieldLabel: element('field-label'),
  line: element<HTMLInputElement>('line'), lineLabel: element('line-label'),
  effort: element<HTMLInputElement>('effort'), effortLabel: element('effort-label'), bowlSliders: element('bowl-sliders'),
  replay: element<HTMLButtonElement>('replay-button'), next: element<HTMLButtonElement>('next-button'),
  status: element('phase-status'), overlay: element<HTMLDialogElement>('overlay'), overlayKicker: element('overlay-kicker'),
  overlayTitle: element('overlay-title'), overlayText: element('overlay-text'), overlayScores: element('overlay-scores'),
  overlayActions: element('overlay-actions'),
  onlineMenu: element<HTMLDialogElement>('online-dialog'),
  duoControls: element('duo-controls'), duoRole: element('duo-role'), duoSwap: element<HTMLButtonElement>('duo-swap'),
  duoRun: element<HTMLButtonElement>('duo-run'), duoWait: element<HTMLButtonElement>('duo-wait'), duoNo: element<HTMLButtonElement>('duo-no'),
  privateOvers: element<HTMLInputElement>('private-overs'), joinCode: element<HTMLInputElement>('join-code'),
  loft: element<HTMLButtonElement>('loft-toggle'), defense: element<HTMLButtonElement>('defense-toggle'),
  swipeCue: element('swipe-cue'), swipeTrail: element('swipe-trail'),
  swipeLine: document.querySelector<SVGLineElement>('#swipe-line'),
  swipeOrigin: document.querySelector<SVGCircleElement>('#swipe-origin'),
  swipeTip: document.querySelector<SVGCircleElement>('#swipe-tip'), shotFeedback: element('shot-feedback'),
  autoNext: element<HTMLButtonElement>('auto-next'),
  pauseTools: element('pause-tools'), timingResult: element('timing-result'), battingMode: element('batting-mode'),
  scoreContext: element('score-context'), lastBall: element('last-ball'),
  batterStrip: element('batter-strip'), scoreRate: element('score-rate'), broadcastMatch: element('broadcast-match'),
  fieldMapButton: element<HTMLButtonElement>('field-map-button'),
  fieldingControls: element('fielding-controls'), fieldingStatus: element('fielding-status'),
  fieldingChase: element<HTMLButtonElement>('fielding-chase'), throwKeeper: element<HTMLButtonElement>('throw-keeper'),
  throwBowler: element<HTMLButtonElement>('throw-bowler'),
  fieldDialog: element<HTMLDialogElement>('field-dialog'), fieldHelp: element('field-help'), fieldNotice: element('field-notice'),
  fielderSelect: element<HTMLSelectElement>('fielder-select'),
  scorecardButton: element<HTMLButtonElement>('scorecard-button'),
  scorecardDialog: element<HTMLDialogElement>('scorecard-dialog'),
  scorecardBody: element('scorecard-body'), scorecardTitle: element('scorecard-title'),
  howToPlay: element<HTMLButtonElement>('how-to-play'),
  howToPlayDialog: element<HTMLDialogElement>('how-to-play-dialog'),
  settingsButton: element<HTMLButtonElement>('settings-button'),
  settingsDialog: element<HTMLDialogElement>('settings-dialog'),
  settingSound: element<HTMLInputElement>('setting-sound'),
  settingMotion: element<HTMLInputElement>('setting-motion'),
  settingNeedle: element<HTMLInputElement>('setting-needle'),
  settingQuality: element<HTMLSelectElement>('setting-quality'),
  settingDifficulty: element<HTMLSelectElement>('setting-difficulty'),
  careerSummary: element('career-summary'),
  drsDialog: element<HTMLDialogElement>('drs-dialog'),
  reviewHint: element<HTMLButtonElement>('review-hint'),
  drsTitle: element('drs-title'), drsBody: element('drs-body'),
  drsDetail: element('drs-detail'), drsActions: element('drs-actions'),
}

const OPPONENT_NAMES = ['Hayes', 'Reed', 'Ward', 'Mills', 'Cole', 'Nash', 'Bell', 'Frost', 'Pike', 'King', 'Banks']
const OPPONENT_BOWLERS = ['Ward', 'Cole', 'Mills', 'Bell', 'King']
const SIX_BEST_KEY = 'ccl.six-best.v1'
const CAREER_KEY = 'ccl.career.v1'
const SOUND_KEY = 'ccl.sound.v1'
const WINDUP_SECONDS = 3
const DRAWN_FRAME_LIMIT = 0.12

type View = 'home' | 'training' | 'solo' | 'online' | 'six'
type Phase = StadiumFrame['phase']
type Career = { coins: number; xp: number }
type RecordedShot = { tick: number; input: ShotInput }
type Replay = { fielding?: readonly { tick: number; command: FieldingCommand }[]; runs?: readonly { tick: number; running: boolean }[]; options: DeliveryOptions; shot?: RecordedShot; signal?: StadiumFrame['signal'] }
type DrsState = {
  reviewsLeft: number
  pendingOutcome?: DeliveryOutcome
  pendingRecord?: Replay
  reviewDeadline: number
}
type Match = {
  seed: number
  first: Innings
  second?: Innings
  playerBatsFirst: boolean
  settings: SoloSettings
  lineup: string[]
  drs: DrsState
  reward?: Career
  saved?: boolean
}
type OverlayButton = { label: string; run: () => void; secondary?: boolean }

let six: SixChallenge = newSixChallenge()
let sixBest = { distance: 0, points: 0 }
let sixSaved = true
let view: View = 'home'
let phase: Phase = 'ready'
let match: Match | undefined
let live: Delivery | undefined
let record: Replay | undefined
let lastReplay: Replay | undefined
let replaying = false
let paused = false
let activeShot: Shot = 'drive'
let activeDelivery: DeliveryKind = 'fast'
let activeField: FieldPreset = 'balanced'
let aim = 0
let aiShot: RecordedShot | undefined
let elapsed = 0
let accumulator = 0
let previousFrame = 0
let inputTimestamp: number | undefined
let signal: StadiumFrame['signal']
let pointer: { id: number; x: number; y: number; at: number } | undefined
let battingMode: BattingMode = 'normal'
let fieldLayout: readonly Vec3[] | undefined
let selectedFielder = 0
let autoNext = true
let gestureSwing: { at: number; shot: Shot } | undefined
let feedbackUntil = 0
let audio: AudioContext | undefined
let audioOutput: GainNode | undefined
let crowdNoise: AudioBuffer | undefined
let crowdGain: GainNode | undefined
let career: Career = { coins: 0, xp: 0 }
let careerRecord: CareerRecord = { ...EMPTY_CAREER }
let settings: Settings = { ...DEFAULT_PLAYER_SETTINGS }
let muted = false
let platformMuted = false
let refreshPending = true
let network: ReturnType<typeof connectOnline> | undefined
let onlineState: OnlineSnapshot | undefined
let onlineSeat: OnlineSeat | undefined
let onlinePanel: 'waiting' | 'lobby' | 'toss' | 'exit' | 'result' | undefined
let onlineBall = 0
let onlineResolvedBall = 0
let onlineSwingSent = false
let onlineWindupEnd = 0
let onlineSnapshotAt = 0
let onlineNotice = ''
let onlineReplay: DeliveryReplay | undefined
let onlineHistory = ''
let onlineContactPlayed = false

/** A local match owns its reviews; the allowance renews for each innings. */
function newDrsState(): DrsState {
  return { reviewsLeft: 2, reviewDeadline: 0 }
}

function clearReviewPresentation() {
  ui.reviewHint.hidden = true
  ui.reviewHint.textContent = ''
  ui.drsDialog.close()
  ui.drsTitle.textContent = ''
  ui.drsBody.replaceChildren()
  ui.drsDetail.textContent = ''
  ui.drsActions.replaceChildren()
}

function loadCareer(): Career {
  try {
    const raw = JSON.parse(stored(CAREER_KEY) ?? 'null')
    if (raw && Number.isSafeInteger(raw.coins) && raw.coins >= 0 && Number.isSafeInteger(raw.xp) && raw.xp >= 0) {
      return { coins: raw.coins, xp: raw.xp }
    }
  } catch { /* A missing or unreadable save starts a new local career. */ }
  return { coins: 0, xp: 0 }
}

function sound(kind: 'release' | 'swing' | 'contact' | 'wicket' | 'boundary') {
  if (muted || platformMuted) return
  try {
    audio ??= new AudioContext()
    if (audio.state !== 'running') return
    const now = audio.currentTime
    const config = {
      release: [160, 78, 0.085, 0.025],
      swing: [230, 65, .14, .025],
      contact: [470, 90, 0.095, 0.115],
      wicket: [325, 116, 0.16, 0.10],
      boundary: [340, 520, 0.21, 0.045],
    }[kind]
    const oscillator = audio.createOscillator()
    const gain = audio.createGain()
    oscillator.type = kind === 'boundary' ? 'sine' : 'triangle'
    oscillator.frequency.setValueAtTime(config[0], now)
    oscillator.frequency.exponentialRampToValueAtTime(config[1], now + config[2])
    gain.gain.setValueAtTime(config[3], now)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + config[2])
    oscillator.connect(gain).connect(audioOutput ?? audio.destination)
    oscillator.start(now)
    oscillator.stop(now + config[2])
    if (crowdNoise) {
      const noise = audio.createBufferSource()
      noise.buffer = crowdNoise
      noise.loop = true
      const filter = audio.createBiquadFilter()
      filter.type = kind === 'contact' ? 'lowpass' : 'bandpass'
      filter.frequency.value = kind === 'contact' ? 1900 : kind === 'boundary' ? 850 : 520
      filter.Q.value = .6
      const envelope = audio.createGain()
      const cheering = kind === 'boundary' || kind === 'wicket'
      const duration = cheering ? 2.4 : .11
      envelope.gain.setValueAtTime(.0001, now)
      envelope.gain.exponentialRampToValueAtTime(cheering ? .32 : kind === 'contact' ? .24 : .035, now + .02)
      envelope.gain.exponentialRampToValueAtTime(.0001, now + duration)
      noise.connect(filter).connect(envelope).connect(audioOutput ?? audio.destination)
      noise.start(now)
      noise.stop(now + duration)
    }
  } catch { /* Audio is optional on browsers that block it. */ }
}

function enableAudio() {
  if (muted || platformMuted) return
  try {
    audio ??= new AudioContext()
    if (!audioOutput) {
      audioOutput = audio.createGain()
      audioOutput.connect(audio.destination)
    }
    audioOutput.gain.setTargetAtTime(1, audio.currentTime, .05)
    if (!crowdNoise) {
      crowdNoise = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate)
      const data = crowdNoise.getChannelData(0)
      let previous = 0
      for (let i = 0; i < data.length; i++) {
        previous = previous * .82 + (Math.random() * 2 - 1) * .18
        data[i] = previous
      }
      const crowd = audio.createBufferSource()
      crowd.buffer = crowdNoise
      crowd.loop = true
      const filter = audio.createBiquadFilter()
      filter.type = 'bandpass'
      filter.frequency.value = 720
      filter.Q.value = .45
      crowdGain = audio.createGain()
      crowdGain.gain.value = .16
      crowd.connect(filter).connect(crowdGain).connect(audioOutput)
      crowd.start()
    }
    void audio.resume().catch(() => {})
    crowdGain?.gain.setTargetAtTime(paused ? 0 : .16, audio.currentTime, .15)
  } catch { /* The match is fully playable with the visual cues. */ }
}

function showCareerSummary() {
  if (careerRecord.matches === 0) {
    ui.careerSummary.hidden = true
    return
  }
  ui.careerSummary.textContent = `${careerRecord.matches} matches · ${careerRecord.wins} won · ${careerRecord.runs} runs · ` +
    `${careerRecord.wickets} wickets · best ${careerRecord.bestRuns} · ${careerRecord.fours} fours · ${careerRecord.sixes} sixes`
  ui.careerSummary.hidden = false
}

function showWallet() {
  const wallet = view === 'online' && onlineSeat !== undefined ? onlineState?.wallets[onlineSeat] ?? career : career
  ui.coins.textContent = String(wallet.coins)
  ui.xp.textContent = String(wallet.xp)
  ui.coins.closest('.wallet')?.setAttribute('aria-label', view === 'online' ? 'Server online rewards' : 'Solo rewards')
  ui.coins.closest('.wallet')?.setAttribute('title', view === 'online' ? 'Online rewards saved by the match server' : 'Solo rewards saved on this device')
  ui.sound.textContent = muted || platformMuted ? 'Sound off' : 'Sound on'
  ui.sound.setAttribute('aria-pressed', String(!muted && !platformMuted))
  ui.sound.disabled = platformMuted
  if (audio) audioOutput?.gain.setTargetAtTime(muted || platformMuted ? 0 : 1, audio.currentTime, .04)
  if (audio && crowdGain) crowdGain.gain.setTargetAtTime(muted || platformMuted || paused ? 0 : .16, audio.currentTime, .1)
}

function configureChoices<T extends string>(
  container: HTMLElement, options: readonly T[], labels: Record<T, string>, select: (kind: T) => void,
) {
  const choices = new Map<T, HTMLButtonElement>()
  options.forEach((kind, index) => {
    const button = document.createElement('button')
    button.className = 'choice'
    button.type = 'button'
    button.textContent = labels[kind]
    button.setAttribute('aria-label', labels[kind])
    const key = document.createElement('kbd')
    key.textContent = String(index % 4 + 1)
    key.setAttribute('aria-hidden', 'true')
    button.append(key)
    button.addEventListener('click', () => select(kind))
    container.append(button)
    choices.set(kind, button)
  })
  return choices
}

const bowlButtons = configureChoices(ui.deliveries, DELIVERIES, DELIVERY_LABELS, (kind) => {
  if (phase === 'ready' || phase === 'dead') activeDelivery = kind
  refreshPending = true
})

function currentInnings() {
  if (view === 'online' && onlineState) {
    const { target, recent, ...score } = onlineState.score
    return { ...score, target: target ?? undefined, history: recent }
  }
  return match?.second ?? match?.first
}

function isBowling() {
  if (view === 'online' && onlineState?.battingSeat != null && onlineSeat !== undefined) return onlineState.battingSeat !== onlineSeat
  return match ? match.playerBatsFirst === Boolean(match.second) : false
}

function setPhase(next: Phase) {
  phase = next
  elapsed = 0
  if (next !== 'dead') ui.milestone.hidden = true
  refreshPending = true
}

function nextSeed(base: number, attempt: number, bowling: boolean) {
  return (base + Math.imul(attempt, 0x9e3779b1) + Number(bowling) * 1274131) >>> 0
}

function start(mode: 'solo' | 'training' | 'six', settings = mode === 'solo' ? getSettings() : DEFAULT_SETTINGS) {
  enableAudio()
  const rawSeed = new URLSearchParams(location.search).get('seed')
  const seed = rawSeed !== null && /^\d{1,10}$/.test(rawSeed)
    ? Number(rawSeed) >>> 0 : crypto.getRandomValues(new Uint32Array(1))[0]
  view = mode
  six = newSixChallenge()
  if (mode === 'six') {
    settings = { ...DEFAULT_SETTINGS, overs: 2 }
    try {
      const value = JSON.parse(stored(SIX_BEST_KEY) ?? 'null')
      if (value && Number.isFinite(value.distance) && value.distance >= 0 &&
          Number.isSafeInteger(value.points) && value.points >= 0) sixBest = value
    } catch { /* An unreadable best starts a new local record. */ }
  }
  match = {
    seed, first: newInnings(mode === 'training' ? 1 : settings.overs, undefined,
      settings.toss === 'bat' ? getLineup() : OPPONENT_NAMES),
    playerBatsFirst: settings.toss === 'bat', settings, lineup: getLineup(),
    drs: newDrsState(),
  }
  clearReviewPresentation()
  stadium?.setConditions(settings)
  paused = false
  replaying = false
  lastReplay = undefined
  activeShot = mode === 'six' ? 'loft' : 'drive'
  battingMode = mode === 'six' ? 'loft' : 'normal'
  fieldLayout = undefined
  gestureSwing = undefined
  activeDelivery = 'fast'
  activeField = settings.field
  aim = 0
  ui.deliveryBank.value = '0'
  ui.field.value = activeField
  ui.line.value = '0'
  ui.effort.value = '0.67'
  ui.overlay.close()
  setPhase('ready')
  mark('firstPlay')
  setGameplay(true)
  if (!isBowling()) beginBall()
}

function home() {
  if (network) {
    network.stop()
    network = undefined
    onlineState = undefined
    onlineSeat = undefined
    onlinePanel = undefined
    onlineNotice = ''
    leavePublishedRoom()
    const url = new URL(location.href)
    if (url.searchParams.has('room')) {
      url.searchParams.delete('room')
      history.replaceState(history.state, '', url)
    }
  }
  setGameplay(false)
  view = 'home'
  match = undefined
  clearReviewPresentation()
  live = undefined
  record = undefined
  lastReplay = undefined
  replaying = false
  paused = false
  signal = undefined
  pointer = undefined
  ui.swipeTrail.classList.remove('drawing')
  stadium?.setConditions({})
  ui.overlay.close()
  setPhase('ready')
  showWallet()
  showHomeMatch()
  ui.solo.focus()
}

function showHomeMatch() {
  const saved = getSettings()
  element('home-match-details').textContent = `${saved.overs} OVERS · ${VENUE_NAMES[saved.venue].toUpperCase()}`
  element('home-venue-name').textContent = VENUE_NAMES[saved.venue].toUpperCase()
}

function beginBall() {
  const innings = currentInnings()
  if (!match || !innings || innings.complete || (view === 'six' && six.complete) || paused || replaying ||
    (phase !== 'ready' && phase !== 'dead')) return
  const bowling = isBowling()
  const seed = nextSeed(match.seed, innings.attempts, bowling)
  let kind = activeDelivery
  let line: number | undefined
  let effort: number | undefined
  if (bowling) {
    line = Number(ui.line.value)
    effort = Number(ui.effort.value)
  }
  const { venue, pitch, weather } = match.settings
  const bowlerPool = bowling ? (match.lineup.filter(isBowler).slice(0, 5) ?? []) : OPPONENT_BOWLERS
  const overIndex = Math.floor(innings.legalBalls / BALLS_PER_OVER)
  const bowlerName = bowlerPool[overIndex % Math.max(1, bowlerPool.length)] ?? 'Bowler'
  const style = bowlingStyle(bowlerName)
  // The bowler at the crease really bowls the ball he bowls. Training and the
  // easiest difficulty keep to a simpler repertoire.
  const simple = view === 'six' || view === 'training' || match.settings.difficulty === 'Rookie'
  const bowlerKinds = simple
    ? (['fast', 'length', 'yorker', 'spin'] as const).filter((kind) => style.kinds.includes(kind))
    : style.kinds
  if (!bowling) {
    kind = innings.attempts === 0 ? 'fast' : bowlerKinds[(seed >>> 16) % bowlerKinds.length]
    line = view === 'six' ? 0.2 : innings.attempts === 0 ? 0.2
      : view === 'solo' && seed % 23 === 0 ? 1.23
        : bowlingLine(style, ((seed >>> 20) & 0xfff) / 0xfff)
    effort = style.effort
  }
  const batters = bowling ? OPPONENT_NAMES : (match.lineup ?? [])
  const runnerPace: [number, number] = [
    battingStyle(batters[innings.striker - 1] ?? '').running,
    battingStyle(batters[innings.nonStriker - 1] ?? '').running,
  ]
  record = { options: {
    seed, kind, line, effort, freeHit: innings.freeHit, field: bowling ? activeField : 'balanced',
    fieldLayout: bowling ? fieldLayout : undefined,
    ...(bowling && match.settings.fielding === 'manual' ? { fieldingMode: 'manual' as const } : {}),
    pitch, weather, maxOutside: view === 'training' ? undefined : outsideLimit(innings.overs, innings.legalBalls), boundary: VENUE_BOUNDARIES[venue],
    bowler: bowlerName,
    // The pitch wears as the innings goes on: it bounces less and turns more.
    pitchWear: Math.min(1, innings.legalBalls / 96),
    runnerPace,
    timingWindow: TIMING_WINDOWS[settings.timing],
    ...(bowling ? { swing: style.swing, turn: style.turn } : {}),
    ...(!bowling && view !== 'six' ? { runningMode: 'manual' as const } : {}),
  } }
  signal = undefined
  gestureSwing = undefined
  ui.shotFeedback.hidden = true
  ui.timingResult.textContent = 'WATCH THE BALL'
  delete ui.timing.dataset.result
  live = undefined
  aiShot = undefined
  pointer = undefined
  ui.swipeTrail.classList.remove('drawing')
  setPhase('windup')
  ui.status.textContent = `${DELIVERY_LABELS[kind]} delivery in three seconds.`
}

function release() {
  if (!record) return
  live = new Delivery(record.options)
  ui.needle.style.setProperty('--timing', '0%')
  if (match && isBowling() && !replaying) {
    const seed = record.options.seed
    const projected = live.projectedContact
    const difficulty = match.settings.difficulty
    const spread = { Rookie: 17, Club: 12, Pro: 8, Legend: 5 }[difficulty]
    const skillError = (seed >>> 9) % spread - Math.floor(spread / 2)
    const strokes: readonly Shot[] = difficulty === 'Rookie' || difficulty === 'Club'
      ? SHOTS.slice(0, 4)
      : projected.y < 0.42 ? ['drive', 'defend', 'on-drive'] : projected.y > 1.13 ? ['pull', 'hook', 'cut'] : SHOTS
    const kind = projected.y < 0.38 ? 'drive' : strokes[(seed >>> 20) % strokes.length]
    if (Math.abs(projected.x) < 1.08 && seed % (difficulty === 'Rookie' ? 5 : 10) !== 0) {
      aiShot = {
        tick: Math.max(0, live.contactTick + skillError),
        input: { kind, aim: SHOT_ANGLES[kind] + ((seed >>> 4) % 11 - 5) * 0.12, power: 0.64 },
      }
    }
  }
  sound('release')
  if (!replaying) mark('firstRelease')
  setPhase('flight')
  ui.status.textContent = isBowling() ? 'Ball released.' : 'Ball released. Time your swing.'
}

function battingInput(input: ShotInput, timestamp: number) {
  if (paused || replaying || isBowling() || phase !== 'flight' || !live || !record) return false
  enableAudio()
  if (view === 'online') {
    if (!onlineState || onlineSwingSent) return false
    const aim = Math.atan2(Math.sin(input.aim), Math.cos(input.aim))
    onlineSwingSent = network?.send({
      type: 'swing', delivery: onlineState.delivery, kind: input.kind, aim, power: input.power ?? 0.75,
    }) ?? false
    if (onlineSwingSent) inputTimestamp = timestamp
    return onlineSwingSent
  }
  if (live.swing(input)) {
    inputTimestamp = timestamp
    record.shot = { input, tick: live.tick }
    return true
  }
  return false
}

function advanceDelivery() {
  if (!live || !record) return
  const queued = replaying ? record.shot : aiShot
  if (queued?.tick === live.tick && live.swing(queued.input) && !replaying) record.shot = queued
  if (replaying) for (const control of record.runs ?? []) if (control.tick === live.tick) live.setRunning(control.running)
  if (replaying) for (const control of record.fielding ?? []) if (control.tick === live.tick) live.fieldControl(control.command)
  live.step()
  if (live.contactEventTick === live.tick && live.phase === 'field') {
    sound('contact')
    if (!replaying && !isBowling()) showTiming()
    if (!replaying && !isBowling() && live.swingTick !== null) {
      sample('swingToContactMs', (live.tick - live.swingTick) * DT * 1000)
    }
  }
  if (live.phase === 'field' && phase !== 'field') setPhase('field')
  if (live.outcome && phase !== 'dead') settleBall(live.outcome)
}

function outcomeSignal(outcome: DeliveryOutcome): StadiumFrame['signal'] {
  if (outcome.wicket) return 'out'
  if (outcome.noBall) return 'no-ball'
  if (outcome.wide) return 'wide'
  if (outcome.reason === 'boundary') return outcome.batRuns === 6 ? 'six' : 'four'
  return undefined
}

function drawOnlineBall(tick: number, audioEnabled = true) {
  if (!live || !record || !onlineReplay) return
  const valid = onlineReplay.advanceTo(Math.max(tick, live.tick), (sim) => {
    if (audioEnabled && !onlineContactPlayed && sim.contactEventTick === sim.tick && sim.phase === 'field') {
      onlineContactPlayed = true
      sound('contact')
      if (!isBowling()) showTiming()
    }
  })
  if (!valid) throw new Error('Invalid authoritative delivery history')
  if (phase === 'flight' && live.phase === 'field') setPhase('field')
}

function showOnlineResult(state: OnlineSnapshot, seat: OnlineSeat) {
  if (!state.result) return
  onlinePanel = 'result'
  const { reason, winner, margin } = state.result
  const title = reason === 'duo' ? 'Partnership complete' : reason === 'tie' ? 'Match tied' : reason === 'abandoned' ? 'Match abandoned'
    : winner === seat ? 'You win' : 'Opponent wins'
  const text = reason === 'duo' ? `Together you scored ${state.score.runs}/${state.score.wickets} in ${formatOvers(state.score.legalBalls)} overs.` : reason === 'forfeit' ? 'A player did not reconnect before the grace period ended.'
    : reason === 'abandoned' ? 'The room closed before play began.'
      : reason === 'tie' ? 'Both teams finished level.' : `Winning margin · ${margin} ${reason}`
  openOverlay('ONLINE RESULT', title, text, [
    { label: state.rematch[seat] ? 'Rematch requested' : 'Rematch', run: () => network?.send({ type: 'rematch', match: state.match }) },
    { label: 'Return to stadium', run: home, secondary: true },
  ])
  const rematchButton = ui.overlayActions.querySelector('button')
  if (rematchButton) rematchButton.disabled = state.rematch[seat]
  showWallet()
  if (state.firstInnings) {
    const { battingSeat, score } = state.firstInnings
    showScoreCards(battingSeat === 0 ? score : state.score, battingSeat === 0 ? state.score : score)
  }
}

function roomConfiguration(state: OnlineSnapshot, seat: OnlineSeat) {
  const form = document.createElement('form')
  form.className = 'setup-form'
  const selection = <T extends string>(label: string, values: readonly T[], current: T, labels?: Record<T, string>) => {
    const row = document.createElement('label')
    row.textContent = label
    const input = document.createElement('select')
    input.setAttribute('aria-label', label)
    input.replaceChildren(...values.map((value) => new Option(labels?.[value] ?? value, value)))
    input.value = current
    input.disabled = seat !== 0
    row.append(input)
    form.append(row)
    return input
  }
  const overs = selection('Room overs', Array.from({ length: 19 }, (_, i) => String(i + 2)), String(state.overs))
  const venues = Object.keys(VENUE_NAMES) as RoomSettings['venue'][]
  const venue = selection('Room ground', venues, state.settings.venue, VENUE_NAMES)
  const pitch = selection('Room pitch', PITCH_PRESETS, state.settings.pitch, PITCH_LABELS)
  const weather = selection('Room weather', WEATHER_PRESETS, state.settings.weather, WEATHER_LABELS)
  if (seat === 0) {
    const apply = document.createElement('button')
    apply.type = 'submit'
    apply.className = 'secondary'
    apply.textContent = 'Apply room setup'
    form.append(apply)
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    network?.send({ type: 'configure', version: state.settingsVersion, settings: {
      overs: Number(overs.value), venue: venue.value as RoomSettings['venue'],
      pitch: pitch.value as RoomSettings['pitch'], weather: weather.value as RoomSettings['weather'],
    } })
  })
  const ready = document.createElement('button')
  ready.type = 'button'
  ready.className = 'primary'
  ready.textContent = state.ready[seat] ? 'XI approved' : 'Approve XI & ready'
  ready.disabled = state.ready[seat]
  ready.addEventListener('click', () => network?.send({
    type: 'approve', version: state.settingsVersion, lineup: state.mode === 'duo' && seat === 1 ? [...state.lineups[0]] : getLineup(),
  }))
  const readiness = document.createElement('p')
  readiness.className = 'overlay-text'
  readiness.textContent = state.ready.map((value, index) => `Player ${index + 1} · ${value ? 'ready' : 'choosing'}`).join(' / ')
  const xi = document.createElement('p')
  xi.className = 'overlay-text'
  xi.textContent = (state.mode === 'duo' ? 'Team XI · ' : 'Your XI · ') +
    (state.mode === 'duo' && seat === 1 ? state.lineups[0] : state.ready[seat] ? state.lineups[seat] : getLineup()).join(', ')
  const choose = document.createElement('button')
  choose.type = 'button'
  choose.className = 'secondary'
  choose.textContent = 'Choose XI'
  choose.disabled = state.ready[seat] || (state.mode === 'duo' && seat === 1)
  choose.addEventListener('click', menus.openLineup)
  ui.overlayActions.prepend(form, xi, choose, readiness, ready)
}

function syncOnline(state: OnlineSnapshot, seat: OnlineSeat) {
  const previous = onlineState
  const changed = previous?.phase !== state.phase || previous?.innings !== state.innings ||
    previous?.last?.delivery !== state.last?.delivery || previous?.connected.join() !== state.connected.join() ||
    previous?.settingsVersion !== state.settingsVersion || previous?.ready.join() !== state.ready.join() ||
    previous?.match !== state.match || previous?.rematch.join() !== state.rematch.join() ||
    previous?.partnerCall?.call !== state.partnerCall?.call || previous?.battingSeat !== state.battingSeat ||
    previous?.active?.phase !== state.active?.phase ||
    previous?.duoSwap?.version !== state.duoSwap?.version ||
    previous?.duoSwap?.votes.join() !== state.duoSwap?.votes.join()
  onlineState = state
  onlineSeat = seat
  if (changed) refreshPending = true
  if (previous && previous.match !== state.match) {
    onlinePanel = undefined
    onlineBall = onlineResolvedBall = 0
    live = undefined
    record = undefined
  }
  if (previous?.settingsVersion !== state.settingsVersion || previous?.room !== state.room) stadium?.setConditions(state.settings)
  showWallet()
  if (state.mode !== 'quick' && (previous?.room !== state.room || previous?.phase !== state.phase)) {
    publishRoom(state.room, state.phase === 'lobby')
  }
  if (state.phase === 'lobby') {
    if (onlinePanel === 'lobby' && !changed) return
    onlinePanel = 'lobby'
    const privateRoom = state.mode !== 'quick'
    const duo = state.mode === 'duo'
    openOverlay(duo ? 'DUO BATTING · BAT TOGETHER VS AI' : privateRoom ? 'PRIVATE 1v1' : 'QUICK 1v1', duo ? 'Duo room' : privateRoom ? 'Private room' : 'Finding opponent',
      privateRoom ? `Room ${state.room} · ${state.overs} overs per side` : 'Waiting for another player · 5 overs per side',
      [{ label: 'Back to stadium', run: home, secondary: true }])
    if (privateRoom) {
      const url = document.createElement('input')
      url.className = 'invite-link'
      url.readOnly = true
      url.value = inviteLink(state.room)
      url.setAttribute('aria-label', 'Invite link')
      const copy = document.createElement('button')
      copy.type = 'button'
      copy.className = 'primary'
      copy.textContent = 'Copy invite link'
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(url.value)
          copy.textContent = 'Link copied'
        } catch { url.select() }
      })
      ui.overlayActions.prepend(url, copy)
      roomConfiguration(state, seat)
    }
    return
  }
  if (state.phase === 'toss') {
    if (onlinePanel === 'toss' && !changed) return
    onlinePanel = 'toss'
    const ready = state.connected.every(Boolean)
    const won = state.tossWinner === seat
    const actions: OverlayButton[] = [{ label: 'Back to stadium', run: home, secondary: true }]
    if (won && ready) actions.unshift(
      { label: 'Bat first', run: () => network?.send({ type: 'toss', choice: 'bat' }) },
      { label: 'Bowl first', run: () => network?.send({ type: 'toss', choice: 'bowl' }), secondary: true },
    )
    openOverlay('COIN TOSS', won ? 'You won the toss' : 'Opponent won the toss',
      !ready ? 'Waiting for your opponent to reconnect.' : won ? 'Choose which innings to play first.' : 'Waiting for their decision.',
      actions)
    return
  }
  if (state.phase === 'complete') {
    if (state.last && state.last.delivery > onlineResolvedBall) presentOnlineOutcome(state.last)
    showOnlineResult(state, seat)
    return
  }

  if (view !== 'online') {
    view = 'online'
    showWallet()
    activeShot = 'drive'
    battingMode = 'normal'
    fieldLayout = undefined
    activeDelivery = 'fast'
    activeField = 'balanced'
    ui.deliveryBank.value = '0'
    aim = 0
    ui.line.value = '0'
    ui.effort.value = '0.67'
    stadium?.setConditions(state.settings)
    setPhase('ready')
    mark('firstPlay')
  }
  if (onlinePanel && onlinePanel !== 'exit') {
    onlinePanel = undefined
    closeOverlay()
  }
  if (state.phase === 'windup') {
    if (onlineBall !== state.delivery || phase !== 'windup') {
      onlineBall = state.delivery
      onlineNotice = ''
      onlineSwingSent = false
      live = undefined
      record = undefined
      onlineReplay = undefined
      signal = undefined
      pointer = undefined
      ui.timingResult.textContent = 'WATCH THE BALL'
      delete ui.timing.dataset.result
      setPhase('windup')
    }
    onlineWindupEnd = performance.now() + (state.windupRemainingMs ?? ONLINE_WINDUP_MS)
  } else if (state.active) {
    const active = state.active
    const newBall = !live || !record || !onlineReplay || onlineBall !== state.delivery
    if (newBall) {
      onlineBall = state.delivery
      onlineNotice = ''
      onlineSwingSent = Boolean(active.shot)
      onlineContactPlayed = false
      ui.needle.style.setProperty('--timing', '0%')
      setPhase('flight')
      sound('release')
      mark('firstRelease')
    }
    const history = JSON.stringify(active.version === 2 ? active.commands : [active.shot, active.runs])
    if (newBall || history !== onlineHistory) {
      onlineHistory = history
      onlineReplay = new DeliveryReplay(active)
      live = onlineReplay.sim
      record = { options: active.options, shot: active.shot ?? undefined, runs: active.runs }
    }
    onlineSnapshotAt = performance.now()
    drawOnlineBall(active.tick)
  } else if (state.last && state.last.delivery > onlineResolvedBall) {
    presentOnlineOutcome(state.last)
  }
}

function presentOnlineOutcome(last: NonNullable<OnlineSnapshot['last']>) {
  onlineResolvedBall = last.delivery
  onlineNotice = ''
  onlineReplay = new DeliveryReplay(last.replay)
  live = onlineReplay.sim
  record = { options: last.replay.options, shot: last.replay.shot ?? undefined, runs: last.replay.runs }
  drawOnlineBall(720, false)
  if (!isBowling()) showTiming(false)
  signal = outcomeSignal(last.outcome)
  if (signal === 'out') sound('wicket')
  if (signal === 'four' || signal === 'six') sound('boundary')
  const call = describe(last.outcome)
  presentBroadcast(last.outcome)
  ui.callTitle.textContent = call.title
  ui.callDetail.textContent = call.detail
  setPhase('dead')
}

function showOnlineStatus(status: OnlineConnectionStatus) {
  if (onlinePanel === 'result') return
  if (onlinePanel === 'waiting' && status === 'reconnecting' && ui.overlayTitle.textContent === 'Reconnecting') return
  onlinePanel = 'waiting'
  const title = status === 'connecting' ? 'Connecting'
    : status === 'reconnecting' ? 'Reconnecting' : 'Online unavailable'
  const text = status === 'connecting' ? 'Connecting to the match server.'
    : status === 'reconnecting' ? 'Trying to recover your seat.'
      : status === 'closed' ? 'The match server could not recover this seat.' : 'The match server is unreachable.'
  openOverlay('MULTIPLAYER', title, text, [{ label: 'Back to stadium', run: home, secondary: true }])
}

function startOnline(handshake: OnlineHandshake) {
  if (network) network.stop(false)
  // Online decisions belong to the server, never to an abandoned local match.
  match = undefined
  clearReviewPresentation()
  enableAudio()
  ui.onlineMenu.close()
  onlineState = undefined
  onlineSeat = undefined
  onlinePanel = undefined
  onlineBall = onlineResolvedBall = 0
  onlineNotice = ''
  network = connectOnline(handshake, {
    snapshot: (state, seat) => {
      syncOnline(state, seat)
      // Apply the refresh straight away rather than on the next animation
      // frame, so the HUD never lags a snapshot by a frame.
      if (refreshPending) refresh()
    },
    status: showOnlineStatus,
    reject(code, connected) {
      if (connected) {
        if (code === 'swing-closed') onlineNotice = 'Swing arrived after contact'
        else if (code === 'waiting-for-peer') onlineNotice = 'Waiting for opponent to reconnect'
        else onlineNotice = 'Action no longer available'
        refreshPending = true
        return
      }
      openOverlay('MULTIPLAYER', 'Could not join room', code === 'room-full'
        ? 'This room is full or has already started.' : 'This room or reconnect seat is unavailable.',
      [{ label: 'Back to stadium', run: home, secondary: true }])
    },
  })
}

function settleBall(outcome: DeliveryOutcome) {
  if (!match || !record) return
  // A dismissal can be sent to the third umpire before the score is recorded.
  // The offer is brief and never blocks the game.
  if (!replaying && reviewable(outcome)) {
    const drs = match.drs
    drs.pendingOutcome = outcome
    drs.pendingRecord = record
    drs.reviewDeadline = performance.now() + 6000
    ui.reviewHint.hidden = false
    ui.reviewHint.textContent = `Send to the third umpire · ${drs.reviewsLeft} left  V`
    refreshPending = true
    return
  }
  applyOutcome(outcome)
}

/** Whether the decision on this delivery can be reviewed. */
function reviewable(outcome: DeliveryOutcome) {
  if (view === 'online' || isBowling() || paused) return false
  if (!match || match.drs.reviewsLeft <= 0) return false
  return outcome.wicket === 'lbw' || (outcome.wicket === 'caught' && outcome.contact === 'edge')
}

/** The offer has run out, so the decision stands and the score is recorded. */
function expireReview() {
  const drs = match?.drs
  if (!drs) return
  const outcome = drs.pendingOutcome
  const pendingRecord = drs.pendingRecord
  drs.pendingOutcome = undefined
  drs.pendingRecord = undefined
  drs.reviewDeadline = 0
  ui.reviewHint.hidden = true
  if (outcome && pendingRecord === record && view !== 'online') applyOutcome(outcome)
}

function resolveReview(review: boolean) {
  const drs = match?.drs
  if (!drs) return
  const outcome = drs.pendingOutcome
  const pendingRecord = drs.pendingRecord
  drs.pendingOutcome = undefined
  drs.pendingRecord = undefined
  drs.reviewDeadline = 0
  ui.reviewHint.hidden = true
  if (!outcome || !pendingRecord || pendingRecord !== record || view === 'online') return
  if (!review) {
    applyOutcome(outcome)
    return
  }
  // An umpire's call does not spend the review. The score is recorded when the
  // player closes the third umpire's report.
  if (!runThirdUmpire(outcome, drs, pendingRecord)) drs.reviewsLeft--
}

/** Show the third umpire's report. Returns whether the review is kept. */
function runThirdUmpire(outcome: DeliveryOutcome, drs: DrsState, reviewRecord: Replay): boolean {
  const tracking = live?.lbw?.tracking
  const rows: [string, string][] = []
  let reviewed: 'out' | 'not-out' = outcome.wicket ? 'out' : 'not-out'
  let umpiresCall = false
  if (outcome.wicket === 'lbw' && tracking) {
    rows.push(['Pitched', tracking.pitched], ['Impact', tracking.impact], ['Wickets', tracking.wickets])
    reviewed = tracking.out ? 'out' : 'not-out'
    umpiresCall = tracking.out !== Boolean(outcome.wicket) && (live?.lbw?.portion ?? 1) < 0.5
  } else {
    // A caught edge goes to the third umpire for the ultra edge.
    const spike = outcome.contact === 'edge'
    rows.push(['UltraEdge', spike ? 'spike shown, the bat is involved' : 'no spike, the bat did not touch the ball'])
    reviewed = spike ? 'out' : 'not-out'
  }
  const result = applyReview({
    original: outcome.wicket ? 'out' : 'not-out',
    reviewed,
    checked: outcome.wicket === 'lbw' ? 'lbw' : 'caught',
    umpiresCall,
  })
  const final = result.decision === 'out' ? outcome : { ...outcome, wicket: null, reason: 'fielded' as const }
  ui.drsBody.replaceChildren(...rows.map(([label, value]) => {
    const row = document.createElement('div')
    row.className = 'drs-row'
    const name = document.createElement('span')
    name.textContent = label
    const finding = document.createElement('b')
    finding.textContent = value
    row.append(name, finding)
    return row
  }))
  ui.drsTitle.textContent = result.changed
    ? 'The decision is overturned'
    : result.reviewRetained
      ? 'Umpire\u2019s call \u2014 the decision stands and you keep the review'
      : 'The decision stands'
  ui.drsDetail.textContent = result.changed
    ? (reviewed === 'out' ? 'The batter is given out.' : 'The batter is not out.')
    : result.reviewRetained
      ? 'The third umpire found the decision marginal, so the on-field call is correct and the review is not lost.'
      : 'The third umpire agrees with the on-field decision.'
  ui.drsActions.replaceChildren()
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'primary'
  close.textContent = 'Continue'
  let continued = false
  close.addEventListener('click', () => {
    // A detached/queued report action must not score into another match,
    // innings or delivery, or commit the same decision twice.
    if (continued || match?.drs !== drs || record !== reviewRecord || view === 'online') return
    continued = true
    ui.drsDialog.close()
    applyOutcome(final)
  })
  ui.drsActions.append(close)
  ui.drsDialog.showModal()
  return result.reviewRetained
}

function applyOutcome(outcome: DeliveryOutcome) {
  if (!match || !record) return
  // Replay shows the committed decision, including any third-umpire correction.
  // The reconstructed delivery is only the source of the on-field motion.
  if (replaying) outcome = currentInnings()?.history.at(-1) ?? outcome
  if (!replaying) {
    const state = currentInnings()
    if (!state) return
    const updated = applyDelivery(state, outcome)
    if (match.second) match.second = updated
    else match.first = updated
    const canonical = updated.history.at(-1)
    if (canonical) outcome = canonical
    const milestone = view === 'six' ? undefined : inningsMilestone(state, updated)
    ui.milestone.textContent = milestone ?? ''
    ui.milestone.hidden = !milestone
    record.signal = outcomeSignal(outcome)
    lastReplay = record
    if (view === 'six' && live) {
      six = scoreSix(six, updated.attempts, live)
      sixBest = { distance: Math.max(sixBest.distance, six.longest), points: Math.max(sixBest.points, six.points) }
      sixSaved = save(SIX_BEST_KEY, JSON.stringify(sixBest))
    }
    if (updated.complete) mark('inningsComplete')
  }
  signal = record.signal
  if (signal === 'out') sound('wicket')
  if (signal === 'four' || signal === 'six') sound('boundary')
  setPhase('dead')
  if (!replaying && !isBowling()) showTiming(false)
  const call = describe(outcome)
  presentBroadcast(outcome)
  const attempt = view === 'six' ? six.attempts.at(-1) : undefined
  ui.callTitle.textContent = attempt ? attempt.validSix ? `${attempt.distance.toFixed(1)} m` : 'No valid six' : call.title
  ui.callDetail.textContent = attempt
    ? attempt.validSix ? `First landing · +${attempt.points} points` : `${call.title} · Aim straight and loft in yellow`
    : call.detail
}

function presentBroadcast(outcome: DeliveryOutcome) {
  const event = broadcastEvent(outcome)
  ui.callout.dataset.event = event.kind
  ui.callKicker.textContent = replaying ? 'REPLAY' : event.kicker
}

function describe(outcome: DeliveryOutcome) {
  let title = 'Dot ball'
  let detail = outcome.contact === 'middle' ? 'Middle of the bat' : 'Through to the keeper'
  if (outcome.contact === 'edge') detail += ' · edge'
  if (outcome.padContact && !outcome.shotOffered) detail += ' · struck the pad'
  if (outcome.wicket === 'run-out') detail = `${outcome.dismissedBatter === 'nonStriker' ? 'Non-striker' : 'Batter'} short of the crease${outcome.completedRuns ? ` · ${outcome.completedRuns} completed` : ''}`
  if (outcome.wicket) title = { ...DISMISSAL_LABELS, 'run-out': 'Run out!' }[outcome.wicket]
  else if (outcome.noBall) {
    title = 'No ball'
    detail = `Free hit next${outcome.batRuns ? ` · ${outcome.batRuns} off the bat` : ''}`
  } else if (outcome.wide) {
    title = 'Wide'
    detail = 'One extra · Bowl again'
  } else if (outcome.reason === 'boundary') {
    title = outcome.batRuns === 6 ? 'Six!' : 'Four!'
  } else if (outcome.byes) {
    title = `${outcome.byes} ${outcome.byes === 1 ? 'bye' : 'byes'}`
    detail = 'Missed the bat · extras'
  } else if (outcome.legByes) {
    title = `${outcome.legByes} ${outcome.legByes === 1 ? 'leg bye' : 'leg byes'}`
    detail = 'Off the pad'
  } else if (outcome.batRuns) {
    const runs = outcome.batRuns
    title = `${runs} ${runs === 1 ? 'run' : 'runs'}`
  }
  if (outcome.overthrowRuns) {
    const award = `${outcome.overthrowRuns} overthrow ${outcome.overthrowRuns === 1 ? 'run' : 'runs'}`
    if (title === 'Dot ball') title = award
    else detail += ` · +${award}`
  }
  return { title, detail }
}

function replayBall() {
  if (!lastReplay || paused || phase !== 'dead' || replaying) return
  record = lastReplay
  live = undefined
  signal = undefined
  replaying = true
  setPhase('windup')
  ui.status.textContent = 'Replaying the last delivery.'
}

function afterBall() {
  if (view === 'online') {
    if (onlineState?.mode === 'duo') {
      if (onlineState.phase === 'ready') network?.send({ type: 'next', match: onlineState.match, delivery: onlineState.delivery })
      return
    }
    if (onlineState?.phase !== 'ready' || !isBowling() || !onlineState.connected.every(Boolean)) return
    network?.send({
      type: 'bowl', delivery: onlineState.delivery, kind: activeDelivery,
      line: Number(ui.line.value), effort: Number(ui.effort.value), field: activeField,
    })
    return
  }
  if (view === 'six' && phase === 'dead' && !replaying && six.complete) return finishSix()
  if (phase === 'ready') return beginBall()
  if (phase !== 'dead') return
  if (replaying) {
    replaying = false
    const committed = currentInnings()?.history.at(-1)
    if (committed) presentBroadcast(committed)
    refreshPending = true
    return
  }
  const innings = currentInnings()
  if (!match || !innings) return
  if (!innings.complete) return beginBall()
  if (view === 'solo' && !match.second) {
    const target = innings.runs + 1
    const chasing = !match.playerBatsFirst
    const needed = `${target} from ${innings.overs * 6} legal balls`
    const text = chasing ? `The Ridgebacks made ${innings.runs}/${innings.wickets}. You need ${needed}.`
      : `You made ${innings.runs}/${innings.wickets}. The Ridgebacks need ${needed}. Choose a delivery, set your line and pace, then bowl.`
    openOverlay('INNINGS BREAK', chasing ? 'Time to chase' : 'Time to defend', text, [
      { label: chasing ? 'Start the chase' : 'Take the field', run: () => {
        if (!match) return
        match.second = newInnings(innings.overs, target, match.playerBatsFirst ? OPPONENT_NAMES : match.lineup)
        match.drs = newDrsState()
        clearReviewPresentation()
        live = undefined
        record = undefined
        lastReplay = undefined
        signal = undefined
        closeOverlay()
        setPhase('ready')
        if (!isBowling()) beginBall()
        ui.next.focus()
      } },
      { label: 'Return to stadium', run: home, secondary: true },
    ])
    return
  }
  finishMatch()
}

function showScoreCards(homeScore: Pick<Innings, 'runs' | 'wickets' | 'legalBalls'>, awayScore: Pick<Innings, 'runs' | 'wickets' | 'legalBalls'>) {
  const rows = [
    ['Suncrest', homeScore],
    ['Ridgebacks', awayScore],
  ] as const
  ui.overlayScores.replaceChildren(...rows.map(([team, innings]) => {
    const row = document.createElement('div')
    const score = document.createElement('b')
    const label = document.createElement('span')
    score.textContent = `${innings.runs}/${innings.wickets} · ${formatOvers(innings.legalBalls)} ov`
    label.textContent = team
    row.append(score, label)
    return row
  }))
  ui.overlayScores.hidden = false
}

function renderScorecard() {
  const innings = currentInnings()
  if (!innings) return
  const entries: { label: string; innings: Innings }[] = []
  const team = (opponent: boolean) => opponent ? 'RIDGEBACKS' : 'SUNCREST'
  if (view === 'online' && onlineState) {
    if (onlineState.firstInnings && onlineState.innings === 2) {
      const { recent, target, ...score } = onlineState.firstInnings.score
      entries.push({ label: team(onlineState.firstInnings.battingSeat === 1), innings: { ...score, history: recent, target: target ?? undefined } })
    }
    entries.push({ label: onlineState.mode === 'duo' ? 'DUO XI' : team(onlineState.battingSeat === 1), innings })
  } else if (match) {
    entries.push({ label: team(!match.playerBatsFirst), innings: match.first })
    if (match.second) entries.push({ label: team(match.playerBatsFirst), innings: match.second })
  }
  renderMatchScorecard(ui.scorecardBody, entries)
  ui.scorecardTitle.textContent = 'Match scorecard'
  ui.scorecardDialog.showModal()
}

function finishSix() {
  openOverlay('LONGEST SIX · POWER HIT', 'Challenge complete',
    `${six.points} points · Longest ${six.longest.toFixed(1)} m. Personal best ${sixBest.distance.toFixed(1)} m / ${sixBest.points} points.${sixSaved ? '' : ' Records available for this session.'}`, [
      { label: 'Try again', run: () => start('six') },
      { label: 'Return to stadium', run: home, secondary: true },
    ])
}

function finishMatch() {
  if (!match) return
  if (!match.second) {
    const score = match.first
    openOverlay('TRAINING NETS', 'Drill complete', `You scored ${score.runs}/${score.wickets} in ${formatOvers(score.legalBalls)} overs. Try another drill or face the Ridgebacks in Solo Arcade.`, [
      { label: 'Play Solo Arcade', run: () => start('solo') },
      { label: 'Practice again', run: () => start('training'), secondary: true },
      { label: 'Return to stadium', run: home, secondary: true },
    ])
    return
  }
  const { first, second, playerBatsFirst, settings } = match
  const [homeScore, awayScore] = playerBatsFirst ? [first, second] : [second, first]
  const won = homeScore.runs > awayScore.runs
  const tied = homeScore.runs === awayScore.runs
  if (!match.reward) {
    match.reward = { coins: won ? 30 : 15, xp: 40 + Math.min(homeScore.runs, 40) }
    const previous = loadCareer()
    career = { coins: previous.coins + match.reward.coins, xp: previous.xp + match.reward.xp }
    match.saved = save(CAREER_KEY, JSON.stringify(career))
    // The career record keeps the numbers a player wants to see.
    const batting = second.batting.length ? second.batting : first.batting
    const playerRuns = batting.reduce((total, batter) => total + batter.runs, 0)
    const playerWickets = second.bowling.reduce((total, bowler) => total + bowler.wickets, 0)
    const fours = batting.reduce((total, batter) => total + batter.fours, 0)
    const sixes = batting.reduce((total, batter) => total + batter.sixes, 0)
    careerRecord = {
      ...careerRecord,
      matches: careerRecord.matches + 1,
      wins: careerRecord.wins + (won ? 1 : 0),
      runs: careerRecord.runs + playerRuns,
      wickets: careerRecord.wickets + playerWickets,
      bestScore: Math.max(careerRecord.bestScore, playerRuns),
      bestRuns: Math.max(careerRecord.bestRuns, homeScore.runs),
      fours: careerRecord.fours + fours,
      sixes: careerRecord.sixes + sixes,
      coins: career.coins,
      xp: career.xp,
    }
    saveCareer(careerRecord)
    showCareerSummary()
    showWallet()
    mark('matchComplete')
  }
  const winningName = won ? 'Suncrest' : 'Ridgebacks'
  const margin = tied ? 'Both teams finished level.' : second.runs > first.runs
    ? `${winningName} won by ${10 - second.wickets} wickets.`
    : `${winningName} won by ${first.runs - second.runs} runs.`
  openOverlay('MATCH RESULT', won ? 'Suncrest wins' : tied ? 'Match tied' : 'Ridgebacks win',
    `${margin} +${match.reward.coins} coins · +${match.reward.xp} XP${match.saved ? '' : ' · Saved for this session'}`, [
      { label: 'Play again', run: () => start('solo', settings) },
      { label: 'Return to stadium', run: home, secondary: true },
    ])
  showScoreCards(homeScore, awayScore)
}

function openOverlay(kicker: string, title: string, text: string, buttons: OverlayButton[], dismissible = false) {
  setGameplay(false)
  paused = true
  if (audio) crowdGain?.gain.setTargetAtTime(0, audio.currentTime, .1)
  pointer = undefined
  ui.swipeTrail.classList.remove('drawing')
  ui.overlayKicker.textContent = kicker
  ui.overlay.dataset.presentation = kicker.includes('RESULT') || kicker.includes('POWER HIT') || title === 'Drill complete'
    ? 'result' : kicker.includes('INNINGS') ? 'innings' : title === 'Paused' ? 'pause' : 'default'
  ui.overlayTitle.textContent = title
  ui.overlayText.textContent = text
  ui.overlayScores.hidden = true
  ui.pauseTools.hidden = true
  ui.overlay.dataset.dismissible = String(dismissible)
  ui.overlayActions.replaceChildren(...buttons.map(({ label, run, secondary }) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = secondary ? 'secondary' : 'primary'
    button.textContent = label
    button.addEventListener('click', run)
    return button
  }))
  if (!ui.overlay.open) ui.overlay.showModal()
}

function closeOverlay() {
  paused = false
  refreshPending = true
  if (onlinePanel === 'exit') onlinePanel = undefined
  if (audio && !muted && !platformMuted) crowdGain?.gain.setTargetAtTime(.16, audio.currentTime, .2)
  ui.overlay.close()
  if (view !== 'home') setGameplay(true)
}

function pause() {
  if (view === 'home' || ui.overlay.open || ui.fieldDialog.open || ui.settingsDialog.open || ui.scorecardDialog.open) return
  if (view === 'online') onlinePanel = 'exit'
  openOverlay(view === 'online' ? 'ONLINE MATCH' : VENUE_NAMES[match?.settings.venue ?? 'suncrest'].toUpperCase(),
    'Paused', view === 'online' ? 'The online match clock continues while this menu is open.'
      : 'Swipe in any direction. Choose Loft for attacking shots or Defense for a softer touch.', [
      { label: 'Resume', run: () => { onlinePanel = undefined; closeOverlay() } },
      ...(phase === 'dead' || phase === 'ready' ? [{ label: ui.next.textContent ?? 'Next ball', run: () => { closeOverlay(); afterBall() }, secondary: true }] : []),
      { label: view === 'online' ? 'Leave match' : 'Return to stadium', run: home, secondary: true },
    ], true)
  ui.pauseTools.hidden = false
  refreshPending = true
}

function renderScore(innings: Innings) {
  if (view === 'six') {
    ui.batterStrip.textContent = 'POWER HIT • FIVE BALL CHALLENGE'
    ui.scoreContext.textContent = 'Five attempts · clean aerial boundaries score'
    ui.lastBall.textContent = ''
    ui.broadcastMatch.textContent = 'LONGEST SIX'
    ui.scoreRate.textContent = `${six.attempts.length} / ${SIX_ATTEMPTS} BALLS`
    ui.teamCode.textContent = 'PTS'
    ui.score.textContent = String(six.points)
    ui.overs.textContent = String(six.attempts.length)
    ui.oversLimit.textContent = ` / ${SIX_ATTEMPTS} BALLS`
    ui.chase.hidden = ui.freeHit.hidden = true
    ui.stats.textContent = `LONGEST ${six.longest.toFixed(1)} m · BEST ${sixBest.distance.toFixed(1)} m · STREAK ${six.streak}`
    ui.ribbon.replaceChildren(...six.attempts.map((attempt) => {
      const token = document.createElement('span')
      token.textContent = attempt.validSix ? '6' : '•'
      token.className = attempt.validSix ? 'major' : ''
      token.title = `${attempt.points} points`
      return token
    }))
    return
  }
  const bowling = isBowling()
  const online = view === 'online' ? onlineState : undefined
  ui.teamCode.textContent = online?.mode === 'duo' ? 'DUO' : (online ? online.battingSeat === 1 : bowling) ? 'RDG' : 'SUN'
  ui.score.textContent = `${innings.runs}/${innings.wickets}`
  ui.overs.textContent = formatOvers(innings.legalBalls)
  ui.oversLimit.textContent = ` / ${innings.overs} OV`
  ui.chase.hidden = innings.target === undefined
  if (innings.target !== undefined) {
    ui.chase.textContent = `NEED ${Math.max(0, innings.target - innings.runs)} / ${innings.overs * 6 - innings.legalBalls} BALLS`
  }
  ui.freeHit.hidden = !innings.freeHit
  const names = bowling ? OPPONENT_NAMES : match?.lineup ?? []
  const bowlers = bowling ? match?.lineup.filter(isBowler).slice(0, 5) ?? [] : OPPONENT_BOWLERS
  const lastOutcome = innings.history.at(-1)
  const justFinishedOver = phase === 'dead' && lastOutcome && !lastOutcome.wide && !lastOutcome.noBall &&
    innings.legalBalls % 6 === 0
  const overStart = Math.floor((innings.legalBalls - Number(Boolean(justFinishedOver))) / 6) * 6
  const lastBall = Math.min(innings.overs - 1, overStart / 6)
  const lineup = online ? online.lineups[online.mode === 'duo' ? 0 : online.battingSeat ?? 0] : names
  ui.batterStrip.replaceChildren(...[innings.striker, innings.nonStriker].map((number, index) => {
    const batter = innings.batting[number - 1]
    const row = document.createElement('span')
    row.className = index === 0 ? 'on-strike' : ''
    const name = document.createElement('b')
    name.textContent = `${lineup[number - 1] ?? batter?.name ?? 'Batter'}${index === 0 ? ' *' : ''}`
    const score = document.createElement('strong')
    score.textContent = `${batter?.runs ?? 0} (${batter?.balls ?? 0})`
    row.append(name, score)
    return row
  }))
  const bowlerName = online?.bowler ?? bowlers[lastBall % bowlers.length] ?? 'Bowler'
  const bowler = innings.bowling.find(item => item.name === bowlerName)
  ui.stats.textContent = `${bowlerName}  ${bowler?.wickets ?? 0}-${bowler?.runs ?? 0}  (${formatOvers(bowler?.balls ?? 0)})`
  ui.broadcastMatch.textContent = `${ui.teamCode.textContent === 'RDG' ? 'RIDGEBACKS v SUNCREST' : 'SUNCREST v RIDGEBACKS'} • ${view === 'training' ? 'NETS' : online?.maxOutside === 2 || outsideLimit(innings.overs, innings.legalBalls) === 2 ? 'POWERPLAY' : `${innings.overs}-OVER MATCH`}`
  const rates = runRates(innings)
  ui.scoreRate.textContent = `CRR ${rates.current.toFixed(2)}${rates.required === null ? '' : ` • RRR ${rates.required.toFixed(2)}`}`
  const pair = innings.partnerships.at(-1)
  const currentPair = pair && [pair.batter,pair.partner].includes(innings.striker) && [pair.batter,pair.partner].includes(innings.nonStriker) ? pair : undefined
  ui.scoreContext.textContent = innings.target !== undefined
    ? `TARGET ${innings.target}  ·  ${innings.runs >= innings.target ? 'CHASE COMPLETE' : `${Math.max(0,innings.target-innings.runs)} needed from ${Math.max(0,innings.overs*6-innings.legalBalls)} balls`}`
    : `PARTNERSHIP ${currentPair?.runs ?? 0} (${currentPair?.balls ?? 0})  ·  ${Math.max(0,innings.overs*6-innings.legalBalls)} BALLS LEFT`
  ui.lastBall.textContent = lastOutcome ? `${describe(lastOutcome).title.toUpperCase()}${lastOutcome.batRuns===6 && live?.landingDistance ? ` · ${Math.round(live.landingDistance)}m carry` : ''}` : 'FIRST OVER'
  ui.lastBall.dataset.event = lastOutcome?.wicket ? 'wicket' : lastOutcome?.reason === 'boundary' ? 'boundary' : ''
  const summaries=overSummary(innings)
  const latest=summaries.at(-1)
  const show=latest && (justFinishedOver || latest.number===Math.floor(innings.legalBalls/6)+1) ? latest : undefined
  const balls=show?.balls ?? []
  ui.ribbon.setAttribute('aria-label', `Over ${show?.number ?? Math.floor(innings.legalBalls/6)+1}: ${show?.runs ?? 0} runs`)
  const tokens=balls.slice(-9).map(outcome=>{
    const token=document.createElement('span')
    token.textContent=deliveryToken(outcome);token.title=describe(outcome).title
    token.className=outcome.wicket?'wicket':outcome.reason==='boundary'?'major':''
    if (outcome.overthrowRuns) token.classList.add('overthrow')
    return token
  })
  for(let i=show?.legal ?? 0;i<6;i++) {
    const token=document.createElement('span');token.className='pending-ball';token.textContent='·';token.setAttribute('aria-label','Ball to come');tokens.push(token)
  }
  ui.ribbon.replaceChildren(...tokens)

}

function refresh() {
  refreshPending = false
  const inGame = view !== 'home'
  const bowling = isBowling()
  const online = view === 'online'
  const duo = online && onlineState?.mode === 'duo'
  const soloRunning = !bowling && (view === 'solo' || view === 'training' || online && !duo)
  const innings = currentInnings()
  ui.game.dataset.view = view
  ui.game.dataset.phase = phase
  ui.game.dataset.batting = String(!bowling && inGame)
  ui.home.hidden = ui.venue.hidden = inGame
  ui.fieldMapButton.hidden = ui.pause.hidden = ui.scoreboard.hidden = ui.matchId.hidden = ui.playfield.hidden = ui.dock.hidden = !inGame
  ui.batControls.hidden = !inGame || bowling
  ui.bowlControls.hidden = !inGame || !bowling || duo || phase === 'field'
  ui.fieldingControls.hidden = !inGame || view !== 'solo' || !bowling || !live?.manualFielding || phase !== 'field'
  if (!ui.fieldingControls.hidden) ui.fieldMapButton.hidden = true
  ui.duoControls.hidden = !duo && !soloRunning
  ui.loft.setAttribute('aria-pressed', String(battingMode === 'loft'))
  ui.defense.setAttribute('aria-pressed', String(battingMode === 'defense'))
  ui.battingMode.textContent = `${battingMode.toUpperCase()} • 360° SWIPE`
  ui.autoNext.hidden = online || bowling
  ui.autoNext.setAttribute('aria-pressed', String(autoNext))
  ui.swipeCue.hidden = !inGame || bowling || replaying || (phase !== 'windup' && phase !== 'flight')
  ui.duoRole.textContent = bowling ? 'Non-striker · call to partner' : live?.outcome?.wicket === 'run-out' ? 'RUN OUT • short of the crease' : 'TAP RUN • R to run, C to turn back'
  if (!live || phase === 'windup') {
    ui.duoControls.dataset.threat = 'false'
    ui.duoControls.style.setProperty('--striker-run', '0%')
    ui.duoControls.style.setProperty('--partner-run', '0%')
  }
  const manual = live?.manualRunning
  ui.duoRun.textContent = bowling ? 'Run!' : manual || soloRunning ? 'Run / +1' : 'Run / resume'
  ui.duoWait.hidden = !bowling
  ui.duoNo.textContent = bowling ? 'No!' : manual || soloRunning ? 'Turn back' : 'Stop'
  ui.duoRun.title = bowling ? 'R · Call Run to your partner' : 'R · Start a run or queue another run'
  ui.duoNo.title = bowling ? 'C · Call No to your partner' : 'C · Turn back and cancel queued runs'
  ui.duoWait.title = 'W · Call Wait to your partner'
  const swap = duo ? onlineState?.duoSwap : undefined
  const ownVote = onlineSeat !== undefined && swap?.votes[onlineSeat]
  const partnerVote = onlineSeat !== undefined && swap?.votes[onlineSeat === 0 ? 1 : 0]
  ui.duoSwap.hidden = !duo || onlineState?.phase !== 'ready'
  ui.duoSwap.disabled = !onlineState?.connected.every(Boolean) || !swap
  ui.duoSwap.textContent = ownVote ? 'Cancel swap request' : partnerVote ? 'Accept control swap' : 'Swap control'
  const canRun = !paused && !replaying && Boolean(live && !live.outcome) && (duo ? onlineState?.phase === 'flight' && (bowling || onlineState?.active?.phase === 'field')
    : soloRunning && (phase === 'field' || phase === 'flight'))
  ui.duoRun.disabled = ui.duoNo.disabled = ui.duoWait.disabled = !canRun
  ui.pauseLabel.textContent = 'Pause'
  ui.matchId.querySelector('b')!.textContent = online ? (duo ? 'DUO BATTING' : onlineState?.mode === 'quick' ? 'QUICK 1v1' : 'PRIVATE 1v1')
    : view === 'six' ? 'LONGEST SIX' : view === 'training' ? 'TRAINING NETS' : 'SOLO ARCADE'
  ui.matchId.querySelector('span')!.textContent = VENUE_NAMES[(online ? onlineState?.settings.venue : match?.settings.venue) ?? 'suncrest'].toUpperCase()
  ui.countdown.hidden = phase !== 'windup'
  ui.callout.hidden = phase !== 'dead'
  ui.timing.hidden = !inGame || bowling || replaying || !settings.showNeedle
  ui.replay.hidden = online || phase !== 'dead' || !lastReplay || replaying
  ui.next.hidden = online ? !((duo || bowling) && onlineState?.phase === 'ready' && onlineState.connected.every(Boolean))
    : phase !== 'ready' && phase !== 'dead'
  ui.next.textContent = online ? (duo ? 'Next ball →' : 'Bowl →') : replaying ? 'Exit replay →' : view === 'six' && six.complete ? 'See result →' : innings?.complete
    ? (view === 'solo' && !match?.second ? 'Innings break →' : 'See result →')
    : bowling ? 'Bowl →' : 'Next ball →'
  ui.next.setAttribute('aria-label', ui.next.textContent.replace(' →', ''))
  const partnerCall = duo && onlineState?.partnerCall
    ? `Player ${onlineState.partnerCall.seat + 1} · ${onlineState.partnerCall.call.toUpperCase()}!` : ''
  const swapHint = duo && onlineState?.phase === 'ready'
    ? ownVote ? 'Waiting for partner to approve the control swap'
      : partnerVote ? 'Partner requested a control swap' : '' : ''
  const onlineHint = online ? partnerCall || swapHint || onlineNotice || (!onlineState?.connected.every(Boolean) ? 'Waiting for opponent to reconnect'
    : phase === 'ready' && !bowling && !duo ? 'Waiting for the bowler' : '') : ''
  ui.targetLabel.hidden = !replaying && !onlineHint
  ui.targetLabel.textContent = replaying ? 'DELIVERY REPLAY' : onlineHint
  const locked = phase !== 'ready' && phase !== 'dead'
  ui.field.disabled = !canEditField()
  const bowlStart = Number(ui.deliveryBank.value) * 4
  DELIVERIES.forEach((kind, index) => {
    const button = bowlButtons.get(kind)!
    button.hidden = index < bowlStart || index >= bowlStart + 4
    button.setAttribute('aria-pressed', String(kind === activeDelivery))
    button.disabled = locked || replaying
  })
  ui.line.disabled = ui.effort.disabled = ui.deliveryBank.disabled = locked || replaying
  const line = Number(ui.line.value)
  ui.lineLabel.textContent = Math.abs(line) < 0.14 ? 'Middle' : line < 0 ? 'Leg' : 'Off'
  ui.effortLabel.textContent = `${Math.round(Number(ui.effort.value) * 100)}%`
  if (innings) renderScore(innings)
}

const renderFrame: StadiumFrame = { mode: 'home', phase: 'ready' }
const renderAim = { x: 0, z: 0 }
const renderPractice: NonNullable<StadiumFrame['practiceSwing']> = { age: 0, shot: 'drive' }

function frame(now: number) {
  const simulationStart = performance.now()
  const delta = previousFrame > 0 ? (now - previousFrame) / 1000 : 0
  previousFrame = now
  // The clubhouse uses a static illustration; do not run the stadium demo behind it.
  if (view === 'home') {
    if (refreshPending) refresh()
    requestAnimationFrame(frame)
    return
  }
  const dt = Math.min(delta, DRAWN_FRAME_LIMIT)
  if (!paused) {
    if (delta > 0) sample('frameMs', delta * 1000)
    elapsed += dt
    if (view === 'online') {
      if (phase === 'windup') {
        const kind = onlineState?.bowlingKind ?? 'fast'
        ui.countdown.textContent = `${Math.max(1, Math.ceil((onlineWindupEnd - now) / 1000))} · ${DELIVERY_LABELS[kind].toUpperCase()}`
      } else if (onlineState?.active && live) {
        const extra = Math.min(3, Math.max(0, Math.floor((now - onlineSnapshotAt) / (DT * 1000))))
        drawOnlineBall(onlineState.active.tick + extra)
      }
      if (live && phase === 'flight' && live.contactEventTick === null && !ui.timing.hidden) {
        const percent = Math.max(0, Math.min(100, 50 + (live.tick - live.contactTick) * 2.6))
        ui.needle.style.setProperty('--timing', `${percent}%`)
      }
    } else if (phase === 'windup') {
      const duration = replaying ? 0.65 : WINDUP_SECONDS
      const label = replaying ? 'REPLAY' : `${Math.max(1, Math.ceil(duration - elapsed))} · ${DELIVERY_LABELS[record?.options.kind ?? 'fast'].toUpperCase()}`
      if (ui.countdown.textContent !== label) ui.countdown.textContent = label
      if (elapsed >= duration) {
        accumulator = 0
        release()
      }
    } else if (phase === 'flight' || phase === 'field') {
      const readSpeed = replaying || phase !== 'flight' || isBowling() ? 1
        : view === 'training' ? .68 : match?.settings.difficulty === 'Rookie' ? .75 : match?.settings.difficulty === 'Club' ? .88 : 1
      accumulator += dt * readSpeed
      while (accumulator >= DT && !live?.outcome) {
        advanceDelivery()
        accumulator -= DT
      }
      if (live && phase === 'flight' && live.contactEventTick === null && !ui.timing.hidden) {
        const percent = Math.max(0, Math.min(100, 50 + (live.tick - live.contactTick) * 2.6))
        ui.needle.style.setProperty('--timing', `${percent}%`)
      }
    }
  }
  const presentationStart = performance.now()
  if (!paused) sample('simulationMs', presentationStart - simulationStart)
  if (match?.drs.pendingOutcome && now > match.drs.reviewDeadline) expireReview()
  if (view !== 'online' && !paused && !replaying && !isBowling() && phase === 'dead' && !match?.drs.pendingOutcome && !currentInnings()?.complete && autoNext) {
    if (elapsed >= 4.5 && !stadium?.boundaryPlaying()) beginBall()
    else ui.next.textContent = stadium?.boundaryPlaying() ? 'Watching the boundary…' : `Next ball · ${Math.max(1, Math.ceil(4.5 - elapsed))}`
  }
  if (now > feedbackUntil) ui.shotFeedback.hidden = true
  if (!ui.swipeCue.hidden) {
    const ready = live && phase === 'flight' && live.tick >= live.contactTick - 10 && live.tick <= live.contactTick + 3
    ui.swipeCue.classList.toggle('now', Boolean(ready))
    ui.swipeCue.querySelector('b')!.textContent = ready ? 'SWIPE NOW!' : phase === 'windup' ? 'GET READY TO BAT' : 'WATCH THE BALL'
  }
  if (refreshPending) refresh()
  if (!isBowling() && live?.manualRunning && live.phase === 'field') {
    const threat = live.action === 'return' || live.action === 'break'
    ui.duoControls.dataset.threat = String(threat && live.runnersMoving)
    ui.duoControls.style.setProperty('--striker-run', `${live.runnerProgress * 100}%`)
    ui.duoControls.style.setProperty('--partner-run', `${live.partnerProgress * 100}%`)
    const grounded = Number(live.runnerProgress <= 1e-9) + Number(live.partnerProgress <= 1e-9)
    const status = live.runnersReturning ? grounded === 1 ? 'ONE HOME • partner returning' : 'TURN BACK • get home' : live.pendingRuns
      ? `${threat ? 'THROW COMING' : 'RUNNING'} · ${live.pendingRuns} called` : 'TAP RUN • steal a single'
    if (ui.duoRole.textContent !== status) ui.duoRole.textContent = status
  }
  const mode = isBowling() ? 'bowl' : 'bat'
  renderFieldMaps()
  renderManualFielding()
  const angle = SHOT_ANGLES[activeShot] + aim
  const bowlingKind = phase === 'ready' || phase === 'dead' ? activeDelivery
    : (view === 'online' ? onlineState?.bowlingKind : record?.options.kind) ?? activeDelivery
  if (!paused) {
    renderFrame.reducedMotion = settings.reducedMotion
    renderFrame.cooperative = view === 'online' && onlineState?.mode === 'duo'
    renderFrame.mode = mode
    renderFrame.phase = phase
    renderFrame.delivery = live
    renderFrame.windup = Math.min(1, elapsed / (replaying ? .65 : WINDUP_SECONDS))
    renderAim.x = Number(ui.line.value)
    renderAim.z = bounceLength(bowlingKind)
    renderFrame.aim = mode === 'bowl' && !(view === 'online' && onlineState?.mode === 'duo') ? renderAim : undefined
    renderFrame.bowlingKind = bowlingKind
    const innings = currentInnings()
    renderFrame.maxOutside = view === 'online' ? onlineState?.maxOutside
      : view === 'solo' && innings ? outsideLimit(innings.overs, innings.legalBalls) : undefined
    renderFrame.fieldPreset = mode === 'bowl' ? (phase === 'ready' || phase === 'dead' ? activeField : record?.options.field ?? activeField) : 'balanced'
    renderFrame.fieldLayout = mode === 'bowl' ? fieldLayout : undefined
    renderFrame.shotAngle = record?.shot?.input.aim ?? angle
    renderFrame.shot = record?.shot?.input.kind ?? activeShot
    renderFrame.signal = signal
    renderFrame.replay = replaying
    renderPractice.age = gestureSwing ? (now - gestureSwing.at) / 1000 : 2
    renderPractice.shot = gestureSwing?.shot ?? activeShot
    renderFrame.practiceSwing = renderPractice.age < 1.1 ? renderPractice : undefined
    const renderStart = performance.now()
    sample('presentationMs', renderStart - presentationStart)
    stadium?.render(renderFrame, dt)
    sample('renderMs', performance.now() - renderStart)
  }
  if (inputTimestamp !== undefined) {
    sample('inputToFrameMs', performance.now() - inputTimestamp)
    inputTimestamp = undefined
  }
  requestAnimationFrame(frame)
}

const fieldMap = createFieldMap('field-map')
const fieldEditor = createFieldMap('field-editor', true)
const liveFieldControl = createFieldMap('live-field-control', true)

function manualFieldingInput(command: FieldingCommand) {
  if (paused || replaying || view !== 'solo' || !isBowling() || !record || !live?.fieldControl(command)) return false
  record.fielding = [...record.fielding ?? [], { tick: live.tick, command }]
  return true
}
function renderManualFielding() {
  if (ui.fieldingControls.hidden || !live) return
  liveFieldControl.render(live.fielders, live.keeper, live.ball, fieldBoundary(), live.activeFielder)
  ui.fieldingControls.dataset.action = live.action
  const canControl = !paused && !replaying
  ui.fieldingChase.disabled = !canControl || live.action !== 'chase'
  ui.throwKeeper.disabled = ui.throwBowler.disabled = !canControl || (live.action !== 'pickup' && live.action !== 'hold')
  const name = live.activeFielder === live.fielders.length ? 'Keeper' : `Fielder ${live.activeFielder + 1}`
  ui.fieldingStatus.textContent = replaying ? 'REPLAY' : live.action === 'hold' ? `${name} • choose an end to throw`
    : live.action === 'pickup' ? `${name} • collecting`
    : live.action === 'return' || live.action === 'break' ? `Throw → ${live.throwTarget === 'bowler' ? 'bowler' : 'keeper'} end`
    : `${name} • move to intercept`
}
liveFieldControl.svg.addEventListener('click', event => {
  const target = event.target instanceof Element ? event.target.closest('[data-fielder]') : null
  if (event.target instanceof Element && event.target.hasAttribute('data-keeper')) manualFieldingInput({ type: 'select', index: live?.fielders.length ?? 9 })
  else if (target) manualFieldingInput({ type: 'select', index: Number(target.getAttribute('data-fielder')) })
  else {
    const destination = liveFieldControl.destination(event, fieldBoundary())
    manualFieldingInput({ type: 'move', x: destination.x, z: destination.z })
  }
})
ui.fieldingChase.addEventListener('click', () => manualFieldingInput({ type: 'chase' }))
ui.throwKeeper.addEventListener('click', () => manualFieldingInput({ type: 'throw', end: 'striker' }))
ui.throwBowler.addEventListener('click', () => manualFieldingInput({ type: 'throw', end: 'bowler' }))

function canEditField() {
  return isBowling() && !replaying && (phase === 'ready' || phase === 'dead') && onlineState?.mode !== 'duo'
}
function fieldBoundary() {
  return VENUE_BOUNDARIES[(view === 'online' ? onlineState?.settings.venue : match?.settings.venue) ?? 'suncrest']
}
function fieldLimit() {
  const innings = currentInnings()
  return view === 'online' ? onlineState?.maxOutside : innings && view !== 'training' ? outsideLimit(innings.overs, innings.legalBalls) : undefined
}
function plannedField() { return fieldPositions(activeField, fieldLimit(), fieldLayout) }
function renderFieldMaps() {
  if (view === 'home') return
  const planning = canEditField()
  const positions = planning ? plannedField() : live?.fielders ?? fieldPositions(isBowling() ? activeField : 'balanced', fieldLimit(), isBowling() ? fieldLayout : undefined)
  const keeper = live?.keeper ?? KEEPER
  fieldMap.render(positions, keeper, live?.ball, fieldBoundary(), live?.activeFielder)
  if (ui.fieldDialog.open) fieldEditor.render(positions, keeper, live?.ball, fieldBoundary(), planning ? selectedFielder : live?.activeFielder)
}
ui.fieldMapButton.addEventListener('click', () => {
  pointer = undefined
  ui.swipeTrail.classList.remove('drawing')
  paused = true
  setGameplay(false)
  ui.field.disabled = !canEditField()
  ui.fielderSelect.disabled = !canEditField() || view === 'online'
  ui.fieldHelp.textContent = canEditField() ? view === 'online'
    ? 'Choose a field preset for your next delivery. The server controls online field placement.'
    : 'Tap a numbered fielder, then tap a new position. Changes apply to the next delivery.'
    : 'Live field positions. Change your field between deliveries when your team is bowling.'
  ui.fieldNotice.textContent = fieldLimit() === 2 ? 'Powerplay • maximum 2 outside the ring' : 'Gold: fielders • teal: keeper / bowler • white: ball'
  ui.fielderSelect.replaceChildren(...plannedField().map((p, i) => new Option(`${i + 1} · ${positionName(p)}`, String(i))))
  ui.fielderSelect.value = String(selectedFielder)
  ui.fieldDialog.showModal()
  refreshPending = true
})
ui.fielderSelect.addEventListener('change', () => { selectedFielder = Number(ui.fielderSelect.value) })
fieldEditor.svg.addEventListener('click', (event) => {
  if (!canEditField() || view === 'online') return
  const target = event.target instanceof Element ? event.target.closest('[data-fielder]') : null
  if (target) {
    selectedFielder = Number(target.getAttribute('data-fielder'))
    ui.fielderSelect.value = String(selectedFielder)
    ui.fieldNotice.textContent = `Fielder ${selectedFielder + 1} selected. Tap the new position.`
    return
  }
  const destination = fieldEditor.destination(event, fieldBoundary())
  const boundary = fieldBoundary()
  if (Math.hypot(destination.x / boundary.x, (destination.z - PITCH_LENGTH / 2) / boundary.z) > .94) {
    ui.fieldNotice.textContent = 'Keep the fielder inside the boundary.'
    return
  }
  const next = plannedField().map((p, i) => i === selectedFielder ? destination : { ...p })
  const outside = next.filter(p => Math.hypot(p.x, p.z - Math.max(0, Math.min(PITCH_LENGTH, p.z))) > 27.43).length
  if (outside > (fieldLimit() ?? 9)) {
    ui.fieldNotice.textContent = `Only ${fieldLimit()} fielders may be outside the ring. Move one inside first.`
    return
  }
  fieldLayout = next
  ui.fieldNotice.textContent = `Fielder ${selectedFielder + 1} → ${positionName(destination)}. Ready for the next ball.`
  refreshPending = true
})
function closeField() {
  ui.fieldDialog.close()
  paused = false
  setGameplay(true)
  refreshPending = true
}
element('field-close').addEventListener('click', closeField)
ui.fieldDialog.addEventListener('cancel', event => { event.preventDefault(); closeField() })

function showTiming(haptic = true) {
  if (!live) return
  const result = live.timing ?? (live.swingTick !== null && live.swingTick < live.contactTick ? 'early' : 'late')
  ui.timing.dataset.result = result
  ui.timingResult.textContent = result.toUpperCase()
  ui.needle.style.setProperty('--timing', `${result === 'perfect' ? 50 : result === 'good' ? (live.swingTick! < live.contactTick ? 35 : 65) : result === 'early' ? 8 : 92}%`)
  feedback(`${result.toUpperCase()} · ${live.contact === 'edge' ? 'Edge' : live.contact === 'miss' ? 'Missed' : SHOT_LABELS[record?.shot?.input.kind ?? activeShot]}`, live.contact === 'middle' ? 'hit' : 'miss')
  if (haptic && result === 'perfect' && live.contact === 'middle' && !settings.reducedMotion) {
    navigator.vibrate?.([25, 20, 40])
    ui.timing.animate([{ filter: 'brightness(1.7)', transform: 'scale(1.035)' }, { filter: 'brightness(1)', transform: 'scale(1)' }], { duration: 450 })
  }
}

function feedback(text: string, tone = 'normal') {
  ui.shotFeedback.textContent = text
  ui.shotFeedback.dataset.tone = tone
  ui.shotFeedback.hidden = false
  if (tone === 'miss' && !live?.timing) ui.timingResult.textContent = text.startsWith('Too early') ? 'EARLY' : 'LATE'
  feedbackUntil = performance.now() + 1600
}

function traceSwipe(x: number, y: number) {
  ui.swipeLine?.setAttribute('x2', String(x))
  ui.swipeLine?.setAttribute('y2', String(y))
  ui.swipeTip?.setAttribute('cx', String(x))
  ui.swipeTip?.setAttribute('cy', String(y))
}

ui.playfield.addEventListener('pointermove', (event) => {
  if (isBowling() || replaying) return
  if (pointer?.id === event.pointerId) {
    const dx = event.clientX - pointer.x
    const dy = event.clientY - pointer.y
    traceSwipe(event.clientX, event.clientY)
    if (Math.hypot(dx, dy) > 12) {
      const intent = swipeShot(dx, dy, event.timeStamp - pointer.at, Math.min(innerWidth, innerHeight), battingMode, live?.projectedContact.y, live?.projectedContact.x)
      aim = intent.aim - SHOT_ANGLES[activeShot]
      return
    }
  }
})
ui.playfield.addEventListener('pointerdown', (event) => {
  if (!event.isPrimary || event.button !== 0 || isBowling() || paused || replaying) return
  if (phase !== 'windup' && phase !== 'flight') return
  enableAudio()
  pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, at: event.timeStamp }
  ui.swipeTrail.classList.add('drawing')
  ui.swipeOrigin?.setAttribute('cx', String(event.clientX))
  ui.swipeOrigin?.setAttribute('cy', String(event.clientY))
  ui.swipeLine?.setAttribute('x1', String(event.clientX))
  ui.swipeLine?.setAttribute('y1', String(event.clientY))
  traceSwipe(event.clientX, event.clientY)
  ui.playfield.setPointerCapture(event.pointerId)
})
ui.playfield.addEventListener('pointerup', (event) => {
  if (!pointer || pointer.id !== event.pointerId) return
  const dx = event.clientX - pointer.x
  const dy = event.clientY - pointer.y
  const intent = swipeShot(dx, dy, event.timeStamp - pointer.at, Math.min(innerWidth, innerHeight), battingMode, live?.projectedContact.y, live?.projectedContact.x)
  activeShot = intent.kind
  aim = intent.aim - SHOT_ANGLES[intent.kind]
  mark('swipe')
  gestureSwing = { at: performance.now(), shot: intent.kind }
  const committed = battingInput(intent, event.timeStamp)
  if (committed) {
    mark('swipeCommitted')
    sound('swing')
  } else feedback(phase === 'windup' ? 'Too early · release after the bowler delivers'
    : view === 'online' ? 'Swing not sent · the server was busy'
      : 'Too late · swipe a little earlier', 'miss')
  ui.swipeTrail.classList.remove('drawing')
  refreshPending = true
  pointer = undefined
})
ui.playfield.addEventListener('pointercancel', () => { pointer = undefined; ui.swipeTrail.classList.remove('drawing') })
ui.playfield.addEventListener('lostpointercapture', () => { pointer = undefined; ui.swipeTrail.classList.remove('drawing') })

document.addEventListener('keydown', (event) => {
  if (view === 'home' || event.repeat || event.altKey || event.metaKey || event.ctrlKey) return
  // The third umpire's report has to be answered. Do not pause or play under it.
  if (ui.drsDialog.open || ui.fieldDialog.open || ui.settingsDialog.open || ui.scorecardDialog.open) return
  if (event.key === 'Escape' && !ui.overlay.open) {
    event.preventDefault()
    pause()
    return
  }
  if (paused || replaying || event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement) return
  if (!ui.fieldingControls.hidden) {
    const command: FieldingCommand | undefined = event.code === 'KeyF' ? { type: 'chase' }
      : event.code === 'KeyQ' ? { type: 'throw', end: 'striker' } : event.code === 'KeyE' ? { type: 'throw', end: 'bowler' } : undefined
    if (command) { event.preventDefault(); manualFieldingInput(command); return }
    const number = Number(event.key)
    if (Number.isInteger(number) && number >= 1 && number <= 9) {
      event.preventDefault(); manualFieldingInput({ type: 'select', index: number - 1 }); return
    }
    const fielder = live?.activeFielder === 9 ? live.keeper : live?.fielders[live.activeFielder]
    if (fielder && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault()
      manualFieldingInput({ type: 'move', x: fielder.x + (event.key === 'ArrowLeft' ? 3 : event.key === 'ArrowRight' ? -3 : 0),
        z: fielder.z + (event.key === 'ArrowUp' ? 3 : event.key === 'ArrowDown' ? -3 : 0) })
      return
    }
  }
  if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
    if (!isBowling()) ui.loft.click()
    return
  }
  if (event.code === 'KeyD' && !isBowling()) { ui.defense.click(); return }
  const utilityFocused = event.target === ui.pause || event.target === ui.sound || event.target === ui.homeButton
  if (!ui.duoControls.hidden && !ui.overlay.open &&
    !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
    const button = event.code === 'KeyR' ? ui.duoRun : event.code === 'KeyC' ? ui.duoNo : event.code === 'KeyW' ? ui.duoWait : undefined
    if (button) { event.preventDefault(); button.click(); return }
  }
  if (event.code === 'KeyV' && match?.drs.pendingOutcome) {
    event.preventDefault()
    resolveReview(true)
    return
  }
  if (event.code === 'Space' && !utilityFocused && !isBowling() && phase === 'flight') {
    event.preventDefault()
    battingInput(swipeShot(0, -180, 150, Math.min(innerWidth, innerHeight), battingMode, live?.projectedContact.y, live?.projectedContact.x), event.timeStamp)
  }
  const index = Number(event.key) - 1
  if (Number.isInteger(index) && index >= 0 && index < 4) {
    if (isBowling()) bowlButtons.get(DELIVERIES[index + Number(ui.deliveryBank.value) * 4])?.click()
  }
})

ui.overlay.addEventListener('cancel', (event) => {
  event.preventDefault()
  // Esc closes the overlay unless it is asking a question that must be answered.
  if (ui.overlay.dataset.dismissible === 'false') return
  if (onlinePanel === 'exit') onlinePanel = undefined
  closeOverlay()
})
ui.drsDialog.addEventListener('cancel', (event) => event.preventDefault())
ui.scorecardDialog.addEventListener('cancel', (event) => {
  event.preventDefault()
  ui.scorecardDialog.close()
  if (!ui.overlay.open) paused = false
})
ui.sound.addEventListener('click', () => {
  muted = !muted
  save(SOUND_KEY, muted ? 'off' : 'on')
  if (!muted) enableAudio()
  showWallet()
})
for (const [button, mode] of [[ui.loft, 'loft'], [ui.defense, 'defense']] as const) {
  button.addEventListener('click', () => {
    enableAudio()
    battingMode = battingMode === mode ? 'normal' : mode
    activeShot = battingMode === 'loft' ? 'loft' : battingMode === 'defense' ? 'defend' : 'drive'
    refreshPending = true
  })
}
element('match-settings').addEventListener('click', () => { applySettings(); ui.settingsDialog.showModal() })
ui.autoNext.addEventListener('click', () => {
  autoNext = !autoNext
  ui.autoNext.setAttribute('aria-pressed', String(autoNext))
  ui.autoNext.textContent = `Auto next ${autoNext ? '●' : '○'}`
})
ui.reviewHint.addEventListener('click', () => { if (match?.drs.pendingOutcome) resolveReview(true) })
ui.scorecardButton.addEventListener('click', () => {
  if (view === 'home') return
  paused = true
  renderScorecard()
})
element('scorecard-close').addEventListener('click', () => {
  ui.scorecardDialog.close()
  if (!ui.overlay.open) paused = false
})

function applySettings() {
  muted = !settings.sound
  ui.settingSound.checked = settings.sound
  ui.settingMotion.checked = settings.reducedMotion
  ui.settingNeedle.checked = settings.showNeedle
  ui.settingQuality.value = settings.quality
  ui.settingDifficulty.value = settings.timing
  document.body.dataset.motion = settings.reducedMotion ? 'reduced' : 'full'
  stadium?.setQuality(settings.quality)
  showWallet()
  refreshPending = true
}

ui.howToPlay.addEventListener('click', () => {
  ui.howToPlayDialog.showModal()
})
element('how-to-play-close').addEventListener('click', () => ui.howToPlayDialog.close())
ui.settingsButton.addEventListener('click', () => {
  applySettings()
  ui.settingsDialog.showModal()
})
element('settings-close').addEventListener('click', () => ui.settingsDialog.close())
for (const input of [ui.settingSound, ui.settingMotion, ui.settingNeedle, ui.settingQuality, ui.settingDifficulty]) {
  input.addEventListener('change', () => {
    settings = {
      sound: ui.settingSound.checked,
      reducedMotion: ui.settingMotion.checked,
      showNeedle: ui.settingNeedle.checked,
      quality: (['high', 'medium', 'low'] as const).find((value) => value === ui.settingQuality.value) ?? 'high',
      timing: (['relaxed', 'standard', 'precise'] as const).find((value) => value === ui.settingDifficulty.value) ?? 'standard',
    }
    saveSettings(settings)
    applySettings()
  })
}
ui.homeButton.addEventListener('click', () => { if (view !== 'home') pause() })
ui.solo.addEventListener('click', () => start('solo'))
ui.training.addEventListener('click', () => start('training'))
ui.six.addEventListener('click', () => start('six'))
ui.online.addEventListener('click', () => ui.onlineMenu.showModal())
element('quick-online').addEventListener('click', () => startOnline({ type: 'quick' }))
element('create-online').addEventListener('click', () => {
  if (!ui.privateOvers.reportValidity()) return
  const overs = ui.privateOvers.valueAsNumber
  if (Number.isInteger(overs) && overs >= 2 && overs <= 20) startOnline({ type: 'create', overs })
})
element('create-duo').addEventListener('click', () => {
  if (!ui.privateOvers.reportValidity()) return
  const overs = ui.privateOvers.valueAsNumber
  if (Number.isInteger(overs) && overs >= 2 && overs <= 20) startOnline({ type: 'create-duo', overs })
})
function runningCall(call: 'run' | 'wait' | 'no') {
  if (paused || replaying) return
  if (view === 'online' && onlineState) {
    if (isBowling() && onlineState.mode === 'duo') network?.send({ type: 'call', match: onlineState.match, delivery: onlineState.delivery, call })
    else if (!isBowling() && call !== 'wait') {
      const sent = network?.send({ type: 'running', delivery: onlineState.delivery, running: call === 'run' }) ?? false
      if (!sent) feedback('Command not sent · waiting for the server', 'miss')
    }
  } else if ((view === 'solo' || view === 'training') && !isBowling() && call !== 'wait' && record && live?.manualRunning) {
    const accepted = live.setRunning(call === 'run')
    if (accepted) {
      record.runs = [...record.runs ?? [], { tick: live.tick, running: call === 'run' }]
      sound('release')
      refreshPending = true
    }
    else feedback('Too late to call for that run', 'miss')
  }
}
ui.duoSwap.addEventListener('click', () => {
  const swap = onlineState?.duoSwap
  if (onlineState?.mode !== 'duo' || !swap || onlineSeat === undefined) return
  network?.send({ type: 'swap', match: onlineState.match, delivery: onlineState.delivery,
    version: swap.version, approve: !swap.votes[onlineSeat] })
})
ui.duoRun.addEventListener('click', () => runningCall('run'))
ui.duoWait.addEventListener('click', () => runningCall('wait'))
ui.duoNo.addEventListener('click', () => runningCall('no'))
element('join-online').addEventListener('click', () => {
  const room = roomCode(ui.joinCode.value.trim())
  if (room) startOnline({ type: 'join', room })
  else {
    ui.joinCode.setCustomValidity('Enter the 12-character room code.')
    ui.joinCode.reportValidity()
  }
})
ui.joinCode.addEventListener('input', () => ui.joinCode.setCustomValidity(''))
element('close-online').addEventListener('click', () => ui.onlineMenu.close())
const menus = setupMenus((settings) => start('solo', settings))
ui.setup.addEventListener('click', menus.openSetup)
ui.lineup.addEventListener('click', menus.openLineup)
element<HTMLDialogElement>('lineup-dialog').addEventListener('close', () => {
  if (onlineState?.phase === 'lobby' && onlineSeat !== undefined) {
    onlinePanel = undefined
    syncOnline(onlineState, onlineSeat)
  }
})
ui.field.replaceChildren(...FIELD_PRESETS.map((field) => new Option(FIELD_LABELS[field], field)))
ui.field.addEventListener('change', () => {
  if (!canEditField()) return
  activeField = FIELD_PRESETS.find((field) => field === ui.field.value) ?? 'balanced'
  fieldLayout = undefined
  refreshPending = true
})
ui.deliveryBank.addEventListener('change', () => {
  activeDelivery = DELIVERIES[Number(ui.deliveryBank.value) * 4] ?? 'fast'
  refreshPending = true
})
ui.pause.addEventListener('click', pause)
ui.next.addEventListener('click', afterBall)
ui.replay.addEventListener('click', () => { closeOverlay(); replayBall() })
ui.line.addEventListener('input', () => { refreshPending = true })
ui.effort.addEventListener('input', () => { refreshPending = true })
document.addEventListener('visibilitychange', () => { if (document.hidden && view !== 'online') pause() })

// The operating system preference can change while the game is open.
const motionQuery = matchMedia('(prefers-reduced-motion: reduce)')
motionQuery.addEventListener('change', (event) => {
  if (settings.reducedMotion !== event.matches) {
    settings = { ...settings, reducedMotion: event.matches }
    saveSettings(settings)
    applySettings()
  }
})

let stadium: ReturnType<typeof createStadium> | undefined
async function boot() {
  ui.loading.textContent = 'Checking the play environment…'
  await initializePlatform((value) => {
    platformMuted = value
    if (value && audio) void audio.suspend().catch(() => {})
    else if (audio) enableAudio()
    showWallet()
  })
  setLoading(true)
  ui.loading.textContent = 'Preparing the stadium…'
  career = loadCareer()
  careerRecord = loadCareerRecord()
  showCareerSummary()
  showHomeMatch()
  muted = stored(SOUND_KEY) === 'off'
  settings = loadSettings()
  applySettings()
  showWallet()
  try {
    stadium = createStadium(ui.stadium)
    stadium.setQuality(settings.quality)
    stadium.render({ mode: 'home', phase: 'ready' }, 0)
    mark('firstFrame')
    ui.solo.disabled = ui.training.disabled = ui.setup.disabled = ui.lineup.disabled = ui.online.disabled = ui.six.disabled = false
    element<HTMLButtonElement>('how-to-play').disabled = element<HTMLButtonElement>('settings-button').disabled = false
    ui.loading.hidden = true
    requestAnimationFrame(frame)
    const room = roomCode(inviteRoom() ?? new URLSearchParams(location.search).get('room'))
    const remembered = rememberedRoom()
    if (remembered && (!room || remembered.room === room)) startOnline(remembered)
    else if (room) startOnline({ type: 'join', room })
    else {
      const play = new URLSearchParams(location.search).get('play')
      if (play === 'solo' || play === 'training' || play === 'six') start(play)
    }
  } catch (error) {
    mark('graphicsFallback')
    const deepLink = new URLSearchParams(location.search).get('room')
    ui.loading.textContent = deepLink
      ? 'The match link could not be opened. The room may have closed or the server may be unreachable.'
      : 'The ground needs WebGL 2. Enable graphics acceleration or open the game in a WebGL 2 browser.'
    console.error('Could not start the cricket stadium.', error)
  } finally {
    ui.progress.hidden = true
    setLoading(false)
  }
}
void boot()

declare global {
  interface Window {
    cclTelemetry: () => ReturnType<typeof readTelemetry> & { graphics?: ReturnType<ReturnType<typeof createStadium>['info']> }
  }
}
window.cclTelemetry = () => ({ ...readTelemetry(), graphics: stadium?.info() })
