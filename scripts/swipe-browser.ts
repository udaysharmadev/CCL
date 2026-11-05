import assert from 'node:assert/strict'
import { chromium, type Page } from 'playwright-core'
import { preview } from 'vite'
import type {} from '../src/main.ts'

const server = await preview({ preview: { host: '127.0.0.1', port: 0, strictPort: true } })
const address = server.httpServer.address()
assert.ok(address && typeof address !== 'string')
const url = `http://127.0.0.1:${address.port}/?seed=41`
const args = ['--ignore-gpu-blocklist', '--enable-webgl']
if (process.platform === 'darwin' && process.env.CCL_CHROME_PATH) args.push('--use-angle=metal')
const browser = await chromium.launch({ executablePath: process.env.CCL_CHROME_PATH, args }).catch(async (error: unknown) => {
  await server.close()
  throw error
})
const errors: string[] = []

async function phase(page: Page, expected: string, timeout = 20000) {
  await page.waitForFunction((expected) => document.querySelector('#game')?.getAttribute('data-phase') === expected, expected, { timeout })
}
async function contactWindow(page: Page) {
  await page.waitForFunction(() => {
    const value = parseFloat(document.querySelector<HTMLElement>('#timing-needle')?.style.getPropertyValue('--timing') ?? '')
    // Release as the needle crosses the middle. The window stops short of the
    // late edge so the touch is never dispatched after the bat has passed.
    return document.querySelector('#game')?.getAttribute('data-phase') === 'flight' && value >= 47 && value <= 52
  }, undefined, { polling: 'raf', timeout: 15000 })
}

/**
 * Headless Chromium delivers a synthetic gesture with an unbounded delay, so a
 * release can occasionally arrive after the ball has passed the bat. The
 * gesture is replayed until it lands, which keeps the check about real input.
 */
async function landGesture(page: Page, gesture: () => Promise<void>) {
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.waitForFunction(() => {
      const state = document.querySelector('#game')?.getAttribute('data-phase')
      return state === 'windup' || state === 'ready'
    }, undefined, { timeout: 20000 })
    await gesture()
    try {
      await phase(page, 'field', 4000)
      return true
    } catch {
      // The gesture was delivered too late. Wait for the next delivery.
      await phase(page, 'dead', 8000)
    }
  }
  return false
}

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (e) => { if (e.type() === 'error') errors.push(e.text()) })
  await page.goto(url)
  await page.getByRole('button', { name: 'Training Nets', exact: true }).click()
  assert.equal(await page.locator('#shot-options').count(), 0, 'techniques come only from swipes')
  assert.equal(await page.locator('.wallet').isVisible(), false, 'match HUD hides career panels')
  const landed = await landGesture(page, async () => {
    await page.mouse.move(640, 490)
    await page.mouse.down()
    await page.mouse.move(640, 290, { steps: 6 })
    assert.ok(await page.locator('#swipe-trail').evaluate((node) => node.classList.contains('drawing')))
    await contactWindow(page)
    await page.mouse.up()
  })
  assert.ok(landed, 'a physical swipe must reach the bat')
  const mouse = await page.evaluate(() => window.cclTelemetry())
  assert.equal(mouse.counts.swipe, 1)
  assert.equal(mouse.counts.swipeCommitted, 1)
  assert.equal(await page.locator('#shot-feedback').getAttribute('data-tone'), 'hit')
  await page.screenshot({ path: '/tmp/ccl-swipe-contact.png' })
  await phase(page, 'dead')
  assert.notEqual(await page.locator('#score').textContent(), '0/0', 'timed physical swipe must produce contact and a real result')
  const score = await page.locator('#score').textContent()
  const decision = await page.locator('#call-title').textContent()
  const oversBeforeReplay = await page.locator('#overs').textContent()
  await page.screenshot({ path: '/tmp/ccl-swipe-result.png' })
  await page.locator('#pause-button').click()
  await page.locator('#replay-button').click()
  await phase(page, 'field')
  await phase(page, 'dead')
  assert.equal(await page.locator('#score').textContent(), score)
  assert.equal(await page.locator('#call-title').textContent(), decision)
  await page.getByRole('button', { name: 'Exit replay', exact: true }).click()
  await phase(page, 'windup')
  assert.equal(await page.locator('#overs').textContent(), oversBeforeReplay, 'auto next must not add a ball before adjudication')
  await context.close()

  const touchContext = await browser.newContext({ viewport: { width: 800, height: 450 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 })
  const touch = await touchContext.newPage()
  touch.on('pageerror', (e) => errors.push(e.message))
  await touch.goto(url)
  await touch.getByRole('button', { name: 'Training Nets', exact: true }).tap()
  const cdp = await touchContext.newCDPSession(touch)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 420, y: 280, id: 3 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
  assert.equal((await touch.evaluate(() => window.cclTelemetry())).counts.swipe, undefined, 'a canceled gesture must not become a shot')
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 420, y: 280, id: 1 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 420, y: 180, id: 1 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  assert.match(await touch.locator('#shot-feedback').textContent() ?? '', /Too early/)
  assert.equal((await touch.evaluate(() => window.cclTelemetry())).counts.swipeCommitted, undefined)
  await touch.locator('#loft-toggle').tap()
  await touch.waitForFunction(() => document.querySelector('#loft-toggle')?.getAttribute('aria-pressed') === 'true')
  const touched = await landGesture(touch, async () => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 420, y: 295, id: 2 }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 420, y: 105, id: 2 }] })
    await contactWindow(touch)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  })
  assert.ok(touched, 'a physical touch must reach the bat')
  await touch.screenshot({ path: '/tmp/ccl-touch-loft.png' })
  await phase(touch, 'dead')
  const mobile = await touch.evaluate(() => window.cclTelemetry())
  // One gesture is the cancelled one, the rest are the retried swipes.
  assert.ok((mobile.counts.swipe ?? 0) >= 2)
  assert.ok((mobile.counts.swipeCommitted ?? 0) >= 1)
  assert.notEqual(await touch.locator('#call-title').textContent(), '')
  assert.notEqual(await touch.locator('#score').textContent(), '0/0', 'the touch must produce a real result')
  await touch.screenshot({ path: '/tmp/ccl-touch-six.png' })
  assert.deepEqual(errors, [])
  console.log(`Swipe browser passed: mouse swipe ${decision} (${score}), physical touch LOFT six at 800×450, early-release feedback, visible contact, score-preserving replay and automatic next ball. No page or shader errors.`)
} finally {
  await browser.close()
  await server.close()
}
