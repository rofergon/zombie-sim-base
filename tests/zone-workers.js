"use strict";

const assert = require("node:assert/strict");
const { assertNoErrors, launch, openSim, pageUrl } = require("./browser");

(async () => {
  const browser = await launch();
  const sim = await openSim(browser, "zone.html", { seed: 24680, fresh: 1, record: 1 });
  try {
    const migration = await sim.page.evaluate(() => {
      const v3 = {
          v: 3,
          world: { seed: 88 },
          clock: { day: 7, minute: 611, speed: 2, paused: false },
          zone: { hqId: 4 },
        },
        v4 = ZS.ZoneSave.migrateV3(v3),
        v11 = ZS.ZoneSave.migrate(v4);
      return { v4, v11 };
    });
    assert.equal(migration.v4.v, 4);
    assert.equal(migration.v4.zone.hqId, 4);
    assert.equal(migration.v11.v, 11);
    assert.equal(migration.v11.world.seed, 88);
    assert.equal(migration.v11.clock.minute, 611);
    assert.equal(migration.v11.world.source, "procedural");

    await sim.page.locator("#zone-hq-action").click();
    const start = await sim.page.evaluate(() => ({
      agents: ZS.Sim.agents.length,
      population: ZS.scenario.citizens.stats().population,
      workers: ZS.scenario.citizens.stats().free,
      squad: ZS.scenario.squads.list[0].members.length,
      food: ZS.scenario.state.stock[ZS.ZoneConfig.RESOURCE.FOOD],
    }));
    assert.deepEqual(start, { agents: 16, population: 16, workers: 12, squad: 4, food: 80 });

    const hunger = await sim.page.evaluate(() => {
      const worker = ZS.scenario.citizens.byId.find(
        (agent) => agent && agent.role === ZS.ZoneConfig.ROLE.WORKER,
      );
      ZS.scenario.state.stock[ZS.ZoneConfig.RESOURCE.FOOD] = 0;
      worker.hunger = 20;
      worker.moral = 10;
      worker.hp = 100;
      ZS.scenario.citizens.updateNeeds(worker, 100);
      const result = { hunger: worker.hunger, moral: worker.moral, hp: worker.hp };
      worker.hunger = 0;
      worker.moral = 78;
      worker.hp = 100;
      ZS.scenario.state.stock[ZS.ZoneConfig.RESOURCE.FOOD] = 80;
      return result;
    });
    assert.ok(hunger.hunger > 20);
    assert.ok(hunger.moral < 10);
    assert.ok(hunger.hp < 100);

    const priority = await sim.page.evaluate(() => {
      const scenario = ZS.scenario,
        targets = [];
      for (let i = 0; i < scenario.map.records.length && targets.length < 4; i++) {
        const record = scenario.map.records[i];
        if (record !== scenario.map.hq && scenario.map.materialsTotal(record) > 0)
          targets.push(record);
      }
      const jobs = [];
      for (let i = 0; i < targets.length; i++)
        jobs.push(scenario.tasks.postSalvage(targets[i].id, ZS.ZoneConfig.PRIORITY.NORMAL));
      const high = jobs[jobs.length - 1],
        before = high.assigned.slice();
      scenario.tasks.setPriority(high.id, ZS.ZoneConfig.PRIORITY.HIGH);
      const after = high.assigned.slice();
      for (let i = 0; i < jobs.length; i++) scenario.tasks.cancel(jobs[i].id);
      return { before, after };
    });
    assert.notDeepEqual(
      priority.after,
      priority.before,
      "priority change should rebalance workers",
    );

    const salvage = await sim.page.evaluate(() => {
      const scenario = ZS.scenario,
        R = ZS.ZoneConfig.RESOURCE;
      let target = null,
        best = Infinity;
      for (let i = 0; i < scenario.map.records.length; i++) {
        const record = scenario.map.records[i];
        if (record === scenario.map.hq || scenario.map.materialsTotal(record) <= 0) continue;
        const d = Math.hypot(record.cx - scenario.map.hq.cx, record.cy - scenario.map.hq.cy);
        if (d < best) {
          best = d;
          target = record;
        }
      }
      const initial = scenario.map.materialsTotal(target),
        stock0 =
          scenario.state.stock[R.WOOD] +
          scenario.state.stock[R.METAL] +
          scenario.state.stock[R.BRICK],
        job = scenario.tasks.postSalvage(target.id, ZS.ZoneConfig.PRIORITY.HIGH);
      return { id: target.id, initial, stock0, jobId: job.id };
    });
    await sim.page.evaluate(() => ZS.recording.advance(175));
    const salvageDone = await sim.page.evaluate(({ id, jobId, stock0, initial }) => {
      const scenario = ZS.scenario,
        R = ZS.ZoneConfig.RESOURCE,
        stock =
          scenario.state.stock[R.WOOD] +
          scenario.state.stock[R.METAL] +
          scenario.state.stock[R.BRICK],
        carry = scenario.citizens.byId.reduce(
          (sum, agent) =>
            sum +
            (agent && !agent.dead
              ? agent.carry[R.WOOD] + agent.carry[R.METAL] + agent.carry[R.BRICK]
              : 0),
          0,
        );
      return {
        remaining: scenario.map.materialsTotal(scenario.map.at(id)),
        demolished: scenario.map.at(id).demolished,
        hidden: scenario.map.at(id).shape.hidden,
        selectable: scenario.map.buildingAt(scenario.map.at(id).cx, scenario.map.at(id).cy),
        state: scenario.tasks.at(jobId).state,
        stock,
        carry,
        conserved: stock + carry + scenario.map.materialsTotal(scenario.map.at(id)) - stock0,
        initial,
      };
    }, salvage);
    assert.equal(salvageDone.remaining, 0);
    assert.equal(salvageDone.demolished, true);
    assert.equal(salvageDone.hidden, true);
    assert.equal(salvageDone.selectable, null);
    assert.equal(salvageDone.state, 2);
    assert.equal(salvageDone.conserved, salvageDone.initial);
    assert.ok(salvageDone.stock > salvage.stock0);

    const transport = await sim.page.evaluate(() => {
      const scenario = ZS.scenario,
        R = ZS.ZoneConfig.RESOURCE;
      scenario.state.minute = ZS.ZoneConfig.CLOCK.DAY + 60;
      let target = null,
        best = Infinity;
      for (let i = 0; i < scenario.map.records.length; i++) {
        const record = scenario.map.records[i];
        if (record === scenario.map.hq || scenario.map.materialsTotal(record) <= 0) continue;
        const d = Math.hypot(record.cx - scenario.map.hq.cx, record.cy - scenario.map.hq.cy);
        if (d < best) {
          best = d;
          target = record;
        }
      }
      const total = () => {
        let value = scenario.map.materialsTotal(target);
        value +=
          scenario.state.stock[R.WOOD] +
          scenario.state.stock[R.METAL] +
          scenario.state.stock[R.BRICK];
        for (let i = 0; i < scenario.citizens.byId.length; i++) {
          const agent = scenario.citizens.byId[i];
          if (agent) value += agent.carry[R.WOOD] + agent.carry[R.METAL] + agent.carry[R.BRICK];
        }
        return value;
      };
      const job = scenario.tasks.postSalvage(target.id, ZS.ZoneConfig.PRIORITY.HIGH);
      return { id: target.id, jobId: job.id, total: total() };
    });
    for (let i = 0; i < 16; i++) {
      await sim.page.evaluate(() => ZS.recording.advance(3));
      if (
        await sim.page.evaluate(() =>
          ZS.scenario.citizens.byId.some(
            (agent) => agent && ZS.scenario.citizens.carryTotal(agent) > 0,
          ),
        )
      )
        break;
    }
    const canceled = await sim.page.evaluate(({ id, jobId }) => {
      const scenario = ZS.scenario,
        R = ZS.ZoneConfig.RESOURCE;
      scenario.tasks.cancel(jobId);
      ZS.recording.advance(50);
      let total = scenario.map.materialsTotal(scenario.map.at(id));
      total +=
        scenario.state.stock[R.WOOD] +
        scenario.state.stock[R.METAL] +
        scenario.state.stock[R.BRICK];
      for (let i = 0; i < scenario.citizens.byId.length; i++) {
        const agent = scenario.citizens.byId[i];
        if (agent) total += agent.carry[R.WOOD] + agent.carry[R.METAL] + agent.carry[R.BRICK];
      }
      return total;
    }, transport);
    assert.equal(canceled, transport.total, "canceling transported salvage must conserve it");

    const replacement = await sim.page.evaluate(() => {
      const scenario = ZS.scenario;
      scenario.state.minute = ZS.ZoneConfig.CLOCK.DAY + 60;
      let target = null;
      for (let i = 0; i < scenario.map.records.length; i++)
        if (
          scenario.map.records[i] !== scenario.map.hq &&
          scenario.map.materialsTotal(scenario.map.records[i])
        ) {
          target = scenario.map.records[i];
          break;
        }
      const job = scenario.tasks.postSalvage(target.id, ZS.ZoneConfig.PRIORITY.HIGH),
        deadId = job.assigned[0],
        dead = scenario.citizens.at(deadId);
      scenario.citizens.kill(dead);
      scenario.tasks.reconcile();
      return {
        deadId,
        assigned: job.assigned.slice(),
        population: scenario.citizens.stats().population,
      };
    });
    assert.equal(replacement.population, 15);
    assert.equal(replacement.assigned.includes(replacement.deadId), false);
    assert.equal(replacement.assigned.length, 3);

    const night = await sim.page.evaluate(() => {
      const scenario = ZS.scenario;
      scenario.state.minute = ZS.ZoneConfig.CLOCK.DUSK;
      ZS.recording.advance(0.2);
      return scenario.citizens.byId
        .filter((agent) => agent && agent.role === ZS.ZoneConfig.ROLE.WORKER)
        .every(
          (agent) =>
            agent.workerState === ZS.ZoneConfig.WORKER_STATE.RETURNING ||
            agent.workerState === ZS.ZoneConfig.WORKER_STATE.RESTING,
        );
    });
    assert.equal(night, true);

    const beforeSave = await sim.page.evaluate(() => {
      ZS.scenario.state.save();
      return {
        population: ZS.scenario.citizens.stats().population,
        jobs: ZS.scenario.tasks.jobs.length,
        seed: ZS.scenario.state.seed,
      };
    });
    await sim.page.goto(pageUrl("zone.html", { seed: 999, record: 1 }));
    await sim.page.waitForFunction(() => ZS.scenario && ZS.scenario.map.hq);
    const restored = await sim.page.evaluate(() => ({
      population: ZS.scenario.citizens.stats().population,
      agents: ZS.Sim.agents.filter((agent) => agent.zoneCitizen).length,
      jobs: ZS.scenario.tasks.jobs.length,
      seed: ZS.scenario.state.seed,
    }));
    assert.equal(restored.population, beforeSave.population);
    assert.equal(restored.agents, beforeSave.population);
    assert.equal(restored.jobs, beforeSave.jobs);
    assert.equal(restored.seed, beforeSave.seed);
    assertNoErrors(sim.errors, "zone workers");
    process.stdout.write("✓ v3 → v4 → v11 and v11 worker round-trip\n");
    process.stdout.write("✓ population, hunger, salvage and conservation\n");
    process.stdout.write("✓ priority rebalance, replacement and dusk return\n");
  } finally {
    await sim.context.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
