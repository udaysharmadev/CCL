import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { chromium, type Page } from 'playwright-core'
import { build, preview } from 'vite'
import type { DeliveryOptions, FieldingCommand } from '../src/cricket.ts'
import type { DeliveryOutcome, Innings } from '../src/rules.ts'

// A temporary production build adds only a read-only observer. Setup, bowling,
// fielding, scoring, scorecard and replay all use the real UI/controller.
// Solo's bowling offset maps this URL seed to 605, which Rookie AI leaves.
const matchSeed = 4293693770
const outDir = await mkdtemp(join(tmpdir(), 'ccl-h5-browser-'))
const temporaryPath = relative(tmpdir(), outDir)
assert.ok(!isAbsolute(temporaryPath) && !temporaryPath.startsWith('..') && temporaryPath.startsWith('ccl-h5-browser-'))
let server: Awaited<ReturnType<typeof preview>> | undefined
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
let address: { port: number }

type State = {
  phase: string
  tick: number | null
  parried: boolean | null
  completedRuns: number | null
  progress: number[] | null
  positions: number[] | null
  options: DeliveryOptions | null
  outcome: DeliveryOutcome | null
  innings: Innings | null
  fielding: { tick: number; command: FieldingCommand }[]
}

declare global {
  interface Window { __cclH5State: () => State }
}

const observer = `
window.__cclH5State = () => ({
  phase, tick: live?.tick ?? null, parried: live?.parried ?? null,
  completedRuns: live?.completedRuns ?? null,
  progress: live ? [live.runnerProgress, live.partnerProgress] : null,
  positions: live ? [...live.runnerPositions] : null,
  options: live ? {...live.options} : null, outcome: live?.outcome ?? null,
  innings: currentInnings() ?? null, fielding: record?.fielding ?? [],
})
`

async function state(page: Page) { return page.evaluate(() => window.__cclH5State()) }

