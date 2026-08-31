# The Zone — architecture and implementation plan

`zone.html` is the colony-survival mode. It grows toward the day/night,
worker, squad and logistics loop described in the Infection Free Zone
implementation plan while keeping this repository's paper-sketch identity.

The existing pages remain independent regression targets:

- `index.html`: outbreak simulation
- `battle.html`: Cannae battle
- `hold.html`: tile-defense prototype
- `zone.html`: colony-survival game

## Shipped scope

### Phase 0 — foundation

- Dedicated `ScenarioZone`; no scenario-specific knowledge in the core.
- Stable numeric IDs for resources, jobs, building uses and orders.
- Version 3 save envelope with explicit v1 → v2 → v3 migrations.
- Seeded map identity and persisted headquarters/clock state.
- Browser smoke coverage for all four pages.
- Functional regression coverage for migrations, save/load, HQ setup,
  selection, orders and time controls.

### Phase 1 — RTS shell

- Dense procedural paper town (40–72 buildings in the audited seeds).
- Existing-building selection and player-chosen headquarters.
- Four-person starting survey team using the frozen survivor figure.
- Continuous six-real-minute day at ×1.
- Pause, ×1, ×2 and ×4 simulation speeds using fixed steps.
- Squad-first single, additive and drag-box selection: touching one member
  selects the complete squad, while worker selection remains available for
  forming new squads.
- Multi-squad contextual right-click movement, building-entry and scavenging
  orders, with separated ground destinations and Shift-queued paths.
- `V` then left-drag, or direct `Shift+RMB` drag, marks a scavenging area.
  Eligible buildings are divided into unique, balanced routes for the selected
  squads; a short `Shift+RMB` remains a normal queued contextual order.
- Runtime `Ctrl+1`–`Ctrl+9` control groups; number recalls a group and a quick
  second press centers the camera on it.
- A field-squad roster, contextual command bar, hover/order feedback, staged
  objectives, top resource strip and separate mission/selection panels.

### Phase 2 — citizens and work

- A stable-ID population of 16 citizens: four in the first squad and twelve
  workers. HP, morale, hunger, role, work state, assignment and cargo persist.
- Indexed settlement stock for food, wood, metal, brick, ammunition, medicine
  and reserved science materials.
- Event-driven task board with OFF/LOW/NORMAL/HIGH priorities, capacity,
  cancellation, replacement and low-frequency reconciliation.
- A complete salvage trip: walk to a finite seeded building cache, work, carry
  a bounded load, return to HQ and deposit without creating or losing cargo.
- Food consumption, starvation consequences, morale recovery and worker return
  to HQ during dusk/night.

### Phase 3 — squads and scavenging

- Persistent squads of at most four citizens, with worker-pool transfer,
  shared order queues, explicit HQ return and looping two-point patrols.
- One A* route per squad leader. Followers use a preallocated route trail and
  safe recovery when geometry leaves them far behind.
- Bounded squad inventories, numeric weapon IDs, ammunition use, medkits and
  machete fallback when firearm ammunition reaches zero.
- Seven deterministic POI types with finite resource/weapon loot and hidden
  infected counts derived from world seed plus building ID.
- Scavenge encounters materialize hidden infected exactly once, use the frozen
  zombie drawing, respect map LOS/walls, and end in partial loot, automatic HQ
  deposit/resume, or a fully looted building.
- Automatic deposit temporarily replaces only the active scavenge order. The
  unfinished building and every later area target survive save/load and resume
  after restocking.
- Save v5 with pure v3 → v4 and v4 → v5 migrations and storage-boundary
  normalization.

### Phase 4 — adaptation and settlement production

- Cleared existing buildings can be adapted through finite, refundable build
  reservations and the same event-driven worker board used by salvage.
- Shelter, warehouse, cookhouse, workshop, research center, medical bay,
  squad quarters, rooftop farm and generator uses have stable numeric IDs.
- Library science starts agriculture, power, fortifications and improved
  medicine projects. Research centers expose size-based staffing slots; every
  assigned inhabitant contributes linearly to persistent project progress while
  the center is active, powered and on the day shift. Staff without an active
  project slowly produces renewable science materials.
