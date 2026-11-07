import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

// UI checks run against source so they can be used while the rendering milestone
// is being developed. The milestone capture script also checks the final bundle.
const server = await createServer({
  configLoader: 'native',
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { host: '127.0.0.1', port: 0 },
})
await server.listen()
const address = server.httpServer!.address()
assert.ok(address && typeof address !== 'string')
const browser = await chromium.launch({
  executablePath: process.env.CCL_CHROME_PATH,
  args: process.env.CCL_SOFTWARE_GPU === '1'
    ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : ['--ignore-gpu-blocklist', '--enable-webgl'],
}).catch(async error => { await server.close(); throw error })
const directory = process.env.CCL_QA_DIR ?? 'docs/visual-evidence/presentation'
await mkdir(directory, { recursive: true })
const errors: string[] = []
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${address.port}/?seed=41`)
  await page.locator('#solo-button:enabled').waitFor()
  await page.evaluate(() => document.fonts.ready)
  for (const [width, height] of [[1440, 900], [800, 450], [390, 844], [360, 640]] as const) {
    await page.setViewportSize({ width, height })
    await page.screenshot({ path: resolve(directory, `home-${width}.png`) })
    const bounds = await page.evaluate(() => {
      const rect = (selector: string) => {
        const box = document.querySelector(selector)!.getBoundingClientRect()
        return { x: box.x, y: box.y, right: box.right, bottom: box.bottom }
      }
      return { home: rect('#home'), top: rect('.topbar'), footer: rect('#venue'), last: rect('.home-utilities') }
    })
    assert.ok(bounds.home.x >= 0 && bounds.home.right <= width, `${width}: home fits width`)
    assert.ok(bounds.home.y >= bounds.top.bottom, `${width}: menu clears brand`)
    assert.ok(bounds.last.bottom < bounds.footer.y, `${width}: every navigation item clears the footer`)
    await page.getByRole('button', { name: 'Match setup', exact: true }).click()
    await page.locator('#setup-venue').selectOption('harbor')
    await page.locator('#setup-weather').selectOption('breezy')
    await page.locator('#setup-overs').selectOption('20')
    assert.match(await page.locator('#setup-preview-name').textContent() ?? '', /Harbor/i)
    assert.match(await page.locator('#setup-preview-match').textContent() ?? '', /20 overs/)
    assert.equal(await page.locator('#setup-preview').getAttribute('data-venue'), 'harbor')
    assert.ok(await page.locator('#setup-dialog').evaluate(node => node.scrollWidth <= node.clientWidth), `${width}: setup has no horizontal overflow`)
    await page.screenshot({ path: resolve(directory, `setup-${width}.png`) })
    await page.locator('#setup-cancel').click()
  }
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.getByRole('button', { name: 'Dressing room', exact: true }).click()
  assert.equal(await page.locator('#lineup-chosen li').count(), 11)
  assert.equal(await page.locator('.roster-number').first().textContent(), '01')
  await page.getByRole('button', { name: 'Bench Mehta', exact: true }).click()
  assert.ok(await page.getByRole('button', { name: 'Save XI', exact: true }).isDisabled())
  await page.getByRole('button', { name: 'Select Roy', exact: true }).click()
  assert.ok(await page.getByRole('button', { name: 'Save XI', exact: true }).isEnabled())
  await page.screenshot({ path: resolve(directory, 'lineup-desktop.png') })
  await page.locator('#lineup-cancel').click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.locator('#setting-motion').check()
  assert.equal(await page.locator('body').getAttribute('data-motion'), 'reduced')
  assert.equal(await page.locator('#settings-dialog').evaluate(node => getComputedStyle(node).animationName), 'none')
  assert.deepEqual(errors, [])
  console.log('Presentation browser passed: four home sizes, accessible navigation, live conditions, no setup overflow, XI validity, and reduced motion. No page errors.')
} finally { await browser.close(); await server.close() }
