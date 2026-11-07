# Bowling engine and match selection

The milestone extends `Delivery`; it does not introduce a second simulation. The fixed-step ball, contact, running, fielding, wicket, extras, and scoring paths are shared. New Solo deliveries opt into a versioned bowling snapshot. A record without that snapshot follows the previous constructor arithmetic and random draws, including historical online recordings.

## Input and replay contract

`createBowlingExecution(profile, controls)` validates capability, compatible variations, arm, action, type-specific pace limits, every bowling rating, and finite bounded controls. The returned frozen version-1 object contains immutable player ID, arm, type, action, attributes, workload, and these numeric decisions:

- `line`: −1.4 to +1.4 metres relative to the batter (positive is off side).
- `length`: first-bounce target 0.6–12.5 metres from the striker's stumps.
- `power`, `release`, `movement`: 0–1; release is the accepted timing execution quality.
- `side`: over or around the wicket; `batterHand`: right or left.

`DeliveryOptions.bowling` stores that snapshot. `bowlingKind` provides a legacy category for compatible presentation. `bowlingReleasePoint` and `Delivery.release` expose the physical launch point; animation follows this point at the end of the run-up. Rendering does not advance or decide scoring. The ball begins moving only when the simulation is instantiated at release.

The optional `batting` and `fielding` snapshots preserve participating attributes independently of later squad edits. Replay uses recorded options plus existing ordered commands; it never reads the current profile store. `bowlerId` and scorecard `playerId` are stable identifiers, while `name` remains the match's display-name snapshot. Equal display names cannot merge bowling figures.

## Movement and attributes

Pace supports stock, inswing, outswing, reverse swing, yorker, toe yorker, bouncer, short ball, slower ball, off cutter, leg cutter, and cross seam. Reverse swing and the toe yorker have skill gates. Maximum pace bounds the physical speed of every variation, including quicker spin variations; power, stamina, execution, control, and variation affect speed and dispersion. Yorker, bouncer, and slower-ball specialties affect execution quality. Seam and cutters impart motion after landing. Reverse swing builds later in flight. Stamina currently uses legal-ball workload, rather than tracking physical fatigue per animation or illegal attempt.

Finger spin supports off break, top spinner, arm ball and (right-arm off-spin with sufficient mastery) doosra. Left-arm orthodox has its own compatible set including slider. Wrist spin supports leg break, googly, top spinner, slider and mastery-gated flipper. Arm-specific drift acts in flight; spin/turn produce a lateral impulse at landing and movement afterward. Googly and doosra reverse stock turn. Topspin increases bounce; slider and flipper skid lower; flight and movement alter the trajectory and time to the batter.

The target is the actual intended first bounce, with seeded error determined by accuracy, execution, control, consistency and fatigue. The nominal aim does not cancel post-bounce turn. Pitch type, wear and weather retain their existing effects. Feedback compares the forecast bounce against the target. New deliveries above 1.85 m at the batting plane are dangerous-delivery no-balls; poor high-effort releases can overstep. Legacy no-ball behavior remains unchanged.

Batting timing, technique and skill affect the contact window; consistency adds bounded seeded variability; technique and shot control affect vertical/lateral reach; power affects struck speed. Gesture aim remains a world angle. Handedness changes stroke-line interpretation, pad position and the off/leg interpretation of LBW. Fielding snapshots affect chase/reaction speed, catch/pickup reach, pickup duration, throw pace/accuracy and keeper fumbles. Existing grounding and wicket-break order remains authoritative.

## Player selection

`createManagedInnings` snapshots eleven profiles and adds explicit entered-player state. `chooseOpeningPair` accepts two distinct 1-based lineup positions before any delivery. `applyDelivery` marks the correct vacated end after a committed wicket, strike rotation and end-over swap. `chooseNextBatter` accepts only an unused, available player. A pending replacement blocks another delivery. Completed innings do not create a replacement prompt.

`bowlerEligibility` excludes non-bowlers, consecutive-over selections, exhausted quotas, and changes within an interrupted over. Overs are reconstructed from legal balls; wides/no-balls cannot prematurely trigger a new bowler. Reduced formats respect the extra-over allocation as well as the ceiling quota. With the bowling pool supplied, a memoized quota-schedule check also excludes selections that would strand the final overs with only one bowler who cannot bowl consecutively. UI selection and AI share this guard. `chooseAIBowler` uses legal eligibility, skill, accuracy, control, stamina, workload, performance, handedness and match situation. `chooseAIDelivery` selects from the same permitted variations and numeric execution limits, favors death-over yorkers, varies spin, and avoids repeating the preceding variation without reason.

Retired-hurt and substitution workflows were absent in the previous local controller and are not introduced here.

## Mode compatibility

| Mode | Bowling/player changes |
| --- | --- |
| Solo | Managed openers, next batter and next bowler; snapshots; full delivery controls, attributes and new ball movement |
| Training / Longest Six | Existing drills and deterministic delivery recipes retained |
| Quick / Private | Existing server-authoritative protocol, lineups, recipes, rotation, command ordering and sequencing retained |
| Duo | Existing shared innings, authority, running commands, swaps and replay retained |

The online parser still accepts only the original bowl intent fields. It rejects an attempted client-supplied new snapshot; no client can choose an authoritative result. An online rollout would need a negotiated contract version and server-owned profile snapshots before enabling these controls. SQLite and sealed match rows are not migrated or rewritten. Local profile storage migration is described in `player-profile-design.md`.

## Verification

`tests/bowling-system.test.ts` adds 44 tests, including the eight arm/hand/wicket-side combinations, every compatible variation, replay parity, line/length error, flight and bounce, no-balls, invalid inputs, duplicate display names, all 2–20-over quotas, future rotation feasibility, maximum pace caps, opening selection, ten wickets with arbitrary openers, both run-out ends and over endings, and batting/fielding attribute effects. All 44 passed in the final focused engine run.

The H2 controller harness retains its original 20 tests and all assertions. New browser presentation adapters choose legal players through the real callbacks, while a helper skips only the entrance's visual clock before the existing DRS fixtures. No adjudication or score reducer is replaced. The final full command `node --test --test-concurrency=1 tests/*.test.ts` passed **303/303 tests, zero failures or skips**, in 36.85 seconds. TypeScript passed. Serial test execution isolates the exact-timing online fixtures from concurrent browser/CPU load: the unchanged server intentionally compensates real measured ping latency. The final unit and browser logs are saved in `docs/bowling-evidence/regression/`.

All three existing browser suites passed using installed Chromium 1248:

- Online: two clients, toss, server-scored swing, equal snapshots, reload/reconnect, private invite/configuration/approval, 12-ball first innings, a chase completed by a wide, rewards and rematch; no page errors.
- Duo: mutual swap/cancel, complete shared 12-ball innings at 7/1, manual single, queued commands applied once, turn back, partner calls, correct non-striker run-out replacement, live-ball reconnect, team rewards and rematch; no page errors. Five screenshots are under `docs/bowling-evidence/online/`.
- Longest Six: five balls, 1815 points, ground-hit rejection, replay without re-scoring, pause, saved best and the small viewport; no page errors. Evidence is under `docs/bowling-evidence/six/`.

These scripts use Vite's native config loader for Node 22+ compatibility with the Windows sandbox. Duo's evidence paths honor `CCL_QA_DIR` or the OS temporary directory instead of assuming `/tmp`; the Online/Duo overs selector targets the actual current `private-overs` input. Test gameplay assertions and server protocols are unchanged.
