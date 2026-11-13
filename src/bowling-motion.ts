/** Original, presentation-only bowling choreography. Physics supplies the release
 * point; this sampler never writes to the delivery, clock, random stream or score. */
export type BowlingAppearance = {
  arm: 'right' | 'left'
  type: string
  action: string
  side?: 'over' | 'around'
}

export type BowlingMotion = {
  stage: 'mark' | 'run' | 'gather' | 'plant' | 'release' | 'follow-through' | 'recover'
  spin: boolean
  wristSpin: boolean
  armIndex: 0 | 1
  frontFootIndex: 0 | 1
  runDistance: number
  distanceRemaining: number
  stride: number
  runAmount: number
  gather: number
  plant: number
  releaseBlend: number
  follow: number
  lean: number
  twist: number
  armArc: number
  wrist: number
  armCircle: number
  recovery: number
  rearSweep: number
}

const clamp = (n: number) => Math.max(0, Math.min(1, n))
const ease = (n: number) => { const x = clamp(n); return x * x * (3 - 2 * x) }

/** Integral of an eased speed ramp: accelerate, travel, then brake into the crease.
 * A distance-based stride keeps the shoes in step with the approach at any FPS. */
function approachDistance(progress: number) {
  const x = clamp((progress - .035) / .965), acceleration = .18, braking = .14
  const total = 1 - (acceleration + braking) / 2
  if (x < acceleration) { const u = x / acceleration; return acceleration * (u ** 3 - u ** 4 / 2) / total }
  if (x > 1 - braking) { const u = (1 - x) / braking; return 1 - braking * (u ** 3 - u ** 4 / 2) / total }
  return (x - acceleration / 2) / total
}

export function isSpinAction(type: string) {
  return ['off-spin', 'leg-spin', 'left-arm-orthodox', 'left-arm-wrist-spin'].includes(type)
}

/** At progress=1 the wrist is solved onto the authoritative release point.
 * Follow-through is sampled using delivery ticks, so pause/replay cannot advance it. */
export function sampleBowlingMotion(profile: BowlingAppearance, phase: string, progress = 0, releaseAge = 0): BowlingMotion {
  const spin = isSpinAction(profile.type)
  const wristSpin = profile.action === 'wrist-spin' || profile.type === 'leg-spin' || profile.type === 'left-arm-wrist-spin'
  const medium = profile.type === 'medium' || profile.type === 'medium-fast'
  // The rig faces local +Z: its anatomical right shoulder is local -X.
  const side = profile.arm === 'left' ? 1 : -1
  const runDistance = spin ? wristSpin ? 3.3 : 2.8 : medium ? 6.2 : profile.action === 'sling' ? 8.8 : 8.1
  const p = clamp(progress)
  const running = phase === 'windup'
  const following = phase === 'flight' || phase === 'field'
  const approach = running ? approachDistance(p) : following || phase === 'dead' ? 1 : 0
  const gather = running ? ease((p - .60) / .14) * (1 - ease((p - .81) / .15)) : 0
  const plant = running ? ease((p - .80) / .16) : following ? 1 - ease((releaseAge - .12) / .50) : 0
  const releaseBlend = running ? ease((p - .89) / .11) : following ? 1 - ease(releaseAge / .28) : 0
  const follow = following ? ease(releaseAge / .66) : 0
  const recover = following ? ease((releaseAge - .48) / .86) : phase === 'dead' ? 1 : 0
  const returnProgress = phase === 'dead' ? ease((releaseAge - .55) / 2.65) : 0
  const followDistance = spin ? 1.0 : 2.45
  const runAmount = running ? ease((p - .04) / .19) * (1 - ease((p - .63) / .30)) * (spin ? .43 : .86)
    : phase === 'dead' ? Math.sin(returnProgress * Math.PI) * .34 : 0
  const actionTwist = wristSpin ? .69 : profile.action === 'side-on' ? .57 : profile.action === 'sling' ? .43 : .30
  return {
    stage: running ? p < .07 ? 'mark' : p < .64 ? 'run' : p < .81 ? 'gather' : p < .92 ? 'plant' : 'release'
      : following ? releaseAge < .46 ? 'follow-through' : 'recover' : phase === 'dead' ? 'recover' : 'mark',
    spin, wristSpin,
    armIndex: profile.arm === 'left' ? 1 : 0,
    frontFootIndex: profile.arm === 'left' ? 0 : 1,
    runDistance,
    distanceRemaining: phase === 'dead' ? -followDistance + (runDistance + followDistance) * returnProgress
      : (1 - approach) * runDistance - (following ? followDistance * ease(releaseAge / 1.18) : 0),
    stride: phase === 'dead' ? returnProgress * (runDistance + followDistance) * 4.4
      : approach * runDistance * (spin ? 4.5 : 3.4) + (following ? followDistance * ease(releaseAge / 1.18) * 3.4 : 0),
    runAmount, gather, plant, releaseBlend, follow,
    lean: (spin ? .04 : .11) * approach * (1 - recover) + gather * (spin ? .025 : .07)
      + (following ? Math.sin(follow * Math.PI) * (spin ? .19 : .43) * (1 - recover) : 0),
    twist: side * (gather * actionTwist - releaseBlend * .10 - (following ? Math.sin(follow * Math.PI) * .27 * (1 - recover) : 0)),
    armArc: side * (profile.action === 'sling' ? .88 : wristSpin ? .58 : profile.action === 'finger-spin' ? .35 : .14),
    wrist: side * (wristSpin ? -.70 : spin ? .30 : profile.action === 'sling' ? -.20 : .08),
    armCircle: running ? ease((p - .68) / .32) : following ? 1 + follow : 0,
    recovery: recover,
    rearSweep: following ? Math.sin(follow * Math.PI) * (1 - recover) : 0,
  }
}
