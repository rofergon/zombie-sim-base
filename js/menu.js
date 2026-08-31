/* Main mode picker for index.html. The live canvas remains behind the sheet,
   while this overlay pauses the scenario and draws its own boiling ink. */
(() => {
  "use strict";
  const ZS = window.ZS;
  const root = document.getElementById("main-menu");
  if (!root) return;

  const art = root.querySelector(".zs-menu-art");
  const context = art.getContext("2d");
  const sheet = root.querySelector(".zs-menu-sheet");
  const cards = Array.from(root.querySelectorAll(".zs-mode-card"));
  const marks = Array.from(root.querySelectorAll(".zs-mode-mark"));
  const menuButton = document.getElementById("zs-menu-button");
  const playButton = root.querySelector("[data-play-outbreak]");
  const soundButton = root.querySelector("[data-setting-sound]");
  const volume = root.querySelector("[data-setting-volume]");
  const cameraButton = root.querySelector("[data-setting-camera]");
  const fullscreenButton = root.querySelector("[data-setting-fullscreen]");
  const params = new URLSearchParams(location.search);
  let dpr = 1;
  let raf = 0;
  let lastEpoch = -1;
  let pausedBeforeMenu = false;

  function setting(name, fallback) {
    return ZS.settings ? ZS.settings.get(name) : fallback;
  }

  function syncControls() {
    const muted = setting("muted", false);
    const autoCamera = setting("autoCamera", true);
    soundButton.textContent = muted ? "apagado" : "encendido";
    soundButton.setAttribute("aria-pressed", String(!muted));
    volume.value = String(Math.round(setting("volume", 0.5) * 100));
    volume.disabled = muted;
    volume.setAttribute("aria-valuetext", muted ? "sonido apagado" : volume.value + "%");
    cameraButton.textContent = autoCamera ? "automática" : "manual";
    cameraButton.setAttribute("aria-pressed", String(autoCamera));
    fullscreenButton.textContent = document.fullscreenElement ? "salir" : "ampliar";
  }

  function resizeArt() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    art.width = Math.max(1, Math.round(innerWidth * dpr));
    art.height = Math.max(1, Math.round(innerHeight * dpr));
    art.style.width = innerWidth + "px";
    art.style.height = innerHeight + "px";
    lastEpoch = -1;
  }

  function relativeRect(element) {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.left,
      y: rect.top,
      w: rect.width,
      h: rect.height,
    };
  }

  function line(x1, y1, x2, y2, seed, width) {
    context.lineWidth = width || 1.5;
    ZS.wline(context, x1, y1, x2, y2, seed, 1.25);
  }

  function drawOutbreakIcon(rect, seed) {
    const x = rect.x + rect.w / 2;
    const y = rect.y + rect.h / 2;
    context.fillStyle = "rgba(150,64,48,0.10)";
    context.strokeStyle = "rgba(117,54,43,0.82)";
    ZS.wcirc(context, x, y, 29, seed, 2.4);
    context.fill();
    ZS.wcirc(context, x, y, 9, seed + 2, 1.4);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      line(
        x + Math.cos(a) * 35,
        y + Math.sin(a) * 35,
        x + Math.cos(a) * 47,
        y + Math.sin(a) * 47,
        seed + 10 + i,
        1.6,
      );
    }
  }

  function drawCannaeIcon(rect, seed) {
    const x = rect.x + rect.w / 2;
    const y = rect.y + rect.h / 2;
    context.strokeStyle = "rgba(61,52,43,0.8)";
    context.lineWidth = 2;
    ZS.wpoly(
      context,
      [
        { x: x - 44, y: y - 16 },
        { x: x - 26, y: y + 20 },
        { x, y: y + 30 },
        { x: x + 26, y: y + 20 },
        { x: x + 44, y: y - 16 },
      ],
      seed,
      1.4,
      false,
    );
    context.stroke();
    line(x - 33, y - 24, x + 33, y + 23, seed + 11, 1.6);
    line(x + 33, y - 24, x - 33, y + 23, seed + 12, 1.6);
  }

  function drawHoldIcon(rect, seed) {
    const x = rect.x + rect.w / 2;
    const y = rect.y + rect.h / 2;
    context.strokeStyle = "rgba(61,52,43,0.82)";
    context.fillStyle = "rgba(112,148,72,0.12)";
    ZS.wpoly(
      context,
      [
        { x: x - 42, y: y + 28 },
        { x: x - 42, y: y - 20 },
        { x: x - 27, y: y - 20 },
        { x: x - 27, y: y - 6 },
        { x: x + 27, y: y - 6 },
        { x: x + 27, y: y - 20 },
        { x: x + 42, y: y - 20 },
        { x: x + 42, y: y + 28 },
      ],
      seed,
      1.3,
      true,
    );
    context.fill();
    context.stroke();
    ZS.wcirc(context, x, y + 25, 25, seed + 7, 1.2);
  }

  function drawZoneIcon(rect, seed) {
    const x = rect.x + rect.w / 2;
    const y = rect.y + rect.h / 2;
    context.strokeStyle = "rgba(61,52,43,0.76)";
    for (let i = -1; i <= 1; i++) {
      line(x - 43, y + i * 19, x + 43, y + i * 19, seed + i + 4, 1.1);
      line(x + i * 29, y - 29, x + i * 29, y + 29, seed + i + 14, 1.1);
    }
    context.strokeStyle = "rgba(79,105,55,0.94)";
    line(x + 5, y + 31, x + 5, y - 36, seed + 22, 2);
    ZS.wpoly(
      context,
      [
        { x: x + 6, y: y - 34 },
        { x: x + 38, y: y - 23 },
        { x: x + 6, y: y - 11 },
      ],
      seed + 23,
      1.2,
      true,
    );
    context.fillStyle = "rgba(112,148,72,0.26)";
    context.fill();
    context.stroke();
  }

  function drawArt(now) {
    const epoch = Math.floor(now / 140);
    if (epoch === lastEpoch) return;
    lastEpoch = epoch;
    ZS.setBoil(now / 1000);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, innerWidth, innerHeight);
    context.strokeStyle = "rgba(61,52,43,0.7)";

    const sheetRect = relativeRect(sheet);
    context.lineWidth = 1.8;
    ZS.sketchRect(context, sheetRect.x, sheetRect.y, sheetRect.w, sheetRect.h);

    for (let i = 0; i < cards.length; i++) {
      const rect = relativeRect(cards[i]);
      context.strokeStyle =
        cards[i].matches(":hover, :focus-visible") || cards[i].contains(document.activeElement)
          ? "rgba(79,105,55,0.96)"
          : "rgba(61,52,43,0.56)";
      context.lineWidth = 1.45;
      ZS.sketchRect(context, rect.x, rect.y, rect.w, rect.h);
    }

    const settingsRect = relativeRect(root.querySelector(".zs-settings"));
    context.strokeStyle = "rgba(61,52,43,0.43)";
    line(
      settingsRect.x,
      settingsRect.y,
      settingsRect.x + settingsRect.w,
      settingsRect.y,
      71.2,
      1.25,
    );

    const drawers = [drawOutbreakIcon, drawCannaeIcon, drawHoldIcon, drawZoneIcon];
    for (let i = 0; i < marks.length; i++) drawers[i](relativeRect(marks[i]), 100 + i * 37);
  }

  function artLoop(now) {
    if (root.hidden) return;
    drawArt(now);
    raf = requestAnimationFrame(artLoop);
  }

  function setOpen(open) {
    const scenario = ZS.scenario;
    if (open) {
      pausedBeforeMenu = Boolean(scenario && scenario.paused);
      if (scenario) scenario.paused = true;
      root.hidden = false;
      root.setAttribute("aria-hidden", "false");
      menuButton.hidden = true;
      document.body.classList.add("zs-menu-open");
      resizeArt();
      syncControls();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(artLoop);
      playButton.focus({ preventScroll: true });
    } else {
      root.hidden = true;
      root.setAttribute("aria-hidden", "true");
      menuButton.hidden = false;
      document.body.classList.remove("zs-menu-open");
      cancelAnimationFrame(raf);
      if (scenario) scenario.paused = pausedBeforeMenu;
    }
  }

  playButton.addEventListener("click", () => {
    if (ZS.sound && !setting("muted", false)) ZS.sound.unlock();
    setOpen(false);
  });
  menuButton.addEventListener("click", () => setOpen(true));

  soundButton.addEventListener("click", () => {
    ZS.settings.set("muted", !setting("muted", false));
    if (ZS.sound) ZS.sound.applySettings();
    syncControls();
  });

  volume.addEventListener("input", () => {
    ZS.settings.set("volume", Number(volume.value) / 100);
    if (ZS.sound) ZS.sound.applySettings();
    syncControls();
  });

  cameraButton.addEventListener("click", () => {
    const enabled = !setting("autoCamera", true);
    ZS.settings.set("autoCamera", enabled);
    if (ZS.debug && ZS.debug.cam)
      ZS.debug.cam.auto = enabled && typeof ZS.scenario.camInterest === "function";
    syncControls();
  });

  fullscreenButton.addEventListener("click", async () => {
    if (!document.fullscreenEnabled) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // Browsers may decline fullscreen for local files or embedded previews.
    }
    syncControls();
  });

  for (const card of cards) {
    card.addEventListener("mouseenter", () => {
      lastEpoch = -1;
    });
    card.addEventListener("mouseleave", () => {
      lastEpoch = -1;
    });
    card.addEventListener("focus", () => {
      lastEpoch = -1;
    });
  }

  window.addEventListener("resize", resizeArt);
  document.addEventListener("fullscreenchange", syncControls);

  if (params.get("play") === "1" || params.get("record") === "1") setOpen(false);
  else setOpen(true);
})();
