# H6: Coordinated running retreat

## Root cause and reproduction before the fix

`Delivery.setRunning(false)` already assigns a shared retreat direction and
clears queued runs. `Delivery.advanceRunners()` moves each batter by its own
pace, but the old terminal condition cleared `retreating` when only
`runnerProgress` (the original striker) reached zero. The next tick skipped
both runners even if `partnerProgress` remained positive.

The defect becomes visible when the faster striker reaches progress 1 and
waits for the slower partner before turning back. Capping the faster runner's
progress means their return times can differ. This is a premature shared-stop
decision, not separate or reversed targets, an interception estimate, or a
race between two runner controllers. There is no automatic retreat heuristic
or safe-arrival estimate in the existing game: the manual Run/Turn back
commands determine direction; assisted running can be stopped but does not
turn back.

Before changing production code, a public-control simulation reproduced the
failure with seed 8, fast bowling, line .44, effort .63, bowler Mehta, manual
running, runner pace [1.25, .8], default automatic fielding, and other delivery
options at their defaults. Swing: tick 37, drive, aim 0, power .7. Run: tick
39. Turn back: tick 250. At tick 397 the old simulation stopped with progress
[0, .20546448087431704], coordinates [1.22, 15.267387978142077], and no completed
runs. The partner stayed 3.632612021857925 metres short of the bowler's crease
until finalization at tick 676. The new regression failed at the premature
stop; all 181 existing tests passed before the production change.

## Running invariants established before implementation

- `Delivery` is the sole running controller. Each attempt uses a shared
  direction with separate progress and pace for the original striker and
  partner. Progress 1 targets the opposite crease; progress 0 targets the
  crease occupied after the last completed run. Completed-run parity maps
  these targets to pitch coordinates 1.22 and 18.90 metres.
- The first manual Run uses the existing 18-tick startup delay. Further Run
  commands queue attempts. Turn back clears the queue and reverses both
  runners toward progress 0 without resetting positions or completed runs.
- Each runner advances at `(1 / 60) / 3.05 * runnerPace[index]` per tick.
  There is no independent acceleration. Local and online match setup obtain
  pace multipliers from each batter's existing profile. Distances already
  travelled and individual speeds determine how many ticks each needs to
  return. Retreat remains active until *both* have arrived, even when one
  needs more time. This does not promise safety against a throw.
- A runner that reaches a target waits there under the existing [0, 1]
  clamp. A turn-back may legitimately send a batter who reached the opposite
  crease back home while the run is still incomplete. Once home, that batter
  remains there while the partner finishes returning.
- Repeated Turn back commands keep the same destinations and clear the queue;
  they do not oscillate. An explicit later Run command can resume forward
  motion, as before. No other handler assigns a competing movement target.
- Only `advanceRunners()` may increment `completedRuns`, after both batters
  reach progress 1 (the existing manual grounding tolerance is 1e-9).
  Crossing, a single arrival, a retreat, a keeper fumble, and finalization
  cannot complete a run. An unfinished second attempt does not erase the
  first completed run or add another. This preserves H3.
- Wicket-break checks remain authoritative. Return/break handlers advance
  runners before checking actual crease coordinates; arrival on the break
  tick is safe and arrival later is not. The slower runner is never deemed
  grounded because the faster runner arrived. Crossing and dismissal identity
  retain their existing rules.
- Finalization and the innings reducer use actual completed runs, existing
  wicket/crossing rules, and existing extras. Incomplete retreats award no
  run; H4 no-ball and H5 overthrow awards remain independent of movement.
- Fixed-step timing, command sequence order, individual movement speeds,
  fielding/throw timing, and random-number consumption remain unchanged.

## Implementation

The sole production change is in the terminal branch of manual
`advanceRunners()`: end retreat only when **both** progress values are zero.
The preceding movement already clamps each value to [0, 1], so redundant
`Math.max` assignments are removed. No new controller, destination state,
pace synchronization, teleportation, timing estimate, or input rule is added.

