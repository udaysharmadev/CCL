import type { DeliveryOutcome, Innings } from './rules.ts'

/** Presentation reads canonical scoring. It cannot award runs or decide dismissals. */
export function broadcastEvent(outcome: DeliveryOutcome) {
  if (outcome.wicket) return { kind: 'wicket', kicker: 'WICKET' } as const
  if (outcome.noBall || outcome.wide) return { kind: 'default', kicker: 'EXTRA DELIVERY' } as const
  if (outcome.reason === 'boundary' && outcome.batRuns === 6) return { kind: 'six', kicker: 'OVER THE ROPE' } as const
  if (outcome.reason === 'boundary' && outcome.batRuns === 4) return { kind: 'four', kicker: 'TO THE BOUNDARY' } as const
  return { kind: 'default', kicker: 'DELIVERY COMPLETE' } as const
}

/** Only a newly committed delivery may cross a milestone. Replays never call this. */
export function inningsMilestone(before: Innings, after: Innings): string | undefined {
  if (after.attempts !== before.attempts + 1) return
  const index = before.striker - 1
  const batter = after.batting[index]
  const previousRuns = before.batting[index]?.runs ?? 0
  const threshold = batter && Math.floor(batter.runs / 50) * 50
  if (batter && threshold && previousRuns < threshold) {
    return `${threshold === 50 ? 'HALF CENTURY' : threshold === 100 ? 'CENTURY' : `${threshold} RUNS`} · ${batter.name} ${batter.runs} (${batter.balls})`
  }
  const teamThreshold = Math.floor(after.runs / 50) * 50
  if (teamThreshold && before.runs < teamThreshold) return `${teamThreshold} UP · ${after.runs}/${after.wickets}`
}
