import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { applyDelivery, newInnings, type DeliveryOutcome, type Innings } from '../src/rules.ts'
import { DEFAULT_LINEUP } from '../src/match-data.ts'
import type { OnlineMode, OnlineSeat, OnlineSnapshot } from '../src/online-contract.ts'
import { availableBatters, chooseAIBowler } from '../src/match-selection.ts'
import { availableVariations } from '../src/bowling.ts'
import type { PlayerProfile } from '../src/player-profile.ts'

const require = createRequire(new URL('../src/main.ts', import.meta.url))
// Execute the real controller, including its registered UI callbacks. Only its
// browser/platform adapters are replaced; review adjudication and scoring are real.
const controller = ts.transpileModule(readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
}).outputText

class Node {
  hidden = true
  open = false
  value = ''
  textContent = ''
  children: Node[] = []
  dataset: Record<string, string> = {}
  attributes = new Map<string, string>()
  listeners = new Map<string, (() => void)[]>()
  classList = { add() {}, remove() {}, toggle() {} }
  style = { setProperty() {} }
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, [...this.listeners.get(type) ?? [], listener])
  }
  click() { for (const listener of this.listeners.get('click') ?? []) listener() }
  append(...children: Node[]) { this.children.push(...children) }
  prepend(...children: Node[]) { this.children.unshift(...children) }
  replaceChildren(...children: Node[]) { this.children = children }
  setAttribute(name: string, value: string) { this.attributes.set(name, value) }
  getAttribute(name: string) { return this.attributes.get(name) ?? null }
  querySelector() { return new Node() }
  closest() { return new Node() }
  focus() {}
  close() { this.open = false }
  showModal() { this.open = true }
}

