import * as THREE from 'three'
import { createPlayerMotion, samplePlayerMotion, createFieldingMotion, sampleFieldingMotion, type PlayerMotion } from './player-motion.ts'
import { bladePose, elbowPosition, guardPose, shotFamily, smooth, strikerRootZ } from './batting-motion.ts'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { GRAPHICS_QUALITY, renderPixelRatio, type GraphicsQuality } from './graphics-quality.ts'
import { createGroundEffects } from './ground-effects.ts'
import { QualityMaterials } from './quality-materials.ts'
import { sampleBowlingMotion, type BowlingAppearance } from './bowling-motion.ts'
import type { PlayerProfile } from './player-profile.ts'
import { bowlingReleasePoint, type BowlingExecution } from './bowling.ts'
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
  /** Immutable match snapshots supplied by the match controller. */
  bowlerProfile?: PlayerProfile
  strikerProfile?: PlayerProfile
  nonStrikerProfile?: PlayerProfile
  bowlingSide?: 'over' | 'around'
  bowlingExecution?: BowlingExecution
  /** Physics-owned endpoint, also used at the last windup frame. */
  bowlingRelease?: Vec3
  /** Presentation age in seconds; the controller holds play until the walk-in ends. */
  entranceAge?: number
  /** The replaced end can be the non-striker after a run-out or over-end rotation. */
  entranceEnd?: 'striker' | 'nonStriker'
}

const TAU = Math.PI * 2
const CENTER = PITCH_LENGTH / 2
const BOX = new THREE.BoxGeometry()
const FOG = 0xb7d9eb
const WEATHER_LIGHT = {
  clear: { horizon: 0xe3ece8, zenith: 0x438dcc, fog: FOG, far: 250, clouds: .28, sun: 3.1, ambient: 1.6, wind: 1 },
  overcast: { horizon: 0xd3dadd, zenith: 0x869dae, fog: 0xb5c3c7, far: 205, clouds: .88, sun: 1.25, ambient: 2.05, wind: .7 },
  breezy: { horizon: 0xdae7e7, zenith: 0x4c8cae, fog: 0xb7d4dd, far: 235, clouds: .48, sun: 2.65, ambient: 1.7, wind: 3.1 },
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
  return new THREE.MeshStandardMaterial({ color, roughness: .82, metalness: 0 })
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

/** Merge only rigid siblings; joints and hand targets remain independent. */
function batchRigidParts(parent: THREE.Object3D) {
  const buckets = new Map<THREE.Material, THREE.Mesh[]>()
  for (const child of parent.children) {
    if (!(child instanceof THREE.Mesh) || Array.isArray(child.material)) continue
    const bucket = buckets.get(child.material) ?? []
    bucket.push(child)
    buckets.set(child.material, bucket)
  }
  for (const [surface, parts] of buckets) {
    if (parts.length < 2) continue
    const geometries = parts.map((part) => {
      part.updateMatrix()
      const geometry = part.geometry.clone().applyMatrix4(part.matrix)
      if (!geometry.index) return geometry
      const expanded = geometry.toNonIndexed()
      geometry.dispose()
      return expanded
    })
    const geometry = mergeGeometries(geometries)
    geometries.forEach((part) => part.dispose())
    if (!geometry) continue
    parts.forEach((part) => parent.remove(part))
    mesh(parent, geometry, surface)
  }
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
    if (stadium) mesh(parent, stadium, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .87 }))
  }
}