The first arrival stays clamped at its own crease while the second continues
at its normal pace. A batter that has crossed or reached the opposite crease
uses the same valid origin target as any other incomplete attempt. Both
arriving at the opposite ends still completes a run before another command
can reverse that completed attempt. No completion, wicket, scoring, fielding,
or replay code is modified.

## Before/after: identical seeded delivery

The complete configuration and controls are above. Pitch travel is 17.68 m;
speed multipliers [1.25, .8] correspond to 7.245901639 and 4.637377049 m/s.
Coordinates below are original-striker/partner grounded-foot Z coordinates,
not animation roots. Run origins are [1.22, 18.90]; outbound targets are
[18.90, 1.22]; retreat targets return to [1.22, 18.90]. The initial non-striker
backs up normally during bowling, reaching 18.72 at the Run command.

All rows have **zero completed runs**. Values are rounded only for display.

| Tick | Event | Before progress | After progress | Before Z (m) | After Z (m) |
|---:|---|---|---|---|---|
| 0 | Delivery starts | [0, 0] | same | [1.22, 18.90] | same |
| 39 | Run command after contact | [0, 0] | same | [1.22, 18.72] | same |
| 57 | First movement | [.006830601, .004371585] | same | [1.340765027, 18.822710383] | same |
| 203 | Faster striker grounds opposite | [1, .642622951] | same | [18.90, 7.538426230] | same |
| 250 | Turn back after both pass halfway | [1, .848087432] | same | [18.90, 3.905814208] | same |
| 251 | Both retreat | [.993169399, .843715847] | same | [18.779234973, 3.983103825] | same |
| 397 | Striker home; old controller stops pair | [0, .205464481] | same | [1.22, 15.267387978] | same |
| 398 | Partner remains active only after fix | [0, .205464481] | [0, .201092896] | [1.22, 15.267387978] | [1.22, 15.344677596] |
| 443 | Last tick before partner grounds | [0, .205464481] | [0, .004371585] | [1.22, 15.267387978] | [1.22, 18.822710383] |
| 444 | Both home after fix | [0, .205464481] | [0, 0] | [1.22, 15.267387978] | [1.22, 18.90] |
| 676 | Delivery ends | [0, .205464481] | [0, 0] | [1.22, 15.267387978] | [1.22, 18.90] |

At tick 397 the old `runnersReturning` and `runnersMoving` both became false;
after the fix they stay true until tick 444. The striker is grounded at 397
in both versions; the partner is grounded at its origin only in the corrected
version. The faster batter's outward arrival at 203 did not ground the
partner or score a run.

Ball/fielder state and timing are identical before and after:

| Tick | Ball XYZ (m) | Active fielder XYZ (m) | Event |
|---:|---|---|---|
| 0 | [.28, 2.06, 18.29] | None; keeper [0, 0, -3.70] | Release |
| 39 | [.451165572, .710982622, .46] | [10, 0, 33] | Chase begins |
| 250 | [.200671514, .036, 65.029821274] | [4.608900977, 0, 54.787934191] | Turn-back command |
| 397 | [.171001507, .036, 72.677855294] | [.666156915, 0, 70.722393525] | Faster batter home |
| 411 | [.169891168, .036, 72.964067210] | [.312316877, 0, 72.244566455] | Pickup |
| 427 | [.169891168, .036, 72.964067210] | [.312316877, 0, 72.244566455] | Return starts |
| 444 | [.194795672, 1.782335072, 66.207977926] | [.312316877, 0, 72.244566455] | Slower batter home after fix |
| 619 | [.451165572, .85, -3.34] | same | Keeper receives throw |
| 676 | [0, .711, approximately 0] | same | Keeper breaks wicket at near end |

The keeper stays at [.451165572, 0, -3.70] from contact until carrying the
return to [0, 0, -.40]. Return flight is 192 ticks; the existing seeded
overthrow draw occurs at tick 428. Both versions finalize `fielded`, no
wicket, no bat runs/byes/leg-byes/no-ball/wide, completedRuns 0, overthrowRuns
1. The innings is 1/0 after one legal ball with original strike [1, 2].
The unchanged score does not hide the defect: the old non-striker is still
stranded when the safe striker protects the near-end wicket.

