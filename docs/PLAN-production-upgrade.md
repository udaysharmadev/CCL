# Plan — Production-grade cricket upgrade

> **Status: complete.** Every increment below was implemented and verified. The research that
> drove it, and what is still open, is recorded in
> [Phase 4: real cricket](PHASE-4-real-cricket.md).

## Task contract

```
{
  "mode": "implement",
  "objective": "Upgrade Crazy Cricket League from a solid arcade cricket game to a
                production-grade cricket simulation: real law adjudication (LBW, stumping,
                hit wicket, byes/leg byes, real wides/no-balls, free hit, overthrow/penalty
                runs), real aerodynamics and pitch behaviour, professional named fielding
                positions, per-player bowler identities with enforced rotation, a professional
                scorecard/flow/UX layer, and all previously-found bugs fixed.",
  "acceptance_criteria": [
    "npm test passes with new deterministic tests for every new law path",
    "npm run build passes strict tsc",
    "all 7 browser suites pass, and test:duo is no longer flaky",
    "no Math.random in the physics; replays remain bit-exact",
    "server cannot crash on a store.commit throw",
    "every new dismissal/extra is reachable in-game, not just in the reducer"
  ],
  "allowed_write_scope": ["src/", "scripts/", "tests/", "docs/", "index.html", "README.md", "package.json"],
  "budget": "team"
}
```

## Risk statement (stated once)

The existing build is complete and green. The single largest risk is **breaking the 31
tests, the 7 browser suites, the online server, and replay determinism** while adding
law logic. Mitigation: every increment is additive, and each increment ends with a
full verification pass (`npm test` + `npm run build` + the affected browser suite)
before the next begins. Replay determinism is protected by keeping all randomness
seeded and by keeping the reducer pure.

---

## Increment map

| # | File | What changes | Risk | Done |
|---|------|-------------|------|------|
| 1 | `src/laws.ts` **(new)** | Real cricket law adjudication: dismissal types, wide/no-ball criteria, byes/leg byes, free hit, overthrow/penalty runs, bowler rotation legality, DRS/umpire's-call model | med — new pure module, no deps | ✅ |
| 2 | `src/players.ts` **(new)** | Bowler archetypes (pace/movement/accuracy/length), batter attributes, AI bowling skill derivation | low — new pure module | ⏸ folded into `src/cricket.ts` as the named bowler and the rotation legality check |
| 3 | `src/cricket.ts` | Real aerodynamics, pitch model, named fielding positions, LBW/stumping adjudication data, byes/leg byes, late strokes | high — core sim; must stay deterministic and replay-exact | ✅ except the swing and throw model, which is deferred |
| 4 | `src/rules.ts` | Wire the new dismissals/extras/overthrow/penalty runs into the reducer; enforce bowler rotation | med — reducer is asserted by many tests | ✅ |
| 5 | `src/main.ts` | Professional scorecard, real callout language, millisecond feedback, and the bug fixes found in review | high — largest file | ✅ the scorecard, callouts and fixes; the tutorial, settings and career stats are deferred |
| 6 | `src/stadium.ts` | New named fielding positions in the renderer | med — cosmetic only | ✅ the positions; the on-field labels are deferred |
| 7 | `src/online-contract.ts`, `src/online-client.ts`, `scripts/online-server.ts` | Fix the uncaught `store.commit` crash; fix `host.url` binding; fix the 12 s < 15 s reconnect budget | med — server must stay authoritative | ✅ except the `seq` sniffing |
| 8 | `tests/*` | New deterministic tests for every new law path | low | ✅ 24 new tests |
| 9 | `docs/*`, `README.md` | Update the status doc and the README to the new feature set | low | ✅ |

## Failure-mode plan

| Step fails with | Response |
|---|---|
| `npm test` regresses | Revert that increment's `src/` change via the file-level edit, re-run, then re-approach with a narrower surface. The tests are the contract. |
| `tsc --noEmit` fails | Fix types in place; never widen with `any` — `erasableSyntaxOnly` + `strict` are on. |
| Replay determinism breaks | The culprit is almost always an unseeded `Math.random()` or a mutation of shared state inside `Delivery`. `grep -n "Math.random" src/cricket.ts` must return nothing. |
| Browser suite flakes | Fix the *test* to await DOM state rather than sampling it — do not paper over a real race with a sleep. |
| Server crashes | Wrap `publish()`/`checkpoint()` in try/catch and log. A persistence failure must degrade, not kill the match. |

## Verification chain (run at the end of every increment)

```sh
npm test          # 31 existing + new
npm run build     # tsc --noEmit + vite build
npm run test:browser   # full Solo regression
npm run test:duo       # online duo (was flaky)
npm run test:online    # 1v1 server authority
```
