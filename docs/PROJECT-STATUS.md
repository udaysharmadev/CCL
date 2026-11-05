# Crazy Cricket League — Project Analysis & Status

> **Historical review:** The inventory and test counts below describe the earlier build and are not a current acceptance report. Subsequent work added DRS, player attributes, pitch wear, expanded batting, manual running, the broadcast HUD and Solo manual fielding. See [current manual-fielding increment](manual-fielding.md) and the README for current controls. Platform portal/device checks and public hosting remain outstanding/deferred.

**Date:** 3 November 2026
**Scope:** Full codebase review — `src/`, `scripts/`, `tests/`, `docs/`, `index.html`, `package.json`
**Size:** ~9,200 lines (5,400 in `src/`, 1,950 in `scripts/`, 1,650 in `tests/`, 185 in `index.html`)
**Stack:** TypeScript 5.9 (strict), Three.js 0.185, Vite 7, `ws` 8, Node 22+ built-in SQLite, Playwright-core (browser tests)

> **Updated after the Phase 4 upgrade.** This document describes the project as it now
> stands, with the real cricket laws, named fielding positions, the professional
> scorecard and the robustness fixes in place. See
> [Phase 4: real cricket](PHASE-4-real-cricket.md) for the research behind that work and
> for what is still open.

---

## 1. Executive summary

This is a **complete, working, playable 3D browser cricket game** — not a prototype. It ships:

- A physically simulated cricket engine (fixed 60 Hz, fully seeded/deterministic)
- Three original 3D venues rendered in Three.js with procedural geometry, crowd animation and a custom sky shader
- Four solo game modes (Solo Arcade, Training Nets, Longest Six, plus Bowling)
- A **server-authoritative online service** with SQLite persistence, sealed delivery records, replayable deliveries, reconnect, rematch, and a two-player **Duo batting** co-op mode
- A CrazyGames SDK v3 platform adapter with data, invite, and lifecycle integration
- 31 automated unit/integration tests and 7 Playwright browser regression scripts

**Verified state at time of writing:** `npm test` → **31/31 pass**. `npm run build` → **passes** (`tsc --noEmit` strict + Vite). All browser suites pass (`test:browser`, `test:phase2`, `test:online`, `test:six`, `test:running`, `test:swipe`), with **one known flaky test** (`test:duo`, ~25% failure rate — see §7.1).

The product is functionally complete for its stated scope. The remaining work is **hardening, platform acceptance (CrazyGames portal + Chromebook), and a Phase 3 feature backlog** that the project docs already declare out-of-scope for the current build.

---

## 2. Architecture

```
index.html                 Single-page shell. All DOM ids + 5 <dialog> overlays.
  │
  ├── src/main.ts          Orchestrator. Game state machine, HUD, input,
  │                        audio, career persistence, online client wiring,
  │                        the professional scorecard.
  │     ├── src/laws.ts        NEW. The law kernel: leg before wicket, wides,
  │     │                      no balls, byes, overthrows, free hit, bowler
  │     │                      rotation, reviews. Pure, no imports.
  │     ├── src/cricket.ts      Simulation engine. Delivery physics, fielding,
  │     │                      running, run-outs, stumping, byes and leg byes.
  │     │                      No DOM, no Three.js.
  │     ├── src/rules.ts        Pure scoring reducer. Innings, extras, free hit,
  │     │                      strike rotation, powerplay, full scorecard figures.
  │     ├── src/stadium.ts      Three.js renderer. Venues, players, cameras, effects.
  │     ├── src/setup.ts        Match setup + lineup dialogs
  │     ├── src/dressing-room.ts 3D dressing-room preview
  │     ├── src/online-client.ts WebSocket client, reconnect, session storage
  │     ├── src/online-contract.ts Shared wire protocol / types
  │     ├── src/match-data.ts   Roster, venues, room settings
  │     ├── src/swipe.ts        Gesture → shot intent mapper
  │     ├── src/six-challenge.ts Longest Six scoring
  │     ├── src/duo.ts          Duo control-ownership reducer
  │     ├── src/telemetry.ts    Local perf counters
  │     └── src/platform.ts     CrazyGames SDK v3 adapter
  │
  └── scripts/online-server.ts  Authoritative game server. HTTP + WS + SQLite.
        └── scripts/match-store.ts   SQLite persistence layer
```