function game() {
  const nodes = new Map<string, Node>()
  const node = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, new Node())
    return nodes.get(id)!
  }
  let now = 1000
  let identity = 0
  let onlineCallbacks: { snapshot: (state: OnlineSnapshot, seat: OnlineSeat) => void } | undefined
  const platform = {
    // Boot is held at the platform boundary; tests call the actual start/home
    // functions explicitly and advance the actual frame with a controlled clock.
    initializePlatform: () => new Promise(() => {}),
    stored: () => null, save: () => true, setGameplay() {}, setLoading() {},
    leavePublishedRoom() {}, publishRoom() {}, inviteRoom: () => null,
    inviteLink: () => '',
  }
  const setup = require('./setup.ts')
  const settings = require('./settings.ts')
  const adapters: Record<string, unknown> = {
    './platform.ts': platform,
    './setup.ts': { ...setup, getSettings: () => ({ ...setup.DEFAULT_SETTINGS }), getLineup: () => [...require('./match-data.ts').DEFAULT_LINEUP], setupMenus: () => ({ openSetup() {}, openLineup() {} }) },
    './settings.ts': { ...settings, saveCareer() {}, saveSettings() {} },
    './stadium.ts': { VENUE_BOUNDARIES: { suncrest: { x: 65, z: 70 } }, VENUE_NAMES: { suncrest: 'Suncrest' } },
    './field-map.ts': { createFieldMap: () => ({ svg: new Node(), render() {} }) },
    // Selection and release capture are browser adapters. The actual managed
    // innings, eligibility, replacement and DRS controller still execute below.
    './player-selection-ui.ts': { createPlayerSelection: () => ({
      open: false, close() {},
      openers(_players: PlayerProfile[], _state: Innings, choose: (a: number, b: number) => void) { choose(1, 2) },
      batter(_players: PlayerProfile[], state: Innings, choose: (index: number) => void) { choose(availableBatters(state)[0]) },
      bowler(players: PlayerProfile[], state: Innings, choose: (id: string) => void) { const p = chooseAIBowler(players, state, 'right'); if (p) choose(p.id) },
    }) },
    './bowling-hud.ts': { createBowlingHud: () => {
      const controls = { variation: 'stock', line: .18, length: 6.2, power: .76, release: .8, movement: .65, side: 'over', batterHand: 'right' }
      return { root: new Node(), controls, timing: false, reset() {}, advance() {}, feedback() {}, select() {}, startTiming() {}, finishTiming: () => .8,
        configure(p: PlayerProfile) { const v = availableVariations(p).find(v => !v.locked); if (v) { controls.variation = v.id; controls.length = v.defaultLength } },
      }
    } },
    './online-client.ts': {
      connectOnline: (_handshake: unknown, callbacks: NonNullable<typeof onlineCallbacks>) => {
        onlineCallbacks = callbacks
        return { stop() {}, send: () => true }
      },
      rememberedRoom: () => null, roomCode: (value: string) => value,
    },
    './telemetry.ts': { mark() {}, sample() {}, readTelemetry: () => ({}) },
  }
  const context = createContext({
    exports: {}, require: (name: string) => name.endsWith('.css') ? {} : adapters[name] ?? require(name),
    document: { getElementById: node, querySelector: node, createElement: () => new Node(), addEventListener() {}, body: new Node() },
    window: {}, location: { search: '?seed=41', href: 'http://localhost/?seed=41' },
    URL, URLSearchParams, Option: Node, navigator: {}, structuredClone,
    crypto: { randomUUID: () => `h2-session-${++identity}` },
    performance: { now: () => now }, requestAnimationFrame() {},
    matchMedia: () => ({ addEventListener() {} }), console,
  })
  runInContext(controller, context, { filename: fileURLToPath(new URL('../src/main.ts', import.meta.url)) })
  // Skip only the entrance's presentation clock. Calling the real preparation
  // gate consumes the adapter's real choices before a DRS fixture is supplied.
  runInContext(`function prepareTestBall() {
    if (view === 'solo' && isBowling() && match?.selectedBowler) bowlingHud.configure(matchProfile(match.selectedBowler.playerId));
    beginBall(true);
    if (entranceAge !== undefined) { entranceAge = undefined; beginBall(true) }
    if (!record && phase === 'ready' && !paused) {
      if (view === 'solo' && isBowling() && match?.selectedBowler) bowlingHud.configure(matchProfile(match.selectedBowler.playerId));
      beginBall(true);
    }
  }`, context)
  const run = <T = unknown>(source: string): T => runInContext(source, context)
  const start = (mode = 'solo') => run(`start('${mode}'); prepareTestBall()`)
  const offer = (kind: 'caught' | 'lbw' = 'caught', overturned = false, marginal = false) => {
    // Supply a completed delivery at the simulation/controller boundary, so
    // rare reviews and the six-second expiry do not depend on random physics.
    run(`if (!record && !replaying) prepareTestBall(); setPhase('flight'); live = { timing: 'late', contact: 'edge', swingTick: null, contactTick: 1,
      lbw: { tracking: { out: ${!overturned}, pitched: 'in-line', impact: 'in-line', wickets: 'hitting' }, portion: ${marginal ? 0.3 : 0.8} },
      outcome: { batRuns: 0, wide: 0, noBall: 0, byes: 0, legByes: 0,
        wicket: '${kind}', completedRuns: 0, reason: '${kind}', contact: 'edge' } };
      settleBall(live.outcome)`)
  }
  const state = () => run<{ reviewsLeft: number; pendingOutcome?: DeliveryOutcome; pendingRecord?: unknown; reviewDeadline: number }>('match.drs')
  return {
    run, node, start, offer, state,
    score: () => run<Innings>('currentInnings()'),
    advance: (milliseconds: number) => { now += milliseconds; run(`frame(${now})`) },
    continue: () => node('drs-actions').children[0].click(),
    action: (label: string) => {
      const button = node('overlay-actions').children.find(child => child.textContent === label)
      assert.ok(button, `Missing overlay action: ${label}`)
      button.click()
    },
    snapshot: (state: OnlineSnapshot) => {
      assert.ok(onlineCallbacks)
      onlineCallbacks.snapshot(state, 0)
    },
  }
}

test('H2: a pending review cannot cross home and a new match in the same session', () => {
  const app = game()
  app.start()
  app.offer()
  assert.ok(app.state().pendingOutcome)
  app.run('home()')
  app.start()
  // Explicitly exercise the old expiry entry point before testing UI cleanup:
  // before H2 this records the previous match\'s wicket as Match B\'s first ball.
  app.run('expireReview()')
  assert.equal(app.score().wickets, 0, 'Match B inherited Match A\'s wicket')
  assert.equal(app.score().attempts, 0)
  assert.equal(app.state().pendingOutcome, undefined)
  assert.equal(app.state().pendingRecord, undefined)
  assert.equal(app.state().reviewDeadline, 0)
  assert.equal(app.node('review-hint').hidden, true)
  app.offer()
  app.run('resolveReview(true)')
  app.continue()
  assert.equal(app.score().wickets, 1)
})

