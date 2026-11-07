import assert from 'node:assert/strict'
import { test } from 'node:test'
import { broadcastEvent, inningsMilestone } from '../src/broadcast.ts'
import { applyDelivery, newInnings, type DeliveryOutcome } from '../src/rules.ts'

const dot: DeliveryOutcome = { batRuns: 0, completedRuns: 0, wide: 0, noBall: 0, byes: 0, legByes: 0, wicket: null, reason: 'fielded', contact: 'middle' }
test('broadcast distinguishes boundaries, extras and overthrow awards without changing scoring', () => {
  assert.equal(broadcastEvent({ ...dot, batRuns: 6, reason: 'boundary' }).kind, 'six')
  assert.equal(broadcastEvent({ ...dot, batRuns: 4, reason: 'boundary' }).kind, 'four')
  assert.equal(broadcastEvent({ ...dot, overthrowRuns: 4 }).kind, 'default')
  assert.equal(broadcastEvent({ ...dot, batRuns: 6, reason: 'boundary', noBall: 1 }).kind, 'default')
  assert.equal(broadcastEvent({ ...dot, wicket: 'run-out', completedRuns: 1, batRuns: 1 }).kind, 'wicket')
})
test('a new delivery celebrates the scoring batter despite strike rotation and does not repeat', () => {
  let before = newInnings(20, undefined, ['Iyer', 'Rao'])
  for (let index = 0; index < 24; index++) before = applyDelivery(before, { ...dot, batRuns: 4, reason: 'boundary' })
  const after = applyDelivery(before, { ...dot, batRuns: 3, completedRuns: 3 })
  assert.equal(after.striker, 2)
  assert.equal(inningsMilestone(before, after), 'HALF CENTURY · Iyer 51 (13)')
  assert.equal(inningsMilestone(after, after), undefined)
  assert.equal(inningsMilestone(after, applyDelivery(after, dot)), undefined)
})
test('extras can bring up a team milestone without crediting a batter milestone', () => {
  const before = { ...newInnings(20, undefined, ['Iyer', 'Rao']), runs: 49 }
  const after = applyDelivery(before, { ...dot, noBall: 1 })
  assert.equal(inningsMilestone(before, after), '50 UP · 50/0')
  assert.equal(after.batting[0].runs, 0)
})
