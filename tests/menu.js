"use strict";

const assert = require("node:assert/strict");
const { assertNoErrors, launch, openSim } = require("./browser");

(async () => {
  const browser = await launch();
  try {
    const sim = await openSim(browser, "index.html", { seed: 12345 });
    const initial = await sim.page.evaluate(() => ({
      visible: !document.querySelector("#main-menu").hidden,
      paused: ZS.scenario.paused,
      cards: Array.from(document.querySelectorAll(".zs-mode-card")).map((card) => ({
        name: card.querySelector("h2").textContent,
        href: card.href ? card.getAttribute("href") : null,
      })),
      camera: ZS.debug.cam.auto,
    }));
    assert.equal(initial.visible, true, "main menu opens by default");
    assert.equal(initial.paused, true, "main menu pauses the outbreak");
    assert.deepEqual(
      initial.cards,
      [
        { name: "El brote", href: null },
        { name: "Canas", href: "battle.html" },
        { name: "La Fortaleza", href: "hold.html" },
        { name: "La Zona", href: "zone.html" },
      ],
      "all four modes are available",
    );
    assert.equal(initial.camera, true, "automatic camera starts enabled");

    await sim.page.locator("[data-setting-volume]").fill("25");
    await sim.page.locator("[data-setting-camera]").click();
    await sim.page.locator("[data-setting-sound]").click();
    const saved = await sim.page.evaluate(() => ({
      data: JSON.parse(localStorage.getItem("zs.settings.v1")),
      camera: ZS.debug.cam.auto,
      volumeDisabled: document.querySelector("[data-setting-volume]").disabled,
    }));
    assert.equal(saved.data.volume, 0.25, "volume persists");
    assert.equal(saved.data.autoCamera, false, "camera preference persists");
    assert.equal(saved.data.muted, true, "mute preference persists");
    assert.equal(saved.camera, false, "camera preference applies immediately");
    assert.equal(saved.volumeDisabled, true, "muting disables the volume control");

    await sim.page.reload();
    await sim.page.waitForFunction(() => window.ZS && ZS.debug && ZS.scenario);
    const reloaded = await sim.page.evaluate(() => ({
      camera: ZS.debug.cam.auto,
      soundText: document.querySelector("[data-setting-sound]").textContent,
      cameraText: document.querySelector("[data-setting-camera]").textContent,
      volume: document.querySelector("[data-setting-volume]").value,
    }));
    assert.equal(reloaded.camera, false, "camera preference applies after reload");
    assert.equal(reloaded.soundText, "apagado", "sound control restores its state");
    assert.equal(reloaded.cameraText, "manual", "camera control restores its state");
    assert.equal(reloaded.volume, "25", "volume control restores its state");

    await sim.page.locator("[data-play-outbreak]").click();
    const playing = await sim.page.evaluate(() => ({
      menuHidden: document.querySelector("#main-menu").hidden,
      buttonHidden: document.querySelector("#zs-menu-button").hidden,
      paused: ZS.scenario.paused,
    }));
    assert.equal(playing.menuHidden, true, "start closes the menu");
    assert.equal(playing.buttonHidden, false, "menu tab appears during play");
    assert.equal(playing.paused, false, "start resumes the outbreak");

    await sim.page.locator("#zs-menu-button").click();
    assert.equal(
      await sim.page.locator("#main-menu").getAttribute("aria-hidden"),
      "false",
      "menu tab reopens the menu",
    );
    assertNoErrors(sim.errors, "index.html menu");
    console.log("menu: ok");
    await sim.context.close();
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
