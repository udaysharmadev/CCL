type Mark = 'firstFrame' | 'firstPlay' | 'firstRelease' | 'inningsComplete' | 'matchComplete' | 'graphicsFallback' | 'swipe' | 'swipeCommitted'
type Samples = 'frameMs' | 'inputToFrameMs' | 'swingToContactMs'

const marks: Partial<Record<Mark, number>> = {}
const counts: Partial<Record<Mark, number>> = {}
const samples: Record<Samples, number[]> = { frameMs: [], inputToFrameMs: [], swingToContactMs: [] }
const SAMPLE_LIMIT = 1800

export function mark(name: Mark) {
  marks[name] ??= Math.round(performance.now())
  counts[name] = (counts[name] ?? 0) + 1
}

export function sample(name: Samples, milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return
  const values = samples[name]
  values.push(milliseconds)
  if (values.length > SAMPLE_LIMIT) values.splice(0, 1)
}

function summary(values: number[]) {
  if (values.length === 0) return null
  const ordered = [...values].sort((a, b) => a - b)
  const percentile = (ratio: number) => Math.round(ordered[Math.ceil(ordered.length * ratio) - 1] * 10) / 10
  return { count: ordered.length, p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99) }
}

export function readTelemetry() {
  const resources = performance.getEntriesByType('resource')
  const navigation = performance.getEntriesByType('navigation')
  const transferBytes = [...resources, ...navigation].reduce((bytes, entry) =>
    bytes + (entry instanceof PerformanceResourceTiming ? entry.transferSize : 0), 0)
  return {
    marks: { ...marks },
    counts: { ...counts },
    transferBytes,
    frameMs: summary(samples.frameMs),
    inputToFrameMs: summary(samples.inputToFrameMs),
    swingToContactMs: summary(samples.swingToContactMs),
  }
}
