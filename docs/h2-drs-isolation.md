# H2: DRS match isolation

Verified on 6 November 2026. This change addresses H2 only.

## Root cause and reproduction

The local controller held `pendingOutcome`, `reviewDeadline`, and `reviewsLeft`
as application globals. `start()` reset only the allowance. `home()` discarded
the match and delivery without clearing the pending offer or DRS presentation.
The frame loop expired offers even while paused or at home, and `applyOutcome()`
used whichever match and delivery were current when it ran.

The report's Continue listener also captured the previous outcome but used the
current global match when scoring. Its dialog, finding rows, and button survived
the match boundary. Review availability could therefore display a stale offer,
use a newer delivery's tracking, or commit an old wicket into a new match.
The review counter itself already reset correctly at match start. There was no
separate persisted review history or DRS match identifier.

Two deterministic tests executed the complete, unchanged controller before the
fix, with real scoring and review adjudication and mocked browser/platform
adapters:

1. Start Solo A, settle a caught-edge delivery, leave its review pending, call
   `home()`, start Solo B in the same controller session, and expire the offer.
2. Start Solo A, request the review, retain its Continue button, call `home()`,
   start Solo B, and invoke the retained button.

Both tests failed before the fix: B had **one wicket and one recorded delivery**
instead of zero. Both pass afterward: B remains **0/0 after zero deliveries**,
has no old offer/report, and can review its own next eligible delivery.
Normal completion/rematch and Training retry are covered separately. The leak
requires abandoning an unresolved offer/report; normal completion must first
settle the delivery.

## Implementation and lifecycle

`Match.drs` now owns the local match's active innings allowance, pending outcome,
pending delivery record, and deadline. Every `start()` creates a fresh object;
the existing second-innings transition also creates a fresh object, preserving
the original two-reviews-per-innings behavior. Pause and delivery replay do not
recreate it.

Home, new local match, and entry into online play clear the shared hint, report,
findings, and action buttons. Entering online play releases local match ownership.
Expiry and review requests consume the pending offer once and validate its
delivery record. Continue validates the owning DRS object and delivery record
before touching the dialog or score, and can commit only once. Old objects and
callbacks cannot affect a newer match or innings.

Existing review rules are unchanged: batting-side LBW and caught-edge decisions
are eligible; the offer lasts six seconds; expiry/declining do not consume an
allowance; umpire's call retains it. Existing adjudication charges every other
review, including an overturned decision. H2 deliberately preserves that rule.

Solo, Training, and Six use this controller. Quick, Private, and Duo do not
implement DRS: they use server-authoritative outcomes and have no review command
or DRS snapshot fields. Online snapshot, rematch, reconnect, saved-room, and
delivery-reconstruction contracts remain unchanged.

Active local matches/DRS are not saved or recovered. Local storage contains
settings, lineup, career, and Six best records. Online recovery retains its
authoritative score and delivery state; no persistence migration or legacy-data
change is necessary.

## Files changed for H2

| File | Purpose |
| --- | --- |
| `src/main.ts` | Match-owned DRS lifecycle, presentation cleanup, delivery ownership checks, single-use report continuation. |
| `tests/drs-lifecycle.test.ts` | Deterministic tests of the actual controller and its registered callbacks; no production test hooks. |
| `scripts/drs-browser.ts` | Seeded browser smoke using real gameplay, visible timing cues, and virtual browser time. |
| `docs/h2-drs-isolation.md` | Reproduction, lifecycle findings, coverage, and verification record. |

Pre-existing edits to online replay/server/contracts and their tests were retained;
they are not part of H2.

## Regression coverage

All tests below are in `tests/drs-lifecycle.test.ts`; the outcome and online-mode
rows are parameterized into separate named tests (20 tests total).

