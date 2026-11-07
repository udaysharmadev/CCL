# Player profiles and squad workshop

## Architecture and compatibility

The previous `players.ts` provided name-keyed bowling and batting tendencies. `match-data.ts` held a fixed 15-player roster with one short role per player; the lineup was an array of 11 name keys stored at `ccl.lineup.v1`. `setup.ts` owned the XI and reserves UI, and `dressing-room.ts` drew static unnumbered shirts. No editable player records or player-level career store existed.

`player-profile.ts` now owns a validated version-2 model. Its immutable `id` is the original roster key; editable names never become lookup keys. The existing `players.ts` values remain unchanged for old replays and the current online protocol. `player-store.ts` supplies device/platform persistence through the existing `stored`/`save` adapter. A local match captures detached profiles once, so later squad edits cannot alter its identities or attributes.

The current online server still validates its original roster and role contract. `getOnlineLineup()` therefore returns a valid legacy XI; customization is local Solo scope. This avoids sending unsupported profile data or client-selected attributes into authoritative online scoring. Existing sealed online results are not migrated or rewritten.

## Schema

All ratings are finite numbers from 0 to 100; maximum bowling pace is in km/h. The model separates:

- `version`, immutable `id`, primary `role`, and optional plain-text profile details.
- `identity`: full name (36 characters), display name (24), dressing-room/jersey name (14), jersey number (0–99), captain, vice-captain and an appearance palette entry.
- `batting`: left/right hand, style, preferred position (1–11), skill, power, timing, technique, shot control, running, consistency and aggression.
- `bowling`: none/occasional/regular/specialist capability; left/right arm; fast, medium-fast, medium, off-spin, leg-spin, left-arm orthodox or left-arm wrist-spin type; compatible action; skill, maximum pace, pace control, accuracy, control, swing, reverse swing, seam, yorker, bouncer, slower-ball, spin, flight, drift, turn, variation mastery, stamina and consistency.
- `fielding`: overall rating, catching, throwing accuracy/power, agility, reflexes, ground fielding and wicketkeeping.
- `legacy`: original older-record fields retained during migration.

Roles include specialist, opening, top-order, middle-order and finishing batters; wicketkeeper-batter; specialist fast/spin bowlers; all-rounder, batting all-rounder and bowling all-rounder. Role/capability conflicts are rejected: keepers need at least 50 keeping, specialist bowlers need specialist capability and at least 50 bowling skill, and all-rounders need usable batting and bowling skills of at least 35. A bowler must have nonzero capability and at least 20 skill.

Actions are semantic IDs (`high-arm`, `sling`, `smooth`, `side-on`, `finger-spin`, `wrist-spin`) resolved with actual arm and bowling type by presentation. Finger and wrist actions are restricted to their compatible spin families. Left-arm spin has explicit orthodox/wrist types. Pace limits differ: medium 100–135, medium-fast 100–148, fast 100–165, spin 60–115 km/h.

## Persistence and migration

`ccl.players.v2` stores a versioned map of roster IDs to profiles. Saves validate every edited record, retain unrecognized records, and keep a complete original value at `ccl.players.legacy-backup.v1` before the first overwrite. Failure to make a required backup aborts the save. Invalid current records use safe defaults for loading and produce a visible squad warning; their original stored values remain available. Old optional batting/bowling records receive missing defaults and retain original fields. Unversioned fraction-based timing, power, aggression, accuracy and running values are converted to the new units.

Saved XI keys and order are preserved when a capability edit makes the XI temporarily invalid; the user can repair it. Local XI validation requires 11 distinct roster players, at least five bowling-capable players, and a suitable keeper. Online eligibility continues to use its unchanged server rules.

`ccl.player-stats.v1` keeps actual local completed-match totals separate from editable profiles. Match IDs make aggregation idempotent. Player IDs isolate two players who happen to share a display name. Legacy entries without IDs accept only unambiguous names. New career totals do not fabricate a per-player history from old aggregate career scores.

## Squad UI and presentation

The existing dressing-room screen is extended, rather than replaced by a second player system. Clicking a player opens a tabbed workshop for identity, batting, bowling, fielding and statistics. Pace and spin show different specialist attribute fields and compatible actions. Live jersey preview updates its name and number. Validation messages keep incompatible changes reviewable before saving.

Filters cover batters, bowlers, all-rounders, keepers, batting hand, pace and spin. Sorting covers batting, bowling, pace, spin, fielding and overall ratings without rewriting the batting order. Two-player comparison includes role, hand/style, capabilities, ratings and career totals. XI bench/select and batting-order controls remain available. Captain and vice-captain assignments are unique across the squad.

The 3D dressing-room renderer now places actual dressing-room names and numbers on each jersey, uses saved display-name plates, and renders a navy locker environment. Re-rendering disposes old label textures/materials and geometries. An explicit renderer cleanup method disposes shared geometry/material resources and the WebGL context.

## Verification and limits

`tests/player-profile.test.ts` contains 38 passing tests covering defaults, opponent specialists and keeping, every bowling family and handedness pairing, role compatibility, keeping, non-bowlers, names, units/ranges, persistence, snapshots, migration/backup, identity isolation, local versus online eligibility, historical runner pace parity and idempotent player statistics.

`scripts/squad-browser.ts` exercises public browser controls to edit and persist profiles, reload, compare, filter/sort, reject invalid pace, show distinct fast/spin editors, and inspect desktop/portrait/landscape layouts. It does not inject profile state or match outcomes. Capture results are recorded beside the screenshots in `docs/visual-evidence/bowling/squad/checks.json` when run.

The browser verification passed six grouped checks in Chromium 156.0.8078.4 with software rendering and no page/console errors, producing 13 screenshots. Inspection caught and fixed a narrow-phone hero-rating overflow; a compact short-landscape presentation keeps the workshop tabs and first fields visible without scrolling past a full-height hero.

The editor exposes the complete schema, but attribute effects depend on the gameplay subsystem. In particular, a stored numeric field alone is not evidence of a new live fielding mechanic. Refer to the consolidated milestone report for the exact simulated effects. This milestone supplies procedural appearances and actions; it does not add custom photo uploads or motion-captured player assets.
