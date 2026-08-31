"use strict";

const assert = require("node:assert/strict");
const { assertNoErrors, launch, openSim, pageUrl } = require("./browser");

function osmFixture() {
  const lat = 4.65,
    lon = -74.05;
  return {
    elements: [
      { type: "node", id: 1, lat: lat - 0.0002, lon: lon - 0.00028 },
      { type: "node", id: 2, lat: lat - 0.0002, lon: lon + 0.00028 },
      { type: "node", id: 3, lat: lat + 0.0002, lon: lon + 0.00028 },
      { type: "node", id: 4, lat: lat + 0.0002, lon: lon - 0.00028 },
      { type: "node", id: 10, lat: lat + 0.0005, lon: lon + 0.0005 },
      { type: "node", id: 11, lat: lat + 0.0005, lon: lon + 0.00075 },
      { type: "node", id: 12, lat: lat + 0.0007, lon: lon + 0.00075 },
      { type: "node", id: 13, lat: lat + 0.0007, lon: lon + 0.0005 },
      {
        type: "node",
        id: 14,
        lat: lat + 0.0006,
        lon: lon + 0.00062,
        tags: { shop: "pharmacy", name: "Farmacia Central" },
      },
      { type: "node", id: 20, lat: lat - 0.001, lon: lon - 0.002 },
      { type: "node", id: 21, lat: lat - 0.001, lon: lon + 0.002 },
      { type: "node", id: 30, lat: lat - 0.0014, lon: lon - 0.0014 },
      { type: "node", id: 31, lat: lat - 0.0014, lon: lon - 0.0008 },
      { type: "node", id: 32, lat: lat - 0.0009, lon: lon - 0.0008 },
      { type: "node", id: 33, lat: lat - 0.0009, lon: lon - 0.0014 },
      {
        type: "way",
        id: 100,
        nodes: [1, 2, 3, 4, 1],
        tags: { building: "school", amenity: "library", name: "Biblioteca del Barrio" },
      },
      {
        type: "way",
        id: 101,
        nodes: [10, 11, 12, 13, 10],
        tags: { building: "retail" },
      },
      {
        type: "way",
        id: 200,
        nodes: [20, 21],
        tags: { highway: "primary", name: "Avenida Principal" },
      },
      {
        type: "way",
        id: 300,
        nodes: [30, 31, 32, 33, 30],
        tags: { natural: "water", name: "Laguna" },
      },
    ],
  };
}

function denseOsmFixture() {
  const lat = 4.65,
    lon = -74.05,
    latScale = 111320 * 4,
    lonScale = latScale * Math.cos((lat * Math.PI) / 180),
    centers = [];
  for (let gy = 0; gy < 3; gy++)
    for (let gx = 0; gx < 3; gx++)
      if (gx !== 1 || gy !== 1) centers.push({ x: gx * 2400 + 1200, y: gy * 2400 + 1200 });
  for (let i = 0; i < 473; i++)
    centers.push({ x: 2450 + (i % 22) * 104, y: 2450 + ((i / 22) | 0) * 104 });
  const elements = [];
  for (let i = 0; i < centers.length; i++) {
    const center = centers[i],
      nodes = [];
    for (let corner = 0; corner < 4; corner++) {
      const x = center.x + (corner === 0 || corner === 3 ? -20 : 20),
        y = center.y + (corner < 2 ? -20 : 20),
        id = i * 4 + corner + 1;
      nodes.push(id);
      elements.push({
        type: "node",
        id,
        lat: lat - (y - 3600) / latScale,
        lon: lon + (x - 3600) / lonScale,
      });
    }
    elements.push({
      type: "way",
      id: 10000 + i,
      nodes: nodes.concat(nodes[0]),
      tags: { building: "house" },
    });
  }
  return { elements };
}

