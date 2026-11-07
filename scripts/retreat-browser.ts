import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { chromium, type Page } from 'playwright-core'
import { build, preview } from 'vite'
import { PITCH_LENGTH, type DeliveryOptions, type ShotInput, type Vec3 } from '../src/cricket.ts'
import type { DeliveryOutcome, Innings } from '../src/rules.ts'

// The temporary build only observes the real controller. The lineup, match,
// shot, running calls and replay are all operated through existing UI inputs.
const outDir = await mkdtemp(join(tmpdir(), 'ccl-h6-browser-'))
const temporaryPath = relative(tmpdir(), outDir)
assert.ok(!isAbsolute(temporaryPath) && !temporaryPath.startsWith('..') && temporaryPath.startsWith('ccl-h6-browser-'))
let server: Awaited<ReturnType<typeof preview>> | undefined
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
let address: { port: number }

type State = {
  phase: string
  tick: number | null
  contactTick: number | null
  progress: [number, number] | null
  positions: [number, number] | null
  returning: boolean | null
  moving: boolean | null
  completedRuns: number | null
  options: DeliveryOptions | null
  outcome: DeliveryOutcome | null
  innings: Innings | null
  ball: Vec3 | null
  shot: { input: ShotInput; tick: number } | null
  runs: { tick: number; running: boolean }[]
}

declare global {
  interface Window { __cclH6State: () => State }
}

const observer = `
window.__cclH6State = () => ({
  phase, tick: live?.tick ?? null, contactTick: live?.contactTick ?? null,
  progress: live ? [live.runnerProgress, live.partnerProgress] : null,
  positions: live ? [...live.runnerPositions] : null,
  returning: live?.runnersReturning ?? null, moving: live?.runnersMoving ?? null,
  completedRuns: live?.completedRuns ?? null, options: live ? {...live.options} : null,
  outcome: live?.outcome ?? null, innings: currentInnings() ?? null,
  ball: live ? {...live.ball} : null, shot: record?.shot ?? null, runs: record?.runs ?? [],
})
`

async function state(page: Page) { return page.evaluate(() => window.__cclH6State()) }

async function until(page: Page, predicate: (snapshot: State) => boolean, description: string, milliseconds = 16) {
  for (let step = 0; step < 900; step++) {
    const snapshot = await state(page)
    if (predicate(snapshot)) return snapshot
    await page.clock.runFor(milliseconds)
  }
  throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(await state(page))}`)
}

async function tick(page: Page, target: number) {
  const snapshot = await until(page, value => value.tick !== null && value.tick >= target, `tick ${target}`)
  assert.equal(snapshot.tick, target)
  return snapshot
}

async function start(page: Page) {
  await page.goto(`http://127.0.0.1:${address.port}/?seed=1`)
  await page.locator('#stadium canvas').waitFor()
  await page.getByRole('button', { name: 'Match setup', exact: true }).click()
  await page.getByRole('button', { name: /Start match/ }).click()
  const release = await until(page, value => value.phase === 'flight', 'ball release', 100)
  assert.ok(release.contactTick !== null)
  assert.deepEqual(release.options?.runnerPace, [1.08, .98])
  assert.equal(release.options?.seed, 1)
  await tick(page, release.contactTick - 12)
  // A 200 ms diagonal mouse swipe naturally selects the on-drive. No shot or
  // delivery state is injected into the simulation.
  await page.mouse.move(500, 360)
  await page.mouse.down()
  await page.mouse.move(500 + Math.sin(.8) * 80, 360 - Math.cos(.8) * 80)
  await tick(page, release.contactTick)
  await page.mouse.up()
  const field = await until(page, value => value.phase === 'field', 'bat contact')
  assert.equal(field.shot?.input.kind, 'on-drive')
  assert.equal(field.shot?.tick, release.contactTick)
  assert.equal(field.completedRuns, 0)
  await page.keyboard.press('r')
  return state(page)
}

function log(label: string, snapshot: State) {
  console.log(`${label}: ${JSON.stringify({ tick: snapshot.tick, progress: snapshot.progress,
    positions: snapshot.positions, returning: snapshot.returning, completedRuns: snapshot.completedRuns,
    ball: snapshot.ball, outcome: snapshot.outcome, runs: snapshot.runs })}`)
}

