import type { Innings } from './rules.ts'

export type DuoSeat = 0 | 1
export type DuoOwners = Record<number, DuoSeat>

export function updateDuoOwners(owners: DuoOwners, previous: Innings, next: Innings): DuoOwners {
  if (next.wickets === previous.wickets || next.wickets >= 10) return owners
  const dismissed = next.history.at(-1)?.dismissedBatter ?? 'striker'
  return { ...owners, [next.wickets + 2]: owners[previous[dismissed]] }
}
