import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { chromium, type Page } from 'playwright-core'
import { build, preview } from 'vite'
import type { DeliveryOutcome, Innings } from '../src/rules.ts'
import type {} from '../src/main.ts'

// Only the temporary build gets an observer. All match choices and shots go
// through the production UI; no simulation state or result is injected.
const outDir = await mkdtemp(join(tmpdir(), 'ccl-match-presentation-'))
const temporaryPath = relative(tmpdir(), outDir)
assert.ok(!isAbsolute(temporaryPath) && !temporaryPath.startsWith('..') && temporaryPath.startsWith('ccl-match-presentation-'))
const directory = resolve(process.env.CCL_QA_DIR ?? 'docs/visual-evidence/match')
let server: Awaited<ReturnType<typeof preview>> | undefined
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined

type MatchState = {
  phase: string
  tick: number | null
  contactTick: number | null
  replaying: boolean
  paused: boolean
  reviewPending: boolean
  innings: Innings | null
  first: Innings | null
  second: Innings | null
  canonical: DeliveryOutcome | null
  shotTick: number | null
}

declare global { interface Window { __cclMatchState: () => MatchState } }

const observer = `
window.__cclMatchState = () => ({
  phase, tick: live?.tick ?? null, contactTick: live?.contactTick ?? null,
  replaying, paused, reviewPending: Boolean(match?.drs.pendingOutcome),
  innings: currentInnings() ?? null, first: match?.first ?? null,
  second: match?.second ?? null, canonical: currentInnings()?.history.at(-1) ?? null,
  shotTick: record?.shot?.tick ?? null,
})
`

const state = (page: Page) => page.evaluate(() => window.__cclMatchState())

