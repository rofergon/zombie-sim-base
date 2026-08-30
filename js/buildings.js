/* Buildings as sections/tiles: a building is a set of interior room
   rectangles — SECTION_LIBRARY below is the config surface, add an
   archetype there to grow the town. Walls auto-derive as a one-cell ring
   around the union of floors (pockets of exterior land deeper than a cell
    survive as notches), and one entry door is auto-placed on the longest
    exterior-facing wall run — OSM footprints sit that leaf on the real
    facade, rotated to the wall. Doors have health: intact they block zombies
   (humans walk straight through), and once broken they open for everyone. */
(() => {
  "use strict";
  const ZS = window.ZS;

  let CELL = 20;
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
    load,
    demolish,
    doorBroken,
    cellBldAt,
  };

  function pointInPoly(x, y, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i],
        b = points[j];
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x)
        inside = !inside;
    }
    return inside;
  }

  // closed OSM rings often repeat the first vertex at the end
  function polyN(points) {
    const n = points.length;
    if (n < 2) return n;
    const a = points[0],
      b = points[n - 1];
    return Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05 ? n - 1 : n;
  }

  // Load already-normalized geographic footprints. The procedural path above
  // remains untouched; both paths produce the same runtime building contract.
  function load(world, nav, records) {
    CELL = nav.cell || 20;
    B.list = [];
    B.cellBld = new Int32Array(nav.n);
    B.doorBld = new Int32Array(nav.n);
    B.cellBld.fill(-1);
    B.doorBld.fill(-1);
    // Rasterize the complete block before choosing any entrance. Otherwise
    // an early building can choose a facade that a later neighbour closes.
    for (let i = 0; i < records.length; i++) {
      const source = records[i],
        points = source.points,
        bounds = source.bounds;
      if (!Array.isArray(points) || points.length < 3 || !bounds) continue;
      const bi = B.list.length,
        x = bounds.x0,
        y = bounds.y0,
        w = Math.max(CELL, bounds.x1 - bounds.x0),
        h = Math.max(CELL, bounds.y1 - bounds.y0);
      const seed = hashSeed(source.sourceKey);
      const building = {
        x,
        y,
        w,
        h,
        rooms: [[x, y, w, h]],
        footprint: points,
        runs: null,
        door: null,
        seed,
        sourceKey: source.sourceKey,
        sourceTags: source.tags || {},
        sourceName: source.name || "",
        sourcePoi: source.poi,
        sourceArea: source.area || 0,
        inCount: 0,
        survCount: 0,
        escape: null,
      };
      B.list.push(building);
      markPolyFloors(nav, points, bounds, bi);
    }
    for (let i = 0; i < B.list.length; i++) {
      const building = B.list[i];
      wallRing(nav, building.x, building.y, building.w, building.h);
    }
    const access = labelLandAccess(nav);
    for (let i = 0; i < B.list.length; i++) {
      const building = B.list[i];
      let door = placeFootprintDoor(
        nav,
        building.footprint,
        {
          x0: building.x,
          y0: building.y,
          x1: building.x + building.w,
          y1: building.y + building.h,
        },
        i,
        building.seed,
        access,
      );
      if (!door) {
        door = placeDoor(nav, building.x, building.y, building.w, building.h, i, false, access);
        if (door) snapDoorToPoly(door, building.footprint);
      }
      building.door = door;
      building.runs = wallRuns(nav, building.x, building.y, building.w, building.h);
      building.escape = footprintEscape(building, door);
      dressBuilding(building);
    }
    world.buildings = B.list;
    nav.version++;
  }

  // Connected public-land components let doors prefer streets and the open
  // city network over tiny courtyards trapped between neighbouring roofs.
  function labelLandAccess(nav) {
    const labels = new Int32Array(nav.n),
      queue = new Int32Array(nav.n),
      sizes = [],
      roads = [];
    labels.fill(-1);
    let label = 0;
    for (let start = 0; start < nav.n; start++) {
      if (nav.val[start] !== 1 || labels[start] >= 0) continue;
      let qi = 0,
        qn = 1,
        size = 0,
        road = 0;
      queue[0] = start;
      labels[start] = label;
      while (qi < qn) {
        const index = queue[qi++],
          x = index % nav.w,
          y = (index / nav.w) | 0;
        size++;
        road += nav.road[index];
        if (x > 0) qn = visitLand(nav, labels, queue, qn, index - 1, label);
        if (x < nav.w - 1) qn = visitLand(nav, labels, queue, qn, index + 1, label);
        if (y > 0) qn = visitLand(nav, labels, queue, qn, index - nav.w, label);
        if (y < nav.h - 1) qn = visitLand(nav, labels, queue, qn, index + nav.w, label);
      }
      sizes.push(size);
      roads.push(road);
      label++;
    }
    return { labels, sizes, roads };
  }

  function visitLand(nav, labels, queue, qn, index, label) {
    if (nav.val[index] !== 1 || labels[index] >= 0) return qn;
    labels[index] = label;
    queue[qn] = index;
    return qn + 1;
  }

  function hashSeed(text) {
    let h = 2166136261;
    const value = String(text || "building");
    for (let i = 0; i < value.length; i++) {
      h ^= value.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) % 997;
  }

  function markPolyFloors(nav, points, bounds, bi) {
    const ix0 = Math.max(0, (bounds.x0 / CELL) | 0),
      iy0 = Math.max(0, (bounds.y0 / CELL) | 0),
      ix1 = Math.min(nav.w - 1, (bounds.x1 / CELL) | 0),
      iy1 = Math.min(nav.h - 1, (bounds.y1 / CELL) | 0);
    for (let iy = iy0; iy <= iy1; iy++)
      for (let ix = ix0; ix <= ix1; ix++) {
        const x = (ix + 0.5) * CELL,
          y = (iy + 0.5) * CELL,
          index = iy * nav.w + ix;
        if (nav.val[index] === 1 && pointInPoly(x, y, points)) {
          nav.val[index] = 2;
          B.cellBld[index] = bi;
        }
      }
  }

  function generate(world, nav, options) {
    CELL = nav.cell || 20;
    const rng = ZS.rng32(world.seed ^ 0xb11d);
    const opts = options || null;
    B.list = [];
    B.cellBld = new Int32Array(nav.n);
    B.doorBld = new Int32Array(nav.n);
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
      dressBuilding(b);
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

  function faceFromNormal(nx, ny) {
    return Math.abs(nx) > Math.abs(ny) ? (nx > 0 ? "e" : "w") : ny > 0 ? "s" : "n";
  }

  function doorAxes(face) {
    const hz = face === "n" || face === "s";
    return {
      tx: hz ? 1 : 0,
      ty: hz ? 0 : 1,
      nx: face === "e" ? 1 : face === "w" ? -1 : 0,
      ny: face === "s" ? 1 : face === "n" ? -1 : 0,
    };
  }

  function touchesBuildingFloor(nav, cx, cy, bi) {
    const dx = [1, -1, 0, 0],
      dy = [0, 0, 1, -1];
    for (let side = 0; side < 4; side++) {
      const x = cx + dx[side],
        y = cy + dy[side];
      if (x < 0 || y < 0 || x >= nav.w || y >= nav.h) continue;
      const index = y * nav.w + x;
      if (nav.val[index] === 2 && B.cellBld[index] === bi) return true;
    }
    return false;
  }

  function doorTransition(nav, x, y, nx, ny, bi, access) {
    const ix = (x / CELL) | 0,
      iy = (y / CELL) | 0;
    let best = null,
      bestScore = -Infinity;
    for (let oy = -1; oy <= 1; oy++)
      for (let ox = -1; ox <= 1; ox++) {
        const cx = ix + ox,
          cy = iy + oy;
        if (cx < 0 || cy < 0 || cx >= nav.w || cy >= nav.h) continue;
        const doorIndex = cy * nav.w + cx;
        if (nav.val[doorIndex] !== 0 || !touchesBuildingFloor(nav, cx, cy, bi)) continue;
        const dx = [1, -1, 0, 0],
          dy = [0, 0, 1, -1];
        for (let side = 0; side < 4; side++) {
          const fx = cx + dx[side],
            fy = cy + dy[side];
          if (fx < 0 || fy < 0 || fx >= nav.w || fy >= nav.h) continue;
          const frontIndex = fy * nav.w + fx;
          if (nav.val[frontIndex] !== 1) continue;
          const alignment = dx[side] * nx + dy[side] * ny;
          if (alignment < -0.15) continue;
          const label = access ? access.labels[frontIndex] : -1,
            componentSize = label >= 0 ? access.sizes[label] : 0,
            roadCells = label >= 0 ? access.roads[label] : 0,
            score = (roadCells ? 1e9 : 0) + componentSize * 100 + alignment * 10000;
          if (score > bestScore) {
            bestScore = score;
            best = { doorIndex, frontIndex, componentSize, roadCells, accessId: label };
          }
        }
      }
    return best;
  }

  function snapDoorToPoly(door, points) {
    const n = polyN(points);
    if (n < 3) return;
    let best = 1e15,
      edge = -1,
      px = door.x,
      py = door.y,
      tx = 1,
      ty = 0;
    for (let i = 0; i < n; i++) {
      const a = points[i],
        b = points[(i + 1) % n],
        dx = b.x - a.x,
        dy = b.y - a.y,
        len2 = dx * dx + dy * dy || 1;
      let t = ((door.x - a.x) * dx + (door.y - a.y) * dy) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = a.x + dx * t,
        qy = a.y + dy * t,
        d = (qx - door.x) * (qx - door.x) + (qy - door.y) * (qy - door.y);
      if (d < best) {
        best = d;
        edge = i;
        px = qx;
        py = qy;
        const len = Math.sqrt(len2);
        tx = dx / len;
        ty = dy / len;
      }
    }
    let nx = -ty,
      ny = tx;
    if (pointInPoly(px + nx * 6, py + ny * 6, points)) {
      nx = -nx;
      ny = -ny;
    }
    door.x = px;
    door.y = py;
    door.tx = tx;
    door.ty = ty;
    door.nx = nx;
    door.ny = ny;
    door.edge = edge;
    door.hw = 5.6;
    door.ht = 2.5;
    door.face = faceFromNormal(nx, ny);
  }

  // OSM footprints: sit the leaf on the real facade, not the axis-aligned
  // stair-step the nav grid makes of a diagonal wall.
  function placeFootprintDoor(nav, points, bounds, bi, seed, access) {
    const n = polyN(points);
    if (n < 3) return null;
    let best = null,
      bestScore = -1;
    for (let i = 0; i < n; i++) {
      const a = points[i],
        b = points[(i + 1) % n],
        dx = b.x - a.x,
        dy = b.y - a.y,
        len = Math.hypot(dx, dy);
      if (len < 18) continue;
      const tx = dx / len,
        ty = dy / len;
      let nx = -ty,
        ny = tx;
      const mx = (a.x + b.x) * 0.5,
        my = (a.y + b.y) * 0.5;
      if (pointInPoly(mx + nx * 6, my + ny * 6, points)) {
        nx = -nx;
        ny = -ny;
      }
      if (!pointInPoly(mx - nx * 6, my - ny * 6, points)) continue;
      const margin = Math.min(0.42, (CELL + 4) / len),
        samples = Math.max(1, Math.ceil((len * (1 - margin * 2)) / CELL));
      for (let sample = 0; sample < samples; sample++) {
        const baseT = samples === 1 ? 0.5 : margin + ((1 - margin * 2) * sample) / (samples - 1),
          jitter = (ZS.hash(seed + i * 17.3 + sample * 9.1) - 0.5) * Math.min(0.12, 5 / len),
          t = ZS.clamp(baseT + jitter, margin, 1 - margin),
          x = a.x + dx * t,
          y = a.y + dy * t,
          transition = doorTransition(nav, x, y, nx, ny, bi, access);
        if (!transition) continue;
        const fi = transition.frontIndex,
          componentSize = transition.componentSize,
          roadCells = transition.roadCells,
          clearance = doorClearance(nav, x, y, tx, ty, nx, ny),
          score = (roadCells ? 1e9 : 0) + componentSize * 100 + clearance * 1000 + len;
        if (score > bestScore) {
          bestScore = score;
          best = {
            i,
            len,
            tx,
            ty,
            nx,
            ny,
            fi,
            x,
            y,
            doorIndex: transition.doorIndex,
            accessId: transition.accessId,
          };
        }
      }
    }
    if (!best) return null;
    const hw = ZS.clamp(best.len * 0.13, 4.2, 6.4),
      ht = hw * 0.44,
      x = best.x,
      y = best.y,
      cells = [best.doorIndex];
    nav.val[best.doorIndex] = 3;
    B.doorBld[best.doorIndex] = bi;
    const f = best.fi;
    B.doorBld[f] = bi;
    const face = faceFromNormal(best.nx, best.ny),
      inner = deepestFloor(
        nav,
        bounds.x0,
        bounds.y0,
        bounds.x1 - bounds.x0,
        bounds.y1 - bounds.y0,
        bi,
        x,
        y,
        face,
        best.doorIndex,
      );
    return {
      x,
      y,
      w: CELL,
      face,
      tx: best.tx,
      ty: best.ty,
      nx: best.nx,
      ny: best.ny,
      hw,
      ht,
      edge: best.i,
      hp: DOOR_HP,
      maxHp: DOOR_HP,
      broken: false,
      shake: 0,
      cells,
      front: nav.centerOf(f),
      frontIdx: f,
      accessId: best.accessId,
      inner,
    };
  }

  function doorClearance(nav, x, y, tx, ty, nx, ny) {
    let clear = 0;
    for (let depth = 1; depth <= 3; depth++)
      for (let side = -1; side <= 1; side++) {
        const index = nav.idx(
          x + nx * CELL * (depth + 0.25) + tx * CELL * side,
          y + ny * CELL * (depth + 0.25) + ty * CELL * side,
        );
        if (index >= 0 && nav.val[index] === 1) clear++;
      }
    return clear;
  }

  function deepestFloor(nav, wx, wy, bw, bh, bi, cx, cy, face, doorIndex) {
    const ix0 = Math.max(0, (wx / CELL) | 0),
      iy0 = Math.max(0, (wy / CELL) | 0),
      ix1 = Math.min(nav.w - 1, ((wx + bw) / CELL) | 0),
      iy1 = Math.min(nav.h - 1, ((wy + bh) / CELL) | 0),
      localW = ix1 - ix0 + 1,
      localH = iy1 - iy0 + 1,
      depth = new Int16Array(localW * localH),
      queue = new Int32Array(localW * localH);
    depth.fill(-1);
    let qn = 0,
      bestCell = -1,
      bestDepth = -1;
    const startX = doorIndex >= 0 ? doorIndex % nav.w : (cx / CELL) | 0,
      startY = doorIndex >= 0 ? (doorIndex / nav.w) | 0 : (cy / CELL) | 0,
      dx = [1, -1, 0, 0],
      dy = [0, 0, 1, -1];
    for (let side = 0; side < 4; side++) {
      const x = startX + dx[side],
        y = startY + dy[side];
      if (x < ix0 || y < iy0 || x > ix1 || y > iy1) continue;
      const index = y * nav.w + x;
      if (nav.val[index] !== 2 || B.cellBld[index] !== bi) continue;
      const local = (y - iy0) * localW + (x - ix0);
      depth[local] = 0;
      queue[qn++] = index;
      bestCell = index;
    }
    let qi = 0;
    while (qi < qn) {
      const index = queue[qi++],
        x = index % nav.w,
        y = (index / nav.w) | 0,
        local = (y - iy0) * localW + (x - ix0),
        nextDepth = depth[local] + 1;
      if (depth[local] > bestDepth) {
        bestDepth = depth[local];
        bestCell = index;
      }
      if (x > ix0)
        qn = visitFloor(nav, depth, queue, qn, x - 1, y, ix0, iy0, localW, bi, nextDepth);
      if (x < ix1)
        qn = visitFloor(nav, depth, queue, qn, x + 1, y, ix0, iy0, localW, bi, nextDepth);
      if (y > iy0)
        qn = visitFloor(nav, depth, queue, qn, x, y - 1, ix0, iy0, localW, bi, nextDepth);
      if (y < iy1)
        qn = visitFloor(nav, depth, queue, qn, x, y + 1, ix0, iy0, localW, bi, nextDepth);
    }
    if (bestCell >= 0) return nav.centerOf(bestCell);
    return {
      x: cx + (face === "e" ? -2 * CELL : face === "w" ? 2 * CELL : 0),
      y: cy + (face === "s" ? -2 * CELL : face === "n" ? 2 * CELL : 0),
    };
  }

  function visitFloor(nav, depth, queue, qn, x, y, ix0, iy0, localW, bi, nextDepth) {
    const local = (y - iy0) * localW + (x - ix0);
    if (depth[local] >= 0) return qn;
    const index = y * nav.w + x;
    if (nav.val[index] !== 2 || B.cellBld[index] !== bi) return qn;
    depth[local] = nextDepth;
    queue[qn] = index;
    return qn + 1;
  }

  function shrinkPoly(points, pad) {
    const n = polyN(points);
    if (n < 3) return null;
    let cx = 0,
      cy = 0;
    for (let i = 0; i < n; i++) {
      cx += points[i].x;
      cy += points[i].y;
    }
    cx /= n;
    cy /= n;
    const out = [];
    for (let i = 0; i < n; i++) {
      const p = points[i],
        dx = p.x - cx,
        dy = p.y - cy,
        d = Math.hypot(dx, dy) || 1,
        s = Math.max(0.58, (d - pad) / d);
      out.push({ x: cx + dx * s, y: cy + dy * s });
    }
    return out;
  }

  function edgeOutward(a, b, points) {
    const dx = b.x - a.x,
      dy = b.y - a.y,
      l = Math.hypot(dx, dy) || 1;
    let nx = -dy / l,
      ny = dx / l;
    if (pointInPoly((a.x + b.x) * 0.5 + nx * 4, (a.y + b.y) * 0.5 + ny * 4, points)) {
      nx = -nx;
      ny = -ny;
    }
    return { nx, ny };
  }

  function outsetPoly(points, pad) {
    const n = polyN(points);
    if (n < 3) return null;
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = points[(i - 1 + n) % n],
        b = points[i],
        c = points[(i + 1) % n],
        n1 = edgeOutward(a, b, points),
        n2 = edgeOutward(b, c, points);
      let nx = n1.nx + n2.nx,
        ny = n1.ny + n2.ny;
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl;
      ny /= nl;
      const miter = Math.max(0.4, n1.nx * nx + n1.ny * ny);
      out.push({ x: b.x + (nx * pad) / miter, y: b.y + (ny * pad) / miter });
    }
    return out;
  }

  function roofLines(points) {
    const n = polyN(points);
    if (n < 3) return { hatches: null, ridge: null };
    let cx = 0,
      cy = 0;
    for (let i = 0; i < n; i++) {
      cx += points[i].x;
      cy += points[i].y;
    }
    cx /= n;
    cy /= n;
    let best = 0,
      tx = 1,
      ty = 0;
    for (let i = 0; i < n; i++) {
      const a = points[i],
        b = points[(i + 1) % n],
        dx = b.x - a.x,
        dy = b.y - a.y,
        L = dx * dx + dy * dy;
      if (L > best) {
        best = L;
        tx = dx;
        ty = dy;
      }
    }
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    const nx = -ty,
      ny = tx,
      span = Math.sqrt(best),
      ridgeSpan = span * 0.36,
      hatches = [],
      count = span > 90 ? 4 : span > 48 ? 3 : span > 26 ? 2 : 0,
      spread = Math.min(13, span * 0.1),
      hSpan = span * 0.26;
    for (let i = 0; i < count; i++) {
      const o = (i - (count - 1) / 2) * spread;
      if (Math.abs(o) < 1.6) continue;
      hatches.push({
        x1: cx + nx * o - tx * hSpan,
        y1: cy + ny * o - ty * hSpan,
        x2: cx + nx * o + tx * hSpan,
        y2: cy + ny * o + ty * hSpan,
      });
    }
    return {
      hatches: hatches.length ? hatches : null,
      ridge: {
        x1: cx - tx * ridgeSpan,
        y1: cy - ty * ridgeSpan,
        x2: cx + tx * ridgeSpan,
        y2: cy + ty * ridgeSpan,
      },
    };
  }

  function placeFootprintWindows(points, door) {
    const n = polyN(points),
      out = [],
      doorEdge = door && door.edge >= 0 ? door.edge : -1;
    for (let i = 0; i < n && out.length < 10; i++) {
      if (i === doorEdge) continue;
      const a = points[i],
        b = points[(i + 1) % n],
        dx = b.x - a.x,
        dy = b.y - a.y,
        len = Math.hypot(dx, dy);
      if (len < 26) continue;
      const tx = dx / len,
        ty = dy / len,
        nx = -ty,
        ny = tx,
        count = Math.min(3, Math.max(1, (len / 40) | 0));
      for (let k = 0; k < count && out.length < 10; k++) {
        const t = (k + 1) / (count + 1),
          x = a.x + dx * t,
          y = a.y + dy * t;
        if (door && (x - door.x) * (x - door.x) + (y - door.y) * (y - door.y) < 220) continue;
        out.push({ x, y, tx, ty, nx, ny, hw: 2.7, ht: 1.55 });
      }
    }
    return out.length ? out : null;
  }

  function placeRunWindows(runs, door) {
    const out = [];
    for (let i = 0; i < runs.length && out.length < 8; i++) {
      const r = runs[i],
        dx = r.x2 - r.x1,
        dy = r.y2 - r.y1,
        len = Math.hypot(dx, dy);
      if (len < 56) continue;
      const tx = dx / len,
        ty = dy / len,
        ax = doorAxes(r.side),
        count = Math.min(3, Math.max(1, (len / 72) | 0));
      for (let k = 0; k < count && out.length < 8; k++) {
        const t = (k + 1) / (count + 1),
          x = r.x1 + dx * t,
          y = r.y1 + dy * t;
        if (door && (x - door.x) * (x - door.x) + (y - door.y) * (y - door.y) < 900) continue;
        out.push({ x, y, tx, ty, nx: ax.nx, ny: ax.ny, hw: 4, ht: 2.3 });
      }
    }
    return out.length ? out : null;
  }

  function dressBuilding(b) {
    b.inner = null;
    b.hatches = null;
    b.ridge = null;
    b.windows = null;
    b.halo = null;
    if (b.footprint && b.footprint.length >= 3) {
      b.inner = shrinkPoly(b.footprint, ZS.clamp(Math.min(b.w, b.h) * 0.07, 3, 6.5));
      b.halo = outsetPoly(b.footprint, 6);
      const roof = roofLines(b.footprint);
      b.hatches = roof.hatches;
      b.ridge = roof.ridge;
      b.windows = placeFootprintWindows(b.footprint, b.door);
    } else if (b.runs) b.windows = placeRunWindows(b.runs, b.door);
  }

  // one entry door: longest qualifying run, DOOR_W cells in its middle
  function placeDoor(nav, wx, wy, bw, bh, bi, fastInner, access) {
    const runs = wallRuns(nav, wx, wy, bw, bh);
    let best = null,
      bestScore = -1;
    for (const r of runs) {
      if (r.cells.length < DOOR_W + 1) continue;
      // the front (exterior) cell beside the door's middle must be open land
      const mid = r.cells[(r.cells.length - DOOR_W) >> 1];
      const f = frontOf(nav, r, mid);
      if (f < 0 || nav.val[f] !== 1) continue;
      const label = access ? access.labels[f] : -1,
        componentSize = label >= 0 ? access.sizes[label] : 0,
        roadCells = label >= 0 ? access.roads[label] : 0,
        score = access
          ? (roadCells ? 1e9 : 0) + componentSize * 100 + r.cells.length
          : r.cells.length;
      if (score > bestScore) {
        bestScore = score;
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
    if (fastInner) {
      const ix0 = Math.max(0, (wx / CELL) | 0),
        iy0 = Math.max(0, (wy / CELL) | 0),
        ix1 = Math.min(nav.w - 1, ((wx + bw) / CELL) | 0),
        iy1 = Math.min(nav.h - 1, ((wy + bh) / CELL) | 0);
      for (let sy = iy0; sy <= iy1; sy++)
        for (let sx = ix0; sx <= ix1; sx++) {
          const index = sy * nav.w + sx;
          if (nav.val[index] !== 2 || B.cellBld[index] !== bi) continue;
          const point = nav.centerOf(index),
            distance = (point.x - cx) * (point.x - cx) + (point.y - cy) * (point.y - cy);
          if (distance > bestDepth) {
            bestDepth = distance;
            bestCell = index;
          }
        }
    } else {
      // The flood only needs the footprint and its one-cell wall ring. A
      // world-sized depth buffer per building caused hundreds of megabytes
      // of temporary writes on large Zone maps.
      const ix0 = Math.max(0, ((wx - CELL * 2) / CELL) | 0),
        iy0 = Math.max(0, ((wy - CELL * 2) / CELL) | 0),
        ix1 = Math.min(nav.w - 1, ((wx + bw + CELL * 2) / CELL) | 0),
        iy1 = Math.min(nav.h - 1, ((wy + bh + CELL * 2) / CELL) | 0),
        localW = ix1 - ix0 + 1,
        localH = iy1 - iy0 + 1,
        depth = new Int16Array(localW * localH);
      depth.fill(-1);
      const q = new Int32Array(localW * localH);
      let qn = 0;
      for (const i of cells) {
        const sx = (i % nav.w) - ix0,
          sy = ((i / nav.w) | 0) - iy0;
        if (sx < 0 || sy < 0 || sx >= localW || sy >= localH) continue;
        const local = sy * localW + sx;
        depth[local] = 0;
        q[qn++] = i;
      }
      let qi = 0;
      while (qi < qn) {
        const i = q[qi++];
        const d0 = i % nav.w,
          d1 = (i / nav.w) | 0,
          localI = (d1 - iy0) * localW + (d0 - ix0);
        for (let oy = -1; oy <= 1; oy++)
          for (let ox = -1; ox <= 1; ox++) {
            if (!ox && !oy) continue;
            const nx = d0 + ox,
              ny = d1 + oy;
            if (nx < ix0 || ny < iy0 || nx > ix1 || ny > iy1) continue;
            const local = (ny - iy0) * localW + (nx - ix0);
            if (depth[local] >= 0) continue;
            const j = ny * nav.w + nx;
            const v = nav.val[j];
            if (v !== 2 && v !== 3) continue;
            depth[local] = depth[localI] + 1;
            if (v === 2 && depth[local] > bestDepth) {
              bestDepth = depth[local];
              bestCell = j;
            }
            q[qn++] = j;
          }
      }
    }
    const inner =
      bestCell >= 0
        ? nav.centerOf(bestCell)
        : {
            x: cx + (r.side === "e" ? -2 * CELL : r.side === "w" ? 2 * CELL : 0),
            y: cy + (r.side === "s" ? -2 * CELL : r.side === "n" ? 2 * CELL : 0),
          };
    const ax = doorAxes(r.side);
    return {
      x: cx,
      y: cy,
      w: DOOR_W * CELL,
      face: r.side,
      tx: ax.tx,
      ty: ax.ty,
      nx: ax.nx,
      ny: ax.ny,
      hw: 19,
      ht: 9,
      edge: -1,
      hp: DOOR_HP,
      maxHp: DOOR_HP,
      broken: false,
      shake: 0,
      cells,
      front: nav.centerOf(f),
      frontIdx: f,
      accessId: access ? access.labels[f] : -1,
      inner,
    };
  }

  function footprintEscape(building, door) {
    const from = door
      ? door.front
      : { x: building.x + building.w / 2, y: building.y + building.h / 2 };
    let best = null,
      distance = -1;
    for (let i = 0; i < building.footprint.length; i++) {
      const point = building.footprint[i],
        dx = point.x - from.x,
        dy = point.y - from.y,
        d = dx * dx + dy * dy;
      if (d > distance) {
        distance = d;
        best = point;
      }
    }
    if (!best) return { x: building.x + building.w / 2, y: building.y + building.h / 2 };
    const cx = building.x + building.w / 2,
      cy = building.y + building.h / 2;
    return { x: best.x * 0.82 + cx * 0.18, y: best.y * 0.82 + cy * 0.18 };
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

  // Remove one building from the navigation mask without renumbering the
  // shared building list. Zone save data and orders use those stable indexes.
  // Wall cells are released only when they belonged to this footprint and do
  // not still border another building, so adjoining OSM buildings stay solid.
  function demolish(building, nav) {
    const bi = B.list.indexOf(building);
    if (bi < 0 || !nav || !B.cellBld || !B.doorBld) return false;
    const ix0 = Math.max(0, ((building.x - CELL) / CELL) | 0),
      iy0 = Math.max(0, ((building.y - CELL) / CELL) | 0),
      ix1 = Math.min(nav.w - 1, ((building.x + building.w + CELL) / CELL) | 0),
      iy1 = Math.min(nav.h - 1, ((building.y + building.h + CELL) / CELL) | 0),
      walls = [];
    for (let iy = iy0; iy <= iy1; iy++)
      for (let ix = ix0; ix <= ix1; ix++) {
        const index = iy * nav.w + ix;
        if (nav.val[index] !== 0 || (nav.wm && nav.wm[index])) continue;
        let owned = false;
        for (let dy = -1; dy <= 1 && !owned; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const x = ix + dx,
              y = iy + dy;
            if (x < 0 || y < 0 || x >= nav.w || y >= nav.h) continue;
            if (B.cellBld[y * nav.w + x] === bi) {
              owned = true;
              break;
            }
          }
        if (owned) walls.push(index);
      }
    for (let iy = iy0; iy <= iy1; iy++)
      for (let ix = ix0; ix <= ix1; ix++) {
        const index = iy * nav.w + ix;
        if (B.cellBld[index] === bi) {
          B.cellBld[index] = -1;
          if (nav.val[index] === 2) nav.val[index] = 1;
        }
        if (B.doorBld[index] === bi) {
          B.doorBld[index] = -1;
          if (!nav.wm || !nav.wm[index]) nav.val[index] = 1;
        }
      }
    for (let i = 0; i < walls.length; i++) {
      const index = walls[i],
        ix = index % nav.w,
        iy = (index / nav.w) | 0;
      let shared = false;
      for (let dy = -1; dy <= 1 && !shared; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const x = ix + dx,
            y = iy + dy;
          if (x < 0 || y < 0 || x >= nav.w || y >= nav.h) continue;
          if (B.cellBld[y * nav.w + x] >= 0) {
            shared = true;
            break;
          }
        }
      if (!shared) nav.val[index] = 1;
    }
    nav.version++;
    return true;
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
