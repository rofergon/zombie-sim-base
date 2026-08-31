"use strict";

const assert = require("node:assert/strict");
const { assertNoErrors, launch, openSim, pageUrl } = require("./browser");

(async () => {
  const browser = await launch();
  const sim = await openSim(browser, "zone.html", { seed: 73129, fresh: 1, record: 1 });
  try {
    const migration = await sim.page.evaluate(() =>
      ZS.ZoneSave.migrate({
        v: 11,
        world: { seed: 19, configured: true, source: "procedural", size: "classic" },
        clock: { day: 2, minute: 540, speed: 1, paused: false },
        zone: { tech: Array.from({ length: 8 }, () => false) },
      }),
    );
    assert.equal(migration.v, 12);
    assert.deepEqual(migration.zone.research, {
      current: 0,
      progress: 0,
      materialProgress: 0,
    });

    await sim.page.locator("#zone-hq-action").click();
    const research = await sim.page.evaluate(() => {
      const scenario = ZS.scenario,
        CFG = ZS.ZoneConfig,
        R = CFG.RESOURCE,
        U = CFG.BUILDING_USE,
        T = CFG.TECH;
      for (let i = 0; i < R.COUNT; i++) scenario.state.stock[i] = 500;
      const record = scenario.map.records
        .filter((candidate) => candidate !== scenario.map.hq && scenario.map.reachable(candidate))
        .sort((a, b) => b.area - a.area)[0];
      record.revealed = true;
      record.cleared = true;
      record.infectedRemaining = 0;

      const build = scenario.adaptations.start(record, U.RESEARCH);
      scenario.tasks.reconcile();
      const builder = scenario.citizens.at(build.assigned[0]);
      build.progress = CFG.TASK.BUILD_SECONDS;
      scenario.tasks._work(builder, build, 0.01);
      scenario.tasks.reconcile();

      const job = scenario.tasks.forBuilding(record.id),
        initialCapacity = job.capacity,
        raisedStaff = scenario.adaptations.setResearchStaff(record.id, 1),
        raisedCapacity = job.capacity,
        loweredStaff = scenario.adaptations.setResearchStaff(record.id, -1),
        staff = job.assigned.map((id) => scenario.citizens.at(id));
      for (let i = 0; i < staff.length; i++) staff[i].workerState = CFG.WORKER_STATE.WORKING;

      const scienceBefore = scenario.state.stock[R.SCIENCE],
        started = scenario.adaptations.research(T.AGRICULTURE),
        unlockedImmediately = scenario.state.zone.tech[T.AGRICULTURE];
      scenario.state.zone.research.progress = 0;
      scenario.tasks._work(staff[0], job, 10);
      const oneResearcherProgress = scenario.state.zone.research.progress;
      scenario.state.zone.research.progress = 0;
      for (let i = 0; i < 3; i++) scenario.tasks._work(staff[i], job, 10);
      const threeResearcherProgress = scenario.state.zone.research.progress;

      scenario.state.zone.research.progress = CFG.RESEARCH.WORK[T.AGRICULTURE] - 1;
      scenario.tasks._work(staff[0], job, 1);
      const completed = scenario.state.zone.tech[T.AGRICULTURE];

      scenario.tasks.setPriority(job.id, CFG.PRIORITY.OFF);
      const blockedWithoutStaff = scenario.adaptations.research(T.POWER),
        blockedReason = scenario.adaptations.researchBlockReason(T.POWER);
      scenario.tasks.setPriority(job.id, CFG.PRIORITY.NORMAL);
      scenario.tasks.reconcile();
      const restoredStaff = job.assigned.map((id) => scenario.citizens.at(id));
      for (let i = 0; i < restoredStaff.length; i++)
        restoredStaff[i].workerState = CFG.WORKER_STATE.WORKING;

      const scienceBeforePassive = scenario.state.stock[R.SCIENCE];
      scenario.state.zone.research.materialProgress = CFG.RESEARCH.SCIENCE_SECONDS - 1;
      scenario.tasks._work(restoredStaff[0], job, 1);
      const passiveScience = scenario.state.stock[R.SCIENCE] - scienceBeforePassive;

      const powerStarted = scenario.adaptations.research(T.POWER);
      scenario.tasks._work(restoredStaff[0], job, 5);
      const savedProgress = scenario.state.zone.research.progress;
      scenario.setSpeed(0);
      scenario.state.save();
      return {
        recordId: record.id,
        jobType: job.type,
        jobCapacity: job.capacity,
        initialCapacity,
        raisedStaff,
        raisedCapacity,
        loweredStaff,
        maxCapacity: scenario.adaptations.researchCapacity(record),
        assigned: staff.length,
        scienceSpent: scienceBefore - scenario.state.stock[R.SCIENCE] + passiveScience,
        started,
        unlockedImmediately,
        oneResearcherProgress,
        threeResearcherProgress,
        completed,
        blockedWithoutStaff,
        blockedReason,
        passiveScience,
        powerStarted,
        savedProgress,
      };
    });

    assert.equal(research.jobType, 7);
    assert.ok(research.maxCapacity >= 4);
    assert.equal(research.initialCapacity, 3);
    assert.equal(research.raisedStaff, true);
    assert.equal(research.raisedCapacity, 4);
    assert.equal(research.loweredStaff, true);
    assert.equal(research.jobCapacity, 3);
    assert.equal(research.assigned, 3);
    assert.equal(research.started, true);
    assert.equal(research.unlockedImmediately, false);
    assert.equal(research.oneResearcherProgress, 10);
    assert.equal(research.threeResearcherProgress, 30);
    assert.equal(research.completed, true);
    assert.equal(research.blockedWithoutStaff, false);
    assert.match(research.blockedReason, /habitante/);
    assert.equal(research.passiveScience, 1);
    assert.equal(research.powerStarted, true);
    assert.equal(research.scienceSpent, 18);
    assert.equal(research.savedProgress, 5);

    await sim.page.goto(pageUrl("zone.html", { seed: 1, record: 1 }));
    await sim.page.waitForFunction(() => ZS.scenario && ZS.scenario.map.hq);
    await sim.page.getByRole("button", { name: "investigar", exact: true }).click();
    const restored = await sim.page.evaluate((recordId) => {
      const scenario = ZS.scenario,
        T = ZS.ZoneConfig.TECH,
        job = scenario.tasks.forBuilding(recordId);
      return {
        version: ZS.ZoneConfig.SAVE_VERSION,
        current: scenario.state.zone.research.current,
        progress: scenario.state.zone.research.progress,
        agriculture: scenario.state.zone.tech[T.AGRICULTURE],
        jobType: job.type,
        panel: document.querySelector("#zone-system-body").textContent,
      };
    }, research.recordId);
    assert.equal(restored.version, 12);
    assert.equal(restored.current, 2);
    assert.equal(restored.progress, 5);
    assert.equal(restored.agriculture, true);
    assert.equal(restored.jobType, 7);
    assert.match(restored.panel, /investigadores activos/);
    assert.match(restored.panel, /Energía/);

    assertNoErrors(sim.errors, "zone research");
    process.stdout.write(
      "✓ staffed research speed, passive science, blocking, migration and round-trip\n",
    );
  } finally {
    await sim.context.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
