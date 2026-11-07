# Bowling and player-management milestone

## Research and attribution

Reviewed 8 November 2026 before implementation.

- [Official WCC3 overview](https://www.worldcricketchampionship.com/wcc3): new controls and variations, professional motion capture, advanced AI and multiplayer. It does not document numerical trajectory algorithms or animation event timing.
- [Official guides/FAQ](https://www.worldcricketchampionship.com/cricket/world-cricket-championship-3/guides): player skills across batting, bowling and fielding; stamina and squad recovery. It is an FAQ, not a detailed bowling manual.
- [GamingOnPhone beginner guide](https://gamingonphone.com/guides/world-cricket-championship-3-beginners-guide-and-tips/): over/around wicket selection; a merit tracker with ordinary, special and no-ball regions; compatible pacer variations; gesture controls for speed, accuracy, swing/spin; pitch-spot adjustment. Direct fetching returned 403; the search index supplied the bowling section.
- [AnimationXpress update coverage](https://www.animationxpress.com/games/wcc3-introduces-dedicated-esports-mode-alongwith-bunch-of-other-features/): seven additional assignable bowling actions, cutscenes, highlight camera control and custom difficulty.
- [Official video index](https://www.worldcricketchampionship.com/cricket/world-cricket-championship-3/videos): public gameplay demonstrations are listed; textual indexing alone does not establish exact gestures or frame-by-frame motion.

CCL design decisions: explicit selection gates; preparation → target → execution → run-up → release; an accessible miniature pitch and two-press release meter; profile-based deterministic scatter and movement; separate pace/finger-spin/wrist-spin recipes; stable roster IDs and immutable match snapshots. Numerical attributes, action curves, availability thresholds, stamina costs, UI, rules implementation and camera paths are original CCL work. No WCC3 assets or proprietary animation clips are used.

## Existing architecture audit

- `cricket.ts` owns the shared fixed-step Delivery simulation, forecasts, ball movement, contact, fielding, running and law facts. Eight delivery recipes and name-keyed style multipliers preceded this work.
- `main.ts` owns local lifecycle, a three-second presentation windup, recorded input replay, DRS, automatic five-bowler rotation, UI and frame construction. Solo, Training and Six share it; Quick, Private and Duo reconstruct server state.
- `rules.ts` applies immutable innings/scorecard changes, strike changes and automatic numbered wicket replacement. `scorecard.ts` renders existing score snapshots.
- `players.ts` has legacy name-keyed batting/bowling scalars; `match-data.ts` stores fifteen roster keys and static roles. `setup.ts` saves the XI and setup via platform storage. `dressing-room.ts` renders a jersey preview.
- `stadium.ts`, `player-motion.ts` and `batting-motion.ts` implement procedural segmented models, batting IK, running, PBR materials, lighting, shadows and graphics budgets. Bowling hardcodes one release arm; left-handed batting was absent.
- `online-contract.ts`, `online-client.ts`, `scripts/online-server.ts`, `scripts/match-store.ts` retain sequenced validated legacy commands and SQLite sealed results. `delivery-replay.ts` reconstructs accepted controls at exact ticks. No schema migration is needed for additive local browser profile storage.
- H1–H5 and H6 are present. H6 coordinates both returning runners before grounding/retreat completion. These authoritative running, DRS, keeper, extras and overthrow paths must remain intact.

## Implementation plan and dependencies

1. Central validated versioned profile model, immutable IDs, legacy defaults and storage. Separate identity, role, batting, bowling, fielding, action and match statistics. Build editor and squad filters/sorts/comparison on this model.
2. Add an optional versioned bowling execution snapshot to existing Delivery options. Preserve the old constructor path for saved online input histories. Add capability-specific recipes, side/hand interpretation, target scatter, pace, swing, drift, loop, bounce and turn. Test deterministic replay and parity.
3. Add opt-in managed innings selection to existing rules. Stable player IDs key figures while names remain match snapshots. Gate openings, wickets and overs; enforce quota, previous over and capability rules. AI uses the same eligibility.
4. Integrate Solo preparation HUD, pitch map, pace/spin movement controls and execution meter in main lifecycle. Keep input capture separate from simulation. Preserve online legacy controls and explicitly disclose local rollout.
5. Build pure action sampler and adapt existing rig: accelerate, gather, plant, release, follow through and recover. Match release hand to engine endpoint. Apply handed batting kinematics, identity textures and entrance camera without authoring a parallel athlete system.
6. Run complete regression suite/build, real browser flows on desktop/mobile, capture before/after evidence and inspect images. Record actual metrics and limitations, including procedural animation and multiplayer scope.

## Regression risks

Wides/no-balls must not advance over selection; innings completion must win over replacement/new-over gates. Run-out replacements must retain the correct physical end after crossing/over rotation. DRS must settle before opening selection. Profile edits must not rewrite existing innings names or sealed histories. Legacy paths and online commands must retain deterministic behavior. HUD must reserve scoreboard space and avoid mobile overlap. Texture/material changes require disposal and bounded caches.