- Headquarters provides one base power unit; generators expand the network.
  Power is allocated deterministically and unpowered production pauses without
  consuming inputs.
- Staffed farms create food, staffed workshops convert metal to ammunition,
  cookhouses improve food efficiency and powered medical bays consume medicine
  to heal. Damaged structures can be repaired with wood and brick.

### Phase 5 — night defense

- Entering night once per campaign day starts a deterministic edge horde whose
  size grows by day. Squads return to HQ, restock and rally outside its door.
- Global infected reuse the frozen zombie figure, navigate with the zombie
  mask, acquire visible citizens and otherwise pressure the nearest adapted
  building or HQ.
- Existing squad auto-combat handles scavenging encounters and the global
  horde, including ammunition, melee fallback, medicine and citizen death.
- Structures have persistent HP. A breached HQ ends the night with a soft loss;
  clearing the horde advances to dawn. Both paths produce a dismissible report.
- Active saves keep separate unspawned and living counts so reload rematerializes
  pressure without serializing transient agents or multiplying the wave.

### Phase 6 — active perimeter defense

- A defense system panel places persistent 40 px-grid walls, human-only gates,
  ammunition-fed watchtowers and single-use traps on valid terrain around HQ.
  Removing a defense restores its navigation cells and refunds half its cost.
- Walls and towers block both movement masks; gates use the existing intact-door
  mask so citizens pass while infected stop and attack the perimeter.
- Dusk exposes a one-hour warning with a deterministic attack direction and a
  map arrow, giving the player time to prepare before the night transition.
- Squads have explicit attack-move, garrison and emergency-retreat commands.
  Garrisoned members gain firearm range and structural cover; retreating squads
  run faster to HQ and hold it when they arrive.
- Night hordes contain deterministic shamblers, faster fragile runners and slow
  brutes with extra health and structural damage. All variants retain the frozen
  survivor/zombie drawing contract.

### Phase 7 — geographic identity and regional scale

- A first-campaign selector searches places through Nominatim and prepares an
  OpenStreetMap extract through Overpass when hosted. Because current Overpass
  instances reject the null origin used by `file://`, double-click mode falls
  back to bounded, adaptively split requests to the official OSM map API. A
  deployment can override all service URLs through `window.ZS_GEO_ENDPOINTS`.
  The procedural generator remains an explicit, fully offline option.
- Initial-zone presets mirror the compact/medium/large choice of the reference
  loop: 1×1 (0.6 km), 3×3 (1.8 km) and 5×5 sectors (3 km). Existing campaigns
  keep the original 3200×2400 `classic` preset during v8 → v9 migration.
- Campaign creation has a confirmation step. When hosted, the selector uses the
  chosen city's Nominatim bounds and a practical urban zoom over visible
  OpenStreetMap tiles. The player can pan, use the wheel or +/− controls, and
  switch between `Ver ciudad`
  and `Ver zona`. The fixed central overlay preserves the real scale of the
  chosen 1×1/3×3/5×5 playable-sector grid, so city context and simulated area
  remain distinct. Only visible tiles are requested and attribution stays on
  screen. Double-click mode keeps the paper-vector fallback because standard
  tiles require a valid web referrer.
- `Preparar zona` then downloads just the selected extent. Its buildings, road
  hierarchy, water and relief are rendered in the paper style inside the grid;
  changing the center, size or relief invalidates that prepared extract until
  it is refreshed.
- Every OSM building inside the selected grid is simulated, selectable and
  lootable. Expeditions begin only beyond the selected 1×1/3×3/5×5 grid.
- OSM nodes, ways and multipolygon relations are normalized once into a stable,
  scenario-owned `MapPack`: polygonal buildings, named POIs, road hierarchy,
  water, land use, bounds, projection metadata and license attribution.
- Optional Terrarium elevation samples create contour lines, walking penalties
  on steep ground and a road movement bonus. Failure of the elevation service
  degrades to a flat map without preventing campaign creation.
- Large maps use lazy 1024 px ground/stain chunks, a bounded chunk cache, a
  low-resolution overview and a spatial feature index. No 12000×12000 canvas is
  allocated.
- MapPacks are cached in IndexedDB, can be exported/imported as JSON, and are
  referenced by ID and hash from the save rather than copied into localStorage.
