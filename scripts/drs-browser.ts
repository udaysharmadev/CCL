import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { chromium, type Page } from 'playwright-core'
import { build, preview } from 'vite'

// Natural caught-edge and LBW reviews, driven through the timing meter and UI.
// Virtual browser time makes the review deadline and delivery progression exact.
const outDir = await mkdtemp(join(tmpdir(), 'ccl-drs-browser-'))
let server: Awaited<ReturnType<typeof preview>> | undefined
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined

async function advanceUntil(page: Page, check: () => Promise<boolean>, description: string) {
  for (let step = 0; step < 300; step++) {
    if (await check()) return
    await page.clock.runFor(100)
  }
  throw new Error(`Timed out waiting for ${description}`)
}

async function earlySwing(page: Page) {
  await advanceUntil(page, async () => await page.locator('#game').getAttribute('data-phase') === 'flight', 'delivery release')
  let percent = 0
  for (let step = 0; step < 80; step++) {
    percent = await page.locator('#timing-needle').evaluate((needle) => parseFloat((needle as HTMLElement).style.getPropertyValue('--timing')))
    if (percent >= 29) break
    await page.clock.runFor(16)
  }
  assert.ok(percent >= 29 && percent <= 32, `early swing meter: ${percent}`)
  // Closing a pause dialog restores focus to Pause, where Space is intentionally
  // a button activation. Put keyboard input back on the game before swinging.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('Space')
  try {
    await advanceUntil(page, async () => {
      if (await page.locator('#review-hint').isVisible()) return true
      assert.equal(await page.locator('#overlay').evaluate((overlay) => (overlay as HTMLDialogElement).open), false, 'batting must remain unpaused')
      assert.equal(await page.locator('#overs').textContent(), '0.0', 'the first delivery must offer a review before it is scored')
      return false
    }, 'first-delivery caught-edge review offer')
  } catch (error) {
    console.error(await page.evaluate((swingPercent) => ({
      swingPercent, phase: document.querySelector('#game')?.getAttribute('data-phase'),
      view: document.querySelector('#game')?.getAttribute('data-view'),
      score: document.querySelector('#score')?.textContent,
      overs: document.querySelector('#overs')?.textContent,
      title: document.querySelector('#call-title')?.textContent,
      detail: document.querySelector('#call-detail')?.textContent,
      hint: document.querySelector('#review-hint')?.textContent,
      hintHidden: document.querySelector<HTMLElement>('#review-hint')?.hidden,
      reportOpen: document.querySelector<HTMLDialogElement>('#drs-dialog')?.open,
      overlayOpen: document.querySelector<HTMLDialogElement>('#overlay')?.open,
      activeElement: document.activeElement?.id,
    }), percent))
    throw error
  }
}

async function freshScore(page: Page) {
  await page.clock.runFor(20)
  assert.equal(await page.locator('#score').textContent(), '0/0')
  assert.equal(await page.locator('#overs').textContent(), '0.0')
  assert.equal(await page.locator('#review-hint').isVisible(), false)
  assert.equal(await page.locator('#drs-dialog').isVisible(), false)
}

async function review(page: Page, keyboard = false) {
  // Training can offer a review while still in flight; use its supported V
  // shortcut because the existing swipe surface captures pointer clicks there.
  if (keyboard) await page.keyboard.press('v')
  else await page.locator('#review-hint').click()
  const state = await page.evaluate(() => ({
    reportOpen: document.querySelector<HTMLDialogElement>('#drs-dialog')?.open,
    reportTitle: document.querySelector('#drs-title')?.textContent,
    reportActions: document.querySelector('#drs-actions')?.innerHTML,
    hintHidden: document.querySelector<HTMLElement>('#review-hint')?.hidden,
    hint: document.querySelector('#review-hint')?.textContent,
    overlayOpen: document.querySelector<HTMLDialogElement>('#overlay')?.open,
    overlayTitle: document.querySelector('#overlay-title')?.textContent,
    phase: document.querySelector('#game')?.getAttribute('data-phase'),
    score: document.querySelector('#score')?.textContent,
  }))
  assert.equal(state.reportOpen, true, JSON.stringify(state))
}

async function trainingReview(page: Page) {
  // Training's unrestricted field does not catch the first-ball edge used in
  // Solo. At seed 0 its second unswung delivery is a reproducible LBW instead.
  await page.locator('#pause-button').click()
  if (await page.locator('#auto-next').getAttribute('aria-pressed') === 'true') await page.locator('#auto-next').click()
  await page.getByRole('button', { name: 'Resume', exact: true }).click()
  await advanceUntil(page, async () => await page.locator('#game').getAttribute('data-phase') === 'dead', 'first Training dot ball')
  assert.equal(await page.locator('#score').textContent(), '0/0')
  assert.equal(await page.locator('#overs').textContent(), '0.1')
  await page.getByRole('button', { name: 'Next ball', exact: true }).click()
  await page.clock.runFor(20)
  await advanceUntil(page, async () => {
    if (await page.locator('#review-hint').isVisible()) return true
    assert.equal(await page.locator('#overs').textContent(), '0.1', 'the second Training delivery must offer an LBW review')
    return false
  }, 'second Training ball LBW offer')
  assert.match(await page.locator('#review-hint').textContent() ?? '', /2 left/)
  await review(page, true)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.clock.runFor(20)
  assert.equal(await page.locator('#score').textContent(), '0/1')
  assert.equal(await page.locator('#overs').textContent(), '0.2')
}

