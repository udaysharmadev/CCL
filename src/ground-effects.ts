import * as THREE from 'three'
import type { Vec3 } from './cricket.ts'

/** One small, reusable pitch-impact burst. Observes a bounce, never advances it. */
export function createGroundEffects(scene: THREE.Scene) {
  const positions = new Float32Array(64 * 3)
  const velocities = new Float32Array(64 * 3)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const surface = new THREE.PointsMaterial({ color: 0xcbb58c, size: .037, transparent: true, opacity: 0, depthWrite: false })
  const particles = new THREE.Points(geometry, surface)
  particles.frustumCulled = false
  particles.visible = false
  scene.add(particles)
  let age = 1
  let count = 0
  return {
    emit(point: Vec3, budget: number) {
      count = Math.min(64, budget)
      age = 0
      geometry.setDrawRange(0, count)
      for (let i = 0; i < count; i++) {
        const offset = i * 3, angle = i * 2.399963
        const energy = .1 + (i % 7) * .042
        positions[offset] = point.x
        positions[offset + 1] = .035
        positions[offset + 2] = point.z
        velocities[offset] = Math.cos(angle) * energy
        velocities[offset + 1] = .2 + (i % 5) * .075
        velocities[offset + 2] = Math.sin(angle) * energy
      }
    },
    update(dt: number, enabled: boolean) {
      age += dt
      particles.visible = enabled && count > 0 && age < .48
      if (!particles.visible) return
      for (let i = 0; i < count; i++) {
        const offset = i * 3
        positions[offset] += velocities[offset] * dt
        positions[offset + 1] = Math.max(.012, positions[offset + 1] + velocities[offset + 1] * dt)
        positions[offset + 2] += velocities[offset + 2] * dt
        velocities[offset + 1] -= dt * 2.5
      }
      surface.opacity = .38 * (1 - age / .48)
      geometry.attributes.position.needsUpdate = true
    },
  }
}
