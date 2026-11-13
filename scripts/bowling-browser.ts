import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { chromium, type Page } from 'playwright-core'
import { build, preview } from 'vite'
import type { BowlingExecution } from '../src/bowling.ts'
import type { Innings } from '../src/rules.ts'
import type {} from '../src/main.ts'

type State = { phase: string; tick: number | null; contactTick: number | null; windup: number; paused: boolean; replaying: boolean; entrance: number | null; innings: Innings; execution: BowlingExecution | null; release: { position: {x:number;y:number;z:number};velocity:{x:number;y:number;z:number} } | null; ball:{x:number;y:number;z:number}|null; feedback:unknown; selection:boolean; bowler:string|null }
declare global { interface Window { __cclBowlingQA: () => State } }
const outDir = await mkdtemp(join(tmpdir(), 'ccl-bowling-'))
const safe = relative(tmpdir(), outDir)
assert.ok(!isAbsolute(safe) && !safe.startsWith('..') && safe.startsWith('ccl-bowling-'))
const directory = resolve(process.env.CCL_QA_DIR ?? 'docs/bowling-evidence/after')
await mkdir(directory, { recursive: true })
const observer = `\nwindow.__cclBowlingQA = () => ({ phase,tick:live?.tick??null, contactTick:live?.contactTick??null,windup:elapsed,paused,replaying,entrance:entranceAge??null,innings:currentInnings(),execution:record?.options.bowling??null,release:live?.release??null,ball:live?.ball??null,feedback:live?.bowlingFeedback??null,selection:playerSelection.open,bowler:match?.selectedBowler?.playerId??null });`
let server: Awaited<ReturnType<typeof preview>>|undefined, browser: Awaited<ReturnType<typeof chromium.launch>>|undefined
const checks:string[] = [], issues:string[] = [], evidence:Record<string,unknown> = {}
const state = (page:Page) => page.evaluate(() => window.__cclBowlingQA())
async function until(page:Page, predicate:(value:State)=>boolean, label:string, step=80) {
  for(let i=0;i<900;i++) { const v=await state(page); if(predicate(v)) return v; await page.clock.fastForward(step) }
  throw new Error(`${label}: ${JSON.stringify(await state(page))}`)
}
async function capture(page:Page,name:string) { await page.waitForTimeout(60); await page.clock.runFor(32); await page.screenshot({path:resolve(directory,`${name}.png`)}); evidence[name]=await state(page); await writeFile(resolve(directory,'progress.json'),JSON.stringify(evidence,null,2)); console.log(`Captured ${name}`) }
async function startBowling(page:Page) {
  await page.locator('#setup-button').click(); await page.locator('#setup-toss').selectOption('bowl')
  await page.getByRole('button',{name:'Start match'}).click(); await page.locator('#player-choice-dialog[open]').waitFor()
}
async function bowl(page:Page, index:number) {
  await page.clock.runFor(32)
  await page.locator('#bowl-execute').click()
  assert.equal((await state(page)).phase, 'windup', 'first press starts the actual run-up')
  if(index===0) { await page.clock.runFor(1400); await capture(page,'06-fast-runup') }
  await page.clock.runFor(Math.max(0, 2760 - (await state(page)).windup * 1000))
  await page.locator('#bowl-execute').click()
  const configured=await state(page); assert.ok(configured.execution); assert.equal(configured.phase,'windup')
  assert.ok(configured.execution.release>=.95, 'release near the crease earns perfect timing')
  const release=await until(page,s=>s.phase==='flight','release',16)
  assert.ok(release.release); assert.equal(release.release.position.x, release.execution!.arm==='right' ? (release.execution!.side==='over'?.48:-.92) : (release.execution!.side==='over'?-.48:.92))
  if(index===0) await capture(page,'07-fast-release')
  if(index===0 || index===6) { await page.clock.runFor(160); await capture(page,index===0?'08-fast-flight':'11-spin-flight') }
  const dead=await until(page,s=>s.phase==='dead','dead ball',120)
  if(page.locator('#drs-dialog[open]')) {
    if(await page.locator('#drs-dialog').evaluate((e:HTMLDialogElement)=>e.open)) await page.locator('#drs-actions button').click()
  }
  return dead
}
try {
  await build({configLoader:'native',build:{outDir,emptyOutDir:true},plugins:[{name:'bowling-read-observer',enforce:'pre',transform(code,id){if(id.replaceAll('\\','/').endsWith('/src/main.ts'))return {code:code+observer,map:null}}}]})
  server=await preview({configLoader:'native',build:{outDir},preview:{host:'127.0.0.1',port:0}})
  const address=server.httpServer.address();assert.ok(address&&typeof address!=='string')
  browser=await chromium.launch({executablePath:process.env.CCL_CHROME_PATH,args:process.env.CCL_SOFTWARE_GPU==='1'?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:['--ignore-gpu-blocklist','--enable-webgl']})
  const page=await browser.newPage({viewport:{width:1100,height:760},deviceScaleFactor:1,reducedMotion:'reduce'})
  page.on('pageerror',e=>issues.push(e.message));page.on('console',e=>{if(e.type()==='error')issues.push(e.text())})
  await page.clock.install({time:new Date('2026-11-08T00:00:00Z')}); await page.clock.pauseAt(new Date('2026-11-08T00:00:01Z'))
  await page.goto(`http://127.0.0.1:${address.port}/?seed=41`);await page.locator('#solo-button:enabled').waitFor()
  await page.locator('#settings-button').click();await page.locator('#setting-quality').selectOption('low');await page.keyboard.press('Escape')
  await startBowling(page); await capture(page,'01-bowler-selection')
  assert.ok(await page.locator('[data-player-id="Mehta"]').isDisabled());checks.push('non-bowling specialist unavailable with reason')
  await page.locator('[data-player-id="Khan"]').click();await page.clock.runFor(600)
  await capture(page,'02-fast-hud')
  assert.equal(await page.locator('[data-variation="googly"]').count(),0);assert.ok(await page.locator('[data-variation="yorker"]').isVisible());checks.push('fast bowler capabilities shown without spin variations')
  await page.getByRole('button',{name:'Around the wicket',exact:true}).click()
  const target=await page.locator('#pitch-target-map').boundingBox();assert.ok(target)
  await page.mouse.click(target.x+target.width*.65,target.y+target.height*.75)
  await capture(page,'03-pitch-target')
  await page.setViewportSize({width:390,height:844});await page.clock.runFor(32);await capture(page,'04-fast-mobile')
  const bounds=await page.locator('#bowling-studio').boundingBox(), score=await page.locator('#scoreboard').boundingBox();assert.ok(bounds&&score);assert.ok(bounds.x>=0&&bounds.x+bounds.width<=391&&bounds.y+bounds.height<=score.y);checks.push('portrait bowling HUD inside viewport and above score strip')
  await page.setViewportSize({width:800,height:450});await page.clock.runFor(32);await capture(page,'05-fast-landscape')
  await page.setViewportSize({width:1100,height:760});await page.clock.runFor(32)
  let latest=await bowl(page,0);assert.equal(latest.execution?.arm,'left');assert.equal(latest.execution?.side,'around');assert.ok(latest.innings.attempts===1);checks.push('timed left-arm around-wicket delivery releases and scores through simulation')
  const scoreBefore=JSON.stringify(latest.innings)
  await page.locator('#pause-button').click();await page.locator('#replay-button').click();await until(page,s=>s.replaying&&s.phase==='dead','replay',120)
  assert.equal(JSON.stringify((await state(page)).innings),scoreBefore);checks.push('local replay preserves the recorded execution and does not rescore')
  await page.locator('#next-button').click();await page.clock.runFor(32)
  for(let i=1;i<10;i++) {
    if((await state(page)).innings.legalBalls>=6) break
    latest=await bowl(page,i)
  }
  await until(page,s=>s.selection,'over selector',100)
  assert.ok(await page.locator('[data-player-id="Khan"]').isDisabled());checks.push('six legal balls trigger selection and consecutive-over restriction')
  await page.locator('[data-player-id="Shah"]').click();await page.clock.runFor(32)
  assert.equal(await page.locator('[data-variation="yorker"]').count(),0);assert.ok(await page.locator('[data-variation="googly"]').isVisible())
  await page.locator('[data-variation="googly"]').click();await capture(page,'09-spin-hud')
  await page.setViewportSize({width:390,height:844});await page.clock.runFor(32);await capture(page,'10-spin-mobile');await page.setViewportSize({width:1100,height:760});await page.clock.runFor(32)
  latest=await bowl(page,6);assert.equal(latest.execution?.variation,'googly');checks.push('wrist spinner exposes and executes a real googly')
  await page.locator('#pause-button').click();await page.getByRole('button',{name:'Return to stadium',exact:true}).click();await page.clock.runFor(32)
  await page.locator('#setup-button').click();await page.locator('#setup-toss').selectOption('bat');await page.getByRole('button',{name:'Start match'}).click()
  await page.locator('[data-player-id="Singh"]').click();await page.locator('[data-player-id="Mehta"]').click()
  await page.clock.runFor(500);await capture(page,'12-batter-entrance');await until(page,s=>s.phase==='windup','new batter entry',50);await capture(page,'13-left-handed-stance')
  const batting=await state(page);assert.equal(batting.innings.striker,3);assert.equal(batting.innings.nonStriker,1);assert.equal(batting.execution?.batterHand,'left');checks.push('opening pair selection carries left-handed identity into delivery')
  // Leaving every actual delivery lets the physics produce a real dismissal.
  for(let i=0;i<18;i++) {
    const result=await until(page,s=>s.phase==='dead'||s.selection,'batting result',100)
    if(result.innings.selection?.pendingBatter||result.selection)break
    if(result.innings.complete)break
    if(await page.locator('#review-hint').isVisible())await page.clock.runFor(6200)
    if((await state(page)).selection)break
    if(await page.locator('#next-button').isVisible())await page.locator('#next-button').click()
  }
  const wicket=await until(page,s=>s.selection||s.innings.complete,'incoming batter',100)
  assert.ok(wicket.selection,'a real unplayed delivery should produce a replacement gate')
  await capture(page,'14-wicket-replacement')
  const enabled=page.locator('#player-choice-dialog .player-choice-card:enabled').first();await enabled.click();await page.clock.runFor(450);await capture(page,'15-replacement-entry')
  assert.equal((await state(page)).innings.selection?.pendingBatter,null);checks.push('real wicket opens replacement, survivor identity retained and incoming batter enters')
  evidence.telemetry=await page.evaluate(()=>window.cclTelemetry());checks.push('browser completed without console or page errors');assert.deepEqual(issues,[])
  await writeFile(resolve(directory,'checks.json'),JSON.stringify({browser:browser.version(),checks,issues,evidence},null,2))
  console.log(JSON.stringify({passed:checks.length,checks,issues,directory},null,2))
} catch(error) {
  await writeFile(resolve(directory,'checks.json'),JSON.stringify({passed:checks.length,checks,issues,error:String(error),evidence},null,2));throw error
} finally { await browser?.close();await server?.close();await rm(outDir,{recursive:true,force:true}) }
