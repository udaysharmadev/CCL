import { availableVariations, type BowlingControls, type BowlingVariation } from './bowling.ts'
import { bowlingLabel, isSpinBowler, type PlayerProfile } from './player-profile.ts'
import { formatOvers, type Innings } from './rules.ts'

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))
function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const el = document.createElement(tag); el.className = className; el.textContent = text; return el
}

/** Presentation-only input capture. Only the accepted numeric controls enter a delivery. */
export function createBowlingHud(parent: HTMLElement, execute: () => void, changeBowler: () => void, changed: () => void) {
  const root = node('section', 'bowling-studio'); root.id = 'bowling-studio'; root.hidden = true
  root.setAttribute('aria-label', 'Bowling preparation')
  const identity = node('header', 'bowling-identity'), avatar = node('span', 'bowling-avatar')
  const copy = node('div'), name = node('strong'), style = node('small'), figures = node('span', 'bowling-figures')
  copy.append(name, style); identity.append(avatar, copy, figures)
  const change = node('button', 'bowler-change', 'Change bowler'); change.type = 'button'; change.addEventListener('click', changeBowler)
  identity.append(change)
  const stages = node('div', 'bowling-stages', '01 PREPARE   /   02 TARGET   /   03 EXECUTE')
  const body = node('div', 'bowling-body'), left = node('div', 'bowling-plan'), right = node('div', 'bowling-target')
  const variations = node('div', 'bowling-variations'); variations.setAttribute('aria-label', 'Available deliveries')
  const description = node('p', 'variation-description')
  const sides = node('div', 'bowling-sides'); sides.setAttribute('aria-label', 'Bowling side')
  const sideButtons = (['over', 'around'] as const).map(side => {
    const b = node('button', '', `${side === 'over' ? 'Over' : 'Around'} the wicket`); b.type = 'button'
    b.addEventListener('click', () => { controls.side = side; update(); changed() }); sides.append(b); return b
  })
  function slider(label: string, key: 'power' | 'movement') {
    const wrap = node('label', 'bowling-slider'), caption = node('span', '', label), output = node('output')
    const input = node('input'); input.type = 'range'; input.min = '0'; input.max = '1'; input.step = '.01'
    input.id = `bowling-${key}`; input.setAttribute('aria-label', label)
    input.addEventListener('input', () => { controls[key] = Number(input.value); update(); changed() })
    caption.append(output); wrap.append(caption, input); return { wrap, caption, output, input }
  }
  const power = slider('Pace effort', 'power'), movement = slider('Swing / seam', 'movement')
  left.append(variations, description, sides, power.wrap, movement.wrap)
  const targetLabel = node('div', 'pitch-target-caption', 'PITCH TARGET'), targetText = node('strong', 'pitch-target-value')
  const pitch = node('div', 'pitch-target-map'); pitch.id = 'pitch-target-map'; pitch.tabIndex = 0
  pitch.setAttribute('role', 'group'); pitch.setAttribute('aria-label', 'Pitch target. Drag to aim; arrow keys adjust line and length.')
  for (const [label, pct] of [['BOUNCER', 9], ['SHORT', 29], ['GOOD', 52], ['FULL', 76], ['YORKER', 94]] as const) {
    const zone = node('span', 'pitch-zone', label); zone.style.top = `${pct}%`; pitch.append(zone)
  }
  const stumps = node('span', 'pitch-stumps', 'III'), marker = node('i', 'pitch-marker'), actual = node('i', 'pitch-actual')
  actual.hidden = true; pitch.append(stumps, marker, actual)
  const lineLegend = node('div', 'pitch-line-legend', 'LEG     MIDDLE     OFF')
  const hint = node('small', 'pitch-hint', 'Drag target · arrow keys fine tune')
  right.append(targetLabel, targetText, pitch, lineLegend, hint)
  const foot = node('footer', 'bowling-execution'), status = node('div', 'bowling-execution-status')
  status.setAttribute('role', 'status')
  const meter = node('div', 'release-meter'); meter.id = 'release-meter'; meter.hidden = true
  meter.setAttribute('aria-label', 'Release timing. Stop in the gold center.')
  const needle = node('i'); meter.append(needle)
  const button = node('button', 'primary', 'Set release'); button.id = 'bowl-execute'; button.type = 'button'; button.addEventListener('click', execute)
  foot.append(status, meter, button); body.append(left, right); root.append(identity, stages, body, foot); parent.append(root)
  let profile: PlayerProfile | undefined, innings: Innings | undefined, locked = false, canChange = true, timing = false, age = 0
  let controls: BowlingControls = { variation: 'stock', line: .18, length: 6.2, power: .76, release: .7, movement: .65, side: 'over', batterHand: 'right' }
  let feedback = '', signature = ''
  function targetAt(event: PointerEvent) {
    if (locked || timing) return
    const rect = pitch.getBoundingClientRect()
    controls.line = Math.round(clamp((event.clientX - rect.left) / rect.width * 2.8 - 1.4, -1.4, 1.4) * 100) / 100
    controls.length = Math.round(clamp(12.5 - (event.clientY - rect.top) / rect.height * 11.9, .6, 12.5) * 100) / 100
    update(); changed()
  }
  pitch.addEventListener('pointerdown', event => { if (event.isPrimary && !locked && !timing) { pitch.setPointerCapture(event.pointerId); targetAt(event) } })
  pitch.addEventListener('pointermove', event => { if (pitch.hasPointerCapture(event.pointerId)) targetAt(event) })
  pitch.addEventListener('keydown', event => {
    if (locked || timing || !event.key.startsWith('Arrow')) return
    event.preventDefault()
    controls.line = clamp(controls.line + (event.key === 'ArrowRight' ? .05 : event.key === 'ArrowLeft' ? -.05 : 0), -1.4, 1.4)
    controls.length = clamp(controls.length + (event.key === 'ArrowUp' ? .2 : event.key === 'ArrowDown' ? -.2 : 0), .6, 12.5)
    update(); changed()
  })
  function update() {
    if (!profile) return
    const spin = isSpinBowler(profile), b = profile.bowling
    const stats = innings?.bowling.find(item => item.playerId === profile!.id || !item.playerId && item.name === profile!.identity.displayName)
    const workload = stats?.balls ?? 0
    const stamina = Math.round(Math.max(.42, 1 - workload / (78 + b.stamina * 1.8)) * 100)
    avatar.textContent = String(profile.identity.jerseyNumber).padStart(2, '0')
    name.textContent = profile.identity.displayName
    style.textContent = `${bowlingLabel(profile)} · ${profile.bowling.action.replaceAll('-', ' ')}`
    figures.textContent = `${stats?.wickets ?? 0}/${stats?.runs ?? 0} · ${formatOvers(workload)} ov · ${stamina}% stamina`
    root.dataset.family = spin ? 'spin' : 'pace'; root.dataset.executing = String(timing)
    change.disabled = locked || timing || !canChange; change.title = canChange ? 'Choose an eligible bowler' : 'An over in progress must be completed by this bowler'
    const options = availableVariations(profile)
    const key = `${profile.id}:${JSON.stringify(options)}:${controls.variation}:${locked}:${timing}`
    if (signature !== key) {
      signature = key
      variations.replaceChildren(...options.map(v => {
        const btn = node('button', '', v.label); btn.type = 'button'; btn.dataset.variation = v.id
        btn.disabled = locked || timing || v.locked; btn.title = v.reason || v.description
        btn.setAttribute('aria-pressed', String(v.id === controls.variation))
        if (v.locked) btn.textContent += ' · locked'
        btn.addEventListener('click', () => { controls.variation = v.id; controls.length = v.defaultLength; actual.hidden = true; feedback = ''; update(); changed() })
        return btn
      }))
    }
    description.textContent = options.find(v => v.id === controls.variation)?.description ?? ''
    sideButtons.forEach((button, i) => { button.disabled = locked || timing; button.setAttribute('aria-pressed', String(controls.side === (i ? 'around' : 'over'))) })
    power.input.value = String(controls.power); movement.input.value = String(controls.movement)
    power.input.disabled = movement.input.disabled = locked || timing
    power.caption.firstChild!.textContent = spin ? 'Delivery pace ' : 'Pace effort '
    power.input.setAttribute('aria-label', spin ? 'Spin delivery pace' : 'Pace effort')
    power.output.textContent = `${Math.round(controls.power * 100)}%`
    movement.caption.firstChild!.textContent = spin ? 'Revolutions / flight ' : 'Swing / seam '
    movement.input.setAttribute('aria-label', spin ? 'Revolutions and flight' : 'Swing and seam')
    movement.output.textContent = `${Math.round(controls.movement * 100)}%`
    const line = Math.abs(controls.line) < .14 ? 'Middle' : controls.line < -.9 ? 'Outside leg' : controls.line < -.32 ? 'Leg' : controls.line > .95 ? 'Wide off' : controls.line > .42 ? 'Outside off' : 'Off stump'
    const length = controls.length < 1.8 ? 'Yorker' : controls.length < 4.2 ? 'Full' : controls.length < 7.4 ? 'Good' : controls.length < 10 ? 'Short' : 'Bouncer'
    targetText.textContent = `${line} · ${length}`
    pitch.setAttribute('aria-description', `${line}, ${length}, ${controls.length.toFixed(1)} metres from stumps. ${controls.batterHand}-handed batter.`)
    marker.style.left = `${(controls.line + 1.4) / 2.8 * 100}%`; marker.style.top = `${(12.5 - controls.length) / 11.9 * 100}%`
    status.textContent = timing ? 'Stop in the gold zone · SPACE or tap' : feedback || `${spin ? 'SPIN LAB' : 'PACE ATTACK'} · ${controls.batterHand === 'left' ? 'LHB' : 'RHB'} facing · aim, then set release`
    meter.hidden = !timing
    button.disabled = locked
    button.textContent = timing ? 'Release now' : 'Set release'
    pitch.classList.toggle('locked', locked || timing)
  }
  return {
    root,
    get controls() { return { ...controls } },
    get timing() { return timing },
    configure(p: PlayerProfile, state: Innings, hand: 'right' | 'left', disabled: boolean, allowChange: boolean) {
      if (profile?.id !== p.id) { controls.variation = availableVariations(p).find(v => !v.locked)?.id ?? 'stock'; controls.length = availableVariations(p).find(v => !v.locked)?.defaultLength ?? 6.2; feedback = ''; actual.hidden = true }
      profile = p; innings = state; controls.batterHand = hand; locked = disabled; canChange = allowChange; update()
    },
    startTiming() { if (locked || !profile) return; timing = true; age = 0; feedback = ''; actual.hidden = true; update() },
    finishTiming() { const position = (1 - Math.cos(age * Math.PI / 1.3)) / 2; controls.release = Math.round(clamp(1 - Math.abs(position - .5) * 2, 0, 1) * 1000) / 1000; timing = false; update(); return controls.release },
    advance(dt: number) { if (timing) { age += dt; needle.style.left = `${(1 - Math.cos(age * Math.PI / 1.3)) * 50}%` } },
    reset() { timing = false; feedback = ''; profile = undefined; signature = ''; root.hidden = true },
    feedback(message: string, point?: { x: number; z: number }) {
      feedback = message
      if (point) { actual.hidden = false; actual.style.left = `${clamp((point.x * (controls.batterHand === 'left' ? -1 : 1) + 1.4) / 2.8 * 100, 0, 100)}%`; actual.style.top = `${clamp((12.5 - point.z) / 11.9 * 100, 0, 100)}%` }
      update()
    },
    select(index: number) { const v = profile && availableVariations(profile).filter(v => !v.locked)[index]; if (v && !locked && !timing) { controls.variation = v.id as BowlingVariation; controls.length = v.defaultLength; update(); changed() } },
  }
}
