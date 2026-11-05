import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { preview } from 'vite'
import type {} from '../src/platform.ts'

declare global {
  interface Window { phase2SdkEvents: string[] }
}

const server = await preview({ preview: { host: '127.0.0.1', port: 0, strictPort: true } })
const address = server.httpServer.address()
if (!address || typeof address === 'string') throw new Error('Preview server did not bind')
const executablePath = process.env.CCL_CHROME_PATH
const args = ['--ignore-gpu-blocklist', '--enable-webgl']
if (process.platform === 'darwin' && executablePath) args.push('--use-angle=metal')
const browser = await chromium.launch({ executablePath, args }).catch(async (error: unknown) => {
  await server.close()
  throw error
})

try {
  const page = await browser.newPage({ viewport: { width: 907, height: 510 }, deviceScaleFactor: 1 })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    const events: string[] = []
    window.phase2SdkEvents = events
    window.CrazyGames = { SDK: {
      environment: 'crazygames',
      async init() { events.push('init') },
      game: {
        loadingStart: () => { events.push('loadingStart') },
        loadingStop: () => { events.push('loadingStop') },
        gameplayStart: () => { events.push('gameplayStart') },
        gameplayStop: () => { events.push('gameplayStop') },
      },
      data: {
        getItem: (key) => localStorage.getItem('sdk:' + key),
        setItem: (key, value) => localStorage.setItem('sdk:' + key, value),
      },
    } }
  })
  await page.goto(`http://127.0.0.1:${address.port}/?seed=41`)
  await page.getByRole('button', { name: 'Dressing room' }).click()
  await page.locator('#lineup-dialog canvas').waitFor()
  await page.screenshot({ path: '/tmp/ccl-dressing-room.png' })
  assert.equal(await page.locator('#lineup-chosen li').count(), 11)
  assert.equal(await page.locator('#lineup-bench li').count(), 4)
  await page.getByRole('button', { name: 'Bench Mehta' }).click()
  assert.ok(await page.getByRole('button', { name: 'Save XI' }).isDisabled())
  await page.getByRole('button', { name: 'Select Roy' }).click()
  await page.getByRole('button', { name: 'Move Singh up' }).click()
  await page.getByRole('button', { name: 'Save XI' }).click()
  await page.reload()
  await page.getByRole('button', { name: 'Dressing room' }).click()
  assert.match(await page.locator('#lineup-chosen li').first().textContent() ?? '', /Singh/)
  assert.match(await page.locator('#lineup-chosen li').last().textContent() ?? '', /Roy/)
  await page.locator('#lineup-cancel').click()
  assert.deepEqual(await page.evaluate(() => window.phase2SdkEvents), ['init', 'loadingStart', 'loadingStop'])

  await page.getByRole('button', { name: 'Match setup' }).click()
  await page.getByLabel('Overs per side').selectOption('20')
  await page.locator('#setup-venue').selectOption('harbor')
  await page.locator('#setup-pitch').selectOption('green')
  await page.locator('#setup-weather').selectOption('breezy')
  await page.getByLabel('Field preset').selectOption('boundary')
  await page.getByLabel('AI difficulty').selectOption('Legend')
  await page.getByLabel('Innings order').selectOption('bowl')
  await page.getByRole('button', { name: /Start match/ }).click()
  await page.waitForFunction(() => document.querySelector('#game')?.getAttribute('data-view') === 'solo')
  assert.equal(await page.locator('#overs-limit').textContent(), ' / 20 OV')
  assert.match(await page.locator('#match-id').textContent() ?? '', /HARBOR REACH/)
  assert.match(await page.locator('#score-stats').textContent() ?? '', /Rao/)
  assert.equal(await page.locator('#field-select').inputValue(), 'boundary')
  await page.locator('#field-map-button').click()
  await page.locator('#field-select').selectOption('attack')
  await page.locator('#field-close').click()
  await page.getByLabel('Bowling group').selectOption('1')
  await page.getByRole('button', { name: 'Bouncer' }).click()
  await page.getByRole('button', { name: 'Bowl', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('#countdown')?.textContent?.includes('BOUNCER'))
  await page.waitForFunction(() => document.querySelector('#game')?.getAttribute('data-phase') === 'dead')
  assert.equal(await page.locator('#overs').textContent(), '0.1')
  await page.keyboard.press('Escape')
  await page.getByRole('heading', { name: 'Paused' }).waitFor()
  await page.getByRole('button', { name: 'Resume', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.phase2SdkEvents),
    ['init', 'loadingStart', 'loadingStop', 'gameplayStart', 'gameplayStop', 'gameplayStart', 'gameplayStop', 'gameplayStart'])
  const storage = await page.evaluate(() => ({
    setup: JSON.parse(localStorage.getItem('sdk:ccl.solo.v1') ?? 'null'),
    lineup: JSON.parse(localStorage.getItem('sdk:ccl.lineup.v1') ?? 'null'),
    direct: localStorage.getItem('ccl.solo.v1'),
  }))
  assert.equal(storage.setup.overs, 20)
  assert.equal(storage.setup.venue, 'harbor')
  assert.equal(storage.lineup.length, 11)
  assert.equal(storage.direct, null)
  assert.deepEqual(errors, [])
  console.log('Phase 2 browser smoke passed: saved XI, 20-over Harbor setup, bouncer, field selection, and SDK lifecycle.')
} finally {
  await browser.close()
  await server.close()
}
