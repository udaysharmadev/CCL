# H5: reconcile overthrow scorecard extras

## Investigation and scoring invariants (before implementation)

The first mismatch occurs in `applyDelivery`, not in `Delivery.finish()`.
Seed 8, fast, line .44, effort .63; swing at tick 37 with drive/aim 0/power .7:
contact at 39, first run at 270, pickup 411, return 427, overthrow draw 428,
second run 453, finish 619. Outcome: batRuns 2, completedRuns 2,
overthrowRuns 1, other scoring fields zero. Team, partnership and bowler
totals are 3; batter runs plus innings extras are only 2 + 0 = 2.

Existing production behavior and rules:

- `stepReturn()` makes one seeded .07 overthrow draw, guarded by
  `throwReleased`. The event adds one penalty award; it does not extend the
  ball's flight, grant a completed traversal or introduce another chase.
- `advanceRunners()` alone counts completed traversals. Both batters must
  ground. Running before/during the return can yield more completions;
  incomplete attempts never count. Fumbles create running opportunities.
- `Delivery.finish()` keeps the additional award as optional `overthrowRuns: 1`
  on `fielded` outcomes only. Existing run-outs do not receive this award.
  Bat runs, byes and eligible leg-byes continue to describe actual scoring
  from completed running. No-ball penalties remain separate.
- `laws.overthrowRuns()` describes completed runs plus a penalty, but is not
  invoked by simulation or reducer. Calling it to add the total again would
  double count completed runs.
- Team and partnership totals sum batRuns, wide, noBall, byes, legByes,
  overthrowRuns and general penalty. Batter figures receive only batRuns.
  The bowler is charged batRuns + wide + noBall + overthrowRuns; byes,
  leg-byes and general penalties are excluded under existing CCL behavior.
- The current omission is in `innings.extras.penalty`: it includes general
  penalties but omits the separate overthrow penalty. The correction must
  aggregate both there without modifying either outcome field or total.
- Strike depends on completed-run parity, crossing and wicket identity,
  plus the over-end exchange. Penalty awards do not exchange batters.
- The scorecard renders the reducer's batting/bowling/extras directly;
  delivery and over totals already include overthrowRuns. It must not add
  overthrow runs to the innings again.
- Multiple actual returns are unsupported. Repeated pre-release throw
  requests replace one target; requests during return/break/dead are rejected.
  Dead simulation steps do nothing. Local and server lifecycle guards own
  once-only scoring; the reducer has no delivery identity and is not itself
  an idempotent event store.
- H1 replay uses the same seeded Delivery and consumes commands by cursor.
  Legacy versionless/v1 shot-and-run records are normalized without mutation.
  Sealed outcomes and saved aggregate scores must not be rewritten.

The H4 report records the pre-H5 omission as existing behavior. H5 corrects
that aggregate only; H4's independent no-ball/byes/leg-byes accounting remains.

## Implementation

`applyDelivery` now adds `overthrowRuns` to the existing aggregate
`innings.extras.penalty`. The team total is unchanged; this only fills the
missing attribution. `outcome.penalty` is not modified, so no run is added a
second time. The bowler continues to concede overthrow awards, but not
general penalty runs. The scorecard already reads this aggregate and needs
no separate overthrow arithmetic or history-based repair.

`deliveryToken` retains existing token precedence and appends the explicit
overthrow component (`1OT`, `1+1OT`, `1B+1OT`, etc.). The delivery callout
labels an overthrow-only award instead of calling it a dot ball, and adds
the overthrow detail to other callouts. These are H5 presentation corrections,
not a scorecard redesign. Only ribbon chips with overthrow text expand to fit
the additional component; fixed-width chips otherwise overlapped their neighbor.

The old law and H4 tests explicitly expected the missing aggregate. Their
expected values were corrected and strengthened with batting-plus-extras
reconciliation and separate bowler/outcome assertions. No test was removed
or weakened. No delivery, fielding, grounding, replay or networking production
code changed.

## Deterministic before/after evidence

Before any production edit, `node --test tests/overthrow.test.ts` ran **18
tests: 4 passed, 14 failed** (exit 1). Thirteen failures exposed missing extras
attribution; the remaining failure showed `•` instead of `1OT`. The four
passing cases protect existing run-out behavior without an overthrow award.
The same tests passed after the fix.

The new online test was also run before the fix: **1 test, 0 passed, 1 failed**
on `extras.penalty: 0 !== 1`. Recovery, sealed outcome/checksum and replay
checks passed before reaching this assertion. After the fix, the same test
passes with no changed delivery total or outcome.

