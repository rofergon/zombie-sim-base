"use strict";

const assert = require("node:assert/strict");
const { assertNoErrors, launch, openSim } = require("./browser");

(async () => {
  const browser = await launch();
  const sim = await openSim(browser, "zone.html", {
    seed: 12345,
    fresh: 1,
    record: 1,
  });
  try {
    await sim.page.locator("#zone-hq-action").click();
    await sim.page.waitForFunction(() => ZS.sound && ZS.sound.unlocked);
    const scoreChoices = await sim.page.evaluate(() => {
      const scenario = ZS.scenario,
        choices = [],
        probe = { score: (cue, intensity) => choices.push({ cue, intensity }) },
        firstSquad = scenario.squads.list[0],
        previousHQ = scenario.map.hq,
        previousMinute = scenario.state.minute,
        previousSquadState = firstSquad.state,
        previousActive = scenario.defense.data.active,
        previousReport = scenario.defense.data.report,
        previousEnding = scenario.campaign.data.endingUnread;
      scenario._score(probe, "day");
      scenario.map.hq = null;
      scenario._score(probe, "day");
      scenario.map.hq = previousHQ;
      scenario.state.minute = ZS.ZoneConfig.CLOCK.NIGHT - 30;
      scenario._score(probe, "dusk");
      scenario.state.minute = previousMinute;
      firstSquad.state = "encounter";
      scenario._score(probe, "day");
      firstSquad.state = previousSquadState;
      scenario.defense.data.report = { breached: true };
      scenario._score(probe, "day");
      scenario.defense.data.report = { breached: false };
      scenario._score(probe, "day");
      scenario.defense.data.report = null;
      scenario.campaign.data.endingUnread = true;
      scenario._score(probe, "day");
      scenario.map.hq = previousHQ;
      scenario.state.minute = previousMinute;
      firstSquad.state = previousSquadState;
      scenario.defense.data.active = previousActive;
      scenario.defense.data.report = previousReport;
      scenario.campaign.data.endingUnread = previousEnding;
      return choices;
    });
    assert.deepEqual(
      scoreChoices.map((choice) => choice.cue),
      ["settlement", "wilderness", "warning", "combat", "loss", "respite", "ending"],
      "Zone directs distinct exploration, threat and outcome cues",
    );
    await sim.page.evaluate(() => {
      const scenario = ZS.scenario;
      scenario.soundscape = (scene) => {
        scene.layer(0, "wind", 0.4);
        scene.layer(1, "crickets", 0.5);
        scene.score("combat", 0.86);
        scene.emitter(900001, "generator", scene.x, scene.y, 1, 500);
      };
      ZS.sound.tick(1);
    });
    await sim.page.waitForFunction(() => {
      const state = ZS.sound.debugState();
      return (
        state.layers.length === 2 &&
        state.layers.every((track) => track.error || track.readyState >= 2) &&
        state.emitters.some(
          (emitter) => emitter.key === "generator" && (emitter.error || emitter.readyState >= 2),
        )
      );
    });

    const state = await sim.page.evaluate(() => ZS.sound.debugState());
    assert.equal(state.context, "running", "audio context unlocked by Zone UI");
    assert.equal(state.mediaReady, true, "sample library initialized");
    assert.equal(state.score.cue, "combat", "scenario selects the procedural combat cue");
    assert.equal(state.score.target, "combat", "combat cue remains the active score target");
    assert.ok(state.score.intensity > 0.5, "score intensity follows the scenario pressure");
    assert.ok(state.score.step > 0, "the score scheduler advanced");
    assert.ok(state.score.voices > 0, "procedural music voices were synthesized");
    assert.deepEqual(
      state.layers.map((layer) => layer.key),
      ["wind", "crickets"],
      "scenario controls the two camera ambience layers",
    );
    for (const layer of state.layers) {
      assert.equal(layer.error, 0, layer.key + " decoded without a media error");
      assert.ok(layer.readyState >= 2, layer.key + " loaded from file://");
      assert.equal(layer.paused, false, layer.key + " is playing");
    }
    const generator = state.emitters.find((emitter) => emitter.key === "generator");
    assert.ok(generator, "camera-near generator emitter is active");
    assert.equal(generator.error, 0, "generator decoded without a media error");
    assert.ok(generator.readyState >= 2, "generator loaded from file://");
    assert.equal(generator.paused, false, "generator loop is playing");
    assertNoErrors(sim.errors, "sound");
    console.log("sound: file:// ambience, emitters and procedural score OK");
  } finally {
    await sim.context.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