function makeSky(scene: THREE.Scene) {
  const fog = new THREE.Fog(FOG, 84, 240)
  scene.fog = fog
  scene.background = new THREE.Color(FOG)
  const horizon = { value: new THREE.Color() }
  const zenith = { value: new THREE.Color() }
  const clouds = { value: 0 }
  const skyTime = { value: 0 }
  const skyDetail = { value: 1 }
  const sky = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { horizon, zenith, clouds, skyTime, skyDetail },
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
      uniform float skyTime;
      uniform float skyDetail;
      varying vec3 direction;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float cloudNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
        return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x),
          mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), f.x), f.y);
      }
      void main() {
        vec3 ray = normalize(direction);
        float height = max(0., ray.y);
        vec3 color = mix(horizon, zenith, pow(smoothstep(0., .55, height), .58));
        float sunDot = max(0., dot(ray, normalize(vec3(-.58, .75, -.34))));
        float glow = pow(sunDot, 18.) * (1. - clouds * .7);
        if (clouds > 0. && skyDetail > .5) {
          vec2 uv = ray.xz / max(.18, ray.y) * 1.25 + vec2(skyTime * .004, skyTime * .001);
          float field = cloudNoise(uv) * .57 + cloudNoise(uv * 2.1) * .28 + cloudNoise(uv * 4.3) * .15;
          float cloud = smoothstep(.67 - clouds * .31, .86 - clouds * .22, field);
          vec3 cloudColor = mix(vec3(.66, .73, .79), vec3(.96, .97, .95), smoothstep(.43, .76, field));
          color = mix(color, cloudColor, cloud * smoothstep(.018, .13, height));
        }
        color = mix(color, vec3(1., .93, .76), glow * .26 + pow(sunDot, 1600.) * .64);
        gl_FragColor = vec4(color, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
  mesh(scene, new THREE.SphereGeometry(260, 24, 12), sky, 0, 0, CENTER)
  const ambient = new THREE.HemisphereLight(0xdceeff, 0x576449, 1.6)
  scene.add(ambient)
  const sun = new THREE.DirectionalLight(0xffe6ba, 2.55)
  sun.position.set(-44, 57, -26)
  sun.target.position.set(0, 0, CENTER)
  scene.add(sun.target)
  // A single pitch-sized map gives readable player shadows without rendering
  // thousands of stadium/crowd triangles into a full-ground shadow atlas.
  Object.assign(sun.shadow.camera, { left: -19, right: 19, top: 24, bottom: -24, near: 1, far: 140 })
  sun.shadow.bias = -.00018
  sun.shadow.normalBias = .018
  sun.shadow.radius = 2
  scene.add(sun)
  return { sun, skyTime, skyDetail, setWeather(weather: WeatherPreset) {
    const light = WEATHER_LIGHT[weather]
    horizon.value.setHex(light.horizon)
    zenith.value.setHex(light.zenith)
    clouds.value = light.clouds
    fog.color.setHex(light.fog)
    fog.far = light.far
    ambient.intensity = light.ambient
    sun.intensity = light.sun
    sun.color.setHex(weather === 'overcast' ? 0xe2e9f0 : 0xffe6ba)
  } }
}

function makeField(scene: THREE.Scene) {
  const outside = mesh(scene, new THREE.CircleGeometry(125, 72), material(0x36583b), 0, -.035, CENTER)
  outside.rotation.x = -Math.PI / 2
  const grassMap = canvasMap(512, 512, (ctx) => {
    const pixels = ctx.createImageData(512, 512)
    for (let y = 0; y < 512; y++) {
      for (let x = 0; x < 512; x++) {
        const i = (y * 512 + x) * 4
        const strip = Math.floor((y + x * .22) / 34) % 2
        const fleck = noise(i) * 6 + 1.35 * Math.sin(y * .19) + 1.5 * Math.sin(x * .08 + y * .05)
        pixels.data[i] = 34 + strip * 11 + fleck
        pixels.data[i + 1] = 88 + strip * 14 + fleck
        pixels.data[i + 2] = 43 + strip * 5 + fleck * .5
        pixels.data[i + 3] = 255
      }
    }
    ctx.putImageData(pixels, 0, 0)
  })
  grassMap.anisotropy = 4
  const groundDetail = canvasMap(128, 128, (ctx) => {
    const pixels = ctx.createImageData(128, 128)
    for (let i = 0; i < pixels.data.length; i += 4) {
      const value = 96 + noise(i + 43) * 100
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value
      pixels.data[i + 3] = 255
    }
    ctx.putImageData(pixels, 0, 0)
  })
  groundDetail.colorSpace = THREE.NoColorSpace
  groundDetail.wrapS = groundDetail.wrapT = THREE.RepeatWrapping
  groundDetail.repeat.set(72, 72)
  groundDetail.anisotropy = 4
  const grass = mesh(scene, new THREE.CircleGeometry(BOUNDARY + 4.5, 128), new THREE.MeshStandardMaterial({
    map: grassMap, roughness: 1, bumpMap: groundDetail, bumpScale: .032,
  }), 0, -.005, CENTER)
  grass.rotation.x = -Math.PI / 2
  grass.receiveShadow = true
  // Inactive strips keep some grass. A feathered, mottled square avoids the
  // solid-color rectangular slabs that overpower the active wicket in close-up.
  const squareMap = canvasMap(512, 512, (ctx) => {
    const pixels = ctx.createImageData(512, 512)
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
      const i = (y * 512 + x) * 4
      const groundX = (x / 512 - .5) * 11.5
      const sideDistance = Math.min(Math.abs(groundX - 3.3), Math.abs(groundX + 3.3))
      const patch = Math.sin(x * .071 + Math.sin(y * .041)) * Math.cos(y * .053) * .5 + .5
      const strip = (1 - THREE.MathUtils.smoothstep(sideDistance, .70, 1.08))
        * THREE.MathUtils.smoothstep(Math.min(y, 512 - y), 10, 50) * (.64 + patch * .26)
      const fleck = (noise(i + 53) - .5) * 21 + patch * 9
      pixels.data[i] = 42 + strip * 67 + fleck
      pixels.data[i + 1] = 85 + strip * 15 + fleck
      pixels.data[i + 2] = 40 + strip * 17 + fleck * .7
      pixels.data[i + 3] = 255 * THREE.MathUtils.smoothstep(Math.min(x, 512 - x, y, 512 - y), 0, 22)
    }
    ctx.putImageData(pixels, 0, 0)
  })
  squareMap.anisotropy = 4
  const squareDetail = groundDetail.clone()
  squareDetail.repeat.set(9, 20)
  const squareSurface = new THREE.MeshStandardMaterial({ map: squareMap, roughness: 1,
    bumpMap: squareDetail, bumpScale: .018, transparent: true, depthWrite: false })
  const square = mesh(scene, new THREE.PlaneGeometry(11.5, PITCH_LENGTH + 4.9), squareSurface, 0, .002, CENTER)
  square.rotation.x = -Math.PI / 2
  square.receiveShadow = true
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
    // Footmarks gather around the popping creases, with fine dry surface cracks.
    for (const end of [104, 664]) {
      const wear = ctx.createRadialGradient(64, end, 5, 64, end, 51)
      wear.addColorStop(0, '#c2a17072')
      wear.addColorStop(1, '#c2a17000')
      ctx.fillStyle = wear
      ctx.fillRect(0, end - 54, 128, 108)
      ctx.strokeStyle = '#80643b50'
      ctx.lineWidth = .6
      for (let i = 0; i < 16; i++) {
        const x = 12 + noise(i + end) * 104, y = end - 43 + noise(i + 271) * 86
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x + 2, y + 5)
        ctx.lineTo(x - 1, y + 10)
        ctx.stroke()
      }
    }
    ctx.fillStyle = '#6f542b24'
    for (let i = 0; i < 95; i++) ctx.fillRect(18 + 92 * noise(i + 52), 40 + 690 * noise(i + 90), .5 + noise(i + 60) * 2, 3 + noise(i) * 14)
  })
  pitchMap.anisotropy = 4
  const pitchDetail = groundDetail.clone()
  pitchDetail.repeat.set(3, 22)
  const pitchSurface = new THREE.MeshStandardMaterial({ map: pitchMap, roughness: .96, bumpMap: pitchDetail, bumpScale: .014 })
  const pitch = mesh(scene, new THREE.PlaneGeometry(3.05, PITCH_LENGTH + 4.7), pitchSurface, 0, .012, CENTER)
  pitch.rotation.x = -Math.PI / 2
  pitch.receiveShadow = true

  const crease = material(0xf6efda)
  for (const end of [0, PITCH_LENGTH]) {
    const side = end === 0 ? 1 : -1
    box(scene, crease, 0, .017, end, 2.64, .009, .04)
    box(scene, crease, 0, .019, end + side * 1.22, 3.74, .009, .045)
    for (const x of [-1.32, 1.32]) box(scene, crease, x, .019, end + side * .45, .045, .009, 2.02)
  }

  const rope = mesh(scene, new THREE.TorusGeometry(BOUNDARY, .10, 6, 180), material(0xf2e9c8), 0, .075, CENTER)
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
      // Glazed hospitality level and repeated mullions give the roof a structure.
      model.band(a + .01, b - .01, endRadius + .29, endRadius + .34, 9.64, 9.64, 1.73, 0x244957)
      for (let bay = 1; bay < 7; bay++) {
        const angle = THREE.MathUtils.lerp(a, b, bay / 7)
        const upright = polar(endRadius + .28, angle, 8.78)
        model.block(0xa8bcbc, upright.x, upright.y, upright.z, .09, 1.82, .10, angle)
      }
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
    // Shuffle once so lowering instance count thins all stands evenly.
    crowdPoints.sort((a, b) => noise(a.position.x * 91 + a.position.z) - noise(b.position.x * 91 + b.position.z))
    const crowd = new THREE.InstancedMesh(crowdGeometry, crowdMaterial, crowdPoints.length)
    crowd.userData.crowdCapacity = crowdPoints.length
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
  const boards: THREE.BufferGeometry[] = []
  for (let i = 0; i < 16; i++) {
    const angle = i * TAU / 16
    const position = polar(67.67, angle, .75)
    boards.push(new THREE.PlaneGeometry(10.8, 1.04).rotateY(angle + Math.PI).translate(position.x, position.y, position.z))
  }
  const perimeter = mergeGeometries(boards)
  boards.forEach((geometry) => geometry.dispose())
  if (perimeter) mesh(parent, perimeter, board)
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

let fabricMap: THREE.CanvasTexture | undefined
function palette(shirt: number, pants: number, trim: number) {
  fabricMap ??= canvasMap(64, 64, (ctx) => {
    ctx.fillStyle = '#777777'
    ctx.fillRect(0, 0, 64, 64)
    for (let i = 0; i < 64; i += 4) {
      ctx.fillStyle = '#aaaaaa'
      ctx.fillRect(i, 0, 1, 64)
      ctx.fillStyle = '#999999'
      ctx.fillRect(0, i, 64, 1)
    }
  })
  fabricMap.colorSpace = THREE.NoColorSpace
  fabricMap.wrapS = fabricMap.wrapT = THREE.RepeatWrapping
  fabricMap.repeat.set(5, 5)
  const jersey = material(shirt), trousers = material(pants)
  for (const surface of [jersey, trousers]) {
    surface.bumpMap = fabricMap
    surface.bumpScale = .004
    surface.roughness = .93
  }
  return { shirt: jersey, pants: trousers, trim: material(trim) }
}
type Kit = { shirt: THREE.MeshLambertMaterial | THREE.MeshStandardMaterial; pants: THREE.MeshLambertMaterial | THREE.MeshStandardMaterial; trim: THREE.MeshLambertMaterial | THREE.MeshStandardMaterial }

