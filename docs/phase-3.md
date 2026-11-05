# Current continuation — 4 November 2026

Manual fielding is now implemented for Solo: optional saved setup, live player selection and destination movement on the map, Chase ball, physical catch/pickup, live hold, keeper/bowler end return, run-out checks and replayed inputs. Automatic fielding is the default and online fielding remains server-controlled. See [manual fielding implementation and acceptance](manual-fielding.md).

The sections below record earlier increments. References there to twelve shots, the Shots tray and Assist running describe the older controls. The current build has 31 techniques/evasions, swipe-selected strokes, Normal/Loft/Defense, visible manual running controls, and a bottom broadcast scoreboard. Current controls are in the README.

# Phase 3 progress

## Longest Six Power Hit

The first local Phase 3 feature is a five-ball Longest Six challenge, accessible directly from the stadium home. It uses the same fixed-step delivery simulation and batting controls as Solo.

The ball solver records the actual launch direction and forecasts the first landing with the same gravity, drag and wind integration used during play. The forecast continues beyond the rope because a normal cricket delivery ends when it crosses the boundary. The displayed distance is the horizontal distance from bat impact to that first landing.

Only a full-flight six earns challenge points. A grounded four, catch, miss or other outcome earns zero. Points combine the PRD's distance formula with straight-line accuracy, timing and a capped consecutive-six bonus. Every delivery is committed once, and replay leaves the challenge score unchanged. The challenge ends after five attempts, including misses, and saves personal best distance and points through the existing platform storage adapter.

This build includes Power Hit and local records. The remaining Phase 3 systems include online manual fielding, stamina/recovery/coaches, expanded cosmetics, bat upgrades, online leaderboards and recorded stadium commentary.

## Duo Batting

Online now offers a private Duo room for 2–20 overs. Both users approve one shared XI and bat in one innings against server-controlled AI bowling and fielding. Delivery plans are fixed before the swing. The striker alone can commit a shot. Completed runs and the over ending select the next striker from the canonical innings reducer. A replacement batter inherits the dismissed participant's control.

The partner sees the bowling camera and can send Run, Wait and No calls. New Duo deliveries use manual running, controlled by the striker. Commands are recorded at server ticks so delivery replay and restart recovery preserve running decisions. Older saved deliveries without a manual-mode option retain their original assisted behavior.

Both players can agree to exchange control of the two current batters between deliveries. One request alone leaves ownership unchanged. Requests can be canceled, and pending consent is cleared on the next delivery, disconnect or server restart. Confirmed ownership persists across restart. Versioned requests prevent a delayed or duplicated approval from applying another swap. Swapping leaves the score, striker identity, ball count and rewards unchanged.

The room uses the existing invitation, guest identity, readiness, reconnect and rematch infrastructure. A naturally completed partnership awards both participants 15 server coins and 40 XP. A disconnected partnership ends as abandoned after the reconnect grace period.

The two-client browser check completed a shared 12-ball innings at 7/1, checked single and over-end control changes, queued commands applied once, turn back, partner calls, non-striker run-out replacement, live-ball refresh reconnect, equal rewards and same-room rematch. Separate integration tests cover catch replacement ownership and a live run surviving a server restart; every sealed outcome is reproduced from its replay. Run `npm run test:duo` for the browser check.

## Manual running and run-outs

Solo setup now offers Assist or Manual running, with Assist as the default and fallback for older saved settings. AI batting keeps assisted running. New Duo deliveries use Manual. R/Run starts one attempt; further presses queue up to five more runs. C/Turn back reverses the current attempt and clears queued runs. Turning back takes time and does not grant immediate safety. A finished run stops the pair at the crease unless another run is queued.

The pair traverses the popping creases together at a fixed 3.05 seconds per run. Both must reach the opposite crease before a run is credited. A returned ball stays live while the keeper carries it to the striker wicket and removes a bail. Reaching the crease on the same simulation tick is safe. A run-out retains completed runs, excludes the incomplete run, identifies the original striker or non-striker and uses crossing when placing the surviving batter. Over-end strike rotation then applies. The replacement inherits the dismissed participant's Duo control. Run-outs remain possible on no-balls and free hits.

Running commands are included in Solo replay and the authoritative online record. The client applies each command once, including queued runs, and blocks live input during replay. The current implementation uses a synchronized pair and keeper returns to the striker wicket. Independent acceleration, player speed attributes, throws to either wicket, overthrows, manual fielding and run-out reviews are still open.

Deterministic tests cover waiting, a safe single, queued second-run risk, early/late turn back, exact-tick grounding, either dismissed batter, crossing, over endings, no-balls/free hits and Duo replacement control. The restart integration check also rejects partner and duplicate running inputs before recovering the live run.

## Verification

Swipe batting now uses one shared mouse/touch gesture mapper for drive, placement, cut/pull, defence and explicit loft. Shot preparation can begin during windup. Release remains the commit point, and an early windup release shows feedback without committing a hit. Direction, normalized drag distance and speed determine intent; delivery physics still determines contact, edges, misses, boundaries and fielding. Optional explicit techniques remain in the Shots tray. The local Training/Rookie/Club read window is slower in wall-clock time without changing fixed-step trajectories or recorded replay ticks. Online timing is unchanged.

The match HUD hides career panels and keeps the primary pitch interaction clear. Added a close batting camera, visible follow-through before running, gesture trail, contact cue, ball trail, crowd motion/ambience, impact/cheering audio, six confetti and boundary bat salute. The title screen runs an isolated demonstration delivery. Local batting auto-continues after 4.5 seconds unless disabled, replaying, paused, finished or choosing in the shot tray. Reduced motion disables decorative camera kick, demo playback and crowd animation.

`npm run test:swipe` verifies physical mouse and touch input rather than substituting a keyboard swing. Its desktop drive scored four; its compact touch loft scored six. It also checked early-release feedback, no early commitment, visible contact, score-preserving replay, automatic next-ball flow and absence of page/shader errors. These checks establish the tested behavior, not complete coverage of cricket laws; advanced dismissals, reviews and independent runner physics remain open.

Run `npm test`, `npm run build`, `npm run test:six`, `npm run test:duo` and `npm run test:running`. The challenge tests verify first-landing distance, grounded-boundary rejection, deterministic replay, timing/direction scoring, streak reset, duplicate delivery rejection and the five-ball cap. The challenge browser check covers normal entry, five deliveries, score-preserving replay, pause, record persistence and home layout at 800 × 450. The Solo running browser check covers saved Manual settings, a commanded single, pause input lock, score-preserving replay, Assist controls and fallback for older saved settings, also at 800 × 450.

The current suite passed 31 tests, including gesture direction/scaling and mistimed swipe rejection by the actual delivery simulation. The earlier Chrome challenge run completed five attempts with 1,628 points, rejected a grounded boundary, preserved score during replay and retained the personal best after reload. The current production build passes; the Duo and touch checks cover the 800 × 450 viewport.

The full Solo browser match completed 24 legal deliveries: Suncrest 34/0 and Ridgebacks 18/4, with the win, rewards, replay and reload persistence checked. The measured p95 frame time was 16.7 ms on the local Mac test browser; this is not a Chromebook performance claim. Phase 2 setup, 1v1, Duo, manual running, challenge and real-swipe browser checks passed in this iteration. Compact home actions fit between the header and footer at 800 × 450.

Phase 2 portal preview and physical Chromebook acceptance checks remain recorded in [Phase 2 progress](phase-2.md). Hosting remains local at the user's request.