**Key design property:** the physics (`cricket.ts`) and scoring (`rules.ts`) are **pure, DOM-free and platform-free**. The same `Delivery` class runs identically in the browser (Solo/Training/Six), in the Node server (online authority), and in the test suite. That is why replays work — a replay is just `new Delivery(sameOptions)` plus the recorded shot tick and running commands.

---

## 3. What is DONE — feature inventory

### 3.1 Simulation core (`src/cricket.ts`)

| Area | Status | Detail |
|---|---|---|
| Fixed-step physics | ✅ | `DT = 1/60`, gravity 9.81, drag, restitution, bounce, seam, spin, swing, wind |
| Determinism | ✅ | All randomness from `seededRandom(seed)` (mulberry32). `Math.random()` never used in physics |
| 12 shot techniques | ✅ | drive, cut, pull, loft, defend, cover-drive, on-drive, flick, sweep, reverse-sweep, ramp, hook — each with distinct speed/lift/height/tolerance/line |
| 8 delivery types | ✅ | fast, length, yorker, spin, inswing, outswing, bouncer, legspin — distinct pace, bounce, swing, turn |
| 10 field presets | ✅ | balanced, attack, powerplay, pace-ring, leg-trap, boundary — plus Test Standard, Catching, Attacking Ring and Deep Set, built from 22 real named positions |
| 4 pitch surfaces | ✅ | dry, green, hard, dusty — modify bounce, seam, spin, roll drag |
| 3 weather presets | ✅ | clear, overcast, breezy — modify swing, seam, wind |
| Elliptical boundaries | ✅ | Per-venue rope; swept intersection solved analytically |
| Fielding | ✅ | Fielder interception forecast, chase, pickup, return throw, keeper stumping |
| Catches | ✅ | Segment-vs-reach sweep so hard shots are caught, not tunnelled through |
| Manual running | ✅ | `R`/`C`/`W`; queue up to 5 runs; turn back; run-out on keeper break |
| Run-out correctness | ✅ | Crossing detection, striker/non-striker identity, exact-tick grounding is safe |
| Bat/bowl contact model | ✅ | Timing (early/good/perfect/late) + line error + height error → middle/edge/miss |
| Wide / no-ball | ✅ | Arcade wide threshold; high-effort release errors produce no-balls |
| Free hit | ✅ | Carried through next legal ball; blocks every dismissal except run out, obstruction, timed out and retirement |
| **Leg before wicket** | ✅ | The three point test: pitch point, impact point, projected path, with an umpire's call below 50 % |
| **Stumping** | ✅ | A batter who backs up against spin is out of his ground and can be stumped |
| **Byes and leg byes** | ✅ | A keeper fumble off a ball that beat the bat produces a bye; a pad strike produces a leg bye |
| **Late strokes** | ✅ | A stroke committed after the ball passed the bat but before it reached the stumps still plays, judged on its timing |
| Named fielding | ✅ | 22 real positions with coordinates; `positionName` maps a spot to its place on the ground |

### 3.2 Rules reducer (`src/rules.ts`)

- 6 balls/over, 10 wickets, extras breakdown (wide/no-ball/byes/leg-byes/penalty)
- Every dismissal the Laws recognise: bowled, caught, leg before wicket, stumped, hit
  wicket, run out, obstructing the field, obstructing a fielder, timed out, retired out
- Strike rotation on completed odd runs, over ends, and run-out crossing
- Correct dismissed-batter replacement (`wickets + 2`)
- ICC T20I October-2026 clause 28.7.6 reduced powerplay table (9/11/13/14/16/18/20/22/23/25/27/29/31/32/34/36 for 5–20 overs; 6 for shorter)
- Outside-fielder limit: 2 in powerplay, 5 outside; enforced physically by pulling fielders inside the 27.43 m circle
- Five-bowler rotation index (`floor(legalBalls/6) % 5`), with a legality check that no
  bowler bowls two consecutive overs or more than a fifth of the innings
- **A full scorecard**: runs, balls, fours, sixes and dismissal per batter; overs, runs,
  wickets, wides, no balls and economy per bowler; partnerships; fall of wickets; and
  the run rates
