import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

const evidence = resolve(process.env.CCL_QA_DIR ?? 'docs/bowling-evidence/animation')
await mkdir(evidence, { recursive: true })
const server = await createServer({ configLoader: 'native', optimizeDeps: { noDiscovery: true, include: [], exclude: ['three'] }, server: { host: '127.0.0.1', port: 0, strictPort: true } })
await server.listen()
const address = server.httpServer?.address()
assert.ok(address && typeof address !== 'string')
const browser = await chromium.launch({ executablePath: process.env.CCL_CHROME_PATH ?? (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined),
  args: process.env.CCL_SOFTWARE_GPU === '1' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--ignore-gpu-blocklist', '--enable-webgl'] })
const errors: string[] = []
const samples: Record<string, unknown> = {}
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 820 }, deviceScaleFactor: 1 })
  page.on('pageerror', error => errors.push(error.message))
  for (const [name, query] of [['run-up', '?progress=.38'], ['gather', '?progress=.75'], ['release-over', '?progress=1'], ['release-around', '?progress=1&side=around'], ['follow-through', '?age=.22']] as const) {
    await page.goto(`http://127.0.0.1:${address.port}/scripts/bowling-preview.html${query}`)
    await page.waitForFunction('window.ready === true')
    const data = await page.evaluate('window.poseMetrics') as { id: string; release: { x: number; y: number; z: number }; hand: number[] }[]
    assert.equal(data.length, 8)
    if (name.startsWith('release')) for (const actor of data)
      assert.ok(Math.hypot(actor.hand[0] - actor.release.x, actor.hand[1] - actor.release.y, actor.hand[2] - actor.release.z) < .00001, `${actor.id}: physical release matches visible hand`)
    samples[name] = data
    await page.screenshot({ path: resolve(evidence, `${name}.png`) })
  }
  await page.setViewportSize({ width: 1380, height: 730 })
  for (const hand of ['right', 'left']) for (const [name, query] of [['stance', ''], ['drive', '&shot=cover-drive&age=.083333333333&prep=1'], ['sweep', '&shot=sweep&age=.083333333333&height=.25&angle=-1.4&prep=1']] as const) {
    await page.goto(`http://127.0.0.1:${address.port}/scripts/batting-preview.html?hand=${hand}${query}`)
    await page.waitForFunction('window.ready === true')
    samples[`${hand}-${name}`] = await page.evaluate('window.poseMetrics')
    await page.screenshot({ path: resolve(evidence, `${hand}-${name}.png`) })
  }
  assert.deepEqual(errors, [])
  await writeFile(resolve(evidence, 'pose-metrics.json'), JSON.stringify({ checks: 11, errors, samples }, null, 2))
  console.log('Bowling animation browser: 11 pose studies passed; eight actions, both release sides, left/right stance and contact; no page errors.')
} finally { await browser.close(); await server.close() }
