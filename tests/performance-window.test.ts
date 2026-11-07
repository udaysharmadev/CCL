import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PerformanceWindow } from '../src/performance-window.ts'

test('performance history retains the most recent frames after wrapping', () => {
  const window = new PerformanceWindow(4)
  assert.equal(window.summary(), null)
  for (const value of [200, 100, 30, 40, 10, 20]) window.record(value)
  assert.deepEqual(window.summary(), { count: 4, p50: 20, p95: 40, p99: 40 })
  window.record(5)
  assert.deepEqual(window.summary(), { count: 4, p50: 10, p95: 40, p99: 40 })
})
test('timing diagnostics reject invalid samples and preserve zero-duration frames', () => {
  const window = new PerformanceWindow(3)
  for (const value of [NaN, Infinity, -1]) window.record(value)
  assert.equal(window.summary(), null)
  window.record(0)
  assert.deepEqual(window.summary(), { count: 1, p50: 0, p95: 0, p99: 0 })
  assert.throws(() => new PerformanceWindow(0), RangeError)
})
