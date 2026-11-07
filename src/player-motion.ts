/** Presentation-only motion. Positions and time are observations, never simulation inputs. */
export type PlayerMotion = {
  initialized: boolean
  x: number
  z: number
  time: number
  initialPhase: number
  initialYaw: number
  phase: number
  speed: number
  amount: number
  yaw: number
  swing: number
  lift: number
  lean: number
  bank: number
}

const TAU = Math.PI * 2
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))

export function createPlayerMotion(yaw = 0, phase = 0): PlayerMotion {
  return { initialized: false, x: 0, z: 0, time: 0, initialPhase: phase, initialYaw: yaw, phase, speed: 0, amount: 0, yaw, swing: 0, lift: 0, lean: 0, bank: 0 }
}

/**
 * Reuse one state per athlete. Sample against simulation time so a second render
 * of the same tick cannot alter the gait, and pausing freezes essential motion.
 * Stride phase follows distance, not a shared wall clock. The speed envelope
 * eases the body into a sprint and settles it on arrival without moving the feet
 * toward a different authoritative target. Reset on a new delivery or replay seek.
 */
export function samplePlayerMotion(state: PlayerMotion, x: number, z: number, time: number, reset = false): PlayerMotion {
  const elapsed = time - state.time
  const distance = Math.hypot(x - state.x, z - state.z)
  if (!state.initialized || reset || elapsed < 0 || elapsed > .5 || (elapsed > 0 && distance > elapsed * 14 + .35)) {
    state.initialized = true
    state.x = x
    state.z = z
    state.time = time
    state.phase = state.initialPhase
    state.yaw = state.initialYaw
    state.speed = state.amount = state.swing = state.lift = state.lean = state.bank = 0
    return state
  }
  if (elapsed <= 0) return state

  const speed = distance / elapsed
  const previousSpeed = state.speed
  const blend = 1 - Math.exp(-elapsed * 16)
  state.speed += (speed - state.speed) * blend
  state.amount = clamp(state.speed / 6.2, 0, 1)
  if (state.amount < .003) state.amount = state.speed = 0
  if (distance > .00001) {
    const direction = Math.atan2(x - state.x, z - state.z)
    const turn = Math.atan2(Math.sin(direction - state.yaw), Math.cos(direction - state.yaw))
    const rotation = clamp(turn, -elapsed * 12, elapsed * 12)
    state.yaw += rotation
    state.bank += (clamp(-rotation / elapsed * .012, -.10, .10) * state.amount - state.bank) * blend
    // A longer stride accompanies higher speed; independent distances also
    // keep the slower partner visibly distinct from the faster striker.
    state.phase = (state.phase + distance / (1.35 + Math.min(speed, 9) * .23) * TAU) % TAU
  } else state.bank *= 1 - blend
  state.swing = Math.sin(state.phase) * state.amount
  state.lift = (.5 - Math.cos(state.phase * 2) * .5) * .042 * state.amount
  state.lean = .13 * state.amount + clamp((state.speed - previousSpeed) * .08, -.05, .07)
  state.x = x
  state.z = z
  state.time = time
  return state
}

export type FieldingMotion = {
  action: string
  started: number
  time: number
  crouch: number
  bend: number
  throwArm: number
  guideArm: number
  twist: number
}

export function createFieldingMotion(): FieldingMotion {
  return { action: '', started: 0, time: 0, crouch: 0, bend: 0, throwArm: 0, guideArm: 0, twist: 0 }
}

const ease = (value: number) => {
  const t = clamp(value, 0, 1)
  return t * t * (3 - 2 * t)
}

/** Pickup, set, release and follow-through use the observed action transition. */
export function sampleFieldingMotion(state: FieldingMotion, action: string, time: number, reset = false): FieldingMotion {
  if (reset || state.action !== action || time < state.time) {
    state.action = action
    state.started = time
  }
  state.time = time
  const age = Math.max(0, time - state.started)
  state.crouch = state.bend = state.throwArm = state.guideArm = state.twist = 0
  if (action === 'pickup') {
    // The ball is gathered at the start; uncoil into the set position while
    // the simulation runs its existing 16-tick pickup interval.
    const rise = ease(age / .26)
    state.crouch = .25 * (1 - rise) + .045 * rise
    state.bend = .55 * (1 - rise) + .13 * rise
    state.throwArm = -.78 - rise * 1.25
    state.guideArm = -.78 - rise * .22
    state.twist = -.24 * rise
  } else if (action === 'hold') {
    state.crouch = .045
    state.bend = .13
    state.throwArm = -2.03
    state.guideArm = -1
    state.twist = -.24
  } else if (action === 'return') {
    const release = ease(age / .15)
    const recovery = ease((age - .18) / .48)
    state.crouch = .045 * (1 - release)
    state.bend = .13 + Math.sin(release * Math.PI) * .24 * (1 - recovery)
    state.throwArm = (-2.03 + release * 2.8) * (1 - recovery)
    state.guideArm = -1 * (1 - release) * (1 - recovery)
    state.twist = (-.24 + release * .49) * (1 - recovery)
  }
  return state
}
