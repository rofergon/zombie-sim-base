"use strict";

const assert = require("node:assert/strict");
const { assertNoErrors, launch, openSim, pageUrl } = require("./browser");

(async () => {
  const browser = await launch();
  const sim = await openSim(browser, "zone.html", { seed: 13579, fresh: 1, record: 1 });
  let deterministicContext = null;
  try {
    const deterministic = await sim.page.evaluate(() =>
      ZS.scenario.map.records.slice(0, 8).map((record) => ({
        poi: record.poi,
        salvage: record.salvage.slice(),
        loot: record.loot.slice(),
        weapons: record.lootWeapons.slice(),
        infected: record.infectedRemaining,
      })),
    );
    const second = await openSim(browser, "zone.html", { seed: 13579, fresh: 1, record: 1 });
    deterministicContext = second.context;
    const deterministicAgain = await second.page.evaluate(() =>
      ZS.scenario.map.records.slice(0, 8).map((record) => ({
        poi: record.poi,
        salvage: record.salvage.slice(),
        loot: record.loot.slice(),
        weapons: record.lootWeapons.slice(),
        infected: record.infectedRemaining,
      })),
    );
    assert.deepEqual(deterministicAgain, deterministic);
    await deterministicContext.close();
    deterministicContext = null;

    await sim.page.locator("#zone-hq-action").click();
    const initial = await sim.page.evaluate(() => ({
      squads: ZS.scenario.squads.list.length,
      members: ZS.scenario.squads.list[0].members.length,
      squadRoles: ZS.scenario.squads.list[0].members.every(
        (id) => ZS.scenario.citizens.at(id).role === ZS.ZoneConfig.ROLE.SQUAD,
      ),
      jobs: ZS.scenario.squads.list[0].members.every(
        (id) => ZS.scenario.citizens.at(id).jobId === null,
      ),
    }));
    assert.deepEqual(initial, { squads: 1, members: 4, squadRoles: true, jobs: true });

    const created = await sim.page.evaluate(() => {
      const scenario = ZS.scenario;
      scenario.debugSelectWorkers(5);
      const before = scenario.citizens.stats().free,
        squad = scenario.squads.create(scenario.selected, false);
      return {
        before,
        after: scenario.citizens.stats().free,
        members: squad.members.length,
        noJobs: squad.members.every((id) => scenario.citizens.at(id).jobId === null),
      };
    });
    assert.equal(created.members, 4);
    assert.equal(created.after, created.before - 4);
    assert.equal(created.noJobs, true);

    const move = await sim.page.evaluate(() => {
      const scenario = ZS.scenario,
        squad = scenario.squads.list[0],
        hq = scenario.map.hq,
        p1 = ZS.debug.nav.nearestWalkable(hq.cx + 260, hq.cy + 80, 300, false),
        p2 = ZS.debug.nav.nearestWalkable(hq.cx - 180, hq.cy + 220, 300, false);
      scenario.debugSelectSquad(squad.id);
      let astar = 0;
      const original = ZS.debug.nav.astar;
      ZS.debug.nav.astar = function (...args) {
        astar++;
        return original.apply(this, args);
      };
      scenario.debugIssueMove(p1.x, p1.y, false);
      ZS.recording.advance(4);
      ZS.debug.nav.astar = original;
      const paths = squad.members.map((id) => Boolean(scenario.citizens.at(id).path));
      scenario.debugIssueMove(p2.x, p2.y, true);
      return { id: squad.id, p1, p2, astar, paths, orders: squad.orders.length };
    });
    assert.ok(move.astar > 0 && move.astar < 8, "only the leader should spend the route budget");
    assert.equal(move.paths.slice(1).some(Boolean), false);
    assert.equal(move.orders, 2);

    const patrol = await sim.page.evaluate(({ id, p1, p2 }) => {
      const scenario = ZS.scenario,
        squad = scenario.squads.at(id),
        leader = scenario.citizens.at(squad.members[0]),
        x0 = leader.x,
        y0 = leader.y;
      scenario.debugSetPatrol(id, [p1, p2], true);
      ZS.recording.advance(18);
      let formation = 0;
      for (let i = 1; i < squad.members.length; i++) {
        const member = scenario.citizens.at(squad.members[i]);
        formation = Math.max(formation, Math.hypot(member.x - leader.x, member.y - leader.y));
      }
      return {
        moved: Math.hypot(leader.x - x0, leader.y - y0),
        formation,
        loop: squad.patrolLoop,
        points: squad.orders.length,
        routePaths: squad.routePaths.length,
        routeNodes: squad.routePaths.reduce((sum, path) => sum + (path ? path.length : 0), 0),
      };
    }, move);
    assert.ok(patrol.moved > 30);
    assert.ok(patrol.formation < 120, "formation spread: " + patrol.formation);
    assert.equal(patrol.loop, true);
    assert.equal(patrol.points, 2);
    assert.equal(patrol.routePaths, 2);
    assert.ok(patrol.routeNodes > 0, "patrol visualization should retain navigable route legs");

    const contextualUI = await sim.page.evaluate(({ id }) => {
      const scenario = ZS.scenario,
        squad = scenario.squads.at(id),
        routeCanvas = document.createElement("canvas"),
        routeContext = routeCanvas.getContext("2d"),
        originalLine = ZS.wline;
      let dottedSegments = 0;
      scenario.debugSelectSquad(id);
      ZS.wline = function (context, ...args) {
        if (context.getLineDash().length) dottedSegments++;
        return originalLine.call(this, context, ...args);
      };
      scenario.drawOverlay(routeContext);
      ZS.wline = originalLine;
      const squadView = {
        inspector: scenario.ui.inspector.hidden,
        roster: scenario.ui.roster.hidden,
        card: scenario.ui.card.hidden,
        commands: scenario.ui.commandBar.hidden,
        title: scenario.ui.title.textContent,
      };
      const building = scenario.map.records.find((record) => record !== scenario.map.hq);
      scenario.debugSelectBuilding(building.id);
      const buildingView = {
        inspector: scenario.ui.inspector.hidden,
        roster: scenario.ui.roster.hidden,
        card: scenario.ui.card.hidden,
        commands: scenario.ui.commandBar.hidden,
        title: scenario.ui.title.textContent,
      };
      scenario._clearSelection();
      scenario.selectedBuilding = null;
      scenario._refreshSelection();
      const emptyView = {
        inspector: scenario.ui.inspector.hidden,
        roster: scenario.ui.roster.hidden,
        card: scenario.ui.card.hidden,
        commands: scenario.ui.commandBar.hidden,
        toggle: scenario.ui.rosterToggle.hidden,
      };
      scenario.toggleSquadRoster();
      const rosterView = {
        inspector: scenario.ui.inspector.hidden,
        roster: scenario.ui.roster.hidden,
        card: scenario.ui.card.hidden,
        commands: scenario.ui.commandBar.hidden,
        expanded: scenario.ui.rosterToggle.getAttribute("aria-expanded"),
      };
      scenario.debugSelectSquad(squad.id);
      return { squadView, buildingView, emptyView, rosterView, dottedSegments };
    }, move);
    assert.deepEqual(contextualUI.squadView, {
      inspector: false,
      roster: true,
      card: false,
      commands: false,
      title: "Patrulla " + move.id + " · 4/4",
    });
    assert.equal(contextualUI.buildingView.inspector, false);
    assert.equal(contextualUI.buildingView.roster, true);
    assert.equal(contextualUI.buildingView.card, false);
    assert.equal(contextualUI.buildingView.commands, true);
    assert.match(contextualUI.buildingView.title, /^edificio /);
    assert.deepEqual(contextualUI.emptyView, {
      inspector: true,
      roster: true,
      card: true,
      commands: true,
      toggle: false,
    });
    assert.deepEqual(contextualUI.rosterView, {
      inspector: false,
      roster: false,
      card: true,
      commands: true,
      expanded: "true",
    });
    assert.ok(contextualUI.dottedSegments >= 6, "selected patrol route should be dotted");

    await sim.page.evaluate(() => ZS.scenario.state.save());
    await sim.page.goto(pageUrl("zone.html", { seed: 999, record: 1 }));
    await sim.page.waitForFunction(() => ZS.scenario && ZS.scenario.map.hq);
    const patrolRestored = await sim.page.evaluate(() => ({
      agents: ZS.Sim.agents.filter((agent) => agent.zoneCitizen).length,
      squadMembers: ZS.scenario.squads.list.reduce((sum, squad) => sum + squad.members.length, 0),
      loop: ZS.scenario.squads.list[0].patrolLoop,
      orders: ZS.scenario.squads.list[0].orders.length,
    }));
    assert.equal(patrolRestored.agents, 16);
    assert.equal(patrolRestored.squadMembers, 8);
    assert.equal(patrolRestored.loop, true);
    assert.equal(patrolRestored.orders, 2);

    const encounter = await sim.page.evaluate(() => {
      const scenario = ZS.scenario,
        squad = scenario.squads.list[0];
      scenario.squads.clearOrders(squad);
      scenario.debugSelectSquad(squad.id);
      let target = null,
        bestThreat = -1,
        bestDistance = Infinity;
      for (let i = 0; i < scenario.map.records.length; i++) {
        const record = scenario.map.records[i],
          distance = Math.hypot(record.cx - scenario.map.hq.cx, record.cy - scenario.map.hq.cy);
        if (
          record !== scenario.map.hq &&
          (record.infectedRemaining > bestThreat ||
            (record.infectedRemaining === bestThreat && distance < bestDistance))
        ) {
          target = record;
          bestThreat = record.infectedRemaining;
          bestDistance = distance;
        }
      }
      squad.inventory[ZS.ZoneConfig.RESOURCE.AMMO] = 0;
      scenario.squads.issueContext(squad, target.cx, target.cy, false, target);
      return {
        id: target.id,
        expected: target.infectedRemaining,
        abstract: ZS.Sim.agents.filter((agent) => agent.zoneEnemy).length,
        squadId: squad.id,
      };
    });
    assert.equal(encounter.abstract, 0);
    assert.ok(encounter.expected > 0);
    for (let i = 0; i < 80; i++) {
      await sim.page.evaluate(() => ZS.recording.advance(0.5));
      if (await sim.page.evaluate((id) => ZS.scenario.map.at(id).revealed, encounter.id)) break;
    }
    const revealed = await sim.page.evaluate(({ id }) => {
      const scenario = ZS.scenario,
        record = scenario.map.at(id),
        before = ZS.Sim.agents.filter(
          (agent) => agent.zoneEnemy && agent.encounterBuildingId === id,
        ).length;
      scenario.scavenge._materialize(record, scenario.squads.list[0].id);
      const after = ZS.Sim.agents.filter(
        (agent) => agent.zoneEnemy && agent.encounterBuildingId === id,
      ).length;
      return { revealed: record.revealed, remaining: record.infectedRemaining, before, after };
    }, encounter);
    assert.equal(revealed.revealed, true);
    assert.equal(revealed.before, revealed.remaining);
    assert.equal(revealed.after, revealed.before, "encounter must materialize once");

    const paused = await sim.page.evaluate(() => {
      const enemy = ZS.Sim.agents.find((agent) => agent.zoneEnemy),
        x = enemy.x,
        y = enemy.y,
        hp = enemy.hp,
        minute = ZS.scenario.state.minute;
      ZS.scenario.setSpeed(0);
      ZS.Sim.update(2, performance.now() / 1000, ZS.debug.world, innerWidth, innerHeight);
      return {
        same: enemy.x === x && enemy.y === y && enemy.hp === hp,
        minute: ZS.scenario.state.minute,
        before: minute,
      };
    });
    assert.equal(paused.same, true);
    assert.equal(paused.minute, paused.before);

    const combat = await sim.page.evaluate(() => {
      const scenario = ZS.scenario,
        squad = scenario.squads.list[0];
      squad.inventory[ZS.ZoneConfig.RESOURCE.AMMO] = 2;
      scenario.setSpeed(1);
      return true;
    });
    assert.equal(combat, true);
    for (let i = 0; i < 80; i++) {
      await sim.page.evaluate(() => ZS.recording.advance(0.5));
      if (
        (await sim.page.evaluate(
          (id) => ZS.scenario.map.at(id).infectedRemaining,
          encounter.id,
        )) === 0
      )
        break;
    }
    const fought = await sim.page.evaluate(({ squadId, id }) => {
      const scenario = ZS.scenario,
        squad = scenario.squads.at(squadId);
      return {
        remaining: scenario.map.at(id).infectedRemaining,
        ammo: squad.inventory[ZS.ZoneConfig.RESOURCE.AMMO],
        machete: squad.members.some(
          (cid) => scenario.citizens.at(cid).activeWeapon === ZS.ZoneConfig.WEAPON.MACHETE,
        ),
        living: squad.members.length,
      };
    }, encounter);
    assert.equal(fought.remaining, 0);
    assert.equal(fought.ammo, 0);
    assert.equal(fought.machete, true);
    assert.ok(fought.living > 0);

    const fullTrip = await sim.page.evaluate(() => {
      const scenario = ZS.scenario,
        squad = scenario.squads.list[0],
        P = ZS.ZoneConfig.POI;
      scenario.squads.clearOrders(squad);
      let target = null,
        next = null,
        bestLoot = -1;
      for (let i = 0; i < scenario.map.records.length; i++) {
        const record = scenario.map.records[i];
        const loot = scenario.map.lootTotal(record);
        if (
          record !== scenario.map.hq &&
          record.poi === P.GROCERY &&
          !record.looted &&
          loot > bestLoot
        ) {
          target = record;
          bestLoot = loot;
        }
      }
      if (!target)
        target = scenario.map.at(0) === scenario.map.hq ? scenario.map.at(1) : scenario.map.at(0);
      next = scenario.map.records.find(
        (record) =>
          record !== scenario.map.hq &&
          record !== target &&
          !record.looted &&
          scenario.map.lootTotal(record) > 0,
      );
      target.infectedRemaining = 0;
      target.revealed = true;
      target.cleared = true;
      target.encounterSpawned = true;
      for (let i = 0; i < squad.members.length; i++) {
        const member = scenario.citizens.at(squad.members[i]);
        member.hp = member.maxHP;
        member.hunger = 0;
      }
      scenario.state.minute = ZS.ZoneConfig.CLOCK.DAY + 30;
      const stock0 = scenario.state.stock.reduce((sum, value) => sum + value, 0),
        loot0 = scenario.map.lootTotal(target),
        inventory0 = scenario.squads.inventoryTotal(squad);
      scenario.squads.issueContext(squad, target.cx, target.cy, false, target);
      scenario.squads.issueContext(squad, next.cx, next.cy, true, next);
      return {
        id: target.id,
        nextId: next.id,
        squadId: squad.id,
        stock0,
        loot0,
        inventory0,
        capacity: squad.capacity,
      };
    });
    let sawReturn = false;
    for (let i = 0; i < 120; i++) {
      await sim.page.evaluate(() => ZS.recording.advance(0.75));
      sawReturn = await sim.page.evaluate(({ squadId, id }) => {
        const squad = ZS.scenario.squads.at(squadId),
          order = squad.orders[squad.orderIndex];
        return Boolean(
          squad.resumeBuildingId === id &&
          order &&
          order.kind === ZS.ZoneConfig.ORDER.RETURN_HQ &&
          squad.orders[squad.orderIndex + 1],
        );
      }, fullTrip);
      if (sawReturn) break;
    }
    assert.equal(
      sawReturn,
      true,
      "full inventory should issue an automatic HQ return: " + JSON.stringify(fullTrip),
    );
    await sim.page.evaluate(() => ZS.scenario.state.save());
    await sim.page.goto(pageUrl("zone.html", { seed: 999, record: 1 }));
    await sim.page.waitForFunction(() => ZS.scenario && ZS.scenario.map.hq);
    const returningRoute = await sim.page.evaluate(({ squadId, id, nextId }) => {
      const squad = ZS.scenario.squads.at(squadId),
        current = squad.orders[squad.orderIndex],
        next = squad.orders[squad.orderIndex + 1];
      return {
        resume: squad.resumeBuildingId,
        current: current && current.kind,
        next: next && next.buildingId,
        expected: { id, nextId },
      };
    }, fullTrip);
    assert.equal(returningRoute.resume, returningRoute.expected.id);
    assert.equal(
      returningRoute.current,
      await sim.page.evaluate(() => ZS.ZoneConfig.ORDER.RETURN_HQ),
    );
    assert.equal(returningRoute.next, returningRoute.expected.nextId);
    const stockBeforeDeposit = await sim.page.evaluate(() =>
      ZS.scenario.state.stock.reduce((sum, value) => sum + value, 0),
    );
    let resumed = false;
    for (let i = 0; i < 100; i++) {
      await sim.page.evaluate(() => ZS.recording.advance(0.75));
      resumed = await sim.page.evaluate(({ squadId, id, nextId }) => {
        const squad = ZS.scenario.squads.at(squadId),
          order = squad.orders[squad.orderIndex],
          next = squad.orders[squad.orderIndex + 1];
        return Boolean(
          order &&
          order.kind === ZS.ZoneConfig.ORDER.SCAVENGE &&
          order.buildingId === id &&
          next &&
          next.buildingId === nextId,
        );
      }, fullTrip);
      if (resumed) break;
    }
    assert.equal(resumed, true, "deposit should resume unfinished scavenging");
    const deposited = await sim.page.evaluate(
      ({ id, squadId, stock0, loot0, inventory0 }) => ({
        stock: ZS.scenario.state.stock.reduce((sum, value) => sum + value, 0),
        loot: ZS.scenario.map.lootTotal(ZS.scenario.map.at(id)),
        inventory: ZS.scenario.squads.inventoryTotal(ZS.scenario.squads.at(squadId)),
        stock0,
        loot0,
        inventory0,
      }),
      fullTrip,
    );
    assert.ok(deposited.stock > stockBeforeDeposit);
    assert.ok(deposited.loot < deposited.loot0);
    assert.ok(
      deposited.stock + deposited.loot + deposited.inventory <=
        deposited.stock0 + deposited.loot0 + deposited.inventory0,
    );

    const unusable = await sim.page.evaluate(() => {
      const scenario = ZS.scenario,
        squad = scenario.squads.list[0],
        record = scenario.map.records.find((item) => item !== scenario.map.hq);
      for (let i = 0; i < ZS.ZoneConfig.RESOURCE.COUNT; i++) record.loot[i] = 0;
      for (let i = 0; i < record.lootWeapons.length; i++) record.lootWeapons[i] = 0;
      record.lootWeapons[ZS.ZoneConfig.WEAPON.PISTOL] = 1;
      for (let i = 0; i < squad.equipment.length; i++)
        squad.equipment[i] = ZS.ZoneConfig.WEAPON.RIFLE;
      const before = record.lootWeapons[ZS.ZoneConfig.WEAPON.PISTOL],
        moved = scenario.scavenge._takeOne(record, squad),
        after = record.lootWeapons[ZS.ZoneConfig.WEAPON.PISTOL];
      return { before, moved, after };
    });
    assert.deepEqual(unusable, { before: 1, moved: false, after: 1 });

    const maxStep = await sim.page.evaluate(() => {
      const scenario = ZS.scenario,
        original = scenario.update,
        seen = { max: 0 };
      scenario.update = function (agent, dt, ...rest) {
        seen.max = Math.max(seen.max, dt);
        return original.call(this, agent, dt, ...rest);
      };
      scenario.setSpeed(4);
      ZS.Sim.update(1, performance.now() / 1000, ZS.debug.world, innerWidth, innerHeight);
      scenario.update = original;
      scenario.setSpeed(0);
      return seen.max;
    });
    assert.ok(maxStep <= 0.050001);

    await sim.page.evaluate(() => ZS.scenario.state.save());
    const citizensBefore = await sim.page.evaluate(() => ZS.scenario.citizens.stats().population);
    await sim.page.goto(pageUrl("zone.html", { seed: 111, record: 1 }));
    await sim.page.waitForFunction(() => ZS.scenario && ZS.scenario.map.hq);
    assert.equal(
      await sim.page.evaluate(() => ZS.scenario.citizens.stats().population),
      citizensBefore,
    );
    assert.equal(
      await sim.page.evaluate(
        () => new Set(ZS.Sim.agents.filter((a) => a.zoneCitizen).map((a) => a.cid)).size,
      ),
      citizensBefore,
    );
    assertNoErrors(sim.errors, "zone squads");
    process.stdout.write("✓ deterministic POI/loot, squad creation and one-path formation\n");
    process.stdout.write("✓ queued movement, looping patrol and persistent orders\n");
    process.stdout.write("✓ abstract encounters, combat, ammo fallback and pause\n");
    process.stdout.write(
      "✓ full-inventory return, persistent queued resume and no duplicate loot\n",
    );
  } finally {
    if (deterministicContext) await deterministicContext.close();
    await sim.context.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
