# Phase 2 progress

## Implemented and verified locally

- Solo setup supports 2–20 overs, three original venues, pitch and weather selection, AI difficulty and batting or bowling first.
- The 15-player roster supports selecting and saving a valid XI and changing batting order. Solo uses those selected names and eligible bowlers.
- Twelve batting techniques have distinct launch parameters and renderer poses. Eight deliveries have distinct pace, height or lateral movement.
- Six field presets change physical fielder positions. Four pitch surfaces and three weather presets affect simulation. Venue rope dimensions are shared by renderer and physics.
- The online server pairs two human clients for five-over Quick matches and creates private 2–20 over rooms. It owns the toss, delivery simulation, score, innings change, chase and result.
- Private rooms support host-edited overs, venue, pitch and weather, versioned approval of both playing XIs, readiness resets after edits and same-room rematch voting. Private rooms expose invitation links. Session tokens recover a seat after refresh, with a 15-second grace period during a match.
- The platform adapter initializes SDK v3 when embedded or explicitly requested, reports loading and gameplay transitions, honors platform audio mute, and uses the SDK Data module when available. Direct play uses browser storage.

- Rooms, stable guest identities, server-owned rewards and sealed delivery records persist in SQLite. Room state is saved before an accepted action is acknowledged. Repeated match settlement cannot duplicate an award.
- The local HTTP service serves the game and WebSocket endpoint together, with a health check.
- Server-measured round-trip delay controls a maximum 100 ms input adjustment. The accepted simulation tick is preserved in replay.
- Powerplay uses the October 2026 ICC reduced-over table for 5–20 overs, with a stated six-ball game adaptation for shorter matches. The formation is clamped to the legal outside-fielder limit. Automatic five-bowler rotation prevents consecutive overs and respects the per-bowler quota.
- The dressing-room MVP now includes eleven hanging jerseys, a central player and four reserve seats/players alongside the selectable XI.

## Verification evidence

On 3 November 2026, the production build and strict TypeScript check passed. The test runner reported 18 passed and 0 failed. Tests include 300 seeded deliveries, distinct shot and delivery trajectories, preset conditions, replay checksums and two-peer room/reconnect behavior, full restart recovery, measured-delay input reconciliation, powerplay restrictions and atomic reward persistence.

The full Solo browser regression completed 24 legal deliveries, Suncrest 34/0 versus Ridgebacks 18/4, and checked pause, replay, persisted rewards and touch training. Chrome on this Mac measured 16.7 ms p95 frame time during that run.

The Phase 2 browser test saved a changed XI through reload, started a 20-over match at Harbor Reach with green pitch and breezy weather, delivered a bouncer, selected an attacking field and checked SDK lifecycle calls against an injected SDK test implementation.

The official SDK was also loaded from its CDN in its supported localhost mode. Chrome confirmed the `local` environment, successful Data-module write/read, and pause/resume without page errors. Developer Portal preview remains a separate outstanding check.

The online browser test used two independent Chrome contexts. It verified Quick pairing, a timed swing scored by the server, refresh reconnect and private invitation routing. It then completed a private two-over first innings and a successful chase, checking matching visible results on both clients.

## Remaining acceptance checks

- Actual CrazyGames Developer Portal preview and platform QA. Browser control is disabled in the available computer-use environment, so an authenticated portal session could not be inspected.
- Physical 4 GB Chromebook load and sustained-performance benchmark. The user confirmed that no Chromebook is available.
- Public hosting is deferred at the user's request to keep the build local. The service is prepared for a persistent Node host, but external hosting has not been deployed or verified.

Local automated and browser checks support the implemented feature claims above. Phase 2's full platform acceptance remains open until the portal and device checks have evidence. Basic Launch submission remains gated on those checks.

The game uses its fictional arcade profile and assisted running, including the adopted field/quota rules. It currently physically simulates bowled and caught dismissals. Full official competition simulation, LBW/DRS and advanced cosmetics remain outside this local implementation. The requested game name and prior-use search are recorded in the Phase 0 notes.

## Commands

Run `npm test`, `npm run build`, `npm run test:browser`, `npm run test:phase2` and `npm run test:online`. Browser tests accept `CCL_CHROME_PATH` to select an installed Chrome executable.

The SDK adapter follows the official v3 initialization, Game and Data APIs. [SDK introduction](https://docs.crazygames.com/sdk/intro/) · [Game lifecycle](https://docs.crazygames.com/sdk/game/) · [Data storage](https://docs.crazygames.com/sdk/data/)

The adopted field restriction table is from clause 28.7.6 of the October 2026 ICC Men's T20I conditions. [Official playing conditions](https://images.icc-cricket.com/image/upload/prd/bsxcho7ufe2pjban0wjp.pdf)
