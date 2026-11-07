# Cricket presentation reference study

Researched 7 November 2026. These references inform CCL's original presentation;
they do not establish that CCL uses the proprietary games' fonts or artwork.

## Reference findings and CCL decisions

| Reference | Verified evidence | Design decision for CCL |
|---|---|---|
| [Real Cricket, official KRAFTON site](https://realcricket.krafton.com/) and [official game page](https://krafton.in/games/real-cricket/) | The official pages foreground match experience and licensed-team presentation. Indexed gameplay reference images place batting totals, overs, individual batters and bowler figures in a bottom strip, with timing and shot controls around the live pitch. | Keep the pitch central. Give the team total and overs the strongest numeric hierarchy, batters/bowler a stable second tier, and the next action its own clear control. |
| [WCC3, official Nextwave page](https://nextwavemultimedia.com/games/wcc3) | The publisher describes refined controls and motion-captured batting, bowling and fielding. Its gallery exposes [screenshot 1](https://nextwavemultimedia.com/images/games/wcc3/shot1.jpg) and [screenshot 2](https://nextwavemultimedia.com/images/games/wcc3/shot2.jpg). Indexed gameplay images show compact bottom match information, a separate field map and short action labels. | Use a consistent match HUD with condensed, upright labels. Keep setup decisions grouped around a clear match identity rather than a generic form. CCL's procedural player animation remains a distinct technical implementation. |
| [Vizrt: Hotstar IPL coverage case study](https://www.vizrt.com/case-studies/hotstar-indian-premier-league-cricket-vizrt/) | The supplier documents real-time lower thirds, player-stat graphics, camera perspectives and AR/VR analysis designed for Hotstar's cricket coverage, including mobile consumption. It includes [virtual-studio](https://cms.vizrt.com/wp-content/uploads/hotstar20viz20virtual20studio.jpeg) and [AR graphic](https://cms.vizrt.com/wp-content/uploads/hotstar20ar20graphic.jpg) examples. This is a historical case study, not verification of the exact 2026 IPL package. | Build a restrained sports-broadcast system: score strip, team identifiers, innings/result panels, and brief major-moment treatments. Typography, spacing and contrast carry the hierarchy; animation should clarify an event and then clear the field of play. |

The web tool returned page text and indexed screenshot descriptions. Direct
browser reference inspection was unavailable because automatic approval review
failed. These notes distinguish verified page claims from proposed visual
interpretation; they are not a pixel-accurate reconstruction of those games or
of any current IPL broadcast package.

## Implemented typography

The current build uses locally available **Bahnschrift**, falling back to
**Arial Narrow**, then the platform sans-serif. General interface text also
includes **Segoe UI** in its fallback stack; longer help copy uses Segoe UI.
The title, result headlines and match figures use upright condensed styling,
moderate weights and controlled tracking in place of the former Impact and
fake-italic treatment. No font binaries are bundled and no font CDN request is
made. These names select fonts already available on the player's device; they
do not redistribute Microsoft font files. Appearance will vary on devices
without Bahnschrift or Arial Narrow.

The researched asset direction was **Teko 500–600** for compact display titles
and **Rajdhani 500–700** for short UI labels, score figures and metadata. They
were selected for their screen/display proportions, not as identified fonts
from Real Cricket, WCC3 or IPL. Their binary download remains incomplete, so
the implementation does not reference either missing family or missing files.

Both researched families are authored by Indian Type Foundry according to
Google Fonts' official metadata. Sources:
[Rajdhani metadata](https://raw.githubusercontent.com/google/fonts/main/ofl/rajdhani/METADATA.pb),
[Teko metadata](https://raw.githubusercontent.com/google/fonts/main/ofl/teko/METADATA.pb),
[Rajdhani project](https://github.com/itfoundry/rajdhani),
[Teko project](https://github.com/itfoundry/teko).

## Researched font assets and license — not bundled

| Official Google Fonts source | Planned local path | Weight |
|---|---|---|
| [Rajdhani Medium](https://raw.githubusercontent.com/google/fonts/main/ofl/rajdhani/Rajdhani-Medium.ttf) | `public/fonts/Rajdhani-Medium.ttf` | 500 |
| [Rajdhani Semibold](https://raw.githubusercontent.com/google/fonts/main/ofl/rajdhani/Rajdhani-SemiBold.ttf) | `public/fonts/Rajdhani-SemiBold.ttf` | 600 |
| [Rajdhani Bold](https://raw.githubusercontent.com/google/fonts/main/ofl/rajdhani/Rajdhani-Bold.ttf) | `public/fonts/Rajdhani-Bold.ttf` | 700 |
| [Teko variable](https://raw.githubusercontent.com/google/fonts/main/ofl/teko/Teko%5Bwght%5D.ttf) | `public/fonts/Teko-Variable.ttf` | 300–700 |

Google Fonts publishes both under SIL Open Font License 1.1. The license
allows software bundling and embedding when its copyright/license notices
remain with the fonts. Retain the unmodified
[Rajdhani OFL](https://raw.githubusercontent.com/google/fonts/main/ofl/rajdhani/OFL.txt)
and [Teko OFL](https://raw.githubusercontent.com/google/fonts/main/ofl/teko/OFL.txt)
beside the font binaries if those assets are added later. A future local-font
implementation should serve same-origin files with `font-display: swap` and
preload only principal faces when measurements justify it.

**Sourcing status:** the sources and licenses were verified, but the binary
download was not executed. Sandbox networking denied the socket connection;
the initial and narrower single-file approval requests failed automatic review
with `content-blocked`. The user then explicitly approved a font-download
retry, and that retry also failed in the review service before execution.
This was not a finding that the font assets were unsafe. The font directory
is empty, and the CSS uses the local fallback stack described above.

## Originality and performance boundaries

No proprietary team logos, IPL marks, game screenshots, UI textures or player
likenesses are copied into CCL. The references guide composition and hierarchy.
The implemented local font selection adds no download, per-frame JavaScript
or GPU work. Desktop/mobile browser checks must verify fallback appearance,
text clipping, button hit areas and stable scoreboard layout. Rendering checks
on this Windows device cannot establish identical font metrics on Android,
iOS or Linux devices.
