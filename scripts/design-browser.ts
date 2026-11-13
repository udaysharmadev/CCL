import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { chromium, type Page } from 'playwright-core'
import { build, preview } from 'vite'
import type { BowlingControls, BowlingExecution } from '../src/bowling.ts'
import type { Innings } from '../src/rules.ts'

type State = {
  phase: string; elapsed: number; duration: number; timing: boolean; paused: boolean; replaying: boolean
  entrance: number | null; innings: Innings; controls: BowlingControls; execution: BowlingExecution | null
  selection: boolean; bowler: string | null
}
declare global { interface Window { __cclDesignQA: () => State } }

// The temporary production build adds observations only. All changes to play go
// through the real game controls; no writable state hook or patched clock logic.
const observer = `\nwindow.__cclDesignQA = () => ({ phase,elapsed,duration:WINDUP_SECONDS,timing:bowlingHud.timing,paused,replaying,entrance:entranceAge??null,innings:currentInnings(),controls:bowlingHud.controls,execution:record?.options.bowling??null,selection:playerSelection.open,bowler:match?.selectedBowler?.playerId??null });`
const outDir = await mkdtemp(join(tmpdir(), 'ccl-design-'))
const safe = relative(tmpdir(), outDir)
assert.ok(!isAbsolute(safe) && !safe.startsWith('..') && safe.startsWith('ccl-design-'))
const directory = resolve(process.env.CCL_QA_DIR ?? 'docs/visual-evidence/bright-redesign')
await mkdir(directory, { recursive: true })
const checks: string[] = [], errors: string[] = [], evidence: Record<string, unknown> = {}
let server: Awaited<ReturnType<typeof preview>> | undefined, browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
const state = (page: Page) => page.evaluate(() => window.__cclDesignQA())
const checked = (message: string) => { checks.push(message); console.log(`PASS ${message}`) }

async function capture(page: Page, name: string) {
  await page.clock.runFor(34)
  await page.screenshot({ path: resolve(directory, `${name}.png`), animations: 'disabled' })
}
async function reachable(page: Page, selector: string) {
  const control = page.locator(selector).first(); await control.scrollIntoViewIfNeeded()
  const box = await control.boundingBox(), viewport = page.viewportSize()!
  assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, `${selector} reachable at ${viewport.width}×${viewport.height}`)
}
async function fits(page: Page, selector: string) {
  const result = await page.locator(selector).evaluate(node => { const b = node.getBoundingClientRect(); return { x: b.x, y: b.y, right: b.right, bottom: b.bottom, overflow: node.scrollWidth - node.clientWidth } })
  const viewport = page.viewportSize()!
  assert.ok(result.x >= -1 && result.y >= -1 && result.right <= viewport.width + 1 && result.bottom <= viewport.height + 1 && result.overflow <= 1, `${selector} fits at ${viewport.width}×${viewport.height}: ${JSON.stringify(result)}`)
}
async function fullDesktopTeamsVisible(page: Page) {
  const positions = await page.locator('#player-choice-dialog').evaluate(dialog => ({
    ownBottom: dialog.querySelector('.choice-score-table tbody tr:last-child')!.getBoundingClientRect().bottom,
    opponentBottom: dialog.querySelector('.choice-opponent-list li:last-child')!.getBoundingClientRect().bottom,
    footerTop: dialog.querySelector('.player-choice-actions')!.getBoundingClientRect().top,
    overflow: dialog.scrollHeight - dialog.clientHeight,
  }))
  assert.ok(positions.ownBottom <= positions.footerTop + 1 && positions.opponentBottom <= positions.footerTop + 1 && positions.overflow <= 1, `all players visible together on desktop: ${JSON.stringify(positions)}`)
}
async function until(page: Page, predicate: (value: State) => boolean, label: string, step = 120) {
  for (let i = 0; i < 500; i++) { const value = await state(page); if (predicate(value)) return value; await page.clock.runFor(step) }
  throw new Error(`${label}: ${JSON.stringify(await state(page))}`)
}
async function startMatch(page: Page, order: 'bat' | 'bowl') {
  await page.locator('#setup-button').click(); await page.locator('#setup-toss').selectOption(order)
  await page.locator('#setup-overs').selectOption('2'); await page.getByRole('button', { name: 'Start match' }).click()
  await page.locator('#player-choice-dialog[open]').waitFor()
}
async function home(page: Page) {
  if ((await state(page)).selection) await page.locator('#player-choice-dialog').getByRole('button', { name: 'Return to stadium', exact: true }).click()
  else { await page.locator('#pause-button').click(); await page.locator('#overlay').getByRole('button', { name: 'Return to stadium', exact: true }).click() }
  await page.clock.runFor(34); await page.locator('#game[data-view="home"]').waitFor()
}
async function releaseAt(page: Page, progress: number) {
  await page.locator('#bowl-execute').click(); await page.clock.runFor(34)
  let s = await state(page); assert.equal(s.phase, 'windup'); assert.equal(s.timing, true)
  await page.clock.runFor(Math.max(0, (s.duration * progress - s.elapsed) * 1000))
  await page.locator('#bowl-execute').click(); s = await state(page)
  assert.equal(s.timing, false); assert.ok(s.execution)
  return s
}
async function dead(page: Page) {
  const result = await until(page, s => s.phase === 'dead', 'delivery finishes')
  if (await page.locator('#drs-dialog').evaluate((node: HTMLDialogElement) => node.open)) await page.locator('#drs-actions button').first().click()
  return result
}

