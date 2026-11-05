import assert from 'node:assert/strict'
import { test } from 'node:test'
import { swipeShot } from '../src/swipe.ts'
import { Delivery, fieldPositions, SHOTS } from '../src/cricket.ts'

test('swipes select drives, placement, cuts, pulls, defence and explicit loft', () => {
  assert.equal(swipeShot(0, -150, 160, 450).kind, 'drive')
  const left = swipeShot(-100, -150, 160, 450)
  const right = swipeShot(100, -150, 160, 450)
  assert.equal(left.kind, 'cover-drive')
  assert.equal(right.kind, 'on-drive')
  assert.ok(left.aim > 0 && right.aim < 0)
  assert.equal(swipeShot(-150, -20, 160, 450).kind, 'square-cut')
  assert.equal(swipeShot(150, -20, 160, 450).kind, 'pull')
  assert.equal(swipeShot(0, 150, 160, 450).kind, 'ramp')
  assert.equal(swipeShot(0, 0, 160, 450).kind, 'defend')
  assert.equal(swipeShot(0, -150, 160, 450, true).kind, 'loft')
})

test('gesture aggression uses normalized distance and speed without assigning a score', () => {
  assert.deepEqual(swipeShot(50, -100, 160, 400), swipeShot(100, -200, 320, 800))
  assert.ok((swipeShot(0, -180, 150, 450).power ?? 0) > (swipeShot(0, -50, 600, 450).power ?? 0))
  const shot = swipeShot(0, -180, 100, 450, true)
  const outcomes = [0, -20].map((offset) => {
    const sim = new Delivery({ seed: 41, kind: 'fast', line: .2 })
    while (!sim.outcome && sim.tick < 900) {
      if (sim.tick === sim.contactTick + offset) sim.swing(shot)
      sim.step()
    }
    return sim.outcome
  })
  assert.equal(outcomes[0]?.batRuns, 6)
  assert.equal(outcomes[1]?.contact, 'miss', 'an early swipe must still miss')
  assert.equal(outcomes[1]?.batRuns, 0)
})


test('every swipe angle preserves 360 degree placement in all three modes', () => {
  const techniques = new Set<string>()
  for (let degrees = -180; degrees <= 180; degrees += 5) {
    const angle = degrees * Math.PI / 180
    for (const mode of ['normal', 'loft', 'defense'] as const) {
      const shot = swipeShot(-Math.sin(angle) * 160, -Math.cos(angle) * 160, 160, 450, mode)
      assert.ok(Math.abs(Math.sin(shot.aim) - Math.sin(angle)) < 1e-10)
      assert.ok(Math.abs(Math.cos(shot.aim) - Math.cos(angle)) < 1e-10)
      assert.ok(SHOTS.includes(shot.kind))
      if (mode === 'defense') assert.equal(shot.kind, 'defend')
    }
    for (const height of [.3, .7, 1.4]) techniques.add(swipeShot(-Math.sin(angle) * 160, -Math.cos(angle) * 160, 160, 450, 'normal', height).kind)
  }
  // Actual simulation launches to both sides and behind the wicket, too.
  for (const angle of [-2.8, -1.6, -.8, 0, .8, 1.6, 2.8]) {
    const sim = new Delivery({ seed: 41, kind: 'fast', line: .2 })
    while (sim.tick < sim.contactTick) sim.step()
    sim.swing({ kind: 'loft', aim: angle, power: 1 })
    while (sim.phase === 'flight' && !sim.outcome) sim.step()
    assert.equal(sim.contact, 'middle')
    assert.ok(Math.abs((sim.launchAzimuth ?? 10) - angle) < .001)
  }
})

test('defense trades distance for a wider safe contact window', () => {
  const totals = { loft: { misses: 0, wickets: 0, edges: 0, distance: 0 }, defense: { misses: 0, wickets: 0, edges: 0, distance: 0 } }
  for (let seed = 1; seed <= 80; seed++) {
    for (const offset of [-5, 0, 5]) for (const mode of ['loft', 'defense'] as const) {
      const sim = new Delivery({ seed, kind: 'fast', line: .2 })
      while (!sim.outcome && sim.tick < 900) {
        if (sim.tick === sim.contactTick + offset) sim.swing(swipeShot(-40, -160, 160, 450, mode))
        sim.step()
      }
      assert.ok(sim.outcome)
      totals[mode].misses += Number(sim.outcome.contact === 'miss')
      totals[mode].edges += Number(sim.outcome.contact === 'edge')
      totals[mode].wickets += Number(Boolean(sim.outcome.wicket))
      totals[mode].distance += sim.landingDistance ?? 0
    }
  }
  assert.ok(totals.defense.misses <= totals.loft.misses)
  assert.ok(totals.defense.edges < totals.loft.edges)
  assert.ok(totals.defense.wickets < totals.loft.wickets)
  assert.ok(totals.defense.distance < totals.loft.distance)
})

test('custom field survives a deterministic replay and respects the powerplay cap', () => {
  const layout = fieldPositions('boundary').map(p => ({ ...p }))
  layout[0] = { x: 8, y: 0, z: 12 }
  const options = { seed: 41, kind: 'fast' as const, line: .2, fieldLayout: layout, maxOutside: 2 }
  const first = new Delivery(options)
  assert.deepEqual(first.fielders[0], layout[0])
  assert.equal(first.fielders.filter(p => Math.hypot(p.x, p.z - Math.max(0, Math.min(20.12, p.z))) > 27.43).length, 2)
  const outcomes = [first, new Delivery(options)].map(sim => {
    while (!sim.outcome && sim.tick < 900) {
      if (sim.tick === sim.contactTick) sim.swing({ kind: 'drive', aim: 1.2, power: 1 })
      sim.step()
    }
    return sim.outcome
  })
  assert.deepEqual(outcomes[0], outcomes[1])
  assert.deepEqual(layout[0], { x: 8, y: 0, z: 12 }, 'chasing must not mutate the saved layout')
})


test('all 31 techniques are reachable from actual gesture and delivery context', () => {
  const reached = new Set<string>()
  for (let angle = -180; angle <= 180; angle += 5) for (const h of [.3, .65, 1, 1.4, 1.8])
    for (const ms of [90, 400]) for (const mode of ['normal', 'loft', 'defense'] as const)
      for (const line of [0, 1.2]) {
        const rad = angle * Math.PI / 180
        reached.add(swipeShot(-Math.sin(rad)*180, -Math.cos(rad)*180, ms, 450, mode, h, line).kind)
      }
  assert.deepEqual([...reached].sort(), [...SHOTS].sort())
})
