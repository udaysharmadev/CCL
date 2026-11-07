import { PerformanceWindow } from './performance-window.ts'

type Mark = 'firstFrame' | 'firstPlay' | 'firstRelease' | 'inningsComplete' | 'matchComplete' | 'graphicsFallback' | 'swipe' | 'swipeCommitted'
type Samples = 'frameMs' | 'inputToFrameMs' | 'swingToContactMs' | 'simulationMs' | 'presentationMs' | 'renderMs'

const marks: Partial<Record<Mark, number>> = {}
const counts: Partial<Record<Mark, number>> = {}
const samples: Record<Samples, PerformanceWindow> = {
  frameMs: new PerformanceWindow(), inputToFrameMs: new PerformanceWindow(), swingToContactMs: new PerformanceWindow(),
  simulationMs: new PerformanceWindow(), presentationMs: new PerformanceWindow(), renderMs: new PerformanceWindow(),
}

export function mark(name: Mark) {
  marks[name] ??= Math.round(performance.now())
  counts[name] = (counts[name] ?? 0) + 1
}

export function sample(name: Samples, milliseconds: number) {
  samples[name].record(milliseconds)
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
    frameMs: samples.frameMs.summary(),
    inputToFrameMs: samples.inputToFrameMs.summary(),
    swingToContactMs: samples.swingToContactMs.summary(),
    // CPU timings. renderMs includes scene preparation and draw submission,
    // not a GPU timer query; frameMs also includes browser scheduling/GPU waits.
    simulationMs: samples.simulationMs.summary(),
    presentationMs: samples.presentationMs.summary(),
    renderMs: samples.renderMs.summary(),
  }
}
