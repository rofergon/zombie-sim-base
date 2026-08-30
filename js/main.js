/* Bootstrap: canvas + DPR, world, camera, input, main loop.
   Input: drag to pan, wheel to zoom (at cursor), two-finger pinch to zoom,
   tap/click — what it does is up to the scenario pack. */
(async () => {
  "use strict";
  const ZS = window.ZS;
  const params = new URLSearchParams(location.search);

  const cv = document.getElementById("c");
  const ctx = cv.getContext("2d");
  let W = 0,
    H = 0,
    DPR = 1;

  // The scenario is created first so pages with a setup step (Zone's map
  // selector) can choose the world dimensions before any large arrays or
  // canvases are allocated. Other scenarios remain entirely synchronous.
  const scenario = new (window.ZS_SCEN ? ZS[window.ZS_SCEN] : ZS.ScenarioZombie)();
  ZS.scenario = scenario;
  if (typeof scenario.bootstrap === "function") await scenario.bootstrap();
  const worldOptions =
      typeof scenario.worldOptions === "function" ? scenario.worldOptions() || {} : {},
    world = new ZS.World(
      worldOptions.w || window.ZS_WW || 3200,
      worldOptions.h || window.ZS_WH || 2400,
    ); // a page/scenario may size its own world
  // ?seed=N pins the map (reproducible runs); otherwise a fresh world on every refresh
  world.seed = parseInt(params.get("seed"), 10) | 0 || (Math.random() * 0x7fffffff) | 0;
  const nav = new ZS.Nav(world, worldOptions.navCell);
  world.nav = nav;
  // terrain: a scenario may lay its own battlefield (river, lake, forest,
  // town — or none of them); the default is the seeded random town
  const customTerrain = typeof scenario.terrain === "function";
  if (customTerrain) scenario.terrain(world, nav);
  else {
    world.water();
    nav.markWater();
    world.layoutForest();
    ZS.Buildings.generate(world, nav);
  }
  world.build();
  world.stains = new ZS.Stains(world);
  scenario.attachStains(world.stains);
  ZS.stains = world.stains; // legacy debug handle
  scenario.fx = ZS.fx; // transient effects live with the scenario
  if (!customTerrain) world.placeAllTrees();

  const cam = new ZS.Camera(world);
  const phaserCanvas = document.getElementById("phaser-c"),
    renderBackend =
      window.ZS_RENDERER === "phaser" && phaserCanvas && ZS.PhaserRenderer
        ? new ZS.PhaserRenderer(phaserCanvas, world)
        : null;
  ZS.renderBackend = renderBackend;

  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth;
    H = window.innerHeight;
    cv.width = Math.max(1, W * DPR);
    cv.height = Math.max(1, H * DPR);
    cv.style.width = W + "px";
    cv.style.height = H + "px";
    if (renderBackend) renderBackend.resize(W, H);
    cam.clamp(W, H);
  }
  window.addEventListener("resize", resize);

  resize();
  cam.fit(W, H);
  cam.minZoom = cam.zoom * 0.8; // a little paper margin around the world frame
  ZS.Sim.init(world, W, H);

  // debug/verification handle (also a hook for future player/vehicle work)
  ZS.debug = { cam, world, nav, buildings: ZS.Buildings, scenario };
  // Recording-only controls. They exist only behind ?record=1 and let the
  // capture harness advance the simulation without waiting in real time.
  // Normal play keeps the exact same clock and surface.
  let recordingOffset = 0;
  if (params.get("record") === "1") {
    ZS.recording = {
      advance(seconds) {
        const step = 1 / 30;
        const n = Math.max(0, Math.ceil(seconds / step));
        const event = ZS.sound && ZS.sound.event;
        if (event) ZS.sound.event = () => {};
        try {
          for (let i = 0; i < n; i++) {
            recordingOffset += step;
            const t = performance.now() / 1000 + recordingOffset;
            ZS.setBoil(t);
            ZS.Sim.update(step, t, world, W, H);
          }
        } finally {
          if (event) ZS.sound.event = event;
        }
        ZS.drawScene(ctx, cam, world, ZS.Sim, performance.now() / 1000 + recordingOffset, W, H);
      },
      fit() {
        cam.auto = false;
        cam.fit(W, H);
      },
      focus(x, y, zoom) {
        cam.auto = false;
        cam.x = x;
        cam.y = y;
        cam.zoom = ZS.clamp(zoom, cam.minZoom, cam.maxZoom);
        cam.clamp(W, H);
      },
    };
  }
  // default to the auto camera when the scenario can point at the action;
  // drag/zoom input hands control back for the session — a tap doesn't
  // (it's an action, e.g. sound unlock or the artillery call)
  cam.auto = typeof scenario.camInterest === "function";
  if (cam.auto) {
    // Scenario-owned setup targets (Zone's recommended HQ) are already
    // known. Start there instead of rendering an entire large world once
    // and spending the next seconds easing in from fit view.
    const initialInterest = scenario.camInterest(0);
    if (initialInterest) {
      cam.x = initialInterest.x;
      cam.y = initialInterest.y;
      cam.zoom = ZS.clamp(initialInterest.zoom || cam.zoom, cam.minZoom, cam.maxZoom);
      cam.clamp(W, H);
    }
  }

  const pointers = new Map();
  let pinch = null;
  let tap = null;
  const eaten = new Set(); // pointer ids a scenario gesture has claimed

  cv.addEventListener("pointerdown", (e) => {
    if (ZS.sound) ZS.sound.unlock(); // first gesture may unlock audio
    cv.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      tap = { x: e.clientX, y: e.clientY, t: performance.now() };
      // a scenario may claim the gesture (building mode); then it never pans
      if (scenario.pointerDown) {
        const p = cam.toWorld(e.clientX, e.clientY, W, H);
        if (scenario.pointerDown(p.x, p.y, e)) eaten.add(e.pointerId);
      }
    }
    if (pointers.size === 2) {
      tap = null;
      eaten.clear();
      if (cam.auto) cam.auto = false; // pinch zoom takes the camera
      const [p1, p2] = [...pointers.values()];
      pinch = {
        d: Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1,
        x: (p1.x + p2.x) / 2,
        y: (p1.y + p2.y) / 2,
      };
    }
  });

  cv.addEventListener("pointermove", (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x,
      dy = e.clientY - prev.y;
    prev.x = e.clientX;
    prev.y = e.clientY;
    if (pointers.size === 1) {
      if (eaten.has(e.pointerId) && scenario.pointerMove) {
        const p = cam.toWorld(e.clientX, e.clientY, W, H);
        scenario.pointerMove(p.x, p.y, e);
      } else {
        cam.panBy(dx, dy, W, H);
        if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 8) {
          tap = null; // a real pan, not a tap
          if (cam.auto) cam.auto = false; // pan takes the camera
        }
      }
    } else if (pointers.size === 2) {
      const [p1, p2] = [...pointers.values()];
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1;
      const mx = (p1.x + p2.x) / 2,
        my = (p1.y + p2.y) / 2;
      if (pinch) {
        cam.zoomAt(mx, my, d / pinch.d, W, H);
        cam.panBy(mx - pinch.x, my - pinch.y, W, H);
      }
      pinch = { d, x: mx, y: my };
    }
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) {
      const p = cam.toWorld(e.clientX, e.clientY, W, H);
      if (eaten.delete(e.pointerId)) {
        if (scenario.pointerUp) scenario.pointerUp(p.x, p.y, e);
      } else if (tap && performance.now() - tap.t < 400) {
        // quick, stationary press = tap
        ZS.Sim.tap(world, p.x, p.y, e);
      }
      tap = null;
    }
  }
  cv.addEventListener("pointerup", endPointer);
  cv.addEventListener("pointercancel", endPointer);

  cv.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (cam.auto) cam.auto = false;
      const f = ZS.clamp(Math.exp(-e.deltaY * 0.0012), 0.4, 2.5);
      cam.zoomAt(e.clientX, e.clientY, f, W, H);
    },
    { passive: false },
  );

  /* ---------- main loop ---------- */

  let last = performance.now();
  function loop(now) {
    const t = now / 1000 + recordingOffset;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    ZS.setBoil(t);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ZS.Sim.update(dt, t, world, W, H);
    if (cam.auto) {
      const ti = typeof scenario.camInterest === "function" ? scenario.camInterest(dt) : null;
      if (ti) cam.autoSeek(ti.x, ti.y, ti.zoom, dt, W, H, ti.ease);
    }
    if (ZS.sound) ZS.sound.tick(dt);
    const accelerated = renderBackend && renderBackend.update(cam, ZS.Sim, t, W, H);
    ZS.drawScene(
      ctx,
      cam,
      world,
      ZS.Sim,
      t,
      W,
      H,
      accelerated ? renderBackend.renderOptions : null,
    );
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  window.ZS_BOOTSTRAP_ERROR = String(error && error.message ? error.message : error);
  const panel = document.createElement("p");
  panel.className = "zs-bootstrap-error";
  panel.textContent = "No se pudo preparar el mapa: " + window.ZS_BOOTSTRAP_ERROR;
  document.body.appendChild(panel);
});
