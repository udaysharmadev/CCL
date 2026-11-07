import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import type { createStadium, StadiumFrame } from '../src/stadium.ts'
import type { Delivery } from '../src/cricket.ts'

declare global {
  interface Window {
    graphicsStudy: { stadium: ReturnType<typeof createStadium>; delivery: Delivery; frame: StadiumFrame; recreate: () => void }
  }
}

const baseline = process.env.CCL_QA_BASELINE === '1'
const baselineRef = process.env.CCL_QA_BASE_REF ?? 'HEAD'
const baselineSource = baseline ? execFileSync('git', ['-c', `safe.directory=${process.cwd().replaceAll('\\', '/')}`, 'show', `${baselineRef}:src/stadium.ts`], { encoding: 'utf8' }) : undefined
const directory = resolve(process.env.CCL_QA_DIR ?? 'docs/visual-evidence', baseline ? 'graphics-before' : 'graphics')
await mkdir(directory, { recursive: true })
const server = await createServer({ configLoader: 'native', optimizeDeps: { noDiscovery: true, include: [] }, server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'isolated-graphics-study', enforce: 'pre',
  transform(_code, id) {
    if (baselineSource && id.replaceAll('\\', '/').endsWith('/src/stadium.ts')) return { code: baselineSource, map: null }
  },
  configureServer(server) {
    server.middlewares.use('/__graphics-study', (_request, response) => {
      response.setHeader('Content-Type', 'text/html')
      response.end(`<!doctype html><html><head><link rel="icon" href="/mark.svg"><style>html,body,#ground{margin:0;width:100%;height:100%;overflow:hidden;background:#071623}</style></head><body><div id="ground"></div><script type="module">
        import {createStadium} from '/src/stadium.ts';
        import {Delivery} from '/src/cricket.ts';
        const root=document.getElementById('ground');
        const delivery=new Delivery({seed:41,kind:'fast',line:.2});
        const frame={mode:'bat',phase:'ready',delivery,reducedMotion:true};
        window.graphicsStudy={stadium:createStadium(root),delivery,frame,recreate(){this.stadium=createStadium(root)}};
        window.graphicsStudy.stadium.render(frame,0);
      </script></body></html>`)
    })
  },
}] })
await server.listen()
const address = server.httpServer?.address()
assert.ok(address && typeof address !== 'string')
const browser = await chromium.launch({ executablePath: process.env.CCL_CHROME_PATH,
  args: process.env.CCL_SOFTWARE_GPU === '1' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-webgl', '--ignore-gpu-blocklist'],
}).catch(async error => { await server.close(); throw error })
const issues: string[] = []
const warnings: string[] = []
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.on('pageerror', error => issues.push(error.message))
  page.on('console', entry => { if (entry.type() === 'error') issues.push(entry.text()); if (entry.type() === 'warning') warnings.push(entry.text()) })
  page.on('response', response => { if (response.status() >= 400) issues.push(`${response.status()} ${response.url()}`) })
  await page.goto(`http://127.0.0.1:${address.port}/__graphics-study`)
  await page.waitForFunction(() => Boolean(window.graphicsStudy))
  const metrics = await page.evaluate(async () => {
    const { stadium, frame, delivery } = window.graphicsStudy
    // Present a live delivery at a fixed authoritative tick, not an empty scene.
    frame.phase = 'flight'
    const before = JSON.stringify(delivery)
    const tiers = []
    for (const quality of ['high', 'medium', 'low'] as const) {
      stadium.setQuality(quality)
      const intervals: number[] = []
      let previous = 0
      for (let index = 0; index < 26; index++) {
        const now = await new Promise<number>(requestAnimationFrame)
        stadium.render(frame, 1 / 60)
        if (index > 5) intervals.push(now - previous)
        previous = now
      }
      intervals.sort((a,b) => a-b)
      const canvas = document.querySelector('canvas')!
      tiers.push({ ...stadium.info(), quality, width: canvas.width, height: canvas.height, frameP50: intervals[9], frameP95: intervals[18] })
    }
    return { tiers, unchanged: before === JSON.stringify(delivery) }
  })
  assert.equal(metrics.unchanged, true, 'rendering/quality never mutate delivery simulation')
  if (baseline) {
    const report = { browser: browser.version(), softwareGpu: process.env.CCL_SOFTWARE_GPU === '1', baseline: `${baselineRef}:src/stadium.ts`, ...metrics, issues, warnings }
    await writeFile(resolve(directory, 'metrics.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  } else {
  assert.deepEqual(metrics.tiers.map(tier => tier.shadowSize), [2048, 1024, 0])
  assert.ok(metrics.tiers[2].triangles < metrics.tiers[0].triangles, 'low quality reduces actual scene work')
  const memory = []
  for (let cycle = 0; cycle < 2; cycle++) {
    for (const [venue, weather] of [['suncrest', 'clear'], ['harbor', 'breezy'], ['citadel', 'overcast']] as const) {
      const info = await page.evaluate(({venue,weather}) => {
        const {stadium,frame} = window.graphicsStudy
        stadium.setConditions({venue,weather})
        stadium.setQuality('high')
        stadium.render(frame, 1/60)
        return stadium.info()
      }, {venue,weather})
      if (cycle === 0) await page.screenshot({ path: resolve(directory, `${venue}-${weather}.png`) })
      if (venue === 'citadel') memory.push({ geometries: info.geometries, textures: info.textures })
    }
  }
  assert.deepEqual(memory[0], memory[1], 'cached venue resources stabilize after one complete tour')
  const lifecycle = await page.evaluate(() => {
    const study = window.graphicsStudy
    study.stadium.dispose()
    study.stadium.dispose()
    const old = study.stadium.info()
    const removed = !document.querySelector('canvas')
    study.recreate()
    study.stadium.render(study.frame, 0)
    return { old, removed, recreated: study.stadium.info(), canvases: document.querySelectorAll('canvas').length }
  })
  assert.equal(lifecycle.removed, true)
  assert.equal(lifecycle.old.disposed, true)
  assert.equal(lifecycle.old.geometries, 0)
  // Three r185 keeps one internal empty shadow sampler in its raw counter.
  // Terminal disposal must release the actual context, including that sampler.
  assert.ok(lifecycle.old.textures <= 1)
  assert.equal(lifecycle.old.contextReleased, true)
  assert.equal(lifecycle.canvases, 1)
  assert.ok(lifecycle.recreated.calls > 0)
  assert.deepEqual(issues, [])
  assert.deepEqual(warnings.filter(message => /THREE|WebGL|shader/i.test(message)), [])
  const report = { browser: browser.version(), softwareGpu: process.env.CCL_SOFTWARE_GPU === '1', ...metrics, memory, lifecycle, issues, warnings }
  await writeFile(resolve(directory, 'metrics.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  }
} finally { await browser.close(); await server.close() }
