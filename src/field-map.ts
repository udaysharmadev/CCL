import { PITCH_LENGTH, type BoundaryDimensions, type Vec3 } from './cricket.ts'

/** Same orientation as the batting camera: off side left, bowler at the top. */
export function createFieldMap(id: string, numbered = false) {
  const svg = document.querySelector<SVGSVGElement>(`#${id}`)!
  svg.innerHTML = `<circle cx="80" cy="80" r="73" fill="#133e38" stroke="#bcd3af" stroke-width="1.5"/>
    <circle cx="80" cy="80" r="34" fill="none" stroke="#bcd3af" stroke-opacity=".3" stroke-dasharray="2 3"/>
    <path d="M80 8V152M8 80H152" stroke="#ffffff" stroke-opacity=".06"/>
    <rect x="77" y="68" width="6" height="24" rx="1" fill="#c6b28c"/>
    <text x="80" y="20" text-anchor="middle" fill="#c1d7ca" font-size="5">BOWLER'S END</text>
    ${Array.from({ length: 9 }, (_, i) => `<g data-fielder="${i}"><circle r="${numbered ? 6 : 3.3}" fill="#f2c86d" stroke="#152b35"/>${numbered ? `<text text-anchor="middle" y="2" font-size="6" fill="#142236" pointer-events="none">${i + 1}</text>` : ''}</g>`).join('')}
    <circle data-keeper r="3" fill="#80ddcb"/><circle data-bowler r="3" fill="#80ddcb"/>
    <circle data-ball r="2.8" fill="white" stroke="#e88465"/>`
  const fielders = [...svg.querySelectorAll<SVGGElement>('[data-fielder]')]
  const keeperDot = svg.querySelector<SVGCircleElement>('[data-keeper]')!
  const bowlerDot = svg.querySelector<SVGCircleElement>('[data-bowler]')!
  const ballDot = svg.querySelector<SVGCircleElement>('[data-ball]')!
  function point(p: Vec3, boundary: BoundaryDimensions) {
    return [80 - p.x / boundary.x * 70, 80 - (p.z - PITCH_LENGTH / 2) / boundary.z * 70]
  }
  return {
    svg,
    render(positions: readonly Vec3[], keeper: Vec3, ball: Vec3 | undefined, boundary: BoundaryDimensions, active = -1) {
      positions.forEach((p, i) => {
        const [x, y] = point(p, boundary)
        fielders[i].setAttribute('transform', `translate(${x} ${y})`)
        fielders[i].querySelector('circle')!.setAttribute('fill', i === active ? '#ffffff' : '#f2c86d')
      })
      if (active >= 0 && active < fielders.length && svg.lastElementChild !== fielders[active]) svg.append(fielders[active])
      for (const [dot, p] of [[keeperDot, keeper], [bowlerDot, { x: .3, y: 0, z: PITCH_LENGTH }], [ballDot, ball]] as const) {
        dot.style.display = p ? '' : 'none'
        if (p) { const [x, y] = point(p, boundary); dot.setAttribute('cx', String(x)); dot.setAttribute('cy', String(y)) }
      }
    },
    destination(event: MouseEvent, boundary: BoundaryDimensions): Vec3 {
      const rect = svg.getBoundingClientRect()
      return { x: (80 - (event.clientX - rect.left) / rect.width * 160) / 70 * boundary.x,
        y: 0, z: (80 - (event.clientY - rect.top) / rect.height * 160) / 70 * boundary.z + PITCH_LENGTH / 2 }
    },
  }
}
