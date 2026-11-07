import { createDressingRoom } from './dressing-room.ts'
import {
  FIELD_LABELS, FIELD_PRESETS, PITCH_LABELS, PITCH_PRESETS, WEATHER_LABELS, WEATHER_PRESETS,
  type FieldPreset, type PitchPreset, type WeatherPreset,
} from './cricket.ts'
import { save, stored } from './platform.ts'
import { VENUE_NAMES, type Venue } from './stadium.ts'

export { ROSTER, isBowler } from './match-data.ts'
import { ROSTER, DEFAULT_LINEUP, lineupError } from './match-data.ts'

const LINEUP_KEY = 'ccl.lineup.v1'
const SETUP_KEY = 'ccl.solo.v1'
const DIFFICULTIES = ['Rookie', 'Club', 'Pro', 'Legend'] as const
type Difficulty = (typeof DIFFICULTIES)[number]
export type SoloSettings = {
  overs: number
  venue: Venue
  pitch: PitchPreset
  weather: WeatherPreset
  field: FieldPreset
  difficulty: Difficulty
  toss: 'bat' | 'bowl'
  running: 'assist' | 'manual'
  fielding?: 'auto' | 'manual'
}

export const DEFAULT_SETTINGS: SoloSettings = {
  overs: 2, venue: 'suncrest', pitch: 'dry', weather: 'clear', field: 'balanced', difficulty: 'Club', toss: 'bat', running: 'manual', fielding: 'auto',
}

const VENUES = Object.keys(VENUE_NAMES).filter((key): key is Venue => Object.hasOwn(VENUE_NAMES, key))

function read(key: string): unknown {
  try { return JSON.parse(stored(key) ?? 'null') } catch { return null }
}

function validChoice<T extends string>(options: readonly T[], value: unknown, fallback: T) {
  return options.find((option) => option === value) ?? fallback
}

export function getSettings(): SoloSettings {
  const saved = read(SETUP_KEY)
  if (!saved || typeof saved !== 'object') return { ...DEFAULT_SETTINGS }
  const item = saved as Record<string, unknown>
  const overs = item.overs
  return {
    overs: typeof overs === 'number' && Number.isInteger(overs) && overs >= 2 && overs <= 20 ? overs : 2,
    venue: validChoice(VENUES, item.venue, 'suncrest'),
    pitch: validChoice(PITCH_PRESETS, item.pitch, 'dry'),
    weather: validChoice(WEATHER_PRESETS, item.weather, 'clear'),
    field: validChoice(FIELD_PRESETS, item.field, 'balanced'),
    difficulty: validChoice(DIFFICULTIES, item.difficulty, 'Club'),
    toss: item.toss === 'bowl' ? 'bowl' : 'bat',
    running: 'manual',
    fielding: item.fielding === 'manual' ? 'manual' : 'auto',
  }
}

export function getLineup(): string[] {
  const names = read(LINEUP_KEY)
  if (Array.isArray(names) && names.every((name: unknown) => typeof name === 'string') && !lineupError(names)) return names
  return [...DEFAULT_LINEUP]
}


function options<T extends string>(input: HTMLSelectElement, values: readonly T[], labels?: Record<T, string>) {
  input.replaceChildren(...values.map((value) => new Option(labels?.[value] ?? value, value)))
}

