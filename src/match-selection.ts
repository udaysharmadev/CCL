import type { PlayerProfile } from './player-profile.ts'
import { newInnings, type Innings, type BowlerStats } from './rules.ts'
import { availableVariations, isSpinBowler, type BattingHand } from './bowling.ts'

/** Display strings and IDs are snapshotted; subsequent squad edits cannot rewrite history. */
export function createManagedInnings(overs: number, target: number | undefined, profiles: readonly PlayerProfile[]): Innings {
  if (profiles.length !== 11 || new Set(profiles.map(p => p.id)).size !== 11) throw new Error('An innings requires eleven distinct players.')
  const state = newInnings(overs, target, profiles.map(p => p.identity.displayName))
  return { ...state, batting: state.batting.map((b, i) => ({ ...b, playerId: profiles[i].id })),
    selection: { battingOrder: profiles.map((_, i) => i + 1), entered: [1, 2], pendingBatter: null } }
}

export function chooseOpeningPair(state: Innings, striker: number, nonStriker: number): Innings {
  if (!state.selection || state.attempts !== 0 || state.complete) throw new Error('The opening pair can only be chosen before the innings.')
  if (![striker, nonStriker].every(i => Number.isInteger(i) && i >= 1 && i <= state.batting.length) || striker === nonStriker) throw new Error('Choose two distinct opening batters.')
  return { ...state, striker, nonStriker, selection: { ...state.selection, entered: [striker, nonStriker], pendingBatter: null } }
}

export function availableBatters(state: Innings): number[] {
  const order = state.selection?.battingOrder ?? state.batting.map((_, i) => i + 1)
  return order.filter(i => !state.batting[i - 1]?.dismissed && i !== state.striker && i !== state.nonStriker && !state.selection?.entered.includes(i))
}

export function chooseNextBatter(state: Innings, index: number): Innings {
  if (!state.selection?.pendingBatter || state.complete) throw new Error('No incoming batter is required.')
  if (!availableBatters(state).includes(index)) throw new Error('This batter is already in, dismissed, or unavailable.')
  return { ...state, [state.selection.pendingBatter]: index,
    selection: { ...state.selection, entered: [...state.selection.entered, index], pendingBatter: null } }
}

/** Preserve the selected batting order, breaking equal positions with the original XI. */
export function recommendedBatter(state: Innings): number | null { return availableBatters(state)[0] ?? null }

type OverRecord = { index: number; bowlerId: string; attempts: number; legal: number }
export function bowlingOvers(state: Innings): OverRecord[] {
  const overs: OverRecord[] = []
  let legalBalls = 0
  for (const ball of state.history) {
    const index = Math.floor(legalBalls / 6)
    const id = ball.bowlerId ?? ball.bowler ?? ''
    const over = overs[index] ?? { index, bowlerId: id, attempts: 0, legal: 0 }
    if (!overs[index]) overs[index] = over
    over.attempts++
    if (!ball.wide && !ball.noBall) { over.legal++; legalBalls++ }
  }
  return overs
}

export function activeOverBowler(state: Innings): string | null {
  if (state.complete) return null
  return bowlingOvers(state).find(over => over.index === Math.floor(state.legalBalls / 6))?.bowlerId || null
}

export function needsBowlerSelection(state: Innings, selection?: { playerId: string; over: number }): boolean {
  if (state.complete || activeOverBowler(state)) return false
  return !selection || selection.over !== Math.floor(state.legalBalls / 6)
}

export type BowlerEligibility = { eligible: boolean; reason: string; figures: BowlerStats; maxOvers: number; stamina: number; recent: string[] }
/** Check a complete remaining schedule before letting a captain exhaust all
 * alternatives. Equivalent quota counts are interchangeable, bounding the search
 * to small count multisets rather than permutations of eleven identities. */
