# Stadium presentation milestone — 7 November 2026

## Direction and audit

The existing renderer already had three distinct venues, procedural athletes, a
batting rig and readable camera framing. Its main visual weaknesses were flat
diffuse surfaces, no directional contact shadows, a very sparse playing square,
banded shader clouds and block-shaped equipment. Quality settings only changed
resolution, and the renderer had no teardown API. Many rigid model details and
perimeter panels used separate draw calls; field presets and bat grip scratch
vectors were rebuilt every frame.

The new direction is natural daytime limited-overs cricket: muted mown turf,
prepared wicket strips, cloth and leather materials, a white seamed ball, warm
sunlight, cool ambient light, and readable player silhouettes. This remains
procedural game art. It does not claim photorealistic likenesses, licensed IPL
teams/stadiums, scanned human anatomy or motion-captured animation.

## Implemented

- Standard physically based materials replace generic diffuse materials for the
  environment, players and equipment. Fabric uses a shared repeating weave bump
  texture, skin and equipment use appropriate roughness values, and pads are a
  neutral off-white.
- The ground has a mottled prepared square with feathered edges and narrow,
  partially grassed spare wicket strips, separate turf
  microtexture, soil relief, scuffs and worn crease areas. Existing pitch presets
  and venue boundary dimensions remain authoritative.
- A layered procedural cloud field replaces sine bands. Weather controls the
  sky palette, cloud coverage, fog, direct light and hemisphere fill. Clouds and
  flags freeze with reduced motion.
- A single pitch-focused directional shadow map grounds the two batters,
  bowler, keeper, umpire and stumps. Crowd and distant architecture do not cast
  into this map; contact blobs remain useful for distant fielders and low mode.
- Hospitality glazing/mullions extend existing venue architecture. All sixteen
  boundary advertising panels are batched into one draw call. Crowd instances
  are deterministically shuffled before applying a quality density budget, so
  lower settings thin the whole ground evenly.
- Players have smoother silhouettes, collars, subtle facial geometry, rounded
  shoes, a rounded/beveled willow blade and cylindrical bat handle. Rigid siblings
  with a shared material are merged; articulated joints and hand targets are
  preserved.
- Bowling now separates run-up, gather, front-leg plant and follow-through. The
  guide arm, trunk rotation and head compensation follow that delivery sequence,
  with a smaller gather for spin. Simulation release timing remains unchanged.
- A small pooled dust burst observes the first pitch impact. Bails now have a
  short ballistic flight after an observed wicket, then settle. Both effects are
  presentation only; the ball and dismissal state never depend on them.
- Batting camera framing is retained. Reduced motion removes the decorative
  post-delivery push-in while preserving the camera movement needed to follow
  play. Existing boundary-flight continuation remains detached from scoring.
- Renderer-side field layouts are cached, trail/confetti buffers use direct
  writes, and grip calculations reuse scratch vectors rather than allocating
  inside their repeated reach correction loop.

## Graphics budgets

| Setting | DPR cap | Maximum width | Shadow map | Crowd | Pitch particles |
|---|---:|---:|---:|---:|---:|
| Low | 0.75 | 1280 | Disabled | 45% | Disabled |
| Medium | 1.0 | 1600 | 1024 | 72% | 32 |
| High | 1.45 | 1920 | 2048 | 100% | 64 |

Low also uses cached Lambert diffuse materials and a simple weather-colored sky.
It omits physically based specular/roughness calculations, fabric/ground bump
sampling and procedural cloud noise. It preserves albedo textures, shared team
and pitch colors, transparency and crowd vertex animation. High and medium
restore the exact original PBR materials. Variants are cached per original
material across meshes/venues, and both active and inactive materials are
included in teardown. `info().materialMode` identifies the effective shader tier.

The device DPR can lower the backing buffer further. A quality change releases
the previous shadow target when its size changes or shadows are disabled. The
settings do not alter simulation tick rate, collision geometry, input timing,
scoring, replay records or online messages. No full-screen postprocessing, bloom,
SSAO or reflection pass is added: those would burden low-end WebGL2 devices and
needlessly soften the pitch/ball readability.

## Lifetime and telemetry

`createStadium()` retains its existing public methods and adds `dispose()`.
Teardown is idempotent: it disconnects both resize observers, removes context
listeners, releases unique geometry/material/texture resources across all cached
venues, releases instancing and shadow resources, disposes the renderer and
removes its canvas. It also explicitly releases the discarded WebGL context via
the supported `WEBGL_lose_context` extension. Three r185 keeps an internal 1×1
fallback shadow sampler outside scene ownership: the raw renderer memory counter
can retain one texture after disposal, even though all owned textures/targets are
disposed. `info().contextReleased` reads the actual `gl.isContextLost()` state;
the terminal context release also frees that engine-owned sampler. Counters are
not manually zeroed. Shared source geometry/material objects keep their CPU data
and can be uploaded by a later renderer; no terminal resource flag is attached.

`info()` now includes quality, effective pixel ratio, backing dimensions,
shadow state/size, geometries, textures, programs and context/disposal state in
addition to draw calls, triangles and boundary continuation. Context loss stops
render work until restoration reapplies the selected graphics settings.

## Verification and limitations

- Strict TypeScript validation passed after integration.
- 34 focused tests passed: graphics budgets, all batting contact/grounding/IK
  regressions, movement sampling and the complete H6 retreat suite.
- The parent milestone report records full-suite/build results, browser captures,
  console validation, resource cycling and measured frame costs. Software-GPU
  measurements are diagnostic and must not be described as device benchmarks.
- PBR lighting and dynamic shadows increase high/medium GPU cost. Rigid batching
  reduces draw calls, and low quality removes shadow/particle work and reduces
  crowd geometry. Real integrated-GPU/mobile/CrazyGames portal acceptance remains
  separate from desktop software-renderer verification.
- Lighting currently represents daytime and weather presets. Night floodlight
  rigs, licensed assets, scanned characters, full stadium shadowing, environment
  reflections and motion-captured animation are not part of this milestone.

Files: `src/stadium.ts`, `src/graphics-quality.ts`, `src/ground-effects.ts`,
`src/quality-materials.ts`, `tests/graphics-quality.test.ts`,
`tests/quality-materials.test.ts`; independent runner/fielding integration is
described in [movement-overhaul.md](movement-overhaul.md).
