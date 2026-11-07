import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { chromium, type Page } from 'playwright-core'
import { build, preview } from 'vite'
import type { DeliveryOptions, FieldingCommand } from '../src/cricket.ts'
import type { DeliveryOutcome, Innings } from '../src/rules.ts'

// The temporary production build adds a read-only observer. All match setup,
// fielding commands, running, scoring, scorecard rendering and replay use the UI.
// Solo's bowling offset maps this match seed to 65; Rookie AI naturally leaves it.
const matchSeed = 4293693230
const outDir = await mkdtemp(join(tmpdir(), 'ccl-h4-browser-'))
const temporaryPath = relative(tmpdir(), outDir)
assert.ok(!isAbsolute(temporaryPath) && !temporaryPath.startsWith('..') && temporaryPath.startsWith('ccl-h4-browser-'))
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
  interface Window { __cclH4State: () => State }
}

const observer = `
window.__cclH4State = () => ({
  phase, tick: live?.tick ?? null, parried: live?.parried ?? null,
  completedRuns: live?.completedRuns ?? null,
  progress: live ? [live.runnerProgress, live.partnerProgress] : null,
  positions: live ? [...live.runnerPositions] : null,
  options: live ? {...live.options} : null, outcome: live?.outcome ?? null,
  innings: currentInnings() ?? null, fielding: record?.fielding ?? [],
})
`

async function state(page: Page) { return page.evaluate(() => window.__cclH4State()) }

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
  assert.equal(before.options?.seed, 65)
  assert.equal(before.options?.runningMode, undefined, 'AI uses assisted running')
  assert.equal(before.options?.line, .4)
  assert.equal(before.options?.effort, 1)
  assert.equal(before.options?.bowler, 'Rao')
  assert.equal(before.parried, false)
  assert.equal(before.completedRuns, 0)
  const fumble = await tick(page, 44)
  assert.equal(fumble.parried, true)
  assert.equal(fumble.completedRuns, 0)
  assert.deepEqual(fumble.progress, [0, 0])
  assert.ok(fumble.positions && Math.abs(fumble.positions[0] - 1.22) < 1e-9)
  assert.deepEqual([fumble.innings?.striker, fumble.innings?.nonStriker], [1, 2])
  assert.equal(await page.locator('#score').textContent(), '0/0')
}

function checkScore(snapshot: State, byes: number) {
  assert.equal(snapshot.phase, 'dead')
  const { outcome, innings } = snapshot
  assert.ok(outcome && innings)
  assert.equal(outcome.noBall, 1)
  assert.equal(outcome.batRuns, 0)
  assert.equal(outcome.byes, byes)
  assert.equal(outcome.legByes, 0)
  assert.equal(outcome.wide, 0)
  assert.equal(outcome.overthrowRuns ?? 0, 0)
  assert.equal(outcome.penalty ?? 0, 0)
  assert.equal(outcome.wicket, null)
  assert.equal(outcome.completedRuns, byes)
  assert.equal(innings.runs, 1 + byes)
  assert.equal(innings.wickets, 0)
  assert.equal(innings.legalBalls, 0)
  assert.equal(innings.attempts, 1)
  assert.equal(innings.history.length, 1)
  assert.equal(innings.freeHit, true)
  assert.deepEqual(innings.extras, { wide: 0, noBall: 1, byes, legByes: 0, penalty: 0 })
  assert.equal(innings.batting.reduce((runs, batter) => runs + batter.runs, 0), 0)
  assert.equal(innings.bowling.length, 1)
  assert.equal(innings.bowling[0].name, 'Rao')
  assert.equal(innings.bowling[0].runs, 1, 'byes are excluded from the bowler figure')
  assert.equal(innings.bowling[0].balls, 0)
  assert.equal(innings.bowling[0].noBalls, 1)
}

