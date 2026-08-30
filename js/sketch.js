/* Sketch primitives: boiling hand-drawn strokes shared by everything drawn.
   `jit` re-jitters ~7x/second so lines shimmer like a hand-drawn animation;
   `sjit` is static (used for pre-rendered paper texture). */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});

  function rnd(a, b) {
    return a + Math.random() * (b - a);
  }
  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  // deterministic PRNG (mulberry32): same town, same lake, every load
  function rng32(seed) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(n) {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
  }

  // boiling-line step: re-jitters every ~140ms
  let boil = 0;
  function setBoil(t) {
    boil = Math.floor(t / 0.14);
  }
  function jit(seed) {
    return hash(seed + boil * 13.373) * 2 - 1;
  }
  function sjit(seed) {
    return hash(seed * 7.77) * 2 - 1;
  }

  /* Wobbly line: sub-segments jittered along the way, ends held tighter. */
  function appendWline(path, x1, y1, x2, y2, seed, amp) {
    amp = amp || 1.6;
    const dx = x2 - x1,
      dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    const n = Math.max(2, Math.round(len / 9));
    for (let i = 0; i <= n; i++) {
      const t = i / n,
        f = i > 0 && i < n ? 1 : 0.4;
      const px = x1 + dx * t + jit(seed + i * 7.1) * amp * f;
      const py = y1 + dy * t + jit(seed + i * 13.7 + 50) * amp * f;
      if (i) path.lineTo(px, py);
      else path.moveTo(px, py);
    }
  }

  function wline(c, x1, y1, x2, y2, seed, amp) {
    c.beginPath();
    appendWline(c, x1, y1, x2, y2, seed, amp);
    c.stroke();
  }

  /* Wobbly circle: a 9-point jittered ring. */
  function wcirc(c, cx, cy, r, seed, amp) {
    amp = amp === undefined ? r * 0.15 : amp;
    const n = 9;
    c.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r + jit(seed + i * 3.3) * amp;
      const px = cx + Math.cos(a) * rr,
        py = cy + Math.sin(a) * rr;
      if (i) c.lineTo(px, py);
      else c.moveTo(px, py);
    }
    c.stroke();
  }

  /* Wobbly rectangle: four wlines with fixed seeds (hand-drawn page frame). */
  function sketchRect(c, x, y, w, h) {
    c.lineWidth = 1.6;
    wline(c, x, y, x + w, y, 1.1, 2);
    wline(c, x + w, y, x + w, y + h, 2.7, 2);
    wline(c, x + w, y + h, x, y + h, 4.2, 2);
    wline(c, x, y + h, x, y, 5.9, 2);
  }

  /* Wobbly polyline through corner points; close=true joins last->first.
     Leaves the path built and ready for fill()/stroke() by the caller. */
  function wpoly(c, pts, seed, amp, close) {
    amp = amp || 1.8;
    c.beginPath();
    const edges = close ? pts.length : pts.length - 1;
    for (let e = 0; e < edges; e++) {
      const i0 = pts[e],
        i1 = pts[(e + 1) % pts.length];
      const dx = i1.x - i0.x,
        dy = i1.y - i0.y;
      const n = Math.max(2, Math.round(Math.hypot(dx, dy) / 9));
      for (let i = e === 0 ? 0 : 1; i <= n; i++) {
        const t = i / n,
          f = i > 0 && i < n ? 1 : 0.4;
        const px = i0.x + dx * t + jit(seed + e * 31.7 + i * 7.1) * amp * f;
        const py = i0.y + dy * t + jit(seed + e * 57.3 + i * 13.7 + 50) * amp * f;
        if (e === 0 && i === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      }
    }
    if (close) c.closePath();
  }

  function lerpC(c1, c2, t) {
    return (
      "rgb(" +
      Math.round(c1[0] + (c2[0] - c1[0]) * t) +
      "," +
      Math.round(c1[1] + (c2[1] - c1[1]) * t) +
      "," +
      Math.round(c1[2] + (c2[2] - c1[2]) * t) +
      ")"
    );
  }

  ZS.rnd = rnd;
  ZS.clamp = clamp;
  ZS.rng32 = rng32;
  ZS.hash = hash;
  ZS.setBoil = setBoil;
  ZS.jit = jit;
  ZS.sjit = sjit;
  ZS.appendWline = appendWline;
  ZS.wline = wline;
  ZS.wcirc = wcirc;
  ZS.sketchRect = sketchRect;
  ZS.wpoly = wpoly;
  ZS.lerpC = lerpC;
})();
