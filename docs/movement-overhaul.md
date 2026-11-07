# Movement presentation milestone — 7 November 2026

## Audit and purpose

The H6 authoritative running fix already waits for both batters to return.
No additional simulation defect was found in that behavior. The renderer,
however, used one `runnerProgress`, one `runnersMoving` flag and the same
clock/stride strength for both players. A faster batter jogged on the spot
after grounding, while a returning slower partner could lose its running pose
as soon as the striker reached home. Both players also snapped 180 degrees
when a turn-back was called. Fielders used render-frame deltas to estimate
speed, which alternated between zero and exaggerated speed when multiple
render frames occurred during one 60 Hz simulation tick.

## Implemented behavior

- Each batter now samples its own authoritative grounded coordinates. The
  pair still shares exactly the simulation's running destinations, progress,
  completed-run parity and individual pace; presentation never moves those
  coordinates or decides whether a batter is safe.
- Each athlete has a distance-based stride phase and a short speed envelope.
  Faster and slower runners use different cadences. Stopping freezes stride
  phase and settles the pose; the other batter can continue independently.
- Heading changes use a bounded shortest-angle pivot with a small body bank.
  Torso lean, head compensation, knee recovery, ankle pitch and arm opposition
  make starts, pursuit and turn-backs more legible.
- Fielder movement samples simulation time instead of render-frame duration,
  faces actual travel while chasing, and transitions from low pickup through
  a set throwing pose into release and follow-through. Manual possession
  holds the set pose. Return throws face the selected wicket end.
- Bowling continues to use its existing release timing and procedural action,
  with the improved shared leg/arm gait. Batting contact and two-hand grip
  geometry are preserved.

## Architecture and resource behavior

`src/player-motion.ts` is DOM-free and Three.js-free. Its samplers mutate only
caller-owned presentation records, take scalar coordinates/time, and return
the same records. No objects or arrays are allocated by an update. The
renderer preallocates one locomotion record per runner and one locomotion
plus fielding record per defender. New deliveries, backward replay seeks and
large layout changes reset presentation history. Sampling a repeated tick
does not advance a gait, so pausing and high-refresh displays do not produce
extra steps. The simulation, laws, scoring, accepted commands and replay
formats are unchanged.

The renderer also uses the partner's actual position in assisted modes,
rather than inferring it from the striker's progress. Reduced-motion mode
continues to retain essential player action so running and catches remain
understandable; decorative scene motion is controlled separately.

## Files

| File | Change |
|---|---|
| `src/player-motion.ts` | Allocation-free locomotion and fielding pose envelopes. |
| `src/stadium.ts` | Shared run pose, independent batter states, defender sampling and action integration. |
| `tests/player-motion.test.ts` | Seven behavioral and deterministic-observation regressions. |
| `docs/movement-overhaul.md` | Audit, design, verification and limits. |

## Verification

The following command passed **101 tests, zero failures/skips** on 7 November
2026, including seven new movement tests and every dedicated H1–H6 suite:

```powershell
node --test tests/player-motion.test.ts tests/running-retreat.test.ts tests/delivery-replay.test.ts tests/drs-lifecycle.test.ts tests/keeper-fumble.test.ts tests/no-ball-extras.test.ts tests/overthrow.test.ts
```

The new H6 presentation test drives production `Delivery` only through public
swing/Run/Turn back controls. At tick 240 the striker has grounded opposite
and fully settled while the partner still runs. At tick 432 the striker is
home and settled while the partner continues retreating. Each observed
delivery is compared tick-for-tick with an otherwise identical control
delivery that receives no rendering observations. Both finish on tick 676
with zero completed runs and the same existing overthrow outcome. A second
test reconstructs the delivery and confirms identical movement observations
after a reset.

Other coverage verifies independent cadence, rest after arrival, bounded
angle-wrap turns, repeated render ticks, replay rewind, layout-reset behavior,
manual fielding hold, throw follow-through and pose recovery. The overall
milestone report records strict TypeScript, full-suite, production-build and
actual browser results after integration with the graphics and UI work.

## Limits

This is procedural animation, not motion capture or a replacement skeletal
asset. Authoritative running still has its existing constant speeds; the
visual speed envelope changes body posing only. Root positions remain exact
simulation observations, so this does not add interpolation between ticks.
The bat remains held by the existing two-hand grip solver during running.
Pickup and throw envelopes begin when the renderer observes an action
transition; they do not delay the simulated ball or alter catch/wicket reach.
The renderer's per-tick pose is repeatable with the same sampling schedule;
this is not a promise of pixel-identical video across different frame rates.
