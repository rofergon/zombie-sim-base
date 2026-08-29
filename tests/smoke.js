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
    query: { fresh: 1 },
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
      }));
      assert.equal(state.scenario, item.scenario, item.page + " scenario");
      assert.ok(item.check(state), item.page + " invariant: " + JSON.stringify(state));
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
