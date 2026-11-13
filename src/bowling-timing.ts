/** One release window follows the actual run-up, including pause and replay clocks. */
export const RELEASE_TARGET = .92
export const RELEASE_WINDOW = { start: .88, end: .96 } as const

export function releaseTiming(progress: number, missed = false) {
  const position = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0))
  const distance = Math.abs(position - RELEASE_TARGET)
  const quality = missed ? 0 : Math.max(0, 1 - distance / (position < RELEASE_TARGET ? .3 : .08))
  const label = missed ? 'MISSED RELEASE' : distance <= .018 ? 'PERFECT RELEASE'
    : quality >= .8 ? 'GOOD RELEASE' : position < RELEASE_TARGET ? 'EARLY RELEASE' : 'LATE RELEASE'
  return { position, quality: Math.round(quality * 1000) / 1000, label }
}