try {
  let observed = false
  await build({
    configLoader: 'native',
    build: { outDir, emptyOutDir: true },
    plugins: [{ name: 'h4-read-only-observer', enforce: 'pre', transform(code, id) {
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
  checkScore(incomplete, 0)
  assert.ok(incomplete.progress?.every(progress => progress > 0 && progress < .5))
  assert.deepEqual([incomplete.innings?.striker, incomplete.innings?.nonStriker], [1, 2])
  assert.equal(await page.locator('#score').textContent(), '1/0')
  assert.equal(await page.locator('#overs').textContent(), '0.0')
  assert.match(await page.locator('#batter-strip').textContent() ?? '', /Hayes \*/)
  console.log('PASS: seed 65 fumbles at tick 44; incomplete run at 82 scores only the no-ball penalty, 1/0 from 0.0 overs.')

  await start(page, 'manual')
  // Holding the naturally collected ball permits a real run. This UI throw
  // breaks the wicket exactly when both assisted runners ground at tick 244.
  await tick(page, 171)
  await page.getByRole('button', { name: /Keeper end/ }).click()
  const before = await tick(page, 243)
  assert.equal(before.completedRuns, 0)
  assert.ok(before.progress?.every(progress => progress > .99 && progress < 1))
  assert.ok(before.positions?.every(position => position > 1.22 && position < 18.9))
  assert.equal(before.innings?.runs, 0)
  assert.equal(await page.locator('#score').textContent(), '0/0')
  const complete = await tick(page, 244)
  checkScore(complete, 1)
  assert.deepEqual(complete.progress, [0, 0])
  assert.ok(complete.positions && Math.abs(complete.positions[0] - 18.9) < 1e-9 && Math.abs(complete.positions[1] - 1.22) < 1e-9)
  assert.deepEqual([complete.innings?.striker, complete.innings?.nonStriker], [2, 1])
  assert.deepEqual(complete.fielding, [{ tick: 171, command: { type: 'throw', end: 'striker' } }])
  assert.equal(await page.locator('#score').textContent(), '2/0')
  assert.equal(await page.locator('#overs').textContent(), '0.0')
  assert.match(await page.locator('#batter-strip').textContent() ?? '', /Reed \*/)
  await page.clock.runFor(500)
  assert.deepEqual((await state(page)).innings, complete.innings, 'later frames do not reapply the delivery')
  console.log('PASS: tick 243 excludes the incomplete run; tick 244 records one bye plus one no-ball, 2/0 with one attempt and zero legal balls.')

  await page.locator('#pause-button').click()
  await page.locator('#scorecard-button').click()
  assert.equal(await page.locator('.scorecard-total').textContent(), '2/0')
  assert.match(await page.locator('.extras-line').textContent() ?? '', /Extras 2\s+·\s+b 1\s+·\s+lb 0\s+·\s+wd 0\s+·\s+nb 1\s+·\s+penalty 0/)
  const bowlingRow = page.locator('.score-section').filter({ has: page.getByRole('heading', { name: 'Bowling', exact: true }) }).locator('tbody tr')
  assert.deepEqual(await bowlingRow.locator('th, td').allTextContents(), ['Rao', '0.0', '0', '1', '0', '—', '0', '1'])
  await page.locator('#scorecard-close').click()
  console.log('PASS: scorecard shows 2/0, extras b 1 / nb 1, and Rao 0.0 overs, 1 conceded, 1 no-ball.')

  await page.locator('#replay-button').click()
  await until(page, snapshot => snapshot.phase === 'flight', 'replay release', 100)
  const replay = await tick(page, 244)
  checkScore(replay, 1)
  assert.deepEqual(replay.outcome, complete.outcome, 'UI replay reconstructs the full authoritative outcome')
  assert.deepEqual(replay.innings, complete.innings, 'UI replay does not score the delivery again')
  assert.deepEqual(replay.fielding, complete.fielding, 'the accepted fielding command survives replay')
  assert.equal(await page.locator('#score').textContent(), '2/0')
  assert.deepEqual(errors, [])
  console.log(`PASS: replay preserves outcome, command history and innings exactly; Chromium ${browser.version()}; no page errors.`)
} finally {
  await browser?.close()
  await server?.close()
  assert.ok(!isAbsolute(temporaryPath) && !temporaryPath.startsWith('..') && temporaryPath.startsWith('ccl-h4-browser-'))
  await rm(outDir, { recursive: true, force: true })
}