An independent pre-fix reproduction also used real roster multipliers
[1.14, .94] (Sen/Roy): seed 41, fast, effort .63, maxOutside 2, manual running
and fielding, defend at the predicted contact tick, aim -1.35, power .7;
Run 39, Turn back 219. At tick 380 the old controller stopped at
[1.22, 18.718369399], leaving the partner 18.16 cm short through timeout 640.
Reversing the pace order let both runners return, confirming the asymmetry.

## Lifecycle traced

1. Local `runningCall()` in `src/main.ts` sends the Run/Turn back command to
   `Delivery.setRunning()` and records the simulation tick. Online authority
   in `scripts/online-server.ts` applies the same method and stores accepted
   command order. These paths share the same controller.
2. `setRunning(true)` starts or queues an attempt. `setRunning(false)` clears
   queued attempts and enables retreat if either progress value is positive.
   The first call's `runStartTick` supplies the existing start delay. A queued
   attempt begins after completion without a new delay.
3. `stepApproach()` updates normal non-striker backing and advances manual
   runners during flight. Field chase, pickup/hold, return, keeper break, and
   stumping handlers call `advanceRunners()` in their existing order. Assisted
   running starts after grounding, pickup, or a parry plus its existing delay.
4. Shared direction and individual pace update both progress values; their
   clamped values and completed-run parity determine physical coordinates.
   Both outbound arrivals increment completion and reset progress, leaving
   the physical batters at the correct exchanged ends. Queued runs then use
   the new parity. Both returning arrivals now end retreat together.
5. Wicket handlers use actual foot coordinates with their existing 1e-9
   crease tolerance. The existing crossing classification
   `min(runnerProgress, partnerProgress) >= .5` is used for run-out identity,
   not completion. Keeper return then carry/break and bowler-end direct
   wicket break keep their original timing.
6. `finish()` finalizes completed runs/extras and wicket facts; it does not
   advance runners or turn an incomplete attempt into a run. Chase timeout
   and held-ball timeout remain unchanged. `applyDelivery()` in `src/rules.ts`
   applies completed-run parity, existing run-out crossing/replacement, and
   over-end strike rotation. Scorecard and extras attribution remain intact.
7. `DeliveryReplay` applies commands before the step following the recorded
   tick, sorts same-tick inputs by sequence, and consumes each once. Local
   replay also applies recorded controls at their original simulation ticks.

## Files changed

| File | Purpose |
|---|---|
| `src/cricket.ts` | End manual retreat only when both batters are home; remove redundant clamps. |
| `tests/running-retreat.test.ts` | Sixteen deterministic public-control regression tests. |
| `scripts/retreat-browser.ts` | Actual Chromium gameplay smoke test using existing match setup, lineup, swipe, running, and replay interfaces; temporary read-only observer only. |
| `docs/h6-running-retreat.md` | Root cause, pre-fix evidence, invariants, implementation, trace, coverage, verification, and limits. |

## New regression coverage

All tests instantiate the production `Delivery`, step real physics, and issue
public swing/running/fielding commands. No positions, targets, outcomes,
grounding flags, completion counters, or random draws are assigned by tests.