test('H2: a retained Continue callback cannot score an old review in a new match', () => {
  const app = game()
  app.start()
  app.offer()
  app.run('resolveReview(true)')
  const oldContinue = app.node('drs-actions').children[0]
  app.run('home()')
  app.start()
  oldContinue.click()
  assert.equal(app.score().wickets, 0, 'The stale report scored Match A\'s wicket in Match B')
  assert.equal(app.score().attempts, 0)
  assert.equal(app.node('drs-dialog').open, false)
})

test('H2: fresh Solo, Training and Six sessions have an empty review lifecycle', () => {
  const app = game()
  for (const mode of ['solo', 'training', 'six']) {
    app.start(mode)
    assert.equal(app.state().reviewsLeft, 2)
    assert.equal(app.state().pendingOutcome, undefined)
    assert.equal(app.state().pendingRecord, undefined)
    assert.equal(app.state().reviewDeadline, 0)
    assert.equal(app.node('review-hint').hidden, true)
    assert.equal(app.node('drs-dialog').open, false)
    assert.equal(app.node('drs-actions').children.length, 0)
  }
})

for (const result of ['upheld', 'overturned', 'umpires-call'] as const) {
  test(`H2: a previous ${result} review leaves a new match fresh and reviewable`, () => {
    const app = game()
    app.start()
    app.offer('lbw', result !== 'upheld', result === 'umpires-call')
    app.run('resolveReview(true)')
    // Existing rules spend every non-marginal review, even an overturned call.
    // H2 deliberately preserves that behavior.
    assert.equal(app.state().reviewsLeft, result === 'umpires-call' ? 2 : 1)
    app.continue()
    assert.equal(app.score().wickets, result === 'overturned' ? 0 : 1)
    app.run('home()')
    app.start()
    assert.equal(app.state().reviewsLeft, 2)
    assert.equal(app.state().pendingOutcome, undefined)
    assert.equal(app.state().reviewDeadline, 0)
    assert.equal(app.node('drs-title').textContent, '')
    assert.equal(app.node('drs-detail').textContent, '')
    assert.equal(app.node('drs-body').children.length, 0)
    app.offer()
    assert.ok(app.state().pendingOutcome)
    app.run('resolveReview(true)')
    app.continue()
    assert.equal(app.state().reviewsLeft, 1)
    assert.equal(app.score().attempts, 1)
  })
}

test('H2: exhausted reviews stay exhausted during the innings and reset on restart', () => {
  const app = game()
  app.start()
  for (let i = 0; i < 2; i++) {
    app.offer()
    app.run('resolveReview(true)')
    app.continue()
    app.run('prepareTestBall()')
  }
  assert.equal(app.state().reviewsLeft, 0)
  app.offer()
  assert.equal(app.state().pendingOutcome, undefined)
  assert.equal(app.score().attempts, 3)
  app.start()
  assert.equal(app.state().reviewsLeft, 2)
  assert.equal(app.score().history.length, 0)
  app.offer()
  assert.ok(app.state().pendingOutcome)
})

test('H2: direct match restart removes an outstanding offer and its deadline', () => {
  const app = game()
  app.start()
  app.offer()
  app.start()
  app.advance(6001)
  assert.equal(app.state().pendingOutcome, undefined)
  assert.equal(app.state().reviewDeadline, 0)
  assert.equal(app.score().attempts, 0)
  assert.equal(app.node('review-hint').hidden, true)
})

test('H2: same-match expiry records the delivery exactly once without spending a review', () => {
  const app = game()
  app.start()
  app.offer()
  app.advance(5999)
  assert.equal(app.score().attempts, 0)
  assert.ok(app.state().pendingOutcome)
  app.advance(2)
  assert.equal(app.score().attempts, 1)
  assert.equal(app.score().wickets, 1)
  assert.equal(app.state().reviewsLeft, 2)
  assert.equal(app.state().pendingOutcome, undefined)
  app.advance(1)
  app.run('expireReview()')
  assert.equal(app.score().attempts, 1)
})

