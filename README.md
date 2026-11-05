# Crazy Cricket League

A 3D browser cricket game with Solo matches against the Ridgebacks, Training Nets and local online 1v1. Play at Suncrest Oval, Harbor Reach or Citadel Pavilion.

## Run locally

Use Node.js 22.18 or newer.

```sh
npm ci
npm run dev
```

Open the Vite address in a WebGL 2 browser. For the production bundle, run `npm run build` and then `npm run preview`.

## Play

- **Solo setup:** Use Match setup for 2–20 overs, three grounds, four pitch surfaces, three weather presets, four AI difficulties, innings order and tap-to-run controls. Play Solo Arcade uses the saved setup.
- **360° swipe batting:** Hold on the pitch, drag in any direction, then release as the ball reaches the batter. Up plays straight, diagonals place drives, sideways produces cuts/pulls/sweeps, and downward swipes play behind the wicket with flicks, hooks, reverse sweeps or ramps. Direction and delivery height choose among 31 batting techniques and evasions. Swipe length and speed control power.
- **Batting modes:** Normal is the default. **LOFT / Shift** attacks in the air; **DEFENSE / D** plays a softer shot in the same direction with fewer edges and lower dismissal risk. Tap the active mode again for Normal. **Space** plays straight in the active mode. There is no shot-selection tray or mouse-following aim ring.
- **Match HUD:** The full-width bottom broadcast strip keeps the score, overs, batter figures, bowler figures, run rates and current over visible. The top-left field map follows the live ball and fielders. Tap it between bowling deliveries to choose a preset; in Solo, select a fielder and tap a legal destination to reposition them. Powerplay limits apply. Online custom positions remain server-controlled; presets are available to the bowler.
- **Timing:** The meter beside Pause shows EARLY, GOOD, PERFECT and LATE, retaining the result after contact. A perfectly middled shot triggers a short haptic pulse where the browser supports vibration. Reduced motion disables the pulse animation and vibration.
- **Bowling:** Pick one of eight deliveries from the bowling groups. Set line, pace and one of ten field presets, then select **Bowl**. Extreme pace can produce a no-ball.
- **Real cricket laws:** Leg before wicket is judged by the three point test — where the ball landed, where it struck the person, and whether it was travelling towards the stumps. Stumping, byes and leg byes, overthrows and penalty runs are all modelled, and a free hit protects the batter from every dismissal except a run out.
- **Real fielding:** Twenty-two named positions — slips, gully, point, cover point, cover, mid off, mid on, mid wicket, square leg, fine leg, third man, deep square leg, cow corner and more. Four presets are built from them: Test Standard, Catching, Attacking Ring and Deep Set.
- **Manual fielding (Solo):** Choose **Match setup → Fielding → Manual**. After contact, tap a numbered fielder on the live map, then tap a destination. **1–9** selects a fielder and arrow keys move in map directions. **Chase ball / F** follows the interception. Once the ball is collected, choose **Keeper end / Q** or **Bowler end / E**. Delaying the throw lets the batters run. An unattended held ball returns to the keeper after eight seconds. Manual fielding commands replay at their recorded simulation ticks. Automatic fielding remains the default; online fielding remains server-controlled.

- **Scorecard:** Open **Pause → Scorecard** for the full card — batters with how out, balls, fours, sixes and strike rate; bowlers with overs, maidens, runs, wickets, wides, no balls and economy; the extras breakdown; partnerships; and fall of wickets.
- **Dressing room:** Preview your squad in a 3D room, select 11 from a roster of 15 and reorder your batting lineup. The lineup is saved and used in Solo.
- **Between balls:** Local batting continues automatically after 4.5 seconds. Disable **Pause → Auto next** to play at your own pace, or choose **Next ball** immediately. Pause holds local play. **Pause → Replay** preserves the score. **Esc** opens Pause, with Resume, Settings, Scorecard and match controls. A completed Solo match earns local coins and XP.
- **Longest Six:** Face five balls in Power Hit. Loft towards straight for distance, precision, timing and streak points. Personal best distance and total points are saved. A grounded four or a catch scores zero challenge points.
- **Manual running:** In Solo, use the visible Run / +1 and Turn Back buttons. Solo, Training and Online use manual calls by default. Press **R** or **Run / +1** to start one run; further presses queue up to five additional runs. Press **C** or **Turn back** to return to the prior crease and cancel queued runs. Runs count after both batters reach the opposite crease. Late running can cause a run-out when the keeper breaks the striker wicket. Completed runs still count, and the correct dismissed batter is replaced. Replay reproduces the running decisions without adding to the score.
- **Duo Batting:** In Online, select the private overs and create a Duo room. Invite a second player and approve the shared team XI. Both bat in one innings against AI. Only the striker can swing and control running. The partner can call Run (**R**), Wait (**W**) or No (**C**). Singles, over endings and wickets determine who controls the next batter. Between deliveries, use **Swap control** and have the partner accept to exchange batter control. Pending requests can be canceled and clear when the next ball starts or either player disconnects.

