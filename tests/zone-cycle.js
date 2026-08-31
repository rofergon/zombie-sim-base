"use strict";

const assert = require("node:assert/strict");
const { assertNoErrors, launch, openSim } = require("./browser");

(async () => {
  const browser = await launch();
  const sim = await openSim(browser, "zone.html", { seed: 77031, fresh: 1, record: 1 });
  try {
    await sim.page.locator("#zone-hq-action").click();
    const prepared = await sim.page.evaluate(() => {
      const scenario = ZS.scenario,
        CFG = ZS.ZoneConfig,
        R = CFG.RESOURCE,
        W = CFG.WEAPON;
      for (let i = 0; i < scenario.threats.list.length; i++) {
        scenario.threats.list[i].cleared = true;
        scenario.threats.list[i].strength = 0;
      }
      scenario.state.zone.tech[CFG.TECH.FORTIFICATIONS] = true;
      scenario.map.hq.maxHP = 10000;
      scenario.map.hq.hp = 10000;
      scenario.map.hq.capacity = 1000;
      scenario.state.stock[R.WOOD] = 500;
      scenario.state.stock[R.METAL] = 500;
      scenario.state.stock[R.BRICK] = 500;
      scenario.state.stock[R.AMMO] = 900;
      scenario.state.stock[R.MEDICINE] = 100;

      const workers = scenario.citizens.byId.filter(
          (citizen) => citizen && citizen.role === CFG.ROLE.WORKER,
        ),
        second = scenario.squads.create(workers.slice(0, 4), false),
        squads = scenario.squads.list;
      for (let i = 0; i < squads.length; i++) {
        const squad = squads[i];
        squad.inventory[R.AMMO] = 300;
        squad.inventory[R.MEDICINE] = 12;
        for (let rank = 0; rank < squad.members.length; rank++) {
          const member = scenario.citizens.at(squad.members[rank]);
          squad.equipment[rank] = W.SNIPER;
          scenario.weapons.applyAgentWeapon(member, W.SNIPER);
          member.hp = 1000;
          member.maxHP = 1000;
          member.moral = 100;
        }
      }

      let towers = 0;
      for (let radius = 120; radius <= 280 && towers < 8; radius += 40)
        for (let angle = 0; angle < Math.PI * 2 && towers < 8; angle += Math.PI / 8) {
          const x = scenario.map.hq.cx + Math.cos(angle) * radius,
            y = scenario.map.hq.cy + Math.sin(angle) * radius,
            tower = scenario.fortifications.place(x, y, CFG.FORTIFICATION.TOWER);
          if (tower) towers++;
        }

      scenario.state.minute = CFG.CLOCK.NIGHT - 0.5;
      scenario.defense.phase = "dusk";
      scenario.setSpeed(4);
      return { towers, squads: squads.length, second: Boolean(second), day: scenario.state.day };
    });
    assert.ok(prepared.towers >= 4);
    assert.equal(prepared.squads, 2);
    assert.equal(prepared.second, true);

    await sim.page.waitForFunction(
      () => ZS.scenario.defense.data.report && !ZS.scenario.defense.data.active,
      null,
      { timeout: 45000 },
    );
    const result = await sim.page.evaluate(() => ({
      report: { ...ZS.scenario.defense.data.report },
      day: ZS.scenario.state.day,
      minute: ZS.scenario.state.minute,
      phase: ZS.scenario.state.phase(),
      living: ZS.scenario.defense.living(),
      pending: ZS.scenario.defense.spawnRemaining,
      citizens: ZS.scenario.citizens.stats().population,
      saveVersion: ZS.ZoneSave.normalize(JSON.parse(JSON.stringify(ZS.scenario.state.data))).v,
    }));
    assert.equal(result.report.breached, false);
    assert.ok(result.report.kills > 0);
    assert.equal(result.living, 0);
    assert.equal(result.pending, 0);
    assert.equal(result.day, prepared.day + 1);
    assert.equal(result.phase, "dawn");
    assert.equal(Math.floor(result.minute), 300);
    assert.ok(result.citizens >= 16);
    assert.equal(result.saveVersion, 16);
    assertNoErrors(sim.errors, "zone full cycle");
    process.stdout.write(
      "✓ accelerated dusk → natural horde combat → cleared dawn report and v16 save\n",
    );
  } finally {
    await sim.context.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