- The fully simulated area is surrounded by a connected regional graph.
  Persistent three-hour expeditions consume supplies, scout adjacent sectors
  and return bounded resources without adding off-camera agents to hot loops.

### Phase 8 — human campaign and Project Aurora

- A three-act original campaign begins when the headquarters answers a medical
  transmission. Persistent radio events present resource-, housing- and
  squad-gated choices instead of detached flavor text.
- Rescue outcomes add named citizens through the normal persistent population
  path. New arrivals consume food, need shelter, join work assignments and can
  later transfer into squads exactly like the starting population.
- The Faros medical network, Cobalt caravan and Bastion pact keep independent
  −100…100 standing. Story choices unlock them, alter their trust and open one
  bounded resource exchange per faction per campaign day.
- The first settlement assembly unlocks Open Doors, Shared Rations and Health
  Protocol directives. A directive can change once per day and affects food,
  morale, recruitment, research or night pressure through explicit rules.
- Project Aurora advances through signal, viable sample, prototype, human trial
  and stable formula stages. Every laboratory step requires an active powered
  research center plus finite science and medicine.
- The completed formula offers three endings: keep it local, broadcast it to
  every receiver, or form a high-reputation coalition. The two open endings
  culminate in a reinforced final night; the epilogue is dismissible and the
  endless settlement simulation remains playable afterward.

### Phase 9 — IFZ-style cultivation

- Placed fields mirror the reference game's two scales: a normal field staffs
  two workers and a vast field staffs eight. Both use the shared task board,
  priorities and physical worker travel rather than a parallel timer.
- Fields and adapted greenhouses produce grain. One fertilizer changes a
  normal harvest from four to seven grain; vast-field inputs and outputs scale
  by four. Fertilization is an explicit per-site recipe and stalls when its
  input is missing.
- Adapted barns convert two grain into two raw meat plus one fertilizer.
  Cookhouses select either two grain plus wood for four rations or two meat
  plus wood for five. Citizens consume only finished rations.
- A deterministic 24-day seasonal cycle slows outdoor crop progress in cold
  weather. Greenhouses retain full speed, making winter staffing and food
  stockpiles meaningful.
- Fields are persistent sketch-drawn structures, respect buildings, water and
  perimeter placement, can be damaged by the night horde, and expose progress,
  staffing, priority, recipes and weather in the Cultivos panel.

## Script ownership

All scripts are classic IIFEs on `window.ZS`; `zone.html` defines the load
order and remains usable through `file://`.

| File | Responsibility |
|---|---|
| `js/zone/config.js` | Persistent IDs and tuning values |
| `js/zone/geo.js` | First-run selector, OSM adapters, MapPack normalization/cache/import/export |
| `js/zone/state.js` | Runtime clock and versioned persistence |
| `js/zone/map.js` | Dense terrain setup and building metadata |
| `js/zone/regions.js` | Connected outer-sector graph and timed expeditions |
| `js/zone/orders.js` | Input-created agent command queues |
| `js/zone/citizens.js` | Citizen identity, needs, roles and persistence snapshots |
| `js/zone/tasks.js` | Event-driven job board and salvage worker state machine |
| `js/zone/squads.js` | Shared squad orders, formation trail, patrol and inventory |
| `js/zone/scavenge.js` | Seeded loot, reveal, encounters and limited combat |
| `js/zone/adaptations.js` | Building costs, research, power, production and repairs |
| `js/zone/agriculture.js` | Field placement, seasons, crop recipes, persistence and sketch rendering |
| `js/zone/fortifications.js` | Placement, navigation ownership, persistence and automated defenses |
| `js/zone/defense.js` | Night transitions, horde pressure, structural damage and dawn report |
| `js/zone/campaign.js` | Human events, recruitment, factions, laws, trade, cure and endings |
| `js/zone/ui.js` | Persistent DOM controls only |
| `js/scenarios/zone.js` | Scenario contract and orchestration |

The two optional core extensions are deliberately scenario-agnostic:

- `Scenario.usesTimeScale` + `Scenario.timeScale` activate fixed simulation
  stepping in `js/sim.js`.
- `Scenario.drawBuildingOverlay(c, building, t)` decorates a generic town
  building after its normal sketch drawing.