try {
  let observed = false
  await build({
    configLoader: 'native', build: { outDir, emptyOutDir: true },
    plugins: [{ name: 'h6-read-only-observer', enforce: 'pre', transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/src/main.ts')) return
      observed = true
      return { code: code + observer, map: null }
    } }],
  })
  assert.ok(observed)
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
  await page.goto(`http://127.0.0.1:${address.port}/?seed=1`)
  await page.getByRole('button', { name: 'Dressing room', exact: true }).click()
  for (let count = 0; count < 3; count++) await page.getByRole('button', { name: 'Move Iyer up', exact: true }).click()
  for (let count = 0; count < 2; count++) await page.getByRole('button', { name: 'Move Singh up', exact: true }).click()
  await page.getByRole('button', { name: 'Save XI', exact: true }).click()

  const running = await start(page)
  log('Running started', running)
  const turn = await until(page, value => Boolean(value.progress && value.progress[0] === 1 && value.progress[1] > .96), 'unequal runners ready to turn back')
  assert.ok(turn.progress && turn.progress[1] < 1)
  assert.equal(turn.completedRuns, 0, 'the faster batter alone cannot complete the run')
  await page.getByRole('button', { name: 'Turn back', exact: true }).click()
  log('Turn back', await state(page))
  const firstHome = await until(page, value => Boolean(value.progress && value.progress[0] === 0 && value.progress[1] > .01), 'faster runner home')
  assert.equal(firstHome.returning, true, 'the slower runner must retain the return movement plan')
  assert.equal(firstHome.moving, true)
  log('Faster runner home', firstHome)
  assert.ok(firstHome.tick !== null && firstHome.progress)
  const next = await tick(page, firstHome.tick + 1)
  assert.ok(next.progress && next.progress[1] < firstHome.progress[1], 'the slower runner keeps moving')
  const bothHome = await until(page, value => Boolean(value.progress?.every(progress => progress === 0)), 'both runners home')
  assert.deepEqual(bothHome.positions, [1.22, PITCH_LENGTH - 1.22])
  assert.equal(bothHome.returning, false)
  assert.equal(bothHome.completedRuns, 0)
  log('Both runners home', bothHome)
  const settled = await until(page, value => value.phase === 'dead', 'abandoned run finalization')
  assert.equal(settled.outcome?.completedRuns, 0)
  assert.equal(settled.outcome?.batRuns, 0)
  assert.equal(settled.outcome?.wicket, null)
  assert.equal(settled.innings?.runs, 0)
  assert.deepEqual([settled.innings?.striker, settled.innings?.nonStriker], [1, 2])
  assert.equal(await page.locator('#score').textContent(), '0/0')
  assert.match(await page.locator('#batter-strip').textContent() ?? '', /Iyer \*/)
  await page.clock.runFor(500)
  assert.deepEqual((await state(page)).innings, settled.innings)
  log('Abandoned run finalized', settled)

  await page.locator('#pause-button').click()
  await page.locator('#replay-button').click()
  await until(page, value => value.phase === 'flight', 'replay release', 100)
  const replay = await tick(page, firstHome.tick)
  assert.deepEqual(replay.progress, firstHome.progress)
  assert.deepEqual(replay.positions, firstHome.positions)
  assert.equal(replay.returning, true)
  const replayEnd = await until(page, value => value.phase === 'dead', 'replay end')
  assert.deepEqual(replayEnd.outcome, settled.outcome)
  assert.deepEqual(replayEnd.innings, settled.innings)

  await start(page)
  const single = await until(page, value => value.completedRuns === 1, 'safe completed single')
  assert.deepEqual(single.progress, [0, 0])
  const safe = await until(page, value => value.phase === 'dead', 'single finalization')
  assert.equal(safe.outcome?.completedRuns, 1)
  assert.equal(safe.outcome?.batRuns, 1)
  assert.equal(safe.outcome?.wicket, null)
  assert.equal(safe.innings?.runs, 1)
  assert.deepEqual([safe.innings?.striker, safe.innings?.nonStriker], [2, 1])
  assert.equal(await page.locator('#score').textContent(), '1/0')
  assert.match(await page.locator('#batter-strip').textContent() ?? '', /Singh \*/)
  log('Safe single finalized', safe)

  await start(page)
  assert.ok(settled.tick !== null)
  await tick(page, settled.tick - 110)
  assert.equal((await state(page)).completedRuns, 1)
  await page.keyboard.press('r')
  await tick(page, settled.tick - 30)
  await page.getByRole('button', { name: 'Turn back', exact: true }).click()
  const runOut = await until(page, value => value.phase === 'dead', 'run-out during the second-run retreat')
  assert.equal(runOut.outcome?.wicket, 'run-out', 'turning back does not confer instant safety')
  assert.equal(runOut.outcome?.completedRuns, 1, 'only the fully grounded first run is counted')
  assert.equal(runOut.outcome?.batRuns, 1)
  assert.equal(runOut.innings?.runs, 1)
  assert.equal(runOut.innings?.wickets, 1)
  assert.equal(runOut.outcome?.dismissedBatter, 'nonStriker')
  assert.deepEqual([runOut.innings?.striker, runOut.innings?.nonStriker], [3, 1])
  assert.ok(runOut.progress?.every(progress => progress > 0 && progress < 1))
  assert.equal(await page.locator('#score').textContent(), '1/1')
  log('Second-run retreat run-out', runOut)
  assert.deepEqual(errors, [])
  console.log(`H6 browser passed: real unequal-speed lineup, physical swipe, coordinated retreat, grounding, score/strike, replay, safe single, second-run retreat run-out; Chromium ${browser.version()}; no page errors.`)
} finally {
  await browser?.close()
  await server?.close()
  assert.ok(!isAbsolute(temporaryPath) && !temporaryPath.startsWith('..') && temporaryPath.startsWith('ccl-h6-browser-'))
  await rm(outDir, { recursive: true, force: true })
}
