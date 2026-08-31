"use strict";

const assert = require("node:assert/strict");
const { assertNoErrors, launch, openSim } = require("./browser");

(async () => {
  const browser = await launch();
  try {
    const sim = await openSim(browser, "zone.html", {
      seed: 12345,
      fresh: 1,
      record: 1,
      forceWebGLActors: 1,
    });

    const result = await sim.page.evaluate(() => {
      const scenario = ZS.scenario,
        CFG = ZS.ZoneConfig,
        R = CFG.RESOURCE;
      scenario.establishHQ();

      let tree = null,
        treeDistance = Infinity;
      for (let i = 0; i < scenario.world.trees.length; i++) {
        const candidate = scenario.world.trees[i],
          distance = Math.hypot(candidate.x - scenario.map.hq.cx, candidate.y - scenario.map.hq.cy);
        if (distance < treeDistance) {
          tree = candidate;
          treeDistance = distance;
        }
      }
      const woodBounds = {
          x0: tree.x - 2,
          y0: tree.y - 2,
          x1: tree.x + 2,
          y1: tree.y + 2,
        },
        woodJob = scenario.gathering.create(R.WOOD, woodBounds);
      scenario.tasks.setCapacity(woodJob.id, 1);
      const woodWorker = scenario.citizens.at(woodJob.assigned[0]),
        woodStart = scenario.state.stock[R.WOOD];
      woodWorker.gatherNodeId = woodJob.nodeIds[0];
      woodWorker.workerState = CFG.WORKER_STATE.WORKING;
      woodWorker.workT = CFG.GATHER.WORK_SECONDS;
      scenario.tasks._work(woodWorker, woodJob, 0);
      const woodCargo = woodWorker.carry[R.WOOD];
      woodWorker.x = scenario.map.hq.shape.door.inner.x;
      woodWorker.y = scenario.map.hq.shape.door.inner.y;
      woodWorker.bld = scenario.map.hq.id;
      scenario.tasks._return(woodWorker, woodJob, 0.01, 1, scenario.nav, false);
      scenario.tasks.reconcile();

      let metalRecord = null;
      for (let i = 0; i < scenario.map.records.length; i++) {
        const record = scenario.map.records[i];
        if (
          record !== scenario.map.hq &&
          record.use === CFG.BUILDING_USE.ABANDONED &&
          record.salvage[R.METAL] > 0 &&
          scenario.map.reachable(record)
        ) {
          metalRecord = record;
          break;
        }
      }
      const shape = metalRecord.shape,
        metalBounds = {
          x0: shape.x - 2,
          y0: shape.y - 2,
          x1: shape.x + shape.w + 2,
          y1: shape.y + shape.h + 2,
        },
        metalBefore = metalRecord.salvage[R.METAL],
        metalJob = scenario.gathering.create(R.METAL, metalBounds),
        overlapping = scenario.gathering.create(R.METAL, metalBounds);
      scenario.tasks.setCapacity(metalJob.id, 1);
      const metalWorker = scenario.citizens.at(metalJob.assigned[0]);
      metalWorker.gatherNodeId = metalJob.nodeIds[0];
      metalWorker.workerState = CFG.WORKER_STATE.WORKING;
      metalWorker.workT = CFG.GATHER.WORK_SECONDS;
      scenario.tasks._work(metalWorker, metalJob, 0);

      scenario.openSystem("resources");
      const panel = document.querySelector(".zone-system-panel"),
        buttons = panel.querySelectorAll("[data-gather-resource]");
      buttons[0].click();
      const armedMode = scenario.commandMode;
      let gestureTree = null;
      for (let i = 0; i < scenario.world.trees.length; i++) {
        const candidate = scenario.world.trees[i];
        if (!candidate.hidden && !scenario.gathering._claimed(R.WOOD, i)) {
          gestureTree = candidate;
          break;
        }
      }
      scenario.pointerDown(gestureTree.x - 3, gestureTree.y - 3, {
        button: 0,
        shiftKey: false,
      });
      scenario.pointerMove(gestureTree.x + 3, gestureTree.y + 3);
      scenario.pointerUp(gestureTree.x + 3, gestureTree.y + 3);
      const gestureJob = scenario.state.zone.jobs[scenario.state.zone.jobs.length - 1];
      scenario._refreshSettlement();
      const normalized = ZS.ZoneSave.normalize(JSON.parse(JSON.stringify(scenario.state.data))),
        normalizedWood = normalized.zone.jobs.find((job) => job.id === woodJob.id),
        normalizedMetal = normalized.zone.jobs.find((job) => job.id === metalJob.id);
      return {
        version: normalized.v,
        wood: {
          type: woodJob.type,
          total: woodJob.total,
          cargo: woodCargo,
          stock: scenario.state.stock[R.WOOD] - woodStart,
          hidden: tree.hidden,
          harvested: scenario.state.zone.harvestedTrees.includes(tree.zoneGatherId),
          state: woodJob.state,
        },
        metal: {
          total: metalJob.total,
          before: metalBefore,
          after: metalRecord.salvage[R.METAL],
          cargo: metalWorker.carry[R.METAL],
          overlapRejected: overlapping === null,
        },
        ui: {
          title: document.querySelector("#zone-system-title").textContent,
          resourceButtons: buttons.length,
          areas: panel.querySelectorAll(".zone-gather-area").length,
          armedMode,
          commandMode: scenario.commandMode,
          gestureNodes: gestureJob.nodeIds.length,
        },
        saved: {
          woodKind: normalizedWood.targetKind,
          woodNodes: normalizedWood.nodeIds.length,
          metalResource: normalizedMetal.resource,
          harvested: normalized.zone.harvestedTrees.includes(tree.zoneGatherId),
        },
      };
    });

    assert.equal(result.version, 13);
    assert.deepEqual(result.wood, {
      type: 3,
      total: 4,
      cargo: 4,
      stock: 4,
      hidden: true,
      harvested: true,
      state: 2,
    });
    assert.ok(result.metal.total > 0);
    assert.equal(result.metal.before - result.metal.after, result.metal.cargo);
    assert.ok(result.metal.cargo > 0);
    assert.equal(result.metal.overlapRejected, true);
    assert.equal(result.ui.title, "Recolección");
    assert.equal(result.ui.resourceButtons, 2);
    assert.ok(result.ui.areas >= 1);
    assert.equal(result.ui.armedMode, "gather:1");
    assert.equal(result.ui.commandMode, null);
    assert.ok(result.ui.gestureNodes > 0);
    assert.deepEqual(result.saved, {
      woodKind: "resource",
      woodNodes: 1,
      metalResource: 2,
      harvested: true,
    });
    assertNoErrors(sim.errors, "zone gathering");
    process.stdout.write("✓ territorial wood/metal collection, staffing and conservation\n");
    process.stdout.write("✓ resource panel, overlap guard and v13 round-trip\n");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