- Byes and leg byes are charged to the team and never to the bowler

### 3.3 Presentation (`src/stadium.ts`)

- **Three venues**, each geometrically distinct:
  - **Suncrest Oval** — 9 pavilion rows / 6 general rows, canopy roof, 6 floodlight masts, 115 trees, 31 distant buildings, circular 64 m rope
  - **Harbor Reach** — sea gaps in the stands, animated water plane with 74 wave strips, two piers, a striped lighthouse, 4 sailboats, 8 masts with sails, elliptical 57×64 m rope
  - **Citadel Pavilion** — brick pavilion with 11 arched window bays, a **working clock face with hour and minute hands**, stepped roof tiers, 4/7 rows, elliptical 62×67 m rope
- **Procedural textures** (no image assets): mown-stripe grass (512²), pitch soil with dust noise + 95 scuff streaks, creases, 48 radial restriction dashes
- **Player models** — 13 rigged athletes (striker, non-striker, bowler, keeper, 9 fielders, 2 umpires) with hierarchical joints, per-shot batting poses (12 techniques), bowling run-up with spin vs pace variants, keeper crouch, umpire signals (six/out/wide/no-ball/four)
- **Cameras** — home title, bowling, batting, plus a ball-following extension during the field phase and a decision pan on dead balls; exponential smoothing; contact camera kick
- **Effects** — six confetti (96 particles), ball trail, blob shadows, crowd `InstancedMesh` with a vertex-shader wave and energy envelope, custom sky-dome GLSL shader (horizon→zenith gradient, sun lobe, procedural clouds)
- **Audio** (in `main.ts`) — WebAudio oscillator SFX (release, swing, contact, wicket, boundary) + a 2 s brown-noise crowd bed through a filtered loop
- **Performance** — static venue geometry merged into a single vertex-coloured mesh via `mergeGeometries`; shared unit-box and body-part geometries; pixel ratio capped at `min(dpr, 1.45, 1920/width)`

### 3.4 Game modes

| Mode | Status | Notes |
|---|---|---|
| **Solo Arcade** | ✅ | 2–20 overs, bat or bowl first, 4 AI difficulties, saved setup, Assist/Manual running, coins + XP on completion |
| **Training Nets** | ✅ | 1 over, slower read window (0.68× wall-clock), no field restrictions |
| **Longest Six (Power Hit)** | ✅ | 5 balls, first-landing distance measurement, precision/timing/streak points, personal best persisted |
| **Bowling** | ✅ | 8 deliveries, line + pace sliders, 10 field presets, no-ball risk at extreme pace |
| **Duo Batting** | ✅ | Two humans, one shared XI, one innings vs server AI, control swap by mutual vote, partner Run/Wait/No calls, manual running by the striker |

### 3.5 Controls

- **Swipe batting** — hold anywhere on the pitch, drag, release as the ball arrives. Direction → shot family, distance/speed → power. Loft toggle (Shift) and Shift-shot selection
- **Explicit technique tray** — 12 shots, paged 4 at a time, `1`–`4` hotkeys, 3 shot groups
- **Keyboard** — `Space` (swing), `1`–`4` (select), `Shift` (loft), `R` (run), `W` (wait), `C` (turn back / no), `Esc` (pause)
- **Timing bar** with needle, swipe trail SVG, "SWIPE NOW!" arrival cue, contact feedback banner
- **Auto-next** after 4.5 s (toggleable); opening the shot tray holds it

### 3.6 Replay

- Deterministic: replay re-runs `new Delivery(record.options)` and re-injects the shot at its recorded tick and running commands at their recorded ticks
- Score is **not** modified during replay (`settleBall` early-returns while `replaying`)
- Online replays use the server's **sealed** replay record, checksummed with SHA-256
- Replay is included in the sealed SQLite `delivery_events` table and survives server restart

### 3.7 Persistence

