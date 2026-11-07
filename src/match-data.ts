import { PITCH_PRESETS, WEATHER_PRESETS, type PitchPreset, type WeatherPreset } from './cricket.ts'

export const VENUE_NAMES = {
  suncrest: 'Suncrest Oval',
  harbor: 'Harbor Reach',
  citadel: 'Citadel Pavilion',
} as const
export type Venue = keyof typeof VENUE_NAMES
export const VENUE_BOUNDARIES = {
  suncrest: { x: 64, z: 64 },
  harbor: { x: 57, z: 64 },
  citadel: { x: 62, z: 67 },
} as const
export type RoomSettings = { overs: number; venue: Venue; pitch: PitchPreset; weather: WeatherPreset }
export const DEFAULT_ROOM_SETTINGS: RoomSettings = { overs: 5, venue: 'suncrest', pitch: 'dry', weather: 'clear' }

export function parseRoomSettings(value: unknown): RoomSettings | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item: Record<string, unknown> = Object.fromEntries(Object.entries(value))
  if (Object.keys(item).length !== 4 || typeof item.overs !== 'number' || !Number.isInteger(item.overs) ||
      item.overs < 2 || item.overs > 20) return null
  const venue = Object.keys(VENUE_NAMES).find((name): name is Venue => name === item.venue)
  const pitch = PITCH_PRESETS.find((name) => name === item.pitch)
  const weather = WEATHER_PRESETS.find((name) => name === item.weather)
  return venue && pitch && weather ? { overs: item.overs, venue, pitch, weather } : null
}

export const ROSTER = [
  { name: 'Mehta', role: 'Batter' }, { name: 'Rao', role: 'Pace' },
  { name: 'Singh', role: 'Batter' }, { name: 'Iyer', role: 'Keeper' },
  { name: 'Patel', role: 'Spin' }, { name: 'Khan', role: 'Pace' },
  { name: 'Shah', role: 'Spin' }, { name: 'Gill', role: 'Batter' },
  { name: 'Das', role: 'Pace' }, { name: 'Reddy', role: 'Batter' },
  { name: 'Joshi', role: 'Batter' }, { name: 'Nair', role: 'Keeper' },
  { name: 'Dutt', role: 'Spin' }, { name: 'Sen', role: 'Pace' },
  { name: 'Roy', role: 'Batter' },
] as const


export function isBowler(name: string) {
  const role = ROSTER.find((player) => player.name === name)?.role
  return role === 'Pace' || role === 'Spin'
}

export function lineupError(names: string[]) {
  if (names.length !== 11 || new Set(names).size !== 11 ||
    names.some((name) => !ROSTER.some((player) => player.name === name))) return 'Choose exactly 11 distinct players.'
  if (!ROSTER.some((player) => player.role === 'Keeper' && names.includes(player.name))) return 'Select a wicketkeeper.'
  if (names.filter(isBowler).length < 5) return 'Select at least five bowlers.'
  return ''
}


export const DEFAULT_LINEUP: string[] = ROSTER.slice(0, 11).map(({ name }) => name)

/** Stable opponent IDs shared by local match setup and profile defaults. */
export const OPPONENT_NAMES = ['Hayes', 'Reed', 'Ward', 'Mills', 'Cole', 'Nash', 'Bell', 'Frost', 'Pike', 'King', 'Banks']
export const OPPONENT_BOWLERS = ['Ward', 'Cole', 'Mills', 'Bell', 'King']
