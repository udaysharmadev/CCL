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
}

const clamp = (n: number) => Math.max(0, Math.min(1, n))
const ease = (n: number) => { const x = clamp(n); return x * x * (3 - 2 * x) }

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
  const approach = running ? ease((p - .035) / .84) : following || phase === 'dead' ? 1 : 0
  const gather = running ? ease((p - .62) / .16) * (1 - ease((p - .84) / .13)) : 0
  const plant = running ? ease((p - .81) / .14) : following ? 1 - ease(releaseAge / .48) : 0
  const releaseBlend = running ? ease((p - .87) / .13) : following ? 1 - ease(releaseAge / .32) : 0
  const follow = following ? ease(releaseAge / .46) : 0
  const recover = following ? ease((releaseAge - .38) / .8) : phase === 'dead' ? 1 : 0
  const returnProgress = phase === 'dead' ? ease((releaseAge - .55) / 2.65) : 0
  const runAmount = running ? Math.sin(approach * Math.PI) * (spin ? .40 : .82) + .18 * approach * (1 - plant)
    : phase === 'dead' ? Math.sin(returnProgress * Math.PI) * .34 : 0
  const actionTwist = wristSpin ? .69 : profile.action === 'side-on' ? .57 : profile.action === 'sling' ? .43 : .30
  return {
    stage: running ? p < .07 ? 'mark' : p < .64 ? 'run' : p < .81 ? 'gather' : p < .92 ? 'plant' : 'release'
      : following ? releaseAge < .46 ? 'follow-through' : 'recover' : phase === 'dead' ? 'recover' : 'mark',
    spin, wristSpin,
    armIndex: profile.arm === 'left' ? 1 : 0,
    frontFootIndex: profile.arm === 'left' ? 0 : 1,
    runDistance,
    distanceRemaining: phase === 'dead' ? -(spin ? .72 : 1.42) + (runDistance + (spin ? .72 : 1.42)) * returnProgress
      : (1 - approach) * runDistance - (following ? (spin ? .72 : 1.42) * ease(releaseAge / .85) : 0),
    stride: phase === 'dead' ? returnProgress * (runDistance + 1.42) * 4.4 : approach * runDistance * (spin ? 4.5 : 3.4), runAmount, gather, plant, releaseBlend, follow,
    lean: (spin ? .04 : .11) * approach + (following ? Math.sin(follow * Math.PI) * .39 * (1 - recover) : 0),
    twist: side * (gather * actionTwist - releaseBlend * .10 - (following ? Math.sin(follow * Math.PI) * .27 * (1 - recover) : 0)),
    armArc: side * (profile.action === 'sling' ? .88 : wristSpin ? .58 : profile.action === 'finger-spin' ? .35 : .14),
    wrist: side * (wristSpin ? -.70 : spin ? .30 : profile.action === 'sling' ? -.20 : .08),
  }
}
