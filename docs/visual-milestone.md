# CCL — premium cricket presentation milestone

7 November 2026

This milestone extends the stadium renderer, player motion and complete game
interface together. It replaces the neon prototype presentation with a navy,
ivory and champagne broadcast identity, improves the physical appearance of the
ground and equipment, and fixes the visible coordination of independently moving
batters. The original TypeScript/Vite/Three.js/WebGL2 stack, 60 Hz simulation,
scoring, Node/WebSocket authority, SQLite and CrazyGames adapter remain in place.

## Reference-led direction

The web research covered [Real Cricket](https://realcricket.krafton.com/),
[WCC3](https://nextwavemultimedia.com/games/wcc3),
[Star Sports' IPL motion identity](https://www.stefanoparon.com/ipl02), and
[Vizrt's Hotstar IPL case study](https://www.vizrt.com/case-studies/hotstar-indian-premier-league-cricket-vizrt/).
The resulting CCL design uses condensed sports lettering, large clear score
numerals, short team identifiers, differentiated event colours and restrained
motion. Reference research used available page text and indexed image
descriptions; direct browser inspection of remote references was blocked.
These are design references, not a claim to reproduce any current broadcast
package or its proprietary fonts. See [reference notes](design-references.md).

## What changed and why

| Area | Before | Implemented |
|---|---|---|
| Menu and preparation | Small undifferentiated links; inconsistent panels | Match-centre hierarchy, numbered modes, live venue/conditions preview and structured team sheets |
| Typography | Impact-style title and generic UI fallbacks | Condensed local Bahnschrift sports treatment, aligned numeric hierarchy, readable body text |
| HUD and results | Oversized routine callout and compact-layout collisions | Consistent broadcast strip, smaller routine events, stronger fours/sixes/wickets, innings/result styling and better control clearance |
| Milestones | No batter/team milestone announcement | Read-only detection of newly committed 50-run increments; extras can advance the team without being credited to the batter |
| Replay presentation | On-field reconstruction could disagree with a reviewed decision | Callout uses the committed decision; exiting replay restores its regular kicker without rescoring |
| Lighting and surfaces | Diffuse-only materials and contact blobs | PBR roughness, warm direct light/cool fill, pitch-focused player shadows, natural turf detail and weather lighting |
| Pitch | Repeating plain soil surface | Mottled prepared square, feathered edges, grassed spare strips, soil relief, crease scuffs and footmarks |
| Players and equipment | Hard silhouettes and basic surfaces | Smoother silhouettes/shoes, fabric weave, collar/facial detail, beveled willow bat, neutral pads and white seamed ball |
| Movement | Shared movement flags could animate a grounded batter or stop their partner | Separate distance-driven strides, bounded turns, arrival settling, fielding gather/throw envelopes and bowling gather/plant/follow-through |
| Atmosphere | Simple cloud bands and limited event detail | Layered sky, venue glazing, crowd tiers, pooled pitch dust and falling bails |
| Quality and lifetime | Resolution-only settings, no stadium teardown | Real pixel/shadow/crowd/particle/shader budgets, cached geometry/materials, idempotent resource/context disposal |
| Diagnostics | Aggregate frame samples with shifting arrays | Fixed-capacity timing buffers and separate CPU simulation, UI and render submission timings |

The browser review also caught an existing startup defect: **How to play** and
**Settings** never became enabled. Both now work after the ground loads.

## Visual evidence

All screenshots are from the actual local game or its production stadium
renderer, without retouching. Before captures were taken before implementation.

| View | Before | After |
|---|---|---|
| Desktop menu | [PNG](visual-evidence/before/01-home-desktop.png) | [PNG](visual-evidence/after/01-home-desktop.png) |
| Desktop match | [PNG](visual-evidence/before/03-match-desktop.png) | [PNG](visual-evidence/after/03-match-desktop.png) |
| 800 × 450 match | [PNG](visual-evidence/before/04-match-landscape.png) | [PNG](visual-evidence/after/04-match-landscape.png) |
| 390 × 844 match | [PNG](visual-evidence/before/04-match-portrait.png) | [PNG](visual-evidence/after/04-match-portrait.png) |
| Match setup | [PNG](visual-evidence/before/02-setup-desktop.png) | [PNG](visual-evidence/after/02-setup-desktop.png) |

Additional evidence: [Suncrest](visual-evidence/graphics/suncrest-clear.png),
[Harbor](visual-evidence/graphics/harbor-breezy.png),
[Citadel](visual-evidence/graphics/citadel-overcast.png),
[team selection](visual-evidence/presentation/lineup-desktop.png),
[innings transition](visual-evidence/match/02-innings-break.png) and
[match result](visual-evidence/match/04-match-result.png).

## Architecture and files

| Files | Responsibility |
|---|---|
| `src/stadium.ts`, `src/ground-effects.ts` | Scene, lighting, geometry, shadows, cameras, presentation effects and disposal |
| `src/graphics-quality.ts`, `src/quality-materials.ts` | Tier budgets and reusable low-cost material variants |
| `src/player-motion.ts` | Pure, reusable locomotion and fielding pose state |
| `src/broadcast.ts` | Read-only canonical event and milestone descriptions |
| `src/main.ts` | Presentation wiring, canonical replay callouts, navigation fix and performance sampling |
| `src/performance-window.ts`, `src/telemetry.ts` | Bounded timing storage and diagnostics |
| `index.html`, `src/style.css`, `src/setup.ts`, `public/mark.svg` | Game UI, live setup preview, roster layout and visual identity |
| New graphics/movement/broadcast/timing unit tests | Behaviour, resource-budget and deterministic-observation regressions |
| New graphics/presentation/milestone/match browser scripts; extended retreat script | Repeatable visual, layout, lifecycle and gameplay checks |
| `README.md`, `package.json`, milestone documents and evidence | Entry points, decisions, reproduction and limitations |

No authoritative simulation, laws, scoring reducer, replay engine, network
contract or persistence source was changed. Renderer sampling is read-only;
effects never award runs or decide a wicket. The H6 position fix remains intact,
and its new animation follows each batter's own authoritative position.

## Verification and performance

Final commands and results are recorded below after integration. Detailed
machine-readable measurements are in
[graphics metrics](visual-evidence/graphics/metrics.json),
[baseline graphics metrics](visual-evidence/graphics-before/metrics.json),
[production capture metrics](visual-evidence/after/metrics.json), and
[complete match verification](visual-evidence/match/match-verification.json).

The graphics harness checks all quality tiers, two full venue tours, unchanged
simulation data, double disposal and recreation. Three r185 retains one internal
empty shadow sampler in its raw counter after disposal. Owned geometries and
textures are released; the supported context-loss extension then releases the
discarded GPU context, including that internal sampler. The harness checks the
actual context state rather than zeroing reported counts.

Software-GPU timings measure Chromium/SwiftShader on this machine. They are not
mobile or integrated-GPU performance claims. `renderMs` measures CPU scene work
and command submission; it is not a GPU timer. High/Medium add a shadow pass and
more material work; Low removes those costs and reduces the crowd and pixels.

## Reproduction

```powershell
node 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' test
node 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' run build -- --configLoader native
$env:CCL_CHROME_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
$env:CCL_SOFTWARE_GPU='1'
node scripts/graphics-browser.ts
node scripts/presentation-browser.ts
node scripts/milestone-browser.ts
node scripts/retreat-browser.ts
node scripts/match-presentation-browser.ts
```

The explicit npm entry point avoids this machine's broken roaming npm launcher.
Native Vite config loading avoids esbuild's sandbox parent-directory lookup.
The source-only visual harness disables dependency prebundling for the same
reason. No filesystem/network permission was weakened.

## Remaining limitations

- The characters remain procedural. This is a meaningful lighting, surface,
  movement and presentation upgrade; it does not reach scanned-player or
  motion-captured commercial-game realism. Night matches, full stadium shadows,
  environment reflections and authored skeletal assets remain future work.
- Direct remote reference browsing and public font downloads failed automatic
  approval review with `content-blocked`, including the explicitly approved
  font retry. The Windows implementation uses installed Bahnschrift; other
  devices use fallbacks. No font download is claimed and no missing asset URL is
  shipped. Bundled open-license fonts remain a portability follow-up.
- Desktop mobile-sized viewports were tested. Physical low-end Android/iOS,
  integrated-GPU laptops and CrazyGames portal acceptance remain unverified.
- The existing large JavaScript chunk warning remains. No full-screen bloom,
  SSAO, shadowing of the crowd or extra rendering framework was added.

Subsystem detail: [graphics](graphics-overhaul.md),
[movement](movement-overhaul.md), [presentation](presentation-overhaul.md).
