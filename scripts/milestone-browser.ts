import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, type Page } from 'playwright-core'
import { preview } from 'vite'
import type {} from '../src/main.ts'

// One repeatable production-build capture route for the visual milestone.
// Software GPU measurements are comparative diagnostics, not device FPS claims.
const label = process.env.CCL_QA_LABEL ?? 'after'
const directory = resolve(process.env.CCL_QA_DIR ?? 'docs/visual-evidence', label)
await mkdir(directory, { recursive: true })
const server = await preview({ configLoader: 'native', preview: { host: '127.0.0.1', port: 0 } })
const address = server.httpServer.address()
assert.ok(address && typeof address !== 'string')
const browser = await chromium.launch({
  executablePath: process.env.CCL_CHROME_PATH,
  args: process.env.CCL_SOFTWARE_GPU === '1'
    ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : ['--ignore-gpu-blocklist', '--enable-webgl'],
}).catch(async error => { await server.close(); throw error })
const issues: string[] = []
const warnings: string[] = []
const captures: Record<string, unknown> = {}
const url = `http://127.0.0.1:${address.port}/?seed=41`
async function capture(page: Page, name: string) {
  await page.screenshot({ path: resolve(directory, `${name}.png`) })
  captures[name] = await page.evaluate(() => window.cclTelemetry())
}
async function ready(page: Page) {
  await page.locator('#solo-button:enabled').waitFor()
  await page.waitForTimeout(600)
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  page.on('pageerror', error => issues.push(error.message))
  page.on('console', entry => {
    if (entry.type() === 'error') issues.push(entry.text())
    if (entry.type() === 'warning') warnings.push(entry.text())
  })
  await page.goto(url)
  await ready(page)
  await capture(page, '01-home-desktop')
  await page.getByRole('button', { name: 'Match setup', exact: true }).click()
  await capture(page, '02-setup-desktop')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Training Nets', exact: true }).click()
  await page.locator('#pause-button').click()
  await page.locator('#auto-next').click()
  await page.getByRole('button', { name: 'Resume', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('#game')?.getAttribute('data-phase') === 'dead')
  await capture(page, '03-match-desktop')
  for (const [width, height, name] of [[800, 450, 'landscape'], [390, 844, 'portrait']] as const) {
    await page.setViewportSize({ width, height })
    await page.waitForTimeout(200)
    await capture(page, `04-match-${name}`)
    const layout = await page.evaluate(() => {
      const bounds = (id: string) => {
        const box = document.getElementById(id)!.getBoundingClientRect()
        return { x: box.x, y: box.y, right: box.right, bottom: box.bottom }
      }
      return { score: bounds('scoreboard'), loft: bounds('loft-toggle'), next: bounds('next-button'), width: innerWidth, height: innerHeight }
    })
    assert.equal(layout.score.x, 0)
    assert.equal(layout.score.right, layout.width)
    assert.equal(layout.score.bottom, layout.height)
    if (label !== 'before') {
      assert.ok(layout.loft.bottom < layout.score.y, `${name}: batting controls clear scoreboard`)
      assert.ok(layout.next.right <= layout.loft.x || layout.next.bottom < layout.loft.y, `${name}: next button clears loft`)
    }
    captures[`layout-${name}`] = layout
  }
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.locator('#pause-button').click()
  await page.locator('#match-settings').click()
  for (const quality of ['high', 'medium', 'low']) {
    await page.locator('#setting-quality').selectOption(quality)
    await page.waitForTimeout(150)
    captures[`quality-${quality}`] = await page.evaluate(() => window.cclTelemetry())
  }
  await page.locator('#setting-quality').selectOption('high')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Resume', exact: true }).click()
  await page.locator('#next-button').click()
  await page.waitForTimeout(3000)
  captures.performance = await page.evaluate(() => window.cclTelemetry())
  await page.goto(url)
  await ready(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await capture(page, '05-home-portrait')
  await page.getByRole('button', { name: 'Match setup', exact: true }).click()
  await capture(page, '06-setup-portrait')
  assert.deepEqual(issues, [], 'no browser errors')
  await writeFile(resolve(directory, 'metrics.json'), JSON.stringify({ browser: browser.version(), softwareGpu: process.env.CCL_SOFTWARE_GPU === '1', issues, warnings, captures }, null, 2))
  console.log(JSON.stringify({ label, directory, issues, warnings, performance: captures.performance }, null, 2))
} finally {
  await browser.close()
  await server.close()
}