(async () => {
  const browser = await launch();
  try {
    const base = await openSim(browser, "zone.html", { seed: 321, fresh: 1, record: 1 });
    const pack = await base.page.evaluate(
      ({ raw, lat, lon }) => {
        const first = ZS.ZoneMapPack.fromOverpass(
            raw,
            { lat, lon, name: "Bogotá · fixture" },
            "standard",
          ),
          second = ZS.ZoneMapPack.fromOverpass(
            raw,
            { lat, lon, name: "Bogotá · fixture" },
            "standard",
          );
        if (first.hash !== second.hash) throw new Error("MapPack hash is not stable");
        first.elevation = {
          cols: 3,
          rows: 3,
          values: [2600, 2602, 2604, 2601, 2604, 2608, 2602, 2607, 2612],
          min: 2600,
          max: 2612,
          source: "fixture",
        };
        return first;
      },
      { raw: osmFixture(), lat: 4.65, lon: -74.05 },
    );
    assert.equal(pack.width, 7200);
    assert.equal(pack.height, 7200);
    assert.equal(pack.buildings.length, 2);
    assert.equal(pack.roads.length, 1);
    assert.equal(pack.waters.length, 1);
    assert.equal(pack.regions.length, 25);
    assert.equal(pack.buildings[0].name, "Biblioteca del Barrio");
    assert.equal(pack.buildings[1].name, "Farmacia Central");
    const coverage = await base.page.evaluate(
      ({ raw, lat, lon }) => {
        const dense = ZS.ZoneMapPack.fromOverpass(
            raw,
            { lat, lon, name: "Ciudad densa" },
            "standard",
          ),
          normalized = ZS.ZoneMapPack.normalize(JSON.parse(JSON.stringify(dense))),
          legacy = JSON.parse(JSON.stringify(dense)),
          cells = new Set();
        legacy.version = 2;
        legacy.contextBuildings = legacy.buildings.splice(-1);
        const migrated = ZS.ZoneMapPack.normalize(legacy),
          world = new ZS.World(dense.width, dense.height),
          nav = new ZS.Nav(world, ZS.ZoneConfig.GEO.NAV_CELL),
          map = new ZS.ZoneMap(ZS.scenario.state, { pack: dense });
        world.nav = nav;
        map.prepare(world, nav);
        for (let i = 0; i < dense.buildings.length; i++) {
          const bounds = dense.buildings[i].bounds,
            gx = Math.min(2, Math.floor(((bounds.x0 + bounds.x1) * 3) / 14400)),
            gy = Math.min(2, Math.floor(((bounds.y0 + bounds.y1) * 3) / 14400));
          cells.add(gx + ":" + gy);
        }
        return {
          active: dense.buildings.length,
          cells: cells.size,
          normalized: normalized.buildings.length,
          migrated: migrated.buildings.length,
          doors: map.records.filter((record) => record.shape.door).length,
          selectable: map.records.filter(
            (record) => map.buildingAt(record.cx, record.cy) === record,
          ).length,
          lootable: map.records.filter(
            (record) => map.reachable(record) && map.lootTotal(record) > 0,
          ).length,
          stableHash: normalized.hash === dense.hash,
          stableMigrationHash: migrated.hash === dense.hash,
        };
      },
      { raw: denseOsmFixture(), lat: 4.65, lon: -74.05 },
    );
    assert.deepEqual(coverage, {
      active: 481,
      cells: 9,
      normalized: 481,
      migrated: 481,
      doors: 481,
      selectable: 481,
      lootable: 481,
      stableHash: true,
      stableMigrationHash: true,
    });
    const longDetour = await base.page.evaluate(() => {
      const world = { w: 7200, h: 7200 },
        nav = new ZS.Nav(world, ZS.ZoneConfig.GEO.NAV_CELL);
      nav.markRect(3600, 0, 10, 6700, 0);
      const started = performance.now(),
        path = nav.astar(1800, 1800, 5400, 1800, false);
      return {
        found: Boolean(path && path.length),
        nodes: path ? path.length : 0,
        elapsed: performance.now() - started,
      };
    });
    assert.equal(longDetour.found, true, "long geographic detour should not exhaust A*");
    assert.ok(longDetour.nodes > 2);
    const densePack = await base.page.evaluate(
      ({ raw, lat, lon }) =>
        ZS.ZoneMapPack.fromOverpass(raw, { lat, lon, name: "Ciudad de rutas" }, "standard"),
      { raw: denseOsmFixture(), lat: 4.65, lon: -74.05 },
    );
    assert.equal(
      await base.page.evaluate(() => {
        const xml =
            '<osm version="0.6"><node id="1" lat="4.65" lon="-74.05"><tag k="amenity" v="library"/></node><node id="2" lat="4.65" lon="-74.049"/><way id="8"><nd ref="1"/><nd ref="2"/><tag k="highway" v="service"/></way></osm>',
          parsed = ZS.ZoneMapPack.fromOsmXml(xml);
        return (
          ZS.scenario.geo.service.preferOsmMap &&
          parsed.elements.length === 3 &&
          parsed.elements[0].tags.amenity === "library" &&
          parsed.elements[2].nodes.length === 2
        );
      }),
      true,
    );
    await base.context.close();

    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript((fixturePack) => {
      window.ZS_TEST_MAP_PACK = fixturePack;
    }, pack);
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(pageUrl("zone.html", { seed: 123, record: 1 }));
    await page.waitForFunction(() => window.ZS && ZS.debug && ZS.scenario.map.recommended);
    const loaded = await page.evaluate(() => ({
      width: ZS.debug.world.w,
      height: ZS.debug.world.h,
      chunked: ZS.debug.world.chunked,
      buildings: ZS.scenario.map.records.length,
      source: ZS.scenario.geo.source,
      mapId: ZS.scenario.geo.pack.id,
      suitable: ZS.scenario.map.suitableHQ(ZS.scenario.map.recommended),
      heightGrid: Boolean(ZS.debug.nav.height),
      overviewWidth: ZS.debug.world.overviewCanvas.width,
      overviewBuildingInk: ZS.debug.world.overviewBuildingInk,
      maxCanvas: Math.max(ZS.debug.world.canvas.width, ZS.debug.world.canvas.height),
      navCell: ZS.debug.nav.cell,
    }));
    assert.deepEqual(loaded, {
      width: 7200,
      height: 7200,
      chunked: true,
      buildings: 2,
      source: "osm",
      mapId: pack.id,
      suitable: true,
      heightGrid: true,
      overviewWidth: 1024,
      overviewBuildingInk: true,
      maxCanvas: 1,
      navCell: 10,
    });
    const access = await page.evaluate(() => {
      const scenario = ZS.scenario,
        nav = ZS.debug.nav,
        buildings = scenario.map.records,
        validDoors = buildings.every((record) => {
          const door = record.shape.door;
          if (!door || scenario.map.entryPoint(record) !== door.inner) return false;
          const frontX = door.frontIdx % nav.w,
            frontY = (door.frontIdx / nav.w) | 0;
          return door.cells.some((index) => {
            const x = index % nav.w,
              y = (index / nav.w) | 0;
            return nav.val[index] === 3 && Math.abs(x - frontX) + Math.abs(y - frontY) === 1;
          });
        }),
        other = buildings.find((record) => record !== scenario.map.recommended),
        frontPath = nav.astar(
          scenario.map.recommended.shape.door.front.x,
          scenario.map.recommended.shape.door.front.y,
          other.shape.door.front.x,
          other.shape.door.front.y,
          false,
        ),
        interiorPaths = buildings.map((record) =>
          Boolean(
            nav.astar(
              record.shape.door.inner.x,
              record.shape.door.inner.y,
              record.shape.door.front.x,
              record.shape.door.front.y,
              false,
            ),
          ),
        );
      return {
        validDoors,
        frontConnected: Boolean(frontPath && frontPath.length),
        accessIds: buildings.map((record) => record.shape.door.accessId),
        interiorPaths,
      };
    });
    assert.deepEqual(access, {
      validDoors: true,
      frontConnected: true,
      accessIds: [0, 0],
      interiorPaths: [true, true],
    });
    await page.locator("#zone-hq-action").click();
    const routeJob = await page.evaluate(() => {
      const scenario = ZS.scenario,
        target = scenario.map.records.find((record) => record !== scenario.map.hq),
        initial = scenario.map.materialsTotal(target),
        job = scenario.tasks.postSalvage(target.id, ZS.ZoneConfig.PRIORITY.HIGH);
      return { targetId: target.id, initial, jobId: job.id };
    });
    await page.evaluate(() => ZS.recording.advance(30));
    const routeProgress = await page.evaluate(({ targetId, jobId }) => {
      const scenario = ZS.scenario;
      return {
        remaining: scenario.map.materialsTotal(scenario.map.at(targetId)),
        state: scenario.tasks.at(jobId).state,
      };
    }, routeJob);
    assert.ok(routeProgress.remaining < routeJob.initial || routeProgress.state === 2);
    await page.evaluate(() => {
      const scenario = ZS.scenario,
        R = ZS.ZoneConfig.RESOURCE,
        squad = scenario.squads.list[0],
        point = scenario.map.hq.shape.door.inner;
      scenario.squads.clearOrders(squad);
      scenario.state.stock[R.FOOD] = Math.max(6, scenario.state.stock[R.FOOD]);
      scenario.state.stock[R.AMMO] = Math.max(2, scenario.state.stock[R.AMMO]);
      for (let i = 0; i < squad.members.length; i++) {
        const member = scenario.citizens.at(squad.members[i]);
        member.x = point.x + (i - 1.5) * 3;
        member.y = point.y;
        member.vx = member.vy = 0;
        member.bld = scenario.map.hq.id;
      }
      scenario._markUI();
    });
    await page.locator('[data-system="expedition"]').click();
    assert.equal(await page.locator("[data-expedition-region]").count(), 25);
    const enabled = page.locator("[data-expedition-region]:not(:disabled)").first();
    await enabled.click();
    const expedition = await page.evaluate(() => {
      const before = ZS.scenario.state.zone.expedition.regionId;
      ZS.scenario.regions.update(46);
      return {
        before,
        after: ZS.scenario.state.zone.expedition,
        scouted: ZS.scenario.regions.byId.get(before).scouted,
      };
    });
    assert.ok(expedition.before);
    assert.equal(expedition.after, null);
    assert.equal(expedition.scouted, true);
    assertNoErrors(errors, "zone OSM fixture");
    await context.close();
    process.stdout.write(
      "✓ stable OSM MapPack, chunked world, elevation and connected expeditions\n",
    );

    const routeContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await routeContext.addInitScript((fixturePack) => {
      window.ZS_TEST_MAP_PACK = fixturePack;
    }, densePack);
    const routePage = await routeContext.newPage(),
      routeErrors = [];
    routePage.on("pageerror", (error) => routeErrors.push(String(error)));
    routePage.on("console", (message) => {
      if (message.type() === "error") routeErrors.push(message.text());
    });
    await routePage.goto(pageUrl("zone.html", { seed: 777, record: 1 }));
    await routePage.waitForFunction(() => window.ZS && ZS.debug && ZS.scenario.map.recommended);
    await routePage.locator("#zone-hq-action").click();
    const queuedRoute = await routePage.evaluate(() => {
      const scenario = ZS.scenario,
        squad = scenario.squads.list[0],
        desired = [
          { x: 6000, y: 6000 },
          { x: 6000, y: 1200 },
          { x: 1200, y: 6000 },
          { x: 3600, y: 3600 },
        ],
        targets = [];
      scenario.maintain = () => {};
      for (let i = 0; i < desired.length; i++) {
        let best = null,
          distance = Infinity;
        for (let j = 0; j < scenario.map.records.length; j++) {
          const record = scenario.map.records[j],
            d = Math.hypot(record.cx - desired[i].x, record.cy - desired[i].y);
          if (
            record !== scenario.map.hq &&
            !targets.includes(record) &&
            scenario.map.reachable(record) &&
            d < distance
          ) {
            best = record;
            distance = d;
          }
        }
        best.looted = true;
        targets.push(best);
      }
      scenario.squads.clearOrders(squad);
      for (let i = 0; i < targets.length; i++)
        scenario.squads.issueContext(squad, targets[i].cx, targets[i].cy, i > 0, targets[i]);
      const trace = (window.ZS_ROUTE_TRACE = []),
        originalAdvance = scenario.squads._advance;
      scenario.squads._advance = function (current) {
        const order = current.orders[current.orderIndex],
          leader = scenario.citizens.at(current.members[0]);
        if (order && order.kind === ZS.ZoneConfig.ORDER.ENTER)
          trace.push({ expected: order.buildingId, actual: leader.bld });
        return originalAdvance.call(this, current);
      };
      return { issued: squad.orders.length, targets: targets.map((record) => record.id) };
    });
    assert.equal(queuedRoute.issued, 4);
    await routePage.evaluate(() => ZS.recording.advance(380));
    const routeResult = await routePage.evaluate(() => ({
      trace: window.ZS_ROUTE_TRACE,
      pending: ZS.scenario.squads.list[0].orders.length,
    }));
    assert.deepEqual(
      routeResult.trace.map((entry) => entry.expected),
      queuedRoute.targets,
      "multi-step geographic route should visit every queued building",
    );
    assert.ok(
      routeResult.trace.every((entry) => entry.actual === entry.expected),
      "an entry order must complete inside its requested building",
    );
    assert.equal(routeResult.pending, 0);
    assertNoErrors(routeErrors, "long geographic squad route");
    await routeContext.close();
    process.stdout.write("✓ long OSM squad route enters every queued building without stalling\n");

    const previewContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    await previewContext.addInitScript(() => {
      window.ZS_GEO_ENDPOINTS = {
        tiles: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
      };
    });
    const previewPage = await previewContext.newPage(),
      previewErrors = [];
    previewPage.on("pageerror", (error) => previewErrors.push(String(error)));
    previewPage.on("console", (message) => {
      if (message.type() === "error") previewErrors.push(message.text());
    });
    await previewPage.goto(pageUrl("zone.html"));
    await previewPage.locator(".zone-map-setup").waitFor();
    await previewPage.evaluate(
      ({ raw, lat, lon }) => {
        ZS.scenario.geo.service.search = async () => [
          {
            lat,
            lon,
            name: "Pereira · fixture",
            type: "city",
            bounds: { south: lat - 0.07, north: lat + 0.07, west: lon - 0.07, east: lon + 0.07 },
          },
        ];
        ZS.scenario.geo.service.download = async (selection, size, _elevation, progress) => {
          progress("Convirtiendo cartografía de prueba…");
          return ZS.ZoneMapPack.fromOverpass(raw, selection, size);
        };
      },
      { raw: osmFixture(), lat: 4.65, lon: -74.05 },
    );
    await previewPage.locator("#zone-place-query").fill("Pereira");
    await previewPage.locator(".zone-place-search button").click();
    await previewPage.locator(".zone-place-results button").click();
    const previewCanvas = previewPage.locator(".zone-map-preview canvas");
    await previewPage.locator('.zone-map-preview canvas[data-preview="context"]').waitFor();
    assert.ok(await previewPage.locator(".zone-map-tile-layer img").count());
    assert.equal(await previewPage.locator(".zone-preview-attribution").isVisible(), true);
    const initialZoom = Number(await previewCanvas.getAttribute("data-zoom")),
      initialSelectionPixels = Number(await previewCanvas.getAttribute("data-selection-px"));
    await previewPage.locator('[data-map-zoom="1"]').click();
    assert.equal(Number(await previewCanvas.getAttribute("data-zoom")), initialZoom + 1);
    assert.ok(
      Number(await previewCanvas.getAttribute("data-selection-px")) > initialSelectionPixels * 1.9,
    );
    const initialCenter = await previewCanvas.getAttribute("data-center"),
      canvasBounds = await previewCanvas.boundingBox();
    await previewPage.mouse.move(canvasBounds.x + canvasBounds.width / 2, canvasBounds.y + 180);
    await previewPage.mouse.down();
    await previewPage.mouse.move(
      canvasBounds.x + canvasBounds.width / 2 + 45,
      canvasBounds.y + 180,
    );
    await previewPage.mouse.up();
    assert.notEqual(await previewCanvas.getAttribute("data-center"), initialCenter);
    await previewPage.locator("[data-map-fit]").click();
    for (const [size, cells] of [
      ["compact", "1"],
      ["large", "5"],
      ["standard", "3"],
    ]) {
      await previewPage.locator('[data-zone-size="' + size + '"]').click();
      assert.equal(
        await previewPage.locator(".zone-map-preview canvas").getAttribute("data-cells"),
        cells,
      );
    }
    assert.equal(await previewPage.locator(".zone-osm-start").isDisabled(), true);
    await previewPage.locator(".zone-map-load").click();
    await previewPage.locator('.zone-map-preview canvas[data-preview="map"]').waitFor();
    assert.equal(
      await previewPage.locator(".zone-map-preview canvas").getAttribute("data-cells"),
      "3",
    );
    assert.equal(
      await previewPage.locator(".zone-map-preview canvas").getAttribute("data-buildings"),
      "2",
    );
    assert.match(await previewPage.locator(".zone-grid-label").textContent(), /3 × 3/);
    assert.equal(await previewPage.locator(".zone-osm-start").isEnabled(), true);
    assert.equal(await previewPage.evaluate(() => Boolean(window.ZS.debug)), false);
    await previewPage.locator(".zone-osm-start").click();
    await previewPage.waitForFunction(() => window.ZS && ZS.debug && ZS.debug.world.w === 7200);
    const urbanForest = await previewPage.evaluate(() => ({
      trees: ZS.debug.world.trees.length,
      roadTrees: ZS.debug.world.trees.filter((tree) => {
        const index = ZS.debug.nav.idx(tree.x, tree.y);
        return index >= 0 && ZS.debug.nav.road[index];
      }).length,
    }));
    assert.ok(urbanForest.trees > 0);
    assert.equal(urbanForest.roadTrees, 0);
    assertNoErrors(previewErrors, "geographic selector preview");
    await previewContext.close();
    process.stdout.write("✓ real vector preview and 1×1 / 3×3 / 5×5 sector grids\n");

    const setupContext = await browser.newContext({ viewport: { width: 1100, height: 760 } });
    const setupPage = await setupContext.newPage();
    await setupPage.goto(pageUrl("zone.html"));
    await setupPage.locator(".zone-map-setup").waitFor();
    await setupPage.locator('[data-zone-size="compact"]').click();
    await setupPage.locator(".zone-procedural-start").click();
    await setupPage.waitForFunction(() => window.ZS && ZS.debug);
    assert.deepEqual(
      await setupPage.evaluate(() => ({
        width: ZS.debug.world.w,
        height: ZS.debug.world.h,
        source: ZS.scenario.state.data.world.source,
        size: ZS.scenario.state.data.world.size,
        configured: ZS.scenario.state.data.world.configured,
      })),
      { width: 2400, height: 2400, source: "procedural", size: "compact", configured: true },
    );
    await setupContext.close();
    process.stdout.write("✓ first-run selector and compact procedural fallback\n");

    const large = await openSim(browser, "zone.html", {
      seed: 919,
      fresh: 1,
      size: "large",
      forceWebGLActors: 1,
    });
    const largeWorld = await large.page.evaluate(() => ({
      width: ZS.debug.world.w,
      height: ZS.debug.world.h,
      chunked: ZS.debug.world.chunked,
      buildings: ZS.scenario.map.records.length,
      overviewWidth: ZS.debug.world.overviewCanvas.width,
      overviewBuildingInk: ZS.debug.world.overviewBuildingInk,
      maxCanvas: Math.max(ZS.debug.world.canvas.width, ZS.debug.world.canvas.height),
    }));
    assert.equal(largeWorld.width, 12000);
    assert.equal(largeWorld.height, 12000);
    assert.equal(largeWorld.chunked, true);
    assert.ok(largeWorld.buildings > 72 && largeWorld.buildings <= 1200);
    assert.equal(largeWorld.overviewWidth, 1024);
    assert.equal(largeWorld.overviewBuildingInk, true);
    assert.equal(largeWorld.maxCanvas, 1);
    await large.page.evaluate(() => {
      ZS.debug.cam.auto = false;
      ZS.debug.cam.fit(innerWidth, innerHeight);
    });
    await large.page.waitForFunction(
      () => ZS.renderBackend && ZS.renderBackend.stats && ZS.renderBackend.stats.overview,
    );
    const largeRenderer = await large.page.evaluate(() => ZS.renderBackend.stats);
    assert.equal(largeRenderer.mode, "zone");
    assert.equal(largeRenderer.overview, true);
    assert.ok(largeRenderer.chunks <= 24);
    assert.equal(largeRenderer.buildingLod, true);
    assertNoErrors(large.errors, "large procedural Zone");
    await large.context.close();
    process.stdout.write("✓ 5×5 large procedural world uses bounded chunk canvases\n");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
