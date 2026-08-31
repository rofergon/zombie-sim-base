/* IFZ-inspired crop layer. Fields are placed on open ground, keep stable save
   IDs and feed the same event-driven worker board as adapted buildings. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});
  const CFG = ZS.ZoneConfig;
  const A = CFG.AGRICULTURE;
  const K = CFG.FARM_KIND;
  const R = CFG.RESOURCE;
  const T = CFG.TECH;

  const LABEL = Object.freeze({
    [K.FIELD]: "campo",
    [K.VAST_FIELD]: "campo extenso",
  });

  class ZoneAgriculture {
    constructor(state, map) {
      this.state = state;
      this.map = map;
      this.world = null;
      this.nav = null;
      this.tasks = null;
      this.citizens = null;
      this.fortifications = null;
      this.onChanged = null;
      this.logistics = null;
      this.list = state.zone.fields;
      this.preview = { x: 0, y: 0, kind: 0, remove: false, valid: false };
      this.weatherData = { season: "primavera", temperature: 15, rate: 1, label: "templado" };
    }

    prepare(world, nav) {
      this.world = world;
      this.nav = nav;
      for (let i = this.list.length - 1; i >= 0; i--) {
        const field = this.list[i];
        field.runtimeHandled = false;
        if (
          field.x < 0 ||
          field.y < 0 ||
          field.x > world.w ||
          field.y > world.h ||
          field.kind < K.FIELD ||
          field.kind > K.VAST_FIELD
        )
          this.list.splice(i, 1);
      }
    }

    connect(tasks, citizens, fortifications, onChanged) {
      this.tasks = tasks;
      this.citizens = citizens;
      this.fortifications = fortifications;
      this.onChanged = onChanged;
      this.ensureJobs();
    }

    connectLogistics(logistics) {
      this.logistics = logistics;
    }

    ensureJobs() {
      if (!this.tasks) return;
      for (let i = 0; i < this.list.length; i++) {
        const field = this.list[i];
        let job = this.tasks.forField(field.id);
        if (!job && field.hp > 0)
          job = this.tasks.postFieldProduction(field.id, A.WORKERS[field.kind]);
        if (job) job.capacity = A.WORKERS[field.kind];
      }
    }

    update() {
      for (let i = 0; i < this.list.length; i++) {
        const field = this.list[i];
        if (field.hp > 0 || field.runtimeHandled) continue;
        field.active = false;
        field.runtimeHandled = true;
        const job = this.tasks && this.tasks.forField(field.id);
        if (job) this.tasks.setPriority(job.id, CFG.PRIORITY.OFF);
        if (this.onChanged) this.onChanged();
      }
    }

    at(id) {
      for (let i = 0; i < this.list.length; i++) if (this.list[i].id === id) return this.list[i];
      return null;
    }

    atPoint(x, y) {
      for (let i = this.list.length - 1; i >= 0; i--) {
        const field = this.list[i],
          half = A.SIZE[field.kind] / 2;
        if (Math.abs(field.x - x) <= half && Math.abs(field.y - y) <= half) return field;
      }
      return null;
    }

    label(kind) {
      return LABEL[kind] || "cultivo";
    }

    cost(kind) {
      return A.COSTS[kind] || null;
    }

    isUnlocked(kind) {
      return (
        kind >= K.FIELD && kind <= K.VAST_FIELD && Boolean(this.state.zone.tech[T.AGRICULTURE])
      );
    }

    canAfford(kind) {
      const cost = this.cost(kind);
      if (!cost) return false;
      for (let i = 0; i < R.COUNT; i++) if (this.state.stock[i] < (cost[i] || 0)) return false;
      return true;
    }

    snap(value) {
      return Math.floor(value / A.GRID) * A.GRID + A.GRID / 2;
    }

    setPreview(x, y, kind) {
      this.preview.x = this.snap(x);
      this.preview.y = this.snap(y);
      this.preview.kind = kind;
      this.preview.remove = kind === 0;
      this.preview.valid =
        kind === 0
          ? Boolean(this.atPoint(this.preview.x, this.preview.y))
          : this.canPlace(this.preview.x, this.preview.y, kind);
      return this.preview;
    }

    clearPreview() {
      this.preview.kind = 0;
      this.preview.remove = false;
      this.preview.valid = false;
    }

    canPlace(x, y, kind) {
      x = this.snap(x);
      y = this.snap(y);
      return this.isUnlocked(kind) && this.canAfford(kind) && this._canOccupy(x, y, kind, null);
    }

    placementReason(x, y, kind) {
      if (!this.isUnlocked(kind)) return "Primero investiga Agricultura.";
      if (!this.canAfford(kind)) return "No hay madera y metal suficientes para preparar el campo.";
      if (!this._canOccupy(this.snap(x), this.snap(y), kind, null))
        return "El terreno está ocupado, bloqueado o demasiado lejos de la base.";
      return "";
    }

    place(x, y, kind) {
      x = this.snap(x);
      y = this.snap(y);
      if (!this.canPlace(x, y, kind)) return null;
      const cost = this.cost(kind);
      for (let i = 0; i < R.COUNT; i++) this.state.stock[i] -= cost[i] || 0;
      const maxHP = A.HP[kind],
        field = {
          id: this.state.zone.nextFieldId++,
          kind,
          x,
          y,
          hp: maxHP,
          maxHP,
          active: true,
          fertilized: false,
          runtimeHandled: false,
        };
      this.list.push(field);
      if (this.tasks) this.tasks.postFieldProduction(field.id, A.WORKERS[kind]);
      if (this.onChanged) this.onChanged();
      return field;
    }

    removeAt(x, y, refund) {
      const field = this.atPoint(x, y);
      if (!field) return null;
      const job = this.tasks && this.tasks.forField(field.id);
      if (job) this.tasks.cancel(job.id);
      if (refund) {
        const cost = this.cost(field.kind);
        for (let i = 0; i < R.COUNT; i++) this.state.stock[i] += Math.floor((cost[i] || 0) * 0.5);
      }
      const index = this.list.indexOf(field);
      if (index >= 0) this.list.splice(index, 1);
      if (this.onChanged) this.onChanged();
      return field;
    }

    toggle(field) {
      if (!field || field.hp <= 0) return false;
      field.active = !field.active;
      const job = this.tasks && this.tasks.forField(field.id);
      if (job)
        this.tasks.setPriority(
          job.id,
          field.active ? this.tasks.defaultPriorityFor(job) : CFG.PRIORITY.OFF,
        );
      if (this.onChanged) this.onChanged();
      return true;
    }

    toggleFertilizer(field) {
      if (!field || field.hp <= 0 || !this.state.zone.tech[T.FERTILIZATION]) return false;
      field.fertilized = !field.fertilized;
      if (this.onChanged) this.onChanged();
      return true;
    }

    cyclePriority(field) {
      const job = field && this.tasks && this.tasks.forField(field.id);
      if (!job) return false;
      let next = job.priority + 1;
      if (next > CFG.PRIORITY.HIGHEST) next = CFG.PRIORITY.LOWEST;
      field.active = next !== CFG.PRIORITY.OFF;
      return this.tasks.setPriority(job.id, next);
    }

    reachable(field) {
      return Boolean(field && field.hp > 0 && this.map.hq && this.nav);
    }

    workerPoint(field, citizenId, out) {
      const size = A.SIZE[field.kind],
        columns = field.kind === K.VAST_FIELD ? 4 : 2,
        slots = A.WORKERS[field.kind],
        slot = Math.abs(citizenId | 0) % slots,
        row = (slot / columns) | 0,
        rows = Math.ceil(slots / columns);
      out.x = field.x + ((slot % columns) - (columns - 1) / 2) * (size / (columns + 1));
      out.y = field.y + (row - (rows - 1) / 2) * (size / (rows + 1));
      return out;
    }

    weather() {
      const cycle = A.CYCLE_DAYS,
        day = (((this.state.day - 1) % cycle) + cycle) % cycle,
        wave = Math.sin((day / cycle) * Math.PI * 2),
        noise = (ZS.hash((this.state.seed || 1) + this.state.day * 131) - 0.5) * 6,
        temperature = Math.round(15 + wave * 14 + noise);
      let rate = 1,
        label = "templado";
      if (temperature < 0) {
        rate = 0.15;
        label = "helada severa";
      } else if (temperature < 5) {
        rate = 0.25 + temperature * 0.06;
        label = "helada";
      } else if (temperature < 12) {
        rate = 0.55 + ((temperature - 5) / 7) * 0.45;
        label = "frío";
      }
      this.weatherData.temperature = temperature;
      this.weatherData.rate = rate;
      this.weatherData.label = label;
      this.weatherData.season =
        day < 6 ? "primavera" : day < 12 ? "verano" : day < 18 ? "otoño" : "invierno";
      return this.weatherData;
    }

    productionSeconds(field) {
      return field ? A.SECONDS[field.kind] / this.weather().rate : Infinity;
    }

    canProduce(field) {
      if (!field || !field.active || field.hp <= 0) return false;
      const fertilized = field.fertilized && this.state.zone.tech[T.FERTILIZATION],
        output = fertilized ? A.FERTILIZED_GRAIN[field.kind] : A.GRAIN[field.kind];
      if (this.logistics && !this.logistics.canFit(output)) return false;
      return (
        !field.fertilized ||
        (this.state.zone.tech[T.FERTILIZATION] &&
          this.state.stock[R.FERTILIZER] >= A.FERTILIZER[field.kind])
      );
    }

    produce(field) {
      if (!this.canProduce(field)) return false;
      const fertilized = field.fertilized && this.state.zone.tech[T.FERTILIZATION];
      if (fertilized) this.state.stock[R.FERTILIZER] -= A.FERTILIZER[field.kind];
      const output = fertilized ? A.FERTILIZED_GRAIN[field.kind] : A.GRAIN[field.kind];
      if (this.logistics) this.logistics.deposit(R.GRAIN, output);
      else this.state.stock[R.GRAIN] += output;
      return true;
    }

    productionStatus(field) {
      if (!field || field.hp <= 0) return "destruido";
      if (!field.active) return "pausado";
      const fertilized = field.fertilized && this.state.zone.tech[T.FERTILIZATION],
        output = fertilized ? A.FERTILIZED_GRAIN[field.kind] : A.GRAIN[field.kind];
      if (this.logistics && !this.logistics.canFit(output)) return "sin espacio de almacén";
      if (field.fertilized && this.state.stock[R.FERTILIZER] < A.FERTILIZER[field.kind])
        return "sin fertilizante";
      const weather = this.weather();
      return weather.rate < 1
        ? "crecimiento al " + Math.round(weather.rate * 100) + "%"
        : "cultivando";
    }

    overlaps(x, y, half) {
      for (let i = 0; i < this.list.length; i++) {
        const field = this.list[i],
          fieldHalf = A.SIZE[field.kind] / 2;
        if (Math.abs(field.x - x) < fieldHalf + half && Math.abs(field.y - y) < fieldHalf + half)
          return true;
      }
      return false;
    }

    _canOccupy(x, y, kind, self) {
      if (!this.nav || !this.world || !this.map.hq) return false;
      const half = A.SIZE[kind] / 2;
      if (
        x < half + 20 ||
        y < half + 20 ||
        x > this.world.w - half - 20 ||
        y > this.world.h - half - 20 ||
        Math.hypot(x - this.map.hq.cx, y - this.map.hq.cy) > A.MAX_DISTANCE_FROM_HQ
      )
        return false;
      for (let i = 0; i < this.list.length; i++) {
        const field = this.list[i],
          otherHalf = A.SIZE[field.kind] / 2;
        if (
          field !== self &&
          Math.abs(field.x - x) < half + otherHalf + 8 &&
          Math.abs(field.y - y) < half + otherHalf + 8
        )
          return false;
      }
      for (let i = 0; i < this.map.records.length; i++) {
        const building = this.map.records[i],
          shape = building.shape;
        if (building.demolished) continue;
        if (
          x + half > shape.x - 8 &&
          x - half < shape.x + shape.w + 8 &&
          y + half > shape.y - 8 &&
          y - half < shape.y + shape.h + 8
        )
          return false;
      }
      if (this.fortifications)
        for (let i = 0; i < this.fortifications.list.length; i++) {
          const defense = this.fortifications.list[i];
          if (Math.abs(defense.x - x) < half + 20 && Math.abs(defense.y - y) < half + 20)
            return false;
        }
      const edge = half - 10,
        samples = [-edge, 0, edge];
      for (let iy = 0; iy < samples.length; iy++)
        for (let ix = 0; ix < samples.length; ix++) {
          const index = this.nav.idx(x + samples[ix], y + samples[iy]);
          if (index < 0 || this.nav.val[index] !== 1) return false;
        }
      return true;
    }

    capture() {
      const out = [];
      for (let i = 0; i < this.list.length; i++) {
        const field = this.list[i];
        out.push({
          id: field.id,
          kind: field.kind,
          x: field.x,
          y: field.y,
          hp: field.hp,
          maxHP: field.maxHP,
          active: field.active,
          fertilized: field.fertilized,
        });
      }
      this.state.zone.fields = out;
    }

    drawGround(c) {
      const visible = this.world && this.world.visibleRect;
      c.save();
      c.lineCap = "round";
      for (let i = 0; i < this.list.length; i++) {
        const field = this.list[i],
          size = A.SIZE[field.kind],
          half = size / 2;
        if (
          visible &&
          (field.x + half < visible.x0 ||
            field.x - half > visible.x1 ||
            field.y + half < visible.y0 ||
            field.y - half > visible.y1)
        )
          continue;
        c.fillStyle =
          field.hp <= 0
            ? "rgba(94,72,54,0.12)"
            : field.fertilized
              ? "rgba(112,148,72,0.18)"
              : "rgba(142,116,72,0.13)";
        c.fillRect(field.x - half, field.y - half, size, size);
        c.strokeStyle = field.hp <= 0 ? "rgba(150,62,48,0.6)" : "rgba(91,74,50,0.72)";
        c.lineWidth = 1.5;
        const seed = field.id * 83.17;
        ZS.wline(c, field.x - half, field.y - half, field.x + half, field.y - half, seed, 1.4);
        ZS.wline(c, field.x + half, field.y - half, field.x + half, field.y + half, seed + 1, 1.4);
        ZS.wline(c, field.x + half, field.y + half, field.x - half, field.y + half, seed + 2, 1.4);
        ZS.wline(c, field.x - half, field.y + half, field.x - half, field.y - half, seed + 3, 1.4);
        const rows = field.kind === K.VAST_FIELD ? 11 : 5,
          job = this.tasks && this.tasks.forField(field.id),
          seconds = this.productionSeconds(field),
          growth = job && Number.isFinite(seconds) ? Math.min(1, job.progress / seconds) : 0;
        c.strokeStyle = growth > 0.55 ? "rgba(79,105,55,0.72)" : "rgba(111,83,50,0.48)";
        c.lineWidth = 1 + growth * 1.2;
        for (let row = 1; row <= rows; row++) {
          const px = field.x - half + (row / (rows + 1)) * size;
          ZS.wline(c, px, field.y - half + 7, px, field.y + half - 7, seed + 10 + row, 0.9);
        }
        if (field.hp <= 0) {
          c.strokeStyle = "rgba(150,62,48,0.72)";
          ZS.wline(
            c,
            field.x - half,
            field.y - half,
            field.x + half,
            field.y + half,
            seed + 40,
            1.5,
          );
          ZS.wline(
            c,
            field.x + half,
            field.y - half,
            field.x - half,
            field.y + half,
            seed + 41,
            1.5,
          );
        }
      }
      c.restore();
    }

    drawOverlay(c, showAll) {
      if (!showAll) return;
      c.save();
      c.font = 'bold 10px "Segoe Script", "Bradley Hand", cursive';
      c.textAlign = "center";
      for (let i = 0; i < this.list.length; i++) {
        const field = this.list[i],
          size = A.SIZE[field.kind],
          job = this.tasks && this.tasks.forField(field.id),
          seconds = this.productionSeconds(field),
          progress = job && Number.isFinite(seconds) ? Math.min(1, job.progress / seconds) : 0,
          y = field.y + size / 2 + 13;
        c.strokeStyle = "rgba(61,52,43,0.25)";
        c.lineWidth = 3;
        ZS.wline(c, field.x - 24, y, field.x + 24, y, field.id * 31 + 1, 0.3);
        c.strokeStyle = field.hp > 0 ? "rgba(79,105,55,0.85)" : "rgba(150,62,48,0.85)";
        ZS.wline(c, field.x - 24, y, field.x - 24 + 48 * progress, y, field.id * 31 + 2, 0.3);
        c.fillStyle = "rgba(61,52,43,0.86)";
        c.fillText(this.label(field.kind) + " " + field.id, field.x, field.y - size / 2 - 8);
      }
      c.restore();
    }

    drawPreview(c) {
      if (!this.preview.kind && !this.preview.remove) return;
      const field = this.preview.remove ? this.atPoint(this.preview.x, this.preview.y) : null,
        size = field ? A.SIZE[field.kind] : A.SIZE[this.preview.kind] || A.GRID,
        half = size / 2;
      c.save();
      c.fillStyle = this.preview.valid ? "rgba(112,148,72,0.16)" : "rgba(150,62,48,0.14)";
      c.strokeStyle = this.preview.valid ? "rgba(79,105,55,0.9)" : "rgba(150,62,48,0.9)";
      c.lineWidth = 2;
      c.fillRect(this.preview.x - half, this.preview.y - half, size, size);
      ZS.wline(
        c,
        this.preview.x - half,
        this.preview.y - half,
        this.preview.x + half,
        this.preview.y - half,
        1,
        1.4,
      );
      ZS.wline(
        c,
        this.preview.x + half,
        this.preview.y - half,
        this.preview.x + half,
        this.preview.y + half,
        2,
        1.4,
      );
      ZS.wline(
        c,
        this.preview.x + half,
        this.preview.y + half,
        this.preview.x - half,
        this.preview.y + half,
        3,
        1.4,
      );
      ZS.wline(
        c,
        this.preview.x - half,
        this.preview.y + half,
        this.preview.x - half,
        this.preview.y - half,
        4,
        1.4,
      );
      c.restore();
    }
  }

  ZS.ZoneAgriculture = ZoneAgriculture;
})();