| Test | Behavior protected |
|---|---|
| The slower partner keeps retreating after the faster striker reaches home | Exact red/green reproduction, grounded faster batter waits, partner returns at tick 444, finalization scores zero incomplete runs; existing overthrow remains separate. |
| Retreat remains coordinated with faster striker | Shared retreat continues until both arrive; monotonic movement and valid pitch coordinates. |
| Retreat remains coordinated with faster partner | Swapping speed order does not change the coordination invariant. |
| Retreat remains coordinated with roster speeds | Actual [1.14, .94] profile multipliers preserve independent movement and return destinations. |
| A turn before crossing returns both batters to their original ends without scoring | Early reversal, normal backed-up starting position, no incomplete score. |
| A turn after crossing returns both batters to their original ends without scoring | Crossing does not change the origin targets or award a run. |
| Repeated turn-back commands clear the queue without reversing or restarting either runner | Same-tick and successive cancel inputs remain idempotent, including after arrival; no teleportation. |
| Continuing a safe unequal-speed run waits for the slower batter to ground | Single completes only on the slower arrival, tick 285; correct strike exchange. |
| Abandoning a queued second run preserves only the first grounded run and its strike rotation | Reversed physical ends, fast runner already grounded, partner finishes retreat; only one completed run. |
| An early call and retreat preserve approach movement and backing-up coordinates | Preflight running and cancellation use production movement; existing backing up may resume before contact. |
| Retreat to bowler end grounds on the wicket-break tick | Slower partner arrives on tick 560 and is safe. |
| Retreat to bowler end one tick short is run out | Wicket remains authoritative at tick 560; slower non-striker is correctly dismissed. |
| Retreat to striker end grounds on the wicket-break tick | Slower original striker arrives on tick 676 and is safe. |
| Retreat to striker end one tick short is run out | Wicket remains authoritative at tick 676; striker correctly dismissed. |
| An explicit Run after turning back resumes both runners without awarding the abandoned attempt | Deliberate forward resumption after the faster arrival; still only a fully completed run scores. |
| Same-tick calls and repeated reconstruction reproduce every retreat tick and final outcome | Per-tick positions, direction, queue, ball, keeper, fielders, wickets and outcome match replay; reordered storage, repeated target ticks, fresh reconstruction, and dead-ball calls cannot duplicate a run. |

Existing H3 keeper-fumble tests preserve the both-grounded completion
invariant; H4 tests preserve legitimate no-ball extras and incomplete-run
behavior; H5 tests preserve overthrow and scorecard accounting. Existing
manual-running, fielding, laws, scoring, core determinism, replay, authority,
online restart/reconstruction, and Duo tests also run unchanged.

## Verification on 7 November 2026

| Check | Result |
|---|---|
| Pre-fix regression plus existing suite | 182 total: 181 existing passed; the new H6 regression failed at tick 397, as required. |
| Strict TypeScript | `node node_modules/typescript/bin/tsc --noEmit`: exit 0. Strict checking also runs in the successful production build. |
| New H6 tests | `node --test tests/running-retreat.test.ts`: 16 passed, 0 failed; independently reviewed and rerun. |
| Relevant combined tests | 158 passed, 0 failed, 0 skipped. Includes H6 plus existing running, grounding/H3, no-ball/H4, overthrow/H5, fielding, run-outs, wickets, laws, scorecard, determinism, replay, authority, online/Duo and match-store tests. |
| Complete suite | Package `test` script: 197 passed, 0 failed, 0 skipped, 16.742 seconds. |
| Production build | Package `build` script with `--configLoader native`: exit 0; TypeScript passed, Vite transformed 26 modules and emitted production HTML/CSS/JS. Existing large-chunk warning remains. |
| Actual browser gameplay | `node scripts/retreat-browser.ts`: exit 0, Chromium 156.0.8078.81, no page errors. Coordinated retreat, correct grounding/count/strike, replay, safe single, and late second-run retreat run-out all passed. |
| Whitespace/diff check | `git -c safe.directory=C:/Users/hp/CCL diff --check`: exit 0. |

Exact relevant-suite command:

```powershell
node --test tests/running-retreat.test.ts tests/manual-running.test.ts tests/cricket-extra.test.ts tests/keeper-fumble.test.ts tests/no-ball-extras.test.ts tests/overthrow.test.ts tests/manual-fielding.test.ts tests/cricket-laws.test.ts tests/laws.test.ts tests/scorecard.test.ts tests/core.test.ts tests/delivery-replay.test.ts tests/online.test.ts tests/duo.test.ts tests/authority.test.ts tests/match-store.test.ts
```

This machine's `npm` PowerShell launcher resolved a nonexistent roaming
`npm-cli.js`. The installed npm entry point was invoked explicitly, keeping
the repository's package scripts unchanged:

