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
    await sim.page.evaluate(() => {
      const scenario = ZS.scenario;
      scenario.soundscape = (scene) => {
        scene.layer(0, "wind", 0.4);
        scene.layer(1, "crickets", 0.5);
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
    console.log("sound: file:// CC0 ambience and positional emitters OK");
  } finally {
    await sim.context.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
