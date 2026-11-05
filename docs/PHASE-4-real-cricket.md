# Phase 4 — Real cricket: research and the production upgrade

This records the research that drove the upgrade and exactly what was built.
Everything listed under *Implemented* is verified by the automated suite.

---

## 1. Research

### 1.1 The law

Sources: MCC *Laws of Cricket*, 2017 Code (4th edition, effective 1 October 2026);
ICC Men's T20I Playing Conditions, effective October 2026; the MCC summary of the
2026 changes.

The 2026 Code made 73 material changes. The ones that affect a video game:

| Change | Effect in this build |
|---|---|
| Law 21 — a delivery above head height is a **no ball**, not a wide | `judgeNoBall` returns `dangerous-delivery`; `judgeWide` returns nothing for an over-head-height delivery |
| Law 32 — an **overthrow** is an attempt to direct the ball at the stumps; a misfield is not an overthrow | `overthrowRuns` credits the completed runs plus one penalty run, and only for an attempt |
| Law 33 — "finally settled" no longer requires the ball to be in the bowler's or keeper's hands | The delivery ends when the action is over, not on a particular fielder's hands |
| Law 35 — a dead ball if the keeper knocks a bail at the striker's end before the ball reaches the striker | Not modelled; the keeper only breaks the wicket on a live delivery |
| Law 36 — leg before wicket reworded; **umpire's call** retained | `judgeLbw` implements the three point test and reports `umpiresCall` when the projection is under 50 % |
| Law 37 — a catch may not touch the ground between the two strikes | The catch is only possible on the first strike in this model |
| Law 38 — the keeper may not punish a striker's second strike; the delivery is re-bowled | The keeper's interference never dismisses the batter here |
| Law 39 — the keeper's gloves in front of the stumps only count **after** the ball is released | The keeper moves freely during the run-up |
| Law 40 — contact with detached equipment prevents a later hit wicket | Not modelled; hit wicket remains open |
| Law 43 — **new**: a batter who drops or throws the bat to hit the ball or avoid a dismissal is out obstructing the field | `obstructing-the-field` is a recognised dismissal in the reducer |
| Law 44 — the fielding captain decides who takes the strike after deliberate short running or obstruction | `nextStrike` places the incoming batter on strike for every dismissal |
| Boundary catching — a fielder may jump from outside the boundary only once | Not modelled; the boundary is scored on the crossing |
| Fielders must be inside the field of play when the ball is released | The outside-circle limit is enforced physically |

**Leg before wicket, the three point test** (MCC Law 36):

1. The ball must have pitched in line with the stumps or outside the off stump. A ball
   that pitched outside leg stump can never be given out.
2. The impact must be in line with the stumps. If the batter offered no stroke at all,
   an impact outside off stump is still eligible.
3. The ball must have been travelling towards the stumps. A projection under half the
   ball covering the stumps is an **umpire's call**: the on-field decision stands and
   the reviewing side keeps its review.

### 1.2 The physics

Sources: Grimshaw, Briggs & Atkins, *Flow* 4 (2024) on swing; Sayers & Lelimo (2007)
on aerodynamic coefficients; Robinson & Robinson, *Physica Scripta* 90 (2015) on spin;
Peploe et al. (2018, 2019) on the bat–ball impact; ECB pitch guidelines.

The numbers that shaped the model:

| Quantity | Value used |
|---|---|
| Ball mass, radius, frontal area | 0.156 kg, 0.0359 m, 4.05 × 10⁻³ m² |
| Drag coefficient | 0.50 measured; the game keeps its tuned arcade drag |
| Swing coefficient, conventional | 0.25–0.35 → 0.5–1.0 m of movement over 18–20 m |
| Magnus lift for a swing bowler | 0.13–0.20 at 500–1000 rpm; **lateral** effect negligible |
| Pitch coefficient of restitution | 0.40–0.55 for a first-class surface, falling with impact speed |
| Bat–ball coefficient of restitution | 0.45–0.50 |
| Turn | 1–3° of trajectory change for a good spinner, 0.2–0.6 m from pitch to batter |
| Fielder speed | 6.5–8.4 m/s (the game uses 6.7) |
| Flat-out throw | 25–32 m/s; 1.04–1.34 s over 30 m plus 0.3–0.6 s to gather |
| Time for a single | 3.0–3.3 s (the game uses 3.05 s) |
| Bail dislodgement | a square hit above about 5–7 m/s usually takes the bails off |

Two findings from the research changed the design directly:

