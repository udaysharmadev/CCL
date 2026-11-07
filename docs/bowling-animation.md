# Bowling and player animation implementation

The existing segmented Three.js athlete rig is extended rather than replaced. Its rigid parts remain batched, and the established two-arm bat-grip solver, planted-foot solver and independent H6 runner motion remain intact. These are original procedural animations, not licensed or motion-captured clips.

## Action and release

`src/bowling-motion.ts` samples mark, accelerating run, gather, front-foot plant, release, follow-through and recovery. Fast high-arm and sling actions, medium smooth/side-on actions, finger spin and wrist spin have distinct approach distances, stride rates, shoulder coils, wrist positions and arm arcs. Arm and type are independent profile attributes. The rig's anatomical right shoulder is local negative X, so a right-arm bowler uses joint 0 and the opposite front foot; a left-arm bowler uses joint 1. Rear-view browser inspection caught and corrected the old reversed convention.

The shared deterministic `bowlingReleasePoint` supplies the physical endpoint. Arm IK lands exactly on it at normalized windup 1 and at flight tick 0. Lower spin and sling endpoints widen the arm arc rather than folding the elbow. The ball attaches to the correct hand during preparation, then reads the existing authoritative ball position. Follow-through observes delivery time; no animation function calls a simulation step, consumes random numbers, or awards a result. Between deliveries the bowler walks back to the run-up mark.

## Batting and identity

Batting handedness changes the signed crease position, base orientation, head orientation, front/back-foot selection, guard, blade path, top/bottom hand grips and camera offset. No negative mesh scale is used. Strokes still meet the physical impact point and keep both hands on the handle. H6 longitudinal runner positions, independent movement speeds and retreat grounding are unchanged.

Match snapshots supply the striker, partner and bowler identities. Each main athlete has one reusable 256×256 jersey canvas, repainted only when identity changes, with dressing-room name, number and captain designation. Skin materials are individual per athlete and follow the profile palette. Chest trim, fabric, helmet, pads, gloves and shoes use the existing material and quality budgets. Jersey textures and unique skin materials participate in the existing stadium cleanup. Graphics telemetry now exposes displayed actor IDs, batting hand, bowling arm/stage, release/hand positions and the number of jersey textures.

`StadiumFrame` accepts `bowlerProfile`, `strikerProfile`, `nonStrikerProfile`, `bowlingExecution`, `bowlingRelease`, `bowlingSide` and `entranceAge`. The controller owns selection and the entrance gate. A 1.35-second entrance walks the batter to guard with a brief camera introduction. The bowling camera moves from the approach view to a tighter release view while preserving the ball corridor; reduced motion keeps a fixed view.

## Verification evidence

`node --test tests/bowling-motion.test.ts` adds six regression tests covering eight roster arm/style identities across their compatible actions and both wicket sides; exact physical release, last-windup/first-flight continuity, simulation independence, distinct action choreography, left-hand grip/foot selection, all 31 left-handed strokes and physical contact at multiple heights. Existing batting and player-motion tests include the H6 independent-runner regression.

`node scripts/bowling-animation-browser.ts` captures eleven Chromium pose studies, with no page errors. Evidence is in `docs/bowling-evidence/animation/`: run-up, gather, release over/around, follow-through, and left/right stance, drive and sweep. Each bowling sheet contains eight production rigs. `pose-metrics.json` records hand coordinates and physical release coordinates: both coincide within 0.00001 metres at release. These are isolated production-rig studies; the integrated gameplay browser evidence is recorded separately by the milestone browser checks. No match outcomes are injected by this harness.

Each isolated bowler scene uses approximately 2,326 triangles and 24 draw calls including its ground, crease and held ball. Those counts are not full-game FPS or GPU timings. The isolated browser studies confirm resource cost and pose rendering; full-stadium performance observations belong in the milestone report.

## Limits

The models retain stylized low-polygon anatomy and segmented joints. There are no facial animation, cloth simulation or independent finger joints. Wrist differences operate through the forearm/hand assembly. The six action styles are procedural parameterized choreography on one scalable rig, not a library of individual motion-capture performances. Camera and appearance are presentation only; online behavior follows whichever immutable profile and execution snapshots the controller is permitted to supply.
