/** Fixed-capacity timing history. Recording a frame never grows or shifts an array. */
export class PerformanceWindow {
  private readonly values: Float64Array
  private cursor = 0
  private count = 0

  constructor(capacity = 1800) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('A sample window needs positive capacity')
    this.values = new Float64Array(capacity)
  }

  record(milliseconds: number) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return
    this.values[this.cursor] = milliseconds
    this.cursor = (this.cursor + 1) % this.values.length
    this.count = Math.min(this.count + 1, this.values.length)
  }

  summary() {
    if (!this.count) return null
    // Allocation and sorting happen only when diagnostics are requested.
    const ordered = this.values.slice(0, this.count).sort()
    const percentile = (ratio: number) => Math.round(ordered[Math.ceil(this.count * ratio) - 1] * 10) / 10
    return { count: this.count, p50: percentile(.5), p95: percentile(.95), p99: percentile(.99) }
  }
}