| Scenario | Seed, options and public controls | Final outcome / ticks | Before -> after scorecard attribution |
| --- | --- | --- | --- |
| No attempt | 8, fast, line .44, effort .63; drive37 aim0 power.7, stop39 | Fielded619; bat0, completed0, OT1 | Team1; bat0 + extras0 -> bat0 + penalty1 |
| Completed single | Same; stop270 | First completion270, draw428, fielded619; bat1, completed1, OT1 | Team2; bat1 + extras0 -> bat1 + penalty1 |
| Run during return | Same; keep assisted running | Completions270/453, draw428, fielded619; unfinished third progress .907104; bat2, completed2, OT1 | Team3; bat2 + extras0 -> bat2 + penalty1 |
| Turn back | Same with manual running; run39, cancel100 | Progress .240437 at100, home144, fielded676; completed0, OT1 | Team1; extras0 -> penalty1 |
| No-ball bye | 451, yorker, line .4, effort1, manual fielding; stop245 | Fumble45, completion245, return532/draw533, fielded604; Nb1, B1, OT1 | Team3; extras2 -> extras3 (Nb1/B1/P1) |
| Leg-bye | 726, fast, line -.2, effort1, manual fielding; hook29 aim0 power.7, chase62, stop262 | Completion262, return583/draw584, fielded670; Lb1, OT1, no-ball0 | Team2; extras1 -> extras2 (Lb1/P1) |
| Before grounding | 451 bye options; keeper throw171 | Wicket244, completed0, run-out non-striker/crossed; Nb1, OT0 | Team1 and extras1 unchanged |
| On grounding | Same; keeper throw172 | Wicket245, completed1, safe; Nb1/B1/OT1 | Team3; extras2 -> extras3 |
| After grounding | Same; keeper throw173 | Wicket246, completed1, run-out non-striker/not crossed; Nb1/B1/OT0 | Team2 and extras2 unchanged |
| Second grounding | Same; keeper throw355 | Wicket428, completed2, safe; Nb1/B2/OT1 | Team4; extras3 -> extras4 |
| Both wicket ends | 8, manual running/fielding; drive37, run+chase39, throw450, second run550 | Keeper700: striker run-out/crossed; bowler584: striker run-out/not crossed. Bat1/completed1/OT0 | Team1, batter1, extras0 unchanged |
| Online recovery | Server seed8, fast .44/.63, run10, drive37; restart600 | Fielded676; bat1, completed1, OT1; team2/bowler2; striker2/non-striker1 | Extras0 -> penalty1; same sealed outcome/checksum |

All unit simulation fixtures use bowler `Mehta`. Online uses `Rao`. Unless
noted, no wickets, wides, no-balls, byes or leg-byes occur. In every case the
authoritative delivery outcome and final simulation tick are unchanged by
H5; only attribution and overthrow text change.

## New regression coverage

`tests/overthrow.test.ts` contains these 18 tests:

1. **Natural overthrow without a running attempt**: one extra, no batter
   run, no strike exchange.
2. **Natural overthrow after a completed single**: preserves the single,
   adds one separate penalty, exchanges strike once.
3. **Running before and during the overthrow**: retains two traversals,
   excludes the unfinished third, proves the award does not change the count.
4. **Keeper fumble/no-ball/completed bye/overthrow**: H3 fumble starts at zero;
   H4 bye and no-ball remain distinct from the overthrow.
5. **Eligible leg-bye/overthrow**: separate extras; only overthrow conceded
   by the bowler.
6. **Turn back incomplete manual attempt**: returns home without earning
   a run, yet retains the independent overthrow award.
7. **Striker-end run-out**: retains prior bat run, crossing and correct
   dismissed batter; no newly invented run-out penalty.
8. **Bowler-end run-out**: same invariant with the other end and crossing state.
9. **Throw171/wicket244**: incomplete run, existing run-out ordering.
10. **Throw172/wicket245**: same-tick grounding is safe and the complete
    run plus overthrow both survive.
11. **Throw173/wicket246**: prior run survives the next incomplete attempt's wicket.
12. **Throw355/wicket428**: two genuine runs survive the second grounding tick.
13. **Repeated throw requests/dead steps**: one return/one award; rejects
    later throw requests and preserves final outcome after repeated steps.
14. **Versionless replay**: identical outcome/innings/ends, untouched input
    record and no repeated command consumption.
