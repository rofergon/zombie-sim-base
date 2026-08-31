"use strict";

const assert = require("node:assert/strict");
const { assertNoErrors, launch, openSim } = require("./browser");

(async () => {
  const browser = await launch();
  const sim = await openSim(browser, "zone.html", { seed: 64217, fresh: 1, record: 1 });
  try {
    await sim.page.locator("#zone-hq-action").click();
    await sim.page.locator('[data-speed="0"]').click();

    const systems = await sim.page.evaluate(() => {
      const scenario = ZS.scenario,
        CFG = ZS.ZoneConfig,
        R = CFG.RESOURCE,
        K = CFG.SKILL;

      const migration = ZS.ZoneSave.migrate({
          v: 15,
          world: { seed: 7, configured: true, source: "procedural", size: "classic" },
          clock: { day: 2, minute: 500, speed: 1, paused: true },
          zone: { hqId: 3, initialized: true, citizens: [], squads: [], buildings: [] },
        }),
        capacity = scenario.logistics.capacity();
      scenario.state.stock.fill(0);
      scenario.state.stock[R.FOOD] = capacity - 2;
      scenario.state.stock[R.METAL] = 1;
      const cargo = Array.from({ length: R.COUNT }, () => 0);
      cargo[R.WOOD] = 3;
      const accepted = scenario.logistics.depositCargo(cargo),
        workshop = scenario.map.records.find(
          (record) => record !== scenario.map.hq && scenario.map.reachable(record),
        );
      workshop.use = CFG.BUILDING_USE.WORKSHOP;
      workshop.active = true;
      workshop.powered = true;
      workshop.hp = workshop.maxHP = 100;
      const productionBlocked = !scenario.adaptations.canProduce(workshop);

      const warehouse = scenario.map.records.find(
        (record) =>
          record !== scenario.map.hq && record !== workshop && scenario.map.reachable(record),
      );
      warehouse.use = CFG.BUILDING_USE.WAREHOUSE;
      warehouse.active = true;
      warehouse.hp = warehouse.maxHP = 100;
      const worker = scenario.citizens.byId.find(
        (citizen) => citizen && citizen.role === CFG.ROLE.WORKER,
      );
      worker.x = warehouse.cx;
      worker.y = warehouse.cy;
      scenario.logistics.clearTarget(worker);
      const nearestWarehouse = scenario.logistics.target(worker, false).id;

      scenario.state.stock.fill(0);
      scenario.state.stock[R.FOOD] = 60;
      scenario.state.stock[R.AMMO] = 80;
      scenario.state.stock[R.FUEL] = 20;
      const squad = scenario.squads.list[0],
        vehicle = scenario.vehicles.list[0],
        leader = scenario.citizens.at(squad.members[0]);
      scenario.squads.issueBoard(squad, vehicle, false);
      leader.x = vehicle.x;
      leader.y = vehicle.y;
      scenario.squads._updateLeader(leader, squad, 0.05, performance.now() / 1000, scenario.nav);
      for (let i = 0; i < squad.members.length; i++) {
        const member = scenario.citizens.at(squad.members[i]);
        member.bld = scenario.map.hq.id;
        member.x = scenario.map.hq.cx;
        member.y = scenario.map.hq.cy;
      }
      const recoveredVehicle = squad.vehicleId === vehicle.id,
        connected = scenario.regions.nodes.find(
          (node) =>
            !node.active &&
            !node.scouted &&
            node.links.some((id) => {
              const neighbor = scenario.regions.byId.get(id);
              return neighbor && neighbor.discovered;
            }),
        ),
        started = scenario.regions.start(connected.id, squad.id),
        expedition = { ...scenario.state.zone.expedition },
        awayDuringExpedition =
          squad.away && squad.members.every((id) => scenario.citizens.at(id).away),
        immobileWhileAway = scenario.maxSpeed(leader) === 0;
      scenario.regions.update(expedition.duration / CFG.CLOCK.MINUTES_PER_SECOND + 0.1);
      const returned = !squad.away && squad.members.every((id) => !scenario.citizens.at(id).away),
        cargoReturned = scenario.squads.inventoryTotal(squad) > 0,
        nodeScouted = connected.scouted;

      const activeSite = scenario.threats.list.find((site) => !site.cleared),
        siteRecord = scenario.map.at(activeSite.buildingId),
        pressureBefore = scenario.threats.nightMultiplier();
      siteRecord.encounterSpawned = false;
      const materialized = scenario.threats.materialize(siteRecord, squad.id),
        enemies = ZS.Sim.agents.filter((agent) => agent.zoneThreatId === activeSite.id);
      for (let i = 0; i < enemies.length; i++) scenario.scavenge.killEnemy(enemies[i]);
      const threatCleared = activeSite.cleared && activeSite.strength === 0,
        pressureAfter = scenario.threats.nightMultiplier();

      const raiderSite = scenario.threats.list.find(
          (site) => site.kind === CFG.THREAT.RAIDERS && !site.cleared,
        ),
        raiderRecord = scenario.map.at(raiderSite.buildingId);
      scenario.state.minute = CFG.CLOCK.DAY;
      scenario.state.stock[R.FOOD] = 30;
      scenario.state.stock[R.MEDICINE] = 0;
      raiderSite.lastRaidDay = scenario.state.day - CFG.THREATS.RAID_INTERVAL_DAYS;
      const foodBeforeRaid = scenario.state.stock[R.FOOD];
      scenario.threats.update();
      const raidLoss = foodBeforeRaid - scenario.state.stock[R.FOOD];
      raiderRecord.encounterSpawned = false;
      scenario.threats.materialize(raiderRecord, squad.id);
      const raider = ZS.Sim.agents.find((agent) => agent.zoneThreatId === raiderSite.id),
        raiderVisual = Boolean(raider && raider.zoneRaider);

      const exposed = scenario.citizens.at(squad.members[0]),
        infectionAdded = scenario.citizens.expose(exposed, 30);
      scenario.citizens.addSkill(exposed, K.COMBAT, CFG.CITIZEN.SKILL_XP_PER_LEVEL + 1);
      const combatLevel = exposed.skills[K.COMBAT];

      const populationBefore = scenario.citizens.stats().population;
      scenario.map.hq.capacity = populationBefore + 3;
      scenario.state.stock[R.FOOD] = Math.max(scenario.state.stock[R.FOOD], populationBefore * 4);
      for (let i = 0; i < scenario.citizens.byId.length; i++) {
        const citizen = scenario.citizens.byId[i];
        if (citizen) citizen.moral = 80;
      }
      scenario.state.day += CFG.CITIZEN.IMMIGRATION_DAYS;
      scenario.state.zone.lastImmigrationDay = scenario.state.day - CFG.CITIZEN.IMMIGRATION_DAYS;
      const arrivals = scenario.citizens.updateImmigration(),
        populationAfter = scenario.citizens.stats().population;

      scenario._capture();
      const normalized = ZS.ZoneSave.normalize(JSON.parse(JSON.stringify(scenario.state.data))),
        savedCitizen = normalized.zone.citizens.find((citizen) => citizen.id === exposed.cid),
        failingStorage = {
          getItem() {
            return null;
          },
          setItem() {
            const error = new Error("quota");
            error.name = "QuotaExceededError";
            throw error;
          },
        },
        failedSave = new ZS.ZoneSave(failingStorage),
        writeResult = failedSave.write(scenario.state.data);

      return {
        migration: {
          v: migration.v,
          resources: migration.zone.stock.length,
          vehicles: migration.zone.vehicles.length,
          threats: migration.zone.threats.length,
        },
        logistics: {
          accepted,
          left: cargo[R.WOOD],
          productionBlocked,
          nearestWarehouse,
          warehouseId: warehouse.id,
        },
        expedition: {
          recoveredVehicle,
          started,
          awayDuringExpedition,
          immobileWhileAway,
          duration: expedition.duration,
          returned,
          cargoReturned,
          nodeScouted,
        },
        threat: {
          materialized,
          defenders: enemies.length,
          threatCleared,
          pressureBefore,
          pressureAfter,
          raidLoss,
          raiderVisual,
        },
        population: {
          infectionAdded,
          combatLevel,
          arrivals,
          before: populationBefore,
          after: populationAfter,
          savedInfection: savedCitizen.infection,
          savedSkills: savedCitizen.skills,
        },
        sparseSave: {
          buildings: normalized.zone.buildings.length,
          mapBuildings: scenario.map.records.length,
        },
        saveFailure: { writeResult, error: failedSave.lastError },
      };
    });

    assert.deepEqual(systems.migration, { v: 16, resources: 11, vehicles: 0, threats: 0 });
    assert.deepEqual(systems.logistics, {
      accepted: 1,
      left: 2,
      productionBlocked: true,
      nearestWarehouse: systems.logistics.warehouseId,
      warehouseId: systems.logistics.warehouseId,
    });
    assert.equal(systems.expedition.recoveredVehicle, true);
    assert.equal(systems.expedition.started, true);
    assert.equal(systems.expedition.awayDuringExpedition, true);
    assert.equal(systems.expedition.immobileWhileAway, true);
    assert.ok(systems.expedition.duration < 180);
    assert.equal(systems.expedition.returned, true);
    assert.equal(systems.expedition.cargoReturned, true);
    assert.equal(systems.expedition.nodeScouted, true);
    assert.equal(systems.threat.materialized, true);
    assert.ok(systems.threat.defenders > 0);
    assert.equal(systems.threat.threatCleared, true);
    assert.ok(systems.threat.pressureBefore >= systems.threat.pressureAfter);
    assert.ok(systems.threat.raidLoss > 0);
    assert.equal(systems.threat.raiderVisual, true);
    assert.ok(systems.population.infectionAdded > 0);
    assert.ok(systems.population.combatLevel >= 1);
    assert.ok(systems.population.arrivals > 0);
    assert.equal(systems.population.after, systems.population.before + systems.population.arrivals);
    assert.ok(systems.population.savedInfection > 0);
    assert.ok(systems.population.savedSkills[0] >= 1);
    assert.ok(systems.sparseSave.buildings < systems.sparseSave.mapBuildings);
    assert.deepEqual(systems.saveFailure, {
      writeResult: false,
      error: "QuotaExceededError",
    });

    await sim.page.locator('[data-system="expedition"]').click();
    const expeditionText = await sim.page.locator("#zone-system-body").textContent();
    assert.match(expeditionText, /vehículos/i);
    assert.match(expeditionText, /combustible/i);
    assert.match(expeditionText, /focos activos/i);
    assertNoErrors(sim.errors, "zone evolution");
    process.stdout.write(
      "✓ v16 vehicles, occupied expeditions, storage logistics and surfaced save failures\n",
    );
    process.stdout.write(
      "✓ persistent lairs/raiders, infection, skills and housing-gated immigration\n",
    );
  } finally {
    await sim.context.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
