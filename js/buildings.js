/* Buildings as sections/tiles: a building is a set of interior room
   rectangles — SECTION_LIBRARY below is the config surface, add an
   archetype there to grow the town. Walls auto-derive as a one-cell ring
   around the union of floors (pockets of exterior land deeper than a cell
   survive as notches), and one entry door is auto-placed on the longest
   exterior-facing wall run. Doors have health: intact they block zombies
   (humans walk straight through), and once broken they open for everyone. */
(() => {
  "use strict";
  const ZS = window.ZS;

  const CELL = 20;
  const DOOR_W = 2; // opening width in cells (40px)
  const DOOR_HP = 480; // one zombie: 16s of gnawing; a pack of four: 4s

  // room: [x, y, w, h] in local building coords, px
  const SECTION_LIBRARY = [
    { id: "barn", rooms: [[0, 0, 220, 150]] },
    {
      id: "house",
      rooms: [
        [0, 0, 180, 140],
        [180, 60, 140, 80],
      ],
    },
    {
      id: "longhouse",
      rooms: [
        [0, 0, 260, 110],
        [60, 110, 120, 100],
      ],
    },
    {
      id: "lshape",
      rooms: [
        [0, 0, 200, 130],
        [0, 130, 110, 110],
      ],
    },
    {
      id: "compound",
      rooms: [
        [0, 0, 120, 120],
        [130, 0, 120, 120],
        [65, 130, 110, 100],
      ],
    },
    // the odd buildings (wt: 1 in the pool) — a map is its own when one
    // of these slips into a district
    { id: "warehouse", wt: 1, rooms: [[0, 0, 300, 130]] },
    {
      id: "chapel",
      wt: 1,
      rooms: [
        [0, 40, 140, 240],
        [70, 0, 220, 110],
      ],
    },
    {
      id: "mill",
      wt: 1,
      rooms: [
        [0, 0, 220, 120],
        [120, 120, 100, 90],
      ],
    },
  ];

  // weighted archetype pool: wt defaults to 2 for the classic shapes,
  // 1 for the rarer ones — built once, sampled at placement
  const ARCH_POOL = [];
  for (const a of SECTION_LIBRARY) for (let w = 0; w < (a.wt || 2); w++) ARCH_POOL.push(a);

  const B = {
    list: [],
    cellBld: null, // floor cell -> building index
    doorBld: null, // intact-door cell -> building index
    generate,
    doorBroken,
    cellBldAt,
  };

  function generate(world, nav, options) {
    const rng = ZS.rng32(world.seed ^ 0xb11d);
    const opts = options || null;
    B.list = [];
    B.cellBld = new Int16Array(nav.n);
    B.doorBld = new Int16Array(nav.n);
    B.cellBld.fill(-1);
    B.doorBld.fill(-1);
    for (let ti = 0; ti < world.towns.length; ti++) {
      if (opts && opts.maxBuildings && B.list.length >= opts.maxBuildings) break;
      const tn = world.towns[ti];
      const count = opts ? Math.max(1, Math.round(tn.n * (opts.density || 1))) : tn.n;
      for (let k = 0; k < count; k++) {
        if (opts && opts.maxBuildings && B.list.length >= opts.maxBuildings) break;
        place(tn, ti, k, rng, world, nav, opts);
      }
    }
    world.buildings = B.list;
  }

  function overlapsAny(wx, wy, bw, bh, pad) {
    for (const b of B.list)
      if (
        wx < b.x + b.w + pad &&
        wx + bw > b.x - pad &&
        wy < b.y + b.h + pad &&
        wy + bh > b.y - pad
      )
        return true;
    return false;
  }

  function place(tn, ti, k, rng, world, nav, opts) {
    const maxAttempts = opts ? opts.attempts || 60 : 60,
      spread = opts ? tn.spread * (opts.spread || 1) : tn.spread,
      pad = opts ? (opts.pad ?? 55) : 55;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const arch = ARCH_POOL[(rng() * ARCH_POOL.length) | 0];
      const s = opts
        ? (opts.scaleMin ?? 0.85) + rng() * (opts.scaleRange ?? 0.45)
        : 0.85 + rng() * 0.45;
      const rooms = arch.rooms.map((r) => [r[0] * s, r[1] * s, r[2] * s, r[3] * s]);
      let minx = 1e9,
        miny = 1e9,
        maxx = -1e9,
        maxy = -1e9;
      for (const r of rooms) {
        minx = Math.min(minx, r[0]);
        miny = Math.min(miny, r[1]);
        maxx = Math.max(maxx, r[0] + r[2]);
        maxy = Math.max(maxy, r[1] + r[3]);
      }
      const bw = maxx - minx,
        bh = maxy - miny;
      const wx = tn.x + (rng() - 0.5) * spread - bw / 2 - minx;
      const wy = tn.y + (rng() - 0.5) * spread - bh / 2 - miny;
      if (wx < 60 || wy < 60 || wx + bw > world.w - 60 || wy + bh > world.h - 60) continue;
      if (!world.clearOfWater(wx, wy, bw, bh, 70)) continue;
      if (!world.clearOfForest(wx, wy, bw, bh, 30)) continue;
      if (overlapsAny(wx, wy, bw, bh, pad)) continue;

      const bi = B.list.length;
      markFloors(nav, wx, wy, rooms, bi);
      wallRing(nav, wx, wy, bw, bh);
      const door = placeDoor(nav, wx, wy, bw, bh, bi);
      const b = {
        x: wx,
        y: wy,
        w: bw,
        h: bh,
        rooms: rooms.map((r) => [wx + r[0], wy + r[1], r[2], r[3]]),
        runs: wallRuns(nav, wx, wy, bw, bh),
        door,
        seed: rng() * 997,
        inCount: 0, // blocked agents (the horde) inside
        survCount: 0, // everyone else inside
        escape: null,
      };
      b.escape = escapePoint(b, door);
      B.list.push(b);
      return;
    }
  }

  // room rects -> floor cells (land only, cell center inside the rect)
  function markFloors(nav, wx, wy, rooms, bi) {
    for (const r of rooms) {
      const x = wx + r[0],
        y = wy + r[1],
        w = r[2],
        h = r[3];
      const ix0 = Math.max(0, (x / CELL) | 0),
        iy0 = Math.max(0, (y / CELL) | 0),
        ix1 = Math.min(nav.w - 1, ((x + w) / CELL) | 0),
        iy1 = Math.min(nav.h - 1, ((y + h) / CELL) | 0);
      for (let iy = iy0; iy <= iy1; iy++)
        for (let ix = ix0; ix <= ix1; ix++) {
          const cx = (ix + 0.5) * CELL,
            cy = (iy + 0.5) * CELL;
          if (cx < x || cx >= x + w || cy < y || cy >= y + h) continue;
          const i = iy * nav.w + ix;
          if (nav.val[i] === 1 && B.doorBld[i] < 0) {
            nav.val[i] = 2;
            B.cellBld[i] = bi;
          }
        }
    }
  }

  // one-cell wall ring: any land cell 8-adjacent to floor becomes a wall
  function wallRing(nav, wx, wy, bw, bh) {
    const ix0 = Math.max(0, ((wx - CELL) / CELL) | 0),
      iy0 = Math.max(0, ((wy - CELL) / CELL) | 0),
      ix1 = Math.min(nav.w - 1, ((wx + bw + CELL) / CELL) | 0),
      iy1 = Math.min(nav.h - 1, ((wy + bh + CELL) / CELL) | 0);
    for (let iy = iy0; iy <= iy1; iy++)
      for (let ix = ix0; ix <= ix1; ix++) {
        const i = iy * nav.w + ix;
        if (nav.val[i] !== 1) continue;
        if (B.doorBld[i] >= 0) continue; // never close over a door front
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = ix + dx,
              ny = iy + dy;
            if (nx < 0 || ny < 0 || nx >= nav.w || ny >= nav.h) continue;
            if (nav.val[ny * nav.w + nx] === 2) {
              nav.val[i] = 0;
              break;
            }
          }
        if (nav.val[i] === 0) continue;
      }
  }

  // straight runs of wall cells whose outward side is open land,
  // as world-space line segments (for drawing) + cell lists (for doors)
  function wallRuns(nav, wx, wy, bw, bh) {
    const runs = [];
    const ix0 = Math.max(0, ((wx - CELL) / CELL) | 0),
      iy0 = Math.max(0, ((wy - CELL) / CELL) | 0),
      ix1 = Math.min(nav.w - 1, ((wx + bw + CELL) / CELL) | 0),
      iy1 = Math.min(nav.h - 1, ((wy + bh + CELL) / CELL) | 0);
    const sideOf = (ix, iy) => {
      const up = iy > 0 ? nav.val[(iy - 1) * nav.w + ix] : 0;
      const dn = iy < nav.h - 1 ? nav.val[(iy + 1) * nav.w + ix] : 0;
      const lt = ix > 0 ? nav.val[iy * nav.w + ix - 1] : 0;
      const rt = ix < nav.w - 1 ? nav.val[iy * nav.w + ix + 1] : 0;
      if (up === 1 && dn !== 1) return "n";
      if (dn === 1 && up !== 1) return "s";
      if (lt === 1 && rt !== 1) return "w";
      if (rt === 1 && lt !== 1) return "e";
      return null;
    };
    for (let iy = iy0; iy <= iy1; iy++) {
      let ix = ix0;
      while (ix <= ix1) {
        if (nav.val[iy * nav.w + ix] !== 0) {
          ix++;
          continue;
        }
        const side = sideOf(ix, iy);
        let end = ix;
        while (
          end + 1 <= ix1 &&
          nav.val[iy * nav.w + end + 1] === 0 &&
          sideOf(end + 1, iy) === side &&
          side
        )
          end++;
        if (side && end > ix)
          runs.push({
            x1: (ix + 0.5) * CELL,
            y1: (iy + 0.5) * CELL,
            x2: (end + 0.5) * CELL,
            y2: (iy + 0.5) * CELL,
            side,
            cells: cellList(nav, "h", ix, iy, end, iy),
          });
        ix = end + 1;
      }
    }
    for (let ix = ix0; ix <= ix1; ix++) {
      let iy = iy0;
      while (iy <= iy1) {
        if (nav.val[iy * nav.w + ix] !== 0) {
          iy++;
          continue;
        }
        const side = sideOf(ix, iy);
        let end = iy;
        while (
          end + 1 <= iy1 &&
          nav.val[(end + 1) * nav.w + ix] === 0 &&
          sideOf(ix, end + 1) === side &&
          side
        )
          end++;
        if (side && end > iy)
          runs.push({
            x1: (ix + 0.5) * CELL,
            y1: (iy + 0.5) * CELL,
            x2: (ix + 0.5) * CELL,
            y2: (end + 0.5) * CELL,
            side,
            cells: cellList(nav, "v", ix, iy, ix, end),
          });
        iy = end + 1;
      }
    }
    return runs;
  }

  function cellList(nav, o, a, b, c, d) {
    const out = [];
    if (o === "h") for (let ix = a; ix <= c; ix++) out.push(b * nav.w + ix);
    else for (let iy = b; iy <= d; iy++) out.push(iy * nav.w + a);
    return out;
  }
  // one entry door: longest qualifying run, DOOR_W cells in its middle
  function placeDoor(nav, wx, wy, bw, bh, bi) {
    const runs = wallRuns(nav, wx, wy, bw, bh);
    let best = null,
      bestLen = 0;
    for (const r of runs) {
      if (r.cells.length < DOOR_W + 1) continue;
      // the front (exterior) cell beside the door's middle must be open land
      const mid = r.cells[(r.cells.length - DOOR_W) >> 1];
      const f = frontOf(nav, r, mid);
      if (f < 0 || nav.val[f] !== 1) continue;
      if (r.cells.length > bestLen) {
        bestLen = r.cells.length;
        best = { r, mid, f };
      }
    }
    if (!best) return null;
    const { r, mid, f } = best;
    const horizontal = r.side === "n" || r.side === "s";
    const ix = mid % nav.w,
      iy = (mid / nav.w) | 0;
    const cells = [mid, horizontal ? mid + 1 : mid + nav.w];
    for (const i of cells) {
      nav.val[i] = 3;
      B.doorBld[i] = bi;
    }
    // claim the front cell too: a later building's wall ring or floor may
    // not paint over an existing door's open front
    B.doorBld[f] = bi;
    const cx = horizontal ? (ix + DOOR_W / 2) * CELL : (ix + 0.5) * CELL;
    const cy = horizontal ? (iy + 0.5) * CELL : (iy + DOOR_W / 2) * CELL;
    // the sheltering spot: the deepest floor cell reachable from the door,
    // so shallow rooms and multi-room sections still get a valid target
    let bestCell = -1,
      bestDepth = 0;
    const depth = new Int16Array(nav.n).fill(-1);
    const q = [];
    for (const i of cells) {
      depth[i] = 0;
      q.push(i);
    }
    let qi = 0;
    while (qi < q.length) {
      const i = q[qi++];
      const d0 = i % nav.w,
        d1 = (i / nav.w) | 0;
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          const nx = d0 + ox,
            ny = d1 + oy;
          if (nx < 0 || ny < 0 || nx >= nav.w || ny >= nav.h) continue;
          const j = ny * nav.w + nx;
          if (depth[j] >= 0) continue;
          const v = nav.val[j];
          if (v !== 2 && v !== 3) continue;
          depth[j] = depth[i] + 1;
          if (v === 2 && depth[j] > bestDepth) {
            bestDepth = depth[j];
            bestCell = j;
          }
          q.push(j);
        }
    }
    const inner =
      bestCell >= 0
        ? nav.centerOf(bestCell)
        : {
            x: cx + (r.side === "e" ? -2 * CELL : r.side === "w" ? 2 * CELL : 0),
            y: cy + (r.side === "s" ? -2 * CELL : r.side === "n" ? 2 * CELL : 0),
          };
    return {
      x: cx,
      y: cy,
      w: DOOR_W * CELL,
      face: r.side,
      hp: DOOR_HP,
      maxHp: DOOR_HP,
      broken: false,
      shake: 0,
      cells,
      front: nav.centerOf(f),
      frontIdx: f,
      inner,
    };
  }

  function frontOf(nav, r, mid) {
    const ix = mid % nav.w,
      iy = (mid / nav.w) | 0;
    if (ix < 1 || iy < 1 || ix > nav.w - 2 || iy > nav.h - 2) return -1;
    if (r.side === "n") return (iy - 1) * nav.w + ix;
    if (r.side === "s") return (iy + 1) * nav.w + ix;
    if (r.side === "w") return iy * nav.w + ix - 1;
    return iy * nav.w + ix + 1;
  }

  // farthest room corner from the door: where a trapped survivor huddles
  function escapePoint(b, door) {
    const fx = door ? door.front.x : b.x + b.w / 2;
    const fy = door ? door.front.y : b.y + b.h / 2;
    let best = null,
      bd = -1;
    for (const r of b.rooms) {
      const cands = [
        [r[0] + 12, r[1] + 12],
        [r[0] + r[2] - 12, r[1] + 12],
        [r[0] + 12, r[1] + r[3] - 12],
        [r[0] + r[2] - 12, r[1] + r[3] - 12],
      ];
      for (const p of cands) {
        const d = (p[0] - fx) * (p[0] - fx) + (p[1] - fy) * (p[1] - fy);
        if (d > bd) {
          bd = d;
          best = { x: p[0], y: p[1] };
        }
      }
    }
    return best || { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }

  // a door breaks: its cells become plain land, everyone replans
  function doorBroken(door, nav) {
    if (door.broken) return;
    door.broken = true;
    for (const i of door.cells) nav.val[i] = 1;
    nav.version++;
  }

  // building index whose floor/door cell (x, y) sits on, else -1
  function cellBldAt(nav, x, y) {
    const i = nav.idx(x, y);
    if (i < 0) return -1;
    const v = nav.val[i];
    if (v === 2) return B.cellBld[i];
    if (v === 3) return B.doorBld[i];
    return -1;
  }

  ZS.Buildings = B;
})();
