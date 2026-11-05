# Solo manual fielding — 4 November 2026

## Roadmap source and scope

No standalone PRD is present in this workspace. This increment follows the manual-fielding backlog in `phase-3.md` and item 16 of the local project roadmap. It implements Solo fielding while retaining Automatic as the saved-settings fallback. Online manual fielding, stamina/recovery/coaches, cosmetics/upgrades, leaderboards and recorded commentary remain future work. Existing DRS, player attributes and pitch wear were found in code and were not rebuilt.

## Implemented

- Match setup saves Automatic/Manual fielding. Older saves default to Automatic.
- After AI bat contact, a live top-left field map replaces the small overview for Manual mode. Bowling controls give way to fielding controls.
- Tap a player then a destination to move. Movement uses fixed simulation speed and stays inside the boundary. The keeper can also be selected. Keyboard 1–9 and arrow keys provide player selection and map movement.
- Chase ball / F follows a predicted interception for the selected player. Catches and pickup still require physical ball proximity and legal height; a control never awards a catch or score directly.
- Pickup leaves the ball live in the fielder's possession. Keeper end / Q and Bowler end / E commit a return. Holding the ball lets AI batters continue running; after eight seconds an unattended ball is returned to the keeper.
- Both return ends judge actual crease occupancy. The correct wicket's bails break, and completed runs remain counted.
- Accepted fielding commands are recorded at simulation ticks. Local replay replays movement, selection and throws and blocks live input. Pause also blocks commands.

## Verification

`npm test`: 74 tests passed, 0 failed, including fielding destination validation, physical movement, held-ball behavior, both throw ends, exact outcome/position replay, catch, six and run-out paths.

`npm run build`: strict TypeScript and production build pass. Vite retains its existing warning about the main bundle exceeding 500 kB.

`npm run test:fielding`: saved Solo setup, physical touch map movement, chase, pickup/hold, pause lock, bowler-end throw, desktop/landscape/portrait bounds and score-preserving replay. The checked delivery finished at 1/1 with a Run out result and no page errors.

This is local browser verification. CrazyGames portal acceptance and the physical Chromebook benchmark remain unverified. Hosting stays local.
