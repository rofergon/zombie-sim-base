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
- Library science unlocks agriculture, power, fortifications and improved
  medicine. Research is persistent and never identified by display text.
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

## Script ownership

All scripts are classic IIFEs on `window.ZS`; `zone.html` defines the load
order and remains usable through `file://`.

| File | Responsibility |
|---|---|
| `js/zone/config.js` | Persistent IDs and tuning values |
| `js/zone/state.js` | Runtime clock and versioned persistence |
| `js/zone/map.js` | Dense terrain setup and building metadata |
| `js/zone/orders.js` | Input-created agent command queues |
| `js/zone/citizens.js` | Citizen identity, needs, roles and persistence snapshots |
| `js/zone/tasks.js` | Event-driven job board and salvage worker state machine |
| `js/zone/squads.js` | Shared squad orders, formation trail, patrol and inventory |
| `js/zone/scavenge.js` | Seeded loot, reveal, encounters and limited combat |
| `js/zone/adaptations.js` | Building costs, research, power, production and repairs |
| `js/zone/fortifications.js` | Placement, navigation ownership, persistence and automated defenses |
| `js/zone/defense.js` | Night transitions, horde pressure, structural damage and dawn report |
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

## Save v8

```text
{
  v: 8,
  world: { seed },
  clock: { day, minute, speed, paused },
  zone: {
    hqId, initialized, stock,
    nextCitizenId, citizens,
    nextJobId, jobs,
    nextSquadId, squads,
    nextFortificationId, fortifications,
    buildings,
    tech,
    defense
  }
}
```

`ZoneSave.migrateV3` through `ZoneSave.migrateV7` are pure/testable steps. A v3
campaign keeps seed, clock and HQ, then initializes its population exactly once
when the restored map is ready. Gameplay never branches on an old version.

## Later-phase boundary

Vehicles, trade, factions, laws and an OSM-backed real-world map remain out of
scope. Later work may deepen special-infected behaviors and add regional
strategy without moving those rules into the generic core.

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
save/load. `tests/zone-colony.js` covers v5 → v8 migration, construction
conservation, research, power, staffed production, active-defense
placement/navigation, squad combat orders, advance warning, enemy variants,
night recall, horde combat, structural damage and the dawn report. Every browser
suite uses `file://`.
