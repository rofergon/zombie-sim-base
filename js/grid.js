/* Spatial hash grid: cheap neighbor queries so ~900 agents never do O(n^2).
   Rebuild once per frame (clear + insert), then query around each agent. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});

  class Grid {
    constructor(cell) {
      this.cell = cell;
      this.cells = new Map();
      this.active = [];
    }

    clear() {
      for (let i = 0; i < this.active.length; i++) this.active[i].length = 0;
      this.active.length = 0;
    }

    // world spans a few hundred cells at most; offset columns stay unique
    key(ix, iy) {
      return ix * 4096 + iy;
    }

    insert(a) {
      const k = this.key((a.x / this.cell) | 0, (a.y / this.cell) | 0);
      const arr = this.cells.get(k);
      if (arr) {
        if (arr.length === 0) this.active.push(arr);
        arr.push(a);
      } else {
        const bucket = [a];
        this.cells.set(k, bucket);
        this.active.push(bucket);
      }
    }

    query(x, y, r, fn) {
      const c = this.cell;
      const x0 = ((x - r) / c) | 0,
        x1 = ((x + r) / c) | 0;
      const y0 = ((y - r) / c) | 0,
        y1 = ((y + r) / c) | 0;
      for (let ix = x0; ix <= x1; ix++) {
        for (let iy = y0; iy <= y1; iy++) {
          const arr = this.cells.get(this.key(ix, iy));
          if (!arr) continue;
          for (let i = 0; i < arr.length; i++) fn(arr[i]);
        }
      }
    }
  }

  ZS.Grid = Grid;
})();
