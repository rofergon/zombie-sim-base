"use strict";

const assert = require("node:assert/strict");
const { assertNoErrors, launch, openSim, pageUrl } = require("./browser");

(async () => {
  const browser = await launch();
  const sim = await openSim(browser, "zone.html", { seed: 24680, fresh: 1, record: 1 });
  try {
    const migration = await sim.page.evaluate(() =>
      ZS.ZoneSave.migrate({
        v: 9,
        world: { seed: 44, configured: true, source: "procedural", size: "classic" },
        clock: { day: 4, minute: 620, speed: 1, paused: false },
        zone: { hqId: 2, initialized: false },
      }),
    );
    assert.equal(migration.v, 16);
    assert.equal(migration.zone.campaign.cureStage, 0);
    assert.deepEqual(migration.zone.campaign.factions, [0, 0, 0]);

    await sim.page.locator("#zone-hq-action").click();
    await sim.page.waitForFunction(() => ZS.scenario.campaign.data.pending === "first_signal");
    assert.equal(
      await sim.page.locator(".zone-campaign-event h3").textContent(),
      "La voz entre la estática",
    );
    await sim.page.locator('[data-campaign-choice="answer"]').click();

    const firstSignal = await sim.page.evaluate(() => ({
      pending: ZS.scenario.campaign.data.pending,
      stage: ZS.scenario.campaign.data.cureStage,
      faros: ZS.scenario.campaign.data.factions[ZS.ZoneConfig.FACTION.FAROS],
      history: ZS.scenario.campaign.data.history.length,
      name: ZS.scenario.citizens.at(1).name,
      paused: ZS.scenario.paused,
    }));
    assert.equal(firstSignal.pending, null);
    assert.equal(firstSignal.stage, 1);
    assert.equal(firstSignal.faros, 12);
    assert.equal(firstSignal.history, 1);
    assert.match(firstSignal.name, /\S+ \S+/);
    assert.equal(firstSignal.paused, false);

    const population = await sim.page.evaluate(() => {
      const scenario = ZS.scenario;
      scenario.state.stock[ZS.ZoneConfig.RESOURCE.FOOD] = 200;
      scenario.map.hq.capacity = 60;
      scenario.campaign.queue("roof_survivors", false);
      const before = scenario.citizens.stats().population;
      const chosen = scenario.campaign.choose("roof_survivors", "everyone"),
        citizens = scenario.citizens.byId.filter(Boolean);
      return {
        before,
        after: scenario.citizens.stats().population,
        chosen,
        names: citizens.map((citizen) => citizen.name),
        arrivals: citizens.slice(-5).map((citizen) => citizen.arrivalDay),
      };
    });
    assert.equal(population.chosen, true);
    assert.equal(population.after - population.before, 5);
    assert.equal(new Set(population.names).size, population.names.length);
    assert.ok(population.arrivals.every((day) => day === 1));

    const diplomacy = await sim.page.evaluate(() => {
      const scenario = ZS.scenario,
        R = ZS.ZoneConfig.RESOURCE,
        F = ZS.ZoneConfig.FACTION;
      scenario.state.stock[R.WOOD] = 100;
      scenario.campaign.queue("cobalt_caravan", false);
      scenario.campaign.choose("cobalt_caravan", "trade");
      const standing = scenario.campaign.data.factions[F.COBALTO],
        firstTrade = scenario.campaign.trade(F.COBALTO),
        secondTrade = scenario.campaign.trade(F.COBALTO);
      scenario.campaign.queue("clinic_vote", false);
      scenario.campaign.choose("clinic_vote", "open");
      return {
        standing,
        firstTrade,
        secondTrade,
        law: scenario.campaign.data.law,
        lawsUnlocked: scenario.campaign.flag("laws-unlocked"),
      };
    });
    assert.equal(diplomacy.standing, 12);
    assert.equal(diplomacy.firstTrade, true);
    assert.equal(diplomacy.secondTrade, false);
    assert.equal(diplomacy.law, 1);
    assert.equal(diplomacy.lawsUnlocked, true);

    const cure = await sim.page.evaluate(() => {
      const scenario = ZS.scenario,
        CFG = ZS.ZoneConfig,
        R = CFG.RESOURCE,
        U = CFG.BUILDING_USE,
        record = scenario.map.records.find((candidate) => candidate !== scenario.map.hq);
      record.use = U.RESEARCH;
      record.active = true;
      record.hp = Math.max(1, record.maxHP || 100);
      record.maxHP = Math.max(record.hp, 100);
      record.powered = true;
      scenario.campaign.addFlag("viable-sample");
      scenario.state.stock[R.SCIENCE] = 200;
      scenario.state.stock[R.MEDICINE] = 200;
      const sample = scenario.campaign.advanceCure(),
        prototype = scenario.campaign.advanceCure(),
        trialPending = scenario.campaign.data.pending;
      scenario.campaign.choose("trial_request", "volunteers");
      record.powered = true;
      const trial = scenario.campaign.advanceCure();
      record.powered = true;
      const formula = scenario.campaign.advanceCure(),
        formulaPending = scenario.campaign.data.pending;
      scenario.campaign.choose("formula_ready", "broadcast");
      const multiplier = scenario.campaign.nightMultiplier();
      scenario.campaign.onNightStarted();
      scenario.campaign.onNightEnded(true);
      const card = scenario.campaign.endingCard(),
        dismissed = scenario.campaign.dismissEnding();
      scenario.state.save();
      return {
        sample,
        prototype,
        trialPending,
        trial,
        formula,
        formulaPending,
        stage: scenario.campaign.data.cureStage,
        multiplier,
        ending: scenario.campaign.data.ending,
        card,
        dismissed,
      };
    });
    assert.equal(cure.sample, true);
    assert.equal(cure.prototype, true);
    assert.equal(cure.trialPending, "trial_request");
    assert.equal(cure.trial, true);
    assert.equal(cure.formula, true);
    assert.equal(cure.formulaPending, "formula_ready");
    assert.equal(cure.stage, 5);
    assert.ok(cure.multiplier >= 1.7);
    assert.equal(cure.ending, "broadcast");
    assert.match(cure.card.title, /Proyecto Aurora/);
    assert.equal(cure.dismissed, true);

    await sim.page.goto(pageUrl("zone.html", { seed: 1, record: 1 }));
    await sim.page.waitForFunction(() => ZS.scenario && ZS.scenario.map.hq);
    const restored = await sim.page.evaluate(() => ({
      version: ZS.ZoneConfig.SAVE_VERSION,
      population: ZS.scenario.citizens.stats().population,
      stage: ZS.scenario.campaign.data.cureStage,
      ending: ZS.scenario.campaign.data.ending,
      history: ZS.scenario.campaign.data.history.length,
      named: ZS.scenario.state.zone.citizens.every((citizen) => Boolean(citizen.name)),
    }));
    assert.equal(restored.version, 16);
    assert.equal(restored.population, population.after);
    assert.equal(restored.stage, 5);
    assert.equal(restored.ending, "broadcast");
    assert.ok(restored.history >= 8);
    assert.equal(restored.named, true);

    assertNoErrors(sim.errors, "zone campaign");
    process.stdout.write(
      "✓ human events, recruitment, factions, trade, laws, cure and campaign ending\n",
    );
  } finally {
    await sim.context.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