const skin = [0x995c3e, 0xb87b56, 0x815237, 0xdca17a, 0xa77051].map(material)
const soles = material(0xe8e7d4)
const dark = material(0x192c36)
const leather = material(0xe4e6dd)
const batFace = material(0xe6bd78)
const batGrip = material(0x293b48)
dark.roughness = .39
leather.roughness = .68
batFace.roughness = .47
batGrip.roughness = .94
for (const surface of skin) surface.roughness = .63
const collar = new THREE.TorusGeometry(.072, .014, 5, 12).rotateX(Math.PI / 2)
const BLADE = (() => {
  const shape = new THREE.Shape()
  shape.moveTo(-.045, -.215)
  shape.lineTo(.045, -.215)
  shape.quadraticCurveTo(.064, -.255, .064, -.29)
  shape.lineTo(.061, -.813)
  shape.quadraticCurveTo(0, -.846, -.061, -.813)
  shape.lineTo(-.064, -.29)
  shape.quadraticCurveTo(-.064, -.255, -.045, -.215)
  return new THREE.ExtrudeGeometry(shape, { depth: .034, bevelEnabled: true, bevelSegments: 1,
    steps: 1, bevelSize: .004, bevelThickness: .004, curveSegments: 3 }).translate(0, 0, -.017)
})()
const HANDLE = new THREE.CylinderGeometry(.019, .021, .25, 8)
const SHOE = new THREE.CapsuleGeometry(.064, .13, 3, 6).rotateX(Math.PI / 2).scale(1, .61, 1)
const TORSO = new THREE.CylinderGeometry(.251, .186, .44, 16).scale(1, 1, .69)
const HIP = new THREE.CylinderGeometry(.19, .19, .18, 12).scale(1, 1, .82)
const HEAD = new THREE.SphereGeometry(.119, 16, 12).scale(.86, 1.12, .91)
const HELMET = new THREE.SphereGeometry(.15, 20, 12, 0, TAU, 0, Math.PI * .64).scale(.89, .93, 1.04)
const FACIAL = new THREE.SphereGeometry(1, 8, 6)
const UPPER_ARM = new THREE.CylinderGeometry(.078, .055, .28, 10)
const FOREARM = new THREE.CylinderGeometry(.057, .043, .246, 10)
const HAND = new THREE.SphereGeometry(.058, 8, 5).scale(.86, 1.16, .8)
const THIGH = new THREE.CylinderGeometry(.103, .079, .37, 12)
const SHIN = new THREE.CylinderGeometry(.078, .049, .34, 12)

type Role = 'batter' | 'bowler' | 'fielder' | 'keeper' | 'umpire'
type Rig = ReturnType<typeof athlete>

export function athlete(scene: THREE.Scene, kit: Kit, role: Role, id: number, shadow: THREE.MeshBasicMaterial) {
  const base = group(scene)
  const footShadow = makeShadow(base, shadow, .83)
  footShadow.scale.y = .67
  const body = group(base, 0, .86)
  const shoulders = group(body)
  // One skin surface per athlete allows appearance changes without recoloring
  // another player. It is collected by the stadium's existing disposal pass.
  const playerSkin = skin[id % skin.length].clone()
  const helmeted = role === 'batter' || role === 'keeper'
  const handsPadded = helmeted
  mesh(shoulders, HIP, kit.pants, 0, .015, 0)
  mesh(shoulders, TORSO, kit.shirt, 0, .26, 0)
  if (role !== 'batter' && role !== 'bowler') box(shoulders, kit.trim, 0, .297, -.147, .309, .032, .018)
  box(shoulders, kit.trim, 0, .32, .146, .29, .026, .019)
  if (role === 'batter' || role === 'bowler') {
    box(shoulders, kit.trim, -.125, .365, .146, .036, .062, .014)
    box(shoulders, kit.trim, .125, .365, .146, .052, .042, .014)
  }
  mesh(shoulders, collar, kit.trim, 0, .474)
  const head = group(shoulders, 0, .58)
  mesh(head, HEAD, playerSkin)
  mesh(head, FACIAL, playerSkin, 0, -.033, .106).scale.set(.018, .026, .025)
  for (const side of [-1, 1]) {
    mesh(head, FACIAL, playerSkin, side * .102, -.016, 0).scale.set(.017, .027, .017)
    mesh(head, FACIAL, dark, side * .036, -.014, .097).scale.set(.009, .005, .006)
  }
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
    mesh(ankle, SHOE, soles, 0, -.023, .045)
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
    mesh(bat, HANDLE, batGrip, 0, -.107)
    mesh(bat, BLADE, batFace)
    box(bat, kit.trim, 0, -.341, .025, .095, .08, .007)
    box(bat, dark, 0, -.41, .025, .083, .028, .007)
  }
  batchRigidParts(shoulders)
  batchRigidParts(head)
  for (const leg of legs) batchRigidParts(leg.knee)
  const identity: { key: string; surface?: THREE.MeshBasicMaterial; texture?: THREE.CanvasTexture; mesh?: THREE.Mesh } = { key: '' }
  if (role === 'batter' || role === 'bowler') {
    identity.surface = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false })
    identity.mesh = mesh(shoulders, new THREE.PlaneGeometry(.39, .34), identity.surface, 0, .263, -.179)
    identity.mesh.rotation.y = Math.PI
    identity.mesh.visible = false
  }
  return { base, body, shoulders, head, arms, legs, bat, playerSkin, identity }
}

