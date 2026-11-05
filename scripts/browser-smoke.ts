import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, type Page } from 'playwright-core'
import { preview } from 'vite'
import type {} from '../src/main.ts'

const screenshotDirectory = process.env.CCL_QA_DIR
const server = await preview({ preview: { host: '127.0.0.1', port: 0, strictPort: true } })
const address = server.httpServer.address()
if (!address || typeof address === 'string') throw new Error('Preview server did not bind a TCP port')
const url = `http://127.0.0.1:${address.port}/?seed=41`
const hardwareArgs = ['--ignore-gpu-blocklist', '--enable-webgl']
if (process.platform === 'darwin' && process.env.CCL_CHROME_PATH) hardwareArgs.push('--use-angle=metal')
const browser = await chromium.launch({
  executablePath: process.env.CCL_CHROME_PATH,
  args: process.env.CCL_SOFTWARE_GPU === '1'
    ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : hardwareArgs,
}).catch(async (error: unknown) => {
  await server.close()
  throw error
})

async function screenshot(page: Page, name: string) {
  if (!screenshotDirectory) return
  await mkdir(screenshotDirectory, { recursive: true })
  await page.screenshot({ path: resolve(screenshotDirectory, name) })
}

function phase(page: Page, value: string) {
  return page.waitForFunction(
    (expected) => document.querySelector('#game')?.getAttribute('data-phase') === expected,
    value,
    { timeout: 25_000 },
  )
}

async function timedSwing(page: Page) {
  // Route a reproducibly timed Space event through the same keyboard listener
  // used in play. Schedule against the visible timing meter instead of sim state.
  await page.evaluate(() => new Promise<void>((done, reject) => {
    const meter = document.querySelector<HTMLElement>('#timing')
    const needle = document.querySelector<HTMLElement>('#timing-needle')
    const start = performance.now()
    function check() {
      const percent = parseFloat(needle?.style.getPropertyValue('--timing') ?? '')
      if (document.querySelector('#game')?.getAttribute('data-phase') === 'flight' && meter && !meter.hidden && percent >= 47 && percent <= 60) {
        document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }))
        done()
      } else if (performance.now() - start > 12_000) {
        reject(new Error('Visible batting timing cue never reached the contact window'))
      } else requestAnimationFrame(check)
    }
    requestAnimationFrame(check)
  }))
}

