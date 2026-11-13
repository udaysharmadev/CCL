import test from 'node:test'
import assert from 'node:assert/strict'
import { releaseTiming, RELEASE_TARGET, RELEASE_WINDOW } from '../src/bowling-timing.ts'

test('release window rewards the delivery stride rather than the start of the run-up', () => {
  assert.equal(releaseTiming(RELEASE_TARGET).quality, 1)
  assert.equal(releaseTiming(RELEASE_TARGET).label, 'PERFECT RELEASE')
  assert.equal(releaseTiming(.2).quality, 0)
  assert.equal(releaseTiming(.2).label, 'EARLY RELEASE')
  assert.ok(releaseTiming(RELEASE_WINDOW.start).quality > .8)
  assert.equal(releaseTiming(.98).label, 'LATE RELEASE')
})

test('a missed release has zero timing quality and cannot wrap back to perfect', () => {
  assert.deepEqual(releaseTiming(1.2, true), { position: 1, quality: 0, label: 'MISSED RELEASE' })
  assert.equal(releaseTiming(3).quality, 0)
  assert.equal(releaseTiming(NaN).quality, 0)
})
