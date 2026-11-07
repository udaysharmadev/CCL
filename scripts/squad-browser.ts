import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, type Page } from 'playwright-core'
import { preview } from 'vite'

// Public UI interactions only. Build first; no match results or profile state are injected.
const directory = resolve(process.env.CCL_QA_DIR ?? 'docs/visual-evidence/bowling', 'squad')
await mkdir(directory, { recursive: true })
const server = await preview({ configLoader: 'native', preview: { host: '127.0.0.1', port: 0, strictPort: true } })
const address = server.httpServer.address()
assert.ok(address && typeof address !== 'string')
const browser = await chromium.launch({ executablePath: process.env.CCL_CHROME_PATH, args: process.env.CCL_SOFTWARE_GPU === '1' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--ignore-gpu-blocklist', '--enable-webgl'] }).catch(async error => { await server.close(); throw error })
const errors: string[] = [], checks: string[] = []
async function capture(page: Page, name: string) { await page.screenshot({ path: resolve(directory, `${name}.png`), animations: 'disabled' }) }
async function fits(page: Page, selector: string) {
  const bounds = await page.locator(selector).evaluate(node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, overflow: node.scrollWidth - node.clientWidth } })
  const size = page.viewportSize()!
  assert.ok(bounds.left >= -1 && bounds.right <= size.width + 1 && bounds.top >= -1 && bounds.bottom <= size.height + 1, `${selector} fits ${size.width}×${size.height}`)
  assert.ok(bounds.overflow <= 1, `${selector} has no horizontal overflow`)
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 })
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', entry => { if (entry.type() === 'error') errors.push(entry.text()) })
  await page.goto(`http://127.0.0.1:${address.port}/?seed=41`)
  await page.locator('#lineup-button:enabled').waitFor(); await page.locator('#lineup-button').click()
  await page.locator('#lineup-dialog canvas').waitFor()
  await fits(page, '#lineup-dialog'); await capture(page, '01-squad-desktop')
  assert.equal(await page.locator('#lineup-chosen li').count(), 11)
  assert.equal(await page.locator('#lineup-bench li').count(), 4)
  await page.getByRole('button', { name: 'Compare Mehta', exact: true }).click()
  await page.getByRole('button', { name: 'Compare Rao', exact: true }).click()
  await page.locator('#squad-compare').click(); await fits(page, '#squad-comparison'); await capture(page, '02-compare-desktop')
  assert.match(await page.locator('#squad-comparison').textContent() ?? '', /Mehta[\s\S]*Rao/)
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  checks.push('Full XI, reserves, two-player comparison and desktop layout verified.')

  await page.getByRole('button', { name: 'Edit Mehta', exact: true }).click(); await fits(page, '#player-editor')
  await page.locator('#profile-fullName').fill('Arjun Mehta')
  await page.locator('#profile-displayName').fill('A. Mehta')
  await page.locator('#profile-jerseyName').fill('ARJUN')
  await page.locator('#profile-jerseyNumber').fill('42')
  await capture(page, '03-player-identity')
  await page.locator('.profile-tab[data-tab="batting"]').click()
  await page.locator('#profile-hand').selectOption('left')
  await capture(page, '04-left-handed-batting-profile')
  await page.locator('#player-save').click()
  assert.match(await page.locator('#lineup-chosen li[data-player="Mehta"]').textContent() ?? '', /A\. Mehta[\s\S]*42[\s\S]*LHB/)
  await page.locator('#lineup-cancel').click(); await page.reload()
  await page.locator('#lineup-button:enabled').waitFor(); await page.locator('#lineup-button').click()
  await page.getByRole('button', { name: 'Edit A. Mehta', exact: true }).click()
  assert.equal(await page.locator('#profile-fullName').inputValue(), 'Arjun Mehta')
  assert.equal(await page.locator('#profile-jerseyName').inputValue(), 'ARJUN')
  assert.equal(await page.locator('#profile-jerseyNumber').inputValue(), '42')
  await page.getByRole('button', { name: 'Close player profile', exact: true }).click()
  checks.push('Full name, display name, jersey identity and left-handed batting persist after a real reload.')

  await page.getByRole('button', { name: 'Edit Rao', exact: true }).click()
  await page.locator('.profile-tab[data-tab="bowling"]').click()
  assert.equal(await page.locator('#profile-bouncer').count(), 1)
  assert.equal(await page.locator('#profile-drift').count(), 0)
  await capture(page, '05-fast-bowling-profile')
  await page.locator('#profile-maxPace').fill('300'); await page.locator('#player-save').click()
  assert.match(await page.locator('#profile-errors').textContent() ?? '', /maximum pace/)
  assert.ok(await page.locator('#player-editor').isVisible())
  await page.getByRole('button', { name: 'Close player profile', exact: true }).click()
  await page.getByRole('button', { name: 'Edit Patel', exact: true }).click()
  await page.locator('.profile-tab[data-tab="bowling"]').click()
  assert.equal(await page.locator('#profile-drift').count(), 1)
  assert.equal(await page.locator('#profile-bouncer').count(), 0)
  assert.deepEqual(await page.locator('#profile-action option').evaluateAll(options => options.map(o => (o as HTMLOptionElement).value)), ['finger-spin', 'side-on'])
  await capture(page, '06-spin-bowling-profile')
  await page.getByRole('button', { name: 'Close player profile', exact: true }).click()
  checks.push('Pace/spin attribute panels adapt; invalid pace is rejected without closing or saving.')

  await page.locator('#squad-filter').selectOption('spin')
  assert.deepEqual((await page.locator('#lineup-chosen li, #lineup-bench li').evaluateAll(rows => rows.map(r => r.getAttribute('data-player')))).sort(), ['Dutt', 'Joshi', 'Patel', 'Shah'])
  await page.locator('#squad-filter').selectOption('left-handed')
  assert.ok((await page.locator('#lineup-chosen li').allTextContents()).some(s => s.includes('A. Mehta')))
  await page.locator('#squad-filter').selectOption('all'); await page.locator('#squad-sort').selectOption('bowling')
  await capture(page, '07-sorted-squad')
  await page.locator('#squad-sort').selectOption('order')
  checks.push('Spin/left-handed filters and bowling sorting operate on saved attributes.')

  for (const [width, height, label] of [[390, 844, 'mobile'], [320, 740, 'small-mobile'], [844, 390, 'landscape']] as const) {
    await page.setViewportSize({ width, height }); await fits(page, '#lineup-dialog')
    await page.locator('#lineup-title').scrollIntoViewIfNeeded(); await capture(page, `08-squad-${label}`)
    await page.getByRole('button', { name: 'Edit A. Mehta', exact: true }).click(); await fits(page, '#player-editor'); await capture(page, `09-profile-${label}`)
    await page.locator('.profile-tab[data-tab="fielding"]').click(); await fits(page, '#player-editor')
    await page.getByRole('button', { name: 'Close player profile', exact: true }).click()
  }
  checks.push('Squad and profile editor fit 390×844, 320×740 and 844×390 with no horizontal overflow.')
  for (let i = 0; i < 8; i++) {
    await page.getByRole('button', { name: 'Edit A. Mehta', exact: true }).click()
    await page.getByRole('button', { name: 'Close player profile', exact: true }).click()
  }
  assert.equal(await page.locator('#lineup-dialog canvas').count(), 1)
  assert.equal(await page.locator('#player-editor').count(), 1)
  assert.deepEqual(errors, [])
  checks.push('Repeated editor transitions retain one preview renderer and one editor; no console errors.')
  await writeFile(resolve(directory, 'checks.json'), JSON.stringify({ browser: browser.version(), checks, errors }, null, 2))
  console.log(`PASS ${checks.length} squad browser checks; Chromium ${browser.version()}; screenshots: ${directory}`)
} finally { await browser.close(); await server.close() }
