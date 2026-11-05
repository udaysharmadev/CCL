import * as THREE from 'three'
import { bladePose, elbowPosition, guardPose, shotFamily, smooth, strikerRootZ } from './batting-motion.ts'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import {
  BOUNDARY, DT, Delivery, FIELDERS, KEEPER, PITCH_LENGTH, fieldPositions, isSpinDelivery,
  type BoundaryFlight, type DeliveryKind, type FieldPreset, type PitchPreset, type Shot, type WeatherPreset, type Vec3,
} from './cricket.ts'

import { VENUE_NAMES, VENUE_BOUNDARIES, type Venue } from './match-data.ts'
export { VENUE_NAMES, VENUE_BOUNDARIES, type Venue } from './match-data.ts'
export type StadiumConditions = { venue?: Venue; pitch?: PitchPreset; weather?: WeatherPreset }

const VENUE_DESIGN = {
  suncrest: { badge: 'SUNCREST', canvas: '#102d39', frame: '#16414a', accent: '#73dcc4', rows: [9, 6] },
  harbor: { badge: 'HARBOR REACH', canvas: '#143852', frame: '#1f5367', accent: '#8fe1e2', rows: [4, 2] },
  citadel: { badge: 'CITADEL', canvas: '#452632', frame: '#603840', accent: '#f0c994', rows: [4, 7] },
} as const

export interface StadiumFrame {
  mode: 'home' | 'bat' | 'bowl'
  phase: 'ready' | 'windup' | 'flight' | 'field' | 'dead'
  delivery?: Delivery
  bowlingKind?: DeliveryKind
  fieldPreset?: FieldPreset
  maxOutside?: number
  windup?: number
  aim?: { x: number; z: number }
  shot?: Shot
  shotAngle?: number
  fieldLayout?: readonly Vec3[]
  signal?: 'four' | 'six' | 'out' | 'wide' | 'no-ball'
  cooperative?: boolean
  replay?: boolean
  reducedMotion?: boolean
  practiceSwing?: { age: number; shot: Shot }
}

const TAU = Math.PI * 2
const CENTER = PITCH_LENGTH / 2
const BOX = new THREE.BoxGeometry()
const FOG = 0xb7d9eb
const WEATHER_LIGHT = {
  clear: { horizon: 0xd2ebf2, zenith: 0x4ca7e3, fog: FOG, far: 240, clouds: 0, sun: 2.55, ambient: 1.8, wind: 1 },
  overcast: { horizon: 0xc2d0d2, zenith: 0x7e96a2, fog: 0xb5c3c7, far: 174, clouds: .72, sun: 1.36, ambient: 2.12, wind: .7 },
  breezy: { horizon: 0xd6eced, zenith: 0x498cbd, fog: 0xb7d4dd, far: 221, clouds: .27, sun: 2.26, ambient: 1.91, wind: 3.1 },
} as const satisfies Record<WeatherPreset, object>
const PITCH_COLOR = {
  dry: [1, 1, 1],
  green: [.74, 1.02, .76],
  hard: [1.11, 1.08, 1.05],
  dusty: [1.12, .86, .79],
} as const satisfies Record<PitchPreset, readonly [number, number, number]>

function noise(n: number) {
  const sample = Math.sin(n * 12.9898 + 78.233) * 43758.5453
  return sample - Math.floor(sample)
}

function material(color: THREE.ColorRepresentation) {
  return new THREE.MeshLambertMaterial({ color })
}

function mesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, surface: THREE.Material, x = 0, y = 0, z = 0) {
  const model = new THREE.Mesh(geometry, surface)
  model.position.set(x, y, z)
  parent.add(model)
  return model
}

function box(parent: THREE.Object3D, surface: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number) {
  const model = mesh(parent, BOX, surface, x, y, z)
  model.scale.set(w, h, d)
  return model
}

function group(parent: THREE.Object3D, x = 0, y = 0, z = 0) {
  const model = new THREE.Group()
  model.position.set(x, y, z)
  parent.add(model)
  return model
}

function canvasMap(width: number, height: number, paint: (context: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D is unavailable')
  paint(context)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function polar(radius: number, angle: number, y: number): THREE.Vector3 {
  return new THREE.Vector3(radius * Math.sin(angle), y, CENTER + radius * Math.cos(angle))
}

class GroundBatch {
  private readonly parts: THREE.BufferGeometry[] = []

  add(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation) {
    if (geometry.index) {
      const expanded = geometry.toNonIndexed()
      geometry.dispose()
      geometry = expanded
    }
    const shade = new THREE.Color(color)
    const colors = new Float32Array(geometry.getAttribute('position').count * 3)
    for (let i = 0; i < colors.length; i += 3) shade.toArray(colors, i)
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    this.parts.push(geometry)
  }

  block(color: THREE.ColorRepresentation, x: number, y: number, z: number, w: number, h: number, d: number, yaw = 0) {
    this.add(BOX.clone().scale(w, h, d).rotateY(yaw).translate(x, y, z), color)
  }

  band(a: number, b: number, inner: number, outer: number, innerY: number, outerY: number, thickness: number, color: THREE.ColorRepresentation) {
    const p = [
      polar(inner, a, innerY), polar(inner, b, innerY),
      polar(outer, b, outerY), polar(outer, a, outerY),
      polar(inner, a, innerY - thickness), polar(inner, b, innerY - thickness),
      polar(outer, b, outerY - thickness), polar(outer, a, outerY - thickness),
    ]
    const positions: number[] = []
    for (const index of [0, 2, 1, 0, 3, 2, 5, 7, 4, 5, 6, 7, 1, 4, 0, 1, 5, 4, 3, 6, 2, 3, 7, 6, 0, 7, 3, 0, 4, 7, 2, 5, 1, 2, 6, 5]) {
      const { x, y, z } = p[index]
      positions.push(x, y, z)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(72), 2))
    geometry.computeVertexNormals()
    this.add(geometry, color)
  }

  sail(color: THREE.ColorRepresentation, tip: THREE.Vector3, left: THREE.Vector3, right: THREE.Vector3) {
    const geometry = new THREE.BufferGeometry()
    const vertices = [tip, left, right, tip, right, left]
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices.flatMap(({ x, y, z }) => [x, y, z]), 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0], 2))
    geometry.computeVertexNormals()
    this.add(geometry, color)
  }

  mount(parent: THREE.Object3D) {
    const stadium = mergeGeometries(this.parts)
    for (const part of this.parts) part.dispose()
    this.parts.length = 0
    if (stadium) mesh(parent, stadium, new THREE.MeshLambertMaterial({ vertexColors: true }))
  }
}

function makeSky(scene: THREE.Scene) {
  const fog = new THREE.Fog(FOG, 84, 240)
  scene.fog = fog
  scene.background = new THREE.Color(FOG)
  const horizon = { value: new THREE.Color() }
  const zenith = { value: new THREE.Color() }
  const clouds = { value: 0 }
  const sky = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { horizon, zenith, clouds },
    vertexShader: `
      varying vec3 direction;
      void main() {
        direction = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 horizon;
      uniform vec3 zenith;
      uniform float clouds;
      varying vec3 direction;
      void main() {
        vec3 ray = normalize(direction);
        float height = max(0., ray.y);
        vec3 color = mix(horizon, zenith, pow(smoothstep(0., .55, height), .58));
        float glow = pow(max(0., dot(ray, normalize(vec3(-.58, .39, .72)))), 12.) * (1. - clouds);
        if (clouds > 0.) {
          float cloud = smoothstep(.15, .68, sin(ray.y * 24. + sin(ray.x * 8.) * 2.) * .5 + sin(ray.z * 17.) * .28);
          color = mix(color, vec3(.79, .83, .84), cloud * clouds * smoothstep(.015, .12, height));
        }
        gl_FragColor = vec4(mix(color, vec3(1., .94, .78), glow * .27), 1.);
        #include <colorspace_fragment>
      }
    `,
  })
  mesh(scene, new THREE.SphereGeometry(260, 24, 12), sky, 0, 0, CENTER)
  const ambient = new THREE.HemisphereLight(0xe9f5ff, 0x6d7956, 1.8)
  scene.add(ambient)
  const sun = new THREE.DirectionalLight(0xffe6ba, 2.55)
  sun.position.set(-44, 57, -26)
  scene.add(sun)
  return (weather: WeatherPreset) => {
    const light = WEATHER_LIGHT[weather]
    horizon.value.setHex(light.horizon)
    zenith.value.setHex(light.zenith)
    clouds.value = light.clouds
    fog.color.setHex(light.fog)
    fog.far = light.far
    ambient.intensity = light.ambient
    sun.intensity = light.sun
    sun.color.setHex(weather === 'overcast' ? 0xe2e9f0 : 0xffe6ba)
  }
}