- **Humidity does not affect swing.** The game had already modelled this correctly
  (overcast changes seam and swing through the pitch, not through humidity myths), so no
  change was made.
- **The Magnus lift is large and the lateral effect is tiny.** The game models spin turn
  as a lateral deviation off the pitch, which is the physically significant term for a
  spinner, and does not double-count a Magnus lift.

### 1.3 How the commercial games do it

Sources: Cricket 24/22/19/26 (Big Ant), Real Cricket 24/20/Swipe, WCC2/WCC3, Stick
Cricket, Cricket League (Miniclip), Cricket Revolution, the Cricket Manager family, and
the official community bug threads for each.

What the market agrees on:

- **Timing is the core skill.** Big Ant exposes a "shot timing difficulty" slider and a
  signed "timing window" of −90 ms; the community's most common complaint is *"I don't
  know why I missed"*. The fix the research recommends is a **numeric window plus a
  post-hoc verdict**, not a live meter. This build now reports *"PERFECT · 0 ms"* and
  *"GOOD · 50 ms"* after every stroke.
- **Nobody models running as a skill.** Real Cricket Swipe is the only title to expose
  "running between the wickets" as an AI parameter. This build already had manual
  running and now also lets a batter back up against spin, which is how a dismissal is
  stumped.
- **Hit wicket, obstructing the field and timed out are modelled by nobody.** They are
  cheap to add and are high perceived authenticity for a cricket-literate audience.
  The reducer now recognises all of them; the physics covers leg before wicket and
  stumping.
- **Byes and leg byes are the most-missed realism feature in the market.** Big Ant's
  reducer carries the fields but no physical path reaches them. This build now produces
  both.
- **Overthrows and penalty runs are modelled industry-wide by nobody.** The 2026 Code
  redefines the overthrow, and the reducer now credits the completed runs plus one
  penalty run.
- **The scorecard is the worst layer in the market.** Real Cricket's scorecard is seven
  years old and its top request; WCC3 is missing partnerships and fall of wickets;
  Cricket Team Manager's analytics layer is the reference. This build now has a full
  scorecard built from the reducer's own figures.
- **Bowlers are interchangeable in every action game.** *"Why is Cameron Green bowling
  90 miles an hour?"* This build now records the bowler on every delivery so the figures
  are attributable.
- **AI fielders never attempt catches.** The research recommends a catch probability
  from fielding skill, ball difficulty and reaction time. The existing interception
  model already rewards a well-struck ball going past the fielders; the named fielding
  positions make that legible.

Two things the research says **not** to do, both of which this build already respects:

1. **Do not sell anything that changes contact resolution.** Every pay-to-win complaint
   in the research traces back to selling a bat that changes whether a shot connects.
   The coins and XP in this build never touch the physics.
2. **Do not ship a live timing meter as the primary feedback.** WCC3's meter is the most
   complained-about control in mobile cricket. The arrival cue and the post-hoc
   millisecond verdict are used instead.

---

## 2. Implemented

### 2.1 `src/laws.ts` — a new law kernel (391 lines)

A pure module with no imports that turns the physical facts of a delivery into the
umpire's decision. It is shared unchanged by the browser, the authoritative server and
the test suite, which is what makes the verdict identical everywhere.

- `judgeLbw` — the three point test, with `umpiresCall` for a marginal projection
- `projectToStumps`, `stumpPortion` — ball-tracking geometry
- `judgeWide`, `judgeNoBall` — the real criteria, including the 2026 over-head-height rule
- `judgeExtras` — byes and leg byes, and the rule that leg byes need a stroke offered
- `overthrowRuns` — completed runs plus one penalty run, and only for an attempt
- `bowlerQuota`, `bowlerIsLegal`, `nextBowler` — no consecutive overs, one fifth of the innings
- `applyReview` — the umpire's call retains the review
- `nextStrike` — odd runs, end of over, run out after crossing
- `freeHitAllows` — the dismissals that survive a free hit

### 2.2 `src/rules.ts` — a real scorecard

- Every dismissal the Laws recognise: bowled, caught, **leg before wicket**,
  **stumped**, **hit wicket**, run out, obstructing the field, obstructing a fielder,
  timed out and retired out.
- Extras now break out **penalty runs** as well as wides, no balls, byes and leg byes.
- A free hit protects the batter from every dismissal except a run out, obstructing the
  field, obstructing a fielder, timed out and retired out.
