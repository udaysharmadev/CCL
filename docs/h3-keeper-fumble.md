# H3: keeper fumble run completion

## Root cause and existing rule

`Delivery.stepApproach()` assigned `completedRuns = 1` when the keeper
fumbled a missed delivery, and reset `runnerProgress`. Neither batter had
traversed the pitch. `runnerPositions` uses completed-run parity to determine
the batters' ends, so this also exchanged their positions prematurely.

The innings reducer is not called at the fumble tick. The incorrect count
survived until `Delivery.finish()`, where `judgeExtras` converted it to a bye
or leg bye and the outcome passed it to `applyDelivery`. The reducer then
credited the extra and rotated strike. A later real traversal could add a
second run on top of the fabricated first run.

The existing CCL rule, documented in README and `phase-3.md`, requires both
batters to reach the opposite popping crease. `Delivery.advanceRunners()`
owns this decision. `runnerProgress` and `partnerProgress` describe the
current attempt independently; `completedRuns` records full traversals.
These are grounded foot coordinates, not animation-completion signals.
Assisted running clamps each progress to 1 and requires both to be 1;
manual running retains its existing `1e-9` completion tolerance. Crossing
alone does not complete a run.

## Minimal implementation

Removed the fumble's completed-run assignment and progress reset. Updated its
comment to identify `advanceRunners()` as the completion owner. The fumble
still changes the ball velocity, marks it parried and starts the same chase
with the same interception and timing.

Each simulation step dispatches one phase handler. Normal completion
increments the count once and resets both runners' progress. Further steps
after a dead ball do nothing. Finalization and the reducer are unchanged;
neither infers completion from an incomplete attempt. The reducer itself is
not an idempotent event store: local delivery lifecycle and online settlement
continue to own the once-only innings commit.

Return and wicket-break handlers still advance runners before checking
crease occupancy, preserving safe grounding on the wicket-break tick.
Completed runs survive a later run-out; crossing determines which original
batter is dismissed and where the survivor belongs.

## Deterministic before/after reproduction

Use the production `Delivery` and `applyDelivery(newInnings(), outcome)`:

```ts
new Delivery({ seed: 13, kind: 'fast', line: .4, effort: .63 })
```

Do not swing or issue controls. The omitted `runningMode` selects existing
assisted running. No private state, random draw, event or score is replaced.
The ball misses the bat and pad; there is no wide, no-ball or wicket.

| Tick | Event | Original code | Corrected code |
| --- | --- | --- | --- |
| 48 | Ball approaching keeper | Progress `[0, 0]`, completed 0; grounded coordinates `[1.22, 18.72]` | Same |
| 49 | Keeper fumbles; `flight` becomes `field/chase` | Completed 1, progress `[0, 0]`; parity falsely changes coordinates to `[18.9, 1.22]` | Completed 0; coordinates stay `[1.22, 18.72]` |
| 67 | First assisted running update after the 18-tick delay | Phantom first run remains | First attempt begins, completed 0 |
| 87 | Return ends delivery | Progress `[0.1147540984, 0.1147540984]`, one bye, innings `1/0`, strike `[2, 1]` | Same progress, zero byes, innings `0/0`, strike `[1, 2]` |

The non-striker is backed up 0.18 m before running. At tick 49 the ball is at
approximately `(0.47047455, 0.65690704, -3.36)`. Neither runner has made any
opposite-crease traversal. Corrected final coordinates at tick 87 are
`[3.24885246, 16.87114754]`, both short of their destinations.

Before the production change, both original H3 regression tests failed with
`actual: 1, expected: 0`: immediate completed-run count and finalized outcome.
The same two fixtures pass after the change.

With `fieldingMode: 'manual'`, the keeper holds the collected ball long
enough for genuine running. The first run completes at tick 249, the second
at 432. An unattended return produces a run-out at 608 with two byes; the
incomplete third attempt is excluded. A throw commanded at 176 breaks the
wicket at exactly 249, yielding one bye and no wicket. Commanding it one tick
earlier breaks the wicket at 248, yielding a run-out and zero runs.

## Regression coverage

`tests/keeper-fumble.test.ts` adds 13 tests:

