/* Navigation: a configurable cell grid over the whole world (20px by
   default, 10px for dense geographic Zone maps).
   Cell values: 0 = blocked (water, wall), 1 = land, 2 = building floor,
   3 = intact door. Interiors and intact doors block zombies but not
   humans; a broken door becomes plain land (nav.doorBroken). astar() and
   los() are the only geometry agents use for movement, so water and walls
   are a hard block — no agent can ever end up inside them, no matter how
   fast they run. Scenarios that set `swim` (zombie.js) treat water as a
   soft block instead: astar() treats water cells as passable at 4x cost
   (it swims only when the swim beats the detour), los() sees across it,
   and the core caps in-water speed (SWIM_FRAC in agents.js). */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});

  const DEFAULT_CELL = 20;
  const DIRS = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, 1.41421],
    [1, -1, 1.41421],
    [-1, 1, 1.41421],
    [-1, -1, 1.41421],
  ];

  function pointInPoly(x, y, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x,
        yi = pts[i].y,
        xj = pts[j].x,
        yj = pts[j].y;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  class Nav {
    constructor(world, cellSize) {
      this.world = world;
      this.cell = Math.max(8, Number(cellSize) || DEFAULT_CELL);
      this.w = Math.ceil(world.w / this.cell);
      this.h = Math.ceil(world.h / this.cell);
      this.n = this.w * this.h;
      this.val = new Uint8Array(this.n);
      this.val.fill(1); // land until proven otherwise
      this.wm = new Uint8Array(this.n); // 1 = water cell (river/lake/pond)
      this.cost = new Float32Array(this.n);
      this.cost.fill(1);
      this.road = new Uint8Array(this.n);
      this.height = null;
      // persistent A* work arrays, stamped per search (no per-call alloc)
      this.g = new Float32Array(this.n);
      this.fs = new Float32Array(this.n);
      this.from = new Int32Array(this.n);
      this.stamp = new Int32Array(this.n);
      this.heapF = [];
      this.heapI = [];
      this.pathScratch = [];
      this.gen = 0;
      this.version = 0; // bumped when a door breaks; agents replan on change
    }

    idx(x, y) {
      const ix = (x / this.cell) | 0,
        iy = (y / this.cell) | 0;
      if (ix < 0 || iy < 0 || ix >= this.w || iy >= this.h) return -1;
      return iy * this.w + ix;
    }

    cellAt(x, y) {
      const i = this.idx(x, y);
      return i < 0 ? 0 : this.val[i];
    }

    // floors (2) and intact doors (3) pass humans only: a zombie inside
    // (via a broken door) can still path back out, but nothing can cross
    // a wall or an intact door
    isWalkable(x, y, isZombie) {
      const i = this.idx(x, y);
      if (i < 0) return false;
      const v = this.val[i];
      if (v === 3 || v === 2) return !isZombie;
      return v >= 1;
    }

    // water test: a blocked cell that is river/lake/pond water. Walls are
    // blocked too but not water; door-front cells carved in the river are
    // plain land again (val 1), so they read as land, not water
    isWater(x, y) {
      const i = this.idx(x, y);
      return i >= 0 && this.val[i] === 0 && this.wm[i] === 1;
    }
    centerOf(i) {
      return {
        x: ((i % this.w) + 0.5) * this.cell,
        y: (((i / this.w) | 0) + 0.5) * this.cell,
      };
    }

    // mark a world rect's cells (cell centers inside the rect)
    markRect(x, y, w, h, v, onlyIf) {
      const cell = this.cell,
        ix0 = Math.max(0, (x / cell) | 0),
        iy0 = Math.max(0, (y / cell) | 0),
        ix1 = Math.min(this.w - 1, ((x + w) / cell) | 0),
        iy1 = Math.min(this.h - 1, ((y + h) / cell) | 0);
      for (let iy = iy0; iy <= iy1; iy++)
        for (let ix = ix0; ix <= ix1; ix++) {
          const cx = (ix + 0.5) * cell,
            cy = (iy + 0.5) * cell;
          if (cx < x || cx >= x + w || cy < y || cy >= y + h) continue;
          const i = iy * this.w + ix;
          if (onlyIf === undefined || this.val[i] === onlyIf) this.val[i] = v;
        }
    }

    markPolygon(points, value, water) {
      if (!Array.isArray(points) || points.length < 3) return;
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
      for (let i = 0; i < points.length; i++) {
        x0 = Math.min(x0, points[i].x);
        y0 = Math.min(y0, points[i].y);
        x1 = Math.max(x1, points[i].x);
        y1 = Math.max(y1, points[i].y);
      }
      const cell = this.cell,
        ix0 = Math.max(0, (x0 / cell) | 0),
        iy0 = Math.max(0, (y0 / cell) | 0),
        ix1 = Math.min(this.w - 1, (x1 / cell) | 0),
        iy1 = Math.min(this.h - 1, (y1 / cell) | 0);
      for (let iy = iy0; iy <= iy1; iy++)
        for (let ix = ix0; ix <= ix1; ix++) {
          const x = (ix + 0.5) * cell,
            y = (iy + 0.5) * cell;
          if (!pointInPoly(x, y, points)) continue;
          const index = iy * this.w + ix;
          this.val[index] = value;
          if (water) this.wm[index] = 1;
        }
    }

    markRoad(points, width) {
      if (!Array.isArray(points) || points.length < 2) return;
      const cell = this.cell,
        radius = Math.max(cell * 0.5, width * 0.5),
        radiusCells = Math.max(1, Math.ceil(radius / cell));
      for (let p = 1; p < points.length; p++) {
        const a = points[p - 1],
          b = points[p],
          distance = Math.hypot(b.x - a.x, b.y - a.y),
          steps = Math.max(1, Math.ceil(distance / (cell * 0.5)));
        for (let step = 0; step <= steps; step++) {
          const t = step / steps,
            ix = ((a.x + (b.x - a.x) * t) / cell) | 0,
            iy = ((a.y + (b.y - a.y) * t) / cell) | 0;
          for (let oy = -radiusCells; oy <= radiusCells; oy++)
            for (let ox = -radiusCells; ox <= radiusCells; ox++) {
              const nx = ix + ox,
                ny = iy + oy;
              if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) continue;
              const index = ny * this.w + nx;
              if (this.val[index] === 1) {
                this.road[index] = 1;
                this.cost[index] = Math.max(1, this.cost[index] - 0.18);
              }
            }
        }
      }
    }

    applyElevation(elevation) {
      if (
        !elevation ||
        !Array.isArray(elevation.values) ||
        elevation.cols < 2 ||
        elevation.rows < 2
      )
        return;
      const cols = elevation.cols,
        rows = elevation.rows,
        values = elevation.values,
        heights = new Float32Array(this.n);
      for (let iy = 0; iy < this.h; iy++)
        for (let ix = 0; ix < this.w; ix++) {
          const gx = (ix / Math.max(1, this.w - 1)) * (cols - 1),
            gy = (iy / Math.max(1, this.h - 1)) * (rows - 1),
            x0 = Math.floor(gx),
            y0 = Math.floor(gy),
            x1 = Math.min(cols - 1, x0 + 1),
            y1 = Math.min(rows - 1, y0 + 1),
            tx = gx - x0,
            ty = gy - y0,
            top = values[y0 * cols + x0] * (1 - tx) + values[y0 * cols + x1] * tx,
            bottom = values[y1 * cols + x0] * (1 - tx) + values[y1 * cols + x1] * tx;
          heights[iy * this.w + ix] = top * (1 - ty) + bottom * ty;
        }
      this.height = heights;
      for (let iy = 0; iy < this.h; iy++)
        for (let ix = 0; ix < this.w; ix++) {
          const index = iy * this.w + ix,
            left = ix > 0 ? Math.abs(heights[index] - heights[index - 1]) : 0,
            up = iy > 0 ? Math.abs(heights[index] - heights[index - this.w]) : 0;
          this.cost[index] = 1.12 + Math.min(1.8, Math.max(left, up) / 3);
        }
      this.version++;
    }

    elevationAt(x, y) {
      const index = this.idx(x, y);
      return index >= 0 && this.height ? this.height[index] : 0;
    }

    speedFactor(x, y) {
      const index = this.idx(x, y);
      if (index < 0) return 1;
      const cost = this.cost[index];
      if (cost > 1.8) return 0.78;
      if (cost > 1.35) return 0.9;
      return this.road[index] ? 1.18 : 1;
    }

    // water from the world's river/lake/pond polygons (matches the
    // drawing exactly); ponds are optional smaller lakes (world.ponds)
    markWater() {
      const river = this.world.river.pts,
        lake = this.world.lake.pts,
        ponds = this.world.ponds || [];
      this.markPolygon(river, 0, true);
      this.markPolygon(lake, 0, true);
      for (let i = 0; i < ponds.length; i++) this.markPolygon(ponds[i].pts, 0, true);
    }

    // clear straight-line travel (cell-by-cell) between two world points;
    // swim-capable callers see across water
    los(x1, y1, x2, y2, isZombie, swim) {
      const dx = x2 - x1,
        dy = y2 - y1;
      const d = Math.hypot(dx, dy);
      if (d < 2) return true;
      const steps = Math.max(2, (d / 8) | 0);
      for (let i = 1; i < steps; i++) {
        const px = x1 + (dx * i) / steps,
          py = y1 + (dy * i) / steps;
        if (!this.isWalkable(px, py, isZombie) && !(swim && this.isWater(px, py))) return false;
      }
      // the endpoint: whatever stands there is reachable through whatever
      // the ray passed — a human-walkable point (floor, door, land) is
      // sightable from every side (the ray's intermediate cells carry the
      // side's own mask; the side's agent is clamped to its own cells)
      return this.isWalkable(x2, y2, false) || (swim && this.isWater(x2, y2));
    }

    /* 8-directional A* with an octile heuristic and a binary heap.
       Diagonal moves never cut corners. Returns a simplified path as an
       array of world-space {x,y} waypoints (start excluded) or null when
       the target is unreachable. swim: water cells become passable at
       4x cost — the swim is only taken when it beats the detour. Dense
       geographic maps use a mild weighted heuristic so long city routes
       resolve promptly; the classic grid keeps the optimal heuristic. */
    astar(x1, y1, x2, y2, isZombie, maxExpand, swim) {
      const si = this.idx(x1, y1),
        ti = this.idx(x2, y2);
      if (si < 0 || ti < 0 || si === ti) return null;
      // a zombie already inside a building (start on a floor cell) may roam
      // that interior and out through broken doors; a zombie outside can
      // never path into floors, and no zombie crosses an intact door
      const inB = isZombie && this.val[si] === 2;
      const tw = swim && this.val[ti] === 0 && this.wm[ti] === 1; // water target
      if (!this.isWalkable(x2, y2, isZombie) && !tw && !(inB && this.val[ti] === 2)) return null;

      this.gen++;
      const gen = this.gen,
        g = this.g,
        fs = this.fs,
        from = this.from,
        stamp = this.stamp,
        val = this.val,
        wm = this.wm,
        cost = this.cost,
        w = this.w,
        H = this.h;
      const tix = ti % w,
        tiy = (ti / w) | 0,
        heuristicWeight = this.cell < DEFAULT_CELL ? 1.35 : 1;
      const h = (i) => {
        const dx = Math.abs((i % w) - tix),
          dy = Math.abs(((i / w) | 0) - tiy);
        return dx > dy ? 1.41421 * dy + (dx - dy) : 1.41421 * dx + (dy - dx);
      };
      const free = (v, ni) =>
        v === 1 ||
        (v >= 2 && (!isZombie || inB) && !(v === 3 && isZombie)) ||
        (swim && v === 0 && wm[ni] === 1);

      // Parallel reusable arrays avoid allocating one [f, i] pair for every
      // discovered node. Stale entries are still skipped on pop.
      const heapF = this.heapF,
        heapI = this.heapI;
      let heapN = 0;
      const push = (f, i) => {
        let c = heapN++;
        while (c > 0) {
          const p = (c - 1) >> 1;
          if (heapF[p] <= f) break;
          heapF[c] = heapF[p];
          heapI[c] = heapI[p];
          c = p;
        }
        heapF[c] = f;
        heapI[c] = i;
      };

      stamp[si] = gen;
      g[si] = 0;
      fs[si] = h(si) * heuristicWeight;
      push(fs[si], si);
      let expanded = 0;

      // Preserve roughly the same searchable world area when a dense map
      // uses cells smaller than the classic 20px grid.
      const scaledBudget = Math.round(12000 * (DEFAULT_CELL / this.cell) ** 2),
        budget = maxExpand || Math.min(this.n, scaledBudget);
      while (heapN) {
        const curF = heapF[0],
          i = heapI[0];
        heapN--;
        if (heapN > 0) {
          const lastF = heapF[heapN],
            lastI = heapI[heapN];
          let p = 0;
          for (;;) {
            const l = p * 2 + 1;
            if (l >= heapN) break;
            const r = l + 1,
              m = r < heapN && heapF[r] < heapF[l] ? r : l;
            if (heapF[m] >= lastF) break;
            heapF[p] = heapF[m];
            heapI[p] = heapI[m];
            p = m;
          }
          heapF[p] = lastF;
          heapI[p] = lastI;
        }
        if (stamp[i] !== gen || curF > fs[i] + 1e-4) continue;
        if (i === ti) break;
        if (++expanded > budget) return null;
        const ix = i % w,
          iy = (i / w) | 0;
        for (let d = 0; d < 8; d++) {
          const dx = DIRS[d][0],
            dy = DIRS[d][1];
          const nx = ix + dx,
            ny = iy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= H) continue;
          const ni = ny * w + nx;
          const v = val[ni];
          if (!free(v, ni)) continue;
          if (dx && dy) {
            // no corner cutting: both orthogonal neighbors must be open
            if (!free(val[iy * w + nx], iy * w + nx) || !free(val[ny * w + ix], ny * w + ix))
              continue;
          }
          const ng =
            g[i] + DIRS[d][2] * (swim && v === 0 && wm[ni] === 1 ? 4 : Math.max(1, cost[ni]));
          if (stamp[ni] === gen && ng >= g[ni]) continue;
          stamp[ni] = gen;
          g[ni] = ng;
          from[ni] = i;
          fs[ni] = ng + h(ni) * heuristicWeight;
          push(fs[ni], ni);
        }
      }

      if (stamp[ti] !== gen) return null;

      // walk back, drop collinear points, map to world coords
      const raw = this.pathScratch;
      raw.length = 0;
      let i = ti;
      while (i !== si) {
        raw.push(i);
        i = from[i];
        if (raw.length > 4000) return null; // loop guard (should be impossible)
      }
      raw.reverse();
      const kept = [raw[0]];
      for (let k = 1; k < raw.length - 1; k++) {
        const ax = (raw[k - 1] % w) - (raw[k] % w),
          ay = ((raw[k - 1] / w) | 0) - ((raw[k] / w) | 0);
        const bx = (raw[k] % w) - (raw[k + 1] % w),
          by = ((raw[k] / w) | 0) - ((raw[k + 1] / w) | 0);
        if (ax !== bx || ay !== by) kept.push(raw[k]);
      }
      kept.push(raw[raw.length - 1]);
      return kept.map((ci) => this.centerOf(ci));
    }

    // first walkable point within maxR of (x, y), spiral search
    nearestWalkable(x, y, maxR, isZombie) {
      if (this.isWalkable(x, y, isZombie)) return { x, y };
      for (let r = 10; r <= maxR; r += 10) {
        const n = Math.max(10, (r * 0.7) | 0);
        for (let k = 0; k < n; k++) {
          const an = (k / n) * Math.PI * 2 + r * 0.35;
          const px = x + Math.cos(an) * r,
            py = y + Math.sin(an) * r;
          const i = this.idx(px, py);
          if (i >= 0 && this.isWalkable(px, py, isZombie)) return this.centerOf(i);
        }
      }
      return null;
    }

    // random open-land point (never floor, water or walls)
    randLand() {
      for (let i = 0; i < 300; i++) {
        const x = 30 + Math.random() * (this.world.w - 60);
        const y = 30 + Math.random() * (this.world.h - 60);
        const idx = this.idx(x, y);
        if (idx >= 0 && this.val[idx] === 1) return this.centerOf(idx);
      }
      for (let i = 0; i < this.n; i++) if (this.val[i] === 1) return this.centerOf(i);
      return { x: this.world.w / 2, y: this.world.h / 2 };
    }
  }

  ZS.Nav = Nav;
})();