try {
  const page = await browser.newPage({ viewport: { width: 907, height: 510 }, deviceScaleFactor: 1 })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (entry) => { if (entry.type() === 'error') errors.push(entry.text()) })
  await page.goto(url)
  assert.equal(await page.title(), 'Crazy Cricket League')
  await page.locator('#stadium canvas').waitFor()
  await screenshot(page, '01-home.png')
  await page.getByRole('button', { name: 'Play Solo Arcade' }).click()
  await page.locator('#pause-button').click()
  await page.locator('#auto-next').click()
  await page.getByRole('button', { name: 'Resume', exact: true }).click()
  await phase(page, 'windup')
  assert.ok(await page.locator('.score-details').isVisible())
  await page.keyboard.press('Escape')
  await page.getByRole('heading', { name: 'Paused' }).waitFor()
  await page.waitForTimeout(450)
  assert.equal(await page.locator('#overs').textContent(), '0.0')
  await page.getByRole('button', { name: 'Resume' }).click()

  let attempts = 0
  while (await page.locator('#overs').textContent() !== '2.0') {
    assert.ok(attempts++ < 20, 'first innings never reached 12 legal balls')
    if (attempts === 2 || attempts === 5) await page.locator('#loft-toggle').click()
    await timedSwing(page)
    await phase(page, 'dead')
    if (attempts === 1) {
      assert.notEqual(await page.locator('#score').textContent(), '0/0', 'first timed drive produced a score or wicket')
      await screenshot(page, '02-delivery-result.png')
      const beforeReplay = await page.locator('#score').textContent()
      const beforeCall = await page.locator('#call-title').textContent()
      await page.locator('#pause-button').click()
      await page.locator('#replay-button').click()
      await phase(page, 'windup')
      await phase(page, 'dead')
      assert.equal(await page.locator('#score').textContent(), beforeReplay)
      assert.equal(await page.locator('#call-title').textContent(), beforeCall)
      await page.getByRole('button', { name: 'Exit replay' }).click()
    }
    if (await page.locator('#overs').textContent() !== '2.0') {
      await page.getByRole('button', { name: 'Next ball' }).click()
      await phase(page, 'windup')
    }
  }
  const battingScore = await page.locator('#score').textContent()
  console.log(`Solo batting: ${battingScore} from 12 legal deliveries (${attempts} attempts).`)
  await page.getByRole('button', { name: 'Innings break' }).click()
  await page.getByRole('button', { name: 'Take the field' }).click()
  await phase(page, 'ready')
  await screenshot(page, '03-bowling.png')
  for (let turn = 0; turn < 18; turn++) {
    const seeResult = page.getByRole('button', { name: 'See result' })
    if (await seeResult.isVisible()) {
      await seeResult.click()
      break
    }
    const delivery = ['Fast', 'Length', 'Yorker', 'Spin'][turn % 4]
    const button = page.getByRole('button', { name: delivery, exact: true })
    await button.click()
    await page.locator(`#deliveries button[aria-label="${delivery}"][aria-pressed="true"]`).waitFor()
    if (turn === 0) {
      const line = page.getByRole('slider', { name: 'Bowling line' })
      await line.focus()
      await line.press('ArrowRight')
      assert.notEqual(await line.inputValue(), '0')
    }
    await page.getByRole('button', { name: 'Bowl', exact: true }).click()
    await phase(page, 'windup')
    await phase(page, 'dead')
  }
  await page.getByRole('dialog').waitFor()
  const result = await page.locator('#overlay-title').textContent()
  assert.match(result ?? '', /Suncrest wins|Ridgebacks win|Match tied/)
  const chasingScore = await page.locator('#score').textContent()
  const coins = Number(await page.locator('#coins').textContent())
  const xp = Number(await page.locator('#xp').textContent())
  assert.ok(coins > 0 && xp > 0, 'match rewards should be applied once')
  await screenshot(page, '04-result.png')
  const telemetry = await page.evaluate(() => window.cclTelemetry())
  assert.equal(telemetry.counts.inningsComplete, 2)
  assert.equal(telemetry.counts.matchComplete, 1)
  assert.ok(telemetry.frameMs?.count && telemetry.inputToFrameMs?.count && telemetry.swingToContactMs?.count)
  await page.reload()
  assert.equal(Number(await page.locator('#coins').textContent()), coins)
  assert.equal(Number(await page.locator('#xp').textContent()), xp)
  assert.deepEqual(errors, [])
  await page.close()

  const touch = await browser.newPage({ viewport: { width: 800, height: 450 }, deviceScaleFactor: 1, hasTouch: true })
  await touch.goto(url)
  await screenshot(touch, '05-small-iframe.png')
  await touch.getByRole('button', { name: 'Training Nets' }).tap()
  await phase(touch, 'flight')
  await touch.touchscreen.tap(450, 245)
  await phase(touch, 'dead')
  assert.equal(await touch.locator('#overs-limit').textContent(), ' / 1 OV')
  assert.equal(await touch.locator('#overs').textContent(), '0.1')
  const touchTelemetry = await touch.evaluate(() => window.cclTelemetry())
  assert.ok(touchTelemetry.inputToFrameMs?.count, 'touch input should enter the same swing path')
  await screenshot(touch, '06-training-touch.png')
  console.log(JSON.stringify({ browser: browser.version(), battingScore, chasingScore, result, coins, xp, telemetry, touchTelemetry }, null, 2))
  console.log('Browser smoke passed: 12-ball innings, AI chase, replay, pause, rewards persistence, and touch training.')
} finally {
  await browser.close()
  await server.close()
}