1. Fumble does not fabricate a completed run or exchange ends.
2. Finalization excludes the unfinished first attempt and preserves strike.
3. Stopping assisted running immediately after the fumble scores zero.
4. A faster batter grounding alone does not count; the slower partner must arrive.
5. Crossed but ungrounded runners score zero at a subsequent wicket.
6. Two completed runs remain scored when the third attempt ends in a run-out.
7. Wicket break one tick before first grounding scores zero.
8. Wicket break on first grounding scores one and is safe.
9. Wicket break one tick after first grounding preserves one completed run.
10. Wicket break on second grounding scores two and is safe.
11. A subsequent delivery's fumble preserves a previously scored single and strike.
12. Repeated replay targets and dead-ball updates do not duplicate completion.
13. Manual keeper collection retains its existing run-out behavior for the fumble seed.

The existing bye/leg-bye reachability test originally relied on phantom
credit: its automatic keeper returns gave no time to traverse the pitch.
Its fixture now uses the existing manual-fielding hold and the corresponding
longer simulation bound. Both existing reachability assertions remain, with
additional assertions that awarded byes and leg byes equal completed runs.
No assertion was removed or weakened.

## Verification

Environment: Node v24.19.0, TypeScript 5.9.3, Vite 7.3.7. The installed `npm`
PowerShell wrapper resolves a missing roaming npm installation; the commands
below use the installed CLI directly where needed.

| Check | Command | Result |
| --- | --- | --- |
| Strict TypeScript | `node node_modules/typescript/bin/tsc --noEmit` | Passed |
| H3 and cricket laws | `node --test tests/keeper-fumble.test.ts tests/cricket-laws.test.ts` | 22 passed, 0 failed: 13 H3 and 9 existing tests |
| Full suite | `node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" test` | 146 passed, 0 failed, 0 skipped |
| Production build | `node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run build -- --configLoader native` | Passed; 26 modules, chunk-size warning |
| H3 browser smoke | `$env:CCL_SOFTWARE_GPU='1'; node scripts/keeper-fumble-browser.ts` | Passed; Chromium 156.0.8078.4, no page errors |

The full suite includes running, fielding, scoring, wickets, simulation,
authority, online/Duo, delivery reconstruction and DRS lifecycle tests.
The default Vite config bundler encountered a sandbox directory-access
error. Its native config loader completed the build inside the sandbox
without modifying project configuration.

The browser smoke starts a real Solo match through Match setup, bowling first
against Rookie AI. Match seed `4293693210` produces delivery seed 45; the AI
naturally leaves that delivery. Bowling line is `.4`, effort `.63`. A temporary
production build adds a read-only state observer for precise assertions; no
simulation state, score or random draw is replaced. The controls, rendering,
simulation, reducer and replay remain the production implementations.

- Tick 47: natural keeper fumble, zero completed runs, positions and strike unchanged.
- Tick 85 with automatic fielding: incomplete attempt ends at `0/0`; Hayes retains strike.
- With manual fielding, the Keeper end UI throw at tick 174 arrives at the wicket on tick 247.
- Tick 246: both progress values exceed `.99` but are below 1; score remains `0/0`.
- Tick 247: both runners ground, exactly one bye is scored, no wicket, Reed takes strike.
- Further frames and UI replay retain exactly one completed run and one scored delivery.

Browser launch and temporary builds succeeded in the sandbox after using the
native config loader. An earlier escalation attempt was not executed because
automatic approval review failed with `content-blocked`; no escalation was
needed for the successful run. The temporary build is removed after the smoke.

## Limits and compatibility

An in-progress or already completed run **before this same fumble**, and
simultaneous fumble/grounding, are not reachable in the current production
flow: assisted runners do not advance during approach, while manual keeper
collection selects the wicket-break path before evaluating a fumble. These
branches are preserved. Tests cover the reachable same-tick grounding versus
wicket-break race after a natural fumble, and runs completed before a later
delivery's fumble. No artificial state injection claims to reproduce the
unreachable combinations.

Corrected replay reconstruction of historical assisted fumble deliveries can
produce a different outcome than the old buggy simulation. Existing sealed
scores are not rewritten. Online/Duo manual keeper behavior and networking
contracts are unchanged; their existing tests pass.

## Scope and files

- `src/cricket.ts`: remove the two premature run/progress overrides and explain ownership.
- `tests/keeper-fumble.test.ts`: deterministic production simulation/reducer regressions.
- `tests/cricket-laws.test.ts`: allow genuine completion in the existing extras reachability fixture and strengthen its checks.
- `scripts/keeper-fumble-browser.ts`: dedicated natural-match UI smoke with a temporary read-only observer.
- `docs/h3-keeper-fumble.md`: reproduction, implementation and verification report.

No unrelated gameplay, scoring rules, DRS, networking, physics, UI,
animations, fumble probabilities or PRD changes. H1 and H2 implementations
are untouched. H4 and other audit items are not started.
