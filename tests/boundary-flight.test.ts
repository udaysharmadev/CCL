import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Delivery, PITCH_LENGTH, type Shot } from '../src/cricket.ts'
function boundary(shot:Shot){
 const sim=new Delivery({seed:41,kind:'fast',line:.2})
 for(let i=0;i<1200&&!sim.outcome;i++){if(sim.tick===sim.contactTick)sim.swing({kind:shot,aim:0,power:1});sim.step()}
 assert.equal(sim.outcome?.reason,'boundary');return sim
}
test('a six flies beyond the rope, lands, bounces and settles without altering the scored delivery',()=>{
 const sim=boundary('loft'), original=JSON.stringify({ball:sim.ball,outcome:sim.outcome,tick:sim.tick})
 const flight=sim.boundaryFlight()!, replay=sim.boundaryFlight()!
 const rope={...flight.ball};let highestAfterBounce=0;let landing:typeof rope|undefined
 for(let i=0;i<900;i++){
  flight.step();replay.step()
  if(flight.landedAt!==null){landing??={...flight.ball};highestAfterBounce=Math.max(highestAfterBounce,flight.ball.y)}
 }
 assert.ok(landing);assert.ok(Math.hypot(landing.x,landing.z-PITCH_LENGTH/2)>64)
 assert.ok(Math.hypot(landing.x-rope.x,landing.z-rope.z)>2);assert.ok(highestAfterBounce>.1)
 assert.ok(flight.settled);assert.deepEqual(flight.ball,replay.ball)
 assert.equal(JSON.stringify({ball:sim.ball,outcome:sim.outcome,tick:sim.tick}),original)
})
test('a four rolls beyond the rope and a solid perimeter rebounds it',()=>{
 const sim=boundary('drive'),flight=sim.boundaryFlight()!,start={...flight.ball}
 for(let i=0;i<60;i++)flight.step()
 assert.ok(Math.hypot(flight.ball.x-start.x,flight.ball.z-start.z)>1)
 assert.ok(flight.grounded)
 const rebound=sim.boundaryFlight()!
 for(let i=0;i<180;i++)rebound.step(p=>Math.hypot(p.x,p.z-PITCH_LENGTH/2)>=68?1.4:0)
 assert.ok(rebound.velocity.z<0)
 assert.equal(sim.outcome?.batRuns,4)
 assert.equal(new Delivery({seed:1,kind:'fast'}).boundaryFlight(),null)
})