async function until(page: Page, predicate: (value: MatchState) => boolean, description: string, quantum = 250) {
  for (let step = 0; step < 240; step++) {
    const value = await state(page)
    if (predicate(value)) return value
    await page.clock.runFor(quantum)
  }
  throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(await state(page))}`)
}

async function screenshot(page: Page, filename: string) {
  await page.screenshot({ path: resolve(directory, filename), animations: 'disabled' })
}

async function callout(page: Page) {
  return page.evaluate(() => ({
    title: document.querySelector('#call-title')?.textContent,
    detail: document.querySelector('#call-detail')?.textContent,
    kicker: document.querySelector('#call-kicker')?.textContent,
    event: document.querySelector<HTMLElement>('#callout')?.dataset.event,
  }))
}

async function playBattingDelivery(page: Page, loft: boolean) {
  if ((await page.locator('#loft-toggle').getAttribute('aria-pressed') === 'true') !== loft) {
    await page.locator('#loft-toggle').click()
  }
  const release = await until(page, value => value.phase === 'flight', 'batting release', 100)
  assert.ok(release.contactTick !== null)
  const contact = await until(page, value => value.tick !== null && value.tick >= release.contactTick!, 'contact tick', 16)
  assert.equal(contact.tick, release.contactTick, 'virtual clock should reach the exact production contact tick')
  await page.keyboard.press('Space')
  const end = await until(page, value => value.phase === 'dead', 'delivery and any review-offer expiry')
  assert.equal(end.shotTick, release.contactTick, 'Space must use the production batting input path')
  return end
}

try {
  await mkdir(directory, { recursive: true })
  let observed = false
  await build({
    configLoader: 'native', build: { outDir, emptyOutDir: true },
    plugins: [{ name: 'match-presentation-observer', enforce: 'pre', transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/src/main.ts')) return
      observed = true
      return { code: code + observer, map: null }
    } }],
  })
  assert.ok(observed)
  server = await preview({ configLoader: 'native', build: { outDir }, preview: { host: '127.0.0.1', port: 0, strictPort: true } })
  const address = server.httpServer.address()
  assert.ok(address && typeof address !== 'string')
  browser = await chromium.launch({
    executablePath: process.env.CCL_CHROME_PATH,
    args: process.env.CCL_SOFTWARE_GPU === '1'
      ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
      : ['--ignore-gpu-blocklist', '--enable-webgl'],
  })
  const gameplayViewport = { width: 800, height: 450 }
  const evidenceViewport = { width: 1280, height: 720 }
  const page = await browser.newPage({ viewport: gameplayViewport, deviceScaleFactor: 1, reducedMotion: 'reduce' })
  const errors: string[] = []
  const warnings: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', entry => {
    if (entry.type() === 'error') errors.push(entry.text())
    if (entry.type() === 'warning') warnings.push(entry.text())
  })
  await page.addInitScript(() => {
    localStorage.setItem('ccl.settings.v1', JSON.stringify({ quality: 'low', reducedMotion: true, sound: false }))
  })
  await page.clock.install({ time: new Date('2026-11-07T12:00:00Z') })
  await page.clock.pauseAt(new Date('2026-11-07T12:00:01Z'))
  const url = `http://127.0.0.1:${address.port}/?seed=41`
  await page.goto(url)
  await page.locator('#solo-button:enabled').waitFor()
  const initialWallet = {
    coins: Number(await page.locator('#coins').textContent()),
    xp: Number(await page.locator('#xp').textContent()),
  }
  await page.getByRole('button', { name: 'Match setup', exact: true }).click()
  await page.locator('#setup-overs').selectOption('2')
  await page.locator('#setup-toss').selectOption('bat')
  await page.locator('#setup-difficulty').selectOption('Club')
  await page.locator('#setup-fielding').selectOption('auto')
  await page.getByRole('button', { name: /Start match/ }).click()
  await page.clock.runFor(32)
  await page.locator('#pause-button').click()
  if (await page.locator('#auto-next').getAttribute('aria-pressed') === 'true') await page.locator('#auto-next').click()
  await page.getByRole('button', { name: 'Resume', exact: true }).click()
  await page.clock.runFor(32)

  let battingAttempts = 0
  let replayVerified = false
  while (!(await state(page)).innings?.complete) {
    assert.ok(battingAttempts++ < 24, 'batting innings should reach two legal overs or all out')
    const settled = await playBattingDelivery(page, battingAttempts % 3 !== 0)
    console.log(`Batting ${battingAttempts}: ${settled.innings?.runs}/${settled.innings?.wickets}, ${settled.innings?.legalBalls} legal balls`)
    if (!replayVerified) {
      const originalCall = await callout(page)
      await screenshot(page, '01-delivery-result.png')
      await page.locator('#pause-button').click()
      await page.locator('#replay-button').click()
      await until(page, value => value.replaying && value.phase === 'dead', 'replay completion')
      assert.deepEqual((await state(page)).innings, settled.innings, 'replay must not score again')
      const replayCall = await callout(page)
      assert.equal(replayCall.kicker, 'REPLAY')
      assert.equal(replayCall.title, originalCall.title)
      assert.equal(replayCall.detail, originalCall.detail)
      assert.equal(replayCall.event, originalCall.event)
      await page.getByRole('button', { name: 'Exit replay', exact: true }).click()
      await page.clock.runFor(32)
      assert.deepEqual(await callout(page), originalCall, 'leaving replay restores the committed presentation')
      replayVerified = true
    }
    if (!(await state(page)).innings?.complete) {
      await page.getByRole('button', { name: 'Next ball', exact: true }).click()
      await page.clock.runFor(32)
    }
  }
  const first = (await state(page)).first!
  assert.ok(first.legalBalls === 12 || first.wickets === 10)
  await page.setViewportSize(evidenceViewport)
  await page.clock.runFor(32)
  await page.getByRole('button', { name: 'Innings break', exact: true }).click()
  assert.equal(await page.locator('#overlay').getAttribute('data-presentation'), 'innings')
  assert.match(await page.locator('#overlay-text').textContent() ?? '', new RegExp(`${first.runs + 1} from 12 legal balls`))
  await screenshot(page, '02-innings-break.png')
  await page.getByRole('button', { name: 'Take the field', exact: true }).click()
  await page.setViewportSize(gameplayViewport)
  await page.clock.runFor(32)
  assert.equal((await state(page)).second?.target, first.runs + 1)
  await screenshot(page, '03-bowling-ready.png')

  let bowlingAttempts = 0
  while (!(await state(page)).innings?.complete) {
    assert.ok(bowlingAttempts++ < 24, 'AI chase must finish')
    const delivery = ['Fast', 'Length', 'Yorker', 'Spin'][(bowlingAttempts - 1) % 4]
    await page.getByRole('button', { name: delivery, exact: true }).click()
    await page.getByRole('button', { name: 'Bowl', exact: true }).click()
    await until(page, value => value.phase === 'dead', 'bowling delivery completion')
    const current = (await state(page)).innings!
    console.log(`Bowling ${bowlingAttempts}: ${current.runs}/${current.wickets}, ${current.legalBalls} legal balls`)
  }
  const second = (await state(page)).second!
  await page.setViewportSize(evidenceViewport)
  await page.clock.runFor(32)
  await page.getByRole('button', { name: 'See result', exact: true }).click()
  assert.equal(await page.locator('#overlay').getAttribute('data-presentation'), 'result')
  const result = await page.locator('#overlay-title').textContent()
  assert.match(result ?? '', /Suncrest wins|Ridgebacks win|Match tied/)
  assert.equal(await page.locator('#overlay-scores > div').count(), 2)
  const wallet = {
    coins: Number(await page.locator('#coins').textContent()),
    xp: Number(await page.locator('#xp').textContent()),
  }
  assert.ok(wallet.coins > initialWallet.coins && wallet.xp > initialWallet.xp)
  await screenshot(page, '04-match-result.png')
  const telemetry = await page.evaluate(() => window.cclTelemetry())
  assert.equal(telemetry.counts.inningsComplete, 2)
  assert.equal(telemetry.counts.matchComplete, 1)
  await page.reload()
  await page.locator('#solo-button:enabled').waitFor()
  assert.equal(Number(await page.locator('#coins').textContent()), wallet.coins)
  assert.equal(Number(await page.locator('#xp').textContent()), wallet.xp)
  assert.deepEqual(errors, [])
  const report = {
    browser: browser.version(), quality: 'low', softwareGPU: process.env.CCL_SOFTWARE_GPU === '1',
    timingMode: 'virtual clock; telemetry durations are not hardware performance measurements',
    gameplayViewport, evidenceViewport, seed: 41, battingAttempts, bowlingAttempts,
    first: { runs: first.runs, wickets: first.wickets, legalBalls: first.legalBalls },
    second: { runs: second.runs, wickets: second.wickets, legalBalls: second.legalBalls },
    result, initialWallet, wallet, replayVerified, rewardsPersisted: true, errors, warnings, telemetry,
  }
  await writeFile(resolve(directory, 'match-verification.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  console.log('Match presentation passed: actual batting innings, canonical replay/exit, innings transition, AI chase, result and persistent rewards.')
} finally {
  await browser?.close()
  await server?.close()
  assert.ok(!isAbsolute(temporaryPath) && !temporaryPath.startsWith('..') && temporaryPath.startsWith('ccl-match-presentation-'))
  await rm(outDir, { recursive: true, force: true })
}
