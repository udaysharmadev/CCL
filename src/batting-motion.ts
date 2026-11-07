import { Vector3 } from 'three'
import type { Shot, Vec3 } from './cricket.ts'

export function shotFamily(shot: Shot) {
  if (shot.includes('defen') || shot === 'leave' || shot === 'duck') return 'defense'
  if (shot.includes('sweep') || shot === 'switch-hit') return 'sweep'
  if (shot.includes('scoop') || shot.includes('ramp')) return 'scoop'
  if (shot.includes('cut') || shot === 'pull' || shot === 'hook') return 'cross'
  if (shot === 'helicopter') return 'helicopter'
  return 'drive'
}

export function smooth(value: number) {
  const n = Math.max(0, Math.min(1, value))
  return n * n * (3 - 2 * n)
}

/** Two-link joint. Callers keep the endpoint inside reach; a stable pole avoids flipping. */
export function elbowPosition(shoulder: Vector3, wrist: Vector3, pole: Vector3, upper = .267, lower = .248) {
  const axis = wrist.clone().sub(shoulder)
  const distance = Math.max(.0001, axis.length())
  axis.divideScalar(distance)
  const reach = Math.max(Math.abs(upper - lower) + .0001, Math.min(upper + lower - .0001, distance))
  const along = (upper * upper - lower * lower + reach * reach) / (2 * reach)
  const bend = pole.clone().sub(shoulder)
  bend.addScaledVector(axis, -bend.dot(axis))
  if (bend.lengthSq() < .000001) bend.set(0, 0, 1).addScaledVector(axis, -axis.z)
  if (bend.lengthSq() < .000001) bend.set(1, 0, 0)
  return shoulder.clone().addScaledVector(axis, along).addScaledVector(bend.normalize(), Math.sqrt(Math.max(0, upper * upper - along * along)))
}

/** Relative to the crease, in pitch axes: low guard, then a compact pickup behind the back foot. */
export function guardPose(time: number, preparation = 0, hand: 'right' | 'left' = 'right') {
  const lift = smooth(preparation)
  const side = hand === 'left' ? -1 : 1
  const waggle = Math.sin(time * 3.2) * .008 * (1 - lift)
  return {
    centre: new Vector3(-.30 * side, .36 + waggle, .08).lerp(new Vector3(-.30 * side, .69, -.24), lift),
    shaft: new Vector3(.04 * side, 1, -.04).lerp(new Vector3(-.12 * side, .70, .70), lift).normalize(),
  }
}

/** Contact-relative stroke. The renderer blends from its prepared guard and back to guard. */
export function bladePose(shot: Shot, age: number, impact: Vec3, angle: number, hand: 'right' | 'left' = 'right') {
  const side = hand === 'left' ? -1 : 1
  const family = shotFamily(shot)
  const direction = new Vector3(Math.sin(angle), 0, Math.cos(angle))
  const contact = new Vector3(impact.x, impact.y, impact.z)
  const cross = family === 'cross' || family === 'sweep'
  const defensive = family === 'defense'
  const finish = contact.clone().addScaledVector(direction, defensive ? .10 : cross ? .48 : .32)
  finish.y += defensive ? .04 : family === 'sweep' ? .16 : family === 'cross' ? .30 : .95
  const contactTime = 5 / 60
  const follow = smooth((age - contactTime) / .34)
  const centre = contact.clone().lerp(finish, follow)
  // A horizontal blade for square strokes, a vertical face for drives/defense.
  const shaft = cross ? new Vector3(.85 * side, .32, -.08)
    : family === 'scoop' ? new Vector3(.15 * side, .65, -.65) : new Vector3(.18 * side, 1, -.18)
  if (!defensive) shaft.lerp(family === 'sweep' ? new Vector3(.9 * side, .12, -.25)
    : family === 'cross' ? new Vector3(.40 * side - direction.x * .22, .25, -.65)
    : new Vector3(.18 * side, -.85, -.40), follow)
  if (family === 'helicopter') shaft.applyAxisAngle(new Vector3(0, 1, 0), smooth((age - .15) / .55) * Math.PI * 1.3 * side)
  return { centre, shaft: shaft.normalize(), family, weight: 1 - smooth((age - .62) / .48) }
}

/** Grounded crease coordinate to pelvis coordinate during the initial departure.
 * Contact alone must not teleport the batter from the guard to the running origin.
 */
export function strikerRootZ(groundedZ: number, progress: number, completedRuns: number) {
  return groundedZ - (completedRuns === 0 ? 1.14 * (1 - smooth(progress / .12)) : 0)
}
