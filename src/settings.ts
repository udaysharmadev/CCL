/**
 * Local settings and career records.
 *
 * Both are stored through the platform adapter, so they follow the player to a
 * CrazyGames account when one is available and stay on the device otherwise.
 */

import { save, stored } from './platform.ts'

export type Quality = 'high' | 'medium' | 'low'

export type Settings = {
  sound: boolean
  reducedMotion: boolean
  showNeedle: boolean
  quality: Quality
  /** How forgiving the contact window is. */
  timing: 'relaxed' | 'standard' | 'precise'
}

export const DEFAULT_SETTINGS: Settings = {
  sound: true, reducedMotion: false, showNeedle: true, quality: 'high', timing: 'standard',
}

/** The contact window multiplier for each timing setting. */
export const TIMING_WINDOWS: Readonly<Record<Settings['timing'], number>> = {
  relaxed: 1.8, standard: 1, precise: 0.75,
}

const SETTINGS_KEY = 'ccl.settings.v1'

export type CareerRecord = {
  matches: number
  wins: number
  runs: number
  wickets: number
  bestScore: number
  bestRuns: number
  sixes: number
  fours: number
  coins: number
  xp: number
}

export const EMPTY_CAREER: CareerRecord = {
  matches: 0, wins: 0, runs: 0, wickets: 0, bestScore: 0, bestRuns: 0, sixes: 0, fours: 0, coins: 0, xp: 0,
}

const CAREER_KEY = 'ccl.career-stats.v1'

function read(key: string): unknown {
  try { return JSON.parse(stored(key) ?? 'null') } catch { return null }
}

export function loadSettings(): Settings {
  const value = read(SETTINGS_KEY)
  if (!value || typeof value !== 'object') return { ...DEFAULT_SETTINGS }
  const item = value as Record<string, unknown>
  const quality = item.quality
  return {
    sound: item.sound !== false,
    reducedMotion: item.reducedMotion === true,
    showNeedle: item.showNeedle !== false,
    quality: quality === 'medium' || quality === 'low' ? quality : 'high',
    timing: item.timing === 'relaxed' || item.timing === 'precise' ? item.timing : 'standard',
  }
}

export function saveSettings(settings: Settings) {
  return save(SETTINGS_KEY, JSON.stringify(settings))
}

export function loadCareer(): CareerRecord {
  const value = read(CAREER_KEY)
  if (!value || typeof value !== 'object') return { ...EMPTY_CAREER }
  const item = value as Record<string, unknown>
  const number = (key: keyof CareerRecord) => {
    const entry = item[key]
    return Number.isSafeInteger(entry) && (entry as number) >= 0 ? entry as number : 0
  }
  return {
    matches: number('matches'), wins: number('wins'), runs: number('runs'), wickets: number('wickets'),
    bestScore: number('bestScore'), bestRuns: number('bestRuns'), sixes: number('sixes'),
    fours: number('fours'), coins: number('coins'), xp: number('xp'),
  }
}

export function saveCareer(career: CareerRecord) {
  return save(CAREER_KEY, JSON.stringify(career))
}
