import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Delivery, type DeliveryOptions, type FieldingCommand } from '../src/cricket.ts'

const options: DeliveryOptions = {seed:41,kind:'fast',effort:.63,fieldingMode:'manual'}
function delivery(settings=options) {
 const sim=new Delivery(settings)
 while(sim.tick<sim.contactTick) sim.step()
 sim.swing({kind:'defend',aim:-1.35,power:.7})
 while(sim.phase==='flight' && !sim.outcome) sim.step()
 assert.equal(sim.phase,'field')
 return sim
}

test('manual fielder waits for movement and obeys legal destination without teleporting', () => {
 const sim=delivery()
 const index=sim.activeFielder
 const start={...sim.fielders[index]}
 for(let i=0;i<12;i++) sim.step()
 assert.deepEqual(sim.fielders[index],start)
 assert.equal(sim.fieldControl({type:'move',x:NaN,z:0}),false)
 assert.equal(sim.fieldControl({type:'move',x:1000,z:0}),false)
 assert.equal(sim.fieldControl({type:'select',index:-1}),false)
 assert.equal(sim.fieldControl({type:'throw',end:'striker'}),false)
 assert.ok(sim.fieldControl({type:'move',x:start.x+3,z:start.z+3}))
 sim.step()
 const moved=Math.hypot(sim.fielders[index].x-start.x,sim.fielders[index].z-start.z)
 assert.ok(moved>0 && moved<.12)
 assert.ok(sim.fieldControl({type:'select',index:(index+1)%9}))
 assert.equal(sim.activeFielder,(index+1)%9)
})

test('pickup holds the live ball until a throw is called; both ends replay exactly', () => {
 for(const end of ['striker','bowler'] as const) {
  const sim=delivery()
  const commands: {tick:number;command:FieldingCommand}[]=[]
  function command(value:FieldingCommand) {
   assert.ok(sim.fieldControl(value)); commands.push({tick:sim.tick,command:value})
  }
  command({type:'chase'})
  while(sim.action!=='hold' && !sim.outcome && sim.tick<700) sim.step()
  assert.equal(sim.action,'hold')
  const runs=sim.completedRuns
  for(let i=0;i<20;i++) sim.step()
  assert.equal(sim.outcome,null)
  assert.ok(sim.completedRuns>=runs)
  command({type:'throw',end})
  while(!sim.outcome && sim.tick<1400) sim.step()
  assert.ok(sim.outcome)
  assert.equal(sim.throwTarget,end)
  assert.ok(sim.wicketBroken)
  assert.equal(sim.fieldControl({type:'chase'}),false)
  const replay=new Delivery(options)
  while(!replay.outcome && replay.tick<1400) {
   if(replay.tick===replay.contactTick) replay.swing({kind:'defend',aim:-1.35,power:.7})
   for(const input of commands) if(input.tick===replay.tick) assert.ok(replay.fieldControl(input.command))
   replay.step()
  }
  assert.deepEqual(replay.outcome,sim.outcome)
  assert.deepEqual(replay.ball,sim.ball)
  assert.deepEqual(replay.fielders,sim.fielders)
 }
})

test('delaying the return allows runs and an unattended hold eventually returns to the keeper', () => {
 const sim=delivery()
 sim.fieldControl({type:'chase'})
 while(!sim.outcome && sim.tick<1600) sim.step()
 assert.ok(sim.outcome)
 assert.ok(sim.completedRuns>0)
 assert.equal(sim.throwTarget,'striker')
 const auto=new Delivery({...options,fieldingMode:undefined})
 assert.equal(auto.fieldControl({type:'chase'}),false)
})

test('manual interceptions still produce real catches, boundaries and keeper-end run-outs', () => {
 for (const [kind,aim,expected] of [['drive',.94,'caught'],['loft',0,'boundary'],['defend',0,'run-out']] as const) {
  const sim=new Delivery({seed:41,kind:'fast',fieldingMode:'manual'})
  while(!sim.outcome && sim.tick<1400) {
   if(sim.tick===sim.contactTick) sim.swing({kind,aim,power:1})
   if(sim.action==='chase') sim.fieldControl({type:'chase'})
   if(sim.action==='hold') sim.fieldControl({type:'throw',end:'striker'})
   sim.step()
  }
  assert.equal(sim.outcome?.reason,expected)
  if(expected==='run-out') {assert.ok(sim.wicketBroken);assert.ok(sim.runnerPositions.every(z=>z>1.22))}
  if(expected==='boundary') assert.equal(sim.outcome?.batRuns,6)
 }
})
