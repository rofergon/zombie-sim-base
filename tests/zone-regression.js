"use strict";

const assert = require("node:assert/strict");
const { assertNoErrors, launch, openSim, pageUrl } = require("./browser");

(async () => {
  const browser = await launch();
  const sim = await openSim(browser, "zone.html", {
    seed: 12345,
    fresh: 1,
    record: 1,
  });
  try {
    const migration = await sim.page.evaluate(() =>
      ZS.ZoneSave.migrate({ v: 1, seed: 91, day: 4, minute: 75, hq: 3 }),
    );
    assert.equal(migration.v, 13);
    assert.equal(migration.world.source, "procedural");
    assert.equal(migration.world.size, "classic");
    assert.equal(migration.world.seed, 91);
    assert.deepEqual(migration.clock, { day: 4, minute: 75, speed: 1, paused: true });
    assert.equal(migration.zone.hqId, 3);
    assert.deepEqual(migration.zone.citizens, []);
    assert.deepEqual(migration.zone.squads, []);

    const setup = await sim.page.evaluate(() => ({
      buildingCount: ZS.scenario.map.records.length,
      recommended: ZS.scenario.map.recommended.id,
      suitable: ZS.scenario.map.suitableHQ(ZS.scenario.map.recommended),
      hq: ZS.scenario.map.hq,
      agents: ZS.Sim.agents.length,
      scale: ZS.scenario.timeScale,
      speedDisabled: Array.from(
        document.querySelectorAll("[data-speed]"),
        (button) => button.disabled,
      ),
    }));
    assert.ok(setup.buildingCount >= 40 && setup.buildingCount <= 72);
    assert.equal(setup.suitable, true);
    assert.equal(setup.hq, null);
    assert.equal(setup.agents, 0);
    assert.equal(setup.scale, 0);
    assert.deepEqual(setup.speedDisabled, [false, true, true, true]);
    await sim.page.locator("#zone-hq-action").click();

    const established = await sim.page.evaluate(() => ({
      hq: ZS.scenario.map.hq.id,
      agents: ZS.Sim.agents.length,
      scale: ZS.scenario.timeScale,
      seed: ZS.scenario.state.seed,
    }));
    assert.equal(established.hq, setup.recommended);
    assert.equal(established.agents, 16);
    assert.equal(established.scale, 1);
    assert.equal(established.seed, 12345);
    assert.equal(await sim.page.locator("#zone-selection-title").textContent(), "Cuartel general");
    assert.equal(await sim.page.locator(".zone-main-dock").isVisible(), true);
    assert.equal(await sim.page.locator(".zone-metric").count(), 10);
    await sim.page.locator('[data-speed="0"]').click();
    const salvageYield = await sim.page.evaluate(() => {
      const scenario = ZS.scenario,
        R = ZS.ZoneConfig.RESOURCE,
        target = scenario.map.records.find(
          (record) =>
            record !== scenario.map.hq &&
            scenario.map.reachable(record) &&
            scenario.map.materialsTotal(record) > 0,
        );
      scenario.debugSelectBuilding(target.id);
      return {
        wood: target.salvage[R.WOOD],
        metal: target.salvage[R.METAL],
        brick: target.salvage[R.BRICK],
        total: scenario.map.materialsTotal(target),
      };
    });
    const salvageButton = sim.page.locator("#zone-salvage"),
      salvagePreview = sim.page.locator("#zone-salvage-preview");
    assert.equal(await salvageButton.getAttribute("aria-label"), "Desguazar edificio");
    assert.equal(await salvagePreview.isVisible(), false);
    await salvageButton.hover();
    assert.equal(await salvagePreview.isVisible(), true);
    assert.deepEqual(
      await sim.page.evaluate(() => ({
        wood: Number(document.querySelector("#zone-salvage-wood").textContent),
        metal: Number(document.querySelector("#zone-salvage-metal").textContent),
        brick: Number(document.querySelector("#zone-salvage-brick").textContent),
        total: Number(document.querySelector("#zone-salvage-total").textContent),
      })),
      salvageYield,
    );
    await sim.page.mouse.move(640, 400);
    assert.equal(await salvagePreview.isVisible(), false);
    await salvageButton.focus();
    assert.equal(await salvagePreview.isVisible(), true);
    await salvageButton.blur();
    await sim.page.locator('[data-speed="1"]').click();
    await sim.page.locator('[data-system="economy"]').first().click();
    assert.equal(await sim.page.locator("#zone-system-title").textContent(), "Economía");
    assert.equal(await sim.page.locator(".zone-system-panel").isVisible(), true);
    await sim.page.locator("#zone-layer-toggle").click();
    await sim.page.locator('[data-layer="loot"]').click();
    await sim.page.locator('[data-layer="ranges"]').click();
    assert.deepEqual(
      await sim.page.evaluate(() => ({
        loot: ZS.scenario.mapLayers.loot,
        ranges: ZS.scenario.mapLayers.ranges,
      })),
      { loot: true, ranges: true },
    );
    const hungryId = await sim.page.evaluate(() => {
      const citizen = ZS.scenario.citizens.byId.find(Boolean);
      citizen.hunger = 82;
      ZS.scenario._refreshSettlement();
      return citizen.cid;
    });
    assert.ok((await sim.page.locator("[data-alert-index]").count()) >= 1);
    await sim.page.locator("[data-alert-index]").first().dispatchEvent("click");
    assert.equal(
      await sim.page.evaluate(
        (id) => ZS.scenario.selected.some((citizen) => citizen.cid === id),
        hungryId,
      ),
      true,
    );
    await sim.page.locator('[data-speed="2"]').click();
    assert.equal(await sim.page.evaluate(() => ZS.scenario.timeScale), 2);
    await sim.page.locator('[data-speed="1"]').click();
    assert.equal(await sim.page.evaluate(() => ZS.scenario.timeScale), 1);

    const screen = await sim.page.evaluate(() => {
      const agents = ZS.Sim.agents,
        cam = ZS.debug.cam,
        zoom = cam.zoom,
        points = agents.map((agent) => ({
          x: (agent.x - cam.x) * zoom + innerWidth / 2,
          y: (agent.y - cam.y) * zoom + innerHeight / 2,
        }));
      return {
        x0: Math.min(...points.map((point) => point.x)) - 14,
        y0: Math.min(...points.map((point) => point.y)) - 14,
        x1: Math.max(...points.map((point) => point.x)) + 14,
        y1: Math.max(...points.map((point) => point.y)) + 14,
        first: points[0],
      };
    });
    await sim.page.mouse.click(screen.first.x, screen.first.y);
    assert.equal(await sim.page.evaluate(() => ZS.scenario.selected.length), 4);
    await sim.page.mouse.move(screen.x0, screen.y0);
    await sim.page.mouse.down({ button: "left" });
    await sim.page.mouse.move(screen.x1, screen.y1, { steps: 4 });
    await sim.page.mouse.up({ button: "left" });
    assert.equal(await sim.page.evaluate(() => ZS.scenario.selected.length), 4);
    await sim.page.evaluate(() => ZS.scenario.debugSelectAll());
    assert.equal(await sim.page.evaluate(() => ZS.scenario.selected.length), 4);
    assert.match(await sim.page.locator("#zone-selection-title").textContent(), /^Patrulla 1/);
    assert.equal(await sim.page.locator(".zone-member-card").count(), 4);
    const shellLayout = await sim.page.evaluate(() => {
      const dock = document.querySelector(".zone-main-dock").getBoundingClientRect(),
        commands = document.querySelector(".zone-command-bar").getBoundingClientRect(),
        ledger = document.querySelector(".zone-ledger").getBoundingClientRect();
      return {
        dockCommandOverlap: !(
          dock.right <= commands.left ||
          dock.left >= commands.right ||
          dock.bottom <= commands.top ||
          dock.top >= commands.bottom
        ),
        ledgerInsideViewport: ledger.left >= 0 && ledger.right <= innerWidth,
      };
    });
    assert.equal(shellLayout.dockCommandOverlap, false);
    assert.equal(shellLayout.ledgerInsideViewport, true);

    const move = await sim.page.evaluate(() => {
      const hq = ZS.scenario.map.hq,
        point = ZS.debug.nav.nearestWalkable(hq.cx + 360, hq.cy + 120, 300, false);
      return {
        sx: (point.x - ZS.debug.cam.x) * ZS.debug.cam.zoom + innerWidth / 2,
        sy: (point.y - ZS.debug.cam.y) * ZS.debug.cam.zoom + innerHeight / 2,
        hqx: (hq.cx - ZS.debug.cam.x) * ZS.debug.cam.zoom + innerWidth / 2,
        hqy: (hq.cy - ZS.debug.cam.y) * ZS.debug.cam.zoom + innerHeight / 2,
        wx: point.x,
        wy: point.y,
      };
    });
    const beforeMove = await sim.page.evaluate(() =>
      ZS.Sim.agents.map((agent) => ({ x: agent.x, y: agent.y })),
    );
    await sim.page.mouse.click(move.sx, move.sy, { button: "right" });
    assert.ok(
      await sim.page.evaluate(() =>
        ZS.Sim.agents
          .filter((agent) => agent.squadId === 1)
          .every((agent) => agent.orders.length === 1),
      ),
    );
    await sim.page.keyboard.down("Shift");
    await sim.page.mouse.click(move.hqx, move.hqy, { button: "right" });
    await sim.page.keyboard.up("Shift");
    assert.ok(
      await sim.page.evaluate(() =>
        ZS.Sim.agents
          .filter((agent) => agent.squadId === 1)
          .every(
            (agent) =>
              agent.orders.length === 2 && agent.orders[1].kind === ZS.ZoneConfig.ORDER.ENTER,
          ),
      ),
    );
    await sim.page.evaluate(() => ZS.recording.advance(3));
    const distance = await sim.page.evaluate(
      (before) =>
        ZS.Sim.agents.reduce(
          (sum, agent, index) =>
            sum + Math.hypot(agent.x - before[index].x, agent.y - before[index].y),
          0,
        ),
      beforeMove,
    );
    assert.ok(distance > 80, "survey team should move after an order");

    await sim.page.evaluate(({ wx, wy }) => ZS.scenario.debugIssueMove(wx + 80, wy, true), move);
    assert.ok(
      await sim.page.evaluate(() =>
        ZS.Sim.agents
          .filter((agent) => agent.squadId === 1)
          .every((agent) => agent.orders.length - agent.orderIndex >= 1),
      ),
    );

    const secondSquad = await sim.page.evaluate(() => {
      ZS.scenario.debugSelectWorkers(4);
      const squad = ZS.scenario.squads.create(ZS.scenario.selected, false);
      ZS.scenario.debugSelectSquad(1);
      ZS.scenario.selectSquad(squad.id, true);
      return squad.id;
    });
    assert.equal(await sim.page.evaluate(() => ZS.scenario.selected.length), 8);
    await sim.page.keyboard.down("Control");
    await sim.page.keyboard.press("Digit1");
    await sim.page.keyboard.up("Control");
    await sim.page.keyboard.press("Escape");
    assert.equal(await sim.page.evaluate(() => ZS.scenario.selected.length), 0);
    await sim.page.keyboard.press("Digit1");
    assert.equal(await sim.page.evaluate(() => ZS.scenario.selected.length), 8);
    await sim.page.locator("#zone-area-scavenge").click();
    assert.equal(await sim.page.evaluate(() => ZS.scenario.commandMode), "area");
    const areaRoute = await sim.page.evaluate(() => {
      const scenario = ZS.scenario,
        targets = scenario.map.records
          .filter(
            (record) =>
              record !== scenario.map.hq &&
              record.use === ZS.ZoneConfig.BUILDING_USE.ABANDONED &&
              !record.looted &&
              scenario.map.lootTotal(record) > 0,
          )
          .sort(
            (a, b) =>
              Math.hypot(a.cx - scenario.map.hq.cx, a.cy - scenario.map.hq.cy) -
              Math.hypot(b.cx - scenario.map.hq.cx, b.cy - scenario.map.hq.cy),
          )
          .slice(0, 6),
        x0 = Math.min(...targets.map((record) => record.shape.x)) - 2,
        y0 = Math.min(...targets.map((record) => record.shape.y)) - 2,
        x1 = Math.max(...targets.map((record) => record.shape.x + record.shape.w)) + 2,
        y1 = Math.max(...targets.map((record) => record.shape.y + record.shape.h)) + 2;
      scenario.pointerDown(x0, y0, {
        button: 0,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
      });
      scenario.pointerMove(x1, y1);
      scenario.pointerUp(x1, y1);
      const squads = scenario._selectedSquads(),
        ids = squads.flatMap((squad) =>
          squad.orders
            .slice(squad.orderIndex)
            .filter((order) => order.kind === ZS.ZoneConfig.ORDER.SCAVENGE)
            .map((order) => order.buildingId),
        );
      return {
        mode: scenario.commandMode,
        perSquad: squads.map(
          (squad) =>
            squad.orders
              .slice(squad.orderIndex)
              .filter((order) => order.kind === ZS.ZoneConfig.ORDER.SCAVENGE).length,
        ),
        count: ids.length,
        unique: new Set(ids).size,
      };
    });
    assert.equal(areaRoute.mode, null);
    assert.ok(areaRoute.perSquad.every((count) => count > 0));
    assert.ok(areaRoute.count >= 6);
    assert.equal(areaRoute.unique, areaRoute.count);
    await sim.page.evaluate(({ wx, wy }) => ZS.scenario.debugIssueMove(wx, wy, false), move);
    assert.ok(
      await sim.page.evaluate(
        (id) =>
          ZS.scenario.squads.list
            .filter((squad) => squad.id === 1 || squad.id === id)
            .every((squad) => squad.orders.length === 1),
        secondSquad,
      ),
    );

    await sim.page.locator('[data-speed="4"]').click();
    const clock = await sim.page.evaluate(() => {
      const minute0 = ZS.scenario.state.minute;
      ZS.Sim.update(2, performance.now() / 1000, ZS.debug.world, innerWidth, innerHeight);
      return { minute0, minute1: ZS.scenario.state.minute };
    });
    assert.ok(
      Math.abs(clock.minute1 - clock.minute0 - 32) < 0.2,
      "4x clock should advance by fixed steps: " + clock.minute0 + " -> " + clock.minute1,
    );
    await sim.page.locator('[data-speed="0"]').click();
    const pausedClock = await sim.page.evaluate(() => {
      const minute0 = ZS.scenario.state.minute,
        x0 = ZS.Sim.agents[0].x,
        y0 = ZS.Sim.agents[0].y;
      ZS.Sim.update(2, performance.now() / 1000, ZS.debug.world, innerWidth, innerHeight);
      return {
        minute0,
        minute1: ZS.scenario.state.minute,
        x0,
        y0,
        x1: ZS.Sim.agents[0].x,
        y1: ZS.Sim.agents[0].y,
      };
    });
    assert.equal(pausedClock.minute1, pausedClock.minute0);
    assert.equal(pausedClock.x1, pausedClock.x0);
    assert.equal(pausedClock.y1, pausedClock.y0);

    const saved = await sim.page.evaluate(() => {
      ZS.scenario.state.save();
      return { hq: ZS.scenario.map.hq.id, minute: ZS.scenario.state.minute };
    });
    await sim.page.goto(pageUrl("zone.html", { seed: 999, record: 1 }));
    await sim.page.waitForFunction(() => window.ZS && ZS.debug && ZS.scenario.map.hq);
    const restored = await sim.page.evaluate(() => ({
      seed: ZS.scenario.state.seed,
      hq: ZS.scenario.map.hq.id,
      agents: ZS.Sim.agents.length,
      minute: ZS.scenario.state.minute,
      paused: ZS.scenario.state.paused,
    }));
    assert.equal(restored.seed, 12345);
    assert.equal(restored.hq, saved.hq);
    assert.equal(restored.agents, 16);
    assert.equal(restored.minute, saved.minute);
    assert.equal(restored.paused, true);
    assertNoErrors(sim.errors, "zone.html");
    process.stdout.write("✓ save migrations and round-trip\n");
    process.stdout.write("✓ HQ setup and starting team\n");
    process.stdout.write("✓ squad-first box selection and contextual orders\n");
    process.stdout.write("✓ multi-squad orders, area scavenge and numeric control groups\n");
    process.stdout.write("✓ pause and fixed-step ×4 clock\n");
  } finally {
    await sim.context.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
