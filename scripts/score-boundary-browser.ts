import assert from 'node:assert/strict'
import { chromium, type Page } from 'playwright-core'
import { createServer } from 'vite'
import type {} from '../src/main.ts'
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:true}})
await server.listen()
const address=server.httpServer?.address();assert.ok(address&&typeof address!=='string')
const browser=await chromium.launch({executablePath:process.env.CCL_CHROME_PATH,args:['--enable-webgl','--ignore-gpu-blocklist',...(process.platform==='darwin'?['--use-angle=metal']:[])]})
const url=`http://127.0.0.1:${address.port}/?seed=41&play=training`
const phase=(page:Page,value:string)=>page.waitForFunction(v=>document.querySelector('#game')?.getAttribute('data-phase')===v,value)
const errors:string[]=[]
async function hit(page:Page){
 await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
  const start=performance.now()
  function frame(){
   const needle=parseFloat(document.querySelector<HTMLElement>('#timing-needle')?.style.getPropertyValue('--timing')??'')
   if(document.querySelector('#game')?.getAttribute('data-phase')==='flight'&&needle>=49&&needle<=55){document.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',key:' ',bubbles:true}));resolve()}
   else if(performance.now()-start>15000)reject(new Error('Missed contact cue'));else requestAnimationFrame(frame)
  }requestAnimationFrame(frame)
 }))
}
try{
 const page=await browser.newPage({viewport:{width:1360,height:800}})
 page.on('pageerror',e=>errors.push(e.message))
 for(const loft of [false,true]){
  await page.goto(url);await phase(page,'windup')
  await page.locator('#pause-button').click();await page.locator('#auto-next').click()
  await page.locator('#scorecard-button').click()
  assert.ok((await page.locator('#scorecard-body').textContent())?.includes('not out'))
  await page.locator('#scorecard-close').click();await page.getByRole('button',{name:'Resume',exact:true}).click()
  if(loft)await page.locator('#loft-toggle').click()
  await hit(page);await phase(page,'dead')
  const score=await page.locator('#score').textContent()
  assert.equal(score,loft?'6/0':'4/0')
  await page.waitForFunction(()=>Boolean(window.cclTelemetry().graphics?.boundary))
  const first=await page.evaluate(()=>window.cclTelemetry().graphics!.boundary!)
  await page.waitForFunction(t=>(window.cclTelemetry().graphics?.boundary?.tick??0)>t+30,first.tick)
  const next=await page.evaluate(()=>window.cclTelemetry().graphics!.boundary!)
  assert.ok(Math.hypot(next.ball.x-first.ball.x,next.ball.z-first.ball.z)>.4,'ball continues beyond boundary')
  await page.locator('#pause-button').click()
  const paused=await page.evaluate(()=>window.cclTelemetry().graphics!.boundary!.tick)
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,180)))
  assert.equal(await page.evaluate(()=>window.cclTelemetry().graphics!.boundary!.tick),paused)
  await page.getByRole('button',{name:'Resume',exact:true}).click()
  await page.waitForFunction(()=>window.cclTelemetry().graphics?.boundary?.landed===true)
  await page.screenshot({path:`/tmp/ccl-${loft?'six':'four'}-landing.png`})
  assert.equal(await page.locator('#score').textContent(),score,'presentation cannot rescore a boundary')
  await page.locator('#pause-button').click();await page.locator('#scorecard-button').click()
  assert.equal(await page.locator('.scorecard-total').textContent(),score)
  assert.equal(await page.locator('.over-row').count(),1)
  await page.screenshot({path:`/tmp/ccl-scorecard-${loft?'six':'four'}.png`})
  await page.locator('#scorecard-close').click()
  await page.locator('#replay-button').click();await phase(page,'dead')
  await page.waitForFunction(()=>Boolean(window.cclTelemetry().graphics?.boundary))
  assert.equal(await page.locator('#score').textContent(),score)
 }
 // Deterministic multi-over, two-innings card fixture exercises the same renderer.
 await page.locator('#pause-button').click()
 await page.evaluate(async()=>{
  const rulesPath='/src/rules.ts', cardPath='/src/scorecard.ts'
  const {newInnings,applyDelivery}=await import(rulesPath)
  const {renderMatchScorecard}=await import(cardPath)
  const names=['Mehta','Rao','Singh','Iyer','Patel','Khan','Shah','Gill','Das','Reddy','Joshi']
  let first=newInnings(5,undefined,names)
  for(let i=0;i<24;i++){
   const runs=[0,4,1,0,6,2][i%6],wicket=i===8||i===19?'bowled':null
   first=applyDelivery(first,{batRuns:wicket?0:runs,wide:0,noBall:0,byes:0,legByes:0,wicket,completedRuns:runs<4?runs:0,reason:wicket?'bowled':runs>=4?'boundary':'fielded',contact:'middle',bowler:i<12?'Ward':'Brooks'})
  }
  const second=newInnings(5,first.runs+1,names)
  renderMatchScorecard(document.querySelector('#scorecard-body'),[{label:'SUNCREST',innings:first},{label:'RIDGEBACKS',innings:second}],0)
  const dialog=document.querySelector<HTMLDialogElement>('#scorecard-dialog')!;if(!dialog.open)dialog.showModal()
 })
 for(const [width,height] of [[1360,800],[800,450],[390,844]]){
  await page.setViewportSize({width,height})
  const dialog=await page.locator('#scorecard-dialog').boundingBox();assert.ok(dialog&&dialog.x>=0&&dialog.x+dialog.width<=width+1)
  assert.ok(await page.locator('#scorecard-close').isVisible())
  await page.screenshot({path:`/tmp/ccl-scorecard-${width}.png`})
 }
 await page.getByRole('button',{name:'2nd innings · RIDGEBACKS'}).click()
 assert.equal(await page.locator('.scorecard-total').textContent(),'0/0')
 assert.match(await page.locator('.scorecard-context').textContent()??'',/Target/)
 assert.deepEqual(errors,[])
 console.log('Score/boundary browser passed: four and six continue beyond rope, land, pause and replay without duplicate runs; live scorecard, over history, innings switching, desktop/landscape/portrait. No page errors.')
}finally{await browser.close();await server.close()}