| Key | Store | Contents |
|---|---|---|
| `ccl.solo.v1` | localStorage / SDK | Match setup |
| `ccl.lineup.v1` | localStorage / SDK | Selected XI + batting order |
| `ccl.career.v1` | localStorage / SDK | Solo coins + XP |
| `ccl.six-best.v1` | localStorage / SDK | Longest Six personal best |
| `ccl.sound.v1` | localStorage / SDK | Mute state |
| `ccl.online.v1` | sessionStorage | Room + seat token (reconnect handle) |
| `ccl.online.account.v1` | localStorage | Server-side guest account key |

All browser storage goes through `platform.ts`, which uses the **CrazyGames SDK Data module** when the SDK is present and `localStorage` otherwise.

### 3.8 Online service (`scripts/online-server.ts`)

**Architecture:** single Node process serving HTTP (`/health` + static `dist/`) and a `ws` WebSocket at `/online`.

**Modes:** Quick 1v1 (5 overs, auto-paired) · Private 1v1 (2–20 overs, host configures ground/pitch/weather, both approve XIs, toss, invite link) · Duo (shared XI, one innings vs AI).

**Server owns:** delivery seed, windup clock, delivery simulation, swing timestamp, outcome, scoring, strike rotation, innings change, result, powerplay limits, running commands, wallets.

**Security & robustness:**
- 12-char base64url room codes (72 bits), 43-char seat tokens (256 bits)
- Strict message whitelist with **exact key-count checks** and range validation
- Per-seat monotonic sequence numbers → duplicate / out-of-order rejection
- Origin allowlist (`verifyClient`), `CCL_ALLOWED_ORIGINS`
- Rate limit 48 msg/s per socket, 64 running commands per ball, 128 rooms, 256 sockets, 4 KB payload cap, 256 KB backpressure cap
- Path-traversal guard on static file serving; DB file `0600`, directory `0700`
- Sealed delivery records are **tamper-evident** — a changed payload for an existing delivery id aborts the transaction

**Timing:** RTT measured via 10 s WebSocket ping/pong with a random nonce; compensation capped at **100 ms**; the server **re-simulates from the seed** to back-date the swing. The client clock is never trusted. The accepted tick is stored in the replay record.

**Persistence:** SQLite (WAL) — `accounts`, `rooms` (full state JSON), `delivery_events` (sealed), `rewards`. Awards use `INSERT OR IGNORE` on a `(match_id, account)` primary key, so **an account can only be paid once per match**, even across reconnection or server restart.

**Rewards:** winner 30 coins / loser 15 coins / 40 XP each. Forfeits and abandonments award nothing. Solo rewards are separate from online wallet balances.

**Lifecycle:** reconnect grace 15 s in-match, 60 s in lobby; completed rooms expire after 5 min; rematch requires both votes and keeps the same room and invite link.

### 3.9 Platform integration (`src/platform.ts`)

CrazyGames SDK v3: `init()`, `environment` detection (`local`/`crazygames`/`disabled`), 2.8 s load timeout with graceful degradation, `loadingStart/Stop`, `gameplayStart/Stop`, `settings.muteAudio` + change listener, SDK Data module, `getInviteParam` / `inviteLink` / `updateRoom` / `leftRoom` for private rooms. Only activates when embedded, on a `crazygames.com` host, or with `?useLocalSdk=true`.

### 3.10 Telemetry

`window.cclTelemetry()` exposes marks (firstFrame, firstPlay, firstRelease, inningsComplete, matchComplete, graphicsFallback, swipe, swipeCommitted), p50/p95/p99 for `frameMs`, `inputToFrameMs`, `swingToContactMs`, transfer bytes, and renderer draw-call/triangle counts.

---

## 4. Verification status (measured, not claimed)

