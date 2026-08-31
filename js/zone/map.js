/* Dense paper-town setup and scenario-owned building metadata. The core
   building geometry remains generic; this module assigns zone semantics. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});
  const CFG = ZS.ZoneConfig;
  const USE = CFG.BUILDING_USE;
  const R = CFG.RESOURCE;
  const P = CFG.POI;
  const DEMOLITION_SECONDS = 0.48;

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
    [USE.FARM]: "invernadero",
    [USE.POWER]: "generador",
    [USE.BARN]: "granero",
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

  function resourcesTotal(source) {
    let total = 0;
    if (source) for (let i = 0; i < source.length; i++) total += Math.max(0, source[i] || 0);
    return total;
  }

  function polygonArea(points) {
    let area = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++)
      area += points[j].x * points[i].y - points[i].x * points[j].y;
    return Math.abs(area) * 0.5;
  }

  class ZoneMap {
    constructor(state, geo) {
      this.state = state;
      this.geo = geo || null;
      this.world = null;
      this.nav = null;
      this.records = [];
      this.roads = [];
      this.roadIndex = new Map();
      this.visibleRoads = [];
      this.roadStamp = 0;
      this.regions = [];
      this.contours = [];
      this.hq = null;
      this.recommended = null;
      this.minHQArea = CFG.MAP.MIN_HQ_AREA;
      this.demolitions = [];
      this.onDemolished = null;
      this.savedById = new Map();
      this.savedBySource = new Map();
    }

    prepare(world, nav) {
      this.world = world;
      this.nav = nav;
      if (this.geo && this.geo.pack) {
        this._prepareMapPack(world, nav, this.geo.pack);
        return;
      }
      world.chunked = world.w > 4000 || world.h > 4000;
      world.seed = this.state.attachSeed(world.seed);
      world.water();
      nav.markWater();
      this._expandProceduralTowns(world);
      world.layoutForest();
      const size = (this.geo && this.geo.size) || "classic";
      ZS.Buildings.generate(world, nav, {
        density: CFG.MAP.BUILDING_DENSITY,
        maxBuildings: CFG.MAP.MAX_BUILDINGS_BY_SIZE[size] || CFG.MAP.MAX_BUILDINGS,
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

    _prepareMapPack(world, nav, pack) {
      world.seed = this.state.attachSeed(parseInt(pack.hash, 16) | 0);
      world.chunked = true;
      world.mapPack = pack;
      world.waterFeatures = pack.waters;
      world.landFeatures = pack.land;
      world.river = null;
      world.lake = null;
      world.ponds = [];
      world.ripples = [];
      world.forest = null;
      this.roads = pack.roads;
      this._indexRoads();
      this.regions = pack.regions;
      for (let i = 0; i < pack.waters.length; i++) nav.markPolygon(pack.waters[i].points, 0, true);
      nav.applyElevation(pack.elevation);
      for (let i = 0; i < pack.roads.length; i++)
        nav.markRoad(pack.roads[i].points, pack.roads[i].width);
      ZS.Buildings.load(world, nav, pack.buildings);
      this._bindBuildings(world.buildings);
      this._makeContours(pack.elevation, world.w, world.h);
      world.zoneMap = this;
    }

    _expandProceduralTowns(world) {
      const size = (this.geo && this.geo.size) || "classic";
      if (size === "classic" || size === "compact") return;
      const preset = CFG.MAP.SIZE_PRESETS[size],
        cells = preset ? preset.cells : 1,
        sector = CFG.MAP.SECTOR_METERS * CFG.MAP.PIXELS_PER_METER,
        rng = ZS.rng32(world.seed ^ 0x6d6170);
      for (let gy = 0; gy < cells; gy++)
        for (let gx = 0; gx < cells; gx++) {
          const x = gx * sector + sector * (0.28 + rng() * 0.44),
            y = gy * sector + sector * (0.28 + rng() * 0.44);
          let nearby = false;
          for (let i = 0; i < world.towns.length; i++)
            if (Math.hypot(world.towns[i].x - x, world.towns[i].y - y) < sector * 0.38) {
              nearby = true;
              break;
            }
          if (!nearby) world.towns.push({ x, y, n: 3 + ((rng() * 3) | 0), spread: 620 });
        }
    }

    _makeContours(elevation, w, h) {
      this.contours.length = 0;
      if (!elevation || !Array.isArray(elevation.values) || elevation.max - elevation.min < 4)
        return;
      const cols = elevation.cols,
        rows = elevation.rows,
        values = elevation.values,
        step = elevation.max - elevation.min > 80 ? 20 : 10,
        first = Math.ceil(elevation.min / step) * step;
      const edgePoint = (edge, x, y, level, corners) => {
        const pairs = [
            [0, 1],
            [1, 2],
            [2, 3],
            [3, 0],
          ],
          pair = pairs[edge],
          a = corners[pair[0]],
          b = corners[pair[1]],
          t = a.v === b.v ? 0.5 : (level - a.v) / (b.v - a.v);
        return {
          x: x + (a.x + (b.x - a.x) * t) * (w / (cols - 1)),
          y: y + (a.y + (b.y - a.y) * t) * (h / (rows - 1)),
        };
      };
      for (let level = first; level <= elevation.max; level += step)
        for (let y = 0; y < rows - 1; y++)
          for (let x = 0; x < cols - 1; x++) {
            const corners = [
                { x: 0, y: 0, v: values[y * cols + x] },
                { x: 1, y: 0, v: values[y * cols + x + 1] },
                { x: 1, y: 1, v: values[(y + 1) * cols + x + 1] },
                { x: 0, y: 1, v: values[(y + 1) * cols + x] },
              ],
              hits = [];
            for (let edge = 0; edge < 4; edge++) {
              const a = corners[edge],
                b = corners[(edge + 1) % 4];
              if ((a.v < level && b.v >= level) || (b.v < level && a.v >= level)) hits.push(edge);
            }
            if (hits.length < 2) continue;
            const ox = x * (w / (cols - 1)),
              oy = y * (h / (rows - 1));
            for (let hit = 1; hit < hits.length; hit += 2)
              this.contours.push({
                a: edgePoint(hits[hit - 1], ox, oy, level, corners),
                b: edgePoint(hits[hit], ox, oy, level, corners),
                level,
              });
          }
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
      this._indexRoads();
    }

    _indexRoads() {
      this.roadIndex.clear();
      const bucket = 640;
      for (let i = 0; i < this.roads.length; i++) {
        const road = this.roads[i];
        let bounds = road.bounds;
        if (!bounds) {
          bounds = {
            x0: Math.min(road.x0, road.x1),
            y0: Math.min(road.y0, road.y1),
            x1: Math.max(road.x0, road.x1),
            y1: Math.max(road.y0, road.y1),
          };
          road.bounds = bounds;
        }
        const x0 = Math.floor(bounds.x0 / bucket),
          y0 = Math.floor(bounds.y0 / bucket),
          x1 = Math.floor(bounds.x1 / bucket),
          y1 = Math.floor(bounds.y1 / bucket);
        for (let y = y0; y <= y1; y++)
          for (let x = x0; x <= x1; x++) {
            const key = x + ":" + y,
              list = this.roadIndex.get(key);
            if (list) list.push(road);
            else this.roadIndex.set(key, [road]);
          }
      }
    }

    _queryRoads(visible) {
      const out = this.visibleRoads;
      out.length = 0;
      if (!visible) return this.roads;
      const bucket = 640,
        x0 = Math.floor(visible.x0 / bucket),
        y0 = Math.floor(visible.y0 / bucket),
        x1 = Math.floor(visible.x1 / bucket),
        y1 = Math.floor(visible.y1 / bucket),
        stamp = ++this.roadStamp;
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const list = this.roadIndex.get(x + ":" + y);
          if (!list) continue;
          for (let i = 0; i < list.length; i++) {
            const road = list[i];
            if (road._zoneRoadStamp === stamp) continue;
            road._zoneRoadStamp = stamp;
            out.push(road);
          }
        }
      return out;
    }

    _bindBuildings(buildings) {
      this.records.length = 0;
      this.savedById.clear();
      this.savedBySource.clear();
      const savedBuildings = this.state.zone.buildings;
      for (let i = 0; i < savedBuildings.length; i++) {
        const saved = savedBuildings[i];
        this.savedById.set(saved.id, saved);
        if (saved.sourceKey) this.savedBySource.set(saved.sourceKey, saved);
      }
      const cx = this.world.w / 2,
        cy = this.world.h / 2;
      let best = null,
        bestScore = -Infinity,
        largestDoor = null;
      for (let i = 0; i < buildings.length; i++) {
        const shape = buildings[i],
          area = Math.round(shape.footprint ? polygonArea(shape.footprint) : shape.w * shape.h),
          saved = this._savedBuilding(i, shape.sourceKey),
          generated = this._generateBuilding(i),
          record = {
            id: i,
            shape,
            use: saved ? saved.use : USE.ABANDONED,
            area,
            cx: shape.x + shape.w / 2,
            cy: shape.y + shape.h / 2,
            name: shape.sourceName || "edificio " + String(i + 1).padStart(2, "0"),
            sourceKey: shape.sourceKey || "procedural/" + i,
            flag: null,
            poi: saved ? saved.poi : shape.sourcePoi || generated.poi,
            salvage: copyResources(saved ? saved.salvage : generated.salvage),
            loot: copyResources(saved ? saved.loot : generated.loot),
            lootWeapons: copyResources(saved ? saved.lootWeapons : generated.lootWeapons),
            lootCapacity: resourcesTotal(generated.loot) + resourcesTotal(generated.lootWeapons),
            revealed: saved ? saved.revealed : false,
            cleared: saved ? saved.cleared : false,
            looted: saved ? saved.looted : false,
            scavengeProgress: saved ? saved.scavengeProgress : 0,
            infectedRemaining: saved ? saved.infectedRemaining : generated.infectedRemaining,
            demolished: saved ? saved.demolished : false,
            demolitionT: 0,
            encounterSpawned: false,
            poiLabel: "",
            capacity: 0,
            hp: saved && saved.maxHP > 0 ? saved.hp : 0,
            maxHP: saved ? saved.maxHP : 0,
            active: saved ? saved.active : true,
            powered: false,
            productionT: saved ? saved.productionT : 0,
            recipe: saved ? saved.recipe : CFG.RECIPE.MEAT,
            fertilized: saved ? saved.fertilized : false,
          };
        record.lootCapacity = Math.max(
          record.lootCapacity,
          resourcesTotal(record.loot) + resourcesTotal(record.lootWeapons),
        );
        record.poiLabel = POI_LABEL[record.poi];
        shape.zoneId = i;
        shape.hidden = record.demolished;
        this.records.push(record);
        if (record.demolished) continue;
        if (this.entryPoint(record) && (!largestDoor || area > largestDoor.area))
          largestDoor = record;
        if (!this.suitableHQ(record)) continue;
        const dist = Math.hypot(record.cx - cx, record.cy - cy),
          score = area - dist * 14;
        if (score > bestScore) {
          bestScore = score;
          best = record;
        }
      }
      for (let i = 0; i < this.records.length; i++) {
        const record = this.records[i];
        if (record.demolished) ZS.Buildings.demolish(record.shape, this.nav);
      }
      if (!best && largestDoor) {
        this.minHQArea = Math.max(1200, Math.floor(largestDoor.area * 0.9));
        best = largestDoor;
      }
      this.recommended = best || this.records[0] || null;
      const saved = this.at(this.state.hqId);
      if (saved && this.suitableHQ(saved)) this.setHQ(saved.id);
      else if (this.state.hqId !== null) this.state.setHQ(null);
    }

    _savedBuilding(id, sourceKey) {
      return (sourceKey && this.savedBySource.get(sourceKey)) || this.savedById.get(id) || null;
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
        lootWeapons[CFG.WEAPON.SHOTGUN] = rng() > 0.68 ? 1 : 0;
        lootWeapons[CFG.WEAPON.SNIPER] = rng() > 0.9 ? 1 : 0;
      } else if (poi === P.WAREHOUSE) {
        loot[R.WOOD] = 8 + ((rng() * 16) | 0);
        loot[R.METAL] = 8 + ((rng() * 14) | 0);
        loot[R.BRICK] = 6 + ((rng() * 14) | 0);
      } else if (poi === P.WORKSHOP) {
        loot[R.WOOD] = 5 + ((rng() * 9) | 0);
        loot[R.METAL] = 10 + ((rng() * 15) | 0);
        loot[R.AMMO] = (rng() * 7) | 0;
        lootWeapons[CFG.WEAPON.SHOTGUN] = rng() > 0.82 ? 1 : 0;
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
      if (id >= 0) {
        const record = this.records[id];
        return record && !record.demolished ? record : null;
      }
      for (let i = 0; i < this.records.length; i++) {
        const r = this.records[i],
          b = r.shape;
        if (r.demolished) continue;
        if (x >= b.x - 10 && x <= b.x + b.w + 10 && y >= b.y - 10 && y <= b.y + b.h + 10) return r;
      }
      return null;
    }

    suitableHQ(record) {
      return Boolean(
        record &&
        !record.demolished &&
        !record.demolitionT &&
        this.entryPoint(record) &&
        record.area >= this.minHQArea,
      );
    }

    entryPoint(record) {
      if (!record || record.demolished || record.demolitionT || !record.shape) return null;
      const door = record.shape.door;
      if (
        !door ||
        !door.inner ||
        !door.front ||
        !Number.isInteger(door.frontIdx) ||
        this.nav.val[door.frontIdx] !== 1 ||
        ZS.Buildings.cellBldAt(this.nav, door.inner.x, door.inner.y) !== record.id
      )
        return null;
      const frontX = door.frontIdx % this.nav.w,
        frontY = (door.frontIdx / this.nav.w) | 0;
      let connected = false;
      for (let i = 0; i < door.cells.length; i++) {
        const index = door.cells[i],
          value = this.nav.val[index],
          x = index % this.nav.w,
          y = (index / this.nav.w) | 0;
        if (
          (value === 3 || (door.broken && value === 1)) &&
          Math.abs(x - frontX) + Math.abs(y - frontY) === 1
        ) {
          connected = true;
          break;
        }
      }
      return connected ? door.inner : null;
    }

    reachable(record) {
      if (!this.entryPoint(record)) return false;
      if (!this.hq || !this.entryPoint(this.hq)) return true;
      const from = this.hq.shape.door.accessId,
        to = record.shape.door.accessId;
      return from < 0 || to < 0 || from === to;
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
      if (
        !record ||
        record.demolished ||
        record.demolitionT ||
        record === this.hq ||
        record.use !== USE.ABANDONED
      )
        return false;
      record.use = use;
      record.maxHP = CFG.HORDE.BUILDING_MAX_HP * (fortified ? 1.35 : 1);
      record.hp = record.maxHP;
      record.active = true;
      record.productionT = 0;
      record.revealed = true;
      record.cleared = true;
      return true;
    }

    startDemolition(record) {
      if (
        !record ||
        record === this.hq ||
        record.demolished ||
        record.demolitionT ||
        this.materialsTotal(record) > 0
      )
        return false;
      record.demolitionT = DEMOLITION_SECONDS;
      this.demolitions.push(record);
      return true;
    }

    update(dt) {
      for (let i = this.demolitions.length - 1; i >= 0; i--) {
        const record = this.demolitions[i];
        record.demolitionT = Math.max(0, record.demolitionT - dt);
        if (record.demolitionT > 0) continue;
        record.demolished = true;
        record.active = false;
        record.hp = 0;
        record.maxHP = 0;
        record.shape.hidden = true;
        ZS.Buildings.demolish(record.shape, this.nav);
        this.demolitions.splice(i, 1);
        if (this.onDemolished) this.onDemolished(record);
      }
    }

    capture() {
      const out = [];
      for (let i = 0; i < this.records.length; i++) {
        const record = this.records[i];
        out.push({
          id: record.id,
          sourceKey: record.sourceKey,
          poi: record.poi,
          salvage: copyResources(record.salvage),
          loot: copyResources(record.loot),
          lootWeapons: copyResources(record.lootWeapons),
          revealed: record.revealed,
          cleared: record.cleared,
          looted: record.looted,
          scavengeProgress: record.scavengeProgress,
          infectedRemaining: record.infectedRemaining,
          demolished: record.demolished,
          use: record.use,
          hp: record.hp,
          maxHP: record.maxHP,
          active: record.active,
          productionT: record.productionT,
          recipe: record.recipe,
          fertilized: record.fertilized,
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

    drawPermanentGround(c, visible) {
      c.save();
      for (let i = 0; i < this.records.length; i++) {
        const record = this.records[i],
          shape = record.shape;
        if (
          !record.demolished ||
          (visible &&
            (shape.x + shape.w < visible.x0 ||
              shape.x > visible.x1 ||
              shape.y + shape.h < visible.y0 ||
              shape.y > visible.y1))
        )
          continue;
        this._drawClearedLot(c, shape);
      }
      c.restore();
    }
    drawGround(c) {
      const visible = this.world.visibleRect,
        overview = visible && visible.x1 - visible.x0 > 6000,
        roads = this._queryRoads(visible);
      c.save();
      c.lineCap = "round";
      c.strokeStyle = "rgba(157,137,99,0.11)";
      c.lineWidth = CFG.MAP.ROAD_WIDTH;
      for (let i = 0; i < roads.length; i++) {
        const r = roads[i];
        if (overview && r.points && r.width < 22) continue;
        if (r.points) this._drawRoad(c, r, 2.2, 0, r.width);
        else ZS.wline(c, r.x0, r.y0, r.x1, r.y1, r.seed, 2.2);
      }
      c.strokeStyle = "rgba(75,67,55,0.16)";
      c.lineWidth = 1.1;
      for (let i = 0; i < roads.length; i++) {
        const r = roads[i];
        if (overview && r.points && r.width < 22) continue;
        if (r.points) this._drawRoad(c, r, 1.4, 3, 1.1);
        else ZS.wline(c, r.x0, r.y0, r.x1, r.y1, r.seed + 3, 1.4);
      }
      c.strokeStyle = "rgba(92,72,50,0.17)";
      c.lineWidth = 0.8;
      for (let i = 0; i < this.contours.length; i++) {
        if (overview) break;
        const contour = this.contours[i];
        if (
          visible &&
          (Math.max(contour.a.x, contour.b.x) < visible.x0 ||
            Math.min(contour.a.x, contour.b.x) > visible.x1 ||
            Math.max(contour.a.y, contour.b.y) < visible.y0 ||
            Math.min(contour.a.y, contour.b.y) > visible.y1)
        )
          continue;
        ZS.wline(c, contour.a.x, contour.a.y, contour.b.x, contour.b.y, contour.level * 13, 0.6);
      }
      c.restore();
    }

    _drawRoad(c, road, jitter, seedOffset, lineWidth) {
      const points = road.points,
        visible = this.world.visibleRect;
      c.lineWidth = lineWidth || road.width || CFG.MAP.ROAD_WIDTH;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1],
          b = points[i];
        if (
          visible &&
          (Math.max(a.x, b.x) < visible.x0 ||
            Math.min(a.x, b.x) > visible.x1 ||
            Math.max(a.y, b.y) < visible.y0 ||
            Math.min(a.y, b.y) > visible.y1)
        )
          continue;
        ZS.wline(c, a.x, a.y, b.x, b.y, road.seed + i * 7 + (seedOffset || 0), jitter);
      }
    }

    drawBuildingOverlay(c, shape, selected, hovered, areaTarget, layers, job) {
      const record = this.at(shape.zoneId);
      if (!record) return;
      if (record.demolished) {
        return;
      }
      if (record.demolitionT > 0) {
        this._drawDemolition(c, record, shape);
        return;
      }
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
        if (shape.footprint) {
          ZS.wpoly(c, shape.footprint, shape.seed + 501, 0.45, true);
          c.fill();
        } else c.fillRect(shape.x - 3, shape.y - 3, shape.w + 6, shape.h + 6);
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
        if (shape.halo || shape.footprint) {
          ZS.wpoly(c, shape.halo || shape.footprint, shape.seed + 511, 0.7, true);
          c.stroke();
        } else {
          const pad = selected || areaTarget ? 7 : 4;
          ZS.sketchRect(c, shape.x - pad, shape.y - pad, shape.w + pad * 2, shape.h + pad * 2, 3);
        }
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
            job.priority >= CFG.PRIORITY.HIGH
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
    }

    drawHeadquartersFlag(c, zoom) {
      const record = this.hq;
      if (!record || !record.flag) return;
      const shape = record.shape,
        x = shape.x + shape.w / 2,
        y = shape.y - 24,
        scale = Math.max(1, 0.75 / zoom),
        flag = record.flag;
      flag[0].x = x + scale;
      flag[0].y = y - 17 * scale;
      flag[1].x = x + 22 * scale;
      flag[1].y = y - 10 * scale;
      flag[2].x = x + scale;
      flag[2].y = y - 3 * scale;
      c.save();
      c.strokeStyle = "rgba(61,52,43,0.9)";
      c.lineWidth = Math.max(1.8, 1.4 / zoom);
      ZS.wline(c, x, y + 12 * scale, x, y - 18 * scale, shape.seed + 201, 1.2 * scale);
      c.fillStyle = "rgba(150,62,48,0.38)";
      ZS.wpoly(c, flag, shape.seed + 211, 0.8 * scale, true);
      c.fill();
      c.stroke();
      c.fillStyle = "rgba(61,52,43,0.9)";
      c.font = "italic " + Math.max(13, 11 / zoom) + 'px "Segoe Script", "Bradley Hand", cursive';
      c.textAlign = "center";
      c.fillText("CG", x, y - 26 * scale);
      c.restore();
    }

    _fillShape(c, shape) {
      if (shape.footprint) {
        c.beginPath();
        c.moveTo(shape.footprint[0].x, shape.footprint[0].y);
        for (let i = 1; i < shape.footprint.length; i++)
          c.lineTo(shape.footprint[i].x, shape.footprint[i].y);
        c.closePath();
        c.fill();
        return;
      }
      for (let i = 0; i < shape.rooms.length; i++) {
        const room = shape.rooms[i];
        c.fillRect(room[0], room[1], room[2], room[3]);
      }
    }

    _drawDemolition(c, record, shape) {
      const progress = 1 - record.demolitionT / DEMOLITION_SECONDS,
        frame = Math.min(3, (progress * 4) | 0),
        seed = shape.seed + 1801,
        bottom = shape.y + shape.h;
      c.save();
      c.strokeStyle = "rgba(92,72,50," + (0.42 - frame * 0.07).toFixed(2) + ")";
      c.lineWidth = 1.35;
      for (let i = 0; i <= frame + 1; i++) {
        const x = shape.x + ((i + 1) * shape.w) / (frame + 3);
        ZS.wline(
          c,
          x,
          shape.y + 3,
          x + ZS.sjit(seed + i) * shape.w * 0.18,
          bottom - 3,
          seed + i * 7,
          1.1,
        );
      }
      c.strokeStyle = "rgba(112,96,72," + (0.22 + frame * 0.06).toFixed(2) + ")";
      for (let i = 0; i < 2 + frame; i++)
        ZS.wcirc(
          c,
          shape.x + shape.w * (0.18 + i * 0.16),
          bottom - 2 - ZS.sjit(seed + 41 + i) * 3,
          3 + frame * 1.7,
          seed + 51 + i,
          1.1,
        );
      c.restore();
    }

    _drawClearedLot(c, shape) {
      const seed = shape.seed + 1901,
        y = shape.y + shape.h * 0.72;
      c.save();
      c.fillStyle = "rgba(243,237,222,0.96)";
      this._fillShape(c, shape);
      c.strokeStyle = "rgba(112,96,72,0.2)";
      c.lineWidth = 1;
      ZS.wline(c, shape.x + 8, y, shape.x + shape.w * 0.42, y + 3, seed, 0.8);
      ZS.wline(c, shape.x + shape.w * 0.58, y + 5, shape.x + shape.w - 7, y - 2, seed + 7, 0.8);
      ZS.wcirc(c, shape.cx || shape.x + shape.w / 2, y + 5, 2.3, seed + 11, 0.35);
      c.restore();
    }
  }

  ZS.ZoneMap = ZoneMap;
})();
