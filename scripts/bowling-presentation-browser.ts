import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { preview } from 'vite'
import type {} from '../src/main.ts'

// Actual wall-clock rendering, without a virtual clock or writable game observer.
const directory=resolve('docs/bowling-evidence/after')
await mkdir(directory,{recursive:true})
const server=await preview({configLoader:'native',preview:{host:'127.0.0.1',port:0}})
const address=server.httpServer.address();assert.ok(address&&typeof address!=='string')
const browser=await chromium.launch({executablePath:process.env.CCL_CHROME_PATH,args:process.env.CCL_SOFTWARE_GPU==='1'?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:['--ignore-gpu-blocklist','--enable-webgl']})
const errors:string[]=[]
try {
  const page=await browser.newPage({viewport:{width:1100,height:760},deviceScaleFactor:1,reducedMotion:'reduce'})
  page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text())})
  await page.goto(`http://127.0.0.1:${address.port}/?seed=41`);await page.locator('#solo-button:enabled').waitFor()
  await page.locator('#settings-button').click();await page.locator('#setting-quality').selectOption('low');await page.keyboard.press('Escape')
  await page.locator('#setup-button').click();await page.locator('#setup-toss').selectOption('bowl');await page.getByRole('button',{name:'Start match'}).click()
  await page.locator('[data-player-id="Khan"]').click();await page.waitForTimeout(1000)
  const graphics=await page.evaluate(()=>window.cclTelemetry().graphics)
  assert.ok(graphics&&graphics.width>0&&graphics.height>0&&graphics.calls>0)
  await page.screenshot({path:resolve(directory,'02-fast-hud.png')})
  await page.getByRole('button',{name:'Around the wicket',exact:true}).click()
  const target=await page.locator('#pitch-target-map').boundingBox();assert.ok(target)
  await page.mouse.click(target.x+target.width*.65,target.y+target.height*.75);await page.waitForTimeout(200)
  await page.screenshot({path:resolve(directory,'03-pitch-target.png')})
  const actors=await page.evaluate(()=>window.cclTelemetry().graphics?.actors)
  assert.ok(actors?.bowler.release&&Math.abs(actors.bowler.release.x-.92)<.001,'left around-wicket preview uses the actual release side')
  const samples:Record<string,unknown>={}
  for(const quality of ['low','high'] as const) {
    await page.locator('#pause-button').click();await page.locator('#match-settings').click();await page.locator('#setting-quality').selectOption(quality)
    await page.keyboard.press('Escape');await page.getByRole('button',{name:'Resume',exact:true}).click();await page.waitForTimeout(500)
    const observed=await page.evaluate(async()=>{
      const deltas:number[]=[];const start=performance.now();let previous=start
      await new Promise<void>(resolve=>{
        const frame=(now:number)=>{deltas.push(now-previous);previous=now;if(now-start>=5000)resolve();else requestAnimationFrame(frame)}
        requestAnimationFrame(frame)
      })
      const duration=performance.now()-start;deltas.sort((a,b)=>a-b)
      return {frames:deltas.length,durationMs:duration,fps:deltas.length/duration*1000,p50ms:deltas[Math.floor(deltas.length*.5)],p95ms:deltas[Math.min(deltas.length-1,Math.floor(deltas.length*.95))],graphics:window.cclTelemetry().graphics}
    })
    samples[quality]=observed
  }
  for(const [width,height,name] of [[390,844,'04-fast-mobile'],[800,450,'05-fast-landscape']] as const) {
    await page.setViewportSize({width,height});await page.waitForTimeout(500);await page.screenshot({path:resolve(directory,`${name}.png`)})
    const hud=await page.locator('#bowling-studio').boundingBox(),score=await page.locator('#scoreboard').boundingBox();assert.ok(hud&&score&&hud.y>=0&&hud.y+hud.height<=score.y+1)
  }
  assert.deepEqual(errors,[])
  await writeFile(resolve(directory,'performance.json'),JSON.stringify({browser:browser.version(),softwareGpu:process.env.CCL_SOFTWARE_GPU==='1',viewport:{width:1100,height:760},errors,samples,previewActors:actors},null,2))
  console.log(JSON.stringify({passed:4,errors,samples},null,2))
} finally { await browser.close();await server.close() }
