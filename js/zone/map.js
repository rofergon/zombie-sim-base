/* Dense paper-town setup and scenario-owned building metadata. The core
   building geometry remains generic; this module assigns zone semantics. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});
  const CFG = ZS.ZoneConfig;
  const USE = CFG.BUILDING_USE;
  const R = CFG.RESOURCE;
  const P = CFG.POI;

  const USE_LABEL = Object.freeze({
    [USE.ABANDONED]: "abandonado",
    [USE.HQ]: "cuartel general",
    [USE.SHELTER]: "refugio",
    [USE.WAREHOUSE]: "almacén",
    [USE.COOKHOUSE]: "cocina",
    [USE.WORKSHOP]: "taller de munición",
    [USE.RESEARCH]: "centro de investigación",
    [USE.MEDBAY]: "enfermería",
    [USE.SQUAD_QUARTERS]: "cuartel de escuadra",
    [USE.FARM]: "granja en azotea",
    [USE.POWER]: "generador",
  });

  const POI_LABEL = Object.freeze({
    [P.RESIDENCE]: "vivienda",
    [P.GROCERY]: "tienda de comestibles",
    [P.PHARMACY]: "farmacia",
    [P.POLICE]: "comisaría",
    [P.WAREHOUSE]: "almacén",
    [P.WORKSHOP]: "taller",
    [P.LIBRARY]: "biblioteca",
  });

  function emptyResources() {
    return Array.from({ length: R.COUNT }, () => 0);
  }

  function copyResources(source) {
    const out = emptyResources();
    if (source)
      for (let i = 0; i < out.length; i++) out[i] = Math.max(0, Math.trunc(source[i]) || 0);
    return out;
  }

  class ZoneMap {
    constructor(state) {
      this.state = state;
      this.world = null;
      this.nav = null;
      this.records = [];
      this.roads = [];
      this.hq = null;
      this.recommended = null;
    }

    prepare(world, nav) {
      this.world = world;
      this.nav = nav;
      world.seed = this.state.attachSeed(world.seed);
      world.water();
      nav.markWater();
      world.layoutForest();
      ZS.Buildings.generate(world, nav, {
        density: CFG.MAP.BUILDING_DENSITY,
        maxBuildings: CFG.MAP.MAX_BUILDINGS,
        spread: CFG.MAP.BUILDING_SPREAD,
        pad: CFG.MAP.BUILDING_PAD,
        attempts: CFG.MAP.BUILDING_TRIES,
        scaleMin: CFG.MAP.BUILDING_SCALE_MIN,
        scaleRange: CFG.MAP.BUILDING_SCALE_RANGE,
      });
      world.placeAllTrees();
      this._makeRoads(world.towns);
      this._bindBuildings(world.buildings);
      world.zoneMap = this;
    }

    _makeRoads(towns) {
      this.roads.length = 0;
      for (let i = 1; i < towns.length; i++) {
        let nearest = 0,
          nearestD = Infinity;
        for (let j = 0; j < i; j++) {
          const dx = towns[i].x - towns[j].x,
            dy = towns[i].y - towns[j].y,
            d = dx * dx + dy * dy;
          if (d < nearestD) {
            nearestD = d;
            nearest = j;
          }
        }
        this.roads.push({
          x0: towns[i].x,
          y0: towns[i].y,
          x1: towns[nearest].x,
          y1: towns[nearest].y,
          seed: 400 + i * 17,
        });
      }
    }

    _bindBuildings(buildings) {
      this.records.length = 0;
      const cx = this.world.w / 2,
        cy = this.world.h / 2;
      let best = null,
        bestScore = -Infinity;
      for (let i = 0; i < buildings.length; i++) {
        const shape = buildings[i],
          area = Math.round(shape.w * shape.h),
          saved = this._savedBuilding(i),
          generated = this._generateBuilding(i),
          record = {
            id: i,
            shape,
            use: saved ? saved.use : USE.ABANDONED,
            area,
            cx: shape.x + shape.w / 2,
            cy: shape.y + shape.h / 2,
            name: "edificio " + String(i + 1).padStart(2, "0"),
            flag: null,
            poi: saved ? saved.poi : generated.poi,
            salvage: copyResources(saved ? saved.salvage : generated.salvage),
            loot: copyResources(saved ? saved.loot : generated.loot),
            lootWeapons: copyResources(saved ? saved.lootWeapons : generated.lootWeapons),
            revealed: saved ? saved.revealed : false,
            cleared: saved ? saved.cleared : false,
            looted: saved ? saved.looted : false,
            scavengeProgress: saved ? saved.scavengeProgress : 0,
            infectedRemaining: saved ? saved.infectedRemaining : generated.infectedRemaining,
            encounterSpawned: false,
            poiLabel: "",
            capacity: 0,
            hp: saved && saved.maxHP > 0 ? saved.hp : 0,
            maxHP: saved ? saved.maxHP : 0,
            active: saved ? saved.active : true,
            powered: false,
            productionT: saved ? saved.productionT : 0,
          };
        record.poiLabel = POI_LABEL[record.poi];
        shape.zoneId = i;
        this.records.push(record);
        if (!this.suitableHQ(record)) continue;
        const dist = Math.hypot(record.cx - cx, record.cy - cy),
          score = area - dist * 14;
        if (score > bestScore) {
          bestScore = score;
          best = record;
        }
      }
      this.recommended = best || this.records[0] || null;
      const saved = this.at(this.state.hqId);
      if (saved && this.suitableHQ(saved)) this.setHQ(saved.id);
      else if (this.state.hqId !== null) this.state.setHQ(null);
    }

    _savedBuilding(id) {
      const saved = this.state.zone.buildings;
      for (let i = 0; i < saved.length; i++) if (saved[i].id === id) return saved[i];
      return null;
    }

    _generateBuilding(id) {
      const rng = ZS.rng32((this.state.seed ^ Math.imul(id + 1, 0x45d9f3b)) | 0),
        poi = 1 + ((rng() * 7) | 0),
        salvage = emptyResources(),
        loot = emptyResources(),
        lootWeapons = emptyResources();
      salvage[R.WOOD] = 8 + ((rng() * 14) | 0);
      salvage[R.METAL] = 3 + ((rng() * 9) | 0);
      salvage[R.BRICK] = 7 + ((rng() * 15) | 0);
      if (poi === P.GROCERY) {
        loot[R.FOOD] = 18 + ((rng() * 22) | 0);
        loot[R.WOOD] = 2 + ((rng() * 4) | 0);
      } else if (poi === P.PHARMACY) {
        loot[R.MEDICINE] = 6 + ((rng() * 9) | 0);
        loot[R.FOOD] = (rng() * 5) | 0;
      } else if (poi === P.POLICE) {
        loot[R.AMMO] = 15 + ((rng() * 26) | 0);
        lootWeapons[CFG.WEAPON.PISTOL] = 1 + ((rng() * 2) | 0);
        lootWeapons[CFG.WEAPON.RIFLE] = rng() > 0.45 ? 1 : 0;
      } else if (poi === P.WAREHOUSE) {
        loot[R.WOOD] = 8 + ((rng() * 16) | 0);
        loot[R.METAL] = 8 + ((rng() * 14) | 0);
        loot[R.BRICK] = 6 + ((rng() * 14) | 0);
      } else if (poi === P.WORKSHOP) {
        loot[R.WOOD] = 5 + ((rng() * 9) | 0);
        loot[R.METAL] = 10 + ((rng() * 15) | 0);
        loot[R.AMMO] = (rng() * 7) | 0;
      } else if (poi === P.LIBRARY) {
        loot[R.SCIENCE] = 8 + ((rng() * 16) | 0);
        loot[R.WOOD] = 2 + ((rng() * 6) | 0);
      } else {
        loot[R.FOOD] = 3 + ((rng() * 8) | 0);
        loot[R.WOOD] = 2 + ((rng() * 7) | 0);
        loot[R.MEDICINE] = rng() > 0.72 ? 1 : 0;
      }
      return { poi, salvage, loot, lootWeapons, infectedRemaining: (rng() * 4) | 0 };
    }

    at(id) {
      return Number.isInteger(id) && id >= 0 && id < this.records.length ? this.records[id] : null;
    }

    buildingAt(x, y) {
      const id = ZS.Buildings.cellBldAt(this.nav, x, y);
      if (id >= 0) return this.records[id] || null;
      for (let i = 0; i < this.records.length; i++) {
        const r = this.records[i],
          b = r.shape;
        if (x >= b.x - 10 && x <= b.x + b.w + 10 && y >= b.y - 10 && y <= b.y + b.h + 10) return r;
      }
      return null;
    }

    suitableHQ(record) {
      return Boolean(record && record.shape.door && record.area >= CFG.MAP.MIN_HQ_AREA);
    }

    setHQ(id) {
      const record = this.at(id);
      if (!this.suitableHQ(record)) return false;
      if (this.hq) this.hq.use = USE.ABANDONED;
      this.hq = record;
      record.use = USE.HQ;
      record.revealed = true;
      record.cleared = true;
      record.infectedRemaining = 0;
      record.capacity = Math.max(CFG.AGENT.START_COUNT, Math.floor(record.area / 500));
      record.maxHP = Math.max(record.maxHP, CFG.HORDE.HQ_MAX_HP);
      record.hp = record.hp > 0 ? Math.min(record.hp, record.maxHP) : record.maxHP;
      this.state.setHQ(id);
      this._makeFlag(record);
      return true;
    }

    materialsTotal(record) {
      if (!record) return 0;
      return record.salvage[R.WOOD] + record.salvage[R.METAL] + record.salvage[R.BRICK];
    }

    lootTotal(record) {
      if (!record) return 0;
      let total = 0;
      for (let i = 0; i < R.COUNT; i++) total += record.loot[i];
      for (let i = 0; i < record.lootWeapons.length; i++) total += record.lootWeapons[i];
      return total;
    }

    useLabel(use) {
      return USE_LABEL[use] || "edificio adaptado";
    }

    countUse(use) {
      let count = 0;
      for (let i = 0; i < this.records.length; i++)
        if (this.records[i].use === use && this.records[i].hp > 0) count++;
      return count;
    }

    adapt(record, use, fortified) {
      if (!record || record === this.hq || record.use !== USE.ABANDONED) return false;
      record.use = use;
      record.maxHP = CFG.HORDE.BUILDING_MAX_HP * (fortified ? 1.35 : 1);
      record.hp = record.maxHP;
      record.active = true;
      record.productionT = 0;
      record.revealed = true;
      record.cleared = true;
      return true;
    }

    capture() {
      const out = [];
      for (let i = 0; i < this.records.length; i++) {
        const record = this.records[i];
        out.push({
          id: record.id,
          poi: record.poi,
          salvage: copyResources(record.salvage),
          loot: copyResources(record.loot),
          lootWeapons: copyResources(record.lootWeapons),
          revealed: record.revealed,
          cleared: record.cleared,
          looted: record.looted,
          scavengeProgress: record.scavengeProgress,
          infectedRemaining: record.infectedRemaining,
          use: record.use,
          hp: record.hp,
          maxHP: record.maxHP,
          active: record.active,
          productionT: record.productionT,
        });
      }
      this.state.zone.buildings = out;
    }

    _makeFlag(record) {
      const x = record.shape.x + record.shape.w / 2,
        y = record.shape.y - 24;
      record.flag = [
        { x: x + 1, y: y - 17 },
        { x: x + 22, y: y - 10 },
        { x: x + 1, y: y - 3 },
      ];
    }

    drawGround(c) {
      c.save();
      c.lineCap = "round";
      c.strokeStyle = "rgba(157,137,99,0.11)";
      c.lineWidth = CFG.MAP.ROAD_WIDTH;
      for (let i = 0; i < this.roads.length; i++) {
        const r = this.roads[i];
        ZS.wline(c, r.x0, r.y0, r.x1, r.y1, r.seed, 2.2);
      }
      c.strokeStyle = "rgba(75,67,55,0.16)";
      c.lineWidth = 1.1;
      for (let i = 0; i < this.roads.length; i++) {
        const r = this.roads[i];
        ZS.wline(c, r.x0, r.y0, r.x1, r.y1, r.seed + 3, 1.4);
      }
      c.restore();
    }

    drawBuildingOverlay(c, shape, selected, hovered, areaTarget, layers, job) {
      const record = this.at(shape.zoneId);
      if (!record) return;
      layers = layers || {};
      if (
        (layers.adapted && record.use !== USE.ABANDONED) ||
        (layers.loot && record.use === USE.ABANDONED && this.lootTotal(record) > 0) ||
        (layers.production && job && job.type === CFG.JOB.PRODUCE) ||
        (layers.threats && record.revealed && record.infectedRemaining > 0) ||
        (layers.power && record.use !== USE.ABANDONED && record !== this.hq)
      ) {
        c.save();
        c.fillStyle =
          layers.threats && record.revealed && record.infectedRemaining > 0
            ? "rgba(150,62,48,0.13)"
            : layers.power && record.active && !record.powered
              ? "rgba(190,143,73,0.14)"
              : "rgba(112,148,72,0.12)";
        c.fillRect(shape.x - 3, shape.y - 3, shape.w + 6, shape.h + 6);
        c.restore();
      }
      if (selected || hovered || areaTarget) {
        c.save();
        c.strokeStyle = selected
          ? "rgba(79,105,55,0.92)"
          : areaTarget
            ? "rgba(126,89,48,0.86)"
            : "rgba(79,105,55,0.46)";
        c.lineWidth = selected || areaTarget ? 2 : 1.1;
        const pad = selected || areaTarget ? 7 : 4;
        ZS.sketchRect(c, shape.x - pad, shape.y - pad, shape.w + pad * 2, shape.h + pad * 2, 3);
        c.restore();
      }
      if (record !== this.hq && record.use !== USE.ABANDONED) {
        c.save();
        c.fillStyle =
          record.powered === false && record.active
            ? "rgba(125,72,48,0.82)"
            : "rgba(61,52,43,0.82)";
        c.font = 'italic 11px "Segoe Script", "Bradley Hand", cursive';
        c.textAlign = "center";
        c.fillText(this.useLabel(record.use), record.cx, shape.y - 11);
        if (record.hp < record.maxHP) {
          c.strokeStyle = "rgba(125,72,48,0.72)";
          c.lineWidth = 2;
          const width = Math.max(18, shape.w * 0.6),
            ratio = record.maxHP ? record.hp / record.maxHP : 0;
          ZS.wline(
            c,
            record.cx - width / 2,
            shape.y - 5,
            record.cx - width / 2 + width * ratio,
            shape.y - 5,
            shape.seed + 641,
            0.5,
          );
        }
        c.restore();
      }
      if (
        layers.full ||
        layers.loot ||
        layers.production ||
        layers.priorities ||
        layers.threats ||
        layers.power
      ) {
        let line = shape.y + shape.h + 13;
        c.save();
        c.font = "bold 10px system-ui, sans-serif";
        c.textAlign = "center";
        c.textBaseline = "middle";
        if (layers.full) {
          c.fillStyle = "rgba(246,241,227,0.92)";
          c.fillRect(record.cx - 47, line - 8, 94, 16);
          c.fillStyle = "rgba(61,52,43,0.9)";
          c.fillText(
            record.use === USE.ABANDONED
              ? record.revealed
                ? record.poiLabel
                : "contenido desconocido"
              : this.useLabel(record.use),
            record.cx,
            line,
          );
          line += 17;
        }
        if (layers.loot && record.use === USE.ABANDONED && this.lootTotal(record) > 0) {
          c.fillStyle = "rgba(79,105,55,0.9)";
          c.fillText(
            record.revealed ? "botín " + this.lootTotal(record) : "botín ?",
            record.cx,
            line,
          );
          line += 14;
        }
        if (layers.production && job && job.type === CFG.JOB.PRODUCE) {
          const seconds =
              record.use === USE.FARM ? CFG.ADAPT.FARM_SECONDS : CFG.ADAPT.WORKSHOP_SECONDS,
            ratio = Math.max(0, Math.min(1, job.progress / seconds));
          c.fillStyle = "rgba(61,52,43,0.18)";
          c.fillRect(record.cx - 28, line - 3, 56, 6);
          c.fillStyle =
            record.powered && record.active ? "rgba(79,105,55,0.82)" : "rgba(150,62,48,0.76)";
          c.fillRect(record.cx - 28, line - 3, 56 * ratio, 6);
          line += 12;
        }
        if (layers.priorities && job) {
          c.fillStyle =
            job.priority === CFG.PRIORITY.HIGH
              ? "rgba(150,62,48,0.9)"
              : job.priority === CFG.PRIORITY.OFF
                ? "rgba(61,52,43,0.45)"
                : "rgba(126,89,48,0.86)";
          c.fillText(
            "prioridad " + job.priority + " · " + job.assigned.length + "/" + job.capacity,
            record.cx,
            line,
          );
          line += 14;
        }
        if (layers.threats && record.revealed && record.infectedRemaining > 0) {
          c.fillStyle = "rgba(150,62,48,0.92)";
          c.fillText("amenaza " + record.infectedRemaining, record.cx, line);
          line += 14;
        }
        if (layers.power && record.use !== USE.ABANDONED && record !== this.hq) {
          c.fillStyle = record.powered ? "rgba(79,105,55,0.9)" : "rgba(150,62,48,0.92)";
          c.fillText(record.powered ? "energía conectada" : "sin energía", record.cx, line);
        }
        c.restore();
      }
      if (record !== this.hq || !record.flag) return;
      const x = shape.x + shape.w / 2,
        y = shape.y - 24;
      c.save();
      c.strokeStyle = "rgba(61,52,43,0.9)";
      c.lineWidth = 1.8;
      ZS.wline(c, x, y + 12, x, y - 18, shape.seed + 201, 1.2);
      c.fillStyle = "rgba(150,62,48,0.38)";
      ZS.wpoly(c, record.flag, shape.seed + 211, 0.8, true);
      c.fill();
      c.stroke();
      c.fillStyle = "rgba(61,52,43,0.9)";
      c.font = 'italic 13px "Segoe Script", "Bradley Hand", cursive';
      c.textAlign = "center";
      c.fillText("CG", x, shape.y - 50);
      c.restore();
    }
  }

  ZS.ZoneMap = ZoneMap;
})();
