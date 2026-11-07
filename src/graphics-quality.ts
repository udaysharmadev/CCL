/** Presentation budgets only. These values never change simulation tick rate. */
export const GRAPHICS_QUALITY = {
  low: { pixelRatio: .75, maxWidth: 1280, shadowSize: 0, crowdDensity: .45, particles: 0, material: 'diffuse', skyDetail: false },
  medium: { pixelRatio: 1, maxWidth: 1600, shadowSize: 1024, crowdDensity: .72, particles: 32, material: 'pbr', skyDetail: true },
  high: { pixelRatio: 1.45, maxWidth: 1920, shadowSize: 2048, crowdDensity: 1, particles: 64, material: 'pbr', skyDetail: true },
} as const

export type GraphicsQuality = keyof typeof GRAPHICS_QUALITY

/** Bound both DPR and the backing buffer on ultrawide/high-density displays. */
export function renderPixelRatio(quality: GraphicsQuality, width: number, deviceRatio: number) {
  const budget = GRAPHICS_QUALITY[quality]
  return Math.min(Math.max(.1, deviceRatio || 1), budget.pixelRatio, budget.maxWidth / Math.max(1, width))
}
