import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, type Page } from 'playwright-core'
import { preview } from 'vite'

// Exercise the finished production interface through its public controls.
// Run `npm run build` first. No multiplayer service is required for lobby UI checks.
const directory = resolve(process.env.CCL_QA_DIR ?? 'docs/visual-evidence/interface')
await mkdir(directory, { recursive: true })
const server = await preview({ configLoader: 'native', preview: { host: '127.0.0.1', port: 0, strictPort: true } })
const address = server.httpServer.address()
assert.ok(address && typeof address !== 'string')
const browser = await chromium.launch({
  executablePath: process.env.CCL_CHROME_PATH,
  args: process.env.CCL_SOFTWARE_GPU === '1'
    ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : ['--ignore-gpu-blocklist', '--enable-webgl'],
}).catch(async error => { await server.close(); throw error })

const errors: string[] = []
const checks: string[] = []
const motionMediaEvents: string[] = []
const url = `http://127.0.0.1:${address.port}/?seed=41`

async function ready(page: Page) {
  await page.locator('#solo-button:enabled').waitFor()
  await page.evaluate(() => document.fonts.ready)
}

async function capture(page: Page, name: string) {
  await page.screenshot({ path: resolve(directory, `${name}.png`), animations: 'disabled' })
}

async function reachable(page: Page, selector: string) {
  const control = page.locator(selector)
  await control.scrollIntoViewIfNeeded()
  const box = await control.boundingBox()
  const viewport = page.viewportSize()!
  assert.ok(box, `${selector} has a visible box`)
  assert.ok(box.x >= -1 && box.x + box.width <= viewport.width + 1, `${selector} fits the viewport width`)
  assert.ok(box.y >= -1 && box.y + box.height <= viewport.height + 1, `${selector} can be reached by scrolling`)
}

async function dialogFits(page: Page, selector: string) {
  const dimensions = await page.locator(selector).evaluate(node => {
    const box = node.getBoundingClientRect()
    return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, overflow: node.scrollWidth - node.clientWidth }
  })
  const viewport = page.viewportSize()!
  assert.ok(dimensions.x >= -1 && dimensions.y >= -1 && dimensions.right <= viewport.width + 1 && dimensions.bottom <= viewport.height + 1,
    `${selector} remains inside ${viewport.width}×${viewport.height}`)
  assert.ok(dimensions.overflow <= 1, `${selector} has no horizontal overflow`)
  // Native dialogs with one focusable control may send the next Tab to browser
  // chrome. Check the opening focus, then exercise Escape in the caller.
  assert.ok(await page.locator(selector).evaluate(node => node.contains(document.activeElement)), `${selector} receives keyboard focus on opening`)
}