function leavesLegalRotation(profile: PlayerProfile, state: Innings, pool: readonly PlayerProfile[]): boolean {
  const eligible = pool.filter(p => availableVariations(p).some(v => !v.locked))
  const chosen = eligible.findIndex(p => p.id === profile.id)
  if (chosen < 0) return false
  const counts = eligible.map(p => Math.floor((state.bowling.find(b => b.playerId === p.id || !b.playerId && b.name === p.id)?.balls ?? 0) / 6))
  counts[chosen]++
  const base = Math.floor(state.overs / 5), extra = state.overs % 5, maximum = Math.max(1, Math.ceil(state.overs / 5))
  const failed = new Set<string>()
  const search = (previous: number, remaining: number): boolean => {
    if (remaining <= 0) return true
    const key = `${remaining}|${counts[previous]}|${counts.filter((_, i) => i !== previous).sort((a, b) => a - b).join(',')}`
    if (failed.has(key)) return false
    const usedExtra = counts.filter(n => n > base).length
    const tried = new Set<number>()
    const choices = counts.map((count, i) => ({ count, i })).sort((a, b) => a.count - b.count)
    for (const { count, i } of choices) {
      if (i === previous || count >= maximum || tried.has(count) || state.overs >= 5 && extra && count >= base && usedExtra >= extra) continue
      tried.add(count); counts[i]++
      const possible = search(i, remaining - 1)
      counts[i]--
      if (possible) return true
    }
    failed.add(key)
    return false
  }
  return search(chosen, state.overs - Math.floor(state.legalBalls / 6) - 1)
}

export function bowlerEligibility(profile: PlayerProfile, state: Innings, pool?: readonly PlayerProfile[]): BowlerEligibility {
  const figures = state.bowling.find(b => b.playerId === profile.id || (!b.playerId && b.name === profile.id)) ?? {
    name: profile.identity.displayName, playerId: profile.id, balls: 0, runs: 0, wickets: 0, maidens: 0, wides: 0, noBalls: 0,
  }
  const maxOvers = Math.max(1, Math.ceil(state.overs / 5))
  const stamina = Math.max(42, Math.round(100 * (1 - figures.balls / (78 + profile.bowling.stamina * 1.8))))
  const history = bowlingOvers(state)
  const active = activeOverBowler(state)
  const previous = history.find(over => over.index === Math.floor(state.legalBalls / 6) - 1)?.bowlerId
  const base = Math.floor(state.overs / 5), remainder = state.overs % 5
  const extended = state.bowling.filter(b => b.balls > base * 6 && b.playerId !== profile.id).length
  let reason = ''
  if (state.complete) reason = 'Innings complete.'
  else if (!availableVariations(profile).some(item => !item.locked)) reason = 'No bowling capability configured.'
  else if (active && active !== profile.id) reason = 'The current bowler must finish this over.'
  else if (active !== profile.id && previous === profile.id) reason = 'Cannot bowl consecutive overs.'
  else if (figures.balls >= maxOvers * 6) reason = `Maximum ${maxOvers} over${maxOvers === 1 ? '' : 's'} used.`
  else if (!active && state.overs >= 5 && remainder && figures.balls >= base * 6 && extended >= remainder) reason = 'The reduced-innings extra-over allowances are used.'
  else if (!active && pool && !leavesLegalRotation(profile, state, pool)) reason = 'Reserve a different bowler now so the remaining overs can be completed legally.'
  const recent = state.history.filter(ball => (ball.bowlerId ?? ball.bowler) === profile.id).slice(-6).map(ball =>
    ball.wicket ? 'W' : ball.noBall ? 'Nb' : ball.wide ? 'Wd' : String(ball.batRuns + (ball.overthrowRuns ?? 0)))
  return { eligible: !reason, reason, figures, maxOvers, stamina, recent }
}

export function chooseAIBowler(profiles: readonly PlayerProfile[], state: Innings, batterHand: BattingHand): PlayerProfile | null {
  const active = activeOverBowler(state)
  if (active) return profiles.find(p => p.id === active) ?? null
  const late = state.legalBalls >= Math.max(6, state.overs * 6 - 12)
  return profiles.map((profile, index) => {
    const status = bowlerEligibility(profile, state, profiles)
    const b = profile.bowling
    const pressure = state.target !== undefined ? Math.max(0, (state.target - state.runs) / Math.max(1, state.overs * 6 - state.legalBalls) - 1) : 0
    const matchup = isSpinBowler(profile) && b.arm !== batterHand ? 5 : b.arm === 'left' ? 2 : 0
    const effectiveness = status.figures.balls ? status.figures.wickets * 3 - status.figures.runs / status.figures.balls * 2 : 0
    const score = b.skill * .42 + b.accuracy * .2 + b.control * .12 + status.stamina * .12 + matchup + effectiveness
      + (late && !isSpinBowler(profile) ? b.yorker * .15 : !late && isSpinBowler(profile) ? b.turn * .04 : 0)
      + pressure * b.variationMastery * .02 - status.figures.balls * .13
    return { profile, status, score, index }
  }).filter(item => item.status.eligible).sort((a, b) => b.score - a.score || a.index - b.index)[0]?.profile ?? null
}
