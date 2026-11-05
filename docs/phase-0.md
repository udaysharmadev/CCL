# Phase 0 engineering notes

## Title search

**Crazy Cricket League** is the local build title selected on 3 November 2026. The exploratory search found prior use of the exact title in games. APKPure lists *Crazy Cricket League* under WanderMind Labs and links it to Android package `com.amitrane.ccleague`. A search-indexed Australian Classification result also showed an exact-title computer game rated General on 31 May 2015. The classification link is a paginated index whose results can shift. Current storefront availability and trademark status are unverified. [APKPure publisher cross-listing](https://apkpure.net/star-cricket-2022/com.wmlabs.starcricket) · [Australian Classification index](https://www.classification.gov.au/classification-ratings/latest-classification-decisions?f=&page=184259)

Other results included a physical tournament using the same name and Miniclip’s game *Cricket League*. The former working title *Cricket Mania* has an existing Y8 listing. [CricHeroes tournament](https://cricheroes.com/tournament/789820/crazy-cricket-league-season-4/about-us) · [Miniclip game](https://www.miniclip.com/games/cricket-league) · [Y8 game](https://www.y8.com/games/cricket_mania)

## Rules sources and format decisions

| Profile or source | Revision | Relevance to the slice |
| --- | --- | --- |
| Base laws | MCC 2017 Code, 4th edition, effective 1 October 2026 | Laws 17–23 inform legal balls, strike, boundaries and extras. Laws 32, 33 and 38 inform bowled, caught and run out. [MCC full text](https://www.lords.org/getattachment/e8b12929-1e84-4927-af4e-2a5875b53589/Laws-of-Cricket-2017-Code-4th-Edition-%282026%29.pdf) |
| `arcade_short_v1` | Local Phase 1 profile | Two overs per side, six legal balls per over and up to ten wickets. Wides and no-balls add extras and extend the over. A no-ball activates a free hit through the next legal ball. Normal completed runs and the end of an over affect strike. Grounded and full-flight boundaries score four and six. Short-match tie policy is a tie. Training uses one over and the same scoring rules. [Local reducer](../src/rules.ts) |
| `standard_t20_2026` | ICC Men’s T20I, October 2026 | Reference for the adopted free-hit behavior in clause 21.18. Competition-specific innings, restrictions and umpire procedures belong to a future official-style profile. [ICC playing conditions](https://images.icc-cricket.com/image/upload/prd/bsxcho7ufe2pjban0wjp.pdf) |
| `ipl_like_2026` | IPL Match Playing Conditions, 2026 season | Separate reference for match length, bowler quotas, field restrictions and reviews. [IPL playing conditions](https://documents.iplt20.com/bcci/documents/1775736835406_TATA_IPL_2026_Match_Playing_Conditions.pdf) |
| BCCI domestic cricket | Men’s T20 tournaments, 2026–27 | Separate competition reference, selected by tournament rather than applied globally. [BCCI domestic index](https://www.bcci.tv/playing-conditions) |

The simulator uses fixed batting and bowling ends for the stadium camera, an arcade line threshold for wides, seeded high-effort release errors for no-balls, and assisted fielding and running. The reducer can carry bye and leg-bye values in delivery events. LBW, stumping, official field restrictions and full competition umpiring are outside the implemented profile. Preserve the profile identifier and simulation version with replay data when expanding rule coverage.

## Local authority spike

`npm run spike:authority` starts one two-seat WebSocket room at `ws://127.0.0.1:8787/authority-spike`. The first connection owns the bowler seat and the second owns the batter seat. Both must be connected for a new intent to be accepted. The server maps monotonic receipt time to a fixed 60 Hz simulation tick and advances the shared delivery simulation independently of either client. It applies the shared score reducer once at dead ball. Both clients receive the same revisioned snapshots, and the result includes the host’s seed, delivery plan and accepted swing tick for replay.

Each seat starts its own intent sequence at 1. Rejected intents leave the sequence available for correction. Fields are limited to `type`, `seq`, `delivery`, `kind` and either `line`/`effort` for `bowl` or `aim`/`power` for `swing`. Angles are radians. A client cannot assign its role, timing, seed or score in an intent. This loopback room uses arrival order for seats. Public hosting requires authenticated seats, jitter handling and a reconnect protocol before adopting this design.

`node --test tests/authority.test.ts` starts the host on an ephemeral loopback port and connects two native WebSocket clients. It verifies role assignment, the room size limit, invalid intent rejection, sequence enforcement, agreement between clients and recomputation of the sealed score event. Run in a shell that permits localhost listening.

## Device benchmark procedure

The desktop browser smoke test checks the integrated build on its host. The Phase 0 and Phase 1 device gates require measurements on a physical 4 GB Chromebook. CrazyGames documents its Chromium OS requirement for a 4 GB device. [CrazyGames technical requirements](https://docs.crazygames.com/requirements/technical/)

### Desktop baseline

The production build was sampled at 907 × 510 and device pixel ratio 1 in Chrome 156.0.8078.80 with the Apple M4 Metal renderer on macOS. Seed 41 produced a four, two runs and a dot ball across two keyboard swings and one pointer drag.

| Measurement | Observed |
| --- | --- |
| Navigation to first stadium frame | 216 ms |
| Initial network transfer | 159,426 bytes |
| Frame time over 1,712 samples | 16.7 ms p50, 16.7 ms p95, 16.8 ms p99 |
| Input event to render submission over three swings | 15.3 ms p50, 16.2 ms p95 |
| Swing to simulated contact over three swings | 100 ms p50, 100 ms p95 |

These samples came from automated inputs. The physical Chromebook benchmark is open.

The full Chromium smoke test completed 24 legal deliveries, with Suncrest winning 38/0 to 18/4. It verified pause, score-preserving replay, the four bowling controls, rewards after reload and touch training at 800 × 450. The full-run frame-time p95 was 16.8 ms on this Mac.

### Chromebook steps

1. Build with `npm ci` and `npm run build`. Serve the production preview with `npm run preview -- --host 0.0.0.0` on a trusted local network, then open the printed network URL on the Chromebook. Record the Chromebook model, CPU, ChromeOS and Chrome versions, viewport, device pixel ratio and network conditions.
2. Use a clean browser profile with extensions closed. With cache disabled, run five reloads at a 907 × 510 viewport. Start an innings as soon as the game is ready each time. Record total transferred bytes, navigation to first stadium frame, navigation to a usable Play action and Play to the first delivery. Repeat at 821 × 462 to check control and score readability.
3. Play a two-over Solo Arcade innings without leaving the viewport. Run `window.cclTelemetry()` in the browser console after each session. Save `marks`, `transferBytes`, `frameMs`, `inputToFrameMs`, `swingToContactMs` and any browser errors. The timing groups report p50, p95 and p99 in milliseconds. `1000 / frameMs.p99` gives a frame-time-derived 1% low FPS estimate. Verify that the innings reaches a valid terminal score. Inspect at least 20 timed swings across sessions and keep input-to-contact samples separate from input-to-first-render feedback. For end-to-end motion-to-photon evidence, use a high-speed camera on the input action and screen together.
4. Compare with the PRD targets of under 10 seconds to first interaction, up to 18 MB initial payload, and sustained 30 FPS on the reference Chromebook. Treat the first input-to-render and input-to-contact sample sets as baselines. Record the trace, browser result and observed score alongside the exact build version.