function makeField(scene: THREE.Scene) {
  const outside = mesh(scene, new THREE.CircleGeometry(125, 72), material(0x52784b), 0, -.035, CENTER)
  outside.rotation.x = -Math.PI / 2
  const grassMap = canvasMap(512, 512, (ctx) => {
    const pixels = ctx.createImageData(512, 512)
    for (let y = 0; y < 512; y++) {
      for (let x = 0; x < 512; x++) {
        const i = (y * 512 + x) * 4
        const strip = Math.floor((y + x * .37) / 35) % 2
        const fleck = noise(i) * 8 + 1.35 * Math.sin(y * .19) + 1.5 * Math.sin(x * .08 + y * .05)
        pixels.data[i] = 41 + strip * 14 + fleck
        pixels.data[i + 1] = 112 + strip * 12 + fleck
        pixels.data[i + 2] = 54 + strip * 3 + fleck * .5
        pixels.data[i + 3] = 255
      }
    }
    ctx.putImageData(pixels, 0, 0)
  })
  grassMap.anisotropy = 4
  const grass = mesh(scene, new THREE.CircleGeometry(BOUNDARY + 4.5, 128), new THREE.MeshLambertMaterial({ map: grassMap }), 0, -.005, CENTER)
  grass.rotation.x = -Math.PI / 2
  const pitchMap = canvasMap(128, 768, (ctx) => {
    const pixels = ctx.createImageData(128, 768)
    for (let y = 0; y < 768; y++) {
      for (let x = 0; x < 128; x++) {
        const i = (y * 128 + x) * 4
        const dust = (noise(i + 9) - .5) * 20
        const grain = 6 * Math.sin(x * .24 + Math.sin(y * .026)) + 4 * Math.cos(y * .14 + x * .06)
        const wear = Math.pow(Math.sin(Math.PI * x / 128), 4) * 10
        const edge = Math.min(x, 128 - x) < 4 ? -18 : 0
        const value = dust + grain + wear + edge
        pixels.data[i] = 159 + value
        pixels.data[i + 1] = 123 + value
        pixels.data[i + 2] = 77 + value * .7
        pixels.data[i + 3] = 255
      }
    }
    ctx.putImageData(pixels, 0, 0)
    ctx.fillStyle = '#6f542b24'
    for (let i = 0; i < 95; i++) ctx.fillRect(18 + 92 * noise(i + 52), 40 + 690 * noise(i + 90), .5 + noise(i + 60) * 2, 3 + noise(i) * 14)
  })
  pitchMap.anisotropy = 4
  const pitchSurface = new THREE.MeshLambertMaterial({ map: pitchMap })
  const pitch = mesh(scene, new THREE.PlaneGeometry(3.05, PITCH_LENGTH + 4.7), pitchSurface, 0, .012, CENTER)
  pitch.rotation.x = -Math.PI / 2

  const crease = material(0xf6efda)
  for (const end of [0, PITCH_LENGTH]) {
    const side = end === 0 ? 1 : -1
    box(scene, crease, 0, .017, end, 2.64, .009, .04)
    box(scene, crease, 0, .019, end + side * 1.22, 3.74, .009, .045)
    for (const x of [-1.32, 1.32]) box(scene, crease, x, .019, end + side * .45, .045, .009, 2.02)
  }

  const rope = mesh(scene, new THREE.TorusGeometry(BOUNDARY, .11, 5, 180), material(0xf2d67d), 0, .075, CENTER)
  rope.rotation.x = -Math.PI / 2
  const marks = new GroundBatch()
  for (let i = 0; i < 48; i++) {
    const angle = i * TAU / 48
    const end = Math.cos(angle) > 0 ? PITCH_LENGTH : 0
    const r = 27.43
    marks.block(0xe0e1a9, Math.sin(angle) * r, .015, end + Math.cos(angle) * r, .62, .018, .073, angle)
  }
  for (const side of [-1, 1]) {
    for (let i = 1; i < 7; i++) marks.block(0xe0e1a9, side * 27.43, .015, PITCH_LENGTH * i / 7, .073, .018, .62)
  }
  marks.mount(scene)
  return { outside, grass, pitchSurface, rope }
}

function harborBackdrop(parent: THREE.Object3D, model: GroundBatch) {
  const water = mesh(parent, new THREE.CircleGeometry(235, 72), new THREE.MeshBasicMaterial({ color: 0x438eab }), 0, -.085, CENTER)
  water.rotation.x = -Math.PI / 2
  for (let i = 0; i < 74; i++) {
    const angle = (i + noise(i + 43)) * TAU / 74
    const wave = polar(91 + noise(i + 41) * 47, angle, -.069)
    model.block(i % 3 === 0 ? 0xb3d9d8 : 0x81bcc9, wave.x, wave.y, wave.z, 1.4 + noise(i + 18) * 5.4, .012, .14, angle)
  }

  for (const angle of [.38, Math.PI + .24]) {
    const isLighthouse = angle < Math.PI
    const pier = polar(87, angle, .18)
    model.block(0xa4a49c, pier.x, pier.y, pier.z, 3.9, .31, 19, angle)
    for (const radius of [82, 86, 90, 94]) {
      for (const offset of [-1.48, 1.48]) {
        const pile = polar(radius, angle, .48)
        model.block(0x486675, pile.x + offset * Math.cos(angle), pile.y, pile.z - offset * Math.sin(angle), .26, 1.16, .25, angle)
      }
    }
    if (!isLighthouse) continue
    const tower = polar(87, angle, 0)
    model.block(0x8d9996, tower.x, 1, tower.z, 5.9, 2, 4.9, angle)
    for (let section = 0; section < 5; section++) {
      const base = 1.75 - section * .115
      model.add(new THREE.CylinderGeometry(base - .115, base, 2.65, 10).translate(tower.x, 3.3 + section * 2.62, tower.z),
        section % 2 === 0 ? 0xf6eed3 : 0xbc695d)
    }
    model.add(new THREE.CylinderGeometry(1.58, 1.38, .49, 10).translate(tower.x, 15.32, tower.z), 0x42677b)
    model.add(new THREE.CylinderGeometry(.91, .96, 1.55, 10).translate(tower.x, 16.3, tower.z), 0xe9b95b)
    model.add(new THREE.ConeGeometry(1.43, 1.1, 10).translate(tower.x, 17.55, tower.z), 0x42677b)
  }

  for (const [index, angle] of [-.24, -.42, Math.PI - .31, Math.PI + .47].entries()) {
    const radius = 110 + index * 5
    const boat = polar(radius, angle, .14)
    model.block(0x53798b, boat.x, boat.y, boat.z, 4.05, .43, 1.08, angle)
    const sail = polar(radius, angle, 5.8)
    const left = polar(radius, angle - .021, .82)
    const right = polar(radius + .42, angle + .017, .82)
    model.sail(index % 2 ? 0xf2bd78 : 0xf1f1dd, sail, left, right)
  }
}

function citadelPavilion(model: GroundBatch, angle: number, clockTower: boolean) {
  function block(color: number, x: number, y: number, z: number, width: number, height: number, depth: number) {
    model.block(color, Math.cos(angle) * x + Math.sin(angle) * z, y,
      CENTER - Math.sin(angle) * x + Math.cos(angle) * z, width, height, depth, angle)
  }
  function front(geometry: THREE.BufferGeometry, color: number, x: number, y: number, z: number) {
    model.add(geometry.rotateY(Math.PI).translate(x, y, z).rotateY(angle).translate(0, 0, CENTER), color)
  }

  const width = 51
  block(0x7c423d, 0, 6.3, 86.4, width, 12.6, 8.8)
  block(0x99604c, 0, 8.6, 82.1, width, 6.8, .26)
  block(0x614b45, 0, 2.2, 81.84, width + .6, 4.4, .55)
  for (const height of [4.7, 9.65, 12.4]) block(0xe3c7a1, 0, height, 81.9, width + .9, .32, .48)
  for (let i = -5; i <= 5; i++) {
    const x = i * 4.45
    for (const y of [5.24, 10.16]) {
      block(0xd1b591, x, y + 1.02, 81.83, 2.24, 2.04, .13)
      block(0x334c4c, x, y + 1.04, 81.72, 1.89, 1.98, .11)
      front(new THREE.CircleGeometry(1.12, 12, 0, Math.PI), 0xd1b591, x, y + 2.04, 81.77)
      front(new THREE.CircleGeometry(.94, 12, 0, Math.PI), 0x334c4c, x, y + 2.03, 81.69)
      block(0x779089, x, y + 1.28, 81.63, .073, 2.89, .05)
      block(0x779089, x, y + 1.31, 81.64, 1.93, .07, .051)
    }
    block(0xdac6a7, x + 2.18, 2.25, 81.09, .36, 4.5, .54)
  }
  for (let step = 0; step < 5; step++) {
    block(step % 2 ? 0x517473 : 0x416762, 0, 12.71 + step * .49, 86.54, width + 2.1 - step * 3.6, .53, 10.9 - step * 1.88)
  }

  for (const x of [-25, 25]) {
    block(0x975d4d, x, 8.09, 83.22, 5.4, 16.18, 6.0)
    block(0xd1b591, x, 15.91, 83.22, 5.72, .32, 6.16)
    for (let step = 0; step < 4; step++) block(0x426963, x, 16.18 + step * .58, 83.22, 6.0 - step * 1.25, .64, 6.6 - step * 1.4)
  }
  if (!clockTower) return
  block(0x995b47, 0, 17.2, 85.2, 8.1, 9, 7.4)
  block(0xd5b893, 0, 21.5, 85.2, 8.8, .43, 7.9)
  for (let step = 0; step < 6; step++) block(0x486f6a, 0, 22 + step * .6, 85.2, 9.3 - step * 1.3, .64, 8.4 - step * 1.15)
  front(new THREE.CircleGeometry(2.43, 26), 0xe9cd9b, 0, 18.66, 81.42)
  front(new THREE.CircleGeometry(2.14, 26), 0xf0e4c2, 0, 18.66, 81.4)
  for (let hour = 0; hour < 12; hour++) {
    const theta = hour * TAU / 12
    block(0x514541, Math.sin(theta) * 1.83, 18.66 + Math.cos(theta) * 1.83, 81.37, .11, .12, .06)
  }
  block(0x514541, -.47, 18.66, 81.31, 1.04, .15, .08)
  block(0x514541, 0, 19.26, 81.31, .14, 1.28, .08)
}