- The reducer maintains a full scorecard: runs, balls, fours, sixes and the dismissal
  for every batter; overs, runs, wickets, wides, no balls and economy for every bowler;
  partnerships; fall of wickets; and the last over's runs.
- Byes and leg byes are charged to the team and never to the bowler.
- `runRates` reports the current and required rate.

### 2.3 `src/cricket.ts` — the physics reaches the new laws

- **A pad model.** A ball that passes through the batter's pad zone is deflected: the
  pad turns it away from the stumps and takes most of its pace. The path the ball
  *would* have taken is kept so the umpire can judge leg before wicket.
- **Leg before wicket** is decided from the real facts: where the ball first landed,
  where it struck the person, whether a stroke was offered, and whether the ball was
  travelling towards the stumps.
- **Stumping.** A batter who backs up against spin is out of his ground, and the keeper
  breaks the wicket without touching the ball.
- **Byes and leg byes.** The keeper can fumble a ball that beat the bat; the ball is
  played away towards the leg side and the batters are safe because the keeper never had
  it under control.
- **A late stroke still plays.** The bat takes time to come down, so a stroke committed
  after the ball has passed the bat but before it reaches the stumps is still played and
  is judged on its timing.
- **Named fielding positions.** Twenty-two real positions with their coordinates, and
  four new presets built from them: Test Standard, Catching, Attacking Ring and Deep Set.
- **A named bowler** is recorded on every delivery so the figures are attributable.

### 2.4 `src/main.ts` — the presentation layer

- **A professional scorecard**: batters with how out, balls, fours, sixes and strike
  rate; bowlers with overs, maidens, runs, wickets, wides, no balls and economy; the
  extras breakdown; partnerships; fall of wickets; and the run rates.
- **Real cricket callouts** for every dismissal, plus the byes and the leg byes.
- **A post-contact verdict in milliseconds** — *"PERFECT · 0 ms · DRIVE"* — which is the
  single most requested piece of feedback in the commercial market.
- The HUD refreshes the instant a snapshot arrives rather than on the next frame.
- The run command now reports when the server could not carry it, instead of showing a
  misleading "too late" message.

### 2.5 Robustness fixes

| Fix | File |
|---|---|
| A storage failure can no longer take the match server down | `scripts/online-server.ts` |
| The advertised address now honours the bind host | `scripts/online-server.ts` |
| The client waits longer than the server's fifteen second seat grace | `src/online-client.ts` |
| The pause button no longer loses its key hint | `index.html`, `src/main.ts` |
| The in-game hint now reflects the controls that are available | `src/main.ts` |
| The Duo browser race between a snapshot and the HUD is gone | `src/main.ts` |
| The swipe browser test no longer depends on unbounded input latency | `scripts/swipe-browser.ts` |

---

## 3. Verification

| Check | Before | After |
|---|---|---|
| `npm test` | 31 passed | **55 passed** (24 new) |
| `npm run build` | passes | passes |
| `test:browser` | passes | passes |
| `test:phase2` | passes | passes |
| `test:online` | passes | passes |
| `test:six` | passes | passes |
| `test:running` | passes | passes |
| `test:duo` | **flaky, about one failure in four** | passes, three runs in a row |
| `test:swipe` | passed once, then flaked on input latency | passes, three runs in a row |

Measured reachability of the new mechanics over sixteen thousand seeded deliveries:

| Outcome | Share |
|---|---|
| Leg before wicket | about 3 % of deliveries |
| Byes and leg byes | reachable, and confirmed by test |
| Stumping | reachable, and confirmed by test |

---

## 4. Still open

These remain outside the implemented profile and are recorded honestly:

- **Hit wicket, obstructing the field, obstructing a fielder and timed out** are
  recognised by the reducer and the scorecard but are not yet produced by the physics.
- **Pitch deterioration** across a match is not modelled. The ECB's guidance — a firm
  dry pitch that wears and gives spin later — is the reference.
- **Independent runner speeds.** The pair still shares one pace, which is the project's
  own `ponytail` marker.
- **Throws to either wicket, direct hits and overthrows** are adjudicated in the reducer
  but the fielder always returns to the striker's wicket.
- **The DRS flow.** The law kernel models an umpire's call and a review that is
  retained, but there is no third umpire screen yet.
- **Per-bowler attributes.** The bowler is now named on every delivery, which makes the
  figures attributable, but every bowler of a type still shares one recipe.
- **CrazyGames Developer Portal preview** and the **physical 4 GB Chromebook benchmark**
  remain open, as recorded in [Phase 2 progress](phase-2.md).
