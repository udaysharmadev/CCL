import assert from 'node:assert/strict'
import { chromium, type Page } from 'playwright-core'
import { preview } from 'vite'

const server = await preview({ preview: { host: '127.0.0.1', port: 0, strictPort: true } })
const address = server.httpServer.address()
assert.ok(address && typeof address !== 'string')
const args = ['--ignore-gpu-blocklist', '--enable-webgl']
if (process.platform === 'darwin' && process.env.CCL_CHROME_PATH) args.push('--use-angle=metal')
const browser = await chromium.launch({ executablePath: process.env.CCL_CHROME_PATH, args }).catch(async (error: unknown) => {
  await server.close()
  throw error
})

async function phase(page: Page, value: string) {
  await page.waitForFunction((value) => document.querySelector('#game')?.getAttribute('data-phase') === value, value, { timeout: 20000 })
}

try {
  const page = await browser.newPage({ viewport: { width: 800, height: 450 }, deviceScaleFactor: 1 })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const url = `http://127.0.0.1:${address.port}/?seed=41`
  await page.goto(url)
  await page.getByRole('button', { name: 'Match setup' }).click()
  assert.equal(await page.getByLabel('Running').inputValue(), 'manual')
  await page.getByLabel('Running').selectOption('manual')
  await page.screenshot({ path: '/tmp/ccl-manual-setup.png' })
  await page.getByRole('button', { name: /Start match/ }).click()
  await page.locator('#defense-toggle').click()
  await page.mouse.move(400, 240)
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const started = performance.now()
    const check = () => {
      const meter = document.querySelector<HTMLElement>('#timing')
      const percent = parseFloat(document.querySelector<HTMLElement>('#timing-needle')?.style.getPropertyValue('--timing') ?? '')
      if (document.querySelector('#game')?.getAttribute('data-phase') === 'flight' && meter && !meter.hidden && percent >= 48 && percent <= 54) {
        document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }))
        resolve()
      } else if (performance.now() - started > 15000) reject(new Error('Timing cue missed'))
      else requestAnimationFrame(check)
    }
    requestAnimationFrame(check)
  }))
  await phase(page, 'field')
  assert.equal(await page.locator('#score').textContent(), '0/0', 'do not award a run on contact')
  await page.keyboard.press('r')
  await page.locator('#duo-role').filter({ hasText: 'RUNNING · 1 called' }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('heading', { name: 'Paused', exact: true }).waitFor()
  await page.keyboard.press('r')
  await page.getByRole('button', { name: 'Resume', exact: true }).click()
  await phase(page, 'dead')
  assert.equal(await page.locator('#score').textContent(), '1/0')
  assert.equal(await page.locator('#overs').textContent(), '0.1')
  assert.equal(await page.locator('#call-title').textContent(), '1 run')
  const stats = await page.locator('#score-stats').textContent()
  await page.locator('#pause-button').click()
  await page.locator('#replay-button').click()
  await phase(page, 'windup')
  assert.ok(await page.getByRole('button', { name: 'Run / +1', exact: true }).isDisabled())
  await phase(page, 'field')
  await page.keyboard.press('r')
  await page.keyboard.press('c')
  await phase(page, 'dead')
  assert.equal(await page.locator('#score').textContent(), '1/0')
  assert.equal(await page.locator('#overs').textContent(), '0.1')
  assert.equal(await page.locator('#call-title').textContent(), '1 run', 'replay must reproduce recorded running')
  assert.equal(await page.locator('#score-stats').textContent(), stats)
  await page.getByRole('button', { name: 'Exit replay', exact: true }).click()
  await page.screenshot({ path: '/tmp/ccl-solo-manual-single.png' })

  await page.reload()
  await page.getByRole('button', { name: 'Match setup' }).click()
  assert.equal(await page.getByLabel('Running').inputValue(), 'manual')
  await page.getByLabel('Running').selectOption('manual')
  await page.getByRole('button', { name: /Start match/ }).click()
  await page.locator('#duo-controls').waitFor({state:'visible'})
  await page.reload()
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('ccl.solo.v1') ?? '{}')
    delete saved.running
    localStorage.setItem('ccl.solo.v1', JSON.stringify(saved))
  })
  await page.getByRole('button', { name: 'Match setup' }).click()
  assert.equal(await page.getByLabel('Running').inputValue(), 'manual', 'older saved settings migrate to visible Run controls')
  assert.deepEqual(errors, [])
  console.log('Solo manual running browser passed: saved mode, R single, pause input lock, deterministic score-preserving replay, visible Run controls and legacy settings migration at 800×450.')
} finally {
  await browser.close()
  await server.close()
}
