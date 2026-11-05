import type { Delivery, Timing } from './cricket.ts'

export const SIX_ATTEMPTS = 5
export type SixAttempt = Readonly<{
  id: number
  validSix: boolean
  distance: number
  points: number
  timing: Timing | null
}>
export type SixChallenge = Readonly<{
  attempts: readonly SixAttempt[]
  points: number
  longest: number
  streak: number
  complete: boolean
}>

export function newSixChallenge(): SixChallenge {
  return { attempts: [], points: 0, longest: 0, streak: 0, complete: false }
}

export function scoreSix(state: SixChallenge, id: number, delivery: Delivery): SixChallenge {
  if (state.complete || state.attempts.some((attempt) => attempt.id === id) || !delivery.outcome) return state
  const distance = delivery.landingDistance ?? 0
  const azimuth = delivery.launchAzimuth ?? 0
  const validSix = delivery.outcome.reason === 'boundary' && delivery.outcome.batRuns === 6 &&
    Number.isFinite(distance) && distance > 0 && Number.isFinite(azimuth)
  const streak = validSix ? state.streak + 1 : 0
  const angleError = Math.abs(Math.atan2(Math.sin(azimuth), Math.cos(azimuth)))
  const precision = Math.round(80 * Math.max(0, 1 - angleError / (Math.PI / 3)))
  const timing = delivery.timing === 'perfect' ? 40 : delivery.timing === 'good' ? 25 : 0
  const points = validSix ? 100 + Math.max(0, Math.floor((distance - 60) * 4)) +
    precision + timing + Math.min(100, streak * 25) : 0
  const attempts = [...state.attempts, { id, validSix, distance: validSix ? distance : 0, points, timing: delivery.timing }]
  return {
    attempts, points: state.points + points, longest: Math.max(state.longest, validSix ? distance : 0),
    streak, complete: attempts.length >= SIX_ATTEMPTS,
  }
}
