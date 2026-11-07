import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { chromium, type Page } from 'playwright-core'
import { build, preview } from 'vite'
import type { DeliveryOptions } from '../src/cricket.ts'
import type { DeliveryOutcome } from '../src/rules.ts'

// A temporary production build adds only a read-only state observer. Match
// setup, bowling, fielding, scoring and replay all use the real UI/controller.
// Solo's bowling seed offset turns this URL seed into delivery seed 45; Rookie
// AI leaves that ball naturally because its seed is divisible by five.
const matchSeed = 4293693210
const outDir = await mkdtemp(join(tmpdir(), 'ccl-h3-browser-'))
const temporaryPath = relative(tmpdir(), outDir)
assert.ok(!isAbsolute(temporaryPath) && !temporaryPath.startsWith('..') && temporaryPath.startsWith('ccl-h3-browser-'))
let server: Awaited<ReturnType<typeof preview>> | undefined
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined

type State = {
  phase: string
  tick: number | null
  parried: boolean | null
  contact: string | null
  completedRuns: number | null
  progress: number[] | null
  positions: number[] | null
  options: DeliveryOptions | null
  outcome: DeliveryOutcome | null
  runs: number | null
  wickets: number | null
  striker: number | null
  nonStriker: number | null
  attempts: number | null
}

declare global {
  interface Window { __cclH3State: () => State }
}

const observer = `
window.__cclH3State = () => ({
  phase, tick: live?.tick ?? null, parried: live?.parried ?? null,
  contact: live?.contact ?? null, completedRuns: live?.completedRuns ?? null,
  progress: live ? [live.runnerProgress, live.partnerProgress] : null,
  positions: live ? [...live.runnerPositions] : null,
  options: live ? {...live.options} : null, outcome: live?.outcome ?? null,
  runs: currentInnings()?.runs ?? null, wickets: currentInnings()?.wickets ?? null,
  striker: currentInnings()?.striker ?? null, nonStriker: currentInnings()?.nonStriker ?? null,
  attempts: currentInnings()?.attempts ?? null,
})
`

async function state(page: Page) { return page.evaluate(() => window.__cclH3State()) }

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
    (input as HTMLInputElement).value = '0.63'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.locator('#next-button').click()
  await until(page, value => value.phase === 'flight', 'ball release', 100)
  const snapshot = await tick(page, 46)
  assert.equal(snapshot.options?.seed, 45)
  assert.equal(snapshot.options?.runningMode, undefined, 'AI uses assisted running')
  assert.equal(snapshot.options?.line, .4)
  assert.equal(snapshot.options?.effort, .63)
  assert.equal(snapshot.parried, false)
  assert.equal(snapshot.completedRuns, 0)
  assert.equal(snapshot.runs, 0)
  const fumble = await tick(page, 47)
  assert.equal(fumble.parried, true)
  assert.equal(fumble.contact, 'miss')
  assert.equal(fumble.completedRuns, 0)
  assert.deepEqual(fumble.progress, [0, 0])
  assert.ok(fumble.positions && Math.abs(fumble.positions[0] - 1.22) < 1e-9)
  assert.deepEqual([fumble.striker, fumble.nonStriker], [1, 2])
  assert.equal(await page.locator('#score').textContent(), '0/0')
}

let address: { port: number }
try {
  let observed = false
  await build({
    configLoader: 'native',
    build: { outDir, emptyOutDir: true },
    plugins: [{ name: 'h3-read-only-observer', enforce: 'pre', transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/src/main.ts')) return
      observed = true
      return { code: code + observer, map: null }
    } }],
  })
  assert.ok(observed, 'instrument the real controller without replacing its behavior')
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
  const incomplete = await tick(page, 85)
  assert.equal(incomplete.phase, 'dead')
  assert.ok(incomplete.progress?.every(progress => progress > 0 && progress < .5))
  assert.equal(incomplete.completedRuns, 0)
  assert.equal(incomplete.outcome?.byes, 0)
  assert.equal(incomplete.runs, 0)
  assert.equal(incomplete.wickets, 0)
  assert.deepEqual([incomplete.striker, incomplete.nonStriker], [1, 2])
  assert.equal(await page.locator('#score').textContent(), '0/0')
  assert.match(await page.locator('#batter-strip').textContent() ?? '', /Hayes \*/)
  console.log('PASS: natural keeper fumble at tick 47; incomplete run at tick 85 scores zero and retains strike.')

  await start(page, 'manual')
  // The keeper catches the loose ball and holds it. This UI throw reaches the
  // wicket on tick 247, the exact tick both assisted runners reach the crease.
  await tick(page, 174)
  await page.getByRole('button', { name: /Keeper end/ }).click()
  const before = await tick(page, 246)
  assert.equal(before.completedRuns, 0)
  assert.ok(before.progress?.every(progress => progress > .99 && progress < 1))
  assert.ok(before.positions?.every(position => position > 1.22 && position < 18.9))
  assert.equal(before.runs, 0)
  assert.equal(await page.locator('#score').textContent(), '0/0')
  const complete = await tick(page, 247)
  assert.equal(complete.phase, 'dead')
  assert.equal(complete.completedRuns, 1)
  assert.deepEqual(complete.progress, [0, 0])
  assert.ok(complete.positions && Math.abs(complete.positions[0] - 18.9) < 1e-9 && Math.abs(complete.positions[1] - 1.22) < 1e-9)
  assert.equal(complete.outcome?.byes, 1)
  assert.equal(complete.outcome?.wicket, null)
  assert.equal(complete.runs, 1)
  assert.deepEqual([complete.striker, complete.nonStriker], [2, 1])
  assert.equal(await page.locator('#score').textContent(), '1/0')
  assert.match(await page.locator('#batter-strip').textContent() ?? '', /Reed \*/)
  await page.clock.runFor(500)
  assert.equal((await state(page)).attempts, 1)
  assert.equal(await page.locator('#score').textContent(), '1/0')
  console.log('PASS: tick 246 remains 0/0; tick 247 grounds both batters, scores one bye and rotates strike to Reed once.')

  await page.locator('#pause-button').click()
  await page.locator('#replay-button').click()
  await until(page, snapshot => snapshot.phase === 'flight', 'replay release', 100)
  await tick(page, 247)
  assert.equal((await state(page)).completedRuns, 1)
  assert.equal((await state(page)).attempts, 1)
  assert.equal(await page.locator('#score').textContent(), '1/0')
  assert.deepEqual(errors, [])
  console.log(`PASS: replay retains one completion and one scored delivery; Chromium ${browser.version()}; no page errors.`)
} finally {
  await browser?.close()
  await server?.close()
  assert.ok(!isAbsolute(temporaryPath) && !temporaryPath.startsWith('..') && temporaryPath.startsWith('ccl-h3-browser-'))
  await rm(outDir, { recursive: true, force: true })
}