async function until(page: Page, predicate: (snapshot: State) => boolean, description: string, milliseconds = 16) {
  for (let step = 0; step < 700; step++) {
    const snapshot = await state(page)
    if (predicate(snapshot)) return snapshot
    await page.clock.runFor(milliseconds)
  }
  throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(await state(page))}`)
}

async function tick(page: Page, target: number) {
  const snapshot = await until(page, value => value.tick !== null && value.tick >= target, `tick ${target}`)
  assert.equal(snapshot.tick, target, 'observe the exact simulation tick')
  return snapshot
}

async function start(page: Page, fielding: 'auto' | 'manual') {
  await page.goto(`http://127.0.0.1:${address.port}/?seed=${matchSeed}`)
  await page.locator('#stadium canvas').waitFor()
  await page.getByRole('button', { name: 'Match setup', exact: true }).click()
  await page.getByLabel('Innings order').selectOption('bowl')
  await page.getByLabel('AI difficulty').selectOption('Rookie')
  await page.locator('#setup-fielding').selectOption(fielding)
  await page.getByRole('button', { name: /Start match/ }).click()
  await page.clock.runFor(20)
  await page.getByLabel('Bowling line').evaluate(input => {
    (input as HTMLInputElement).value = '0.4'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.getByLabel('Bowling effort').evaluate(input => {
    (input as HTMLInputElement).value = '1'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.locator('#next-button').click()
  await until(page, value => value.phase === 'flight', 'ball release', 100)
  const before = await tick(page, 43)
  assert.equal(before.options?.seed, 605)
  assert.equal(before.options?.kind, 'fast')
  assert.equal(before.options?.line, .4)
  assert.equal(before.options?.effort, 1)
  assert.equal(before.options?.bowler, 'Rao')
  assert.equal(before.options?.runningMode, undefined, 'AI uses assisted running')
  assert.equal(before.parried, false)
  assert.equal(before.completedRuns, 0)
  const fumble = await tick(page, 44)
  assert.equal(fumble.parried, true)
  assert.equal(fumble.completedRuns, 0)
  assert.deepEqual(fumble.progress, [0, 0])
  assert.deepEqual([fumble.innings?.striker, fumble.innings?.nonStriker], [1, 2])
  assert.equal(await page.locator('#score').textContent(), '0/0')
}

function checkScore(snapshot: State, byes: number) {
  assert.equal(snapshot.phase, 'dead')
  const { outcome, innings } = snapshot
  assert.ok(outcome && innings)
  assert.equal(outcome.noBall, 0)
  assert.equal(outcome.wide, 0)
  assert.equal(outcome.batRuns, 0)
  assert.equal(outcome.byes, byes)
  assert.equal(outcome.legByes, 0)
  assert.equal(outcome.overthrowRuns, 1, 'one seeded overthrow award remains separate from completed running')
  assert.equal(outcome.penalty ?? 0, 0, 'the same award is not copied into a second delivery component')
  assert.equal(outcome.wicket, null)
  assert.equal(outcome.completedRuns, byes)
  assert.equal(innings.runs, 1 + byes)
  assert.equal(innings.wickets, 0)
  assert.equal(innings.legalBalls, 1)
  assert.equal(innings.attempts, 1)
  assert.deepEqual(innings.history, [outcome])
  assert.equal(innings.freeHit, false)
  assert.equal(innings.batting.reduce((runs, batter) => runs + batter.runs, 0), 0)
  assert.deepEqual(innings.bowling, [{ name: 'Rao', balls: 1, runs: 1, wickets: 0, maidens: 0, wides: 0, noBalls: 0 }])
  assert.deepEqual(innings.extras, { wide: 0, noBall: 0, byes, legByes: 0, penalty: 1 })
  assert.equal(Object.values(innings.extras).reduce((sum, runs) => sum + runs, 0), innings.runs,
    'all runs appear in the scorecard extras because this delivery has no bat contact')
}

async function tokenFits(page: Page) {
  const fits = await page.locator('#ribbon > span').first().evaluate(token => {
    const box = token.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(token)
    const text = range.getBoundingClientRect()
    const next = token.nextElementSibling?.getBoundingClientRect()
    return text.left >= box.left - .1 && text.right <= box.right + .1 && (!next || text.right < next.left)
  })
  assert.ok(fits, 'the overthrow token must fit without overlapping the next delivery')
}

async function scorecard(page: Page, runs: number, byes: number) {
  const token = byes ? `${byes}B+1OT` : '1OT'
  assert.equal(await page.locator('#call-title').textContent(), byes ? `${byes} ${byes === 1 ? 'bye' : 'byes'}` : '1 overthrow run')
  if (byes) assert.match(await page.locator('#call-detail').textContent() ?? '', /\+1 overthrow run/)
  assert.equal(await page.locator('#ribbon > span').first().textContent(), token)
  await tokenFits(page)
  if (byes === 1) {
    await page.setViewportSize({ width: 375, height: 650 })
    await tokenFits(page)
    await page.setViewportSize({ width: 1000, height: 650 })
  }
  await page.locator('#pause-button').click()
  await page.locator('#scorecard-button').click()
  assert.equal(await page.locator('.scorecard-total').textContent(), `${runs}/0`)
  assert.equal((await page.locator('.extras-line').textContent())?.replaceAll(/\s+/g, ' '), `Extras ${runs} · b ${byes} · lb 0 · wd 0 · nb 0 · penalty 1`)
  assert.ok((await page.locator('.over-log').textContent())?.includes(token), 'scorecard delivery token retains the overthrow award')
  const battingRows = page.locator('.score-section').filter({ has: page.getByRole('heading', { name: 'Batting', exact: true }) }).locator('tbody tr')
  assert.equal(await battingRows.nth(0).locator('td').nth(1).textContent(), '0')
  const bowlingRow = page.locator('.score-section').filter({ has: page.getByRole('heading', { name: 'Bowling', exact: true }) }).locator('tbody tr')
  assert.deepEqual(await bowlingRow.locator('th, td').allTextContents(), ['Rao', '0.1', '0', '1', '0', '6.00', '0', '0'])
  await page.locator('#scorecard-close').click()
}

try {
  let observed = false
  await build({
    configLoader: 'native',
    build: { outDir, emptyOutDir: true },
    plugins: [{ name: 'h5-read-only-observer', enforce: 'pre', transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/src/main.ts')) return
      observed = true
      return { code: code + observer, map: null }
    } }],
  })
  assert.ok(observed, 'observe the real controller without replacing its behavior')
  server = await preview({ configLoader: 'native', build: { outDir }, preview: { host: '127.0.0.1', port: 0, strictPort: true } })
  const binding = server.httpServer.address()
  assert.ok(binding && typeof binding !== 'string')
  address = binding
  browser = await chromium.launch({
    executablePath: process.env.CCL_CHROME_PATH,
    args: process.env.CCL_SOFTWARE_GPU === '1'
      ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
      : ['--ignore-gpu-blocklist', '--enable-webgl'],
  })
  const page = await browser.newPage({ viewport: { width: 1000, height: 650 }, deviceScaleFactor: 1 })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    localStorage.setItem('ccl.settings.v1', JSON.stringify({ quality: 'low', reducedMotion: true, sound: false }))
  })
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') })
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'))

  await start(page, 'auto')
  const incomplete = await tick(page, 82)
  console.log(`Observed seed 605 at tick 82: outcome=${JSON.stringify(incomplete.outcome)}, extras=${JSON.stringify(incomplete.innings?.extras)}`)
  checkScore(incomplete, 0)
  assert.ok(incomplete.progress?.every(progress => progress > 0 && progress < .5))
  assert.deepEqual([incomplete.innings?.striker, incomplete.innings?.nonStriker], [1, 2])
  assert.equal(await page.locator('#score').textContent(), '1/0')
  assert.equal(await page.locator('#overs').textContent(), '0.1')
  await scorecard(page, 1, 0)
  console.log('PASS: auto fielding scores one overthrow, no incomplete run, and scorecard extras reconcile at 1/0.')

  await start(page, 'manual')
  // A real UI throw completes exactly as both assisted runners ground. Holding
  // the same ball longer leaves one completed run valid before the second run.
  await tick(page, 171)
  await page.getByRole('button', { name: /Keeper end/ }).click()
  const before = await tick(page, 243)
  assert.equal(before.completedRuns, 0)
  assert.ok(before.progress?.every(progress => progress > .99 && progress < 1))
  assert.equal(before.innings?.runs, 0)
  const complete = await tick(page, 244)
  checkScore(complete, 1)
  assert.deepEqual(complete.progress, [0, 0])
  assert.deepEqual([complete.innings?.striker, complete.innings?.nonStriker], [2, 1])
  assert.deepEqual(complete.fielding, [{ tick: 171, command: { type: 'throw', end: 'striker' } }])
  assert.equal(await page.locator('#score').textContent(), '2/0')
  assert.match(await page.locator('#batter-strip').textContent() ?? '', /Reed \*/)
  await page.clock.runFor(500)
  assert.deepEqual((await state(page)).innings, complete.innings, 'later frames cannot reapply the delivery')
  await scorecard(page, 2, 1)
  console.log('PASS: grounding at tick 244 keeps one bye and one overthrow; scorecard shows extras 2 and Rao concedes 1; tokens fit desktop and mobile.')

  await page.locator('#replay-button').click()
  await until(page, snapshot => snapshot.phase === 'flight', 'replay release', 100)
  const replay = await tick(page, 244)
  checkScore(replay, 1)
  assert.deepEqual(replay.outcome, complete.outcome)
  assert.deepEqual(replay.innings, complete.innings, 'UI replay cannot score the overthrow again')
  assert.deepEqual(replay.fielding, complete.fielding)
  assert.equal(await page.locator('#score').textContent(), '2/0')
  console.log('PASS: UI replay preserves the complete outcome, fielding command and authoritative innings.')

  await start(page, 'manual')
  assert.equal((await tick(page, 244)).completedRuns, 1)
  await tick(page, 354)
  await page.getByRole('button', { name: /Keeper end/ }).click()
  const twoRuns = await tick(page, 427)
  checkScore(twoRuns, 2)
  assert.deepEqual(twoRuns.progress, [0, 0])
  assert.deepEqual([twoRuns.innings?.striker, twoRuns.innings?.nonStriker], [1, 2])
  assert.equal(await page.locator('#score').textContent(), '3/0')
  await scorecard(page, 3, 2)
  assert.deepEqual(errors, [])
  console.log(`PASS: overthrow after one completed run preserves two byes at tick 427, total 3/0; Chromium ${browser.version()}; no page errors.`)
} finally {
  await browser?.close()
  await server?.close()
  assert.ok(!isAbsolute(temporaryPath) && !temporaryPath.startsWith('..') && temporaryPath.startsWith('ccl-h5-browser-'))
  await rm(outDir, { recursive: true, force: true })
}
