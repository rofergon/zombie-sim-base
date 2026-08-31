"use strict";

const assert = require("node:assert/strict");
const { assertNoErrors, launch, openSim, pageUrl } = require("./browser");

(async () => {
  const browser = await launch();
  const sim = await openSim(browser, "zone.html", { seed: 91827, fresh: 1, record: 1 });
  try {
    await sim.page.locator("#zone-hq-action").click();
    const farming = await sim.page.evaluate(() => {
      const scenario = ZS.scenario,
        CFG = ZS.ZoneConfig,
        R = CFG.RESOURCE,
        U = CFG.BUILDING_USE,
        T = CFG.TECH,
        K = CFG.FARM_KIND;
      for (let i = 0; i < R.COUNT; i++) scenario.state.stock[i] = 500;
      const targets = scenario.map.records
        .filter((record) => record !== scenario.map.hq && scenario.map.reachable(record))
        .slice(0, 4);
      for (let i = 0; i < targets.length; i++) {
        targets[i].revealed = true;
        targets[i].cleared = true;
        targets[i].infectedRemaining = 0;
      }

      function complete(record, use) {
        const job = scenario.adaptations.start(record, use);
        scenario.tasks.reconcile();
        const worker = scenario.citizens.at(job.assigned[0]);
        job.progress = CFG.TASK.BUILD_SECONDS;
        scenario.tasks._work(worker, job, 0.01);
        scenario.tasks.reconcile();
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
      const researched = [
        completeResearch(targets[0], T.AGRICULTURE),
        completeResearch(targets[0], T.FERTILIZATION),
        completeResearch(targets[0], T.GREENHOUSES),
        completeResearch(targets[0], T.EFFICIENT_COOKING),
      ];
      complete(targets[1], U.BARN);
      complete(targets[2], U.COOKHOUSE);
      complete(targets[3], U.FARM);
      scenario.adaptations.recalculatePower();
      targets[1].powered = true;
      targets[2].powered = true;
      targets[3].powered = true;

      const hq = scenario.map.hq;
      let point = null;
      for (let radius = 160; radius <= 960 && !point; radius += 40)
        for (let y = hq.cy - radius; y <= hq.cy + radius && !point; y += 40)
          for (let x = hq.cx - radius; x <= hq.cx + radius; x += 40) {
            if (Math.max(Math.abs(x - hq.cx), Math.abs(y - hq.cy)) !== radius) continue;
            if (scenario.agriculture.canPlace(x, y, K.FIELD)) {
              point = { x, y };
              break;
            }
          }
      const field = point && scenario.agriculture.place(point.x, point.y, K.FIELD),
        fieldJob = field && scenario.tasks.forField(field.id);
      field.fertilized = true;
      const fieldBefore = {
        grain: scenario.state.stock[R.GRAIN],
        fertilizer: scenario.state.stock[R.FERTILIZER],
      };
      const fieldProduced = scenario.agriculture.produce(field),
        fieldAfter = {
          grain: scenario.state.stock[R.GRAIN],
          fertilizer: scenario.state.stock[R.FERTILIZER],
        };

      const barnBefore = {
          grain: scenario.state.stock[R.GRAIN],
          meat: scenario.state.stock[R.MEAT],
          fertilizer: scenario.state.stock[R.FERTILIZER],
        },
        barnProduced = scenario.adaptations.produce(targets[1]),
        barnAfter = {
          grain: scenario.state.stock[R.GRAIN],
          meat: scenario.state.stock[R.MEAT],
          fertilizer: scenario.state.stock[R.FERTILIZER],
        };

      scenario.adaptations.setRecipe(targets[2], CFG.RECIPE.MEAT);
      const kitchenBefore = {
          meat: scenario.state.stock[R.MEAT],
          wood: scenario.state.stock[R.WOOD],
          food: scenario.state.stock[R.FOOD],
        },
        kitchenProduced = scenario.adaptations.produce(targets[2]),
        kitchenAfter = {
          meat: scenario.state.stock[R.MEAT],
          wood: scenario.state.stock[R.WOOD],
          food: scenario.state.stock[R.FOOD],
        };

      targets[3].fertilized = true;
      const greenhouseBefore = {
          grain: scenario.state.stock[R.GRAIN],
          fertilizer: scenario.state.stock[R.FERTILIZER],
        },
        greenhouseProduced = scenario.adaptations.produce(targets[3]),
        greenhouseAfter = {
          grain: scenario.state.stock[R.GRAIN],
          fertilizer: scenario.state.stock[R.FERTILIZER],
        };

      scenario.state.day = 19;
      const weather = { ...scenario.agriculture.weather() },
        coldFieldSeconds = scenario.agriculture.productionSeconds(field),
        greenhouseSeconds = scenario.adaptations.productionSeconds(targets[3]);

      const citizen = scenario.citizens.byId.find(Boolean);
      scenario.state.stock[R.FOOD] = 0;
      scenario.state.stock[R.GRAIN] = 20;
      citizen.hunger = 2;
      scenario.citizens.updateNeeds(citizen, 0.1);
      const rawCropHunger = citizen.hunger;
      scenario.state.stock[R.FOOD] = 1;
      scenario.citizens.updateNeeds(citizen, 0.1);
      const rationHunger = citizen.hunger;

      scenario.state.save();
      return {
        researched,
        fieldId: field.id,
        fieldJobCapacity: fieldJob.capacity,
        fieldProduced,
        fieldBefore,
        fieldAfter,
        barnProduced,
        barnBefore,
        barnAfter,
        kitchenProduced,
        kitchenBefore,
        kitchenAfter,
        greenhouseProduced,
        greenhouseBefore,
        greenhouseAfter,
        weather,
        coldFieldSeconds,
        greenhouseSeconds,
        rawCropHunger,
        rationHunger,
        buildingIds: targets.slice(1).map((record) => record.id),
      };
    });

    assert.deepEqual(farming.researched, [true, true, true, true]);
    assert.equal(farming.fieldJobCapacity, 2);
    assert.equal(farming.fieldProduced, true);
    assert.equal(farming.fieldAfter.grain - farming.fieldBefore.grain, 7);
    assert.equal(farming.fieldBefore.fertilizer - farming.fieldAfter.fertilizer, 1);
    assert.equal(farming.barnProduced, true);
    assert.equal(farming.barnBefore.grain - farming.barnAfter.grain, 2);
    assert.equal(farming.barnAfter.meat - farming.barnBefore.meat, 2);
    assert.equal(farming.barnAfter.fertilizer - farming.barnBefore.fertilizer, 1);
    assert.equal(farming.kitchenProduced, true);
    assert.equal(farming.kitchenBefore.meat - farming.kitchenAfter.meat, 2);
    assert.equal(farming.kitchenBefore.wood - farming.kitchenAfter.wood, 1);
    assert.equal(farming.kitchenAfter.food - farming.kitchenBefore.food, 5);
    assert.equal(farming.greenhouseProduced, true);
    assert.equal(farming.greenhouseAfter.grain - farming.greenhouseBefore.grain, 7);
    assert.equal(farming.greenhouseBefore.fertilizer - farming.greenhouseAfter.fertilizer, 1);
    assert.ok(farming.weather.rate < 1);
    assert.ok(farming.coldFieldSeconds > farming.greenhouseSeconds);
    assert.ok(farming.rawCropHunger > farming.rationHunger);

    await sim.page.goto(pageUrl("zone.html", { seed: 1, record: 1 }));
    await sim.page.waitForFunction(() => ZS.scenario && ZS.scenario.map.hq);
    const restored = await sim.page.evaluate(({ fieldId, buildingIds }) => {
      const scenario = ZS.scenario,
        CFG = ZS.ZoneConfig;
      return {
        version: CFG.SAVE_VERSION,
        resources: scenario.state.stock.length,
        field: scenario.agriculture.at(fieldId),
        fieldJob: scenario.tasks.forField(fieldId),
        uses: buildingIds.map((id) => scenario.map.at(id).use),
        recipe: scenario.map.at(buildingIds[1]).recipe,
        greenhouseFertilized: scenario.map.at(buildingIds[2]).fertilized,
      };
    }, farming);
    assert.equal(restored.version, 14);
    assert.equal(restored.resources, 10);
    assert.equal(restored.field.kind, 1);
    assert.equal(restored.field.fertilized, true);
    assert.equal(restored.fieldJob.capacity, 2);
    assert.deepEqual(restored.uses, [11, 4, 9]);
    assert.equal(restored.recipe, 2);
    assert.equal(restored.greenhouseFertilized, true);
    await assertNoErrors(sim.page);
    console.log("zone farming: ok");
  } finally {
    await sim.context.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
