import * as THREE from 'three'
import { ROSTER } from './match-data.ts'

export function createDressingRoom(container: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' })
  renderer.setPixelRatio(1)
  renderer.setSize(560, 155, false)
  renderer.domElement.style.cssText = 'width:100%;height:155px;display:block;touch-action:pan-y'
  renderer.domElement.setAttribute('aria-label', 'Suncrest dressing room with eleven hanging jerseys and four reserve seats')
  container.append(renderer.domElement)
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#18342f')
  const camera = new THREE.OrthographicCamera(-6.5, 6.5, 1.8, -1.8, 0.1, 40)
  camera.position.set(0, 3, 10)
  camera.lookAt(0, 1.45, 0)
  scene.add(new THREE.HemisphereLight('#edf9ef', '#34423d', 2.6))
  const light = new THREE.DirectionalLight('#fff1bf', 2)
  light.position.set(2, 6, 5)
  scene.add(light)
  const teal = new THREE.MeshStandardMaterial({ color: '#168f88', roughness: 0.9 })
  const trim = new THREE.MeshStandardMaterial({ color: '#f1ce70', roughness: 0.7 })
  const wood = new THREE.MeshStandardMaterial({ color: '#a47950', roughness: 0.9 })
  const dark = new THREE.MeshStandardMaterial({ color: '#0c2323' })
  const back = new THREE.MeshStandardMaterial({ color: '#55756b' })
  const geometry = new THREE.BoxGeometry()
  function box(parent: THREE.Object3D, material: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number) {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(x, y, z)
    mesh.scale.set(w, h, d)
    parent.add(mesh)
    return mesh
  }
  box(scene, wood, 0, -0.12, 0, 13, 0.2, 5)
  box(scene, back, 0, 1.7, -1.3, 13, 3.5, 0.2)
  const jerseys = new THREE.Group()
  scene.add(jerseys)
  const cardTextures: THREE.CanvasTexture[] = []
  const cards: THREE.MeshBasicMaterial[] = []
  function jersey(parent: THREE.Object3D, x: number, y: number, scale: number) {
    const kit = new THREE.Group()
    kit.position.set(x, y, 0)
    kit.scale.setScalar(scale)
    box(kit, teal, 0, 0, 0, .5, .65, .16)
    box(kit, teal, -.35, .16, 0, .24, .25, .16).rotation.z = .55
    box(kit, teal, .35, .16, 0, .24, .25, .16).rotation.z = -.55
    box(kit, trim, 0, .28, .09, .2, .065, .025)
    parent.add(kit)
    return kit
  }
  for (let i = 0; i < 11; i++) {
    const x = (i - 5) * .95
    box(scene, wood, x, 1.95, -.7, .88, 2.9, .25)
    box(scene, trim, x, 2.68, -.36, .08, .14, .15)
    jersey(jerseys, x, 2.18, .72).position.z = -.2
    box(scene, dark, x, .6, -.1, .82, .15, .7)
  }
  const avatar = jersey(scene, 0, .9, 1.35)
  avatar.position.z = 1.2
  box(avatar, dark, -.14, -.7, 0, .19, .8, .19)
  box(avatar, dark, .14, -.7, 0, .19, .8, .19)
  const head = new THREE.Mesh(new THREE.SphereGeometry(.18, 12, 8), new THREE.MeshStandardMaterial({ color: '#bc895d' }))
  head.position.y = .58
  avatar.add(head)
  for (let i = 0; i < 4; i++) {
    const x = (i < 2 ? -1 : 1) * (2.6 + i % 2)
    box(scene, wood, x, .22, 1.5, .75, .25, .65)
    const reserve = jersey(scene, x, .65, .55)
    reserve.position.z = 1.5
    const reserveHead = head.clone()
    reserve.add(reserveHead)
    box(reserve, dark, -.14, -.48, .12, .19, .4, .22)
    box(reserve, dark, .14, -.48, .12, .19, .4, .22)
  }

  function render(names: string[]) {
    for (const texture of cardTextures) texture.dispose()
    for (const material of cards) material.dispose()
    cardTextures.length = cards.length = 0
    for (const child of [...scene.children]) if (child.userData.nameplate) {
      if (child instanceof THREE.Mesh) child.geometry.dispose()
      scene.remove(child)
    }
    names.forEach((name, i) => {
      const canvas = document.createElement('canvas')
      canvas.width = 160
      canvas.height = 40
      const context = canvas.getContext('2d')!
      context.fillStyle = '#102822'
      context.fillRect(0, 0, 160, 40)
      context.fillStyle = '#f0f8dc'
      context.font = 'bold 20px sans-serif'
      context.textAlign = 'center'
      context.fillText(name.toUpperCase(), 80, 27)
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      cardTextures.push(texture)
      const material = new THREE.MeshBasicMaterial({ map: texture })
      cards.push(material)
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(.83, .21), material)
      plate.position.set((i - 5) * .95, 1.35, .05)
      plate.userData.nameplate = true
      scene.add(plate)
    })
    avatar.rotation.y = -.3
    renderer.render(scene, camera)
    container.setAttribute('aria-label', `${names.length} selected players and ${ROSTER.length - names.length} reserves`)
  }
  return { render }
}