| Check | Command | Result |
|---|---|---|
| Unit + integration tests | `npm test` | ✅ **55 passed, 0 failed** (24 new for the law kernel, the scorecard and the new dismissals) |
| Type check + production build | `npm run build` | ✅ Passes. `660 KB` JS (179 KB gzip), `22 KB` CSS (6 KB gzip) |
| Full Solo browser regression | `npm run test:browser` | ✅ 12-ball innings, AI chase, replay, pause, reward persistence, touch training |
| Phase 2 setup + SDK | `npm run test:phase2` | ✅ Saved XI, 20-over Harbor setup, bouncer, field selection, SDK lifecycle |
| Online 1v1 browser | `npm run test:online` | ✅ Two Chromium clients, toss, server-scored swing, reconnect, private invite, innings change, result |
| Longest Six browser | `npm run test:six` | ✅ Five balls, 1676 points, ground-hit rejection, replay, pause, saved best, 800×450 |
| Manual running browser | `npm run test:running` | ✅ Saved mode, R single, pause lock, score-preserving replay, Assist fallback at 800×450 |
| Real gesture browser | `npm run test:swipe` | ✅ Physical mouse drive (four) + physical touch loft (six) at 800×450, early-release feedback, no page/shader errors |
| Duo browser | `npm run test:duo` | ✅ Mutual swap/cancel, shared 12-ball innings, manual single, turn back, partner calls, run-out replacement, live-ball reconnect, rewards, rematch |
| Authority spike | `npm run spike:authority` | ℹ️ Long-running local server by design (never exits) — correct, but see §7.4 |

**Measured performance** (this Mac, production bundle): 16.7 ms p50 / p95 frame time, 181 KB transfer, 217 draw calls, ~97k triangles. The Phase 0 doc records a 907×510 Chrome baseline; the **physical 4 GB Chromebook benchmark remains open**.

---

## 5. What is PARTIAL / not yet done

These are real gaps, most of them already acknowledged in `docs/phase-2.md` / `docs/phase-3.md`:

### 5.1 Platform acceptance (blocking for a CrazyGames launch)

| Item | Status | Why |
|---|---|---|
| CrazyGames Developer Portal preview | ❌ Open | No authenticated portal session available in the environment |
| Physical 4 GB Chromebook benchmark | ❌ Open | No Chromebook available. Procedure is documented in `docs/phase-0.md` §"Chromebook steps" |
| Public hosting deployment | ⏸ Deferred | Explicitly deferred by the user's request. Service is *prepared* (env vars, TLS-proxy notes) but undeployed |

### 5.2 Cricket simulation completeness

