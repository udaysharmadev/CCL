import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  applyReview, bowlerIsLegal, bowlerQuota, freeHitAllows, judgeExtras, judgeLbw, judgeNoBall, judgeWide,
  nextBowler, nextStrike, overthrowRuns, projectToStumps, stumpPortion,
  LEG_STUMP, OFF_STUMP, STUMP_HEIGHT,
} from '../src/laws.ts'
import { applyDelivery, bowlerIndex, newInnings, nextBowler as selectBowler, runRates } from '../src/rules.ts'
import type { DeliveryOutcome } from '../src/rules.ts'

const dot: DeliveryOutcome = {
  batRuns: 0, wide: 0, noBall: 0, byes: 0, legByes: 0,
  wicket: null, completedRuns: 0, reason: 'collected', contact: 'miss',
}

test('leg before wicket follows the three point test', () => {
  const base = {
    pitchX: 0, impactX: 0, batFirst: false, strokeOffered: true,
    wouldHitStumps: true, portion: 0.8,
  }
  assert.equal(judgeLbw(base).out, true)
  assert.equal(judgeLbw({ ...base, batFirst: true }).out, false, 'bat and glove beat the pad')
  assert.equal(judgeLbw({ ...base, pitchX: null }).out, false, 'a full toss cannot be lbw')
  assert.equal(judgeLbw({ ...base, pitchX: LEG_STUMP - 0.01 }).out, false, 'pitched outside leg stump')
  assert.equal(judgeLbw({ ...base, pitchX: OFF_STUMP + 0.2 }).out, true, 'pitched outside off stump is allowed')
  assert.equal(judgeLbw({ ...base, impactX: LEG_STUMP - 0.01 }).out, false, 'impact outside leg stump')
  assert.equal(judgeLbw({ ...base, impactX: OFF_STUMP + 0.01 }).out, false, 'impact outside off stump with a stroke')
  assert.equal(
    judgeLbw({ ...base, impactX: OFF_STUMP + 0.01, strokeOffered: false }).out,
    true,
    'without a stroke an impact outside off stump is still eligible',
  )
  assert.equal(judgeLbw({ ...base, wouldHitStumps: false }).out, false, 'the ball was never going to hit')
})

test('a marginal lbw projection is an umpires call', () => {
  const marginal = judgeLbw({
    pitchX: 0, impactX: 0, batFirst: false, strokeOffered: true, wouldHitStumps: true, portion: 0.42,
  })
  assert.equal(marginal.out, true)
  assert.equal(marginal.umpiresCall, true)
  const clear = judgeLbw({
    pitchX: 0, impactX: 0, batFirst: false, strokeOffered: true, wouldHitStumps: true, portion: 0.9,
  })
  assert.equal(clear.umpiresCall, false)
})

test('stump geometry reports how much of the ball would cover the stumps', () => {
  assert.equal(stumpPortion(0), 1)
  assert.equal(stumpPortion(0.2), 0)
  assert.ok(stumpPortion(0.14) < 0.5)
  // Half the ball covers the stumps when the ball's centre is on the stump line.
  assert.ok(Math.abs(stumpPortion(OFF_STUMP) - 0.5) < 1e-9)

  const straight = projectToStumps({ x: 0, y: 0.4, z: 0.46 }, { x: 0, y: 0, z: -24 })
  assert.equal(straight.hits, true)
  assert.equal(straight.at?.x, 0)

  const overTheTop = projectToStumps({ x: 0, y: 1.2, z: 0.46 }, { x: 0, y: 0, z: -24 })
  assert.equal(overTheTop.hits, false)
  assert.equal(overTheTop.at ? overTheTop.at.y > STUMP_HEIGHT : false, true)

  const wideOfTheStumps = projectToStumps({ x: 0.5, y: 0.4, z: 0.46 }, { x: 0, y: 0, z: -24 })
  assert.equal(wideOfTheStumps.hits, false)
  assert.equal(wideOfTheStumps.portion, 0)
})

test('wides and no balls are judged on the real criteria', () => {
  assert.equal(judgeWide({ line: 1.4, reach: 1.05 }), 'too-wide')
  assert.equal(judgeWide({ line: 0.4, reach: 1.05 }), null)
  assert.equal(judgeWide({ line: 1.4, reach: 1.05, overHeadHeight: true }), null, 'a delivery above head height is a no ball')
  assert.equal(judgeNoBall({ overHeadHeight: true }), 'dangerous-delivery')
  assert.equal(judgeNoBall({ bouncedTwice: true }), 'bounced-twice')
  assert.equal(judgeNoBall({ frontFootOverLine: true }), 'front-foot')
  assert.equal(judgeNoBall({}), null)
})

