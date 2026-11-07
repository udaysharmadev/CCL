# Championship presentation milestone

7 November 2026

## Intent and implementation

The previous interface mixed a neon title treatment, rounded web-app panels,
multiple score-strip styles and small undifferentiated mode links. The new
presentation uses midnight/royal blue, ivory and champagne gold. Green is
reserved for field/running cues, while wicket feedback retains a warm red tone.
Cricket-game and broadcast references inform hierarchy, not copied branding;
see [design references](design-references.md).

- The title menu has a primary match action, training action, numbered mode
  choices and separate help/settings navigation. Existing accessible names and
  action IDs remain unchanged.
- Match setup groups ground/conditions separately from tactics. Its venue
  illustration, venue name, weather/pitch line and overs/order/difficulty summary
  update from the actual draft selections, without creating or mutating a match.
- The dressing room presents batting order, player name and role as separate
  fields; the existing roster validation, selection and focus restoration stay
  in place.
- HUD scores, timing, controls, scorecards and dialogs share the same palette and
  squared broadcast treatment. The actual scoreboard height continues to reserve
  camera space. Short landscape controls receive additional clearance.
- Routine delivery results use a compact panel. Fours, sixes and wickets have
  larger headlines. `data-event` selects the styling; a supporting milestone line
  is populated by the presentation layer, never by scoring code.
- Dialogs use a brief entrance transition. Both the saved reduced-motion setting
  (`body[data-motion="reduced"]`) and OS preference disable decorative motion.
- The original bat-and-ball shield geometry is retained, recoloured to match
  the interface.

The title styles were consolidated, and 300 obsolete declarations that were
unconditionally superseded by later rules with the same selector were removed.
Gameplay layout rules were preserved to reduce risks around swipe targets,
safe areas and controls. No runtime UI framework or new rendering dependency
was introduced.

## Typography

The effective local font is Windows Bahnschrift, with its condensed face for
titles, followed by Arial Narrow and sans-serif fallbacks. Longer help text uses
Segoe UI/system sans for small-text legibility. No proprietary font is copied
or distributed, and there are no runtime font downloads or missing asset URLs.

Self-hosted open-license Teko and Rajdhani were researched but could not be
downloaded because the environment's automatic approval review failed. This
means exact typography will vary on devices without Bahnschrift. The remaining
cross-platform art-direction step is bundling those verified open-license
assets once downloading them is available; see the source/licensing status in
the reference document.

## Files

- `index.html`: mode-navigation hierarchy, setup sections and preview, event and
  milestone labels, graphics-settings explanation.
- `src/style.css`: theme, responsive layouts, controls and event styling.
- `src/setup.ts`: live conditions preview and semantic roster rows.
- `public/mark.svg`: palette alignment.
- `scripts/presentation-browser.ts`: repeatable UI regression checks.
- `src/main.ts`: parent milestone integration of event/milestone attributes and
  the startup fix that enables Help and Settings navigation.

## Verification and performance boundaries

Strict TypeScript validation and the complete presentation browser check pass
with no page errors. `scripts/presentation-browser.ts` checks
home-navigation bounds at 1440×900, 800×450, 390×844 and 360×640, setup selection
feedback and horizontal overflow, XI readiness after roster edits, and the
saved reduced-motion preference. It captures PNGs in
`docs/visual-evidence/presentation/`. It runs the source through Vite with
dependency prebundling disabled, to avoid the sandbox's parent-directory read
restriction; the main milestone capture separately verifies the production
bundle.

The first browser pass caught the short-landscape footer overlap, which was
corrected. It also exposed an existing startup defect: Help and Settings remained
disabled because only gameplay buttons were enabled after loading. The parent
milestone fixes that enable list and the browser check covers Settings access.

Preview/roster changes allocate only when a menu selection changes. The new
styling adds no per-frame JavaScript, GPU passes, images or remote requests.
Viewport checks in desktop Chromium emulate mobile dimensions; they do not
substitute for performance/legibility testing on physical phones or the
CrazyGames embed. Overall test results and measured render costs belong to the
main milestone report.