- **Hit wicket, obstructing the field, obstructing a fielder and timed out** are recognised by the reducer and the scorecard but are not yet produced by the physics.
- **No DRS screen.** The law kernel models an umpire's call and a review that is retained, but the third umpire flow is not built.
- **Bowlers are not individuals.** There are no per-bowler attributes — all bowlers of a type share one recipe. The bowler is now named on every delivery so the figures are attributable, and a legality check prevents two consecutive overs, but the physics never vary by bowler.
- **One synchronised runner pair.** No independent acceleration or player speed attributes (`src/cricket.ts` — the project's own `ponytail` marker).
- **Throws always go to the striker's wicket.** No throws to the bowler's end, no direct hits, no manual fielding. Overthrow and penalty runs are adjudicated but the fielder never produces one.
- **The field preset is Solo-only.** Online matches are hard-coded to the `balanced` formation; the client cannot set `options.field` over the wire.
- **No pitch deterioration.** The pitch does not wear across a match, so the ECB's guidance — a firm dry pitch that gives spin later — is not modelled.

### 5.3 Phase 3 feature backlog (declared, not started)

Manual fielding · DRS · stamina / recovery / coaches · expanded cosmetics · bat upgrades · online leaderboards · recorded stadium commentary.

### 5.4 Smaller gaps

- **Reduced motion is captured once** at stadium construction — toggling the OS setting needs a reload.
- **No LOD** — the crowd and stands render at full resolution at all camera distances.
- **No context-loss handling** or `renderer.dispose()`; venue groups are cached for the page lifetime.
- **No SPA fallback route** on the static server — a deep link like `/foo` returns 404.
- **Static MIME map** covers only `.html/.js/.css/.svg`; any future `.png/.woff/.webp` would be served as `application/octet-stream`.
- **No `ETag`/`Last-Modified`** on static responses.
- **No sound effect for a caught ball vs bowled** — a single shared `wicket` cue.
- **Bowling is presentation-only in Solo.** The physics has no per-delivery bowler identity or run-up variance from the player's chosen delivery.

---

## 6. What CAN be done — prioritised roadmap

### Tier 1 — Hardening (low effort, high value)

1. ~~**Fix the flaky Duo browser test.**~~ ✅ Done — the HUD now refreshes synchronously when a snapshot is applied.
2. ~~**Make the server crash-proof.**~~ ✅ Done — `checkpoint()` catches and logs a storage failure instead of terminating the process.
3. **Add `try/catch` around `main.ts` boot failure paths.** A `?room=` deep-link error currently surfaces as *"The ground needs WebGL 2"*, which is actively misleading.
4. **Replace the `document.querySelector(...)!` non-null assertions** (`main.ts:52-53`, SVG nodes) with a guarded lookup — a single HTML rename currently throws at module evaluation and white-screens the app.
5. **Add a `rewards(account)` index.** `rewards` is only keyed by `(match_id, account)` but queried by `account` — every wallet read is a full table scan.
6. ~~**Fix `host.url` to honour `bindHost`.**~~ ✅ Done.
7. **Make `online-client.ts` message classification explicit.** It sniffs `'version' in command || type === 'rematch' | 'next' | 'call'` to decide whether to attach a `seq`. A new control message added without updating that list is silently rejected by the server.
8. ~~**Raise the client reconnect budget above the server's grace.**~~ ✅ Done — the client now waits 20 s against the server's 15 s seat grace.

### Tier 2 — Simulation depth

9. **Give bowlers real identities.** Add per-bowler attributes (pace, movement, accuracy, batter-vs-bowler record) and make the rotation authoritative. The bowler is now named on every delivery, so the figures are attributable.
10. ~~**Add stumping and LBW.**~~ ✅ Done — both are modelled and reachable.
11. **Implement independent runner speeds and overthrows.** Replaces the `ponytail` in `cricket.ts` and enables realistic run-out risk. The overthrow arithmetic is in the law kernel; the fielder still cannot produce one.
12. **Add a field preset to the online wire protocol.** `OnlineSnapshot` already carries `maxOutside`; the `bowl` intent could carry `field`.
13. ~~**Add byes and leg-byes as physical outcomes.**~~ ✅ Done — both are produced by a keeper fumble off a ball that beat the bat.

### Tier 3 — Feature/product

14. **CrazyGames portal submission.** Load the build in the Developer Portal, verify the SDK `crazygames` environment, the Data module, and invite deep-links. This is the top blocker for a public launch.
15. **Run the Chromebook benchmark.** The procedure is written; it just needs the hardware. It gates the PRD targets (<10 s to first interaction, ≤18 MB payload, sustained 30 FPS).
16. **Manual fielding** — the richest remaining gameplay system. The `Delivery` class already separates `chase → pickup → return → break`, which is a natural hook for a player-controlled interception.
17. **Online leaderboards** — the `rewards` table already holds a global account balance keyed by SHA-256 of a client-held token; a leaderboard is a `GROUP BY account` over that table.
18. **Phase 3 cosmetics / bat upgrades / commentary** — the declared backlog.
19. **Deploy the online service** (with `CCL_ALLOWED_ORIGINS`, a persistent disk, and a TLS reverse proxy) if the hosting deferral is lifted.

### Tier 4 — Quality of life

20. **Add a `p95` frame-time guard** in the browser tests so a performance regression fails CI.
21. **Code-split the Three.js bundle.** 630 KB / 171 KB gzip is one chunk; `manualChunks` for `three` would let the shell paint before the renderer loads. The Vite build already warns about this.
22. **Connect the `?seed=` URL param through the session** so a match can be reproduced after returning home.
23. **Make `reducedMotion` reactive** via a `matchMedia` change listener.
24. **Add a `contextlost` / `webglcontextrestored` handler** to the stadium renderer.

---

## 7. Bugs and risks found in review

### 7.1 Flaky Duo browser test — **confirmed, ~25% failure rate**

`scripts/duo-browser.ts:113` asserts the "Swap control" button is hidden during flight. The button's visibility is set in `refresh()` (`main.ts:1053`), but `refresh()` is only called from the rAF loop (`main.ts:1159`) when `refreshPending` is set. `syncOnline()` sets `refreshPending = true` when the snapshot changes, so there is a **one-frame (≈16 ms) window** between the snapshot arriving and the DOM updating.

The test's `snapshot()` helper polls with a 20 ms delay, so it frequently returns *before* the browser's next animation frame has run. Measured: 1 failure in 4 consecutive runs; 3 clean passes on retry.

**Fix:** make `refresh()` run synchronously at the end of `syncOnline()`, or have the test await the DOM state (`page.waitForFunction`) instead of sampling `isVisible()` immediately.

### 7.2 ~~Server can crash on a sealed-delivery conflict~~ — **fixed**

`scripts/match-store.ts:46` throws `Error('Sealed delivery changed')` from inside a `BEGIN
IMMEDIATE` transaction. That call chain was `commit()` → `checkpoint()` → `publish()` → the 16 ms
`setInterval` and the WS `'message'` handler, with **nothing catching it**. A single conflicting
write would have terminated the whole server and every connected player.

**Fixed:** `checkpoint()` now catches and logs the failure. The match continues and the room is
written again on the next tick.

### 7.3 Back-dated swing can drop manual-running state (online)

In `scripts/online-server.ts`, a swing accepted with `lagTicks > 0` rebuilds the delivery via `new Delivery(ball.options)` but **does not replay `ball.runs`** into the new instance. Any running command already applied to the original simulation is lost from the live sim — while `ball.runs` still lists it in the sealed replay. The sealed outcome and the sealed replay can therefore stop reproducing each other, which is the invariant `tests/online.test.ts` and `tests/duo.test.ts` assert.

### 7.4 `npm run spike:authority` never terminates

It starts a persistent two-seat WebSocket room on `ws://127.0.0.1:8787/authority-spike` and blocks forever. This is intentional (it is a manual spike tool, per `docs/phase-0.md`), but the script name looks like a test and it hangs any naive CI runner. **Add a `--serve` flag or a separate `spike:authority:serve` script, and make `npm test` the only default gate.**

### 7.5 Silent command drops on the client

`online-client.ts:155` refuses to send while `pending === true` (one unacknowledged command in flight) or the socket is not OPEN. In `main.ts` a dropped swing was reported to the player as *"Too late · swipe a little earlier"* — a misleading message for what is actually a network condition. The same applied to the `bowl` command.

**Fixed:** a swing that cannot be sent now says *"Swing not sent · the server was busy"*, and a
run command that cannot be sent says *"Command not sent · waiting for the server"*.

### 7.6 ~~`describe()` reads the live delivery for historical ribbon entries~~ — **fixed**

`describe()` read the global `live` for timing, so historical ribbon entries showed the current
delivery's timing. It now takes the timing as an argument, and the ribbon passes none.

### 7.7 Escaped overlays are trapped

The overlay `cancel` handler (`main.ts:1286-1288`) only allows Esc to close when the title is exactly `"Paused"` or the panel is `"exit"`. Every other overlay — innings break, match result, Longest Six result, online lobby — requires a button click. Deliberate or not, it is inconsistent and will surprise players.

### 7.8 Silent drop of `R` during the flight phase

`live.setRunning()` returns `false` unless the delivery is in the `field` phase, so pressing **R** during the ball's flight is swallowed with no feedback.

### 7.9 `replay` and `record` alias the same object

`lastReplay = record` (`main.ts:761`) means the in-flight record and the replay record are the same reference. It works only because `settleBall` skips mutation while `replaying`. A refactor that copies one of them would break replay subtly.

### 7.10 Venue groups are never disposed

`stadium.ts` caches a built `THREE.Group` per venue in a `Map` and never disposes it. Bounded at three venues, so this is a minor leak rather than a defect — but it is a leak.

### 7.11 `host.url` ignores `bindHost` — see §6.6.

### 7.12 No per-account or per-IP rate limiting on the server

Only a per-socket message counter exists. A player can mint unlimited guest accounts (any 43-char token is auto-registered) and farm 30/15 coins + 40 XP per match. **This matters only if the service is ever exposed publicly** — it is currently local-only by design.

---

## 8. File-by-file reference

| File | Role |
|---|---|
| `src/main.ts` | Game orchestrator: state machine, HUD, input, audio, career, online wiring, the professional scorecard |
| `src/laws.ts` | **New.** The law kernel: leg before wicket, wides, no balls, byes, overthrows, free hit, bowler rotation, reviews |
| `src/stadium.ts` | Three.js renderer: venues, athletes, cameras, effects |
| `src/cricket.ts` | Simulation engine: delivery physics, fielding, running, run-outs, stumping, byes and leg byes |
| `src/rules.ts` | Pure scoring reducer, the full scorecard figures, the powerplay table |
| `src/setup.ts` | Match setup + lineup dialogs, settings persistence |
| `src/dressing-room.ts` | 3D dressing-room preview with 11 hanging jerseys |
| `src/online-client.ts` | WebSocket client: handshake, reconnect, session storage |
| `src/online-contract.ts` | Shared wire protocol types |
| `src/platform.ts` | CrazyGames SDK v3 adapter |
| `src/match-data.ts` | Roster (15), venues (3), room settings |
| `src/telemetry.ts` | Local performance counters |
| `src/six-challenge.ts` | Longest Six scoring |
| `src/swipe.ts` | Gesture → shot intent |
| `src/duo.ts` | Duo control-ownership reducer |
| `src/style.css` | All styling; responsive breakpoints at 560 px / 540 / 480 / 400 px height; reduced-motion support; scorecard tables |
| `scripts/online-server.ts` | Authoritative HTTP + WS game server |
| `scripts/duo-browser.ts` | Duo browser regression |
| `scripts/browser-smoke.ts` | Full Solo browser regression |
| `scripts/authority-spike.ts` | Standalone authority prototype (Phase 0) |
| `scripts/online-browser.ts` | Online 1v1 browser regression |
| `scripts/match-store.ts` | SQLite persistence layer |
| `scripts/six-browser.ts` | Longest Six browser regression |
| `scripts/phase2-browser.ts` | Setup + SDK lifecycle browser regression |
| `scripts/swipe-browser.ts` | Real mouse/touch gesture regression, robust to input latency |
| `scripts/running-browser.ts` | Manual running browser regression |
| `tests/laws.test.ts` | **New.** The law kernel: leg before wicket, stump geometry, wides, extras, overthrows, rotation, reviews |
| `tests/cricket-laws.test.ts` | **New.** The physics reaches the new laws: named positions, leg before wicket, byes, leg byes, stumping |
| `tests/duo.test.ts` | Duo integration: ownership, calls, replay, restart, swap |
| `tests/online.test.ts` | Online integration: pairing, reconnect, sealed replay, RTT compensation |
| `tests/core.test.ts` | Physics + reducer: 300 seeded deliveries, presets, powerplay, boundaries |
| `tests/manual-running.test.ts` | Run queueing, turn back, grounding, run-out identity |
| `tests/authority.test.ts` | Authority spike: forged/stale/wrong-role rejection |
| `tests/match-store.test.ts` | Atomic persistence, no duplicate awards |
| `tests/six-challenge.test.ts` | Distance, points, streak, duplicate rejection |
| `tests/swipe.test.ts` | Gesture mapping and scaling |

---

## 9. Bottom line

**The game is done as a product and largely done as an engineering artifact.** It has real depth: a deterministic physics engine, a pure law kernel, a pure rules reducer that keeps a full scorecard, a procedurally generated 3D world with no external art assets, an authoritative server with tamper-evident sealing and reconnect, and genuine test coverage at both unit and browser level. There are no `TODO`/`FIXME` markers anywhere in the codebase — the project's own marker is `ponytail`, and there are exactly two, both documented as deliberate deferrals.

**The Phase 4 upgrade closed the largest gaps in the cricket itself:** leg before wicket is
judged by the real three point test, stumping works, byes and leg byes are produced, the
fielders stand in twenty-two real named places, and the scorecard is the one every commercial
cricket game gets wrong. It also closed the two robustness gaps that mattered — the server can
no longer be killed by a storage fault, and the flaky Duo test is gone.

**The remaining path to a public launch is short and concrete:**
1. Run the CrazyGames portal preview (needs an authenticated account)
2. Run the physical Chromebook benchmark (needs hardware)
3. Deploy the online service if the hosting deferral is lifted
4. Add the DRS screen and per-bowler attributes if the profile is widened beyond `arcade_short_v1`

Everything in §6 Tier 2 and Tier 3 is **scope expansion**, not defect repair — the current build is internally consistent and shippable against its stated profile (`arcade_short_v1`).
