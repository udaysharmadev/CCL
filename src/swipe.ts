import type { ShotInput } from './cricket.ts'
export type BattingMode = 'normal' | 'loft' | 'defense'

/** All angles are retained. Ball height, line and gesture pace select the technique. */
export function swipeShot(dx: number, dy: number, durationMs: number, viewport: number,
  mode: BattingMode | boolean = 'normal', height = .65, line = 0): ShotInput {
  const length = Math.hypot(dx, dy)
  const scale = Math.max(240, viewport)
  const aim = length ? Math.atan2(-dx, -dy) : 0
  const angle = Math.abs(aim)
  const off = aim > 0
  const speed = length / Math.max(45, durationMs)
  const power = Math.max(.35, Math.min(1, .35 + length / (scale * .6) + Math.min(.2, speed * .1)))
  const low = height < .48
  const short = height > .85
  const hard = speed > 1.1 && power > .8
  let kind: ShotInput['kind']
  if (mode === 'defense' || length < Math.max(12, scale * .025)) {
    kind = height > 1.65 ? 'duck' : Math.abs(line) > .95 ? 'leave' : short ? 'backfoot-defense' : 'defend'
  } else if (mode === true || mode === 'loft') {
    kind = low && angle < .65 && hard ? 'helicopter'
      : off && angle > .4 && angle < 1 ? 'inside-out'
      : angle > 2.55 ? off ? 'reverse-scoop' : 'scoop'
      : off && angle > 1.85 ? 'reverse-ramp'
      : off && angle > 1.05 ? short ? 'upper-cut' : 'switch-hit'
      : !off && angle > .9 && angle < 2 ? low ? 'slog-sweep' : short ? 'hook' : 'slog'
      : 'loft'
  } else {
    kind = angle < .22 ? short ? 'backfoot-punch' : 'drive'
      : angle < .43 ? off ? 'off-drive' : 'on-drive'
      : angle < .95 ? short ? 'backfoot-punch' : off ? 'cover-drive' : 'on-drive'
      : angle < 1.25 ? off ? low ? 'square-drive' : 'cut' : low ? 'sweep' : 'pull'
      : angle < 1.85 ? low ? off ? 'reverse-sweep' : hard ? 'slog-sweep' : 'sweep'
        : off ? 'square-cut' : height > 1.2 ? 'hook' : 'pull'
      : angle < 2.55 ? off ? short && hard ? 'upper-cut' : 'late-cut'
        : low ? 'paddle-sweep' : height > 1.1 ? 'hook' : hard ? 'flick' : 'leg-glance'
      : off ? hard ? 'reverse-scoop' : 'ramp' : hard ? 'scoop' : 'ramp'
  }
  return { kind, aim, power: mode === 'defense' ? .35 : power }
}
