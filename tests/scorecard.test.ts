import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyDelivery, newInnings, type DeliveryOutcome } from '../src/rules.ts'
import { batterStatus, overSummary, totalRuns } from '../src/scorecard.ts'
const dot: DeliveryOutcome={batRuns:0,wide:0,noBall:0,byes:0,legByes:0,wicket:null,completedRuns:0,reason:'fielded',contact:'middle',bowler:'Ward'}
const names=Array.from({length:11},(_,i)=>`Batter ${i+1}`)

test('scorecard distinguishes active ducks from players yet to bat',()=>{
 let state=newInnings(2,undefined,names)
 assert.equal(batterStatus(state,0),'not out');assert.equal(batterStatus(state,1),'not out');assert.equal(batterStatus(state,2),'yet to bat')
 state=applyDelivery(state,dot)
 assert.equal(batterStatus(state,0),'not out')
 state=applyDelivery(state,{...dot,wicket:'bowled',reason:'bowled'})
 assert.equal(batterStatus(state,0),'bowled');assert.equal(batterStatus(state,2),'not out')
})
test('run-out retains the striker runs and ball while dismissing the correct batter',()=>{
 for(const dismissedBatter of ['striker','nonStriker'] as const){
  const s=applyDelivery(newInnings(2,undefined,names),{...dot,batRuns:1,completedRuns:1,wicket:'run-out',reason:'run-out',dismissedBatter})
  assert.equal(s.batting[0].runs,1);assert.equal(s.batting[0].balls,1)
  assert.equal(s.batting[dismissedBatter==='striker'?0:1].dismissed,true)
  assert.equal(s.bowling[0].wickets,0)
  assert.equal(s.batting.reduce((n,b)=>n+b.runs,0),s.runs)
 }
})
test('extras reconcile across team, bowler, partnerships and over totals, with only six legal balls',()=>{
 let s=newInnings(2,undefined,names)
 for(const ball of [{...dot,wide:3}, {...dot,noBall:1,batRuns:4,reason:'boundary' as const}, {...dot,byes:2}, ...Array.from({length:5},()=>dot)]) s=applyDelivery(s,ball)
 assert.equal(s.runs,10);assert.equal(s.bowling[0].runs,8);assert.equal(s.partnerships[0].runs,10)
 assert.equal(s.legalBalls,6);assert.equal(s.bowling[0].maidens,0)
 const over=overSummary(s)[0];assert.equal(over.runs,10);assert.equal(over.balls.length,8);assert.equal(over.legal,6)
 assert.equal(s.history.reduce((n,b)=>n+totalRuns(b),0),10)
})
test('maidens and all ten falls of wicket are recorded',()=>{
 let s=newInnings(3,undefined,names)
 for(let i=0;i<6;i++)s=applyDelivery(s,{...dot,byes:i===1?1:0})
 assert.equal(s.bowling[0].maidens,1)
 for(let i=0;i<10;i++)s=applyDelivery(s,{...dot,wicket:'bowled',reason:'bowled'})
 assert.equal(s.fallOfWickets.length,10);assert.equal(s.wickets,10);assert.equal(s.complete,true)
})
test('partial online history does not claim complete over totals',()=>{
 let s=newInnings(5,undefined,names)
 for(let i=0;i<15;i++)s=applyDelivery(s,dot)
 const recent={...s,history:s.history.slice(-8)}
 const overs=overSummary(recent)
 assert.equal(overs[0].number,2);assert.equal(overs[0].partial,true);assert.equal(overs[1].number,3)
})
