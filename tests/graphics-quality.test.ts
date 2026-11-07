import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GRAPHICS_QUALITY, renderPixelRatio } from '../src/graphics-quality.ts'

test('graphics budgets bound the backing buffer on high-DPI phones and ultrawide desktops', () => {
  for (const quality of ['low', 'medium', 'high'] as const) {
    for (const width of [320, 390, 1280, 1920, 5120]) {
      for (const dpr of [1, 2, 3]) {
        const ratio = renderPixelRatio(quality, width, dpr)
        assert.ok(ratio > 0)
        assert.ok(ratio <= dpr)
        assert.ok(width * ratio <= GRAPHICS_QUALITY[quality].maxWidth + .001)
        assert.ok(ratio <= GRAPHICS_QUALITY[quality].pixelRatio)
      }
    }
  }
})

test('lower graphics tiers reduce geometry and effects as well as pixels', () => {
  assert.equal(GRAPHICS_QUALITY.low.shadowSize, 0)
  assert.equal(GRAPHICS_QUALITY.low.particles, 0)
  assert.equal(GRAPHICS_QUALITY.low.material, 'diffuse')
  assert.equal(GRAPHICS_QUALITY.low.skyDetail, false)
  assert.equal(GRAPHICS_QUALITY.high.material, 'pbr')
  assert.equal(GRAPHICS_QUALITY.high.skyDetail, true)
  assert.ok(GRAPHICS_QUALITY.low.crowdDensity < GRAPHICS_QUALITY.medium.crowdDensity)
  assert.ok(GRAPHICS_QUALITY.medium.crowdDensity < GRAPHICS_QUALITY.high.crowdDensity)
  assert.ok(GRAPHICS_QUALITY.medium.shadowSize < GRAPHICS_QUALITY.high.shadowSize)
  assert.ok(renderPixelRatio('low', 1280, 2) < renderPixelRatio('medium', 1280, 2))
})

test('temporarily collapsed render containers still have a valid pixel ratio', () => {
  assert.equal(renderPixelRatio('high', 0, 0), 1)
  assert.equal(renderPixelRatio('medium', -1, 2), 1)
})