## Local multiplayer

Build and start the local game service.

```sh
npm run build
npm run online
```

Open http://127.0.0.1:8788/ in two independent browser sessions, such as Chrome and an incognito window. Select Online and Quick 1v1 on both to pair for five overs. Create private room supports 2–20 overs and a shareable invitation link. In private rooms the host chooses ground and conditions, and both players approve their XI before the toss. A setup change clears both approvals. The toss winner chooses innings order. The server owns the delivery timing, scoring, innings changes and result.

Reloading recovers your seat using session storage. During play, the reconnect grace period is 15 seconds. The bundled server listens on localhost and saves rooms, guest identities, sealed delivery records and rewards to `.data/online.sqlite`. Completed online matches award 30 coins to the winner and 15 to the opponent, plus 40 XP. Forfeits award no coins. Rematch keeps the same room and requires both votes.

Online reward balances are separate from Solo device balances. The guest account key stays in browser storage, and the server owns its balance. Deleting that browser key loses access to that guest account. Each sealed match can award once per account, including after reconnect or restart.

The server measures round-trip delay and applies at most 100 ms of timing compensation. Private rooms use the selected pitch/weather/boundary, and both modes enforce powerplay field limits with automatic five-bowler rotation. Node's built-in SQLite API currently emits an experimental-feature notice.

The current request keeps hosting local. For a later deployment, the service accepts `PORT`, `CCL_BIND_HOST`, `CCL_ALLOWED_ORIGINS` and `CCL_DATABASE_PATH`; use a persistent disk and a TLS reverse proxy. The service exposes `/health` and serves the production bundle from `dist`.

## Verify

```sh
npm test
npm run build
npx playwright-core install chromium
npm run test:browser
npm run test:phase2
npm run test:online
npm run test:six
npm run test:duo
npm run test:running
npm run test:swipe
npm run test:hud
npm run test:runout
npm run test:fielding
npm run test:batting
npm run spike:authority
```

The browser smoke test runs against the production bundle using Chromium. It supports `CCL_CHROME_PATH` for an installed Chrome executable, `CCL_SOFTWARE_GPU=1` for SwiftShader, and `CCL_QA_DIR` for optional screenshots. Enter `window.cclTelemetry()` in DevTools to inspect local performance counters. Add `?seed=41` to the game URL to reproduce a delivery sequence.

Use `?play=training`, `?play=solo` or `?play=six` to enter directly. `test:swipe` uses real browser mouse movement and touch events to verify a drive, a lofted six, early feedback, replay and automatic next ball. The stadium title screen runs a separate demonstration delivery; it never writes to a match score or career. Match presentation includes crowd motion and ambience, bat impact and cheering, ball trails, boundary celebration and a closer batting camera. Sound can be muted; decorative camera effects respect reduced motion.

Matches use the fictional `arcade_short_v1` profile. Solo, Training and Online use manual running calls. Longer Solo formats are labelled limited-overs arcade. Run-outs check crease occupancy when the wicket is broken, retain completed runs, and identify the dismissed batter. Runner attributes and return throws apply. See [Phase 0 notes](docs/phase-0.md) for naming and the Chromebook procedure, and [Phase 2 progress](docs/phase-2.md) for implemented features and remaining launch gates.

## Project documentation

- [Project analysis and status](docs/PROJECT-STATUS.md) — full codebase review: what is done, what is partial, verified test results, known bugs, and a prioritised roadmap.
- [Phase 4: real cricket](docs/PHASE-4-real-cricket.md) — the law and physics research behind the upgrade, and exactly what was built: leg before wicket, stumping, byes and leg byes, named fielding positions, the professional scorecard and the robustness fixes.
- [Phase 3 progress](docs/phase-3.md) — Longest Six, Duo Batting, manual running and swipe batting.

The expanded batting set adds off/square drives, back-foot punch and defence, late/square/upper cuts, leg glance, paddle and slog sweeps, slog, inside-out, helicopter, scoops, reverse ramp and switch hit, plus duck/leave for unsuitable defensive deliveries. These are procedural animations: two arms solve towards separate grip points on a shared bat, with front/back-foot plants and family-specific blade paths. They are not motion-captured player animations.


The batting guard is independent of the selected stroke: a side-on stance, flexed knees, two-handed low grip and a bat toe near the turf. The pickup anticipates the delivery, front/back-foot plants use fixed hip sockets, and strokes recover smoothly to guard. The batting camera keeps the same straight, behind-the-pitch angle at every screen width and in batting replay. It reserves the actual score-strip height so the stance remains visible on small screens. `npm run test:batting` renders eleven fixed pose studies from three angles using the production rig, then checks the live game at desktop, landscape and portrait sizes; screenshots are written to `/tmp/ccl-batting-*.png`. To inspect a pose interactively while Vite is running, open `/scripts/batting-preview.html?shot=cover-drive&age=0.083333&prep=1` (development only).
