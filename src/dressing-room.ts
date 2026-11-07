import * as THREE from 'three'
import { ROSTER } from './match-data.ts'

export function createDressingRoom(container: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
  renderer.setSize(1040, 240, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.12
  renderer.domElement.style.cssText = 'width:100%;height:auto;display:block;touch-action:pan-y'
  renderer.domElement.setAttribute('aria-label', 'Suncrest dressing room with eleven hanging jerseys and four reserve seats')
  container.append(renderer.domElement)
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#062e26')
  const camera = new THREE.OrthographicCamera(-6.5, 6.5, 1.5, -1.5, 0.1, 40)
  camera.position.set(0, 3, 10)
  camera.lookAt(0, 1.65, 0)
  scene.add(new THREE.HemisphereLight('#edf9e2', '#18352a', 2.2))
  const light = new THREE.DirectionalLight('#fff3d0', 2.8)
  light.position.set(2, 6, 5)
  scene.add(light)
  const teal = new THREE.MeshStandardMaterial({ color: '#2d985d', roughness: 0.9 })
  const trim = new THREE.MeshStandardMaterial({ color: '#cefa69', roughness: 0.7 })
  const wood = new THREE.MeshStandardMaterial({ color: '#a87e4f', roughness: 0.9 })
  const dark = new THREE.MeshStandardMaterial({ color: '#07271e' })
  const back = new THREE.MeshStandardMaterial({ color: '#123e2d' })
  const locker = new THREE.MeshStandardMaterial({ color: '#27533b', roughness: 0.9 })
  const kitWhite = new THREE.MeshStandardMaterial({ color: '#f4f2dc', roughness: 0.85 })
  const stripLight = new THREE.MeshBasicMaterial({ color: '#edf6bd' })
  const geometry = new THREE.BoxGeometry()
  function box(parent: THREE.Object3D, material: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number) {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(x, y, z)
    mesh.scale.set(w, h, d)
    parent.add(mesh)
    return mesh
  }
  box(scene, dark, 0, -0.12, 0, 13, 0.2, 5)
  box(scene, back, 0, 1.7, -1.3, 13, 3.5, 0.2)
  box(scene, wood, 0, .08, -.1, 12, .1, 1.8)
  box(scene, stripLight, 0, 3.21, -1.08, 11.6, .05, .05)
  box(scene, trim, 0, .03, 1.2, 11.6, .02, .025)
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
    box(kit, trim, -.41, .11, .015, .065, .2, .17).rotation.z = .55
    box(kit, trim, .41, .11, .015, .065, .2, .17).rotation.z = -.55
    box(kit, kitWhite, -.1, .1, .09, .065, .08, .015)
    parent.add(kit)
    return kit
  }
  for (let i = 0; i < 11; i++) {
    const x = (i - 5) * .95
    box(scene, locker, x, 1.83, -.7, .88, 2.55, .25)
    box(scene, wood, x - .44, 1.83, -.53, .035, 2.55, .25)
    box(scene, wood, x + .44, 1.83, -.53, .035, 2.55, .25)
    box(scene, stripLight, x, 2.98, -.44, .72, .03, .03)
    box(scene, trim, x, 2.68, -.36, .08, .14, .15)
    jersey(jerseys, x, 2.18, .72).position.z = -.2
    box(scene, wood, x, .6, -.1, .82, .15, .7)
    box(scene, kitWhite, x - .18, .87, -.25, .12, .28, .16)
    box(scene, kitWhite, x + .02, .87, -.25, .12, .28, .16)
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
    jerseys.children.forEach((jersey, index) => { jersey.visible = index < names.length })
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
      context.fillStyle = '#0c3023'
      context.fillRect(0, 0, 160, 40)
      context.fillStyle = '#dcecbd'
      context.font = '600 18px sans-serif'
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