/** Repaint three small reusable jersey canvases only when identities change. */
export function updateAthleteIdentity(rig: Rig, profile?: PlayerProfile) {
  if (!rig.identity.surface || !rig.identity.mesh) return
  rig.identity.mesh.visible = Boolean(profile)
  if (!profile) { delete rig.base.userData.playerId; return }
  const { jerseyName, jerseyNumber, skinTone, captain } = profile.identity
  const key = `${profile.id}|${jerseyName}|${jerseyNumber}|${skinTone}|${captain}`
  rig.base.userData.playerId = profile.id
  if (rig.identity.key === key) return
  rig.identity.key = key
  rig.playerSkin.color.set(skinTone)
  let texture = rig.identity.texture
  if (!texture) {
    texture = canvasMap(256, 256, () => {})
    rig.identity.texture = texture
    rig.identity.surface.map = texture
    rig.identity.surface.needsUpdate = true
  }
  const canvas = texture.image as HTMLCanvasElement
  const context = canvas.getContext('2d')!
  context.clearRect(0, 0, 256, 256)
  context.fillStyle = '#fff5d9'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.font = `700 ${jerseyName.length > 12 ? 24 : 30}px Arial, sans-serif`
  context.fillText(jerseyName, 128, 35, 234)
  context.font = '900 142px Arial, sans-serif'
  context.fillText(String(jerseyNumber).padStart(2, '0'), 128, 139, 218)
  if (captain) {
    context.font = '700 20px Arial, sans-serif'
    context.fillText('CAPTAIN', 128, 229)
  }
  texture.needsUpdate = true
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

function runPose(rig: Rig, clock: number, strength: number, motion?: PlayerMotion) {
  neutralPose(rig, clock)
  const stride = motion?.swing ?? Math.sin(clock * 15) * strength
  rig.body.position.y += motion?.lift ?? Math.abs(stride) * .042
  rig.shoulders.rotation.x = motion?.lean ?? strength * .14
  rig.shoulders.rotation.y = stride * .13
  rig.body.rotation.z = motion?.bank ?? 0
  rig.head.rotation.x = -rig.shoulders.rotation.x * .6
  for (let i = 0; i < 2; i++) {
    const swing = i === 0 ? stride : -stride
    rig.legs[i].hip.rotation.x = swing * .72
    rig.legs[i].knee.rotation.x = .14 + Math.max(0, -swing) * 1.06
    rig.legs[i].ankle.rotation.x = -.08 - Math.max(0, swing) * .23
    rig.arms[i].shoulder.rotation.x = -swing * .66
    rig.arms[i].elbow.rotation.x = -.6 - strength * .36
  }
  if (rig.bat) {
    rig.bat.position.set(.21, .11, .19)
    rig.bat.rotation.set(.66, -.16, -.22)
  }
}

function aimActor(rig: Rig, x: number, z: number) {
  const { position } = rig.base
  if (Math.hypot(x - position.x, z - position.z) > .02) rig.base.rotation.y = Math.atan2(x - position.x, z - position.z)
}

const DOWN = new THREE.Vector3(0, -1, 0)
const GRIP_OFFSETS = [-.145, -.045] as const
const gripOffset = new THREE.Vector3()
const gripWrist = new THREE.Vector3()
const gripReach = new THREE.Vector3()
const gripPole = new THREE.Vector3()
const gripLower = new THREE.Vector3()
const gripInverse = new THREE.Quaternion()
/** Keep both wrist targets reachable, instead of stretching forearms or detaching gloves. */
function gripBat(rig: Rig, hand: 'right' | 'left' = 'right') {
  if (!rig.bat) return
  for (let pass = 0; pass < 8; pass++) {
    for (let i = 0; i < 2; i++) {
      const offset = gripOffset.set(0, GRIP_OFFSETS[hand === 'left' ? 1 - i : i], 0).applyQuaternion(rig.bat.quaternion)
      const wrist = gripWrist.copy(rig.bat.position).add(offset)
      const shoulder = rig.arms[i].shoulder.position
      const reach = gripReach.copy(wrist).sub(shoulder)
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
    const wrist = gripWrist.set(0, GRIP_OFFSETS[hand === 'left' ? 1 - i : i], 0).applyQuaternion(rig.bat.quaternion).add(rig.bat.position)
    const shoulder = arm.shoulder.position
    const pole = gripPole.set(i === 0 ? -.32 : .32, i === 0 ? -.18 : -.03, .30).add(shoulder)
    const elbow = elbowPosition(shoulder, wrist, pole)
    arm.shoulder.quaternion.setFromUnitVectors(DOWN, gripReach.copy(elbow).sub(shoulder).normalize())
    const lower = gripLower.copy(wrist).sub(elbow).normalize().applyQuaternion(gripInverse.copy(arm.shoulder.quaternion).invert())
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

export function batterPose(rig: Rig, time: number, swing: number | undefined, shot: StadiumFrame['shot'], direction = 0, impact?: Vec3, preparation = 0, hand: 'right' | 'left' = 'right') {
  const side = hand === 'left' ? -1 : 1
  neutralPose(rig, time)
  // Left shoulder and front foot point down the pitch; the head looks at the bowler.
  rig.base.rotation.y = -1.32 * side
  const kind = shot ?? 'drive'
  const family = shotFamily(kind)
  const active = swing !== undefined && swing < 1.1
  const age = Math.max(0, swing ?? 0)
  const contact = impact ?? { x: .10 * side, y: .55, z: .46 }
  const motion = bladePose(kind, age, contact, direction, hand)
  const plant = active ? smooth(age / (5 / 60)) * motion.weight : 0
  const sweep = family === 'sweep'
  const backfoot = kind.startsWith('backfoot') || family === 'cross'
  const evasion = kind === 'duck' || kind === 'leave'
  const duck = kind === 'duck' ? plant : 0
  const turn = plant * (family === 'cross' || sweep ? -.48 : -.18) * Math.sin(direction)
  rig.body.position.y = .735 - plant * (sweep ? .22 : .035 + Math.max(0, .55 - contact.y) * .30) - duck * .20
  // Shift the pelvis with the step. Hip joints themselves never leave the body.
  const lineStep = THREE.MathUtils.clamp((contact.x - rig.base.position.x) * side, -.28, .18) * side
  const stride = new THREE.Vector3(plant * lineStep * .5, 0, plant * (backfoot ? -.15 : .20))
  stride.applyAxisAngle(new THREE.Vector3(0, 1, 0), -rig.base.rotation.y)
  rig.body.position.x = stride.x
  rig.body.position.z = .015 + stride.z
  rig.shoulders.rotation.set(.16 + plant * (sweep ? .20 : .07) + duck * .15, turn, 0)
  rig.head.rotation.set(-rig.shoulders.rotation.x * .6, -rig.base.rotation.y - turn, -.04 * side)
  const feet = [new THREE.Vector3(-.185, .065, hand === 'left' ? -.015 : .035), new THREE.Vector3(.185, .065, hand === 'left' ? .035 : -.015)]
  // Plant toward the incoming line; shot direction controls the swing, not the foot target.
  const step = new THREE.Vector3(plant * lineStep, 0, plant * (backfoot ? -.25 : sweep ? .30 : .38))
  step.applyAxisAngle(new THREE.Vector3(0, 1, 0), -rig.base.rotation.y)
  feet[hand === 'left' ? backfoot ? 1 : 0 : backfoot ? 0 : 1].add(step)
  plantFeet(rig, feet)
  if (!rig.bat) return
  // Idle is a grounded guard, never the first frame of an overhead swing.
  const guard = guardPose(time, preparation * (active ? motion.weight : swing === undefined ? 1 : 0), hand)
  const centre = guard.centre.clone().add(rig.base.position)
  const shaft = guard.shaft.clone()
  if (active) {
    const stroke = smooth(age / (5 / 60)) * motion.weight
    if (evasion) {
      centre.add(new THREE.Vector3(.17 * side, kind === 'leave' ? .35 : .12, -.12).multiplyScalar(plant))
      shaft.lerp(new THREE.Vector3(.1 * side, .6, .8).normalize(), plant)
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
      .addScaledVector(localShaft, (hand === 'left' ? i === 1 : i === 0) ? .380 : .480).distanceTo(arm.shoulder.position) <= .503)
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
  gripBat(rig, hand)
}

/** Articulated bowling pose: fast, medium, finger and wrist actions have separate
 * choreography. Arm IK joins each action to the simulation's release endpoint. */
export function bowlingPose(rig: Rig, time: number, phase: StadiumFrame['phase'], windup: number, releaseAge: number,
  appearance: BowlingAppearance = { arm: 'right', type: 'fast', action: 'high-arm' },
  release: Vec3 = { x: .28, y: 2.06, z: PITCH_LENGTH - 1.83 }) {
  const motion = sampleBowlingMotion(appearance, phase, windup, releaseAge)
  const side = appearance.arm === 'left' ? 1 : -1
  const deliveryClock = phase === 'windup' ? windup * 3 : releaseAge
  const following = phase === 'flight' || phase === 'field'
  rig.base.scale.setScalar(1.28)
  rig.base.rotation.set(0, Math.PI, 0)
  // Lower side-arm and spin releases use a wider arm arc, rather than folding
  // the elbow to reach a lower endpoint. The release itself remains fixed.
  const releaseLean = motion.spin ? .04 : .11
  const shoulderY = (.735 + .41 * Math.cos(releaseLean)) * 1.28
  const verticalReach = release.y - shoulderY
  const lateralReach = Math.sqrt(Math.max(0, (.505 * 1.28) ** 2 - verticalReach ** 2 - .105 ** 2))
  rig.base.position.set(release.x + side * (.223 * 1.28 + lateralReach), 0, release.z + .12 + motion.distanceRemaining)
  runPose(rig, motion.stride / 15, motion.runAmount)
  const stride = Math.sin(motion.stride) * motion.runAmount
  rig.body.position.y = .735 - motion.runAmount * .027 + Math.abs(stride) * .018
    + motion.gather * (motion.spin ? .030 : .055) - motion.rearSweep * .035
  rig.body.position.x = stride * .012
  rig.shoulders.rotation.set(motion.lean, motion.twist, side * (-motion.gather * .07 + motion.rearSweep * .09))
  rig.head.rotation.set(-motion.lean * .72, -motion.twist * .76, 0)
  const arm = rig.arms[motion.armIndex]
  const guide = rig.arms[1 - motion.armIndex]
  if (phase === 'windup' || following) {
    const action = phase === 'windup' ? smooth((windup - .55) / .17) : 1
    const recovery = motion.recovery
    // Positive rotation completes a real arm wheel: behind the hip, above the
    // shoulder, through release, then down across the body. The guide arm leads
    // the gather and pulls down into the delivery rather than rising in unison.
    const wheel = .68 + 2.50 * motion.armCircle
    const circle = THREE.MathUtils.lerp(wheel, Math.PI * 2 - .16, recovery)
    arm.shoulder.rotation.set(THREE.MathUtils.lerp(arm.shoulder.rotation.x, circle, action), 0,
      (side * .12 + motion.armArc * Math.sin(motion.armCircle * Math.PI * .84)) * action * (1 - recovery))
    arm.elbow.rotation.set(THREE.MathUtils.lerp(arm.elbow.rotation.x,
      -.38 * (1 - Math.min(1, motion.armCircle)) - (motion.wristSpin ? .31 : .04) * motion.gather
      - motion.rearSweep * .27, action) * (1 - recovery) - recovery * .13, motion.wrist * motion.gather, 0)
    arm.hand.rotation.set(0, motion.wrist * (motion.gather + motion.releaseBlend * .35), 0)
    guide.shoulder.rotation.set(THREE.MathUtils.lerp(guide.shoulder.rotation.x,
      -motion.gather * 2.68 + motion.plant * .55 + motion.rearSweep * .68, action) * (1 - recovery), 0, -side * .17)
    guide.elbow.rotation.set(THREE.MathUtils.lerp(guide.elbow.rotation.x,
      -.28 - motion.gather * .44 + motion.plant * .10 - motion.rearSweep * .45, action), 0, 0)

    // Solve the feet through the whole approach. The planted shoe stays flat;
    // the other lifts on its swing, then the front leg braces as the rear sweeps.
    const feet = [new THREE.Vector3(-.11, .065, 0), new THREE.Vector3(.11, .065, 0)]
    feet.forEach((foot, i) => {
      const gait = i === motion.frontFootIndex ? stride : -stride
      foot.z = gait * .23
      foot.y += Math.max(0, gait) * .075
      const isFront = i === motion.frontFootIndex
      const gatheredZ = isFront ? .25 : -.13
      foot.z = THREE.MathUtils.lerp(foot.z, gatheredZ, motion.gather)
      foot.y += motion.gather * (isFront ? .13 : .085)
      foot.z = THREE.MathUtils.lerp(foot.z, isFront ? .20 : -.16, motion.plant)
      foot.y = THREE.MathUtils.lerp(foot.y, .065, motion.plant)
      if (following) {
        const step = smooth((releaseAge - .17) / .65)
        foot.z += (isFront ? -.17 : .44) * step * (1 - recovery)
        foot.y += (isFront ? .025 * step : .22) * motion.rearSweep
        if (isFront) foot.z += motion.distanceRemaining / 1.28 * (1 - smooth((releaseAge - .12) / .20))
      }
    })
    plantFeet(rig, feet)
    if (motion.releaseBlend > 0) {
      rig.base.updateWorldMatrix(true, true)
      const wrist = arm.hand.getWorldPosition(new THREE.Vector3())
      // At tick zero this is identical to the last windup sample. After release,
      // the hand follows its own downward arc while the ball follows physics.
      const target = new THREE.Vector3(release.x, release.y, release.z)
      if (following) {
        const sweep = smooth(releaseAge / .28)
        target.y -= .58 * sweep
        target.z -= .45 * sweep
        target.x += side * .24 * sweep
      }
      wrist.lerp(target, motion.releaseBlend)
      const localWrist = rig.shoulders.worldToLocal(wrist)
      const shoulder = arm.shoulder.position
      const pole = new THREE.Vector3(shoulder.x + side * .18, shoulder.y + .09, -.23)
      const elbow = elbowPosition(shoulder, localWrist, pole)
      arm.shoulder.quaternion.setFromUnitVectors(DOWN, elbow.clone().sub(shoulder).normalize())
      arm.elbow.quaternion.setFromUnitVectors(DOWN, localWrist.clone().sub(elbow).normalize().applyQuaternion(arm.shoulder.quaternion.clone().invert()))
    }
  } else {
    arm.hand.rotation.set(0, 0, 0)
    if (phase === 'dead' && motion.runAmount > .01) {
      runPose(rig, motion.stride / 15, motion.runAmount)
      rig.base.rotation.y = Math.PI * (1 - smooth((releaseAge - .35) / .25) + smooth((releaseAge - 2.8) / .4))
    } else neutralPose(rig, phase === 'ready' ? time : deliveryClock)
    rig.body.position.y = .735
    if (phase === 'ready') {
      arm.shoulder.rotation.x = -.40
      arm.elbow.rotation.x = -.55
      guide.shoulder.rotation.x = -.47
      guide.elbow.rotation.x = -.61
    }
  }
  rig.base.userData.bowlingStage = motion.stage
  rig.base.userData.bowlingArm = appearance.arm
  return motion
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
      const stump = mesh(assembly, posts, wood, x, .352)
      stump.castShadow = true
      stump.receiveShadow = true
      box(assembly, painted, x, .49, -.019, .024, .09, .007)
    }
    return [-.0575, .0575].map((x) => {
      const model = mesh(assembly, bail, wood, x, .712)
      model.castShadow = true
      return model
    })
  })
}

export function createStadium(container: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.02
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.domElement.setAttribute('aria-hidden', 'true')
  renderer.domElement.style.cssText = 'position:absolute;inset:0;display:block;width:100%;height:100%'
  container.append(renderer.domElement)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(43, 16 / 9, .085, 310)
  const lighting = makeSky(scene)
  const field = makeField(scene)
  const stands = new Map<Venue, THREE.Group>()
  const qualityMaterials = new QualityMaterials()
  const crowdMotion = { time: { value: 0 }, energy: { value: 0 } }
  let activeStands: THREE.Group | undefined
  let activeVenue: Venue = 'suncrest'
  let quality: GraphicsQuality = 'high'
  let disposed = false
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
    if (disposed) return
    activeVenue = venue
    let seating = stands.get(venue)
    if (!seating) {
      seating = new THREE.Group()
      addStands(seating, venue, crowdMotion)
      qualityMaterials.apply(seating, GRAPHICS_QUALITY[quality].material === 'diffuse')
      seating.traverse((object) => {
        if (object instanceof THREE.InstancedMesh && object.userData.crowdCapacity) {
          object.count = Math.round(object.userData.crowdCapacity * GRAPHICS_QUALITY[quality].crowdDensity)
        }
      })
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
    lighting.setWeather(weather)
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
  for (const rig of [striker, nonStriker, bowler, keeper, umpire]) {
    rig.base.traverse((object) => {
      if (object instanceof THREE.Mesh && object.material !== shadow) {
        object.castShadow = true
        object.receiveShadow = true
      }
    })
  }

  const ballModel = group(scene)
  const ballLeather = material(0xf4f1e7)
  ballLeather.roughness = .36
  mesh(ballModel, new THREE.SphereGeometry(.076, 20, 12), ballLeather)
  const seam = mesh(ballModel, new THREE.TorusGeometry(.074, .0028, 4, 32), material(0xa29b8b))
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
  const dust = createGroundEffects(scene)
  let pitchImpact: Delivery | undefined
  let wicketDelivery: Delivery | undefined
  let wicketAge = 0
  let cachedPreset: FieldPreset | undefined
  let cachedOutside: number | undefined
  let cachedLayout: readonly Vec3[] | undefined
  let presetPositions = fieldPositions()
  const movingActors = new Map<Rig, { locomotion: PlayerMotion; fielding: ReturnType<typeof createFieldingMotion> }>()
  for (const rig of [bowler, keeper, ...fielders]) movingActors.set(rig, { locomotion: createPlayerMotion(), fielding: createFieldingMotion() })
  const strikerMotion = createPlayerMotion(0)
  const partnerMotion = createPlayerMotion(Math.PI, Math.PI * .37)
  let actorDelivery: Delivery | undefined
  let resetActorMotion = true
  let mode: StadiumFrame['mode'] | undefined
  let time = 0
  let deadTime = 0
  let presentedBatterHand: 'left' | 'right' = 'right'
  let presentedBowlerArm: 'left' | 'right' = 'right'
  let presentedRelease: Readonly<Vec3> | undefined
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
  let contextLost = false
  let renderWidth = 0, renderHeight = 0, renderRatio = 0

  function resize() {
    const width = Math.max(1, container.clientWidth)
    const height = Math.max(1, container.clientHeight)
    if (disposed) return
    const ratio = renderPixelRatio(quality, width, window.devicePixelRatio)
    // Reassigning an unchanged canvas size clears its drawing buffer. An
    // observer delivered just after a render must not blank that completed frame.
    if (width === renderWidth && height === renderHeight && ratio === renderRatio) return
    renderWidth = width; renderHeight = height; renderRatio = ratio
    renderer.setPixelRatio(ratio)
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.fov = camera.aspect < 1.2 ? 52 : 43
    camera.updateProjectionMatrix()
  }

  function setQuality(value: GraphicsQuality) {
    if (disposed) return
    quality = value
    const budget = GRAPHICS_QUALITY[quality]
    qualityMaterials.apply(scene, budget.material === 'diffuse')
    for (const seating of stands.values()) qualityMaterials.apply(seating, budget.material === 'diffuse')
    lighting.skyDetail.value = budget.skyDetail ? 1 : 0
    renderer.shadowMap.enabled = budget.shadowSize > 0
    lighting.sun.castShadow = budget.shadowSize > 0
    if (budget.shadowSize === 0 || lighting.sun.shadow.mapSize.x !== budget.shadowSize) {
      lighting.sun.shadow.map?.dispose()
      lighting.sun.shadow.map = null
      lighting.sun.shadow.mapPass?.dispose()
      lighting.sun.shadow.mapPass = null
      if (budget.shadowSize > 0) lighting.sun.shadow.mapSize.set(budget.shadowSize, budget.shadowSize)
    }
    for (const seating of stands.values()) seating.traverse((object) => {
      if (object instanceof THREE.InstancedMesh && object.userData.crowdCapacity) {
        object.count = Math.round(object.userData.crowdCapacity * budget.crowdDensity)
      }
    })
    container.dataset.quality = quality
    resize()
  }
  setQuality(quality)
  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(container)
  // Reserve the actual HUD height: wrapping and safe-area insets vary by device.
  const scoreboard = container.closest('.game')?.querySelector<HTMLElement>('#scoreboard')
  const scoreObserver = new ResizeObserver(() => {
    if (scoreboard && !disposed) container.style.bottom = `${scoreboard.offsetHeight}px`
  })
  if (scoreboard) scoreObserver.observe(scoreboard)

  // The graphics quality trades resolution for frame rate on weaker devices.
  const canvas = renderer.domElement
  const onContextLost = (event: Event) => {
    event.preventDefault()
    contextLost = true
  }
  const onContextRestored = () => {
    contextLost = false
    setQuality(quality)
  }
  canvas.addEventListener('webglcontextlost', onContextLost)
  canvas.addEventListener('webglcontextrestored', onContextRestored)

  function moveFielder(rig: Rig, x: number, z: number, pace: number, delivery: Delivery | undefined, active: boolean, closeStance = 0) {
    const actor = movingActors.get(rig)!
    const clock = (delivery?.tick ?? 0) * DT
    const movement = samplePlayerMotion(actor.locomotion, x, z, clock, resetActorMotion || !delivery)
    rig.base.position.set(x, 0, z)
    const receiving = active && delivery && ((delivery.action === 'pickup' || delivery.action === 'hold') || delivery.action === 'return')
    const action = sampleFieldingMotion(actor.fielding, receiving ? delivery.action : 'idle', clock, resetActorMotion || !delivery)
    if (movement.amount > .025 && !receiving) runPose(rig, clock, movement.amount, movement)
    else neutralPose(rig, time + x * .14, receiving ? action.crouch : closeStance)
    if (movement.speed > .2 && !receiving) rig.base.rotation.y = movement.yaw
    else if (active && delivery) aimActor(rig, delivery.ball.x, delivery.ball.z)
    else aimActor(rig, 0, 0)
    if (receiving) {
      if (delivery.action === 'return' || delivery.action === 'hold') aimActor(rig, 0, delivery.throwTarget === 'bowler' ? PITCH_LENGTH : KEEPER.z)
      rig.shoulders.rotation.x = action.bend
      rig.shoulders.rotation.y = action.twist
      rig.head.rotation.x = -action.bend * .55
      rig.arms[1].shoulder.rotation.x = action.throwArm
      rig.arms[0].shoulder.rotation.x = action.guideArm
      rig.arms[1].elbow.rotation.x = -.48
      rig.arms[0].elbow.rotation.x = -.23
    }
  }

  function render(frame: StadiumFrame, dt: number) {
    if (disposed || contextLost) return
    const reducedMotion = frame.reducedMotion ?? motionPreference
    dt = Math.min(Math.max(dt, 0), .1)
    time += dt
    lighting.skyTime.value = reducedMotion ? 0 : time
    pennants.forEach((flag, i) => {
      flag.rotation.y = .64 + (reducedMotion ? 0 : Math.sin(time * (2.1 + wind) + i * 1.9) * (.18 + wind * .065))
      flag.rotation.x = reducedMotion ? 0 : Math.sin(time * 4.3 + i) * wind * .045
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
    resetActorMotion = delivery !== actorDelivery
    actorDelivery = delivery
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
    if (delivery?.pitchPoint && pitchImpact !== delivery) {
      pitchImpact = delivery
      if (!reducedMotion) dust.emit(delivery.pitchPoint, GRAPHICS_QUALITY[quality].particles)
    }
    dust.update(dt, !reducedMotion && quality !== 'low')
    const visualTick = (delivery?.tick ?? 0) + (boundaryFlight?.tick ?? 0)
    const newMode = frame.mode !== mode
    if (newMode) {
      // The match controller has just exposed the canvas and score strip.
      // Resolve that layout now rather than showing one stale observer-sized frame.
      if (scoreboard) container.style.bottom = `${scoreboard.offsetHeight}px`
      resize()
    }
    deadTime = phase === 'dead' ? deadTime + dt : 0
    crowdMotion.time.value = reducedMotion ? 0 : time
    crowdMotion.energy.value = reducedMotion ? 0 : phase === 'dead' && frame.signal ? Math.max(0, 1 - deadTime / 4) : isHome ? .22 : .04
    if (!reducedMotion && delivery && celebration !== delivery && frame.signal === 'six' && phase === 'dead') {
      celebration = delivery
      confettiAge = 0
    }
    confettiAge += dt
    confetti.visible = !reducedMotion && quality !== 'low' && confettiAge < 3.8
    if (confetti.visible) {
      for (let i = 0; i < 96; i++) {
        const t = confettiAge
        const offset = i * 3
        confettiPositions[offset] = (noise(i + 19) - .5) * (4 + t * 4)
        confettiPositions[offset + 1] = 2 + noise(i + 61) * 3 + t * 2 - t * t * .8
        confettiPositions[offset + 2] = .5 + (noise(i + 113) - .5) * (4 + t * 3)
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

    updateAthleteIdentity(striker, frame.strikerProfile)
    updateAthleteIdentity(nonStriker, frame.nonStrikerProfile)
    updateAthleteIdentity(bowler, frame.bowlerProfile)
    const batterHand = delivery?.bowling?.batterHand ?? frame.strikerProfile?.batting.hand ?? 'right'
    presentedBatterHand = batterHand
    const battingSide = batterHand === 'left' ? -1 : 1
    const partnerHand = frame.nonStrikerProfile?.batting.hand ?? 'right'
    const running = delivery?.runnerProgress ?? 0
    const reverse = ((delivery?.completedRuns ?? 0) % 2) !== 0
    const progress = reverse ? 1 - running : running
    const strideLength = PITCH_LENGTH - 2.44
    const runnerPositions = delivery?.runnerPositions
    striker.base.position.set(.57 * battingSide, 0, runnerPositions ? strikerRootZ(runnerPositions[0], running, delivery?.completedRuns ?? 0) : .08 + progress * strideLength)
    nonStriker.base.position.set(-.84 * battingSide, 0, runnerPositions?.[1] ?? PITCH_LENGTH - 1.22 - progress * strideLength)
    const runnerClock = (delivery?.tick ?? 0) * DT
    const strikerGait = samplePlayerMotion(strikerMotion, .57 * battingSide, runnerPositions?.[0] ?? 1.22, runnerClock, resetActorMotion || !delivery)
    const partnerGait = samplePlayerMotion(partnerMotion, -.84 * battingSide, runnerPositions?.[1] ?? PITCH_LENGTH - 1.22, runnerClock, resetActorMotion || !delivery)
    const swing = delivery?.swingTick == null ? frame.practiceSwing?.age : (delivery.tick - delivery.swingTick) * DT
    const awayFromGuard = running > 0 || (delivery?.partnerProgress ?? 0) > 0 || (delivery?.completedRuns ?? 0) > 0
    if (awayFromGuard) {
      // Each grounded batter settles independently while the partner finishes.
      // Shared running intent must never substitute for individual movement.
      if (strikerGait.amount > .025 && phase !== 'dead') runPose(striker, runnerClock, strikerGait.amount, strikerGait)
      else neutralPose(striker, time, .015)
      if (partnerGait.amount > .025 && phase !== 'dead') runPose(nonStriker, runnerClock, partnerGait.amount, partnerGait)
      else neutralPose(nonStriker, time, .015)
      striker.base.rotation.y = strikerGait.yaw
      nonStriker.base.rotation.y = partnerGait.yaw
    } else {
      batterPose(striker, time, swing, frame.practiceSwing?.shot ?? frame.shot, frame.shotAngle, delivery?.batImpact ?? delivery?.projectedContact, delivery ? smooth((delivery.tick - delivery.contactTick + 26) / 23) : 0, batterHand)
      neutralPose(nonStriker, time, .025)
      nonStriker.base.rotation.y = partnerHand === 'left' ? -2.75 : 2.75
      nonStriker.arms[1].shoulder.rotation.x = -.67
      if (nonStriker.bat) nonStriker.bat.rotation.set(.73, 0, -.31)
    }
    if (phase === 'dead' && (frame.signal === 'six' || frame.signal === 'four') && deadTime > .8) {
      neutralPose(striker, time)
      striker.arms[1].shoulder.rotation.x = -2.45
      striker.arms[1].elbow.rotation.x = -.25
      striker.shoulders.rotation.y = Math.sin(time) * .15
    }

    if (awayFromGuard || (phase === 'dead' && deadTime > .8)) gripBat(striker, batterHand)
    gripBat(nonStriker, partnerHand)
    const entrance = frame.entranceAge !== undefined && phase === 'ready' && frame.entranceAge < 1.35
    const partnerEntrance = frame.entranceEnd === 'nonStriker'
    const entrant = partnerEntrance ? nonStriker : striker
    const entranceSide = partnerEntrance ? -battingSide : battingSide
    const entranceGuardX = (partnerEntrance ? -.84 : .57) * battingSide
    const entranceGuardZ = partnerEntrance ? PITCH_LENGTH - 1.22 : .08
    if (entrance) {
      const arrival = smooth(frame.entranceAge! / 1.35)
      entrant.base.position.x += entranceSide * (1 - arrival) * 4.1
      entrant.base.position.z += (partnerEntrance ? 1 : -1) * (1 - arrival) * 1.4
      if (arrival < .985) {
        runPose(entrant, frame.entranceAge!, .24 * (1 - arrival))
        entrant.base.rotation.y = Math.atan2(-entranceSide * 4.1, partnerEntrance ? -1.4 : 1.4)
        gripBat(entrant, partnerEntrance ? partnerHand : batterHand)
      }
    }
    const bowlerPhase = phase
    const bowlingKind = frame.bowlingKind ?? frame.delivery?.kind
    const spin = bowlingKind !== undefined && isSpinDelivery(bowlingKind)
    const preparingNext = !frame.replay && (phase === 'ready' || phase === 'dead')
    const execution = preparingNext ? frame.bowlingExecution ?? delivery?.bowling : delivery?.bowling ?? frame.bowlingExecution
    const appearance: BowlingAppearance = execution ?? frame.bowlerProfile?.bowling ?? { arm: 'right', type: spin ? 'off-spin' : 'fast', action: spin ? 'finger-spin' : 'high-arm' }
    const releasePoint = preparingNext
      ? frame.bowlingRelease ?? (execution ? bowlingReleasePoint(execution) : frame.delivery?.release.position)
      : delivery?.release.position ?? frame.bowlingRelease ?? (execution ? bowlingReleasePoint(execution) : frame.delivery?.release.position)
    presentedBowlerArm = appearance.arm
    presentedRelease = releasePoint
    bowlingPose(bowler, time, bowlerPhase, frame.windup ?? 0, phase === 'dead' ? deadTime : (delivery?.tick ?? 0) * DT, appearance, releasePoint)
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
    if (frame.fieldPreset !== cachedPreset || frame.maxOutside !== cachedOutside || frame.fieldLayout !== cachedLayout) {
      cachedPreset = frame.fieldPreset
      cachedOutside = frame.maxOutside
      cachedLayout = frame.fieldLayout
      presetPositions = fieldPositions(cachedPreset, cachedOutside, cachedLayout)
    }
    fielders.forEach((rig, index) => {
      const spot = (phase === 'ready' || phase === 'dead') && isBowling && !frame.replay ? presetPositions[index] : delivery?.fielders[index] ?? presetPositions[index]
      moveFielder(rig, spot.x, spot.z, dt, delivery, delivery?.activeFielder === index, .035)
      if (delivery?.outcome?.reason === 'caught' && delivery.activeFielder === index) receivePose(rig, delivery, time)
    })
    umpirePose(umpire, time, phase === 'dead' ? frame.signal : undefined)
    neutralPose(squareUmpire, time + .5)
    aimActor(squareUmpire, 0, 0)

    const broken = delivery?.wicketBroken || delivery?.outcome?.reason === 'bowled' || delivery?.outcome?.reason === 'run-out'
    if (delivery !== wicketDelivery) { wicketDelivery = delivery; wicketAge = 0 }
    if (broken) wicketAge += dt
    bails.forEach((pair, end) => pair.forEach((bail, index) => {
      const brokenHere = broken && end === (delivery?.throwTarget === 'bowler' && delivery.wicketBroken ? 1 : 0)
      const t = Math.min(reducedMotion ? 1 : wicketAge, 1)
      bail.position.y = brokenHere ? Math.max(.035, .712 + t * 1.8 - t * t * 4.9) : .712
      bail.position.z = brokenHere ? (.55 + .27 * index) * Math.min(t, .61) : 0
      bail.rotation.y = brokenHere ? t * (index === 0 ? 5 : -4) : 0
      bail.rotation.x = brokenHere ? t * 6 : 0
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
        for (let i = 0; i < 24; i++) {
          trailPositions[i * 3] = x
          trailPositions[i * 3 + 1] = y
          trailPositions[i * 3 + 2] = z
        }
      }
      if (trailTick !== visualTick) {
        trailPositions.copyWithin(3, 0, trailPositions.length - 3)
        trailPositions[0] = x
        trailPositions[1] = y
        trailPositions[2] = z
        trailTick = visualTick
        trailGeometry.attributes.position.needsUpdate = true
      }
    } else if (held) {
      bowler.base.updateWorldMatrix(true, true)
      ballModel.position.copy(bowler.arms[appearance.arm === 'left' ? 1 : 0].hand.getWorldPosition(heldBall))
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
      const armSide = appearance.arm === 'left' ? -1 : 1
      const sequence = reducedMotion ? 0 : phase === 'windup' ? smooth((frame.windup ?? 0) / .82) : phase === 'flight' ? 1 : 0
      cameraPosition.set(-armSide * THREE.MathUtils.lerp(2.6, 1.55, sequence) * lateral, THREE.MathUtils.lerp(3.25, 3.1, sequence), PITCH_LENGTH + THREE.MathUtils.lerp(12.1, 8.6, sequence))
      cameraTarget.set(releasePoint?.x ?? .14, 1.08, 8.1)
    } else {
      // Keep the user's straight, behind-the-pitch view at every screen width.
      cameraPosition.set(.4 * battingSide, 2.8, -6.2)
      cameraTarget.set(.4 * battingSide, 1.05, 9.5)
    }
    if (entrance && !reducedMotion && !isHome) {
      const reveal = 1 - smooth((frame.entranceAge! - .65) / .70)
      cameraPosition.lerp(new THREE.Vector3(entranceGuardX + 3.2 * entranceSide, 1.95, entranceGuardZ + (partnerEntrance ? 3.9 : -3.9)), reveal)
      cameraTarget.lerp(new THREE.Vector3(entranceGuardX, .90, entranceGuardZ), reveal)
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
    if (!reducedMotion && !isHome && !isBowling && phase === 'dead' && frame.signal && !boundaryFlight?.presenting) {
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
    setQuality,
    /** Release observers, cached venues, textures, buffers, and WebGL programs. */
    dispose() {
      if (disposed) return
      disposed = true
      resizeObserver.disconnect()
      scoreObserver.disconnect()
      canvas.removeEventListener('webglcontextlost', onContextLost)
      canvas.removeEventListener('webglcontextrestored', onContextRestored)
      const geometries = new Set<THREE.BufferGeometry>()
      const surfaces = new Set<THREE.Material>()
      const textures = new Set<THREE.Texture>()
      const visited = new Set<THREE.Object3D>()
      for (const root of [scene, ...stands.values()]) root.traverse((object) => {
        if (visited.has(object)) return
        visited.add(object)
        if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points)) return
        geometries.add(object.geometry)
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        for (const surface of materials) surfaces.add(surface)
        if (object instanceof THREE.InstancedMesh) object.dispose()
      })
      qualityMaterials.collect(surfaces)
      for (const surface of surfaces) {
        for (const value of Object.values(surface)) if (value instanceof THREE.Texture) textures.add(value)
        surface.dispose()
      }
      textures.forEach((texture) => texture.dispose())
      geometries.forEach((geometry) => geometry.dispose())
      lighting.sun.shadow.dispose()
      stands.clear()
      qualityMaterials.clear()
      scene.clear()
      renderer.dispose()
      // Three retains a 1x1 fallback shadow sampler outside scene resources.
      // Release the discarded canvas context too, including engine-owned caches.
      if (renderer.getContext().getExtension('WEBGL_lose_context')) renderer.forceContextLoss()
      canvas.remove()
    },
    boundaryPlaying: () => boundaryFlight?.presenting ?? false,
    info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      quality, shadows: renderer.shadowMap.enabled, shadowSize: lighting.sun.castShadow ? lighting.sun.shadow.mapSize.x : 0,
      materialMode: GRAPHICS_QUALITY[quality].material, materialVariants: qualityMaterials.count,
      skyDetail: lighting.skyDetail.value > .5,
      pixelRatio: renderer.getPixelRatio(), width: canvas.width, height: canvas.height,
      geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
      programs: renderer.info.programs?.length ?? 0, contextLost, disposed,
      actors: {
        batter: { id: striker.base.userData.playerId ?? null, hand: presentedBatterHand },
        bowler: { id: bowler.base.userData.playerId ?? null, arm: presentedBowlerArm, stage: bowler.base.userData.bowlingStage,
          hand: bowler.arms[presentedBowlerArm === 'left' ? 1 : 0].hand.getWorldPosition(new THREE.Vector3()).toArray(), release: presentedRelease ? { ...presentedRelease } : null },
        jerseyTextures: [striker, nonStriker, bowler].filter(rig => Boolean(rig.identity.texture)).length,
      },
      contextReleased: disposed && renderer.getContext().isContextLost(),
      boundary: boundaryFlight ? { ball: { ...boundaryFlight.ball }, tick: boundaryFlight.tick, landed: boundaryFlight.landedAt !== null, settled: boundaryFlight.settled } : null }),
  }
}
