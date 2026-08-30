/* Persistent battlefield damage: a generic stamp layer. Splats and
   corpses are painted once onto an offscreen canvas and drawn every frame
   as a single image. WHAT gets stamped is the scenario's call — it
   registers painters: st.register(kind, (sc, x, y, seed) => ...), and
   st.register("corpse", (sc, agent) => ...). */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});

  class Stains {
    constructor(world) {
      this.world = world;
      this.chunked = Boolean(world.chunked);
      this.size = world.chunkSize || 1024;
      this.chunks = new Map();
      this.cv = document.createElement("canvas");
      this.cv.width = this.chunked ? 1 : world.w;
      this.cv.height = this.chunked ? 1 : world.h;
      this.c = this.cv.getContext("2d");
      this.p = {};
    }

    draw(c, visible) {
      if (!this.chunked) {
        c.drawImage(this.cv, 0, 0, this.cv.width, this.cv.height);
        return;
      }
      for (const record of this.chunks.values()) {
        if (
          visible &&
          (record.x + record.w < visible.x0 ||
            record.x > visible.x1 ||
            record.y + record.h < visible.y0 ||
            record.y > visible.y1)
        )
          continue;
        c.drawImage(record.canvas, record.x, record.y, record.w, record.h);
      }
    }

    register(kind, painter) {
      this.p[kind] = painter;
    }

    splat(x, y, kind, seed) {
      const f = this.p[kind];
      if (!f) return;
      if (this.chunked) {
        this._paintChunks(x, y, 72, (context) => f(context, x, y, seed, this));
        return;
      }
      const sc = this.c;
      sc.save();
      f(sc, x, y, seed, this);
      sc.restore();
    }

    corpse(a) {
      const f = this.p.corpse;
      if (!f) return;
      if (this.chunked) {
        this._paintChunks(a.x, a.y, 72, (context) => f(context, a, this));
        return;
      }
      const sc = this.c;
      sc.save();
      f(sc, a, this);
      sc.restore();
    }

    _paintChunks(x, y, radius, painter) {
      const x0 = Math.max(0, Math.floor((x - radius) / this.size)),
        y0 = Math.max(0, Math.floor((y - radius) / this.size)),
        x1 = Math.min(
          Math.ceil(this.world.w / this.size) - 1,
          Math.floor((x + radius) / this.size),
        ),
        y1 = Math.min(
          Math.ceil(this.world.h / this.size) - 1,
          Math.floor((y + radius) / this.size),
        );
      for (let cy = y0; cy <= y1; cy++)
        for (let cx = x0; cx <= x1; cx++) {
          const record = this._chunk(cx, cy),
            context = record.context,
            previous = this.c;
          context.save();
          context.translate(-record.x, -record.y);
          this.c = context;
          painter(context);
          this.c = previous;
          context.restore();
        }
    }

    _chunk(cx, cy) {
      const key = cx + ":" + cy,
        current = this.chunks.get(key);
      if (current) return current;
      const x = cx * this.size,
        y = cy * this.size,
        w = Math.min(this.size, this.world.w - x),
        h = Math.min(this.size, this.world.h - y),
        canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const record = { x, y, w, h, canvas, context: canvas.getContext("2d") };
      this.chunks.set(key, record);
      return record;
    }

    // wobbly irregular blob — shared painter utility for the scenario
    fillBlob(cx, cy, r, seed, fill) {
      const sc = this.c;
      const n = 7 + Math.floor(ZS.hash(seed) * 3);
      const pts = [];
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2;
        const rr = r * (0.75 + ZS.hash(seed + i) * 0.5);
        pts.push({
          x: cx + Math.cos(ang) * rr,
          y: cy + Math.sin(ang) * rr,
        });
      }
      sc.fillStyle = fill;
      ZS.wpoly(sc, pts, seed + 50, r * 0.35, true);
      sc.fill();
    }
  }

  ZS.Stains = Stains;
})();
