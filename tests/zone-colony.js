"use strict";

const assert = require("node:assert/strict");
const { assertNoErrors, launch, openSim, pageUrl } = require("./browser");

(async () => {
  const browser = await launch();
  const sim = await openSim(browser, "zone.html", { seed: 54321, fresh: 1, record: 1 });
  try {
    const migrated = await sim.page.evaluate(() =>
      ZS.ZoneSave.migrate({
        v: 5,
        world: { seed: 77 },
        clock: { day: 3, minute: 500, speed: 1, paused: false },
        zone: { hqId: 2, initialized: false, buildings: [] },
      }),
    );
    assert.equal(migrated.v, 16);
    assert.equal(migrated.world.seed, 77);
    assert.equal(migrated.zone.tech.length, 8);
    assert.equal(migrated.zone.defense.active, false);
    assert.deepEqual(migrated.zone.fortifications, []);

    await sim.page.locator("#zone-hq-action").click();
    const colony = await sim.page.evaluate(() => {
      const scenario = ZS.scenario,
        CFG = ZS.ZoneConfig,
        R = CFG.RESOURCE,
        U = CFG.BUILDING_USE,
        T = CFG.TECH;
      scenario.map.hq.capacity = 1000;
      for (let i = 0; i < R.COUNT; i++) scenario.state.stock[i] = 200;
      const targets = scenario.map.records
        .filter((record) => record !== scenario.map.hq)
        .slice(0, 4);
      for (let i = 0; i < targets.length; i++) {
        targets[i].revealed = true;
        targets[i].cleared = true;
        targets[i].infectedRemaining = 0;
      }
      const materialTotal = () =>
        scenario.state.stock[R.WOOD] +
        scenario.state.stock[R.METAL] +
        scenario.state.stock[R.BRICK];
      const beforeCancel = materialTotal(),
        canceledJob = scenario.adaptations.start(targets[0], U.SHELTER);
      scenario.tasks.cancel(canceledJob.id);
      const afterCancel = materialTotal();

      function complete(record, use) {
        const job = scenario.adaptations.start(record, use);
        scenario.tasks.reconcile();
        const worker = scenario.citizens.at(job.assigned[0]);
        job.progress = CFG.TASK.BUILD_SECONDS;
        scenario.tasks._work(worker, job, 0.01);
        scenario.tasks.reconcile();
        return job;
      }

      function completeResearch(record, tech) {
        if (!scenario.adaptations.research(tech)) return false;
        const job = scenario.tasks.forBuilding(record.id),
          worker = scenario.citizens.at(job.assigned[0]);
        scenario.state.zone.research.progress = CFG.RESEARCH.WORK[tech];
        scenario.tasks._work(worker, job, 0.01);
        return scenario.state.zone.tech[tech];
      }

      complete(targets[0], U.RESEARCH);
      const science0 = scenario.state.stock[R.SCIENCE];
      const agriculture = completeResearch(targets[0], T.AGRICULTURE),
        greenhousesTech = completeResearch(targets[0], T.GREENHOUSES),
        powerTech = completeResearch(targets[0], T.POWER),
        fortificationsTech = completeResearch(targets[0], T.FORTIFICATIONS);
      complete(targets[1], U.POWER);
      complete(targets[2], U.FARM);
      const scienceAfterResearch = scenario.state.stock[R.SCIENCE];
      for (let i = 0; i < R.COUNT; i++) scenario.state.stock[i] = 0;
      scenario.state.stock[R.SCIENCE] = 100;
      scenario.adaptations.recalculatePower();
      scenario.tasks.reconcile();
      const production = scenario.tasks.forBuilding(targets[2].id),
        producer = scenario.citizens.at(production.assigned[0]),
        grain0 = scenario.state.stock[R.GRAIN];
      production.progress = CFG.ADAPT.FARM_SECONDS;
      scenario.tasks._work(producer, production, 0.01);
      const grain1 = scenario.state.stock[R.GRAIN];
      scenario.state.save();
      return {
        beforeCancel,
        afterCancel,
        researchUse: targets[0].use,
        generatorUse: targets[1].use,
        farmUse: targets[2].use,
        farmPowered: targets[2].powered,
        productionType: production.type,
        grain0,
        grain1,
        agriculture,
        greenhousesTech,
        powerTech,
        fortificationsTech,
        scienceSpent: science0 - scienceAfterResearch,
        ids: targets.slice(0, 3).map((record) => record.id),
      };
    });
    assert.equal(colony.beforeCancel, colony.afterCancel);
    assert.equal(colony.researchUse, 6);
    assert.equal(colony.generatorUse, 10);
    assert.equal(colony.farmUse, 9);
    assert.equal(colony.farmPowered, true);
    assert.equal(colony.productionType, 5);
    assert.equal(colony.grain1 - colony.grain0, 4);
    assert.equal(colony.agriculture, true);
    assert.equal(colony.greenhousesTech, true);
    assert.equal(colony.powerTech, true);
    assert.equal(colony.fortificationsTech, true);
    assert.equal(colony.scienceSpent, 42);

    await sim.page.goto(pageUrl("zone.html", { seed: 1, record: 1 }));
    await sim.page.waitForFunction(() => ZS.scenario && ZS.scenario.map.hq);
    const restored = await sim.page.evaluate(
      (ids) => ({
        version: ZS.ZoneConfig.SAVE_VERSION,
        uses: ids.map((id) => ZS.scenario.map.at(id).use),
        agriculture: ZS.scenario.state.zone.tech[ZS.ZoneConfig.TECH.AGRICULTURE],
        power: ZS.scenario.state.zone.tech[ZS.ZoneConfig.TECH.POWER],
        fortifications: ZS.scenario.state.zone.tech[ZS.ZoneConfig.TECH.FORTIFICATIONS],
        production: ZS.scenario.tasks.forBuilding(ids[2]).type,
      }),
      colony.ids,
    );
    assert.deepEqual(restored.uses, [6, 10, 9]);
    assert.equal(restored.agriculture, true);
    assert.equal(restored.power, true);
    assert.equal(restored.fortifications, true);
    assert.equal(restored.production, 5);

    const activeDefense = await sim.page.evaluate(() => {
      const scenario = ZS.scenario,
        CFG = ZS.ZoneConfig,
        F = CFG.FORTIFICATION,
        R = CFG.RESOURCE,
        nav = ZS.debug.nav,
        fortifications = scenario.fortifications,
        hq = scenario.map.hq;
      for (let i = 0; i < R.COUNT; i++) scenario.state.stock[i] = 200;

      function findSpot(kind, needsOpenNeighbor) {
        const originX = fortifications.snap(hq.cx),
          originY = fortifications.snap(hq.cy);
        for (let radius = 120; radius <= 680; radius += 40)
          for (let y = originY - radius; y <= originY + radius; y += 40)
            for (let x = originX - radius; x <= originX + radius; x += 40) {
              if (Math.max(Math.abs(x - originX), Math.abs(y - originY)) !== radius) continue;
              if (!fortifications.canPlace(x, y, kind)) continue;
              if (
                needsOpenNeighbor &&
                ![
                  [40, 0],
                  [-40, 0],
                  [0, 40],
                  [0, -40],
                ].some((offset) => nav.isWalkable(x + offset[0], y + offset[1], true))
              )
                continue;
              return { x, y };
            }
        return null;
      }

      const wallPoint = findSpot(F.WALL, true),
        wall = wallPoint && fortifications.place(wallPoint.x, wallPoint.y, F.WALL),
        wallNav = wall && nav.cellAt(wall.x, wall.y),
        gatePoint = findSpot(F.GATE, false),
        gate = gatePoint && fortifications.place(gatePoint.x, gatePoint.y, F.GATE),
        gateNav = gate && nav.cellAt(gate.x, gate.y),
        stockBeforeRemove = scenario.state.stock[R.WOOD],
        removedGate = gate && fortifications.removeAt(gate.x, gate.y, true),
        restoredGateNav = gate && nav.cellAt(gate.x, gate.y),
        refund = scenario.state.stock[R.WOOD] - stockBeforeRemove,
        replacedGate = removedGate && fortifications.place(gatePoint.x, gatePoint.y, F.GATE),
        towerPoint = findSpot(F.TOWER, false),
        tower = towerPoint && fortifications.place(towerPoint.x, towerPoint.y, F.TOWER);

      let towerTargetPoint = null;
      if (tower)
        for (let radius = 60; radius <= 180 && !towerTargetPoint; radius += 20)
          for (let direction = 0; direction < 8; direction++) {
            const angle = (direction / 8) * Math.PI * 2,
              x = tower.x + Math.cos(angle) * radius,
              y = tower.y + Math.sin(angle) * radius,
              muzzleX = tower.x + Math.cos(angle) * 25,
              muzzleY = tower.y + Math.sin(angle) * 25;
            if (nav.isWalkable(x, y, true) && nav.los(muzzleX, muzzleY, x, y, true, false)) {
              towerTargetPoint = { x, y };
              break;
            }
          }
      const towerTarget = towerTargetPoint
        ? scenario.makeAgent(towerTargetPoint.x, towerTargetPoint.y, 2)
        : null;
      if (towerTarget) {
        towerTarget.zoneEnemy = true;
        towerTarget.hp = towerTarget.maxHP = 100;
        ZS.Sim.agents.push(towerTarget);
      }
      for (let weapon = CFG.WEAPON.PISTOL; weapon < CFG.WEAPON.COUNT; weapon++)
        scenario.weapons.armory[weapon] = 0;
      scenario.weapons.armory[CFG.WEAPON.PISTOL] = 1;
      scenario.defense.data.active = true;
      const towerStaffed = fortifications.staffTowers(),
        towerOperator = tower && scenario.citizens.at(tower.operatorId);
      if (towerOperator) {
        towerOperator.x = tower.x + 28;
        towerOperator.y = tower.y;
        tower.occupied = true;
      }
      const towerTargetHP = towerTarget && towerTarget.hp,
        towerAmmo = scenario.state.stock[R.AMMO];
      for (let shot = 0; shot < CFG.AMMO_SHOTS_PER_UNIT; shot++) {
        tower.attackT = 0;
        fortifications.update(0);
      }
      const towerDamage = towerTarget ? towerTargetHP - towerTarget.hp : 0,
        towerAmmoUsed = towerAmmo - scenario.state.stock[R.AMMO];
      scenario.weapons.armory[CFG.WEAPON.PISTOL] = 0;
      fortifications.staffTowers();
      if (tower.operatorId !== null) tower.occupied = true;
      tower.attackT = 0;
      const bowTargetHP = towerTarget && towerTarget.hp,
        bowAmmo = scenario.state.stock[R.AMMO];
      fortifications.update(0);
      const bowDamage = towerTarget ? bowTargetHP - towerTarget.hp : 0,
        bowAmmoUsed = bowAmmo - scenario.state.stock[R.AMMO];
      scenario.defense.data.active = false;
      fortifications.releaseTowers();
      if (towerTarget) towerTarget.dead = true;

      const trapPoint = findSpot(F.TRAP, false),
        trap = trapPoint && fortifications.place(trapPoint.x, trapPoint.y, F.TRAP),
        trapTarget = trap ? scenario.makeAgent(trap.x, trap.y, 2) : null;
      if (trapTarget) {
        trapTarget.zoneEnemy = true;
        trapTarget.hp = trapTarget.maxHP = CFG.DEFENSE.TRAP_DAMAGE;
        ZS.Sim.agents.push(trapTarget);
      }
      fortifications.update(0.1);
      const trapTriggered = Boolean(
          trap && trapTarget && trapTarget.dead && !fortifications.atPoint(trap.x, trap.y),
        ),
        replacementTrapPoint = findSpot(F.TRAP, false),
        replacementTrap =
          replacementTrapPoint &&
          fortifications.place(replacementTrapPoint.x, replacementTrapPoint.y, F.TRAP);

      const attackOffsets = [
        [40, 0],
        [-40, 0],
        [0, 40],
        [0, -40],
      ];
      let wallAttackerPoint = null;
      for (let i = 0; wall && i < attackOffsets.length; i++) {
        const x = wall.x + attackOffsets[i][0],
          y = wall.y + attackOffsets[i][1];
        if (nav.isWalkable(x, y, true)) {
          wallAttackerPoint = { x, y };
          break;
        }
      }
      const wallAttacker = wallAttackerPoint
          ? scenario.makeAgent(wallAttackerPoint.x, wallAttackerPoint.y, 2)
          : null,
        wallHP = wall && wall.hp;
      if (wallAttacker) {
        wallAttacker.zoneEnemy = true;
        wallAttacker.attackT = 0;
        wallAttacker.enemyTarget = { x: hq.cx, y: hq.cy };
        ZS.Sim.agents.push(wallAttacker);
        scenario.defense.updateEnemy(wallAttacker, 0.1, performance.now() / 1000, nav);
        wallAttacker.dead = true;
      }

      const squad = scenario.squads.list[0],
        open = nav.nearestWalkable(hq.cx + 220, hq.cy, 320, false);
      scenario.debugSelectSquad(squad.id);
      const attackIssued = scenario.debugIssueAttackMove(open.x, open.y, false),
        attackOrder = squad.orders[0] && squad.orders[0].kind,
        attackState = squad.state,
        retreatIssued = scenario.debugRetreat(),
        retreatOrder = squad.orders[0] && squad.orders[0].kind,
        retreating = squad.retreating,
        garrisonIssued = scenario.debugIssueGarrison(hq.cx, hq.cy, false),
        garrisonOrder = squad.orders[0] && squad.orders[0].kind,
        garrisonState = squad.state;
      squad.orders.length = 0;
      squad.orderIndex = 0;
      squad.garrisonBuildingId = hq.id;
      squad.state = "garrisoned";
      for (let i = 0; i < squad.members.length; i++) {
        const member = scenario.citizens.at(squad.members[i]);
        if (member) member.bld = hq.id;
      }
      const garrisoned = scenario.squads.isGarrisoned(scenario.citizens.at(squad.members[0]));

      scenario.state.minute = CFG.CLOCK.NIGHT - 30;
      scenario.defense.update(0, performance.now() / 1000, nav);
      const warning = scenario.defense.warning(),
        alertTowerStaffed = tower.operatorId !== null;
      scenario.state.save();
      return {
        placed: Boolean(wall && replacedGate && tower && replacementTrap),
        wallNav,
        gateNav,
        restoredGateNav,
        refund,
        towerDamage,
        towerAmmoUsed,
        towerStaffed,
        bowDamage,
        bowAmmoUsed,
        alertTowerStaffed,
        towerCadence: CFG.DEFENSE.TOWER_SECONDS,
        trapTriggered,
        wallDamage: wall ? wallHP - wall.hp : 0,
        counts: fortifications.counts(),
        attackIssued,
        attackOrder,
        attackState,
        retreatIssued,
        retreatOrder,
        retreating,
        garrisonIssued,
        garrisonOrder,
        garrisonState,
        garrisoned,
        warning,
        variantSpeeds: [
          scenario.defense.enemySpeed({ zoneEnemyType: CFG.ENEMY.SHAMBLER }),
          scenario.defense.enemySpeed({ zoneEnemyType: CFG.ENEMY.RUNNER }),
          scenario.defense.enemySpeed({ zoneEnemyType: CFG.ENEMY.BRUTE }),
        ],
        variantDamage: [
          scenario.defense.enemyDamage({ zoneEnemyType: CFG.ENEMY.SHAMBLER }),
          scenario.defense.enemyDamage({ zoneEnemyType: CFG.ENEMY.RUNNER }),
          scenario.defense.enemyDamage({ zoneEnemyType: CFG.ENEMY.BRUTE }),
        ],
      };
    });
    assert.equal(activeDefense.placed, true);
    assert.equal(activeDefense.wallNav, 0);
    assert.equal(activeDefense.gateNav, 3);
    assert.equal(activeDefense.restoredGateNav, 1);
    assert.equal(activeDefense.refund, 2);
    assert.ok(activeDefense.towerDamage > 0);
    assert.equal(activeDefense.towerAmmoUsed, 1);
    assert.equal(activeDefense.towerStaffed, 1);
    assert.equal(activeDefense.bowDamage, 1);
    assert.equal(activeDefense.bowAmmoUsed, 0);
    assert.equal(activeDefense.alertTowerStaffed, true);
    assert.equal(activeDefense.towerCadence, 0.45);
    assert.equal(activeDefense.trapTriggered, true);
    assert.ok(activeDefense.wallDamage > 0);
    assert.deepEqual(activeDefense.counts.slice(1), [1, 1, 1, 1]);
    assert.equal(activeDefense.attackIssued, true);
    assert.equal(activeDefense.attackOrder, 6);
    assert.equal(activeDefense.attackState, "attack moving");
    assert.equal(activeDefense.retreatIssued, true);
    assert.equal(activeDefense.retreatOrder, 5);
    assert.equal(activeDefense.retreating, true);
    assert.equal(activeDefense.garrisonIssued, true);
    assert.equal(activeDefense.garrisonOrder, 2);
    assert.equal(activeDefense.garrisonState, "moving to garrison");
    assert.equal(activeDefense.garrisoned, true);
    assert.equal(activeDefense.warning.active, true);
    assert.equal(activeDefense.warning.minutes, 30);
    assert.match(activeDefense.warning.direction, /^(norte|este|sur|oeste)$/);
    assert.ok(activeDefense.variantSpeeds[1] > activeDefense.variantSpeeds[0]);
    assert.ok(activeDefense.variantSpeeds[2] < activeDefense.variantSpeeds[0]);
    assert.ok(activeDefense.variantDamage[2] > activeDefense.variantDamage[0]);

    const night = await sim.page.evaluate(
      ({ ids, warningDirection }) => {
        const scenario = ZS.scenario,
          CFG = ZS.ZoneConfig,
          R = CFG.RESOURCE;
        scenario.state.minute = CFG.CLOCK.NIGHT;
        scenario.defense.update(0.1, performance.now() / 1000, ZS.debug.nav);
        const started = {
          active: scenario.defense.data.active,
          remaining: scenario.defense.status().remaining,
          horde: ZS.Sim.agents.filter((agent) => agent.zoneHorde).length,
          recalled: scenario.squads.list.every((squad) =>
            squad.orders.some((order) => order.kind === CFG.ORDER.RETURN_HQ),
          ),
          preservedGarrison: scenario.squads.list.some(
            (squad) => squad.garrisonBuildingId !== null && squad.state === "garrisoned",
          ),
          warningDirectionMatches: scenario.defense.status().direction === warningDirection,
        };
        const squad = scenario.squads.list[0],
          member = scenario.citizens.at(squad.members[0]),
          enemy = ZS.Sim.agents.find((agent) => agent.zoneHorde),
          open = ZS.debug.nav.nearestWalkable(
            scenario.map.hq.cx + 180,
            scenario.map.hq.cy,
            300,
            false,
          );
        member.x = open.x;
        member.y = open.y;
        member.bld = -1;
        enemy.x = open.x + 24;
        enemy.y = open.y;
        enemy.hp = 1;
        squad.inventory[R.AMMO] = Math.max(1, squad.inventory[R.AMMO]);
        member.attackT = 0;
        scenario.scavenge.autoCombat(member, squad, 0.1, performance.now() / 1000, ZS.debug.nav);
        const killedBySquad = enemy.dead && scenario.defense.data.kills === 1;

        const farm = scenario.map.at(ids[2]),
          door = farm.shape.door,
          point = door ? door.front : farm,
          attacker = scenario.makeAgent(
            point.x === undefined ? point.cx : point.x,
            point.y === undefined ? point.cy : point.y,
            2,
          ),
          hp0 = farm.hp;
        attacker.zoneEnemy = true;
        attacker.zoneHorde = true;
        attacker.hp = attacker.maxHP = 3;
        attacker.attackT = 0;
        attacker.enemyTarget = { x: farm.cx, y: farm.cy };
        ZS.Sim.agents.push(attacker);
        for (let i = 0; i < scenario.citizens.byId.length; i++) {
          const citizen = scenario.citizens.byId[i];
          if (citizen) {
            citizen.x = scenario.map.world.w - 50;
            citizen.y = scenario.map.world.h - 50;
          }
        }
        scenario.defense.updateEnemy(attacker, 0.1, performance.now() / 1000, ZS.debug.nav);
        const structuralDamage = hp0 - farm.hp;
        for (let i = 0; i < ZS.Sim.agents.length; i++) {
          const enemy = ZS.Sim.agents[i];
          if (enemy.zoneHorde) scenario.defense.killEnemy(enemy);
        }
        scenario.defense.spawnRemaining = 0;
        scenario.defense.update(0.1, performance.now() / 1000, ZS.debug.nav);
        const report = scenario.defense.reportCard();
        return {
          started,
          paused: scenario.paused,
          report: report && report.title,
          completed: scenario.defense.data.lastCompletedDay,
          killedBySquad,
          structuralDamage,
        };
      },
      { ids: colony.ids, warningDirection: activeDefense.warning.direction },
    );
    assert.equal(night.started.active, true);
    assert.ok(night.started.remaining > 0);
    assert.ok(night.started.horde > 0);
    assert.equal(night.started.recalled, false);
    assert.equal(night.started.preservedGarrison, true);
    assert.equal(night.started.warningDirectionMatches, true);
    assert.equal(night.killedBySquad, true);
    assert.ok(night.structuralDamage > 0);
    assert.equal(night.paused, true);
    assert.match(night.report, /noche \d+ superada/);
    assert.ok(night.completed > 0);
    assert.equal(await sim.page.locator("#zone-night-status").count(), 1);
    await sim.page.goto(pageUrl("zone.html", { seed: 2, record: 1 }));
    await sim.page.waitForFunction(() => ZS.scenario && ZS.scenario.map.hq);
    assert.equal(await sim.page.evaluate(() => ZS.scenario.paused), true);
    assert.deepEqual(
      await sim.page.evaluate(() => ZS.scenario.fortifications.counts().slice(1)),
      [1, 1, 1, 1],
    );
    assert.match(
      await sim.page.evaluate(() => ZS.scenario.defense.reportCard().title),
      /noche \d+ superada/,
    );
    assert.equal(await sim.page.locator("#zone-phase").textContent(), "AMANECER");
    assert.equal(await sim.page.evaluate(() => ZS.scenario.defense.dismissReport()), true);
    assert.equal(await sim.page.evaluate(() => ZS.scenario.paused), false);

    assertNoErrors(sim.errors, "zone colony");
    process.stdout.write(
      "✓ v5 → v6 → v7 → v8 → v9 → v10 → v11 → v12 → v13 → v14 → v15 → v16 migration and adapted-building round-trip\n",
    );
    process.stdout.write(
      "✓ construction reservation, research, power and staffed food production\n",
    );
    process.stdout.write(
      "✓ deterministic night start, squad recall, horde clear and dawn report\n",
    );
    process.stdout.write(
      "✓ fortification navigation, warning, garrison, attack, retreat and persistence\n",
    );
  } finally {
    await sim.context.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