test('H2: accepting the on-field decision clears the offer without spending a review', () => {
  const app = game()
  app.start()
  app.offer()
  app.run('resolveReview(false)')
  assert.equal(app.score().attempts, 1)
  assert.equal(app.state().reviewsLeft, 2)
  assert.equal(app.state().pendingOutcome, undefined)
  assert.equal(app.node('drs-dialog').open, false)
})

test('H2: a report Continue action can commit only once', () => {
  const app = game()
  app.start()
  app.offer()
  app.run('resolveReview(true)')
  const button = app.node('drs-actions').children[0]
  button.click()
  button.click()
  assert.equal(app.score().attempts, 1)
  assert.equal(app.score().wickets, 1)
  assert.equal(app.state().reviewsLeft, 1)
})

test('H2: an old callback cannot close or commit the current match\'s report', () => {
  const app = game()
  app.start()
  app.offer()
  app.run('resolveReview(true)')
  const old = app.node('drs-actions').children[0]
  app.start()
  app.offer('lbw', true)
  app.run('resolveReview(true)')
  old.click()
  assert.equal(app.node('drs-dialog').open, true)
  assert.equal(app.score().attempts, 0)
  assert.equal(app.state().reviewsLeft, 1)
  app.continue()
  assert.equal(app.score().attempts, 1)
  assert.equal(app.score().wickets, 0)
})

test('H2: replay and pause preserve same-innings review state', () => {
  const app = game()
  app.start()
  app.offer()
  app.run('resolveReview(true)')
  app.continue()
  const state = app.state()
  const score = app.score()
  app.run('pause()')
  app.action('Resume')
  app.run('replayBall()')
  app.offer()
  assert.equal(app.state(), state)
  assert.equal(app.state().reviewsLeft, 1)
  assert.equal(app.state().pendingOutcome, undefined)
  assert.equal(app.score(), score)
})

const dot = `{ batRuns: 0, wide: 0, noBall: 0, byes: 0, legByes: 0,
  wicket: null, completedRuns: 0, reason: 'collected', contact: 'miss' }`

test('H2: an innings transition renews the allowance and normal completion rematches start fresh', () => {
  const app = game()
  app.start()
  app.offer()
  app.run('resolveReview(true)')
  app.continue()
  assert.equal(app.state().reviewsLeft, 1)
  const first = app.run('match')
  app.run(`while (!currentInnings().complete) { prepareTestBall(); applyOutcome(${dot}) }`)
  app.run('afterBall()')
  app.action('Take the field')
  assert.equal(app.run('match'), first, 'An innings change remains in the same match')
  assert.equal(app.state().reviewsLeft, 2)
  assert.equal(app.state().pendingOutcome, undefined)
  assert.equal(app.state().reviewDeadline, 0)
  assert.equal(app.node('drs-actions').children.length, 0)
  app.run(`prepareTestBall(); applyOutcome({ ...${dot}, batRuns: 4, reason: 'boundary' }); afterBall()`)
  app.action('Play again')
  assert.notEqual(app.run('match'), first)
  assert.equal(app.score().attempts, 0)
  assert.equal(app.state().reviewsLeft, 2)
  app.offer()
  app.run('resolveReview(true)')
  app.continue()
  assert.equal(app.score().wickets, 1)
})

test('H2: Training completion and Practice again create a fresh review lifecycle', () => {
  const app = game()
  app.start('training')
  app.offer()
  app.run('resolveReview(true)')
  app.continue()
  app.run(`while (!currentInnings().complete) { prepareTestBall(); applyOutcome(${dot}) }`)
  app.run('afterBall()')
  app.action('Practice again')
  assert.equal(app.state().reviewsLeft, 2)
  assert.equal(app.state().pendingOutcome, undefined)
  assert.equal(app.state().reviewDeadline, 0)
  assert.equal(app.score().attempts, 0)
})

