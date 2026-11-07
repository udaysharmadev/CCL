import * as THREE from 'three'

/** Cache cheap diffuse variants without changing the source PBR materials. */
export class QualityMaterials {
  private readonly originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()
  private readonly variants = new Map<THREE.MeshStandardMaterial, THREE.MeshLambertMaterial>()

  private lowMaterial(source: THREE.Material) {
    if (!(source instanceof THREE.MeshStandardMaterial)) return source
    let variant = this.variants.get(source)
    if (variant) return variant
    variant = new THREE.MeshLambertMaterial({
      map: source.map, alphaMap: source.alphaMap, emissiveMap: source.emissiveMap,
      emissiveIntensity: source.emissiveIntensity, vertexColors: source.vertexColors,
      transparent: source.transparent, opacity: source.opacity, alphaTest: source.alphaTest,
      side: source.side, shadowSide: source.shadowSide, depthTest: source.depthTest,
      depthWrite: source.depthWrite, colorWrite: source.colorWrite, fog: source.fog,
      flatShading: source.flatShading, wireframe: source.wireframe,
      polygonOffset: source.polygonOffset, polygonOffsetFactor: source.polygonOffsetFactor,
      polygonOffsetUnits: source.polygonOffsetUnits, toneMapped: source.toneMapped,
    })
    // Match/venue changes update source colors in place; both tiers see them.
    variant.color = source.color
    variant.emissive = source.emissive
    // Crowd motion lives in a vertex shader hook. It must survive a tier switch.
    variant.onBeforeCompile = source.onBeforeCompile
    variant.customProgramCacheKey = source.customProgramCacheKey
    this.variants.set(source, variant)
    return variant
  }

  apply(root: THREE.Object3D, low: boolean) {
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      const original: THREE.Material | THREE.Material[] = this.originals.get(object) ?? object.material
      if (!this.originals.has(object)) this.originals.set(object, original)
      object.material = low
        ? Array.isArray(original) ? original.map((surface) => this.lowMaterial(surface)) : this.lowMaterial(original)
        : original
    })
  }

  /** Include inactive variants and originals when the stadium releases resources. */
  collect(surfaces: Set<THREE.Material>) {
    for (const original of this.originals.values()) {
      if (Array.isArray(original)) original.forEach((surface) => surfaces.add(surface))
      else surfaces.add(original)
    }
    for (const variant of this.variants.values()) surfaces.add(variant)
  }

  get count() { return this.variants.size }

  clear() {
    this.originals.clear()
    this.variants.clear()
  }
}
