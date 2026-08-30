"use strict";

const assert = require("node:assert/strict");
const { assertNoErrors, launch, openSim } = require("./browser");

const CASES = [
  {
    page: "index.html",
    scenario: "ScenarioZombie",
    check: (state) => state.agents > 0 && state.buildings > 0,
  },
  {
    page: "battle.html",
    scenario: "ScenarioCannae",
    check: (state) => state.agents === 781,
  },
  {
    page: "hold.html",
    scenario: "ScenarioHold",
    check: (state) => state.hasCore && state.phase === "day",
  },
  {
    page: "zone.html",
    scenario: "ScenarioZone",
    query: { fresh: 1, forceWebGLActors: 1 },
    check: (state) => state.buildings >= 40 && state.buildings <= 72 && state.timeScale === 0,
  },
];

(async () => {
  const browser = await launch();
  try {
    for (const item of CASES) {
      const sim = await openSim(browser, item.page, {
        seed: 12345,
        record: 1,
        ...item.query,
      });
      const state = await sim.page.evaluate(() => ({
        scenario: ZS.scenario.constructor.name,
        agents: ZS.Sim.agents.length,
        buildings: ZS.debug.world.buildings.length,
        hasCore: Boolean(ZS.scenario.blocks && ZS.scenario.blocks.core),
        phase: ZS.scenario.phase,
        timeScale: ZS.scenario.timeScale,
        renderer: ZS.renderBackend && ZS.renderBackend.constructor.name,
      }));
      assert.equal(state.scenario, item.scenario, item.page + " scenario");
      assert.ok(item.check(state), item.page + " invariant: " + JSON.stringify(state));
      if (item.page === "hold.html") {
        await sim.page.waitForFunction(
          () => ZS.renderBackend && ZS.renderBackend.ready && ZS.renderBackend.paintCount > 0,
        );
        const renderer = await sim.page.evaluate(() => ({
          backend: ZS.renderBackend.stats.backend,
          chunks: ZS.renderBackend.stats.chunks,
          webgl: ZS.renderBackend.game.renderer.type === Phaser.WEBGL,
          blocks: ZS.renderBackend.stats.blockSprites,
          actorAtlases: ZS.renderBackend.stats.actorAtlases,
        }));
        assert.equal(state.renderer, "PhaserRenderer", "hold.html renderer");
        assert.equal(renderer.backend, "phaser-webgl-sketch", "hold.html backend");
        assert.ok(renderer.chunks > 0 && renderer.chunks <= 24, "hold.html bounded chunk cache");
        assert.equal(renderer.webgl, true, "hold.html WebGL renderer");
        assert.equal(renderer.blocks, 1, "hold.html core block sprite");
        assert.ok(renderer.actorAtlases >= 1, "hold.html shared actor atlas");

        await sim.page.evaluate(() => {
          const core = ZS.scenario.blocks.core;
          ZS.scenario.debugSpawnZombie(core.x0 - 20, core.by - 20);
        });
        await sim.page.waitForFunction(() => ZS.renderBackend.stats.agentSprites === 1);
        const actor = await sim.page.evaluate(() => ({
          atlases: ZS.renderBackend.stats.actorAtlases,
          depth: Array.from(ZS.renderBackend.agentAtlas.records.values())[0].image.depth,
          y: ZS.Sim.agents[0].y,
        }));
        assert.ok(actor.atlases >= 2, "hold.html agent atlas allocated");
        assert.equal(actor.depth, actor.y, "hold.html agent y-depth");
        await sim.page.evaluate(() => {
          ZS.Sim.agents.length = 0;
        });
        await sim.page.waitForFunction(() => ZS.renderBackend.stats.agentSprites === 0);
      } else if (item.page === "zone.html") {
        await sim.page.waitForFunction(
          () => ZS.renderBackend && ZS.renderBackend.ready && ZS.renderBackend.actorPaintCount > 0,
        );
        const renderer = await sim.page.evaluate(() => {
          const atlas = ZS.renderBackend.buildingAtlases.atlases.find(
              (candidate) => candidate.records.size,
            ),
            record = atlas && Array.from(atlas.records.values())[0];
          return {
            backend: ZS.renderBackend.stats.backend,
            mode: ZS.renderBackend.stats.mode,
            chunks: ZS.renderBackend.stats.chunks,
            chunkSize: ZS.renderBackend.stats.chunkSize,
            buildings: ZS.renderBackend.stats.buildingSprites,
            buildingPaints: ZS.renderBackend.stats.buildingPaints,
            buildingInk: ZS.renderBackend.stats.buildingInk,
            buildingInkAlpha: ZS.renderBackend.stats.buildingInkAlpha,
            buildingInkScreenWidth: ZS.renderBackend.stats.buildingInkScreenWidth,
            trees: ZS.renderBackend.stats.treeSprites,
            fallback: ZS.renderBackend.stats.actorFallback,
            actorBackend: ZS.renderBackend.stats.actorBackend,
            webgl: ZS.renderBackend.game.renderer.type === Phaser.WEBGL,
            depth: record && record.image.depth,
            expectedDepth: record && record.object.y + record.object.h,
            buildingPixelRatio: atlas && atlas.pixelRatio,
          };
        });
        assert.equal(state.renderer, "PhaserRenderer", "zone.html renderer");
        assert.equal(renderer.backend, "phaser-webgl-sketch", "zone.html backend");
        assert.equal(renderer.mode, "zone", "zone.html renderer mode");
        assert.equal(renderer.chunkSize, 1024, "zone.html sector size");
        assert.ok(renderer.chunks > 0 && renderer.chunks <= 24, "zone.html bounded sector cache");
        assert.ok(renderer.buildings > 0, "zone.html visible building atlases");
        assert.ok(renderer.buildingPaints > 0, "zone.html building atlas painted");
        assert.equal(renderer.buildingPixelRatio, 2, "zone.html crisp building atlas");
        assert.equal(renderer.buildingInk, true, "zone.html low-zoom exterior ink enabled");
        assert.ok(renderer.buildingInkAlpha > 0, "zone.html exterior ink has visible opacity");
        assert.ok(
          renderer.buildingInkScreenWidth >= 1.24,
          "zone.html exterior ink keeps its screen-space width",
        );
        assert.ok(renderer.trees > 0, "zone.html visible tree atlas");
        assert.equal(renderer.fallback, false, "zone.html actor atlas supported");
        assert.equal(renderer.actorBackend, "webgl-atlas", "zone.html forced actor atlas");
        assert.equal(renderer.webgl, true, "zone.html WebGL renderer");
        assert.equal(renderer.depth, renderer.expectedDepth, "zone.html building y-depth");
        const selection = await sim.page.evaluate(() => {
          const scenario = ZS.scenario,
            context = document.querySelector("#c").getContext("2d"),
            cam = ZS.debug.cam,
            zoom = cam.minZoom,
            previousZoom = cam.zoom,
            originalDraw = scenario._drawSelectedBuilding,
            originalLine = ZS.wline,
            originalPoly = ZS.wpoly,
            widths = [];
          let drawing = false;
          scenario._drawSelectedBuilding = function (...args) {
            drawing = true;
            try {
              return originalDraw.apply(this, args);
            } finally {
              drawing = false;
            }
          };
          ZS.wline = (...args) => {
            if (drawing) widths.push(context.lineWidth * zoom);
            return originalLine(...args);
          };
          ZS.wpoly = (...args) => {
            if (drawing) widths.push(context.lineWidth * zoom);
            return originalPoly(...args);
          };
          try {
            cam.zoom = zoom;
            scenario.drawOverlay(context);
            return widths;
          } finally {
            cam.zoom = previousZoom;
            scenario._drawSelectedBuilding = originalDraw;
            ZS.wline = originalLine;
            ZS.wpoly = originalPoly;
          }
        });
        assert.ok(selection.length > 0, "zone.html selected building remains in overlay");
        assert.ok(
          Math.min(...selection) >= 1.99,
          "zone.html selection keeps a visible screen-space width",
        );
        const inkCache = await sim.page.evaluate(() => {
          const original = ZS.appendWline,
            context = document.querySelector("#c").getContext("2d"),
            options = { ...ZS.renderBackend.renderOptions, buildingInk: true },
            t = 12345.67;
          let calls = 0;
          ZS.appendWline = (...args) => {
            calls++;
            return original(...args);
          };
          try {
            ZS.setBoil(t);
            ZS.drawScene(
              context,
              ZS.debug.cam,
              ZS.debug.world,
              ZS.Sim,
              t,
              innerWidth,
              innerHeight,
              options,
            );
            const first = calls;
            calls = 0;
            ZS.drawScene(
              context,
              ZS.debug.cam,
              ZS.debug.world,
              ZS.Sim,
              t,
              innerWidth,
              innerHeight,
              options,
            );
            return { first, second: calls };
          } finally {
            ZS.appendWline = original;
          }
        });
        assert.ok(inkCache.first > 0, "zone.html exterior ink path built");
        assert.equal(inkCache.second, 0, "zone.html exterior ink path reused within boil epoch");

        const dirtyPaint = await sim.page.evaluate(() => {
          const atlas = ZS.renderBackend.buildingAtlases.atlases.find(
              (candidate) => candidate.records.size > 1,
            ),
            records = Array.from(atlas.records.values()),
            original = ZS.drawBuildingSketch;
          let calls = 0;
          ZS.drawBuildingSketch = (...args) => {
            calls++;
            return original(...args);
          };
          try {
            for (let i = 0; i < records.length; i++) records[i].dirty = false;
            records[0].dirty = true;
            atlas.paint(performance.now() / 1000, true);
            return { calls, records: records.length };
          } finally {
            ZS.drawBuildingSketch = original;
          }
        });
        assert.ok(dirtyPaint.records > 1, "zone.html building atlas has multiple records");
        assert.equal(dirtyPaint.calls, 1, "zone.html building atlas paints only dirty records");
        await sim.page.waitForTimeout(350);
        assert.equal(
          await sim.page.evaluate(() => ZS.renderBackend.stats.buildingPaints),
          renderer.buildingPaints,
          "zone.html building atlas remains stable between boil epochs",
        );

        await sim.page.evaluate(() => {
          const cam = ZS.debug.cam;
          cam.auto = false;
          cam.panBy(137.5, -83.25, innerWidth, innerHeight);
        });
        await sim.page.waitForFunction(
          () =>
            ZS.renderBackend.stats.buildingInk &&
            ZS.renderBackend.stats.buildingInkScreenWidth >= 1.24,
        );

        await sim.page.evaluate(() => {
          const renderer = ZS.renderBackend;
          renderer._collectZoneActorsOriginal = renderer._collectZoneActors;
          renderer._collectZoneActors = () => {
            renderer.visibleBuildings.length = 161;
            renderer.visibleBuildings.fill(ZS.debug.world.buildings[0]);
            renderer.visibleTrees.length = 0;
            renderer.visibleAgents.length = 0;
          };
        });
        await sim.page.waitForFunction(
          () =>
            ZS.renderBackend.stats.buildingLod &&
            ZS.renderBackend.stats.buildingInk &&
            ZS.renderBackend.stats.buildingInkAlpha === 1,
        );
        await sim.page.evaluate(() => {
          const renderer = ZS.renderBackend;
          renderer._collectZoneActors = renderer._collectZoneActorsOriginal;
          delete renderer._collectZoneActorsOriginal;
        });

        await sim.page.evaluate(() => {
          const cam = ZS.debug.cam;
          ZS.Sim.agents.push(ZS.scenario.makeAgent(cam.x, cam.y, 0));
        });
        await sim.page.waitForFunction(() => ZS.renderBackend.stats.agentSprites === 1);
        await sim.page.evaluate(() => {
          ZS.Sim.agents.length = 0;
        });
        await sim.page.waitForFunction(() => ZS.renderBackend.stats.agentSprites === 0);
      }
      assertNoErrors(sim.errors, item.page);
      await sim.context.close();
      process.stdout.write("✓ " + item.page + "\n");
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
