/* Rendering: everything in the sketch style — agents, trees, buildings,
   water, HUD. drawScene() is the per-frame pipeline: camera transform,
   pre-rendered ground, boiling water, then trees/buildings/agents sorted by
   y (painter's order) so people walk behind the town, not through it. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});

  const HAND = '"Segoe Script","Bradley Hand","Comic Sans MS",cursive';
  const visibleTrees = [];
  const visibleBuildings = [];
  const visibleWaters = [];
  const sceneList = [];
  const TREE_POLY = Array.from({ length: 8 }, () => ({ x: 0, y: 0 }));
  const buildingInkCache = {
    boil: -1,
    amp: -1,
    buildings: [],
    states: [],
    footprints: null,
    runs: null,
    doors: null,
  };

  function addSceneItem(index, y, kind, object) {
    let item = sceneList[index];
    if (!item) {
      item = { y, k: kind, o: object };
      sceneList[index] = item;
    } else {
      item.y = y;
      item.k = kind;
      item.o = object;
    }
  }

  /* ---------- world furniture ---------- */

  function drawWater(c, world) {
    if (world.waterFeatures) {
      c.lineCap = "round";
      c.lineWidth = 1.7;
      c.strokeStyle = "rgba(64,102,132,0.72)";
      const visible = world.visibleRect;
      const waters = world.queryVisible
        ? world.queryVisible(
            "waters",
            visible || { x0: 0, y0: 0, x1: world.w, y1: world.h },
            visibleWaters,
          )
        : world.waterFeatures;
      for (let i = 0; i < waters.length; i++) {
        const feature = waters[i],
          bounds = feature.bounds;
        if (
          visible &&
          bounds &&
          (bounds.x1 < visible.x0 ||
            bounds.x0 > visible.x1 ||
            bounds.y1 < visible.y0 ||
            bounds.y0 > visible.y1)
        )
          continue;
        ZS.wpoly(c, feature.points, 1701 + i * 19, 1.5, true);
        c.stroke();
      }
      return;
    }
    if (!world.lake && !world.river) return; // tile worlds have no river
    c.lineCap = "round";
    c.lineWidth = 2;
    c.strokeStyle = "rgba(64,102,132,0.75)";
    if (world.lake && world.lake.pts.length) {
      ZS.wpoly(c, world.lake.pts, 71, 2.2, true);
      c.stroke();
    }
    if (world.river && world.river.pts.length) {
      ZS.wpoly(c, world.river.pts, 731, 2.2, true);
      c.stroke();
    }
    // smaller ponds boil with their own seeds
    if (world.ponds)
      for (let i = 0; i < world.ponds.length; i++) {
        ZS.wpoly(c, world.ponds[i].pts, 77 + i * 13, 2.2, true);
        c.stroke();
      }
    // boiling ripples
    c.strokeStyle = "rgba(64,102,132,0.4)";
    c.lineWidth = 1.1;
    for (const rp of world.ripples) {
      ZS.wline(c, rp.x - rp.w / 2, rp.y, rp.x, rp.y - 2, rp.s, 1.2);
      ZS.wline(c, rp.x, rp.y - 2, rp.x + rp.w / 2, rp.y, rp.s + 9, 1.2);
    }
  }

  function drawTree(c, tr, t) {
    const sway = Math.sin(t * 0.8 + tr.seed) * 1.6;
    const cx = tr.x + sway,
      cy = tr.y - tr.r * 1.15;

    // ground scribble
    c.strokeStyle = "rgba(40,35,25,0.12)";
    c.lineWidth = 1.2;
    ZS.wcirc(c, tr.x, tr.y + 2, tr.r * 0.75, tr.seed + 3, 1.2);

    // trunk
    c.strokeStyle = "rgba(96,74,50,0.9)";
    c.lineWidth = 1.6;
    ZS.wline(c, tr.x, tr.y + 2, tr.x + ZS.sjit(tr.seed) * 2, cy + tr.r * 0.55, tr.seed + 5, 0.7);

    // canopy: jittered blob, green wash under a darker outline
    const pts = TREE_POLY;
    for (let i = 0; i < 8; i++) {
      const an = (i / 8) * Math.PI * 2;
      pts[i].x = cx + Math.cos(an) * tr.pts[i];
      pts[i].y = cy + Math.sin(an) * tr.pts[i] * 0.92;
    }
    c.lineCap = "round";
    c.strokeStyle = "rgba(74,108,48,0.8)";
    c.lineWidth = 1.5;
    ZS.wpoly(c, pts, tr.seed * 13.7, 1.6, true);
    c.fillStyle = "rgba(112,148,72,0.32)";
    c.fill();
    c.stroke();

    // inner scribble
    c.strokeStyle = "rgba(74,108,48,0.35)";
    c.lineWidth = 1;
    ZS.wcirc(c, cx - tr.r * 0.2, cy - tr.r * 0.15, tr.r * 0.45, tr.seed + 31, 0.5);
  }

  // reused oriented quads — no per-frame allocs in the building pass
  const QUAD = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];

  function orientRect(out, x, y, tx, ty, nx, ny, hw, ht) {
    out[0].x = x - tx * hw - nx * ht;
    out[0].y = y - ty * hw - ny * ht;
    out[1].x = x + tx * hw - nx * ht;
    out[1].y = y + ty * hw - ny * ht;
    out[2].x = x + tx * hw + nx * ht;
    out[2].y = y + ty * hw + ny * ht;
    out[3].x = x - tx * hw + nx * ht;
    out[3].y = y - ty * hw + ny * ht;
  }

  // buildings: pre-rendered floor wash underneath; boiling walls, roof
  // ridge, windows and the door (leaf, damage, or splinters) per frame
  function drawBuilding(c, b) {
    c.lineCap = "round";
    c.lineJoin = "round";
    if (b.footprint) {
      c.save();
      c.translate(1.15, 1.85);
      c.strokeStyle = "rgba(92,72,50,0.2)";
      c.lineWidth = 2.2;
      ZS.wpoly(c, b.footprint, b.seed + 211, 0.65, true);
      c.stroke();
      c.restore();
      drawFootprintWalls(c, b);
      if (b.inner) {
        c.strokeStyle = "rgba(92,72,50,0.3)";
        c.lineWidth = 1.05;
        ZS.wpoly(c, b.inner, b.seed + 411, 0.55, true);
        c.stroke();
      }
      if (b.ridge) {
        c.strokeStyle = "rgba(92,72,50,0.38)";
        c.lineWidth = 1.15;
        ZS.wline(c, b.ridge.x1, b.ridge.y1, b.ridge.x2, b.ridge.y2, b.seed + 17, 0.55);
      }
    } else {
      c.strokeStyle = "rgba(92,72,50,0.8)";
      c.lineWidth = 2;
      for (let i = 0; i < b.runs.length; i++) {
        const r = b.runs[i];
        ZS.wline(c, r.x1, r.y1, r.x2, r.y2, b.seed + i * 3.1, 1.1);
      }
    }
    if (b.windows) drawWindows(c, b);
    if (b.door) drawDoor(c, b, b.door);
  }

  function traceFootprintWalls(target, b, amp, append) {
    const pts = b.footprint,
      n = pts.length,
      door = b.door,
      line = append ? ZS.appendWline : ZS.wline;
    amp = amp === undefined ? 0.85 : amp;
    const a0 = pts[0],
      z = pts[n - 1],
      closed = Math.abs(a0.x - z.x) < 0.05 && Math.abs(a0.y - z.y) < 0.05,
      edges = closed ? n - 1 : n;
    for (let i = 0; i < edges; i++) {
      const a = pts[i],
        p = pts[(i + 1) % n],
        dx = p.x - a.x,
        dy = p.y - a.y;
      if (dx * dx + dy * dy < 4) continue;
      if (door && door.edge === i && door.tx != null) {
        const gap = (door.hw || 5.6) + 1.3,
          elen = Math.hypot(dx, dy);
        if (gap * 2 < elen - 3) {
          line(
            target,
            a.x,
            a.y,
            door.x - door.tx * gap,
            door.y - door.ty * gap,
            b.seed + i * 3.1,
            amp,
          );
          line(
            target,
            door.x + door.tx * gap,
            door.y + door.ty * gap,
            p.x,
            p.y,
            b.seed + i * 3.1 + 1.7,
            amp,
          );
          continue;
        }
      }
      line(target, a.x, a.y, p.x, p.y, b.seed + i * 3.1, amp);
    }
  }

  function drawFootprintWalls(c, b, width, amp) {
    c.strokeStyle = "rgba(92,72,50,0.84)";
    c.lineWidth = width || 1.75;
    traceFootprintWalls(c, b, amp, false);
  }

  function drawBuildingExterior(c, b, width, amp, alpha) {
    c.save();
    c.globalAlpha *= alpha;
    c.lineCap = "round";
    c.lineJoin = "round";
    if (b.footprint) drawFootprintWalls(c, b, width, amp);
    else {
      c.strokeStyle = "rgba(60,50,40,0.88)";
      c.lineWidth = width;
      for (let i = 0; i < b.runs.length; i++) {
        const run = b.runs[i];
        ZS.wline(c, run.x1, run.y1, run.x2, run.y2, b.seed + i * 3.1, amp);
      }
    }
    if (b.door && !b.door.broken) {
      const d = b.door,
        tx = d.tx != null ? d.tx : d.face === "e" || d.face === "w" ? 0 : 1,
        ty = d.ty != null ? d.ty : d.face === "e" || d.face === "w" ? 1 : 0,
        hw = d.hw != null ? d.hw : 19;
      c.strokeStyle = "rgba(60,40,18,0.92)";
      c.lineWidth = width;
      ZS.wline(c, d.x - tx * hw, d.y - ty * hw, d.x + tx * hw, d.y + ty * hw, b.seed + 55, amp);
    }
    c.restore();
  }

  function drawBuildingExteriors(c, buildings, t, width, amp, alpha) {
    if (typeof Path2D !== "function") {
      for (let i = 0; i < buildings.length; i++) {
        const building = buildings[i];
        if (!building.hidden) drawBuildingExterior(c, building, width, amp, alpha);
      }
      return;
    }

    const cache = buildingInkCache,
      boil = Math.floor(t / 0.14);
    let changed =
      cache.boil !== boil || cache.amp !== amp || cache.buildings.length !== buildings.length;
    if (!changed)
      for (let i = 0; i < buildings.length; i++) {
        const building = buildings[i],
          state = (building.hidden ? 1 : 0) | (building.door && building.door.broken ? 2 : 0);
        if (cache.buildings[i] !== building || cache.states[i] !== state) {
          changed = true;
          break;
        }
      }
    if (changed) {
      const footprints = new Path2D(),
        runs = new Path2D(),
        doors = new Path2D();
      cache.buildings.length = buildings.length;
      cache.states.length = buildings.length;
      for (let i = 0; i < buildings.length; i++) {
        const building = buildings[i],
          door = building.door;
        cache.buildings[i] = building;
        cache.states[i] = (building.hidden ? 1 : 0) | (door && door.broken ? 2 : 0);
        if (building.hidden) continue;
        if (building.footprint) traceFootprintWalls(footprints, building, amp, true);
        else
          for (let j = 0; j < building.runs.length; j++) {
            const run = building.runs[j];
            ZS.appendWline(runs, run.x1, run.y1, run.x2, run.y2, building.seed + j * 3.1, amp);
          }
        if (door && !door.broken) {
          const tx = door.tx != null ? door.tx : door.face === "e" || door.face === "w" ? 0 : 1,
            ty = door.ty != null ? door.ty : door.face === "e" || door.face === "w" ? 1 : 0,
            hw = door.hw != null ? door.hw : 19;
          ZS.appendWline(
            doors,
            door.x - tx * hw,
            door.y - ty * hw,
            door.x + tx * hw,
            door.y + ty * hw,
            building.seed + 55,
            amp,
          );
        }
      }
      cache.boil = boil;
      cache.amp = amp;
      cache.footprints = footprints;
      cache.runs = runs;
      cache.doors = doors;
    }

    c.save();
    c.globalAlpha *= alpha;
    c.lineCap = "round";
    c.lineJoin = "round";
    c.lineWidth = width;
    c.strokeStyle = "rgba(92,72,50,0.84)";
    c.stroke(cache.footprints);
    c.strokeStyle = "rgba(60,50,40,0.88)";
    c.stroke(cache.runs);
    c.strokeStyle = "rgba(60,40,18,0.92)";
    c.stroke(cache.doors);
    c.restore();
  }

  function drawWindows(c, b) {
    const ws = b.windows;
    c.fillStyle = "rgba(236,226,200,0.58)";
    c.strokeStyle = "rgba(84,56,26,0.5)";
    c.lineWidth = 0.85;
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i];
      orientRect(QUAD, w.x, w.y, w.tx, w.ty, w.nx, w.ny, w.hw, w.ht);
      ZS.wpoly(c, QUAD, b.seed + 90 + i * 5.3, 0.28, true);
      c.fill();
      c.stroke();
    }
  }

  function drawDoor(c, b, d) {
    const seed = b.seed + 55,
      tx = d.tx != null ? d.tx : d.face === "e" || d.face === "w" ? 0 : 1,
      ty = d.ty != null ? d.ty : d.face === "e" || d.face === "w" ? 1 : 0,
      nx = d.nx != null ? d.nx : d.face === "e" ? 1 : d.face === "w" ? -1 : 0,
      ny = d.ny != null ? d.ny : d.face === "s" ? 1 : d.face === "n" ? -1 : 0,
      hw = d.hw != null ? d.hw : 19,
      ht = d.ht != null ? d.ht : 9,
      sh = d.shake > 0 ? Math.min(1, d.shake * 6) : 0,
      x = d.x + nx * sh * ZS.jit(seed) * 1.4,
      y = d.y + ny * sh * ZS.jit(seed + 1) * 1.4,
      amp = hw > 10 ? 0.7 : 0.35;
    c.lineCap = "round";
    if (!d.broken) {
      const dmg = 1 - d.hp / d.maxHp;
      orientRect(QUAD, x, y, tx, ty, nx, ny, hw, ht);
      ZS.wpoly(c, QUAD, seed, amp, true);
      c.fillStyle = "rgba(138,98,52," + (0.5 + dmg * 0.25).toFixed(2) + ")";
      c.fill();
      c.strokeStyle = "rgba(84,56,26,0.88)";
      c.lineWidth = hw > 10 ? 1.6 : 1.15;
      c.stroke();
      c.strokeStyle = "rgba(84,56,26,0.5)";
      c.lineWidth = hw > 10 ? 1 : 0.8;
      const px = tx * hw * 0.72,
        py = ty * hw * 0.72,
        qx = nx * ht * 0.55,
        qy = ny * ht * 0.55;
      ZS.wline(c, x - px - qx, y - py - qy, x + px - qx, y + py - qy, seed + 2, amp * 0.7);
      ZS.wline(c, x - px + qx, y - py + qy, x + px + qx, y + py + qy, seed + 3, amp * 0.7);
      ZS.wline(c, x - px - qx, y - py - qy, x + px + qx, y + py + qy, seed + 4, amp * 0.8);
      ZS.wline(c, x - px + qx, y - py + qy, x + px - qx, y + py - qy, seed + 5, amp * 0.8);
      c.strokeStyle = "rgba(84,56,26,0.9)";
      c.lineWidth = 1;
      ZS.wcirc(
        c,
        x + tx * hw * 0.52 + nx * ht * 0.12,
        y + ty * hw * 0.52 + ny * ht * 0.12,
        hw > 10 ? 1.8 : 1.05,
        seed + 7,
        0.22,
      );
      if (dmg > 0.15) {
        c.strokeStyle = "rgba(60,40,18,0.6)";
        c.lineWidth = 0.95;
        const k = dmg > 0.6 ? 3 : 2;
        for (let i = 0; i < k; i++) {
          const off = -hw * 0.45 + i * hw * 0.4 + ZS.sjit(seed + i) * 1.4;
          ZS.wline(
            c,
            x + tx * off - nx * ht * 0.45,
            y + ty * off - ny * ht * 0.45,
            x + tx * (off + 1.4) + nx * ht * 0.45,
            y + ty * (off + 1.4) + ny * ht * 0.45,
            seed + 20 + i,
            0.35,
          );
        }
      }
      if (dmg > 0.55) {
        c.strokeStyle = "rgba(40,26,10,0.7)";
        c.lineWidth = 1.1;
        ZS.wline(
          c,
          x - tx * hw * 0.2 - nx * ht,
          y - ty * hw * 0.2 - ny * ht,
          x + tx * hw * 0.15,
          y + ty * hw * 0.15,
          seed + 61,
          0.45,
        );
        ZS.wline(
          c,
          x + tx * hw * 0.15,
          y + ty * hw * 0.15,
          x + tx * hw * 0.35 + nx * ht,
          y + ty * hw * 0.35 + ny * ht,
          seed + 62,
          0.45,
        );
      }
    } else {
      const swing = ht * 2.4;
      c.fillStyle = "rgba(120,84,40,0.5)";
      c.strokeStyle = "rgba(84,56,26,0.8)";
      c.lineWidth = hw > 10 ? 1.4 : 1.05;
      orientRect(
        QUAD,
        x - tx * hw * 0.55 + nx * swing * 0.45,
        y - ty * hw * 0.55 + ny * swing * 0.45,
        tx,
        ty,
        nx,
        ny,
        hw * 0.38,
        ht * 0.7,
      );
      ZS.wpoly(c, QUAD, seed + 71, amp, true);
      c.fill();
      c.stroke();
      orientRect(
        QUAD,
        x + tx * hw * 0.55 + nx * swing * 0.45,
        y + ty * hw * 0.55 + ny * swing * 0.45,
        tx,
        ty,
        nx,
        ny,
        hw * 0.38,
        ht * 0.7,
      );
      ZS.wpoly(c, QUAD, seed + 72, amp, true);
      c.fill();
      c.stroke();
      c.strokeStyle = "rgba(92,72,50,0.75)";
      c.lineWidth = hw > 10 ? 1.5 : 1.05;
      ZS.wline(
        c,
        x - tx * hw,
        y - ty * hw,
        x - tx * hw * 0.4 - nx * ht * 1.6,
        y - ty * hw * 0.4 - ny * ht * 1.6,
        seed + 31,
        amp,
      );
      ZS.wline(
        c,
        x + tx * hw,
        y + ty * hw,
        x + tx * hw * 0.4 + nx * ht * 1.6,
        y + ty * hw * 0.4 + ny * ht * 1.6,
        seed + 37,
        amp,
      );
      c.fillStyle = "rgba(92,72,50,0.5)";
      for (let i = 0; i < 3; i++) {
        ZS.wcirc(
          c,
          x + tx * ZS.sjit(seed + 50 + i) * hw + nx * ZS.sjit(seed + 60 + i) * ht,
          y + ty * ZS.sjit(seed + 50 + i) * hw + ny * ZS.sjit(seed + 60 + i) * ht,
          1.05,
          seed + 41 + i,
          0.25,
        );
      }
    }
  }

  /* ---------- speech bubbles (world space) ---------- */

  // hand-drawn thought bubbles above whoever is mid-shout
  function drawBubbles(c, agents, vis) {
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i];
      if (a.sayT <= 0 || !a.say) continue;
      if (a.x < vis.x0 || a.x > vis.x1 || a.y < vis.y0 || a.y > vis.y1) continue;
      const age = a.sayMax - a.sayT;
      const sc = Math.min(1, age / 0.18); // pop in
      const al = Math.min(1, a.sayT / 0.4); // fade out
      c.font = "11px " + HAND;
      const w = c.measureText(a.say).width + 12,
        h = 16;
      const bx = a.x + ZS.jit(a.seed) * 0.8,
        by = a.y - 27 - (Math.floor(a.seed) % 2) * 13 + ZS.jit(a.seed + 1) * 0.8;
      c.save();
      c.globalAlpha = al * Math.max(0.25, sc);
      c.translate(bx, by);
      c.scale(sc, sc);
      // tail down to the head
      c.strokeStyle = "rgba(46,44,40,0.75)";
      c.lineWidth = 1.2;
      ZS.wline(c, -3, h / 2, -1, h / 2 + 6, a.seed + 21, 0.5);
      ZS.wline(c, 3, h / 2, 1, h / 2 + 6, a.seed + 22, 0.5);
      // wobbly rounded body
      ZS.wpoly(
        c,
        [
          { x: -w / 2 + 4, y: -h / 2 },
          { x: w / 2 - 4, y: -h / 2 },
          { x: w / 2, y: -h / 2 + 4 },
          { x: w / 2, y: h / 2 - 4 },
          { x: w / 2 - 4, y: h / 2 },
          { x: -w / 2 + 4, y: h / 2 },
          { x: -w / 2, y: h / 2 - 4 },
          { x: -w / 2, y: -h / 2 + 4 },
        ],
        a.seed + 31,
        0.7,
        true,
      );
      c.fillStyle = "rgba(252,248,238,0.94)";
      c.fill();
      c.strokeStyle = "rgba(46,44,40,0.8)";
      c.lineWidth = 1.3;
      c.stroke();
      c.fillStyle = "rgba(46,44,40,0.92)";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(a.say, 0, 0.5);
      c.textAlign = "left";
      c.textBaseline = "alphabetic";
      c.restore();
    }
  }

  /* ---------- HUD (screen space) ---------- */

  function drawHUD(c, t, vw, vh, wave, agents) {
    const hud = ZS.scenario.hud(agents, wave);
    const fs = Math.max(11, Math.min(15, vw / 42));
    // a scenario may hide the top-left block (its stats live in the DOM panel)
    if (!hud.hidden) {
      c.save();
      c.translate(20, 24);
      c.rotate(-0.015);
      c.fillStyle = "rgba(46,44,40,0.85)";
      c.font = "italic " + fs + "px " + HAND;
      c.fillText(hud.title, 0, 0);
      c.font = "italic " + fs * 0.85 + "px " + HAND;
      c.fillStyle = "rgba(60,58,50,0.8)";
      c.fillText(hud.stats, 0, fs * 1.35);
      // the scenario's own mini legend (its glyphs, its labels)
      hud.legend(c, fs * 2.6, fs, vw, vh);
      c.restore();
    }

    // controls hint (+ engine-level hints: auto camera, sound lock)
    c.save();
    c.translate(20, vh - 18);
    c.fillStyle = "rgba(60,58,50,0.55)";
    c.font = "italic 12px " + HAND;
    let hint = hud.hint;
    if (ZS.debug && ZS.debug.cam && ZS.debug.cam.auto)
      hint += "  ·  cámara automática — arrastra para tomar el control";
    if (ZS.sound && !ZS.sound.unlocked) hint += "  ·  haz clic para activar el sonido";
    c.fillText(hint, 0, 0);
    c.restore();

    const ov = hud.overlay();
    if (ov) {
      if (ov.card) {
        drawCard(c, ov.card, vw, vh);
      } else {
        c.save();
        c.globalAlpha = ov.fade !== undefined ? ov.fade : 0.6 + 0.3 * Math.sin(t * 3);
        c.translate(vw / 2, vh / 2);
        c.rotate(-0.03);
        c.textAlign = "center";
        c.fillStyle = "rgba(90,40,30,0.85)";
        c.font =
          "italic " + Math.max(18, Math.min(34, vw / 18) * (ov.big ? 1.7 : 1)) + "px " + HAND;
        c.fillText(ov.main, 0, 0);
        if (ov.sub) {
          c.font = "italic 14px " + HAND;
          c.fillText(ov.sub, 0, 28);
        }
        c.restore();
      }
    }
  }

  // the dawn results card: a sheet of paper with the night's tally —
  // any click dismisses it and starts the next day
  function drawCard(c, card, vw, vh) {
    const fs = Math.max(13, Math.min(17, vw / 60));
    const w = Math.max(360, vw * 0.44),
      h = 132 + card.lines.length * (fs * 1.6);
    c.save();
    c.translate(vw / 2, vh / 2);
    c.rotate(-0.018 + ZS.jit(7.7) * 0.004);
    // the sheet: a wobbling rounded rect of paper
    const r = 10,
      x = -w / 2,
      y = -h / 2;
    ZS.wpoly(
      c,
      [
        { x: x + r, y },
        { x: x + w - r, y },
        { x: x + w, y: y + r },
        { x: x + w, y: y + h - r },
        { x: x + w - r, y: y + h },
        { x: x + r, y: y + h },
        { x, y: y + h - r },
        { x, y: y + r },
      ],
      42,
      1.3,
      true,
    );
    c.fillStyle = card.lost ? "rgba(250,240,228,0.97)" : "rgba(252,248,238,0.97)";
    c.fill();
    c.strokeStyle = "rgba(60,50,40,0.85)";
    c.lineWidth = 1.6;
    c.stroke();
    // the tally
    c.textAlign = "center";
    c.fillStyle = card.lost ? "rgba(140,50,30,0.95)" : "rgba(70,58,40,0.95)";
    c.font = "italic " + fs * 1.5 + "px " + HAND;
    c.fillText(card.title, 0, y + fs * 1.7);
    c.font = "italic " + fs + "px " + HAND;
    c.fillStyle = "rgba(60,52,40,0.85)";
    let ly = y + fs * 3.4;
    for (const line of card.lines) {
      if (!line) continue;
      c.fillText(line, 0, ly);
      ly += fs * 1.6;
    }
    // the dismiss prompt, breathing
    c.fillStyle =
      "rgba(60,52,40," +
      (0.45 + 0.25 * Math.sin((performance.now() / 1000) * 2.4)).toFixed(2) +
      ")";
    c.font = "italic " + fs * 0.85 + "px " + HAND;
    c.fillText("haz clic para continuar", 0, y + h - fs * 0.9);
    c.restore();
  }

  /* ---------- per-frame pipeline ---------- */

  function drawStaticBasePass(c, world, vis) {
    world.visibleRect = vis;
    if (world.drawBase) world.drawBase(c, vis);
    else c.drawImage(world.canvas, 0, 0, world.w, world.h);
    // Permanent terrain changes belong in the base pass. Phaser can bake
    // them into its ground chunks instead of drawing them on the top canvas.
    if (ZS.scenario.drawPermanentGround) ZS.scenario.drawPermanentGround(c, world);
  }

  function drawDynamicGroundPass(c, world, t, vis) {
    world.visibleRect = vis;
    drawWater(c, world);
    // the scenario's own ground pass (tile washes, boiling borders)
    if (ZS.scenario.drawGround) ZS.scenario.drawGround(c, world, t);
    if (world.stains) world.stains.draw(c, vis);
  }

  function drawGroundPass(c, world, t, vis) {
    drawStaticBasePass(c, world, vis);
    drawDynamicGroundPass(c, world, t, vis);
  }

  function drawActorPass(c, world, sim, t, vis, options) {
    // everything that has height, painted back-to-front
    const list = sceneList;
    let listN = 0,
      buildingCandidates = null;
    if (!options || options.trees !== false) {
      const trees = world.queryVisible
        ? world.queryVisible("trees", vis, visibleTrees)
        : world.trees;
      for (const tr of trees) {
        if (tr.x < vis.x0 || tr.x > vis.x1 || tr.y < vis.y0 - tr.r * 2 || tr.y > vis.y1) continue;
        addSceneItem(listN++, tr.y, 0, tr);
      }
    }
    const drawBuildings = !options || options.buildings !== false,
      drawBuildingOverlays = !options || options.buildingOverlays !== false,
      drawBuildingInk = Boolean(options && options.buildingInk);
    if (
      drawBuildings ||
      drawBuildingInk ||
      (drawBuildingOverlays && ZS.scenario.drawBuildingOverlay)
    ) {
      const buildings = world.queryVisible
        ? world.queryVisible("buildings", vis, visibleBuildings)
        : world.buildings;
      buildingCandidates = buildings;
      for (const b of buildings) {
        if (b.x + b.w < vis.x0 || b.x > vis.x1 || b.y + b.h < vis.y0 || b.y > vis.y1) continue;
        addSceneItem(listN++, b.y + b.h, 1, b);
      }
    }
    if (!options || options.blocks !== false)
      for (const b of world.blocks ? world.blocks.list : []) {
        if (b.x1 < vis.x0 || b.x0 > vis.x1 || b.by < vis.y0 || b.y0 > vis.y1) continue;
        addSceneItem(listN++, b.by, 3, b);
      }
    if (!options || options.agents !== false)
      for (const a of sim.agents) {
        if (a.x < vis.x0 || a.x > vis.x1 || a.y < vis.y0 || a.y > vis.y1) continue;
        addSceneItem(listN++, a.y, 2, a);
      }
    list.length = listN;
    list.sort((p, q) => p.y - q.y);
    if (drawBuildingInk)
      drawBuildingExteriors(
        c,
        buildingCandidates,
        t,
        options.buildingInkWidth,
        options.buildingInkAmp,
        options.buildingInkAlpha,
      );
    for (const it of list) {
      if (it.k === 0) drawTree(c, it.o, t);
      else if (it.k === 1) {
        if (drawBuildings && !it.o.hidden) drawBuilding(c, it.o);
        if (drawBuildingOverlays && ZS.scenario.drawBuildingOverlay)
          ZS.scenario.drawBuildingOverlay(c, it.o, t);
      } else if (it.k === 3) ZS.scenario.drawBlock(c, it.o, t);
      else ZS.scenario.draw(c, it.o, t);
    }

    // persistent scenario overlays (selection routes, drag marquees) sit above the actors
    if (ZS.scenario.drawOverlay) ZS.scenario.drawOverlay(c, t);

    // transient effects (tracers, poofs, blood) — the scenario renders its own records
    if (ZS.fx.length) ZS.scenario.drawFX(c, ZS.fx);

    // voices float above the crowd
    drawBubbles(c, sim.agents, vis);
  }

  function drawScene(c, cam, world, sim, t, vw, vh, options) {
    c.clearRect(0, 0, vw, vh);
    c.save();
    cam.apply(c, vw, vh);

    const vis = cam.visible(vw, vh, 80);
    if (!options || options.ground !== false) {
      if (!options || options.baseGround !== false) drawStaticBasePass(c, world, vis);
      if (!options || options.dynamicGround !== false) drawDynamicGroundPass(c, world, t, vis);
    }
    drawActorPass(c, world, sim, t, vis, options);

    c.restore();
    drawHUD(c, t, vw, vh, sim.wave, sim.agents);
  }

  // Phaser's Hold pilot keeps visible ground chunks in GPU textures.
  // Effects, bubbles and HUD remain on the overlay canvas; Phaser can suppress
  // blocks and agents here once their exact scenario drawings live in atlases.
  function drawGroundTexturePass(c, world, t, visible, pass, clear) {
    const previousVisible = world.visibleRect,
      bounds = visible || { x0: 0, y0: 0, x1: world.w, y1: world.h };
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (clear) c.clearRect(0, 0, c.canvas.width, c.canvas.height);
    c.translate(-bounds.x0, -bounds.y0);
    pass(c, world, t, bounds);
    c.restore();
    world.visibleRect = previousVisible;
  }

  function drawGroundTexture(c, world, t, visible) {
    drawGroundTexturePass(c, world, t, visible, drawGroundPass, true);
  }

  function drawGroundBaseTexture(c, world, visible) {
    drawGroundTexturePass(
      c,
      world,
      0,
      visible,
      (context, subject, _t, bounds) => {
        drawStaticBasePass(context, subject, bounds);
      },
      true,
    );
  }

  function drawGroundOverlayTexture(c, world, t, visible) {
    drawGroundTexturePass(c, world, t, visible, drawDynamicGroundPass, false);
  }

  ZS.drawScene = drawScene;
  ZS.drawGroundTexture = drawGroundTexture;
  ZS.drawGroundBaseTexture = drawGroundBaseTexture;
  ZS.drawGroundOverlayTexture = drawGroundOverlayTexture;
  ZS.drawTreeSketch = drawTree;
  ZS.drawBuildingSketch = drawBuilding;
})();