try {
  await build({ configLoader: 'native', build: { outDir, emptyOutDir: true }, plugins: [{ name: 'design-read-observer', enforce: 'pre', transform(code, id) { if (id.replaceAll('\\', '/').endsWith('/src/main.ts')) return { code: code + observer, map: null } } }] })
  server = await preview({ configLoader: 'native', build: { outDir }, preview: { host: '127.0.0.1', port: 0 } })
  const address = server.httpServer.address(); assert.ok(address && typeof address !== 'string')
  browser = await chromium.launch({ executablePath: process.env.CCL_CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', args: process.env.CCL_SOFTWARE_GPU === '1' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--ignore-gpu-blocklist', '--enable-webgl'] })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
  page.on('pageerror', error => errors.push(error.message)); page.on('console', entry => { if (entry.type() === 'error') errors.push(entry.text()) })
  await page.clock.install({ time: new Date('2026-11-13T00:00:00Z') }); await page.clock.pauseAt(new Date('2026-11-13T00:00:01Z'))
  await page.goto(`http://127.0.0.1:${address.port}/?seed=41`); await page.locator('#solo-button:enabled').waitFor(); await page.evaluate(() => document.fonts.ready)
  await page.locator('#settings-button').click(); await page.locator('#setting-quality').selectOption('low'); await page.keyboard.press('Escape')

  for (const [width, height, label] of [[1440, 900, 'desktop'], [390, 844, 'mobile'], [320, 740, 'small-mobile'], [844, 390, 'landscape']] as const) {
    await page.setViewportSize({ width, height }); await page.clock.runFor(34)
    assert.ok(await page.evaluate(() => [document.documentElement, document.body, document.getElementById('game')!, document.getElementById('home')!].every(node => node.scrollWidth <= node.clientWidth + 1)), `${label} home has no horizontal overflow`)
    await page.locator('#home-button').scrollIntoViewIfNeeded(); await capture(page, `home-${label}`)
    for (const id of ['solo-button', 'training-button', 'setup-button', 'lineup-button', 'six-button', 'online-button', 'how-to-play', 'settings-button']) await reachable(page, `#${id}`)
    for (const [open, dialog, close, controls] of [
      ['setup-button', 'setup-dialog', 'setup-cancel', ['#setup-fielding', '#setup-dialog button[type="submit"]']],
      ['lineup-button', 'lineup-dialog', 'lineup-cancel', ['#lineup-save', '#lineup-chosen .choice:enabled']],
      ['settings-button', 'settings-dialog', 'settings-close', ['#setting-quality']],
      ['how-to-play', 'how-to-play-dialog', 'how-to-play-close', []],
      ['online-button', 'online-dialog', 'close-online', []],
    ] as const) {
      await page.locator(`#${open}`).click(); await fits(page, `#${dialog}`)
      if (dialog === 'lineup-dialog') assert.equal(await page.locator('#lineup-chosen li').count(), 11)
      await capture(page, `${dialog}-${label}`)
      for (const selector of controls) { const first = page.locator(selector).first(); await first.scrollIntoViewIfNeeded(); const box = await first.boundingBox(); assert.ok(box && box.x >= -1 && box.x + box.width <= width + 1, `${selector} is reachable`) }
      await reachable(page, `#${close}`); await page.locator(`#${close}`).click()
    }
    checked(`${label}: home and five menus fit; all entry and exit controls reachable`)
  }

  await page.setViewportSize({ width: 1440, height: 900 }); await startMatch(page, 'bat')
  assert.equal(await page.locator('.choice-score-table tbody tr').count(), 11); assert.equal(await page.locator('.choice-opponent-list li').count(), 11)
  await fullDesktopTeamsVisible(page)
  await capture(page, 'opening-scoreboard-desktop')
  for (const [width, height, label] of [[390, 844, 'mobile'], [320, 740, 'small-mobile'], [844, 390, 'landscape']] as const) {
    await page.setViewportSize({ width, height }); await fits(page, '#player-choice-dialog'); await capture(page, `opening-scoreboard-${label}`)
    await reachable(page, '#player-choice-dialog .player-choice-card:enabled'); await reachable(page, '#player-choice-dialog .secondary')
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.locator('[data-player-id="Singh"]').click(); assert.ok(await page.locator('[data-player-id="Singh"]').isDisabled())
  await page.getByRole('button', { name: 'Change opening striker', exact: true }).click(); assert.ok(await page.locator('[data-player-id="Singh"]').isEnabled())
  await page.locator('[data-player-id="Singh"]').click(); await page.locator('[data-player-id="Mehta"]').click(); await page.clock.runFor(34)
  const openers = await state(page); assert.equal(openers.innings.striker, 3); assert.equal(openers.innings.nonStriker, 1)
  evidence.openers = openers; checked('Scoreboard lists both full XIs, fits four viewports, and opener change preserves the chosen pair')
  await home(page); await startMatch(page, 'bowl'); await capture(page, 'bowling-scoreboard-desktop')
  assert.equal(await page.locator('.choice-score-table tbody tr').count(), 11); assert.equal(await page.locator('.choice-opponent-list li').count(), 11)
  await fullDesktopTeamsVisible(page)
  assert.ok(await page.locator('[data-player-id="Mehta"]').isDisabled()); assert.match(await page.locator('[data-player-id="Mehta"]').getAttribute('aria-label') ?? '', /capability/)
  await page.locator('[data-player-id="Khan"]').click(); await page.clock.runFor(34)
  await page.getByRole('button', { name: 'Around the wicket', exact: true }).click()
  for (const [label, length] of [['Yorker', 1.3], ['Full', 3.2], ['Good', 6.2], ['Short', 9.2], ['Bouncer', 11.4]] as const) {
    await page.locator('.bowling-lengths').getByRole('button', { name: label, exact: true }).click(); assert.equal((await state(page)).controls.length, length)
  }
  await page.locator('.bowling-lengths').getByRole('button', { name: 'Good', exact: true }).click()
  const map = page.locator('#pitch-target-map'); const target = await map.boundingBox(); assert.ok(target)
  await page.mouse.click(target.x + target.width * .65, target.y + target.height * .65); const aimed = await state(page)
  assert.ok(aimed.controls.line > .3 && aimed.controls.line < .5 && aimed.controls.length > 4 && aimed.controls.length < 6)
  await map.focus(); await page.keyboard.press('ArrowRight'); assert.ok((await state(page)).controls.line > aimed.controls.line)
  checked('Bowling capability blocks non-bowlers; all five quick lengths, pitch tapping, and arrow-key fine aiming update real controls')
  for (const [width, height, label] of [[1440, 900, 'desktop'], [390, 844, 'mobile'], [320, 740, 'small-mobile'], [844, 390, 'landscape']] as const) {
    await page.setViewportSize({ width, height }); await page.clock.runFor(34); await fits(page, '#bowling-studio')
    await reachable(page, '#bowl-execute'); await capture(page, `bowling-hud-${label}`)
  }
  await page.setViewportSize({ width: 1440, height: 900 }); await page.clock.runFor(34)

  await page.locator('#bowl-execute').click(); await page.clock.runFor(600)
  let runup = await state(page); assert.equal(runup.phase, 'windup'); assert.equal(runup.timing, true); assert.ok(runup.elapsed > .5)
  assert.ok(await page.locator('#bowl-execute').isEnabled()); assert.ok(await page.locator('#release-meter').isVisible()); await capture(page, 'run-up-live-meter')
  await page.locator('#pause-button').click(); runup = await state(page)
  const meterBefore = await page.locator('#release-meter').getAttribute('aria-valuenow')
  await page.clock.runFor(1200); const frozen = await state(page)
  assert.equal(frozen.paused, true); assert.equal(frozen.elapsed, runup.elapsed); assert.equal(await page.locator('#release-meter').getAttribute('aria-valuenow'), meterBefore)
  await page.locator('#overlay').getByRole('button', { name: 'Resume', exact: true }).click()
  runup = await state(page); await page.clock.runFor((runup.duration * .92 - runup.elapsed) * 1000)
  assert.equal(await page.locator('#bowling-studio').getAttribute('data-release-cue'), 'now')
  await page.locator('#bowl-execute').click(); const perfect = await state(page)
  assert.equal(perfect.timing, false); assert.ok(perfect.execution && perfect.execution.release >= .95); assert.equal(await page.locator('#bowling-studio').getAttribute('data-release'), 'perfect')
  evidence.perfect = perfect; checked('First press starts visible run-up, pause freezes run-up and release meter, and release at 92% earns perfect timing')
  await until(page, s => s.phase === 'flight', 'perfect delivery released', 16); await capture(page, 'perfect-release-flight')
  const first = await dead(page); assert.equal(first.innings.attempts, 1); const original = JSON.stringify(first.innings)
  await page.locator('#pause-button').click(); await page.locator('#replay-button').click()
  await until(page, s => s.replaying && s.phase === 'dead', 'replay completes')
  assert.equal(JSON.stringify((await state(page)).innings), original); await capture(page, 'delivery-replay')
  await page.locator('#next-button').click(); await page.clock.runFor(34); assert.equal((await state(page)).replaying, false)
  checked('Perfect ball scores through the simulation; replay reproduces it without changing innings data')

  const early = await releaseAt(page, .25); assert.ok(early.execution && early.execution.release < .1)
  await dead(page); evidence.early = early; checked('Early release records poor execution and still completes a real delivery')
  await page.locator('#bowl-execute').click(); await page.clock.runFor(34); assert.equal((await state(page)).timing, true)
  await until(page, s => s.phase === 'flight', 'missed release automatically delivers', 50)
  const missed = await state(page); assert.equal(missed.timing, false); assert.equal(missed.execution?.release, 0)
  await dead(page); evidence.missed = missed; await capture(page, 'missed-release-result'); checked('Leaving the release window automatically bowls with zero timing; the innings advances')

  // Let the actual AI deliveries dismiss an unplayed batter. This exercises the
  // replacement gate rather than injecting a wicket or rewriting the innings.
  await home(page); await startMatch(page, 'bat')
  await page.locator('[data-player-id="Singh"]').click(); await page.locator('[data-player-id="Mehta"]').click()
  const wicket = await until(page, s => s.selection || s.innings.complete, 'a real delivery opens the next-batter scoreboard', 180)
  assert.ok(wicket.selection && wicket.innings.selection?.pendingBatter, 'unplayed innings requests an available next batter')
  await capture(page, 'next-batter-scoreboard')
  const incomingEnd = wicket.innings.selection.pendingBatter, survivorEnd = incomingEnd === 'striker' ? 'nonStriker' : 'striker'
  const survivor = wicket.innings[survivorEnd], survivorId = wicket.innings.batting[survivor - 1].playerId!
  assert.ok(await page.locator(`[data-player-id="${survivorId}"]`).isDisabled())
  for (const dismissed of wicket.innings.batting.filter(batter => batter.dismissed)) assert.ok(await page.locator(`[data-player-id="${dismissed.playerId}"]`).isDisabled())
  const incoming = page.locator('#player-choice-dialog .player-choice-card:enabled').first(), incomingId = await incoming.getAttribute('data-player-id')
  await incoming.click(); await page.clock.runFor(34); const replaced = await state(page)
  assert.equal(replaced.innings.selection?.pendingBatter, null); assert.equal(replaced.innings[survivorEnd], survivor)
  assert.equal(replaced.innings.batting[replaced.innings[incomingEnd] - 1].playerId, incomingId)
  evidence.replacement = { wicket, replaced }; checked('Real wicket opens the full next-batter scoreboard; dismissed and surviving batters are disabled and the incoming player preserves the survivor')
  assert.deepEqual(errors, []); checked('No browser page or console errors')
  await writeFile(resolve(directory, 'checks.json'), JSON.stringify({ browser: browser.version(), passed: checks.length, checks, errors, evidence }, null, 2))
  console.log(JSON.stringify({ passed: checks.length, directory }, null, 2))
} catch (error) {
  await writeFile(resolve(directory, 'checks.json'), JSON.stringify({ passed: checks.length, checks, errors, error: String(error), evidence }, null, 2)); throw error
} finally { await browser?.close(); await server?.close(); await rm(outDir, { recursive: true, force: true }) }