| Test/scenario | Defect or behavior protected |
| --- | --- |
| Pending review across Home and new match | A's expiry cannot score in B; B can review normally. |
| Retained Continue across matches | A's callback cannot score into B. |
| Fresh Solo, Training, Six | Two reviews, no deadline/pending outcome/report/actions. |
| Previous upheld review | Consumed allowance and report do not leak. |
| Previous overturned review | Correct decision and existing allowance rule, then fresh B. |
| Previous umpire's-call review | Retained allowance and correct decision, then fresh B. |
| Multiple/exhausted reviews and restart | Exhaustion persists within innings; new match replenishes it. |
| Direct restart with pending deadline | Advancing past A's deadline leaves B untouched. |
| Same-match expiry | Scores once, only after the deadline, without spending a review. |
| Accept on-field decision | Clears offer and scores without spending a review. |
| Repeated Continue | A report cannot score twice. |
| Old callback while B's report is open | Cannot close or commit the newer report. |
| Replay and pause | Preserve same-innings allowance and score. |
| Innings transition and completed Solo rematch | Same match at innings change, allowance reset, fresh rematch and working DRS. |
| Completed Training and Practice again | Normal completion/retry creates a fresh lifecycle. |
| Retained match-state isolation | Mutating B does not alter A's retained DRS state. |
| Quick snapshot/reconnect/rematch | Stale local review cannot modify authoritative state. |
| Private snapshot/reconnect/rematch | Same-match score retained; fresh online rematch unaffected. |
| Duo snapshot/reconnect/rematch | Same authority/isolation guarantees in cooperative mode. |
| Pending local deadline during online resume | Expiry cannot score against the recovered online state. |

## Verification

- Strict TypeScript: `node node_modules/typescript/bin/tsc --noEmit` passed.
- New H2 regression suite: 20 passed, 0 failed.
- Focused existing DRS laws and core gameplay plus H2:
  `node --test tests/drs-lifecycle.test.ts tests/laws.test.ts tests/core.test.ts`
  passed 47 tests, 0 failed.
- Full suite: 133 passed, 0 failed, 0 skipped via the existing `npm test` script.
  This includes the existing DRS law, simulation/scoring, match lifecycle,
  online reconnect/restart/legacy-replay, and Duo suites.
- Production: the existing build script passed with `--configLoader native`:
  strict TypeScript plus Vite 7.3.7, 26 modules transformed. Vite reported its
  non-failing warning for a JavaScript chunk larger than 500 kB.
- Environment: the default npm shim points to a missing roaming installation,
  so scripts were invoked with
  `node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js"`.
  Vite's default config bundler was blocked from reading the parent directory;
  the native loader uses the same config without that directory scan. No
  project configuration or dependency changes were required.
- Browser smoke: `node scripts/drs-browser.ts` passed in full (exit 0) on
  Chromium 156.0.8078.81 with no page errors. It verified pending Solo review
  abandonment followed by a new match's own review, open-report abandonment
  followed by a fresh Training review, and a completed six-ball Training drill
  followed by Practice again and a valid new review in the same page.
  The run used `CCL_CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe`
  and `CCL_SOFTWARE_GPU=1`, virtual browser time, and saved low graphics settings.
  Solo uses seed 0's first-ball caught edge. Training explicitly advances seed 0's
  first dot ball to its second-ball LBW, avoiding reliance on auto-next.
  The report-abandonment scenario dispatches a visibility event to exercise the
  real pause handler. No production state hooks or injected outcomes are used.

No scoring rules, delivery physics, probabilities, UI design, networking
contracts, persistence formats, or PRD were changed. Local behavior changes are
limited to DRS lifecycle cleanup and rejecting stale/repeated review actions.
There is no local saved-match DRS recovery feature to verify.

The browser check exposed an unrelated existing input limitation: when a caught
review leaves the controller in `flight`, the playfield's pointer capture can
swallow a mouse click on its child review button. The report remained closed
with the offer still visible, two reviews available, and an unchanged 0/0 score.
The pointer handler is identical to repository HEAD and was not changed for H2.
The Training smoke uses the supported V shortcut and asserts that the report
opens; it does not force DOM callbacks or inject review outcomes.

The successful browser run cleaned up its temporary build. One build directory
from an interrupted diagnostic run remains at
`C:\Users\hp\AppData\Local\Temp\ccl-drs-browser-0QNi8k`: automatic approval
review failed while authorizing its removal (review-system error, not an unsafe
action finding). The workspace-only diagnostic script was removed separately.