async function backToHome(page: Page) {
  if (await page.locator('#player-choice-dialog').evaluate(node => node instanceof HTMLDialogElement && node.open)) {
    await page.locator('#player-choice-dialog').getByRole('button', { name: 'Return to stadium', exact: true }).click()
    await page.locator('#game[data-view="home"]').waitFor()
    return
  }
  await page.locator('#pause-button').click()
  await page.getByRole('button', { name: 'Return to stadium', exact: true }).click()
  await page.locator('#game[data-view="home"]').waitFor()
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', entry => {
    if (entry.type() === 'error') errors.push(entry.text())
    if (entry.text().startsWith('Interface QA motion media:')) motionMediaEvents.push(entry.text())
  })
  await page.addInitScript(() => {
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', event => {
      console.info(`Interface QA motion media: ${event.matches} at ${performance.now()}`)
    })
  })
  await page.goto(url)
  await ready(page)
  const graphic = page.locator('img[src$="cricket-hero.svg"]')
  await graphic.waitFor()
  assert.ok(await graphic.evaluate(node => node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0), 'home cricket illustration loads')
  assert.equal(await page.locator('#home video').count(), 0, 'home has no video')
  assert.equal(await page.locator('#stadium').isVisible(), false, 'live stadium is hidden on the illustrated home')
  checks.push('Static cricket graphic loads and the live stadium stays hidden on home.')

  for (const [width, height, label] of [[1440, 900, 'desktop'], [390, 844, 'mobile'], [320, 740, 'small-mobile'], [844, 390, 'landscape']] as const) {
    await page.setViewportSize({ width, height })
    await page.locator('#home-button').scrollIntoViewIfNeeded()
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur() })
    await capture(page, `home-${label}`)
    const noOverflow = await page.evaluate(() =>
      [document.documentElement, document.body, document.getElementById('game')!, document.getElementById('home')!]
        .every(node => node.scrollWidth <= node.clientWidth + 1))
    assert.ok(noOverflow, `${label}: home has no horizontal overflow`)
    for (const id of ['solo-button', 'training-button', 'setup-button', 'lineup-button', 'six-button', 'online-button', 'how-to-play', 'settings-button']) {
      await reachable(page, `#${id}`)
    }

    await page.locator('#setup-button').click()
    await dialogFits(page, '#setup-dialog')
    await page.locator('#setup-venue').selectOption('harbor')
    await page.locator('#setup-weather').selectOption('breezy')
    await page.locator('#setup-overs').selectOption('20')
    assert.match(await page.locator('#setup-preview-name').textContent() ?? '', /Harbor/)
    assert.match(await page.locator('#setup-preview-match').textContent() ?? '', /20 overs/)
    await page.locator('#setup-title').scrollIntoViewIfNeeded()
    await capture(page, `setup-${label}`)
    await reachable(page, '#setup-fielding')
    await reachable(page, '#setup-dialog button[type="submit"]')
    await reachable(page, '#setup-cancel')
    await page.locator('#setup-cancel').click()

    await page.locator('#lineup-button').click()
    await dialogFits(page, '#lineup-dialog')
    assert.equal(await page.locator('#lineup-chosen li').count(), 11)
    await page.locator('#lineup-title').scrollIntoViewIfNeeded()
    await capture(page, `lineup-${label}`)
    await page.getByRole('button', { name: 'Bench Mehta', exact: true }).click()
    assert.ok(await page.locator('#lineup-save').isDisabled())
    await page.getByRole('button', { name: 'Select Roy', exact: true }).click()
    assert.ok(await page.locator('#lineup-save').isEnabled())
    await reachable(page, '#lineup-save')
    await reachable(page, '#lineup-cancel')
    await page.locator('#lineup-cancel').click()

    for (const [open, dialog, close] of [
      ['settings-button', 'settings-dialog', 'settings-close'],
      ['how-to-play', 'how-to-play-dialog', 'how-to-play-close'],
      ['online-button', 'online-dialog', 'close-online'],
    ]) {
      await page.locator(`#${open}`).click()
      await dialogFits(page, `#${dialog}`)
      if (label === 'desktop') await capture(page, `${dialog}-${label}`)
      await reachable(page, `#${close}`)
      await page.keyboard.press('Escape')
      assert.equal(await page.locator(`#${dialog}`).isVisible(), false, `${dialog} closes with Escape`)
    }
    checks.push(`${label} (${width}×${height}): all home options reachable; setup, lineup, settings, guide, and online dialogs fit and support keyboard dismissal.`)
  }

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.locator('#lineup-button').click()
  await page.getByRole('button', { name: 'Bench Mehta', exact: true }).click()
  assert.ok(await page.locator('#lineup-save').isDisabled(), 'incomplete XI cannot be saved')
  await page.getByRole('button', { name: 'Select Roy', exact: true }).click()
  await page.getByRole('button', { name: 'Move Singh up', exact: true }).click()
  assert.ok(await page.locator('#lineup-save').isEnabled(), 'valid replacement restores save')
  await page.locator('#lineup-save').click()
  await page.reload()
  await ready(page)
  await page.locator('#lineup-button').click()
  assert.match(await page.locator('#lineup-chosen li').first().textContent() ?? '', /Singh/)
  assert.match(await page.locator('#lineup-chosen li').last().textContent() ?? '', /Roy/)
  await page.locator('#lineup-cancel').click()
  checks.push('Bench, replace, and reorder players; XI validation and saved order survive reload.')

  await page.locator('#settings-button').click()
  await page.locator('#setting-sound').uncheck()
  await page.locator('#setting-motion').check()
  await page.locator('#setting-needle').uncheck()
  await page.locator('#setting-quality').selectOption('low')
  await page.locator('#setting-difficulty').selectOption('relaxed')
  await page.locator('#settings-close').click()
  const beforeReload = await page.evaluate(() => ({
    settings: JSON.parse(localStorage.getItem('ccl.settings.v1') ?? 'null'),
    media: matchMedia('(prefers-reduced-motion: reduce)').matches,
  }))
  assert.equal(beforeReload.settings?.reducedMotion, true, 'explicit motion preference is saved before reload')
  await page.reload()
  await ready(page)
  await page.locator('#settings-button').click()
  assert.equal(await page.locator('#setting-sound').isChecked(), false)
  assert.equal(await page.locator('#setting-motion').isChecked(), true, JSON.stringify({
    beforeReload, motionMediaEvents,
    afterReload: await page.evaluate(() => ({
      settings: JSON.parse(localStorage.getItem('ccl.settings.v1') ?? 'null'),
      media: matchMedia('(prefers-reduced-motion: reduce)').matches,
    })),
  }))
  assert.equal(await page.locator('#setting-needle').isChecked(), false)
  assert.equal(await page.locator('#setting-quality').inputValue(), 'low')
  assert.equal(await page.locator('#setting-difficulty').inputValue(), 'relaxed')
  assert.equal(await page.locator('body').getAttribute('data-motion'), 'reduced')
  await page.locator('#settings-close').click()
  checks.push('Sound, motion, timing needle, graphics, and timing preferences persist after reload.')

  await page.locator('#setup-button').click()
  for (const [id, value] of Object.entries({ overs: '20', venue: 'harbor', pitch: 'green', weather: 'breezy', field: 'boundary', difficulty: 'Legend', toss: 'bowl', running: 'manual', fielding: 'manual' })) {
    await page.locator(`#setup-${id}`).selectOption(value)
  }
  await page.locator('#setup-dialog button[type="submit"]').click()
  await page.locator('#game[data-view="solo"]').waitFor()
  await page.locator('#player-choice-dialog [data-player-id="Khan"]').click()
  assert.match(await page.locator('#overs-limit').textContent() ?? '', /20 OV/)
  assert.match(await page.locator('#match-id').textContent() ?? '', /HARBOR REACH/)
  assert.ok(await page.locator('#stadium').isVisible(), '3D stadium returns in a match')
  await capture(page, 'solo-match')
  await backToHome(page)
  await page.locator('#setup-button').click()
  for (const [id, value] of Object.entries({ overs: '20', venue: 'harbor', pitch: 'green', weather: 'breezy', field: 'boundary', difficulty: 'Legend', toss: 'bowl', running: 'manual', fielding: 'manual' })) {
    assert.equal(await page.locator(`#setup-${id}`).inputValue(), value, `saved ${id}`)
  }
  await page.locator('#setup-cancel').click()
  checks.push('All setup selections save, start a 20-over Harbor match, and reappear on return.')

  for (const [button, view] of [['training-button', 'training'], ['six-button', 'six']]) {
    await page.locator(`#${button}`).click()
    await page.locator(`#game[data-view="${view}"]`).waitFor()
    assert.ok(await page.locator('#scoreboard').isVisible())
    assert.ok(await page.locator('#stadium').isVisible())
    await backToHome(page)
  }
  checks.push('Training Nets and Longest Six start and return to the home screen.')
  assert.deepEqual(errors, [], 'no browser errors')
  await writeFile(resolve(directory, 'checks.json'), JSON.stringify({ browser: browser.version(), checks, errors }, null, 2))
  console.log(JSON.stringify({ directory, checks, errors }, null, 2))
} finally {
  await browser.close()
  await server.close()
}