`ZS.Buildings.generate(world, nav, options)` accepts density options. Calling
it without options follows the original generation path and random-number
sequence.

## Runtime invariants

1. Render time and simulation time are separate. Pausing stops state and
   agents but the canvas can still redraw/boil.
2. Accelerated time is divided into steps no larger than 50 ms. Physics and
   navigation never receive a large integration jump.
3. Orders allocate only when the player issues them. Agent updates reuse the
   queued records.
4. Only a squad leader asks A* for its route. Member formation targets and the
   leader trail are preallocated and reused in the hot path.
5. Persistent IDs are numbers. Labels may be renamed or translated without
   invalidating saves.
6. The Zone calls `ScenarioZombie.draw` for people instead of copying or
   modifying the frozen figure.
7. Every save is normalized at the storage boundary. Invalid or unknown
   versions fall back to a fresh state.

8. Settlement resources are conserved across building caches, carried loads,
   squad inventories and stock. Food/ammunition/medicine decrease only through
   their explicit consumption rules.
9. Hidden infected are persisted as counts, not agents. Once revealed, the
   remaining encounter count is authoritative across save/load.
10. A campaign's geographic map is immutable. The save stores its MapPack ID
    and hash; missing cached data returns to the selector instead of silently
    substituting different geometry.
11. Large maps allocate render surfaces per visible chunk. The classic pages
    retain the original single pre-rendered canvas path.
12. Campaign event IDs, choice IDs and outcomes persist independently from
    translated display text. Recruitment always uses `ZoneCitizens.recruit`;
    campaign code never creates a parallel population.

## Save v12

```text
{
  v: 12,
  world: {
    seed, configured, source, size,
    mapPackId, mapHash, name, center,
    projection, dataTimestamp, elevationSource
  },
  clock: { day, minute, speed, paused },
  zone: {
    hqId, initialized, stock,
    nextCitizenId, citizens,
    nextJobId, jobs,
    nextSquadId, squads,
    nextFortificationId, fortifications,
    nextFieldId, fields,
    buildings,
    regions, expedition,
    tech,
    research: { current, progress, materialProgress },
    defense,
    campaign: {
      act, pending, completed, history, flags,
      factions, law, lawChangedDay,
      cureStage, finalNight, endingPath, ending,
      endingUnread, lastEventDay, lastTradeDay
    }
  }
}
```

`ZoneSave.migrateV3` through `ZoneSave.migrateV11` are pure/testable steps. A v3
campaign keeps seed, clock and HQ, then initializes its population exactly once
when the restored map is ready. Gameplay never branches on an old version.

## Later-phase boundary

Vehicles remain out of scope. Later work may deepen special-infected behaviors,
add moving regional squads and faction settlements, and introduce renewable
geographic data without moving scenario rules into the generic core.

## Verification

```bash
npm run format
npm run lint
npm test
```

`tests/smoke.js` proves that every page initializes. `tests/zone-regression.js`
keeps phase 0/1 coverage. `tests/zone-workers.js` covers migrations, needs,
assignment, salvage/conservation and dusk. `tests/zone-squads.js` covers seeded
loot, formation/patrol, encounter combat, pause, inventory return/resume and
save/load. `tests/zone-colony.js` covers v5 → v12 migration, construction
conservation, power, staffed production, active-defense
placement/navigation, squad combat orders, advance warning, enemy variants,
night recall, horde combat, structural damage and the dawn report. Every browser
suite uses `file://`. `tests/zone-geo.js` covers deterministic OSM normalization,
polygon buildings and POIs, elevation, bounded chunk canvases, the first-run
selector, offline procedural fallback, the 5×5 preset and connected expeditions.
`tests/zone-campaign.js` covers v9 → v12, the radio choice UI, named recruitment,
reputation, daily trade, laws, all cure stages, the final-night multiplier,
epilogue and save/load persistence.
`tests/zone-research.js` covers researcher assignment, linear staffing speed,
passive science, start blockers and in-progress save/load. `tests/zone-farming.js`
covers the fertilized field → barn → meat cookhouse chain, greenhouse winter
immunity, finished-ration hunger, staffing and the v12 field/building round-trip.