test('byes and leg byes are credited to the team and not the batter', () => {
  assert.deepEqual(judgeExtras({ padContact: false, strokeOffered: false, avoiding: false, runsCompleted: 2 }), { byes: 2, legByes: 0 })
  assert.deepEqual(judgeExtras({ padContact: true, strokeOffered: true, avoiding: false, runsCompleted: 1 }), { byes: 0, legByes: 1 })
  assert.deepEqual(judgeExtras({ padContact: true, strokeOffered: false, avoiding: true, runsCompleted: 1 }), { byes: 0, legByes: 1 })
  assert.deepEqual(judgeExtras({ padContact: true, strokeOffered: false, avoiding: false, runsCompleted: 1 }), { byes: 0, legByes: 0 })
  assert.deepEqual(judgeExtras({ padContact: false, strokeOffered: true, avoiding: false, runsCompleted: 0 }), { byes: 0, legByes: 0 })
})

test('an overthrow adds the completed runs and one penalty run', () => {
  assert.equal(overthrowRuns({ completed: 1, attempted: true, brokeWicket: true }), 2)
  assert.equal(overthrowRuns({ completed: 0, attempted: true, brokeWicket: false }), 1)
  assert.equal(overthrowRuns({ completed: 2, attempted: false, brokeWicket: false }), 2, 'a misfield is not an overthrow')
})

test('a free hit protects the batter from every dismissal except a run out', () => {
  assert.equal(freeHitAllows('bowled'), false)
  assert.equal(freeHitAllows('caught'), false)
  assert.equal(freeHitAllows('lbw'), false)
  assert.equal(freeHitAllows('stumped'), false)
  assert.equal(freeHitAllows('hit-wicket'), false)
  assert.equal(freeHitAllows('run-out'), true)
  assert.equal(freeHitAllows('obstructing-the-field'), true)
})

test('a bowler may not bowl two consecutive overs or more than a fifth of the innings', () => {
  assert.equal(bowlerQuota(5), 1)
  assert.equal(bowlerQuota(20), 4)
  assert.equal(bowlerIsLegal({ bowler: 1, previousBowler: 1, oversBowled: 0, inningsOvers: 5 }), false)
  assert.equal(bowlerIsLegal({ bowler: 1, previousBowler: 0, oversBowled: 1, inningsOvers: 5 }), false,
    'a five over innings allows only one over each')
  assert.equal(bowlerIsLegal({ bowler: 1, previousBowler: 0, oversBowled: 1, inningsOvers: 20 }), true)
  assert.equal(bowlerIsLegal({ bowler: 1, previousBowler: 0, oversBowled: 4, inningsOvers: 20 }), false)

  const eligible = [0, 1, 2, 3, 4]
  const picked = nextBowler({ eligible, previousBowler: null, oversBowled: [0, 0, 0, 0, 0], inningsOvers: 5, legalBalls: 0 })
  assert.equal(eligible[picked], 0)
  const second = nextBowler({ eligible, previousBowler: 0, oversBowled: [1, 0, 0, 0, 0], inningsOvers: 5, legalBalls: 6 })
  assert.equal(eligible[second], 1, 'the previous bowler is skipped')
  assert.equal(selectBowler({ eligible, previousBowler: null, oversBowled: [0, 0, 0, 0, 0], inningsOvers: 20, legalBalls: 0 }), 0)
  assert.equal(bowlerIndex(0), 0)
  assert.equal(bowlerIndex(6), 1)
})

test('a review that is an umpires call keeps the review', () => {
  const retained = applyReview({ original: 'not-out', reviewed: 'out', checked: 'lbw', umpiresCall: true })
  assert.equal(retained.changed, false)
  assert.equal(retained.reviewRetained, true)
  assert.equal(retained.decision, 'not-out')

  const overturned = applyReview({ original: 'not-out', reviewed: 'out', checked: 'lbw', umpiresCall: false })
  assert.equal(overturned.changed, true)
  assert.equal(overturned.reviewRetained, false)
  assert.equal(overturned.decision, 'out')

  const upheld = applyReview({ original: 'out', reviewed: 'out', checked: 'lbw', umpiresCall: false })
  assert.equal(upheld.changed, false)
  assert.equal(upheld.reviewRetained, false)
})

