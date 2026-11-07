import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { QualityMaterials } from '../src/quality-materials.ts'

test('low-tier materials remove PBR and relief work while preserving texture, color and transparency', () => {
  const map = new THREE.Texture(), detail = new THREE.Texture()
  const source = new THREE.MeshStandardMaterial({ color: 0x519757, map, bumpMap: detail, normalMap: detail,
    transparent: true, opacity: .7, alphaTest: .12, depthWrite: false, side: THREE.DoubleSide, vertexColors: true })
  const root = new THREE.Mesh(new THREE.PlaneGeometry(), source)
  const quality = new QualityMaterials()
  quality.apply(root, true)
  const low = root.material as unknown as THREE.MeshLambertMaterial
  assert.ok(low.isMeshLambertMaterial)
  assert.equal(low.map, map)
  assert.equal(low.color, source.color)
  assert.equal(low.bumpMap, null)
  assert.equal(low.normalMap, null)
  assert.equal(low.transparent, true)
  assert.equal(low.opacity, .7)
  assert.equal(low.alphaTest, .12)
  assert.equal(low.depthWrite, false)
  assert.equal(low.side, THREE.DoubleSide)
  assert.equal(low.vertexColors, true)
  source.color.setHex(0xa54d49)
  assert.equal(low.color.getHex(), 0xa54d49, 'team or pitch color changes reach both tiers')
  quality.apply(root, false)
  assert.equal(root.material, source)
  assert.equal(source.bumpMap, detail)
  quality.apply(root, true)
  assert.equal(root.material, low, 'tier switches reuse the cached variant')
})

test('material variants preserve crowd vertex hooks and reuse shared materials across cached venues', () => {
  const source = new THREE.MeshStandardMaterial({ vertexColors: true })
  source.onBeforeCompile = shader => { shader.uniforms.crowdTime = { value: 42 } }
  const a = new THREE.Mesh(new THREE.BoxGeometry(), source)
  const b = new THREE.Mesh(new THREE.BoxGeometry(), source)
  const quality = new QualityMaterials()
  quality.apply(a, true)
  quality.apply(b, true)
  assert.equal(a.material, b.material)
  assert.equal(quality.count, 1)
  assert.equal(a.material.onBeforeCompile, source.onBeforeCompile)
  assert.equal(a.material.customProgramCacheKey(), source.customProgramCacheKey())
  const materials = new Set<THREE.Material>()
  quality.collect(materials)
  assert.equal(materials.size, 2, 'inactive source and active variant both join teardown')
  assert.ok(materials.has(source))
  assert.ok(materials.has(a.material))
  quality.apply(a, false)
  quality.apply(b, false)
  assert.equal(a.material, source)
  assert.equal(b.material, source)
  quality.clear()
  assert.equal(quality.count, 0)
})

test('low-tier switching supports material arrays and leaves custom/basic shaders untouched', () => {
  const source = new THREE.MeshStandardMaterial()
  const basic = new THREE.MeshBasicMaterial()
  const shader = new THREE.ShaderMaterial()
  const original = [source, basic, shader]
  const root = new THREE.Mesh(new THREE.BoxGeometry(), original)
  const quality = new QualityMaterials()
  quality.apply(root, true)
  assert.ok(root.material[0] instanceof THREE.MeshLambertMaterial)
  assert.equal(root.material[1], basic)
  assert.equal(root.material[2], shader)
  quality.apply(root, false)
  assert.equal(root.material, original)
})
