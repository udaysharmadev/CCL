import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: true } })
await server.listen()
const address = server.httpServer?.address()
assert.ok(address && typeof address !== 'string')
const browser = await chromium.launch({ executablePath: process.env.CCL_CHROME_PATH, args: ['--ignore-gpu-blocklist', '--enable-webgl', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])] })
const errors: string[] = []
try {
  const page = await browser.newPage({ viewport: { width: 1380, height: 710 }, deviceScaleFactor: 1 })
  page.on('pageerror', e => errors.push(e.message))
  for (const [name, query] of [
    ['guard', ''], ['pickup', '?prep=1'], ['drive', '?shot=cover-drive&age=0.083333333333&prep=1'],
    ['finish', '?shot=cover-drive&age=.42&prep=1'], ['pull', '?shot=pull&age=.083333333333&height=1.05&angle=-1.4&prep=1'],
    ['sweep', '?shot=sweep&age=.083333333333&height=.25&angle=-1.4&prep=1'],
    ['scoop', '?shot=scoop&age=.083333333333&height=.4&angle=2.6&prep=1'],
    ['defense', '?shot=defend&age=.083333333333&height=.35&prep=1'],
    ['yorker', '?shot=defend&age=.083333333333&height=.1&angle=0&prep=1'],
    ['duck', '?shot=duck&age=.2&prep=1'], ['recovery', '?shot=cover-drive&age=1.1'],
  ]) {
    await page.goto(`http://127.0.0.1:${address.port}/scripts/batting-preview.html${query}`)
    await page.waitForFunction('window.ready === true')
    await page.screenshot({ path: `/tmp/ccl-batting-${name}.png` })
    const metrics=JSON.parse(await page.evaluate('JSON.stringify(window.poseMetrics[0])')) as { hands:number[][];feet:number[][];bat:number[] }
    assert.ok(metrics.feet.every(foot=>Math.abs(foot[1]-.065)<.001), name+' grounded feet')
    if(name==='guard') assert.ok(metrics.hands.every(hand=>hand[1]<.9), 'low guard hands')
  }
  await page.goto(`http://127.0.0.1:${address.port}/?seed=41`)
  await page.getByRole('button', { name: 'Training Nets', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('#game')?.getAttribute('data-phase') === 'windup')
  await page.screenshot({ path: '/tmp/ccl-batting-game.png' })
  for(const [width,height] of [[1380,710],[800,450],[390,844]]) {
    await page.setViewportSize({width,height})
    await page.goto(`http://127.0.0.1:${address.port}/?seed=41&play=training`)
    await page.waitForFunction(() => document.querySelector('#game')?.getAttribute('data-phase') === 'windup')
    await page.waitForFunction(()=>{
      const canvas=document.querySelector('#stadium canvas')?.getBoundingClientRect()
      const score=document.querySelector('#scoreboard')?.getBoundingClientRect()
      return canvas && score && canvas.bottom<=score.top+1
    })
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await page.screenshot({path:`/tmp/ccl-batting-game-${width}.png`})
  }
  assert.deepEqual(errors, [])
  console.log('Batting browser passed: eleven three-angle pose studies, low guard, grounded feet, and unobstructed stadium above scoreboard at desktop/landscape/portrait sizes; no page errors.')
} finally { await browser.close(); await server.close() }