test('H2: a new match cannot mutate the retained previous match\'s review state', () => {
  const app = game()
  app.start()
  app.offer()
  app.run('resolveReview(true)')
  app.continue()
  const retained = app.state()
  app.start()
  const fresh = app.state()
  assert.notEqual(fresh, retained)
  assert.equal(retained.reviewsLeft, 1)
  app.offer()
  app.run('resolveReview(true)')
  app.continue()
  app.run('prepareTestBall()')
  app.offer()
  app.run('resolveReview(true)')
  app.continue()
  assert.equal(fresh.reviewsLeft, 0)
  assert.equal(retained.reviewsLeft, 1)
  assert.equal(retained.pendingOutcome, undefined)
})

function onlineSnapshot(mode: OnlineMode, match = 1): OnlineSnapshot {
  const caught: DeliveryOutcome = {
    batRuns: 0, wide: 0, noBall: 0, byes: 0, legByes: 0,
    wicket: 'caught', completedRuns: 0, reason: 'caught', contact: 'edge',
  }
  const innings = match === 1 ? applyDelivery(newInnings(2), caught) : newInnings(2)
  const { history, target, ...score } = innings
  return {
    revision: 1, match, room: 'abcdefghijkl', mode, overs: 2,
    settings: { overs: 2, venue: 'suncrest', pitch: 'dry', weather: 'clear' },
    settingsVersion: 0, ready: [true, true], lineups: [DEFAULT_LINEUP, DEFAULT_LINEUP],
    rematch: [false, false], wallets: [{ coins: 0, xp: 0 }, { coins: 0, xp: 0 }],
    rulesProfile: 'arcade_short_v1', bowler: 'Ward', maxOutside: 2,
    phase: 'ready', connected: [true, true], tossWinner: mode === 'duo' ? null : 0,
    battingSeat: 0, delivery: innings.attempts, innings: 1,
    score: { ...score, target: target ?? null, recent: history },
    firstInnings: null, bowlingKind: null, windupRemainingMs: null, active: null, last: null, result: null,
  }
}

for (const mode of ['quick', 'private', 'duo'] as const) {
  test(`H2: ${mode} snapshots and same-match recovery reject stale local report authority`, () => {
    const app = game()
    app.start()
    app.offer()
    app.run('resolveReview(true)')
    const oldContinue = app.node('drs-actions').children[0]
    app.run(`startOnline(${mode === 'quick' ? "{ type: 'quick' }" : mode === 'duo' ? "{ type: 'create-duo', overs: 2 }" : "{ type: 'create', overs: 2 }"})`)
    const state = onlineSnapshot(mode)
    app.snapshot(state)
    assert.equal(app.run('match'), undefined)
    assert.equal(app.run('onlineState.score'), state.score)
    assert.equal(app.node('drs-dialog').open, false)
    oldContinue.click()
    app.run('expireReview(); resolveReview(true)')
    assert.equal(app.run('onlineState.score'), state.score)
    assert.equal(app.score().wickets, 1)
    assert.equal(app.score().attempts, 1)
    assert.equal(app.run(`reviewable({ wicket: 'caught', contact: 'edge' })`), false)

    app.run("showOnlineStatus('reconnecting')")
    app.snapshot({ ...state, revision: 2 })
    assert.equal(app.run('onlineState.score'), state.score, 'Same-match recovery keeps the authoritative score')
    assert.equal(app.score().wickets, 1)
    assert.equal(app.node('review-hint').hidden, true)

    const rematch = onlineSnapshot(mode, 2)
    app.snapshot(rematch)
    oldContinue.click()
    assert.equal(app.run('onlineState.score'), rematch.score)
    assert.equal(app.score().wickets, 0)
    assert.equal(app.score().attempts, 0)
  })
}

test('H2: a pending local deadline cannot score during online recovery', () => {
  const app = game()
  app.start()
  app.offer()
  assert.ok(app.state().pendingOutcome)
  app.run("startOnline({ type: 'resume', room: 'abcdefghijkl', token: 'saved-session-token' })")
  const state = onlineSnapshot('private')
  app.snapshot(state)
  app.advance(6001)
  assert.equal(app.run('match'), undefined)
  assert.equal(app.run('onlineState.score'), state.score)
  assert.equal(app.score().attempts, 1)
  assert.equal(app.score().wickets, 1)
  assert.equal(app.node('review-hint').hidden, true)
})
