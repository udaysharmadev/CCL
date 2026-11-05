import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Vector3 } from 'three'
import { bladePose, elbowPosition, shotFamily, strikerRootZ } from '../src/batting-motion.ts'
import { SHOTS } from '../src/cricket.ts'

test('two-bone grip preserves arm lengths for both hands throughout a stroke', () => {
 for (const side of [-1, 1]) for (let t = 0; t <= 1; t += .025) {
  const shoulder = new Vector3(side * .223, .41, 0)
  const wrist = new Vector3(Math.sin(t)*.15, .1+t*.2, .18)
  const elbow = elbowPosition(shoulder,wrist,new Vector3(side*.5,.5,.3))
  assert.ok(Math.abs(shoulder.distanceTo(elbow)-.267)<1e-8)
  assert.ok(Math.abs(wrist.distanceTo(elbow)-.248)<1e-8)
 }
})
test('blade crosses real impact on contact frame and shot families have different follow-throughs', () => {
 const impact={x:.2,y:.6,z:.46}
 for(const shot of SHOTS) {
  const pose=bladePose(shot,5/60,impact,.64)
  assert.ok(pose.centre.distanceTo(new Vector3(.2,.6,.46))<1e-8)
  assert.ok(Math.abs(pose.shaft.length()-1)<1e-8)
 }
 assert.equal(shotFamily('cover-drive'),'drive')
 assert.equal(shotFamily('pull'),'cross')
 assert.equal(shotFamily('sweep'),'sweep')
 assert.equal(shotFamily('scoop'),'scoop')
 assert.notDeepEqual(bladePose('cover-drive',.4,impact,.64).centre,bladePose('sweep',.4,impact,.64).centre)
})

// Exercise the real scene hierarchy as well as the mathematical path. The old
// handle clamp passed path tests while the rendered blade missed the ball.
import { Scene, MeshLambertMaterial, MeshBasicMaterial } from 'three'
import { athlete, batterPose } from '../src/stadium.ts'

function batter() {
 const surface = new MeshLambertMaterial()
 const rig = athlete(new Scene(), {shirt:surface,pants:surface,trim:surface}, 'batter', 1, new MeshBasicMaterial())
 rig.base.position.set(.57,0,.08)
 return rig
}
function joints(rig: ReturnType<typeof batter>) {
 rig.base.updateWorldMatrix(true,true)
 return {
  hands:rig.arms.map(a=>a.hand.getWorldPosition(new Vector3())),
  feet:rig.legs.map(l=>l.ankle.getWorldPosition(new Vector3())),
  blade:rig.bat!.localToWorld(new Vector3(0,-.525,0)),
 }
}

test('guard is side-on with low hands, a near-ground toe and stable feet independent of shot or ball height', () => {
 const rig=batter()
 batterPose(rig,0,undefined,'drive',0,{x:.8,y:1.5,z:.46})
 const guard=joints(rig)
 for(const hand of guard.hands) assert.ok(hand.y>.65 && hand.y<.9, 'gloves belong near waist, never at the helmet')
 const toe=rig.bat!.localToWorld(new Vector3(0,-.835,0))
 assert.ok(toe.y>.025 && toe.y<.07)
 for(const foot of guard.feet) assert.ok(Math.abs(foot.y-.065)<1e-8)
 assert.ok(guard.feet[1].z-guard.feet[0].z>.3)
 assert.ok(Math.abs(rig.base.rotation.y+1.32)<1e-8)
 batterPose(rig,0,undefined,'pull',-2,{x:-.7,y:.15,z:.2})
 const other=joints(rig)
 assert.ok(other.blade.distanceTo(guard.blade)<1e-8)
 for(let i=0;i<2;i++) assert.ok(other.hands[i].distanceTo(guard.hands[i])<1e-8)
})