15. **Version1 replay**: same legacy compatibility guarantees.
16. **Version2 replay**: H1 command reconstruction and repeated target parity.
17. **Over accumulation**: six distinct identical seeded deliveries yield
    six penalty extras, bowler6 and no maiden; only over end changes strike.
18. **Delivery tokens**: shows the explicit award for overthrow-only,
    batter-run and no-ball outcomes.

Shared assertions compare outcome fields, completed counts, immutable inputs,
innings runs, batter/bowler figures, extras, strike in each relevant case,
balls/attempts/free-hit state, canonical history, partnership and scorecard
over totals. They assert `sum(batter runs) + sum(extras) === innings.runs`.

`tests/online.test.ts` adds **H5: an authoritative overthrow survives restart,
replay and reconnect without a second award**. It restarts a real WebSocket
server from SQLite during the return, rejects repeated accepted commands,
verifies the sealed checksum and replay reduction, reconnects after settlement,
rejects stale input, and reconciles the server's scorecard aggregate.

`scripts/overthrow-browser.ts` adds three gameplay scenarios: natural
overthrow with incomplete running, one completed bye plus overthrow with UI
replay, and two completed byes plus overthrow. It checks actual HUD, scorecard
batting/bowling/extras, token/callout text and unchanged innings on replay.

## Compatibility and limits

- No schema, network contract, replay version, saved outcome or sealed score
  format changed. H1 command reconstruction and server authority remain intact.
- Recovery loads historical persisted innings aggregates as saved. A snapshot
  written before H5 can still contain the old missing penalty attribution;
  its total and sealed scores are preserved. No migration or retroactive
  correction is attempted, especially because online history may contain
  only the last six deliveries. Newly reduced/reconstructed innings receive
  the corrected aggregate. Old sealed outcomes remain byte-for-byte unchanged.
- The current simulation supports one return/overthrow award per delivery,
  not chained physical overthrows, overthrow boundaries, or an overthrow
  that extends the ball's flight. Tests cover multiple requests to the one
  return; they do not claim unsupported multi-event physics coverage.
- Existing `fielded`-only overthrow finalization is preserved. Nearby run-outs
  retain completed runs but receive no overthrow award under current CCL code.
- No new extras category or cricket rule was introduced. General penalties
  are reducer-supported but not generated by Delivery; the strengthened law
  test covers them together with a distinct overthrow award. Byes, eligible
  leg-byes and no-balls are exercised in production simulation. Existing wide
  and ineligible pad-contact rules remain unchanged and covered by their suites.
- The browser smoke covers Solo bowling with AI assisted running and manual
  fielding. Manual turn-back, pad-contact extras and wicket-end scenarios use
  deterministic unit simulation; online restart/reconnect uses real sockets.
- `applyDelivery` still requires callers to apply each delivery once. Adding
  delivery IDs or reducer-level deduplication would change its contract;
  existing lifecycle guards, command cursors and sealed-event checks remain
  the owners of duplicate prevention.

## Scope

Only H5 scoring attribution and overthrow text were changed. No simulation,
overthrow probability, physics, bat contact, running, grounding, wicket,
no-ball/bye/leg-bye rule, DRS lifecycle, networking contract, unrelated UI,
game mode or PRD change was made. UI changes are limited to overthrow labels
and enough chip width to display them. H1-H4 behavior is retained. H6 was not started.

## Verification and files

| File | Purpose |
| --- | --- |
| `src/rules.ts` | Include the overthrow in aggregate penalty extras; retain distinct outcome components; label overthrow tokens. |
| `src/main.ts` | Describe the overthrow award in delivery feedback; mark only overthrow ribbon chips for content sizing. |
| `src/style.css` | Fit overthrow chip text without overlapping adjacent balls on desktop/mobile. |
| `tests/overthrow.test.ts` (new) | 18 deterministic production simulation, reducer, scorecard, wicket and replay regressions. |
| `tests/online.test.ts` | Add the server restart/reconnect/duplicate-input/authoritative extras regression. |
| `tests/laws.test.ts` | Correct the old omitted-extras expectation; strengthen combined general-penalty/overthrow reconciliation and bowler attribution. |
| `tests/no-ball-extras.test.ts` | Preserve H4 outcome expectations while requiring complete overthrow extras and scorecard reconciliation. |
| `scripts/overthrow-browser.ts` (new) | Real UI smoke for incomplete, one-run and two-run overthrow deliveries, scorecard and replay. |
| `docs/h5-overthrow-scoring.md` (new) | This lifecycle, invariants, reproduction, coverage, verification and compatibility report. |

