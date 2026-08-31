/* Player-built perimeter defense. Fortifications snap to a 40px grid, own
   their navigation cells, persist independently from the procedural town,
   and use only the shared sketch primitives for rendering. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});
  const CFG = ZS.ZoneConfig;
  const F = CFG.FORTIFICATION;
  const R = CFG.RESOURCE;
  const SIZE = CFG.DEFENSE.GRID;
  const HALF = SIZE / 2;

  const LABEL = Object.freeze({
    [F.WALL]: "muro",
    [F.GATE]: "puerta",
    [F.TOWER]: "torre de vigilancia",
    [F.TRAP]: "trampa",
  });

  class ZoneFortifications {
    constructor(state, map) {
      this.state = state;
      this.map = map;
      this.world = null;
      this.nav = null;
      this.scenario = null;
      this.agents = null;
      this.onChanged = null;
      this.agriculture = null;
      this.list = state.zone.fortifications;
      this.preview = { x: 0, y: 0, kind: 0, remove: false, valid: false };
    }

    prepare(world, nav) {
      this.world = world;
      this.nav = nav;
      for (let i = this.list.length - 1; i >= 0; i--) {
        const record = this.list[i];
        record.attackT = 0;
        record.cells = [];
        if (!this._canOccupy(record.x, record.y, record.kind, record)) this.list.splice(i, 1);
        else this._claimCells(record);
      }
    }

    connect(scenario, agents, onChanged) {
      this.scenario = scenario;
      this.agents = agents;
      this.onChanged = onChanged;
    }

    connectAgriculture(agriculture) {
      this.agriculture = agriculture;
    }

    label(kind) {
      return LABEL[kind] || "defensa";
    }

    cost(kind) {
      return CFG.DEFENSE.COSTS[kind] || null;
    }

    isUnlocked(kind) {
      if (kind === F.TOWER) return Boolean(this.state.zone.tech[CFG.TECH.FORTIFICATIONS]);
      return kind >= F.WALL && kind <= F.TRAP;
    }

    canAfford(kind) {
      const cost = this.cost(kind);
      if (!cost) return false;
      for (let i = 0; i < R.COUNT; i++) if (this.state.stock[i] < (cost[i] || 0)) return false;
      return true;
    }

    snap(value) {
      return Math.floor(value / SIZE) * SIZE + HALF;
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
      return (
        this.isUnlocked(kind) &&
        this.canAfford(kind) &&
        this._canOccupy(this.snap(x), this.snap(y), kind, null)
      );
    }

    placementReason(x, y, kind) {
      if (!this.isUnlocked(kind)) return "La torre requiere investigar Fortificaciones.";
      if (!this.canAfford(kind)) return "No hay suficientes materiales para esta defensa.";
      if (!this._canOccupy(this.snap(x), this.snap(y), kind, null))
        return "Ese espacio está ocupado, bloqueado o demasiado lejos de la base.";
      return "";
    }

    place(x, y, kind) {
      x = this.snap(x);
      y = this.snap(y);
      if (!this.canPlace(x, y, kind)) return null;
      const cost = this.cost(kind);
      for (let i = 0; i < R.COUNT; i++) this.state.stock[i] -= cost[i] || 0;
      const maxHP = CFG.DEFENSE.HP[kind],
        record = {
          id: this.state.zone.nextFortificationId++,
          kind,
          x,
          y,
          hp: maxHP,
          maxHP,
          armed: kind === F.TRAP,
          attackT: 0,
          cells: [],
        };
      this.list.push(record);
      this._claimCells(record);
      if (this.onChanged) this.onChanged();
      return record;
    }

    removeAt(x, y, refund) {
      const record = this.atPoint(x, y);
      if (!record) return null;
      if (refund) {
        const cost = this.cost(record.kind);
        for (let i = 0; i < R.COUNT; i++) this.state.stock[i] += Math.floor((cost[i] || 0) * 0.5);
      }
      this._remove(record);
      return record;
    }

    atPoint(x, y) {
      for (let i = 0; i < this.list.length; i++) {
        const record = this.list[i];
        if (Math.abs(record.x - x) <= HALF && Math.abs(record.y - y) <= HALF) return record;
      }
      return null;
    }

    nearbyTarget(enemy, radius) {
      let best = radius * radius,
        target = null;
      for (let i = 0; i < this.list.length; i++) {
        const record = this.list[i];
        if (record.kind === F.TRAP || record.hp <= 0) continue;
        const dx = record.x - enemy.x,
          dy = record.y - enemy.y,
          distance = dx * dx + dy * dy;
        if (distance < best) {
          best = distance;
          target = record;
        }
      }
      return target;
    }

    damage(record, amount) {
      if (!record || record.hp <= 0) return 0;
      const dealt = Math.min(record.hp, Math.max(0, amount));
      record.hp -= dealt;
      if (record.hp <= 0) this._remove(record);
      else if (this.onChanged) this.onChanged();
      return dealt;
    }

    update(dt) {
      if (!this.agents || !this.scenario) return;
      for (let i = this.list.length - 1; i >= 0; i--) {
        const record = this.list[i];
        if (record.kind === F.TOWER) this._updateTower(record, dt);
        else if (record.kind === F.TRAP && record.armed) this._updateTrap(record);
      }
    }

    _updateTower(record, dt) {
      record.attackT = Math.max(0, record.attackT - dt);
      if (record.attackT > 0 || this.state.stock[R.AMMO] <= 0) return;
      let target = null,
        best = CFG.DEFENSE.TOWER_RANGE * CFG.DEFENSE.TOWER_RANGE;
      for (let i = 0; i < this.agents.length; i++) {
        const enemy = this.agents[i];
        if (!enemy.zoneEnemy || enemy.dead) continue;
        const dx = enemy.x - record.x,
          dy = enemy.y - record.y,
          distance = dx * dx + dy * dy;
        const length = Math.sqrt(distance) || 1,
          muzzleX = record.x + (dx / length) * (HALF + 5),
          muzzleY = record.y + (dy / length) * (HALF + 5);
        if (distance < best && this.nav.los(muzzleX, muzzleY, enemy.x, enemy.y, true, false)) {
          best = distance;
          target = enemy;
        }
      }
      if (!target) return;
      record.attackT = CFG.DEFENSE.TOWER_SECONDS;
      this.state.stock[R.AMMO]--;
      target.hp -= CFG.DEFENSE.TOWER_DAMAGE;
      target.flash = 0.12;
      ZS.fx.push({ x0: record.x, y0: record.y - 25, x1: target.x, y1: target.y - 6, t: 0.1 });
      if (ZS.sound) ZS.sound.event("turret", record.x, record.y);
      if (target.hp <= 0) this.scenario.scavenge.killEnemy(target);
      if (this.onChanged) this.onChanged();
    }

    _updateTrap(record) {
      let triggered = false;
      const radius2 = CFG.DEFENSE.TRAP_RANGE * CFG.DEFENSE.TRAP_RANGE;
      for (let i = 0; i < this.agents.length; i++) {
        const enemy = this.agents[i];
        if (!enemy.zoneEnemy || enemy.dead) continue;
        const dx = enemy.x - record.x,
          dy = enemy.y - record.y;
        if (dx * dx + dy * dy > radius2) continue;
        enemy.hp -= CFG.DEFENSE.TRAP_DAMAGE;
        enemy.flash = 0.18;
        if (enemy.hp <= 0) this.scenario.scavenge.killEnemy(enemy);
        triggered = true;
      }
      if (!triggered) return false;
      record.armed = false;
      ZS.fx.push({ x: record.x, y: record.y, t: 0.25, boom: true });
      if (ZS.sound) ZS.sound.event("fire", record.x, record.y);
      this._remove(record);
      return true;
    }

    _canOccupy(x, y, kind, self) {
      if (!this.nav || !this.world || !this.map.hq || kind < F.WALL || kind > F.TRAP) return false;
      if (
        x < HALF + 22 ||
        y < HALF + 22 ||
        x > this.world.w - HALF - 22 ||
        y > this.world.h - HALF - 22 ||
        Math.hypot(x - this.map.hq.cx, y - this.map.hq.cy) > CFG.DEFENSE.MAX_DISTANCE_FROM_HQ
      )
        return false;
      for (let i = 0; i < this.list.length; i++) {
        const record = this.list[i];
        if (record !== self && Math.abs(record.x - x) < SIZE && Math.abs(record.y - y) < SIZE)
          return false;
      }
      for (let i = 0; i < this.map.records.length; i++) {
        const building = this.map.records[i];
        if (building.demolished) continue;
        const shape = building.shape,
          door = shape.door;
        if (
          x + HALF > shape.x - 6 &&
          x - HALF < shape.x + shape.w + 6 &&
          y + HALF > shape.y - 6 &&
          y - HALF < shape.y + shape.h + 6
        )
          return false;
        if (
          door &&
          door.front &&
          Math.abs(door.front.x - x) < SIZE &&
          Math.abs(door.front.y - y) < SIZE
        )
          return false;
      }
      if (this.agriculture && this.agriculture.overlaps(x, y, HALF)) return false;
      const samples = [-10, 10];
      for (let iy = 0; iy < samples.length; iy++)
        for (let ix = 0; ix < samples.length; ix++) {
          const index = this.nav.idx(x + samples[ix], y + samples[iy]);
          if (index < 0 || this.nav.val[index] !== 1) return false;
        }
      if (this.agents)
        for (let i = 0; i < this.agents.length; i++) {
          const agent = this.agents[i];
          if (!agent.dead && Math.abs(agent.x - x) < 26 && Math.abs(agent.y - y) < 26) return false;
        }
      return true;
    }

    _claimCells(record) {
      record.cells.length = 0;
      if (record.kind === F.TRAP) return;
      const samples = [-10, 10],
        value = record.kind === F.GATE ? 3 : 0;
      for (let iy = 0; iy < samples.length; iy++)
        for (let ix = 0; ix < samples.length; ix++) {
          const index = this.nav.idx(record.x + samples[ix], record.y + samples[iy]);
          if (index < 0) continue;
          record.cells.push({ index, base: this.nav.val[index] });
          this.nav.val[index] = value;
        }
      this.nav.version++;
    }

    _restoreCells(record) {
      if (!record.cells || !record.cells.length) return;
      for (let i = 0; i < record.cells.length; i++) {
        const cell = record.cells[i];
        this.nav.val[cell.index] = cell.base;
      }
      record.cells.length = 0;
      this.nav.version++;
    }

    _remove(record) {
      this._restoreCells(record);
      const index = this.list.indexOf(record);
      if (index >= 0) this.list.splice(index, 1);
      if (this.onChanged) this.onChanged();
    }

    counts() {
      const counts = [0, 0, 0, 0, 0];
      for (let i = 0; i < this.list.length; i++) counts[this.list[i].kind]++;
      return counts;
    }

    capture() {
      const out = [];
      for (let i = 0; i < this.list.length; i++) {
        const record = this.list[i];
        if (record.hp <= 0) continue;
        out.push({
          id: record.id,
          kind: record.kind,
          x: record.x,
          y: record.y,
          hp: record.hp,
          maxHP: record.maxHP,
          armed: record.armed,
        });
      }
      this.state.zone.fortifications = out;
    }

    drawGround(c) {
      for (let i = 0; i < this.list.length; i++) {
        const record = this.list[i],
          seed = record.id * 47.13;
        if (record.kind === F.TRAP) {
          c.strokeStyle = "rgba(125,72,48,0.68)";
          c.lineWidth = 1.4;
          ZS.wline(c, record.x - 11, record.y - 8, record.x + 11, record.y + 8, seed, 1);
          ZS.wline(c, record.x - 11, record.y + 8, record.x + 11, record.y - 8, seed + 3, 1);
          continue;
        }
        c.fillStyle = record.kind === F.GATE ? "rgba(126,89,48,0.16)" : "rgba(61,52,43,0.11)";
        c.fillRect(record.x - HALF, record.y - HALF, SIZE, SIZE);
      }
    }

    drawOverlay(c, showAll) {
      c.save();
      c.lineCap = "round";
      c.lineJoin = "round";
      for (let i = 0; i < this.list.length; i++) {
        const record = this.list[i],
          seed = record.id * 47.13;
        c.strokeStyle = "rgba(61,52,43,0.88)";
        c.lineWidth = record.kind === F.WALL ? 3 : 2;
        if (record.kind === F.WALL) {
          ZS.sketchRect(c, record.x - 18, record.y - 11, 36, 22, seed);
          ZS.wline(c, record.x - 16, record.y, record.x + 16, record.y, seed + 5, 1.2);
        } else if (record.kind === F.GATE) {
          ZS.wline(c, record.x - 18, record.y - 13, record.x - 18, record.y + 13, seed, 1.1);
          ZS.wline(c, record.x + 18, record.y - 13, record.x + 18, record.y + 13, seed + 1, 1.1);
          ZS.wline(c, record.x - 15, record.y - 11, record.x, record.y + 10, seed + 2, 1.3);
          ZS.wline(c, record.x + 15, record.y - 11, record.x, record.y + 10, seed + 3, 1.3);
        } else if (record.kind === F.TOWER) {
          ZS.wline(c, record.x - 13, record.y + 16, record.x - 7, record.y - 18, seed, 1.2);
          ZS.wline(c, record.x + 13, record.y + 16, record.x + 7, record.y - 18, seed + 1, 1.2);
          ZS.sketchRect(c, record.x - 13, record.y - 25, 26, 15, seed + 2);
          ZS.wline(c, record.x - 10, record.y - 17, record.x + 16, record.y - 22, seed + 4, 0.8);
        }
        if (showAll || record.hp < record.maxHP) {
          const ratio = record.maxHP ? record.hp / record.maxHP : 0;
          c.strokeStyle = "rgba(150,62,48,0.32)";
          c.lineWidth = 3;
          ZS.wline(c, record.x - 15, record.y + 20, record.x + 15, record.y + 20, seed + 9, 0.3);
          c.strokeStyle = ratio > 0.35 ? "rgba(79,105,55,0.8)" : "rgba(150,62,48,0.86)";
          ZS.wline(
            c,
            record.x - 15,
            record.y + 20,
            record.x - 15 + 30 * ratio,
            record.y + 20,
            seed + 10,
            0.3,
          );
        }
      }
      c.restore();
    }

    drawPreview(c) {
      if (!this.preview.kind && !this.preview.remove) return;
      c.save();
      c.strokeStyle = this.preview.valid ? "rgba(79,105,55,0.9)" : "rgba(150,62,48,0.9)";
      c.fillStyle = this.preview.valid ? "rgba(112,148,72,0.16)" : "rgba(150,62,48,0.14)";
      c.lineWidth = 2;
      c.fillRect(this.preview.x - HALF, this.preview.y - HALF, SIZE, SIZE);
      ZS.sketchRect(c, this.preview.x - HALF, this.preview.y - HALF, SIZE, SIZE, 3);
      c.restore();
    }
  }

  ZS.ZoneFortifications = ZoneFortifications;
})();
