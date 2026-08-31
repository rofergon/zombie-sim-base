# AGENTS.md — The Outbreak (sketch zombie sim)

A hand-drawn, "boiling line" sketch-style sim. Four HTML pages share one
core: `index.html` (the outbreak, a zombie horde in a paper town),
`battle.html` (Cannae, 216 BC, 781-figure battle), and `hold.html` (The
Hold, a tile-based zombie clicker — design in HOLD-DESIGN.md), and `zone.html`
(The Zone, a colony-survival RTS — design in ZONE-DESIGN.md). Vanilla JS,
Canvas 2D. No framework, no build step, no bundler — and it must stay that
way (see Hard constraints).

## Run it

Double-click any of them (file:// protocol), or serve the
directory with any static server. That's the whole build. `package.json`
scripts are dev tooling only (format/lint).

## Hard constraints

1. **Must stay double-clickable (file://).** All code is classic
   `<script src>` tags + IIFEs sharing one `window.ZS` namespace. **No ES
   modules** (CORS-blocked on file://), no imports, no build output.
2. **The style is the product.** Everything is drawn with the sketch
   primitives in `js/sketch.js` (wobbly lines that re-jitter every 140 ms —
   the "boil"). New visuals must use those primitives and the paper palette.
   Landscape may carry subtle color washes; the ink line work stays.
3. **Agent look/animation is frozen.** The agent drawing
   (`ScenarioZombie.draw` in `js/scenarios/zombie.js`) is a verbatim port of
   the original in `example/index.html`. Do not restyle it. If a feature
   needs new agent visuals, ask first.
4. **`example/index.html` is the reference original** (pre-split, single
   file). Behavior and numbers were ported from it; keep it untouched and
   use it to resolve "what was the original way?" questions.
5. **No per-frame allocations in hot loops** (910 agents). Reuse arrays and
   records; decay-and-prune instead of rebuild.
6. **Format with oxfmt, lint with oxlint** (Oxc tooling). Run before
   finishing any change; both must be clean (0 warnings/errors).

## Architecture

Two layers, one contract between them:

index.html / battle.html / hold.html / zone.html (same core order, scenario additions differ)
└── <script> load order (matters):
<script>var ZS_SCEN = "ScenarioCannae";</script> ← battle.html only
<script>var ZS_WW=1600; var ZS_WH=1200; var ZS_SCEN="ScenarioHold";</script> ← hold.html only
js/sketch.js style primitives (boil, wline, wcirc, wpoly, lerpC…)
js/grid.js spatial hash
js/nav.js A* pathfinding + walkability mask
js/camera.js pan/zoom/pinch camera, clamped to the world
js/world.js paper world (3200×2400 default; a page may set
ZS_WW/ZS_WH before the tags), water, forest, pre-render
js/buildings.js procedural town (rooms, doors, occupancy)
js/stains.js generic persistent-stamp layer (splats, corpses)
js/tiles.js optional square ground grid (the Hold): nav marking + sketch render
js/agents.js generic entity engine (AI pass, separation, clamp)
js/sim.js game clock (rounds, reinforcements, tap)
js/scenarios/zombie.js | cannae.js | hold.js | zone.js the SCENARIO PACK (contract below)
js/draw.js scene + HUD pipeline (calls back into the scenario)
js/phaser-renderer.js optional Phaser/WebGL compositor (Hold + Zone; keeps
visible ground sectors in bounded CanvasTextures and packs blocks, buildings,
trees and agents into shared sketch atlases; Zone uses a bounded overview/LOD
for large maps and falls back to Canvas actors on software WebGL; textures
for agents/trees update at boil cadence, while Zone buildings use stable 2×
textures that refresh only when their visual state changes; transforms update
every frame; the large-map overview carries permanent sketch building ink so
LOD never removes exterior outlines)
js/sound.js WebAudio cues (sketch-quiet blips/booms + the formant
voice lines; unlocks on first pointerdown; the scenario
names the events)
js/main.js bootstrap: world, camera, input, main loop

`zone.html` additionally loads
`js/zone/{config,state,map,orders,citizens,tasks,gathering,squads,scavenge,campaign,ui}.js` and
`js/scenarios/zone.js`. It loads the zombie scenario class as a drawing
dependency so Zone people and encounter infected call the frozen
`ScenarioZombie.draw` directly.

**The core (`js/*.js`) knows nothing about zombies.** It runs the clock,
physics, spacing, navigation, camera, and rendering pipeline, and calls the
scenario for everything scenario-specific. **The scenario pack owns** who the
agents are, how they look, move, talk, fight, bleed, and how a round plays
out. A different scenario is a copy of a scenario pack plus a page that sets
`var ZS_SCEN` to the new class name (battle.html is the example).

### Frame flow

`main.js` loop (rAF, dt clamped to 50 ms):

1. `ZS.setBoil(t)` — advances the boil timer (line jitter epoch)
2. `ZS.Sim.update(dt, t, world, W, H)`:
   - scenarios with `usesTimeScale` opt into fixed steps of at most 50 ms;
     `timeScale` 0 pauses and 1/2/4 advances at the requested rate
   - if `scenario.left(agents) === 0` → after the town-fall beat
     (`scenario.beatT || 3` seconds, or immediately if the scenario sets
     `skipBeat`, consumed on the `wave++`), `wave++` and
     `scenario.init(...)` (new round); otherwise `scenario.maintain(...)`
     (edge reinforcements)
   - `ZS.updateAgents(agents, dt, t, world, wave)`:
     1. rebuild spatial grid; per-agent `id`, `flash`/`sayT` decay
     2. `scenario.frame(agents, dt, t, grid)` — scenario-wide logic
        (panic-by-voice propagation in the zombie pack)
     3. **two AI passes**: `scenario.hostile(a)` agents first (they get the
        A* budget), then the rest — each via `scenario.update(a, dt, t, grid,
nav, world, buildings, wave)`
     4. door-shake + transient-fx decay
     5. **separation**: every unordered pair within `SEP_R` (18 px, or the
        scenario's optional `sepR` property — dense battle formations sit at
        slot spacing and would inflate at 18 px) gets a soft push; within
        `SEP_CORE` (10 px) a hard positional push (`corePush`, wall-aware)
     6. walkability fix-up (nobody ends inside a wall — or inside water
        unless the scenario sets `swim`), page margins, `scenario.maxSpeed(a)`
        cap (× `SWIM_FRAC` 0.25 while in water for swim-capable scenarios),
        integrate, stuck-timer, building occupancy (the `inCount`/`survCount`
        resets happen _after_ the AI pass — the pass reads the previous
        frame's tallies, never zeroes; the refill happens during
        integration)
     7. dead / off-field compaction (dead or `a.gone` agents leave the array)
3. `ZS.drawScene(...)`: pre-rendered paper background → water → the
   scenario's `drawGround` pass (the Hold's tile washes) → stains →
   y-sorted trees/buildings/agents (`scenario.draw` per agent) → optional
   `scenario.drawOverlay` → `scenario.drawFX` → speech bubbles → HUD from `scenario.hud(agents,
wave)`. The scene list is culled to the camera, so **fps scales with how
   much world is visible** (fit view = whole world ≈ 40–50 fps; zoomed ≈
   display refresh).

### Core `ZS` surface

| export                                                  | what it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ZS.rnd, ZS.clamp, ZS.rng32, ZS.hash`                   | random/util (hash is deterministic)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `ZS.setBoil, ZS.jit, ZS.sjit`                           | boil epoch + per-seed jitter                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `ZS.wline, ZS.wcirc, ZS.wpoly, ZS.sketchRect, ZS.lerpC` | sketch drawing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `ZS.Grid`                                               | spatial hash (insert/query)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `ZS.Nav`                                                | `isWalkable(x,y,isZ)`, `isWater(x,y)`, `astar(x1,y1,x2,y2,isZ,maxExpand,swim)`, `los(x1,y1,x2,y2,isZ,swim)`, `nearestWalkable`, `randLand`, `inForest`; `version` bumps when the map changes. The `swim` flag (from the scenario's `swim` property) makes water cells passable at 4x cost — the swim is taken only when it beats the detour; without it water is a hard block. `los` intermediate cells carry the ray's own mask (a zombie-side ray stops at intact doors/walls); the _endpoint_ tests the human mask, so a ray that reaches a floor/door/land point is sightable from every side (broken doors pass both)                                                                                 |
| `ZS.World`                                              | terrain, water, forest, pre-rendered paper, `trees`, `buildings`, `stains`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `ZS.Buildings`                                          | town generator + `cellBldAt` occupancy lookup                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `ZS.Stains`                                             | persistent stamp canvas; `register(kind, painter)`, `splat`, `corpse`, `fillBlob`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `ZS.Tiles`                                              | optional square ground grid (`set`, `stroke`, `drawAll`); water tiles hard-block the nav grid                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `ZS.makeAgent`                                          | core alias → `scenario.makeAgent`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `ZS.updateAgents`                                       | the core per-frame entity pipeline (above)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `ZS.fx`                                                 | transient effect records (`{t}` — core decays/prunes)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `ZS.planAndFollow, ZS.wander, ZS.wanderTarget`          | movement helpers for scenarios (A*-bounded steering)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `ZS.Camera`                                             | `fit`, `zoom`, `x/y`, `clamp`, `toWorld`, `autoSeek(x, y, z, dt, vw, vh, ease)` — exponential chase, `ease` a time constant in seconds (default 0.7; the zombie pack passes its own)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `ZS.Sim`                                                | `agents`, `wave`, `init`, `counts`, `update`, `tap`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `ZS.sound`                                              | `event(name, x, y)`, `tick(dt)`, `unlocked` — WebAudio cues (no assets), spatialized against the camera, per-name cooldowns, unlocked on first pointerdown; event names owned by the scenario (zombie map: `shot_rifle/shot_shotgun/shot_smg/shot_gren/boom/moan/door_break/fire/turret/horn` + the formant voice lines `v_shout/v_gasp/v_mumble/v_laugh/v_grunt/v_callout/v_groan/v_growl/v_chomp/v_mama/v_spit/v_zedshout` — moving F1/F2/F3 bandpasses over a detuned double-saw glottis, ported 1:1 from `.verify/voices.html`; `moan` picks a random dark zombie line; `boom` is a full phrase: soft-clipped shock crack, falling bandpass body, saw sub, resonant rumble tail, debris, distant echo) |
| `ZS.drawScene`                                          | the render pipeline                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `ZS.scenario`                                           | the live scenario pack instance                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `ZS.debug`                                              | `{ cam, world, nav, buildings, scenario }` — verification + future player/vehicle hook                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## The scenario contract

`ScenarioZombie` implements this surface (signatures verified in
`js/scenarios/zombie.js`; the file's header block is the canonical list):

| method                                                | role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `attachStains(st)`                                    | register splat/corpse painters (`st.register(kind, painter)`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `terrain(world, nav)`                                 | optional: lay your own battlefield instead of the random town (skips water/forest/town/trees); the Hold builds its tile grid here                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `drawGround(c, world, t)`                             | optional: per-frame ground pass after water, before everything with height (the Hold's tile render)                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `pointerDown/Move/Up(x, y)`                           | optional: claim a pointer gesture (true from `pointerDown` = the camera never pans for that pointer); the Hold's dig-drag                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `makeAgent(x, y, st, extra)`                          | the agent record (core fields + scenario fields)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `hostile(a)`                                          | true → AI updated first (A* budget priority)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `walkBlocked(a)`                                      | true → building interiors/doors are solid for this agent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `maxSpeed(a)`                                         | per-agent speed cap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `sepR` (property, optional)                           | this pack's separation radius (cannae: 13, packed ranks)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `swim` (property, optional)                           | true → water is a soft block: A* crosses river/lake/pond when the swim (4x cell cost) beats the detour, LOS sees across it, and in-water speed is capped at `SWIM_FRAC` 0.25 of `maxSpeed` (zombie pack only; cannae/hold stay hard-blocked — Hold's dug moats use tile water, which never enters the water mask)                                                                                                                                                                                                                                                             |
| `beatT` (property, optional)                          | town-fall beat in seconds (zombie: 4.5 — the dawn report card holds it up); core defaults to 3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `skipBeat` (property)                                 | set true to dismiss the town-fall beat early (consumed on the `wave++`); the zombie pack's tap on the dawn card                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `paused` (property)                                   | true → `Sim.update` returns early: the world waits (the Hold's results card; probe scripts use it to freeze the sim for deterministic camera tests)                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `usesTimeScale` / `timeScale` (properties, optional)  | opt into fixed-step speed control; 0 pauses and positive values scale simulation time without changing render/boil time (the Zone)                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `frame(agents, dt, t, grid, nav)`                     | once per frame, before the AI pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `update(a, dt, t, grid, nav, world, buildings, wave)` | per-agent AI                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `init(agents, world, vw, vh, wave)`                   | start a round (fills the array)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `maintain(agents, dt, world, vw, vh)`                 | between rounds (reinforcements)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `left(agents)`                                        | "players" still standing; 0 → new round                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `counts(agents)`                                      | HUD stats (`surv, zomb, shel, guard`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `tap(agents, world, x, y)`                            | what a pointer tap does (zombie: calls a sky-fall artillery strike, 8 s cooldown; while the town has fallen it dismisses the dawn card via `skipBeat`)                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `hud(agents, wave)`                                   | `{ title, stats, hint, legend(c, y, fs, vw, vh), overlay() }` — `vw`/`vh` optional (the zombie pack uses them for the threat arrow); `overlay()` may return `{ card }` for a sketched results card                                                                                                                                                                                                                                                                                                                                                                            |
| `draw(c, a, t)`                                       | one agent, all of it (frozen look)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `drawBuildingOverlay(c, building, t)`                 | optional: decorate a generic town building immediately after its normal sketch render (the Zone's selection/HQ flag)                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `drawOverlay(c, t)`                                   | optional: render persistent world-space overlays above actors (the Zone's selected squad routes and drag marquee)                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `drawFX(c, fx)`                                       | render transient effect records                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `camInterest(dt)`                                     | optional (CONTRACT B): what the auto-camera watches — `main.js` calls it every frame when defined and feeds `Camera.autoSeek`; return a `{x, y, zoom, ease?}` record (the zombie pack reuses a module-level `CI` record — no per-frame allocs) or null to hold still; the zombie pack eases a focal point to the heat-weighted centroid of hot zones (`h > 10`), zooms by their spread (1.45 / 1.15 / 0.95) and pulses on booms/grenades; drag, pinch or wheel input hands the camera back for the session — a tap doesn't (it's an action: sound unlock, the artillery call) |

**Core-owned agent fields** (don't clobber): `x y vx vy a st seed gait id
wantMove dead free gone path pi gx gy navV0 planFailT stuckT wx wt px py bld`,
presentation lifetimes `flash` and `sayT` (the core decays both). A speech
bubble shows while `a.say` is set and `a.sayT > 0` (`a.sayMax` = total time).
The scenario owns everything else on the record (`st` semantics, `gun`,
`inf`, `scareT`, `muzzle`, shelter/path state, …).

**Transient effects** are pushed onto `this.fx` (aliased to `ZS.fx` by
`main.js`) as records carrying `t`; the core decays and prunes them. Zombie
pack shapes: tracer `{x0,y0,x1,y1,t}`, poof `{x,y,t,poof,seed}`, blood
`{x,y,t,blood,seed}` (`blood` 1=bite, 2=rifle, 3=shotgun/kill).

## Zombie pack mechanics (the knobs live at the top of `js/scenarios/zombie.js`)

- **States**: `st` 0 = survivor, 1 = infected (turning, shivers, then
  zombie), 2 = zombie. `a.gun` + `st < 2` = guard (soldier behavior).
- **Water is a soft block** (`swim = true`): river/lake/pond cells pass
  `astar` at 4x cost and `los` outright, so a chase across the water swims
  the shortest crossing at `SWIM_FRAC` 0.25 speed (≈ 14-30 px/s) and a
  pack spawns/reaches a district on the far side of the river when no land
  route is cheaper. Walls, intact doors and building interiors are still
  hard blocks.
- **Population**: `baseCount = clamp(vw*vh/1100, 36, 910)`; `maintain`
  tops up to `baseCount + 8` with edge spawn wanderers.
- **Zombies** (`_updateZombie`): sight `PERC` 340 (`PERC_FOREST` 150 in tree
  cover), **gated on `nav.los(agent, prey, true)`** — no lock through walls
  or intact doors; chase last-known point for ~2.5 s after losing sight,
  touch-infect within `INFECT` 19 (bite chance → `st=1`), chew doors at
  `DOOR_DPS` 30. Packs gnawing a door inside an occupied house adopt the
  residents by **scent** (whole-town scan of `survCount > 0` houses with an
  intact door — the occupancy tallies the AI pass reads, see the frame
  flow) and convert them on breach.
- **Survivors** (`_updateSurvivor`): panic within `FLEE` 180 (also
  LOS-gated — a survivor doesn't spook on a zombie behind a wall), run to
  `_pickShelter` (scored `dist + inCount*600 + survCount*60` — a full house
  loses to an empty one next door), or panic-run with no shelter; panic
  also propagates by **voice** — shouts (`_tryShout`, capped at `SAY_MAX`
  simultaneous bubbles) spook survivors within `HEAR_R` even with no
  zombie in sight.
- **Defense corps** (`_updateDefender`): one squad per district (size 3–6,
  mix in `SQUAD_MIX`), an arc of slots facing the district's shared threat,
  fallback lines to the town core (`state` 1), one **door sentry** per
  district holding the nearest intact door, and a **turret** on the gap
  (`TURRET_HP` 8, contact damage) with its own **gunner**: an ordinary
  rifleman (`crewFor`) who walks to and holds the slot; the gun only
  fires while manned (crew alive, `st < 2`, within 120 px) and an
  unmanned emplacement is drawn dark. One soldier per district is
  quietly promoted to `wep="grenade"` (drawn like a rifleman — no
  special look) and throws at the district's crisis via `_grenadeThrow`
  (door pack first, else densest pack). FIGHTER civilians join as
  unattached `civ` gunners.
- **Rovers** (`ROVER_N` 4, `ROVER_SEE` 400): unattached riflemen spawned on
  open land at wave start. A zombie in `ROVER_SEE` closes to a 100px
  standoff and fires via the shared defender fire section; with no threat
  they work the district posts in turn (`rvI % squad count`, 5 s dwell).
  Same damage model as soldiers; they count in the `guard` tally.
- **In-wave escalation**: `waveAge` (seconds into the wave) grows pack
  size, shortens the spawn cadence, fires a once-per-wave **surge** at the
  weakest post after 60 s (`PACK_CAP + wave`, capped 22), and doubles pack
  spawns after 120 s. Horde size stays defense-dependent by design; the
  _pressure_ escalates.
- **Fire respects walls**: every ignition path — the ground-fire tuft loop
  in `frame()`, burning-contact spread (`_updateBurning`), and the blast
  (`_boom`) — is gated on `nav.los(source, target, true)`. Walls and intact
  doors block fire; a broken door passes. All ignition rates are tuned
  self-limiting (a burn peak dies out in ~30 s; no town-wide chains).
- **Rounds**: when `left() === 0` the town has fallen; `frame()` latches
  `fell` (wave tally, doors held, the horde's press direction) and the
  HUD serves the **dawn report card** through `overlay()`; after the
  `beatT` 4.5 s beat the `wave` increments and `init` respawns (initial
  zombies `min(1 + floor(wave * 0.7), 6)`). A **tap calls a sky-fall
  artillery strike** (0.9 s grenade flight into the shared `_boom`, 8 s
  cooldown) — or, while the town is fallen, dismisses the card
  (`skipBeat`). The hint line and legend reflect both.
- **Separation constants** are core (`js/agents.js`): `SEP_R` 18, `SEP_CORE`
  10, `SEP_FORCE` 130, `CELL` 26, `NAV_BUDGET` 10 A* searches/frame.
  Expect min pairwise distance ~10 px in open ground and 7–8 px in crowded
  building interiors (walls block the hard push) — that's by design, not a
  bug.

## Cannae pack mechanics (`js/scenarios/cannae.js`)

- **Shape**: 781 figures (352 rome east, facing west; 429 carthage west,
  facing east). Every agent holds a slot in a formation whose centroid a
  per-unit step script drives (`HOLD/ADV/RET/CHARGE/DIS/SKIRM/ROUT`); combat
  is local (nearest enemy in reach), so the battle shape emerges from the
  scripts + morale + separation.
- **Choreography**: the carthaginian center deploys as a salient (bulged
  front), yields backward on contact, then wheels into a crescent that closes
  on the pressed roman center (`trigger1` = contact, `trigger2` = the roman
  center crossed into the pocket); Hasdrubal's heavy cav (south wing) and the
  Numidians (north wing) sweep around to the roman rear and strike the rout.
- **End condition**: the battle ends only on total annihilation —
  `sides[s].dead + sides[s].gone >= sides[s].total0`. Routed men set
  `a.free` (the core skips their margin/clamp) and stream to the nearest
  world edge; crossing the edge marks them `a.gone` (tallied in `frame`).
  Winner units whose scripts are exhausted hunt the nearest routed enemy until
  none remain (`HUNT_FRAC` 0.6), then hold the field when it is over.
- **Pacing knobs**: `UNIT_SPD` (heavy advance 40, cav 172 charge), `ATK_CD`
  0.75, `SLNG_R` 190, `EXIT_PAD` 30, `HUNT_R` 900. A full battle runs
  ~60-100 s; the check script asserts 45-180 s.

## Hold pack (`js/scenarios/hold.js`, design in `HOLD-DESIGN.md`)

A sketch-style zombie clicker: one ring of soldiers on a 1600×1200 tile
world (40×30 of 40px tiles), day/economy → night/horde loop. Build is in
progress per HOLD-DESIGN.md — P1 (tiles + dig) is done: drag the ground to
dig water/sand/road (5 dig per tile, 20 per day, keys 1–4); water is a hard
block in the nav grid so a dug moat holds. Still to come: blocks/economy/
save (P2), the soldier ring + upgrades (P3), night waves + the dawn report
(P4), clicker furniture (P5), balance (P6). `ZS.Tiles` (`js/tiles.js`)
owns the grid, nav marking, and render; the scenario owns the rules.

Engine hooks the Hold needed (all opt-in, no-ops for the other pages):
`ZS_WW`/`ZS_WH` page sizing in `main.js`, the `terrain`/`drawGround`/
pointer hooks (contract table above), and null-water guards in
`world.build()` / `drawWater` (tile worlds have no river or lake).

## Zone pack (`js/scenarios/zone.js`, design in `ZONE-DESIGN.md`)

The colony-survival mode has shipped phases 0–9: a dense seeded paper town,
player-chosen HQ, persistent citizens and settlement stock, salvage workers,
controllable squads, patrol, deterministic POIs/loot, and limited scavenging
encounters, followed by adapted buildings, research, power, staffed production,
global night defense, geographic maps, the human campaign and IFZ-style
cultivation. The initial population is 16 (four in the first squad and twelve
workers). Vehicles remain later work.

- **Save schema**: `SAVE_VERSION = 14`. Pure migrations advance v1 through
  v12 into the current structure. `ZoneSave.normalize` is the only legacy or
  corrupt-data boundary; gameplay only reads v14.
- **Citizens** (`js/zone/citizens.js`): stable numeric IDs, HP, morale, hunger,
  role, work state, assignment, cargo and squad membership. Dusk/night returns
  non-critical workers to HQ; resting recovers morale.
- **Jobs** (`js/zone/tasks.js`): the board is dirty/event-driven, plus a
  low-frequency safety reconciliation. Workers never scan every task per
  frame. Salvage caches and carried loads are finite and conserved through
  cancellation, replacement and save/load.
- **Gathering** (`js/zone/gathering.js`): IFZ-style drag areas claim finite
  tree/abandoned-building nodes for wood or metal, draw paper-blue work markers
  and persist felled trees without duplicating the settlement inventory.
- **Squads** (`js/zone/squads.js`): at most four citizens, one order queue and
  one leader A* path. Followers use preallocated formation targets/a leader
  trail, with a safe nearest-walkable recovery only when badly separated.
  MOVE=1 and ENTER=2 remain unchanged; SCAVENGE, PATROL and RETURN_HQ append to
  those IDs. Area-scavenge commands distribute unique buildings across selected
  squads; an automatic HQ deposit replaces only the active order so the rest of
  the route persists and resumes after restocking.
- **Scavenging** (`js/zone/scavenge.js`): POI, loot and hidden infected derive
  once from `world.seed + building.id`. Hidden threats stay abstract until
  reveal. Remaining encounter count is authoritative in saves; materialization
  is once per runtime. Full inventory returns to HQ, deposits, restocks and
  resumes unfinished loot.
- **Adaptation** (`js/zone/adaptations.js`): cleared buildings reserve finite
  construction materials, then workers adapt them. Stable research unlocks,
  deterministic power allocation, staffed greenhouses/barns/cookhouses and
  workshops, medical healing and repairs stay scenario-owned.
- **Agriculture** (`js/zone/agriculture.js`): two- and eight-worker outdoor
  fields produce grain, seasonal cold slows them, greenhouses ignore weather,
  and fertilizer changes a normal yield from four to seven. Barns create meat
  plus fertilizer; cookhouses turn grain or meat into edible rations.
- **Night defense** (`js/zone/defense.js`): one deterministic edge wave per
  night recalls and restocks squads, targets citizens or persistent structures,
  and ends in a dawn report. Saves keep abstract unspawned/living counts rather
  than transient horde agents.
- **Human campaign** (`js/zone/campaign.js`): stable event/choice IDs drive
  named recruitment, three faction standings, daily trade, settlement laws,
  Project Aurora cure stages and persistent endings. Open endings modify the
  existing night-defense pressure instead of spawning a second combat system.
- **Resource invariant**: stock + worker cargo + squad inventories + building
  caches changes only through explicit consumption or production recipes.
- **Verification**: `tests/zone-workers.js`, `tests/zone-squads.js`,
  `tests/zone-colony.js`, `tests/zone-farming.js` and `tests/zone-campaign.js`
  extend the four-page smoke and phase-0/1 regression suites, always through
  `file://`.

## Style system (`js/sketch.js`)

- **Boil**: `ZS.setBoil(t)` sets the epoch; `ZS.jit(seed)` / `ZS.sjit(seed)`
  return a per-seed jitter for the current epoch — the "hand redrawing the
  lines" effect (~7 re-jit/s). Every wobbly shape takes a seed so it wiggles
  stably.
- **Primitives**: `wline` (jittered polyline), `wcirc` (wobbly circle),
  `wpoly` (wobbly polygon, optional fill), `sketchRect`, `lerpC` (color lerp).
- **Palette**: paper `#f3edde`, page body `#efe8d8`, ink `#3d342b`,
  ink-soft `rgba(61,52,43,0.5)`; landscape washes are low-alpha pastels
  (water `rgba(96,138,166,0.20)`, grass `rgba(122,148,84,0.10)`, trees
  `rgba(112,148,72,0.30)`, buildings tan). Keep new color in that register.

## Tooling & verification (how we work)

- **Format/lint** (Oxc): `npm run format` / `npm run lint` (or `npx oxfmt
js/` / `npx oxlint js/` in an interactive terminal). From non-TTY
  automation, run the local bins directly — `npx` can hang without a TTY:
  `node node_modules/oxfmt/bin/oxfmt js/` and
  `node node_modules/oxlint/bin/oxlint js/` (stdin detached). No config
  files; Oxc defaults are the house style (e.g. it wraps long calls and adds
  trailing commas — don't hand-fight it).
- **Browser tests: Playwright 1.62.1 (local devDependency).**
  `require("playwright")` from `D:/dev/zombie-sim` resolves; browsers live in
  `%LOCALAPPDATA%/ms-playwright` (builds use a `chrome-win64` subdir, not
  `chrome-win`). For performance work use **headed + `channel: "chrome"`**
  (the user's real browser with GPU); headless numbers run ~20–30% low.
  The shared headless browser tooling on this machine has document script
  execution disabled — never use it for JS verification.
- **Perf expectations** (RTX 4090 box): fit view (whole 3200×2400 world on
  screen, 910 agents) ≈ 40–50 fps; zoomed ≈ 144 fps (display-capped). The
  scene culls to the camera, so zoom level drives fps. Don't "fix" fit-view
  fps by culling agents — the look is the product.
- **Scratch area: `.verify/`** — verification scripts live here
  (`split-check.js` fidelity checker, `regression.js`, fps probes,
  screenshots). One-off diff scripts get deleted after use; reusable checks
  stay.
- **`js.bak/`** — full pre-refactor backup (the single-module engine). Use it
  to diff behavior; delete it once the split is battle-tested.
- **Fidelity-check pattern** (for any future port/move of code): strip
  comments, whitespace, and trailing commas from both sides, extract the
  moved body, apply a map of the _intended_ renames, and assert the old body
  is a substring of the new file. `.verify/split-check.js` is a working
  example.
- **Page-side inspection**: `ZS.debug` exposes `{ cam, world, nav,
buildings, scenario }` — use it in `page.evaluate` for counts, camera
  state, and custom audits.

## Change recipes

- **Tune a behavior** → constants at the top of `js/scenarios/zombie.js`.
  Don't touch the core for scenario concerns.
- **New scenario** → copy `js/scenarios/zombie.js` (or `cannae.js` for a
  large-battle feel), rename the class, add a page that sets
  `var ZS_SCEN = "ScenarioName";` before the script tags (battle.html is the
  template — same tags, one line in `main.js` picks the class by name),
  reimplement the contract. Core stays untouched.
- **Core change** → keep it scenario-agnostic. If the core starts needing
  "is this a zombie?" knowledge, that's a signal to add a scenario callback
  (`hostile`/`walkBlocked`/`maxSpeed` are the precedent).
- **Moving code between files** → run the fidelity-check pattern afterward;
  "reimplemented from memory" is how bits silently drift (it already cost us
  a `fillBlob` radius and a color constant).

## Future work (known, not started)

Player control + vehicles. Design for it (the `ZS.debug` handle, the
walkability mask, and the generic draw/scenario split all exist for this)
but don't implement it yet. Whatever ships keeps the exact sketch style.