```powershell
node 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' test
node 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' run build -- --configLoader native
```

The default Vite configuration bundler initially failed because esbuild
could not read the parent directory under the sandbox. An elevated retry was
not executed: automatic approval review itself failed with `content-blocked`
(not a determination that the build was unsafe). The native config loader
successfully built the same project inside the existing sandbox permissions;
no repository configuration or permission setting was changed. No unrelated
pre-existing test failures were found.

## Actual browser evidence

The browser test starts a match through setup, reorders the real lineup
through Dressing room controls to Iyer/Singh, and uses their existing paces
[1.08, .98]. Match/delivery seed is 1. A physical diagonal mouse swipe selects
an on-drive at the predicted contact tick. Running, Turn back, and replay
use the existing keyboard/button interfaces. A temporary production build
exposes a read-only observer; it does not set gameplay state or outcomes.
The temporary build is removed after the test.

| Event | Tick | Progress [Iyer, Singh] | Completed runs |
|---|---:|---|---:|
| Run called | 39 | [0, 0] | 0 |
| Turn back with faster batter already grounded opposite | 236 | [1, .9639344262] | 0 |
| Faster batter home; slower batter still returning | 406 | [0, .0535519126] | 0 |
| Both home | 417 | [0, 0] | 0 |
| Delivery finalized | 640 | [0, 0] | 0 |

At tick 406 the foot coordinates are [1.22, 17.9532021858], retreat remains
active, and the next tick moves the partner toward home. Final score is 0/0;
Iyer remains striker and Singh non-striker. Extra dead-ball frames do not
change the innings. UI replay reproduces the same positions, outcome and
innings without duplicate scoring.

A separate safe-single scenario finishes 1/0, one completed run, with Singh
on strike. A third match attempts a second run late: Run at ticks 39 and
530, Turn back at 610, wicket break at 640. Final progress is
[.2950819672, .2677595628], positions [13.6829508197, 5.9539890710]. The
non-striker is run out, only the first completed run counts, score is 1/1,
and strike identities are [3, 1]. This proves retreat does not grant instant
safety and preserves both dismissal identity and incomplete-run accounting.

Exact Windows command (software rendering was used on this machine):

```powershell
$env:CCL_CHROME_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
$env:CCL_SOFTWARE_GPU='1'
node scripts/retreat-browser.ts
```

Browser coverage is local desktop gameplay at 1000x650. Online/Duo were
verified by their integration/reconstruction tests, not an additional
two-browser UI smoke test in this task. No screenshots are retained; the
script emits the observed tick/position/outcome evidence to stdout.

## Limits and scope

- Turn back is a user command, not a new AI safety planner. A legitimate late
  retreat can still be run out. No speculative arrival-time heuristic was
  added: the defect was the premature stop, and actual per-runner arrival
  now controls that stop.
- Tests cover normal positive paces, including real roster speeds and a wider
  [1.25, .8] regression pair. Invalid/nonfinite/zero pace configuration and
  independent acceleration are outside the supported player setup and were
  not added or normalized.
- The existing backing-up behavior can resume during bowling after a very
  early retreat. The existing crossing/dismissal classification and fielding
  timeouts remain as implemented. Manual keeper collection takes the break
  path rather than the assisted fumble path; H3 compatibility is verified
  through its existing production scenarios.
- Existing rendering can choose the neutral pose when the original striker
  gets home on the first attempt while the partner is still returning. The
  partner's independent physical position continues correctly. This task
  does not change animation selection.
- Replay is deterministic within the corrected build. Old records that hit
  H6 reconstruct using the corrected simulation and can show different
  positions or wicket outcomes; input-history versions do not pin a physics
  version. Existing sealed scores/checksums are not rewritten. Mixed old/new
  simulation builds are not guaranteed equivalent for affected histories.
- No unrelated gameplay, scoring rules, extras, DRS, networking contracts,
  physics, player attributes, fielding probabilities, UI/animation, modes, or
  PRD changes were made. H1-H5 remain intact; H7 was not started.
