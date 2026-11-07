import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, type Page } from 'playwright-core'
import { preview } from 'vite'

const server = await preview({ configLoader: 'native', preview: { host: '127.0.0.1', port: 0, strictPort: true } })
const address = server.httpServer.address()
if (!address || typeof address === 'string') throw new Error('Preview server did not bind')
const args = ['--ignore-gpu-blocklist', '--enable-webgl']
if (process.platform === 'darwin' && process.env.CCL_CHROME_PATH) args.push('--use-angle=metal')
const browser = await chromium.launch({ executablePath: process.env.CCL_CHROME_PATH, args }).catch(async (error: unknown) => {
  await server.close()
  throw error
})

async function phase(page: Page, value: string) {
  await page.waitForFunction((value) => document.querySelector('#game')?.getAttribute('data-phase') === value, value, { timeout: 20000 })
}
async function screenshot(page: Page, name: string) {
  if (!process.env.CCL_QA_DIR) return
  await mkdir(process.env.CCL_QA_DIR, { recursive: true })
  await page.screenshot({ path: resolve(process.env.CCL_QA_DIR, name) })
}
async function swing(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const started = performance.now()
    const check = () => {
      const meter = document.querySelector<HTMLElement>('#timing')
      const needle = document.querySelector<HTMLElement>('#timing-needle')
      const percent = parseFloat(needle?.style.getPropertyValue('--timing') ?? '')
      if (document.querySelector('#game')?.getAttribute('data-phase') === 'flight' && meter && !meter.hidden && percent >= 47 && percent <= 58) {
        document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }))
        resolve()
      } else if (performance.now() - started > 15000) reject(new Error('Timing cue missed'))
      else requestAnimationFrame(check)
    }
    requestAnimationFrame(check)
  }))
}

try {
  const page = await browser.newPage({ viewport: { width: 907, height: 510 }, deviceScaleFactor: 1 })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const url = `http://127.0.0.1:${address.port}/?seed=41`
  await page.goto(url)
  await page.getByRole('button', { name: 'Longest Six', exact: true }).waitFor()
  await screenshot(page, 'home.png')
  await page.getByRole('button', { name: 'Longest Six', exact: true }).click()
  await page.locator('#pause-button').click()
  await page.locator('#auto-next').click()
  await page.getByRole('button', { name: 'Resume', exact: true }).click()
  for (let attempt = 1; attempt <= 5; attempt++) {
    await phase(page, 'windup')
    if (attempt === 2 || attempt === 3) await page.locator('#loft-toggle').click()
    if (attempt === 1) {
      await page.keyboard.press('Escape')
      await page.getByRole('heading', { name: 'Paused', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Resume', exact: true }).click()
    }
    const before = Number(await page.locator('#score').textContent())
    await swing(page)
    await phase(page, 'dead')
    await page.waitForFunction((attempt) => document.querySelector('#overs')?.textContent === String(attempt), attempt)
    const points = Number(await page.locator('#score').textContent())
    assert.equal(await page.locator('#team-code').textContent(), 'PTS')
    if (attempt === 1) {
      assert.ok(points > 0)
      assert.match(await page.locator('#call-title').textContent() ?? '', /^\d+\.\d m$/)
      await screenshot(page, 'six-distance.png')
      await page.locator('#pause-button').click()
  await page.locator('#replay-button').click()
      await phase(page, 'windup')
      await phase(page, 'dead')
      assert.equal(Number(await page.locator('#score').textContent()), points)
      assert.equal(await page.locator('#overs').textContent(), '1')
      await page.getByRole('button', { name: 'Exit replay', exact: true }).click()
    }
    if (attempt === 2) {
      assert.equal(points, before)
      assert.equal(await page.locator('#call-title').textContent(), 'No valid six')
    }
    if (attempt < 5) await page.getByRole('button', { name: 'Next ball', exact: true }).click()
  }
  const points = await page.locator('#score').textContent()
  await page.getByRole('button', { name: 'See result', exact: true }).click()
  await page.getByRole('heading', { name: 'Challenge complete', exact: true }).waitFor()
  assert.match(await page.locator('#overlay-text').textContent() ?? '', new RegExp(points + ' points'))
  assert.equal(await page.locator('#coins').textContent(), '0')
  await screenshot(page, 'challenge-result.png')
  const best = await page.evaluate(() => localStorage.getItem('ccl.six-best.v1'))
  assert.ok(best && JSON.parse(best).distance > 0)
  await page.reload()
  assert.equal(await page.evaluate(() => localStorage.getItem('ccl.six-best.v1')), best)
  await page.setViewportSize({ width: 800, height: 450 })
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await screenshot(page, 'home-small.png')
  const layout = await page.evaluate(() => {
    const button = document.querySelector('#six-button')!.getBoundingClientRect()
    const footer = document.querySelector('#venue')!.getBoundingClientRect()
    const home = document.querySelector('#home')!.getBoundingClientRect()
    const header = document.querySelector('.topbar')!.getBoundingClientRect()
    return { bottom: button.bottom, footer: footer.top, top: home.top, header: header.bottom }
  })
  assert.ok(layout.bottom < layout.footer, 'Home actions overlap the venue footer')
  assert.ok(layout.top >= layout.header, 'Home content overlaps the header')
  assert.deepEqual(errors, [])
  console.log(`Longest Six browser passed: five balls, ${points} points, ground-hit rejection, replay, pause, saved best and small viewport.`)
} finally {
  await browser.close()
  await server.close()
}