export function setupMenus(start: (settings: SoloSettings) => void) {
  const setup = document.querySelector<HTMLDialogElement>('#setup-dialog')!
  const form = document.querySelector<HTMLFormElement>('#setup-form')!
  const lineup = document.querySelector<HTMLDialogElement>('#lineup-dialog')!
  const chosen = document.querySelector<HTMLOListElement>('#lineup-chosen')!
  const bench = document.querySelector<HTMLUListElement>('#lineup-bench')!
  const count = document.querySelector<HTMLElement>('#lineup-count')!
  const status = document.querySelector<HTMLElement>('#lineup-status')!
  const commit = document.querySelector<HTMLButtonElement>('#lineup-save')!
  const squadCounts = {
    batters: document.querySelector<HTMLElement>('#lineup-batters')!,
    bowlers: document.querySelector<HTMLElement>('#lineup-bowlers')!,
    keepers: document.querySelector<HTMLElement>('#lineup-keepers')!,
    reserves: document.querySelector<HTMLElement>('#bench-count')!,
  }
  const selects = {
    overs: document.querySelector<HTMLSelectElement>('#setup-overs')!,
    venue: document.querySelector<HTMLSelectElement>('#setup-venue')!,
    pitch: document.querySelector<HTMLSelectElement>('#setup-pitch')!,
    weather: document.querySelector<HTMLSelectElement>('#setup-weather')!,
    field: document.querySelector<HTMLSelectElement>('#setup-field')!,
    difficulty: document.querySelector<HTMLSelectElement>('#setup-difficulty')!,
    toss: document.querySelector<HTMLSelectElement>('#setup-toss')!,
    running: document.querySelector<HTMLSelectElement>('#setup-running')!,
    fielding: document.querySelector<HTMLSelectElement>('#setup-fielding')!,
  }
  const format = document.querySelector<HTMLElement>('#setup-format')!
  const venuePreview = document.querySelector<HTMLElement>('#setup-preview')!
  const previewName = document.querySelector<HTMLElement>('#setup-preview-name')!
  const previewDetail = document.querySelector<HTMLElement>('#setup-preview-detail')!
  const previewMatch = document.querySelector<HTMLElement>('#setup-preview-match')!
  let draft: string[] = []
  const preview = document.createElement('div')
  preview.className = 'lineup-preview'
  lineup.querySelector('.lineup-lists')!.before(preview)
  let room: ReturnType<typeof createDressingRoom> | undefined

  options(selects.overs, Array.from({ length: 19 }, (_, index) => String(index + 2)))
  options(selects.venue, VENUES, VENUE_NAMES)
  options(selects.pitch, PITCH_PRESETS, PITCH_LABELS)
  options(selects.weather, WEATHER_PRESETS, WEATHER_LABELS)
  options(selects.field, FIELD_PRESETS, FIELD_LABELS)
  options(selects.difficulty, DIFFICULTIES)
  options(selects.toss, ['bat', 'bowl'], { bat: 'Bat first', bowl: 'Bowl first' })
  options(selects.fielding, ['auto', 'manual'], { auto: 'Automatic', manual: 'Manual · move, collect and throw' })
  options(selects.running, ['manual'], { manual: 'Tap RUN · C to turn back' })

  function showFormat() {
    format.textContent = Number(selects.overs.value) < 5 ? 'ARCADE SHORT MATCH' : 'LIMITED-OVERS ARCADE'
    const venue = validChoice(VENUES, selects.venue.value, 'suncrest')
    venuePreview.dataset.venue = venue
    previewName.textContent = VENUE_NAMES[venue]
    previewDetail.textContent = `${PITCH_LABELS[validChoice(PITCH_PRESETS, selects.pitch.value, 'dry')]} · ${WEATHER_LABELS[validChoice(WEATHER_PRESETS, selects.weather.value, 'clear')]}`
    previewMatch.textContent = `${selects.overs.value} overs per side · ${selects.toss.value === 'bowl' ? 'Bowling first' : 'Batting first'} · ${selects.difficulty.value}`
  }
  for (const select of Object.values(selects)) select.addEventListener('change', showFormat)
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const settings: SoloSettings = {
      overs: Number(selects.overs.value),
      venue: validChoice(VENUES, selects.venue.value, 'suncrest'),
      pitch: validChoice(PITCH_PRESETS, selects.pitch.value, 'dry'),
      weather: validChoice(WEATHER_PRESETS, selects.weather.value, 'clear'),
      field: validChoice(FIELD_PRESETS, selects.field.value, 'balanced'),
      difficulty: validChoice(DIFFICULTIES, selects.difficulty.value, 'Club'),
      toss: selects.toss.value === 'bowl' ? 'bowl' : 'bat',
      running: selects.running.value === 'manual' ? 'manual' : 'assist',
      fielding: selects.fielding.value === 'manual' ? 'manual' : 'auto',
    }
    if (!Number.isInteger(settings.overs) || settings.overs < 2 || settings.overs > 20) return
    save(SETUP_KEY, JSON.stringify(settings))
    setup.close()
    start(settings)
  })

  function listButton(label: string, description: string, run: () => void, disabled = false) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'choice'
    button.textContent = label
    button.setAttribute('aria-label', description)
    button.disabled = disabled
    button.addEventListener('click', run)
    return button
  }

  function renderLineup(focus?: string) {
    const error = lineupError(draft)
    count.textContent = `PLAYING XI · ${draft.length}/11`
    status.textContent = error || 'Your XI is match ready.'
    status.dataset.ready = String(!error)
    const selected = ROSTER.filter(({ name }) => draft.includes(name))
    squadCounts.batters.textContent = String(selected.filter(({ role }) => role === 'Batter').length)
    squadCounts.bowlers.textContent = String(selected.filter(({ role }) => role === 'Pace' || role === 'Spin').length)
    squadCounts.keepers.textContent = String(selected.filter(({ role }) => role === 'Keeper').length)
    squadCounts.reserves.textContent = `${ROSTER.length - draft.length} players`
    commit.disabled = Boolean(error)
    if (room) room.render(draft)
    chosen.replaceChildren(...draft.map((name, index) => {
      const role = ROSTER.find((player) => player.name === name)?.role
      const row = document.createElement('li')
      row.dataset.role = role?.toLowerCase()
      const player = document.createElement('span')
      player.className = 'roster-player'
      const number = document.createElement('i')
      number.className = 'roster-number'
      number.textContent = String(index + 1).padStart(2, '0')
      const playerName = document.createElement('b')
      playerName.textContent = name
      const playerRole = document.createElement('small')
      playerRole.textContent = role ?? ''
      player.append(number, playerName, playerRole)
      const move = (step: number, label: string, disabled: boolean) => listButton(label, `Move ${name} ${step < 0 ? 'up' : 'down'}`, () => {
        [draft[index], draft[index + step]] = [draft[index + step], draft[index]]
        renderLineup(`Move ${name} ${step < 0 ? 'up' : 'down'}`)
      }, disabled)
      row.append(player, move(-1, '↑', index === 0), move(1, '↓', index === draft.length - 1),
        listButton('Bench', `Bench ${name}`, () => {
          draft.splice(index, 1)
          renderLineup(`Select ${name}`)
        }))
      return row
    }))
    bench.replaceChildren(...ROSTER.filter(({ name }) => !draft.includes(name)).map(({ name, role }) => {
      const row = document.createElement('li')
      row.dataset.role = role.toLowerCase()
      const player = document.createElement('span')
      player.className = 'roster-player reserve-player'
      const playerName = document.createElement('b')
      playerName.textContent = name
      const playerRole = document.createElement('small')
      playerRole.textContent = role
      player.append(playerName, playerRole)
      row.append(player, listButton('Select', `Select ${name}`, () => {
        draft.push(name)
        renderLineup(`Bench ${name}`)
      }, draft.length >= 11))
      return row
    }))
    if (focus) Array.from(lineup.querySelectorAll('button')).find((button) =>
      button.getAttribute('aria-label') === focus && !button.disabled)?.focus()
  }

  document.querySelector('#setup-cancel')!.addEventListener('click', () => setup.close())
  document.querySelector('#setup-dismiss')!.addEventListener('click', () => setup.close())
  document.querySelector('#lineup-cancel')!.addEventListener('click', () => lineup.close())
  document.querySelector('#lineup-dismiss')!.addEventListener('click', () => lineup.close())
  commit.addEventListener('click', () => {
    if (lineupError(draft)) return
    if (save(LINEUP_KEY, JSON.stringify(draft))) lineup.close()
    else status.textContent = 'Could not save this lineup.'
  })
  return {
    openSetup() {
      const settings = getSettings()
      for (const key of Object.keys(selects) as (keyof SoloSettings)[]) selects[key].value = String(settings[key] ?? 'auto')
      showFormat()
      setup.showModal()
    },
    openLineup() {
      draft = getLineup()
      renderLineup()
      lineup.showModal()
      try {
        room ??= createDressingRoom(preview)
        room.render(draft)
      } catch { preview.textContent = 'Your selected XI is listed below.' }
    },
  }
}
