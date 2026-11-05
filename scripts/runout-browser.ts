import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { preview } from 'vite'
const server = await preview({ preview: { host: '127.0.0.1', port: 0 } })
const addr = server.httpServer.address()
assert.ok(addr && typeof addr !== 'string')
const browser = await chromium.launch({ executablePath: process.env.CCL_CHROME_PATH, args: ['--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=metal'] })
try {
 const page = await browser.newPage({ viewport: { width: 1000, height: 650 } })
 const errors: string[] = []
 page.on('pageerror', e => errors.push(e.message))
 await page.goto(`http://127.0.0.1:${addr.port}/?seed=41&play=training`)
 await page.locator('#defense-toggle').click()
 await page.locator('#pause-button').click()
 await page.locator('#auto-next').click()
 await page.getByRole('button', { name: 'Resume', exact: true }).click()
 assert.ok(await page.locator('#duo-controls').isVisible())
 await page.evaluate(() => new Promise<void>(resolve => {
  function step() {
   const p = parseFloat(document.querySelector<HTMLElement>('#timing-needle')!.style.getPropertyValue('--timing'))
   if (document.querySelector('#game')?.getAttribute('data-phase') === 'flight' && p >= 49 && p <= 54) {
    document.dispatchEvent(new KeyboardEvent('keydown', {code:'Space',key:' ',bubbles:true}));resolve()
   } else requestAnimationFrame(step)
  } step()
 }))
 await page.waitForFunction(() => document.querySelector('#game')?.getAttribute('data-phase') === 'field')
 await page.locator('#duo-run').click()
 await page.locator('#duo-run').click()
 await page.screenshot({path:'/tmp/ccl-two-hand-contact.png'})
 await page.waitForFunction(() => document.querySelector('#game')?.getAttribute('data-phase') === 'dead', undefined, {timeout:20000})
 assert.match(await page.locator('#call-title').textContent() ?? '', /Run out/i)
 assert.match(await page.locator('#score').textContent() ?? '', /\/1$/)
 const score = await page.locator('#score').textContent()
 await page.screenshot({path:'/tmp/ccl-real-runout.png'})
 await page.locator('#pause-button').click()
 await page.locator('#replay-button').click()
 await page.waitForFunction(() => document.querySelector('#game')?.getAttribute('data-phase') === 'dead', undefined, {timeout:20000})
 assert.equal(await page.locator('#score').textContent(), score)
 assert.match(await page.locator('#call-title').textContent() ?? '', /Run out/i)
 await page.goto(`http://127.0.0.1:${addr.port}/?seed=41&play=training`)
 await page.waitForFunction(() => document.querySelector('#game')?.getAttribute('data-phase') === 'windup')
 await page.mouse.move(550,400)
 await page.mouse.down()
 await page.mouse.move(430,220,{steps:6})
 await page.waitForFunction(() => {
  const p=parseFloat(document.querySelector<HTMLElement>('#timing-needle')!.style.getPropertyValue('--timing'))
  return document.querySelector('#game')?.getAttribute('data-phase') === 'flight' && p>=47 && p<=53
 })
 await page.mouse.up()
 await page.waitForFunction(() => document.querySelector('#game')?.getAttribute('data-phase') === 'field')
 await page.waitForTimeout(180)
 await page.locator('#pause-button').click()
 await page.locator('#overlay').evaluate(n=>{(n as HTMLElement).style.visibility='hidden'})
 await page.screenshot({path:'/tmp/ccl-cover-drive.png'})
 assert.deepEqual(errors,[])
 console.log(`Run-out browser passed: visible Run button in default training, two taps attempt two runs, keeper breaks wicket, ${score}, explicit Run out result, replay preserves dismissal and score.`)
} finally { await browser.close(); await server.close() }