test('the strike changes for odd runs, for an end of over and for a run out after crossing', () => {
  const odd = nextStrike({ striker: 1, nonStriker: 2, completedRuns: 1, crossed: false, dismissed: null, nextBatter: 3, endOfOver: false })
  assert.deepEqual(odd, { striker: 2, nonStriker: 1 })
  const over = nextStrike({ striker: 1, nonStriker: 2, completedRuns: 0, crossed: false, dismissed: null, nextBatter: 3, endOfOver: true })
  assert.deepEqual(over, { striker: 2, nonStriker: 1 })
  const wicket = nextStrike({ striker: 1, nonStriker: 2, completedRuns: 0, crossed: false, dismissed: 'striker', nextBatter: 3, endOfOver: false })
  assert.deepEqual(wicket, { striker: 3, nonStriker: 2 })
  const crossed = nextStrike({ striker: 1, nonStriker: 2, completedRuns: 1, crossed: true, dismissed: 'nonStriker', nextBatter: 3, endOfOver: false })
  assert.equal(crossed.striker, 3, 'the incoming batter takes strike')
  assert.equal(crossed.nonStriker, 1, 'the survivor of the crossed run is the non-striker')
  const bowledLastBall = nextStrike({ striker: 1, nonStriker: 2, completedRuns: 0, crossed: false, dismissed: 'striker', nextBatter: 3, endOfOver: true })
  assert.deepEqual(bowledLastBall, { striker: 2, nonStriker: 3 }, 'the end of an over changes the strike')
})

test('the scorecard records batter figures, bowler figures, partnerships and fall of wickets', () => {
  const lineup = ['A', 'B', 'C', 'D']
  let innings = newInnings(2, undefined, lineup)
  innings = applyDelivery(innings, { ...dot, batRuns: 4, contact: 'middle', reason: 'boundary', bowler: 'W1' })
  innings = applyDelivery(innings, { ...dot, batRuns: 1, completedRuns: 1, bowler: 'W1' })
  innings = applyDelivery(innings, { ...dot, batRuns: 6, contact: 'middle', reason: 'boundary', bowler: 'W1' })

  assert.equal(innings.runs, 11)
  // The single on the second ball swaps the strike, so the six goes to the other batter.
  assert.equal(innings.batting[0]?.runs, 5)
  assert.equal(innings.batting[0]?.balls, 2)
  assert.equal(innings.batting[0]?.fours, 1)
  assert.equal(innings.batting[0]?.sixes, 0)
  assert.equal(innings.batting[1]?.runs, 6)
  assert.equal(innings.batting[1]?.sixes, 1)
  assert.equal(innings.bowling[0]?.name, 'W1')
  assert.equal(innings.bowling[0]?.balls, 3)
  assert.equal(innings.bowling[0]?.runs, 11)
  assert.equal(innings.partnerships[0]?.runs, 11)
  assert.equal(innings.partnerships[0]?.balls, 3)

  innings = applyDelivery(innings, { ...dot, wicket: 'caught', reason: 'caught', bowler: 'W1' })
  assert.equal(innings.wickets, 1)
  // The single on the second ball handed the strike to the second batter.
  assert.equal(innings.batting[1]?.dismissed, true)
  assert.equal(innings.batting[1]?.dismissal, 'caught')
  assert.equal(innings.batting[1]?.dismissalText, 'caught')
  assert.equal(innings.batting[0]?.dismissed, false)
  assert.equal(innings.fallOfWickets[0]?.batter, 2)
  assert.equal(innings.fallOfWickets[0]?.runs, 11)
})

test('byes and leg byes are charged to the team and never to the bowler', () => {
  let innings = newInnings(2, undefined, ['A', 'B'])
  innings = applyDelivery(innings, { ...dot, byes: 2, completedRuns: 2, bowler: 'W1' })
  assert.equal(innings.runs, 2)
  assert.equal(innings.extras.byes, 2)
  assert.equal(innings.batting[0]?.runs, 0)
  assert.equal(innings.batting[0]?.balls, 1)
  assert.equal(innings.bowling[0]?.runs, 0, 'byes are not charged to the bowler')
})

test('penalty runs and overthrow runs reach the team total', () => {
  let innings = newInnings(2, undefined, ['A', 'B'])
  innings = applyDelivery(innings, { ...dot, overthrowRuns: 2, penalty: 5 })
  assert.equal(innings.runs, 7)
  assert.equal(innings.extras.penalty, 5)
})

test('a free hit still permits a run out but protects against every other dismissal', () => {
  let innings = newInnings(2, undefined, ['A', 'B'])
  innings = applyDelivery(innings, { ...dot, noBall: 1 })
  assert.equal(innings.freeHit, true)
  const protectedBall = applyDelivery(innings, { ...dot, wicket: 'lbw', reason: 'lbw' })
  assert.equal(protectedBall.wickets, 0)
  const runOut = applyDelivery(innings, { ...dot, wicket: 'run-out', reason: 'run-out', completedRuns: 1 })
  assert.equal(runOut.wickets, 1)
  assert.equal(runOut.freeHit, false)
})

test('the run rate and the required rate are reported', () => {
  let innings = newInnings(2, 20, ['A', 'B'])
  innings = applyDelivery(innings, { ...dot, batRuns: 6, contact: 'middle' })
  const rates = runRates(innings)
  assert.equal(rates.current, 36)
  assert.equal(Math.round((rates.required ?? 0) * 10) / 10, 7.6)
})