test('all 31 strokes retain two handle grips, fixed hip sockets and grounded shoes throughout the animation', () => {
 const rig=batter()
 for(const shot of SHOTS) for(const angle of [-2.5,-1.2,.65,2.5]) for(let frame=0;frame<=66;frame++) {
  batterPose(rig,0,frame/60,shot,angle,{x:.1,y:.55,z:.46},1)
  const state=joints(rig)
  rig.arms.forEach((arm,i)=>{
   const handle=rig.bat!.localToWorld(new Vector3(0,i===0?-.145:-.045,0))
   assert.ok(state.hands[i].distanceTo(handle)<.00001,`${shot} ${frame}: detached glove`)
   assert.ok(Math.abs(arm.shoulder.getWorldPosition(new Vector3()).distanceTo(arm.elbow.getWorldPosition(new Vector3()))-.267)<1e-8)
  })
  rig.legs.forEach((leg,i)=>{
   assert.ok(Math.abs(state.feet[i].y-.065)<.00001,`${shot} ${frame}: floating foot`)
   assert.equal(leg.hip.position.x,i===0?-.11:.11)
   assert.equal(leg.hip.position.z,0)
   assert.ok(Math.abs(Math.abs(leg.ankle.getWorldQuaternion(rig.base.quaternion.clone()).dot(rig.base.quaternion))-1)<1e-8)
  })
 }
})

test('rendered blade meets contact at low sweep, drive, high pull and scoop heights', () => {
 const rig=batter()
 for(const [shot,height,angle] of [['cover-drive',.55,.65],['sweep',.25,-1.4],['pull',1.05,-1.4],['scoop',.4,2.6]] as const) {
  const impact={x:.1,y:height,z:.46}
  batterPose(rig,0,5/60,shot,angle,impact,1)
  assert.ok(joints(rig).blade.distanceTo(new Vector3(impact.x,impact.y,impact.z))<.001,shot)
 }
})

test('front foot goes toward the bowler, back foot goes back, and recovery joins guard without a pop', () => {
 const rig=batter(), impact={x:.1,y:.55,z:.46}
 batterPose(rig,0,undefined,'drive',.65,impact,1)
 const pickup=joints(rig)
 batterPose(rig,0,0,'drive',.65,impact,1)
 assert.ok(joints(rig).blade.distanceTo(pickup.blade)<1e-8)
 batterPose(rig,0,5/60,'drive',.65,impact,1)
 const drive=joints(rig)
 assert.ok(drive.feet[1].z>pickup.feet[1].z+.3)
 assert.ok(Math.abs(drive.feet[1].x-impact.x)<Math.abs(pickup.feet[1].x-impact.x), 'front foot approaches the ball line even when placing the shot elsewhere')
 assert.ok(drive.feet[0].distanceTo(pickup.feet[0])<1e-8)
 batterPose(rig,0,5/60,'pull',-1.4,impact,1)
 const pull=joints(rig)
 assert.ok(pull.feet[0].z<pickup.feet[0].z-.2)
 assert.ok(pull.feet[1].distanceTo(pickup.feet[1])<1e-8)
 for(const shot of SHOTS) {
  batterPose(rig,0,1.0999,shot,.65,impact,1)
  const before=joints(rig)
  batterPose(rig,0,1.1,shot,.65,impact,1)
  const after=joints(rig)
  assert.ok(before.blade.distanceTo(after.blade)<.00001,shot)
  before.hands.forEach((hand,i)=>assert.ok(hand.distanceTo(after.hands[i])<.00001,shot))
 }
})


test('contact keeps the striker at guard until departure and completed runs use their actual end', () => {
 assert.ok(Math.abs(strikerRootZ(1.22,0,0)-.08)<1e-8)
 assert.ok(strikerRootZ(1.22001,.000001,0)-.08<.00002)
 assert.equal(strikerRootZ(3.5,.12,0),3.5)
 assert.equal(strikerRootZ(16,0,1),16)
 assert.equal(strikerRootZ(1.22,0,2),1.22)
})


test('a yorker meets the lower blade without driving the bat into the turf', () => {
 const rig=batter(), impact=new Vector3(.1,.10,.46)
 batterPose(rig,0,5/60,'defend',0,impact,1)
 joints(rig)
 const toe=rig.bat!.localToWorld(new Vector3(0,-.835,0))
 assert.ok(toe.y>.02)
 const ball=rig.bat!.worldToLocal(impact.clone())
 assert.ok(Math.abs(ball.x)<.001 && Math.abs(ball.z)<.001)
 assert.ok(ball.y>=-.835 && ball.y<=-.215)
})