Validation on 7 November 2026:

| Check | Exact command | Result |
| --- | --- | --- |
| Strict TypeScript | `npx.cmd tsc --noEmit` | Exit 0; strict mode enabled in tsconfig. Repeated by the successful production build. |
| H5 deterministic regressions | `node --test tests/overthrow.test.ts` | 18 passed, 0 failed. Same pre-fix tests: 4 passed, 14 failed. |
| H5 online regression | `node --test --test-name-pattern='H5: an authoritative overthrow' tests/online.test.ts` | 1 passed, 0 failed. Same pre-fix test: 0 passed, 1 failed. |
| H5/H4/law focused group | `node --test tests/overthrow.test.ts tests/no-ball-extras.test.ts tests/laws.test.ts` | 49 passed, 0 failed. |
| Relevant existing suites | Command below | Initial 142 passed, 1 existing timing-sensitive timeout; isolated retry passed. Every test subsequently passed in the complete suite. |
| Complete suite | `npm.cmd test` | 181 passed, 0 failed, 0 skipped/cancelled; includes fielding, running, grounding, scoring/extras, laws, simulation, H1-H4, replay, authority, online and Duo. |
| Default production build | `npm.cmd run build` | TypeScript passed; Vite's esbuild config loader failed on sandbox parent-directory access (`Cannot read directory "..": Access is denied`). |
| Production build with native config loader | `npm.cmd run build -- --configLoader native` | Exit 0; 26 modules, Vite 7.3.7. Production JS 680.08 kB / gzip 188.57 kB. Only the existing >500 kB chunk-size advisory remains. |
| Browser smoke | `node scripts/overthrow-browser.ts` with environment below | Exit 0; all three real gameplay cases plus replay passed in Chrome 156.0.8078.81, no page errors; desktop/mobile token-fit assertions passed. |
| Diff whitespace | `git -c safe.directory=C:/Users/hp/CCL diff --check` | Exit 0; no whitespace errors. |

Relevant-suite command:

```powershell
node --test tests/core.test.ts tests/cricket-extra.test.ts tests/cricket-laws.test.ts tests/laws.test.ts tests/scorecard.test.ts tests/manual-running.test.ts tests/manual-fielding.test.ts tests/keeper-fumble.test.ts tests/no-ball-extras.test.ts tests/delivery-replay.test.ts tests/online.test.ts tests/duo.test.ts tests/authority.test.ts tests/drs-lifecycle.test.ts
```

The one initial failure was the existing `private invite reaches a two-over
score, reconstructs the sealed delivery, and settles a chase` test's 10-second
snapshot timeout. Its isolated unmodified rerun passed. The test waits for
the original ideal shot tick while the server can accept an earlier tick
after measured network-latency compensation. A temporary HEAD baseline with
a simulated 40 ms delayed pong reproduced this existing mismatch (expected
tick35, accepted tick30, same timeout). No shared source, assertion or timeout
was changed to hide it. The subsequent normal complete suite passed 181/181.

The native build fallback changes only Vite's config loading method, not the
production configuration or build contents. No permissions or package scripts
were changed. It is also the loader used by existing browser smoke scripts.

Browser command:

```powershell
$env:CCL_CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$env:CCL_SOFTWARE_GPU = '1'
node scripts/overthrow-browser.ts
```

The browser fixture uses match seed `4293693770`, naturally mapping to delivery
seed605 with Rookie AI leaving a fast ball (line .4, effort1, Rao). A temporary
production build adds a read-only observer; all setup, bowling, throws,
scorecard and replay actions use the real UI. No fake outcome or completed-run
state is injected. Auto fielding finishes82 with an incomplete attempt,
completed0, OT1 and score1/0. Keeper throw171 finishes244 with B1/OT1 and
score2/0; UI replay preserves the entire outcome and innings. Keeper throw354
finishes427 with B2/OT1 and score3/0. Rao concedes1 from0.1 overs in all three.

The final browser run exited 0 in Chrome **156.0.8078.81**, with no page
errors. It verified all three scenarios, rendered batting/penalty extras/
bowling figures, explicit overthrow callouts and delivery tokens, and exact
replay parity. The actual gameplay ribbon fits at both 1000 px and 375 px
viewport widths without text overflow or overlap. Temporary builds, browser
and server were cleaned up.