try {
  const bundle = { configLoader: 'native', build: { outDir, emptyOutDir: true }, logLevel: 'error' } as const
  await build(bundle)
  server = await preview({ ...bundle, preview: { host: '127.0.0.1', port: 0, strictPort: true } })
  const address = server.httpServer.address()
  assert.ok(address && typeof address !== 'string')
  browser = await chromium.launch({
    executablePath: process.env.CCL_CHROME_PATH,
    args: process.env.CCL_SOFTWARE_GPU === '1'
      ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
      : ['--ignore-gpu-blocklist', '--enable-webgl'],
  })
  const page = await browser.newPage({ viewport: { width: 907, height: 510 }, deviceScaleFactor: 1 })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    localStorage.setItem('ccl.settings.v1', JSON.stringify({ quality: 'low', reducedMotion: true, sound: false }))
  })
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') })
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'))
  await page.goto(`http://127.0.0.1:${address.port}/?seed=0`)
  await page.locator('#stadium canvas').waitFor()

  await page.getByRole('button', { name: 'Play Solo Arcade', exact: true }).click()
  await earlySwing(page)
  assert.match(await page.locator('#review-hint').textContent() ?? '', /2 left/)
  await page.locator('#pause-button').click()
  await page.getByRole('button', { name: 'Return to stadium', exact: true }).click()
  await page.clock.runFor(20)
  await page.getByRole('button', { name: 'Play Solo Arcade', exact: true }).click()
  await freshScore(page)
  await page.locator('#pause-button').click()
  await page.clock.runFor(6100)
  assert.equal(await page.locator('#score').textContent(), '0/0', 'old pending review cannot score in B')
  await page.getByRole('button', { name: 'Resume', exact: true }).click()
  await earlySwing(page)
  assert.match(await page.locator('#review-hint').textContent() ?? '', /2 left/)
  await review(page)
  assert.equal(await page.locator('#drs-title').textContent(), 'The decision stands')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.clock.runFor(20)
  assert.equal(await page.locator('#score').textContent(), '0/1')
  assert.equal(await page.locator('#overs').textContent(), '0.1')
  console.log('PASS: pending Solo review abandoned; same-page B stays 0/0 past A deadline and reviews its own delivery.')

  await page.locator('#pause-button').click()
  await page.getByRole('button', { name: 'Return to stadium', exact: true }).click()
  await page.clock.runFor(20)
  await page.getByRole('button', { name: 'Play Solo Arcade', exact: true }).click()
  await earlySwing(page)
  await review(page)
  // A real background visibility change calls the application's pause listener.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
    delete (document as unknown as Record<string, unknown>).hidden
  })
  await page.getByRole('button', { name: 'Return to stadium', exact: true }).click()
  await page.clock.runFor(20)
  await page.getByRole('button', { name: 'Training Nets', exact: true }).click()
  await freshScore(page)
  await trainingReview(page)
  console.log('PASS: abandoning an open report clears the modal; new Training review starts with two reviews and scores once.')

  for (let ball = 2; await page.locator('#overs').textContent() !== '1.0'; ball++) {
    assert.ok(ball < 15, 'training must finish six legal deliveries')
    await page.getByRole('button', { name: 'Next ball', exact: true }).click()
    await page.clock.runFor(20)
    await advanceUntil(page, async () => await page.locator('#game').getAttribute('data-phase') === 'dead', `training ball ${ball + 1}`)
    console.log(`Training completion progress: ${await page.locator('#overs').textContent()} overs.`)
  }
  assert.equal(await page.locator('#overs').textContent(), '1.0')
  await page.getByRole('button', { name: 'See result', exact: true }).click()
  await page.getByRole('button', { name: 'Practice again', exact: true }).click()
  await freshScore(page)
  await trainingReview(page)
  assert.deepEqual(errors, [])
  console.log(`PASS: completed Training -> Practice again in same page; fresh reviews work. Chromium ${browser.version()}; no page errors.`)
} finally {
  await browser?.close()
  await server?.close()
  const tempPath = relative(tmpdir(), outDir)
  assert.ok(!isAbsolute(tempPath) && !tempPath.startsWith('..') && tempPath.startsWith('ccl-drs-browser-'))
  await rm(outDir, { recursive: true, force: true })
}