function addStands(parent: THREE.Object3D, venue: Venue, motion: { time: { value: number }; energy: { value: number } }) {
  const model = new GroundBatch()
  const harbor = venue === 'harbor'
  const citadel = venue === 'citadel'
  const crowdPoints: { position: THREE.Vector3; angle: number; scale: number; color: number }[] = []
  const fanPalette = [0xd9ebd9, 0xaed5dc, 0xf3c065, 0xb65b53, 0x488e8b, 0x536f91, 0xe6d8b3, 0x315b73]
  const segments = 32
  for (let segment = 0; segment < segments; segment++) {
    const mid = segment * TAU / segments
    const a = mid - Math.PI / segments + .006
    const b = mid + Math.PI / segments - .006
    const isPavilion = Math.cos(mid) > .37 || Math.cos(mid) < -.69
    const isGate = segment === 4 || segment === 12 || segment === 20 || segment === 28
    const seaGap = harbor && [0, 1, 15, 16, 17, 31].includes(segment)
    model.band(a, b, 68.2, 68.55, 1.32, 1.32, 1.32, citadel ? 0x68443e : 0x273e4c)
    model.band(a + .004, b - .004, 68.02, 68.22, 1.14, 1.14, .9, citadel ? 0x87584b : segment % 2 ? 0x336774 : 0x2b536a)
    model.band(a, b, 68.12, 68.55, 1.4, 1.4, .1, citadel ? 0xe0c19a : 0xc6e0d8)
    if (seaGap) {
      model.band(a, b, 71.3, 76.4, .44, .2, .34, 0xc2c6b0)
      continue
    }
    model.band(a, b, 69.3, 71.1, 1.45, 1.45, 1.45, 0xb3bfac)
    if (isGate) {
      const arch = polar(74.8, mid, 3)
      model.block(citadel ? 0x9d6351 : 0x31556a, arch.x, arch.y, arch.z, 8, 5.2, 2.7, mid)
      model.block(0x203a50, arch.x, 1.8, arch.z - .18, 5.2, 3.6, 2.8, mid)
      continue
    }
    const rows = VENUE_DESIGN[venue].rows[isPavilion ? 0 : 1]
    for (let row = 0; row < rows; row++) {
      const r = 71.2 + row * 1.14
      const y = 1.63 + row * .54
      const seatColor = harbor ? (row % 2 ? 0x9cc4c5 : 0x467997) : citadel ? (row % 2 ? 0x9e806a : 0x72564e)
        : row === 1 ? 0x8daaaa : segment % 5 === 0 ? 0x476f7a : 0x55778c
      model.band(a + .004, b - .004, r, r + 1.13, y, y, .54, seatColor)
      model.band(a + .005, b - .005, r + .19, r + .27, y + .14, y + .14, .14, 0x8babb5)
      model.band(a + .005, a + .014, r, r + 1.14, y + .023, y + .023, .038, 0xc4c4a8)
      model.band(b - .014, b - .005, r, r + 1.14, y + .023, y + .023, .038, 0xc4c4a8)
      for (let seat = 0; seat < 25; seat++) {
        const seed = segment * 251 + row * 27 + seat
        if (noise(seed + 91) < .28) continue
        const angle = a + .018 + (b - a - .036) * (seat + .55 * noise(seed)) / 25
        const position = polar(r + .58 + .18 * noise(seed + 21), angle, y + .19)
        crowdPoints.push({ position, angle, scale: .74 + noise(seed + 53) * .56, color: fanPalette[Math.floor(noise(seed + 13) * fanPalette.length)] })
      }
    }
    const endRadius = 71.2 + rows * 1.14
    const rim = 1.76 + rows * .54
    model.band(a, b, endRadius, endRadius + 1.2, rim, rim, 1.4, 0xc2c6ae)
    model.band(a, b, endRadius, endRadius + 1.4, rim + .3, rim + .3, .16, 0xe8e5cb)
    if (harbor && [3, 5, 10, 13, 19, 22, 26, 29].includes(segment)) {
      const mast = polar(endRadius + 1.12, mid, 4.52)
      model.block(0x708c95, mast.x, mast.y, mast.z, .21, 9.05, .26, mid)
      const peak = polar(endRadius + 1.12, mid, 8.89)
      const left = polar(70.8, a + .008, 5.17)
      const right = polar(70.8, b - .008, 5.17)
      model.sail(segment % 2 ? 0xf6eed5 : 0xe2f0e5, peak, left, right)
      model.sail(0xb6d7d5, peak, polar(endRadius + 1.2, b - .009, 5.82), right)
    } else if (!harbor && !citadel && isPavilion && ![0, 16, 17, 31].includes(segment)) {
      model.band(a + .008, b - .008, endRadius + .4, endRadius + 1.2, 10.25, 10.25, 3.5, 0x527883)
      model.band(a + .008, b - .008, endRadius + .32, endRadius + 1.22, 7.43, 7.43, .18, 0x284a5b)
      model.band(a + .008, b - .008, endRadius + .32, endRadius + 1.22, 9.98, 9.98, .22, 0xbed4c5)
      model.band(a + .002, b - .002, 72.8, endRadius + 2.15, 13.0, 11.37, .31, 0xeee5ce)
      model.band(a + .002, b - .002, 72.64, 73.24, 13.04, 12.95, .63, 0x274a60)
      model.band(a + .002, b - .002, 72.60, 72.75, 13.05, 13.05, .21, 0x67cbc1)
      for (const fraction of [.16, .5, .84]) {
        const angle = THREE.MathUtils.lerp(a, b, fraction)
        const stanchion = polar(endRadius + .54, angle, 8.9)
        model.block(0xc3cdbf, stanchion.x, stanchion.y, stanchion.z, .26, 5.11, .41, angle)
        model.band(angle - .004, angle + .004, 73.17, endRadius + 1.96, 12.75, 11.05, .26, 0x527382)
      }
    }
  }

  if (harbor) harborBackdrop(parent, model)
  if (citadel) {
    citadelPavilion(model, 0, true)
    citadelPavilion(model, Math.PI, false)
  }
  const floodlights = harbor ? [-1.29, -.8, 1.25, 2.39] : [-2.55, -1.22, -.47, .57, 1.3, 2.61]
  for (const angle of floodlights) {
    const site = polar(83.5, angle, 0)
    model.block(0x506777, site.x, 9.7, site.z, .42, 19.4, .54, angle)
    model.block(0xd9dfd6, site.x, 13.5, site.z, .27, 10.8, .36, angle)
    model.block(0x314a5a, site.x, 19.7, site.z, 5.5, 2.45, .65, angle)
    const inner = polar(83.06, angle, 19.7)
    for (let column = 0; column < 7; column++) {
      for (let row = 0; row < 3; row++) {
        const offset = (column - 3) * .69
        model.block(0xe5f5ee, inner.x + Math.cos(angle) * offset, inner.y + (row - 1) * .56,
          inner.z - Math.sin(angle) * offset, .49, .39, .21, angle)
      }
    }
  }

  for (let i = 0; !harbor && i < 115; i++) {
    const angle = (i + noise(i + 613)) * TAU / 115
    const r = 88 + noise(i + 114) * 19
    const height = 3.8 + noise(i + 31) * 7.5
    const tree = polar(r, angle, 0)
    const green = [0x54794d, 0x396c56, 0x6c8854, 0x547e5e][i % 4]
    model.block(0x716f53, tree.x, height * .32, tree.z, .26, height * .64, .27)
    model.add(new THREE.IcosahedronGeometry(1, 0).scale(height * .35, height * .45, height * .33).rotateY(angle).translate(tree.x, height * .65, tree.z), green)
    model.add(new THREE.IcosahedronGeometry(1, 0).scale(height * .26, height * .33, height * .28).rotateY(-angle).translate(tree.x + height * .15, height * .7, tree.z - .45), green)
  }
  for (let i = 0; !harbor && !citadel && i < 31; i++) {
    const angle = i * TAU / 31
    const base = polar(113 + noise(i + 146) * 25, angle, 0)
    const height = 4 + noise(i + 412) * 12
    const building = i % 4 === 0 ? 0xaab1ae : 0x8caaad
    model.block(building, base.x, height / 2, base.z, 4 + noise(i) * 7, height, 3 + noise(i + 85) * 5, angle)
  }
  model.mount(parent)

  const torso = new THREE.CylinderGeometry(.155, .185, .33, 4, 1, true).translate(0, .12, 0)
  const head = new THREE.OctahedronGeometry(.109).translate(0, .39, 0)
  const crowdBodies = torso.toNonIndexed()
  const crowdGeometry = mergeGeometries([crowdBodies, head])
  crowdBodies.dispose()
  torso.dispose()
  head.dispose()
  if (crowdGeometry) {
    const crowdMaterial = material(0xffffff)
    crowdMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.crowdTime = motion.time
      shader.uniforms.crowdEnergy = motion.energy
      shader.vertexShader = `uniform float crowdTime; uniform float crowdEnergy;\n${shader.vertexShader}`.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        float wave = sin(crowdTime * 4. + instanceMatrix[3].x * .3 + instanceMatrix[3].z * .23);
        transformed.y += abs(wave) * (.035 + crowdEnergy * .32);
        transformed.x += wave * .025;
      `)
    }
    const crowd = new THREE.InstancedMesh(crowdGeometry, crowdMaterial, crowdPoints.length)
    const transform = new THREE.Object3D()
    const color = new THREE.Color()
    crowdPoints.forEach((fan, index) => {
      transform.position.copy(fan.position)
      transform.scale.setScalar(fan.scale)
      transform.rotation.y = fan.angle + noise(index) * .6
      transform.updateMatrix()
      crowd.setMatrixAt(index, transform.matrix)
      crowd.setColorAt(index, color.set(fan.color))
    })
    parent.add(crowd)
  }
  makeSigns(parent, venue)
}

function makeSigns(parent: THREE.Object3D, venue: Venue) {
  const design = VENUE_DESIGN[venue]
  const signMap = canvasMap(1024, 300, (ctx) => {
    ctx.fillStyle = design.canvas
    ctx.fillRect(0, 0, 1024, 300)
    ctx.fillStyle = design.frame
    ctx.fillRect(0, 0, 1024, 24)
    ctx.fillRect(0, 276, 1024, 24)
    ctx.strokeStyle = design.accent
    ctx.lineWidth = 4
    ctx.strokeRect(17, 17, 990, 266)
    ctx.fillStyle = '#f1c77b'
    ctx.beginPath()
    ctx.arc(150, 137, 43, Math.PI, TAU)
    ctx.fill()
    ctx.strokeStyle = '#f1c77b'
    for (let i = 0; i < 3; i++) {
      ctx.beginPath()
      ctx.moveTo(91 + 10 * i, 145 + 13 * i)
      ctx.quadraticCurveTo(155, 157 + 13 * i, 211 - 10 * i, 145 + 13 * i)
      ctx.stroke()
    }
    ctx.fillStyle = '#f7f2de'
    ctx.font = `900 ${venue === 'harbor' ? 76 : 99}px system-ui, sans-serif`
    ctx.fillText(design.badge, 240, 163)
    ctx.fillStyle = design.accent
    ctx.font = '700 27px system-ui, sans-serif'
    ctx.fillText(venue === 'suncrest' ? 'O V A L     /     C R I C K E T   G R O U N D' : 'C R A Z Y   C R I C K E T   L E A G U E', 247, 218)
  })
  const frame = material(design.frame)
  const signFace = new THREE.MeshBasicMaterial({ map: signMap, side: THREE.DoubleSide })
  const angles = venue === 'citadel' ? [0, Math.PI] : [-.14, Math.PI + .12]
  for (const angle of angles) {
    const position = polar(venue === 'citadel' ? 80.93 : 80.2, angle, venue === 'harbor' ? 5.54 : venue === 'citadel' ? 12.37 : 11.7)
    const sign = group(parent, position.x, position.y, position.z)
    sign.rotation.y = angle + Math.PI
    box(sign, frame, 0, 0, 0, 21, 6.45, .7)
    mesh(sign, new THREE.PlaneGeometry(20.3, 5.95), signFace, 0, 0, .37)
    if (venue !== 'citadel') for (const x of [-8.2, 8.2]) box(sign, frame, x, -4.5, 0, .48, 5.4, .7)
  }
  const ribbon = canvasMap(512, 64, (ctx) => {
    ctx.fillStyle = venue === 'suncrest' ? '#194b55' : design.frame
    ctx.fillRect(0, 0, 512, 64)
    ctx.fillStyle = design.accent
    ctx.fillRect(0, 0, 512, 4)
    ctx.fillRect(0, 60, 512, 4)
    ctx.fillStyle = '#f3edcc'
    ctx.font = '800 28px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('CRAZY CRICKET LEAGUE', 256, 41)
  })
  const board = new THREE.MeshBasicMaterial({ map: ribbon, side: THREE.DoubleSide })
  for (let i = 0; i < 16; i++) {
    const angle = i * TAU / 16
    const position = polar(67.67, angle, .75)
    const model = mesh(parent, new THREE.PlaneGeometry(10.8, 1.04), board, position.x, position.y, position.z)
    model.rotation.y = angle + Math.PI
  }
}

function shadowSurface() {
  const map = canvasMap(64, 64, (ctx) => {
    const gradient = ctx.createRadialGradient(32, 32, 4, 32, 32, 31)
    gradient.addColorStop(0, '#17252191')
    gradient.addColorStop(.48, '#1725214d')
    gradient.addColorStop(1, '#17252100')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 64, 64)
  })
  return new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
}

function makeShadow(parent: THREE.Object3D, surface: THREE.MeshBasicMaterial, radius: number) {
  const model = mesh(parent, new THREE.PlaneGeometry(radius * 2, radius * 2), surface, 0, .027)
  model.rotation.x = -Math.PI / 2
  return model
}

function palette(shirt: number, pants: number, trim: number) {
  return { shirt: material(shirt), pants: material(pants), trim: material(trim) }
}

const skin = [0x995c3e, 0xb87b56, 0x815237, 0xdca17a, 0xa77051].map(material)
const soles = material(0xe8e7d4)
const dark = material(0x192c36)
const leather = material(0xb1bcae)
const batFace = material(0xe6bd78)
const batGrip = material(0x293b48)
const TORSO = new THREE.CylinderGeometry(.251, .186, .44, 8).scale(1, 1, .69)
const HIP = new THREE.CylinderGeometry(.19, .19, .18, 8).scale(1, 1, .82)
const HEAD = new THREE.SphereGeometry(.119, 10, 7).scale(.86, 1.12, .91)
const HELMET = new THREE.SphereGeometry(.15, 12, 8, 0, TAU, 0, Math.PI * .64).scale(.89, .93, 1.04)
const UPPER_ARM = new THREE.CylinderGeometry(.078, .055, .28, 7)
const FOREARM = new THREE.CylinderGeometry(.057, .043, .246, 7)
const HAND = new THREE.SphereGeometry(.058, 8, 5).scale(.86, 1.16, .8)
const THIGH = new THREE.CylinderGeometry(.103, .079, .37, 7)
const SHIN = new THREE.CylinderGeometry(.078, .049, .34, 7)

type Role = 'batter' | 'bowler' | 'fielder' | 'keeper' | 'umpire'
type Rig = ReturnType<typeof athlete>

export function athlete(scene: THREE.Scene, kit: ReturnType<typeof palette>, role: Role, id: number, shadow: THREE.MeshBasicMaterial) {
  const base = group(scene)
  const footShadow = makeShadow(base, shadow, .83)
  footShadow.scale.y = .67
  const body = group(base, 0, .86)
  const shoulders = group(body)
  const playerSkin = skin[id % skin.length]
  const helmeted = role === 'batter' || role === 'keeper'
  const handsPadded = helmeted
  mesh(shoulders, HIP, kit.pants, 0, .015, 0)
  mesh(shoulders, TORSO, kit.shirt, 0, .26, 0)
  box(shoulders, kit.trim, 0, .297, -.147, .309, .032, .018)
  box(shoulders, kit.trim, 0, .32, .146, .29, .026, .019)
  const head = group(shoulders, 0, .58)
  mesh(head, HEAD, playerSkin)
  mesh(head, HELMET, helmeted ? dark : kit.shirt, 0, .023)
  box(head, helmeted ? dark : kit.trim, 0, .017, .131, .205, .022, .128)
  if (helmeted) {
    box(head, leather, 0, -.069, .119, .18, .016, .02)
    box(head, leather, 0, -.103, .108, .18, .015, .02)
    for (const side of [-1, 1]) box(head, leather, side * .095, -.049, .102, .013, .13, .022)
  }

  const legs = [-1, 1].map((side) => {
    const hip = group(body, side * .11, 0, 0)
    const knee = group(hip, 0, -.37, 0)
    mesh(hip, THIGH, kit.pants, 0, -.173)
    mesh(knee, SHIN, kit.pants, 0, -.167)
    if (role === 'batter') {
      box(knee, leather, 0, -.156, .059, .152, .32, .08)
      for (const rib of [-.045, .045]) box(knee, soles, rib, -.159, .102, .018, .267, .013)
    }
    const ankle = group(knee, 0, -.34)
    box(ankle, soles, 0, -.025, .045, .135, .079, .239)
    return { hip, knee, ankle }
  })

  const arms = [-1, 1].map((side) => {
    const shoulder = group(shoulders, side * .223, .41)
    const elbow = group(shoulder, 0, -.267)
    mesh(shoulder, UPPER_ARM, kit.shirt, 0, -.115)
    mesh(elbow, FOREARM, playerSkin, 0, -.111)
    const hand = mesh(elbow, HAND, handsPadded ? soles : playerSkin, 0, -.248)
    if (role === 'keeper') hand.scale.set(1.34, 1.24, 1.17)
    return { shoulder, elbow, hand }
  })

  const bat = role === 'batter' ? group(shoulders, .2, .04, .12) : undefined
  if (bat) {
    box(bat, batGrip, 0, -.107, 0, .037, .25, .04)
    box(bat, batFace, 0, -.525, 0, .128, .620, .046)
    box(bat, kit.trim, 0, -.341, .025, .095, .08, .007)
  }
  return { base, body, shoulders, head, arms, legs, bat }
}

function neutralPose(rig: Rig, time: number, stance = 0) {
  if (rig.bat) { rig.bat.position.set(.25, .05, .15); rig.bat.rotation.set(.25, 0, -.2) }
  for (let i = 0; i < rig.legs.length; i++) rig.legs[i].hip.position.set(i === 0 ? -.11 : .11, 0, 0)
  rig.body.position.x = rig.body.position.z = 0
  rig.body.rotation.set(0, 0, 0)
  rig.body.position.y = .81 + Math.sin(time * 2.4) * .006 - stance
  rig.shoulders.rotation.set(0, 0, 0)
  rig.head.rotation.set(0, 0, 0)
  rig.arms[0].shoulder.rotation.set(-stance * 2, 0, -.18 - stance)
  rig.arms[1].shoulder.rotation.set(-stance * 2, 0, .18 + stance)
  rig.arms[0].elbow.rotation.set(-.13 - stance * 3, 0, 0)
  rig.arms[1].elbow.rotation.set(-.13 - stance * 3, 0, 0)
  for (const leg of rig.legs) {
    leg.hip.rotation.set(-.04 - stance * 2.8, 0, 0)
    leg.knee.rotation.set(.11 + stance * 4.2, 0, 0)
    leg.ankle.rotation.set(0, 0, 0)
  }
}

function runPose(rig: Rig, clock: number, strength: number) {
  neutralPose(rig, clock)
  const stride = Math.sin(clock * 16) * strength
  rig.body.position.y += Math.abs(stride) * .063
  rig.shoulders.rotation.x = strength * .14
  rig.shoulders.rotation.y = stride * .17
  for (let i = 0; i < 2; i++) {
    const swing = i === 0 ? stride : -stride
    rig.legs[i].hip.rotation.x = swing * .68
    rig.legs[i].knee.rotation.x = .13 + Math.max(0, -swing) * 1.1
    rig.arms[i].shoulder.rotation.x = -swing * .62
    rig.arms[i].elbow.rotation.x = -.6 - strength * .36
  }
}

function aimActor(rig: Rig, x: number, z: number) {
  const { position } = rig.base
  if (Math.hypot(x - position.x, z - position.z) > .02) rig.base.rotation.y = Math.atan2(x - position.x, z - position.z)
}

const DOWN = new THREE.Vector3(0, -1, 0)
/** Keep both wrist targets reachable, instead of stretching forearms or detaching gloves. */
function gripBat(rig: Rig) {
  if (!rig.bat) return
  const offsets = [-.145, -.045]
  for (let pass = 0; pass < 8; pass++) {
    for (let i = 0; i < 2; i++) {
      const offset = new THREE.Vector3(0, offsets[i], 0).applyQuaternion(rig.bat.quaternion)
      const wrist = rig.bat.position.clone().add(offset)
      const shoulder = rig.arms[i].shoulder.position
      const reach = wrist.clone().sub(shoulder)
      const distance = reach.length()
      if (distance > .505) rig.bat.position.addScaledVector(reach, .505 / distance - 1)
      else if (distance < .045) {
        if (distance < .0001) reach.set(0, 0, 1)
        else reach.divideScalar(distance)
        rig.bat.position.addScaledVector(reach, .045 - distance)
      }
    }
  }
  for (let i = 0; i < 2; i++) {
    const arm = rig.arms[i]
    const wrist = new THREE.Vector3(0, offsets[i], 0).applyQuaternion(rig.bat.quaternion).add(rig.bat.position)
    const shoulder = arm.shoulder.position.clone()
    const pole = shoulder.clone().add(new THREE.Vector3(i === 0 ? -.32 : .32, i === 0 ? -.18 : -.03, .30))
    const elbow = elbowPosition(shoulder, wrist, pole)
    arm.shoulder.quaternion.setFromUnitVectors(DOWN, elbow.clone().sub(shoulder).normalize())
    const lower = wrist.clone().sub(elbow).normalize().applyQuaternion(arm.shoulder.quaternion.clone().invert())
    arm.elbow.quaternion.setFromUnitVectors(DOWN, lower)
  }
}

/** Feet are endpoints, not displaced hip sockets. Shoes stay level as knees flex. */
function plantFeet(rig: Rig, feet: THREE.Vector3[]) {
  rig.base.updateWorldMatrix(true, true)
  feet.forEach((foot, i) => {
    const leg = rig.legs[i]
    const ankle = rig.body.worldToLocal(rig.base.localToWorld(foot.clone()))
    const hip = leg.hip.position
    const knee = elbowPosition(hip, ankle, hip.clone().add(new THREE.Vector3(0, -.1, 1)), .37, .34)
    leg.hip.quaternion.setFromUnitVectors(DOWN, knee.clone().sub(hip).normalize())
    leg.knee.quaternion.setFromUnitVectors(DOWN, ankle.clone().sub(knee).normalize().applyQuaternion(leg.hip.quaternion.clone().invert()))
    leg.ankle.quaternion.copy(leg.hip.quaternion).multiply(leg.knee.quaternion).invert()
  })
}

export function batterPose(rig: Rig, time: number, swing: number | undefined, shot: StadiumFrame['shot'], direction = 0, impact?: Vec3, preparation = 0) {
  neutralPose(rig, time)
  // Left shoulder and front foot point down the pitch; the head looks at the bowler.
  rig.base.rotation.y = -1.32
  const kind = shot ?? 'drive'
  const family = shotFamily(kind)
  const active = swing !== undefined && swing < 1.1
  const age = Math.max(0, swing ?? 0)
  const contact = impact ?? { x: .10, y: .55, z: .46 }
  const motion = bladePose(kind, age, contact, direction)
  const plant = active ? smooth(age / (5 / 60)) * motion.weight : 0
  const sweep = family === 'sweep'
  const backfoot = kind.startsWith('backfoot') || family === 'cross'
  const evasion = kind === 'duck' || kind === 'leave'
  const duck = kind === 'duck' ? plant : 0
  const turn = plant * (family === 'cross' || sweep ? -.48 : -.18) * Math.sin(direction)
  rig.body.position.y = .735 - plant * (sweep ? .22 : .035 + Math.max(0, .55 - contact.y) * .30) - duck * .20
  // Shift the pelvis with the step. Hip joints themselves never leave the body.
  const lineStep = THREE.MathUtils.clamp(contact.x - rig.base.position.x, -.28, .18)
  const stride = new THREE.Vector3(plant * lineStep * .5, 0, plant * (backfoot ? -.15 : .20))
  stride.applyAxisAngle(new THREE.Vector3(0, 1, 0), -rig.base.rotation.y)
  rig.body.position.x = stride.x
  rig.body.position.z = .015 + stride.z
  rig.shoulders.rotation.set(.16 + plant * (sweep ? .20 : .07) + duck * .15, turn, 0)
  rig.head.rotation.set(-rig.shoulders.rotation.x * .6, -rig.base.rotation.y - turn, -.04)
  const feet = [new THREE.Vector3(-.185, .065, .035), new THREE.Vector3(.185, .065, -.015)]
  // Plant toward the incoming line; shot direction controls the swing, not the foot target.
  const step = new THREE.Vector3(plant * lineStep, 0, plant * (backfoot ? -.25 : sweep ? .30 : .38))
  step.applyAxisAngle(new THREE.Vector3(0, 1, 0), -rig.base.rotation.y)
  feet[backfoot ? 0 : 1].add(step)
  plantFeet(rig, feet)
  if (!rig.bat) return
  // Idle is a grounded guard, never the first frame of an overhead swing.
  const guard = guardPose(time, preparation * (active ? motion.weight : swing === undefined ? 1 : 0))
  const centre = guard.centre.clone().add(rig.base.position)
  const shaft = guard.shaft.clone()
  if (active) {
    const stroke = smooth(age / (5 / 60)) * motion.weight
    if (evasion) {
      centre.add(new THREE.Vector3(.17, kind === 'leave' ? .35 : .12, -.12).multiplyScalar(plant))
      shaft.lerp(new THREE.Vector3(.1, .6, .8).normalize(), plant)
    } else {
      centre.lerp(motion.centre, stroke)
      shaft.lerp(motion.shaft, stroke).normalize()
    }
  }
  rig.base.updateWorldMatrix(true, true)
  const localCentre = rig.shoulders.worldToLocal(centre)
  const inverse = rig.shoulders.getWorldQuaternion(new THREE.Quaternion()).invert()
  const localShaft = shaft.applyQuaternion(inverse)
  // Rotate the handle toward reachable hands, keeping the blade on the ball.
  // Translating/clamping the entire bat here would visibly miss a scored hit.
  const towardBody = new THREE.Vector3(0, .41, .08).sub(localCentre).normalize()
  const wantedShaft = localShaft.clone()
  for (let attempt = 0; attempt <= 24; attempt++) {
    localShaft.copy(wantedShaft).lerp(towardBody, attempt / 24).normalize()
    const reachable = rig.arms.every((arm, i) => localCentre.clone()
      .addScaledVector(localShaft, i === 0 ? .380 : .480).distanceTo(arm.shoulder.position) <= .503)
    if (reachable) break
  }
  // Yorkers meet the lower blade, not its centre. Slide along the blade plane
  // so the toe stays above the turf while the ball still lies on the face.
  const worldShaft = localShaft.clone().applyQuaternion(inverse.clone().invert())
  const worldHeight = rig.shoulders.localToWorld(localCentre.clone()).y
  if (Math.abs(worldShaft.y) > .2) {
    const lift = Math.max(0, .025 + Math.abs(worldShaft.y) * .31 - worldHeight)
    localCentre.addScaledVector(localShaft, lift / worldShaft.y)
  }
  // The broad face, rather than the thin edge, follows the intended stroke.
  const face = new THREE.Vector3(Math.sin(active ? direction : 0), 0, Math.cos(active ? direction : 0)).applyQuaternion(inverse)
  face.addScaledVector(localShaft, -face.dot(localShaft))
  if (face.lengthSq() < .0001) face.set(0, 0, 1).addScaledVector(localShaft, -localShaft.z)
  face.normalize()
  const width = new THREE.Vector3().crossVectors(localShaft, face).normalize()
  rig.bat.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(width, localShaft, face))
  rig.bat.position.copy(localCentre).addScaledVector(localShaft, .525)
  gripBat(rig)
}

function bowlingPose(rig: Rig, time: number, phase: StadiumFrame['phase'], windup: number, release: number, spin: boolean) {
  rig.base.rotation.y = Math.PI
  if (phase === 'windup') {
    const run = THREE.MathUtils.smoothstep(windup, .09, 1)
    rig.base.position.set(.3, 0, PITCH_LENGTH + (spin ? 4 : 8) - run * (spin ? 5.04 : 9.04))
    runPose(rig, windup * 1.85, Math.sin(run * Math.PI) * .78 + run * .23)
    const arm = THREE.MathUtils.smoothstep(windup, .78, .999)
    rig.arms[1].shoulder.rotation.x = -arm * (spin ? 2.78 : 3.06)
    rig.arms[1].shoulder.rotation.z = .18 + arm * (spin ? .62 : .14)
    rig.arms[0].shoulder.rotation.x = -arm * 1.1
    rig.shoulders.rotation.x = arm * .13
  } else if (phase === 'flight' && release < .54) {
    neutralPose(rig, time)
    rig.base.position.set(.3, 0, PITCH_LENGTH - 1.04 - Math.min(release, .54) * 2)
    const follow = 1 - THREE.MathUtils.smoothstep(release, 0, .54)
    rig.arms[1].shoulder.rotation.x = -follow * 2.92
    rig.arms[1].shoulder.rotation.z = .18 + follow * .17
    rig.shoulders.rotation.x = Math.sin(follow * Math.PI) * .41
    rig.legs[1].hip.rotation.x = follow * .36
  } else {
    neutralPose(rig, time)
    const ready = phase === 'ready'
    rig.base.position.set(.3, 0, ready ? PITCH_LENGTH + (spin ? 4 : 8) : PITCH_LENGTH - 2.12)
  }
}

function receivePose(rig: Rig, delivery: Delivery | undefined, time: number) {
  if (!delivery) return
  const { ball } = delivery
  const reach = Math.hypot(ball.x - rig.base.position.x, ball.z - rig.base.position.z)
  const crouch = .28 * (1 - THREE.MathUtils.smoothstep(ball.y, .12, 1.14))
  const angle = -Math.atan2(Math.max(.22, reach), 1.19 - crouch - ball.y)
  neutralPose(rig, time, crouch)
  aimActor(rig, ball.x, ball.z)
  rig.shoulders.rotation.x = crouch * 1.8
  rig.arms[0].shoulder.rotation.set(angle - crouch, 0, -.26)
  rig.arms[1].shoulder.rotation.set(angle - crouch, 0, .26)
  rig.arms[0].elbow.rotation.x = -.18
  rig.arms[1].elbow.rotation.x = -.18
}

function umpirePose(rig: Rig, time: number, signal: StadiumFrame['signal']) {
  neutralPose(rig, time)
  rig.base.rotation.y = Math.PI
  switch (signal) {
    case 'six':
      rig.arms[0].shoulder.rotation.set(-2.94, 0, -.24)
      rig.arms[1].shoulder.rotation.set(-2.94, 0, .24)
      break
    case 'out':
      rig.arms[1].shoulder.rotation.set(-2.66, 0, .22)
      rig.arms[1].elbow.rotation.x = -.15
      break
    case 'wide':
      rig.arms[0].shoulder.rotation.z = -Math.PI / 2
      rig.arms[1].shoulder.rotation.z = Math.PI / 2
      break
    case 'no-ball':
      rig.arms[1].shoulder.rotation.z = Math.PI / 2
      break
    case 'four':
      rig.arms[1].shoulder.rotation.set(-.42, 0, .82 + Math.sin(time * 7.5) * .57)
      rig.arms[1].elbow.rotation.x = -.56
      break
  }
}

function wickets(scene: THREE.Scene) {
  const wood = material(0xf0d99c)
  const painted = material(0xc85f46)
  const posts = new THREE.CylinderGeometry(.018, .019, .706, 10)
  const bail = new THREE.CylinderGeometry(.0125, .0125, .116, 8).rotateZ(Math.PI / 2)
  return [0, PITCH_LENGTH].map((end) => {
    const assembly = group(scene, 0, .014, end)
    for (const x of [-.115, 0, .115]) {
      mesh(assembly, posts, wood, x, .352)
      box(assembly, painted, x, .49, -.019, .024, .09, .007)
    }
    return [-.0575, .0575].map((x) => mesh(assembly, bail, wood, x, .712))
  })
}

export function createStadium(container: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.06
  renderer.domElement.setAttribute('aria-hidden', 'true')
  renderer.domElement.style.cssText = 'position:absolute;inset:0;display:block;width:100%;height:100%'
  container.append(renderer.domElement)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(43, 16 / 9, .085, 310)
  const setWeatherLight = makeSky(scene)
  const field = makeField(scene)
  const stands = new Map<Venue, THREE.Group>()
  const crowdMotion = { time: { value: 0 }, energy: { value: 0 } }
  let activeStands: THREE.Group | undefined
  let activeVenue: Venue = 'suncrest'
  let wind: number = WEATHER_LIGHT.clear.wind
  const pennants = [-.69, .79, 2.31, 3.89].map((angle, i) => {
    const position = polar(69.65, angle, 0)
    const pole = group(scene, position.x, position.y, position.z)
    box(pole, material(0xd2ddcd), 0, 2.24, 0, .065, 4.48, .065)
    const flag = group(pole, 0, 4.17)
    const cloth = new THREE.MeshLambertMaterial({ color: i % 2 === 0 ? 0xf0ca75 : 0x75c7ba, side: THREE.DoubleSide })
    mesh(flag, new THREE.PlaneGeometry(1.08, .46, 3, 1), cloth, .54)
    return flag
  })
  function setConditions({ venue = 'suncrest', pitch = 'dry', weather = 'clear' }: StadiumConditions = {}) {
    activeVenue = venue
    let seating = stands.get(venue)
    if (!seating) {
      seating = new THREE.Group()
      addStands(seating, venue, crowdMotion)
      stands.set(venue, seating)
    }
    if (activeStands !== seating) {
      activeStands?.removeFromParent()
      scene.add(seating)
      activeStands = seating
    }
    container.dataset.venue = venue
    const boundary = VENUE_BOUNDARIES[venue]
    field.rope.scale.set(boundary.x / BOUNDARY, boundary.z / BOUNDARY, 1)
    field.grass.scale.set((boundary.x + 4.5) / (BOUNDARY + 4.5), (boundary.z + 4.5) / (BOUNDARY + 4.5), 1)
    field.outside.scale.setScalar(venue === 'harbor' ? .69 : 1)
    const [red, green, blue] = PITCH_COLOR[pitch]
    field.pitchSurface.color.setRGB(red, green, blue)
    setWeatherLight(weather)
    wind = WEATHER_LIGHT[weather].wind
  }
  setConditions()
  const bails = wickets(scene)

  const shadow = shadowSurface()
  const battingColors = palette(0x198f89, 0x214d55, 0xf6c963)
  const fieldingColors = palette(0xa94749, 0x683946, 0xf4d4a1)
  const umpireColors = palette(0xeee7cf, 0x283842, 0xbaa872)
  const striker = athlete(scene, battingColors, 'batter', 1, shadow)
  const nonStriker = athlete(scene, battingColors, 'batter', 3, shadow)
  const bowler = athlete(scene, fieldingColors, 'bowler', 0, shadow)
  const keeper = athlete(scene, fieldingColors, 'keeper', 4, shadow)
  const fielders = FIELDERS.map((_, i) => athlete(scene, fieldingColors, 'fielder', i + 3, shadow))
  const umpire = athlete(scene, umpireColors, 'umpire', 2, shadow)
  umpire.base.position.set(-.57, 0, PITCH_LENGTH + 1.84)
  const squareUmpire = athlete(scene, umpireColors, 'umpire', 3, shadow)
  squareUmpire.base.position.set(-16, 0, .7)

  const ballModel = group(scene)
  mesh(ballModel, new THREE.SphereGeometry(.076, 12, 8), material(0xf4db94))
  const seam = mesh(ballModel, new THREE.TorusGeometry(.074, .0035, 3, 14), material(0xb77946))
  seam.rotation.x = .7
  const ballShadow = makeShadow(scene, shadow, .26)
  const marker = mesh(scene, new THREE.RingGeometry(.137, .182, 40), new THREE.MeshBasicMaterial({
    color: 0xf3de84, transparent: true, opacity: .82, side: THREE.DoubleSide, depthWrite: false,
  }))
  marker.rotation.x = -Math.PI / 2
  const heldBall = new THREE.Vector3()
  const cameraPosition = new THREE.Vector3()
  const cameraTarget = new THREE.Vector3()
  const look = new THREE.Vector3()
  const movingActors = new Map<Rig, THREE.Vector2>()
  let mode: StadiumFrame['mode'] | undefined
  let time = 0
  let deadTime = 0
  let boundaryDelivery: Delivery | undefined
  let boundaryFlight: BoundaryFlight | null = null
  let boundaryAccumulator = 0
  // Match the simple collision envelope to the built stand rows and roof bands.
  function landingSurface(point: Vec3) {
    const radius = Math.hypot(point.x, point.z - CENTER)
    const angle = (Math.atan2(point.x, point.z - CENTER) + TAU) % TAU
    const segment = Math.round(angle / TAU * 32) % 32
    const mid = segment * TAU / 32
    const pavilion = Math.cos(mid) > .37 || Math.cos(mid) < -.69
    if (radius >= 68.02 && radius < 68.55) return 1.45
    const seaGap = activeVenue === 'harbor' && [0, 1, 15, 16, 17, 31].includes(segment)
    if (seaGap) return radius >= 71.3 && radius < 76.4 ? .44 : 0
    if ([4, 12, 20, 28].includes(segment)) return radius > 73.4 && radius < 76.2 ? 5.6 : 0
    const rows = VENUE_DESIGN[activeVenue].rows[pavilion ? 0 : 1]
    const end = 71.2 + rows * 1.14
    if (activeVenue === 'suncrest' && pavilion && ![0, 16, 17, 31].includes(segment) && radius >= 72.8 && radius < end + 2.15 && point.y > 11) {
      return THREE.MathUtils.lerp(13, 11.37, (radius - 72.8) / (end + 2.15 - 72.8))
    }
    if (radius >= 69.3 && radius < 71.2) return 1.45
    if (radius >= 71.2 && radius < end) return 1.63 + Math.floor((radius - 71.2) / 1.14) * .54
    if (radius >= end && radius < end + 1.4) return 2.06 + rows * .54
    return 0
  }
  let demo = new Delivery({ seed: 41, kind: 'fast', line: .2 })
  let demoClock = 0
  let demoAccumulator = 0
  let demoRound = 0
  let contactKick = 0
  let previousContact: Delivery | undefined
  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)').matches
  const trailPositions = new Float32Array(24 * 3)
  const trailGeometry = new THREE.BufferGeometry()
  trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3))
  const flightTrail = new THREE.Line(trailGeometry, new THREE.LineBasicMaterial({ color: 0xffe8a8, transparent: true, opacity: .5, depthWrite: false }))
  flightTrail.frustumCulled = false
  scene.add(flightTrail)
  let trailTick = -1
  let trailDelivery: Delivery | undefined
  const confettiPositions = new Float32Array(96 * 3)
  const confettiColors = new Float32Array(96 * 3)
  const confettiGeometry = new THREE.BufferGeometry()
  confettiGeometry.setAttribute('position', new THREE.BufferAttribute(confettiPositions, 3))
  confettiGeometry.setAttribute('color', new THREE.BufferAttribute(confettiColors, 3))
  const confettiMaterial = new THREE.PointsMaterial({ size: .095, vertexColors: true, transparent: true, opacity: 0, depthWrite: false })
  const confetti = new THREE.Points(confettiGeometry, confettiMaterial)
  confetti.frustumCulled = false
  scene.add(confetti)
  let celebration: Delivery | undefined
  let confettiAge = 5
  const partyColors = [new THREE.Color(0xeaff53), new THREE.Color(0x5ae5e1), new THREE.Color(0xffa854)]
  let pixelCap = 1.45
  let contextLost = false

  function resize() {
    const width = Math.max(1, container.clientWidth)
    const height = Math.max(1, container.clientHeight)
    const bufferLimit = 1920
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelCap, bufferLimit / width))
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.fov = camera.aspect < 1.2 ? 52 : 43
    camera.updateProjectionMatrix()
  }

  resize()
  new ResizeObserver(resize).observe(container)
  // Reserve the actual HUD height: wrapping and safe-area insets vary by device.
  const scoreboard = container.closest('.game')?.querySelector<HTMLElement>('#scoreboard')
  if (scoreboard) new ResizeObserver(() => {
    container.style.bottom = `${scoreboard.offsetHeight}px`
  }).observe(scoreboard)

  // The graphics quality trades resolution for frame rate on weaker devices.
  const canvas = renderer.domElement
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault()
    contextLost = true
  })
  canvas.addEventListener('webglcontextrestored', () => {
    contextLost = false
    resize()
  })

  function moveFielder(rig: Rig, x: number, z: number, pace: number, delivery: Delivery | undefined, active: boolean, closeStance = 0) {
    const prev = movingActors.get(rig)
    const speed = prev ? Math.hypot(prev.x - x, prev.y - z) / Math.max(.005, pace) : 0
    rig.base.position.set(x, 0, z)
    if (prev) prev.set(x, z)
    else movingActors.set(rig, new THREE.Vector2(x, z))
    const receiving = active && delivery && ((delivery.action === 'pickup' || delivery.action === 'hold') || delivery.action === 'return')
    if (active && speed > .6 && !receiving) runPose(rig, (delivery?.tick ?? 0) * DT, Math.min(1, speed / 5))
    else neutralPose(rig, time + x * .14, receiving ? .25 : closeStance)
    if (active && delivery) aimActor(rig, delivery.ball.x, delivery.ball.z)
    else aimActor(rig, 0, 0)
    if (receiving) {
      if (delivery.action === 'return') {
        aimActor(rig, 0, 0)
        const throwCycle = 1 - Math.min(1, Math.hypot(delivery.ball.x - x, delivery.ball.z - z) / 9)
        rig.body.position.y += .25
        rig.arms[1].shoulder.rotation.x = -2.25 * throwCycle
        rig.arms[0].shoulder.rotation.x = -.8 * throwCycle
      } else {
        rig.shoulders.rotation.x = .55
        rig.arms[0].shoulder.rotation.x = -.7
        rig.arms[1].shoulder.rotation.x = -.74
      }
    }
  }

  function render(frame: StadiumFrame, dt: number) {
    const reducedMotion = frame.reducedMotion ?? motionPreference
    time += dt
    pennants.forEach((flag, i) => {
      flag.rotation.y = .64 + Math.sin(time * (2.1 + wind) + i * 1.9) * (.18 + wind * .065)
      flag.rotation.x = Math.sin(time * 4.3 + i) * wind * .045
    })
    const isHome = frame.mode === 'home'
    if (isHome && !reducedMotion) {
      demoClock += dt
      if (demoClock > 8) {
        demoClock = demoAccumulator = 0
        demoRound++
        demo = new Delivery({ seed: 41, kind: 'fast', line: .2 })
      }
      const demoShot = demoRound % 2 ? 'loft' : 'drive'
      if (demoClock >= 1.6) {
        demoAccumulator += dt
        while (demoAccumulator >= DT && !demo.outcome) {
          if (demo.tick === demo.contactTick) demo.swing({ kind: demoShot, aim: .15, power: 1 })
          demo.step()
          demoAccumulator -= DT
        }
      }
      frame = { ...frame, phase: demoClock < 1.6 ? 'windup' : demo.phase, delivery: demo, windup: Math.min(1, demoClock / 1.6), shot: demoShot }
    }
    const isBowling = frame.mode === 'bowl'
    const phase = frame.phase
    const delivery = phase !== 'ready' && phase !== 'windup' ? frame.delivery : undefined
    if (delivery !== boundaryDelivery) {
      boundaryDelivery = delivery
      boundaryFlight = null
      boundaryAccumulator = 0
    }
    if (delivery?.outcome?.reason === 'boundary' && !boundaryFlight) boundaryFlight = delivery.boundaryFlight()
    if (boundaryFlight) {
      boundaryAccumulator += dt
      while (boundaryAccumulator >= DT) {
        boundaryFlight.step(landingSurface)
        boundaryAccumulator -= DT
      }
    }
    const currentBall = boundaryFlight?.ball ?? delivery?.ball
    const visualTick = (delivery?.tick ?? 0) + (boundaryFlight?.tick ?? 0)
    const newMode = frame.mode !== mode
    deadTime = phase === 'dead' ? deadTime + dt : 0
    crowdMotion.time.value = reducedMotion ? 0 : time
    crowdMotion.energy.value = reducedMotion ? 0 : phase === 'dead' && frame.signal ? Math.max(0, 1 - deadTime / 4) : isHome ? .22 : .04
    if (!reducedMotion && delivery && celebration !== delivery && frame.signal === 'six' && phase === 'dead') {
      celebration = delivery
      confettiAge = 0
    }
    confettiAge += dt
    confetti.visible = confettiAge < 3.8
    if (confetti.visible) {
      for (let i = 0; i < 96; i++) {
        const t = confettiAge
        confettiPositions.set([(noise(i + 19) - .5) * (4 + t * 4), 2 + noise(i + 61) * 3 + t * 2 - t * t * .8,
          .5 + (noise(i + 113) - .5) * (4 + t * 3)], i * 3)
        partyColors[i % partyColors.length].toArray(confettiColors, i * 3)
      }
      confettiMaterial.opacity = Math.min(1, (3.8 - confettiAge) * 2)
      confettiGeometry.attributes.position.needsUpdate = true
      confettiGeometry.attributes.color.needsUpdate = true
    }
    if (delivery?.contactEventTick !== null && delivery?.contact !== 'miss' && delivery?.contact && previousContact !== delivery) {
      previousContact = delivery
      contactKick = delivery.timing === 'perfect' && delivery.contact === 'middle' ? .075 : .025
    }
    contactKick = Math.max(0, contactKick - dt * .35)
    if (newMode) {
      mode = frame.mode
      battingColors.shirt.color.setHex(isBowling && !frame.cooperative ? 0xa94749 : 0x198f89)
      battingColors.pants.color.setHex(isBowling && !frame.cooperative ? 0x683946 : 0x214d55)
      battingColors.trim.color.setHex(isBowling && !frame.cooperative ? 0xf4d4a1 : 0xf6c963)
      fieldingColors.shirt.color.setHex(isBowling && !frame.cooperative ? 0x198f89 : 0xa94749)
      fieldingColors.pants.color.setHex(isBowling && !frame.cooperative ? 0x214d55 : 0x683946)
      fieldingColors.trim.color.setHex(isBowling && !frame.cooperative ? 0xf6c963 : 0xf4d4a1)
    }

    const running = delivery?.runnerProgress ?? 0
    const reverse = ((delivery?.completedRuns ?? 0) % 2) !== 0
    const progress = reverse ? 1 - running : running
    const manual = delivery?.manualRunning
    const strideLength = PITCH_LENGTH - 2.44
    const runnerPositions = manual ? delivery.runnerPositions : undefined
    striker.base.position.set(.57, 0, runnerPositions ? strikerRootZ(runnerPositions[0], running, delivery?.completedRuns ?? 0) : .08 + progress * strideLength)
    nonStriker.base.position.set(-.84, 0, runnerPositions?.[1] ?? PITCH_LENGTH - 1.22 - progress * strideLength)
    const swing = delivery?.swingTick == null ? frame.practiceSwing?.age : (delivery.tick - delivery.swingTick) * DT
    const awayFromGuard = running > 0 || (delivery?.completedRuns ?? 0) > 0
    if (awayFromGuard) {
      const clock = (delivery?.tick ?? 0) * DT
      if (delivery?.runnersMoving) {
        runPose(striker, clock, 1)
        runPose(nonStriker, clock, 1)
      } else {
        neutralPose(striker, time)
        neutralPose(nonStriker, time)
      }
      const backwards = reverse !== (delivery?.runnersReturning ?? false)
      striker.base.rotation.y = backwards ? Math.PI : 0
      nonStriker.base.rotation.y = backwards ? 0 : Math.PI
    } else {
      batterPose(striker, time, swing, frame.practiceSwing?.shot ?? frame.shot, frame.shotAngle, delivery?.batImpact ?? delivery?.projectedContact, delivery ? smooth((delivery.tick - delivery.contactTick + 26) / 23) : 0)
      neutralPose(nonStriker, time, .025)
      nonStriker.base.rotation.y = 2.75
      nonStriker.arms[1].shoulder.rotation.x = -.67
      if (nonStriker.bat) nonStriker.bat.rotation.set(.73, 0, -.31)
    }
    if (phase === 'dead' && (frame.signal === 'six' || frame.signal === 'four') && deadTime > .8) {
      neutralPose(striker, time)
      striker.arms[1].shoulder.rotation.x = -2.45
      striker.arms[1].elbow.rotation.x = -.25
      striker.shoulders.rotation.y = Math.sin(time) * .15
    }

    if (awayFromGuard || (phase === 'dead' && deadTime > .8)) gripBat(striker)
    gripBat(nonStriker)
    const bowlerPhase = phase
    const bowlingKind = frame.bowlingKind ?? frame.delivery?.kind
    const spin = bowlingKind !== undefined && isSpinDelivery(bowlingKind)
    bowlingPose(bowler, time, bowlerPhase, frame.windup ?? 0, (delivery?.tick ?? 0) * DT, spin)
    if (delivery?.manualFielding && delivery.throwTarget === 'bowler' && (delivery.action === 'return' || delivery.wicketBroken)) {
      moveFielder(bowler, 0, PITCH_LENGTH + .25, dt, delivery, true)
      receivePose(bowler, delivery, time)
    }
    const keeperPosition = delivery?.keeper ?? KEEPER
    const approachingKeeper = Boolean(delivery && delivery.phase === 'flight' && delivery.ball.z < 3)
    const breaking = delivery?.action === 'break' || delivery?.outcome?.reason === 'run-out'
    moveFielder(keeper, keeperPosition.x, keeperPosition.z, dt, delivery, approachingKeeper || breaking || delivery?.activeFielder === FIELDERS.length, .16)
    if (delivery?.outcome?.reason === 'collected' || approachingKeeper || breaking) {
      receivePose(keeper, delivery, time)
    }
    const presetPositions = fieldPositions(frame.fieldPreset, frame.maxOutside, frame.fieldLayout)
    fielders.forEach((rig, index) => {
      const spot = (phase === 'ready' || phase === 'dead') && isBowling && !frame.replay ? presetPositions[index] : delivery?.fielders[index] ?? presetPositions[index]
      moveFielder(rig, spot.x, spot.z, dt, delivery, delivery?.activeFielder === index, .035)
      if (delivery?.outcome?.reason === 'caught' && delivery.activeFielder === index) receivePose(rig, delivery, time)
    })
    umpirePose(umpire, time, phase === 'dead' ? frame.signal : undefined)
    neutralPose(squareUmpire, time + .5)
    aimActor(squareUmpire, 0, 0)

    const broken = delivery?.wicketBroken || delivery?.outcome?.reason === 'bowled' || delivery?.outcome?.reason === 'run-out'
    bails.forEach((pair, end) => pair.forEach((bail, index) => {
      const brokenHere = broken && end === (delivery?.throwTarget === 'bowler' && delivery.wicketBroken ? 1 : 0)
      bail.position.y = brokenHere ? .04 : .712
      bail.position.z = brokenHere ? .22 + .17 * index : 0
      bail.rotation.y = brokenHere ? .77 * (index === 0 ? 1 : -1) : 0
    }))
    const held = phase === 'windup' || (isBowling && phase === 'ready')
    ballModel.visible = currentBall !== undefined || held
    ballShadow.visible = currentBall !== undefined
    if (currentBall) {
      const { x, y, z } = currentBall
      ballModel.position.set(x, Math.max(.077, y), z)
      ballModel.rotation.set((visualTick * .31) % TAU, (visualTick * .22) % TAU, .34)
      const scale = THREE.MathUtils.clamp(1 + camera.position.distanceTo(ballModel.position) * .010, 1, 1.72)
      ballModel.scale.setScalar(scale)
      ballShadow.position.set(x, .027, z)
      ballShadow.scale.setScalar(1 + Math.min(y, 8) * .12)
      if (trailDelivery !== delivery) {
        trailDelivery = delivery
        trailTick = -1
        for (let i = 0; i < 24; i++) trailPositions.set([x, y, z], i * 3)
      }
      if (trailTick !== visualTick) {
        trailPositions.copyWithin(3, 0, trailPositions.length - 3)
        trailPositions.set([x, y, z])
        trailTick = visualTick
        trailGeometry.attributes.position.needsUpdate = true
      }
    } else if (held) {
      heldBall.set(0, -.244, .052)
      ballModel.position.copy(bowler.arms[1].elbow.localToWorld(heldBall))
      ballModel.rotation.set(0, 0, .32)
      ballModel.scale.setScalar(1)
    }
    flightTrail.visible = Boolean(currentBall && (phase !== 'dead' || boundaryFlight && !boundaryFlight.settled))
    const sweetSpot = delivery?.timing === 'perfect' && delivery.contact === 'middle'
    flightTrail.material.color.setHex(sweetSpot ? 0xffd56b : 0xffe8a8)
    flightTrail.material.opacity = sweetSpot ? .85 : .45

    const aim = !isHome && isBowling && (phase === 'ready' || phase === 'windup') ? frame.aim : undefined
    marker.visible = aim !== undefined
    if (aim) {
      marker.position.set(aim.x, .043, aim.z)
      marker.scale.setScalar(1.68)
    }

    const lateral = Math.min(1, camera.aspect / 1.25)
    if (isHome) {
      const sway = reducedMotion ? 0 : Math.sin(time * .19)
      cameraPosition.set((4.7 + sway * .25) * lateral, 2.65, -7.2)
      cameraTarget.set(1.4 * lateral, 1.05, 7.5)
    } else if (isBowling) {
      cameraPosition.set(-3.65 * lateral, 3.42, PITCH_LENGTH + 16.25)
      cameraTarget.set(.14, .88, 8.1)
    } else {
      // Keep the user's straight, behind-the-pitch view at every screen width.
      cameraPosition.set(.4, 2.8, -6.2)
      cameraTarget.set(.4, 1.05, 9.5)
    }
    if (frame.replay && isBowling) {
      cameraPosition.x += .84
      cameraPosition.y += .42
    }
    if (!isHome && currentBall && (phase === 'field' || phase === 'dead')) {
      const landingAge = boundaryFlight?.landedAt === null ? 0 : boundaryFlight ? (boundaryFlight.tick - boundaryFlight.landedAt!) * DT : 0
      const deadBlend = boundaryFlight ? 1 - THREE.MathUtils.smoothstep(landingAge, 1.5, 2.5) : phase === 'dead' ? 1 - THREE.MathUtils.smoothstep(deadTime, .16, 1.3) : 1
      const travel = Math.hypot(currentBall.x, currentBall.z)
      const follow = THREE.MathUtils.smoothstep(travel, 2, 34) * deadBlend
      cameraPosition.x += currentBall.x * .20 * follow
      cameraPosition.y += 9.6 * follow
      cameraPosition.z += currentBall.z * .18 * follow
      cameraTarget.x = THREE.MathUtils.lerp(cameraTarget.x, currentBall.x, follow * .88)
      cameraTarget.y = THREE.MathUtils.lerp(cameraTarget.y, Math.max(.8, currentBall.y * .66), follow * .84)
      cameraTarget.z = THREE.MathUtils.lerp(cameraTarget.z, currentBall.z, follow * .89)
    }
    if (!isHome && !isBowling && phase === 'dead' && frame.signal && !boundaryFlight?.presenting) {
      const decision = THREE.MathUtils.smoothstep(deadTime, .69, 1.7)
      cameraPosition.z += decision * 5.3
      cameraTarget.z += decision * 5
    }
    if (newMode) {
      camera.position.copy(cameraPosition)
      look.copy(cameraTarget)
    } else {
      const blend = 1 - Math.exp(-dt * (phase === 'field' ? 9 : 5))
      camera.position.lerp(cameraPosition, blend)
      look.lerp(cameraTarget, blend)
    }
    if (!reducedMotion && !isHome && contactKick > 0) {
      camera.position.x += Math.sin(time * 79) * contactKick
      camera.position.y += Math.sin(time * 93) * contactKick * .5
    }
    camera.lookAt(look)
    renderer.render(scene, camera)
  }

  return {
    render,
    setConditions,
    /** The graphics quality, trading resolution for frame rate. */
    setQuality(quality: 'high' | 'medium' | 'low') {
      pixelCap = quality === 'low' ? 0.7 : quality === 'medium' ? 1 : 1.45
      resize()
    },
    boundaryPlaying: () => boundaryFlight?.presenting ?? false,
    info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      boundary: boundaryFlight ? { ball: { ...boundaryFlight.ball }, tick: boundaryFlight.tick, landed: boundaryFlight.landedAt !== null, settled: boundaryFlight.settled } : null }),
  }
}
