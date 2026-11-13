# Bright match-day redesign

The November 13 refresh brings a bright blue, cyan, lime, orange and white UI to the whole game. Illustrated mode cards, match setup, dressing room, player profiles, pause/settings, online menus, the scorecard and live broadcast strip share the same palette and clear typography. Existing SVG artwork has been recolored to match.

## Team scoreboard selection

Opening batters, replacement batters and bowlers are selected from a complete XI table. The adjacent opponent team sheet also lists all eleven players. Names have captain and wicketkeeper badges; batting shows runs, balls, fours, sixes and strike rate, and bowling shows overs, maidens, runs, wickets, economy and energy. Eligibility and innings status stay visible. Tap a row or select its name with Tab and Enter. The first opener choice can be changed before confirming their partner. Phone layouts stack the two teams and hide secondary statistical columns while preserving every player and selection status.

## Bowling

1. Choose a compatible variation and tap/drag the pitch to set line and length. Arrow keys fine-tune the target. Quick length buttons offer yorker, full, good, short and bouncer targets.
2. Set over/around the wicket, estimated pace and movement.
3. Press **Start run-up**. The bowler immediately approaches the crease; the planning panel collapses and a single release meter follows the same game clock.
4. Tap **Release ball** or press **Space** in the green zone near the end of the approach. A perfect release is centered at 92% of the three-second run-up. Early/late timing lowers accuracy; an unanswered window bowls automatically with zero timing quality.

Pause freezes both the run-up and meter. The accepted timing is sealed into the delivery snapshot before physics creates the ball, so replay uses the same inputs and preserves the score. Pace and spin actions include accelerated approaches, a complete overarm wheel, guide-arm pull, front-foot brace, rear-leg sweep and smooth recovery. The rig still joins the physical release point exactly. Animations remain procedural.

## Verification

- Production TypeScript check and Vite build.
- 307 unit tests, including timing boundaries, motion continuity, physics, eligibility and cricket rules.
- Eleven browser pose studies across pace/spin actions and release sides.
- Twelve design browser checks, ten bowling contract checks, and separate desktop measurements confirming both full XIs fit together at 1440 × 900.
- Browser UI and gameplay evidence in `docs/visual-evidence/bright-redesign/`.

`npm run test:design` verifies the new player selector and bowling interaction through public controls using a temporary production build with read-only observations. It checks four viewport sizes, all menus, complete team sheets, opener selection, pitch aiming, run-up release timing, pause and replay. `npm run test:bowling` covers bowling rotation, spin deliveries and replacement batting. On Windows an installed browser can be selected with `CCL_CHROME_PATH`; `CCL_SOFTWARE_GPU=1` uses SwiftShader for headless verification.
