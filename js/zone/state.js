/* Versioned campaign state for ScenarioZone. Migrations are pure; all old
   shapes are discarded at this storage boundary so gameplay only sees v9. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});
  const CFG = ZS.ZoneConfig;

  const intOr = (value, fallback) => (Number.isFinite(value) ? Math.trunc(value) : fallback);
  const numberOr = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

  function resources(source) {
    const out = Array.from({ length: CFG.RESOURCE.COUNT }, () => 0);
    if (!Array.isArray(source)) return out;
    for (let i = 0; i < out.length; i++) out[i] = Math.max(0, intOr(source[i], 0));
    return out;
  }

  function defaultZone() {
    return {
      hqId: null,
      initialized: false,
      stock: resources(null),
      nextCitizenId: 1,
      citizens: [],
      nextJobId: 1,
      jobs: [],
      nextSquadId: 1,
      squads: [],
      nextFortificationId: 1,
      fortifications: [],
      buildings: [],
      regions: [],
      expedition: null,
      tech: Array.from({ length: CFG.TECH.COUNT }, () => false),
      defense: defaultDefense(),
    };
  }

  function defaultDefense() {
    return {
      lastStartedDay: 0,
      lastCompletedDay: 0,
      active: false,
      pending: 0,
      live: 0,
      spawned: 0,
      kills: 0,
      citizensLost: 0,
      buildingDamage: 0,
      breached: false,
      direction: 0,
      report: null,
    };
  }

  function defaultData() {
    return {
      v: CFG.SAVE_VERSION,
      world: {
        seed: null,
        configured: false,
        source: "procedural",
        size: "classic",
        mapPackId: null,
        mapHash: null,
        name: "Distrito procedural",
        center: null,
        projection: null,
        dataTimestamp: null,
        elevationSource: null,
      },
      clock: {
        day: CFG.CLOCK.START_DAY,
        minute: CFG.CLOCK.START_MINUTE,
        speed: 1,
        paused: true,
      },
      zone: defaultZone(),
    };
  }

  function migrateV1(data) {
    return {
      v: 2,
      seed: intOr(data.seed, null),
      clock: {
        day: intOr(data.day, CFG.CLOCK.START_DAY),
        minute: intOr(data.minute, CFG.CLOCK.START_MINUTE),
        speed: 1,
        paused: true,
      },
      hq: Number.isInteger(data.hq) ? data.hq : null,
    };
  }

  function migrateV2(data) {
    return {
      v: 3,
      world: { seed: intOr(data.seed, null) },
      clock: data.clock,
      zone: { hqId: Number.isInteger(data.hq) ? data.hq : null },
    };
  }

  function migrateV3(data) {
    const zone = defaultZone();
    zone.hqId = data.zone && Number.isInteger(data.zone.hqId) ? data.zone.hqId : null;
    return { v: 4, world: data.world, clock: data.clock, zone };
  }

  function migrateV4(data) {
    const zone = Object.assign(defaultZone(), data.zone || {});
    zone.nextSquadId = 1;
    zone.squads = [];
    return { v: 5, world: data.world, clock: data.clock, zone };
  }

  function migrateV5(data) {
    const zone = Object.assign(defaultZone(), data.zone || {});
    zone.tech = Array.from({ length: CFG.TECH.COUNT }, () => false);
    return { v: 6, world: data.world, clock: data.clock, zone };
  }

  function migrateV6(data) {
    const zone = Object.assign(defaultZone(), data.zone || {});
    zone.defense = defaultDefense();
    return { v: 7, world: data.world, clock: data.clock, zone };
  }

  function migrateV7(data) {
    const zone = Object.assign(defaultZone(), data.zone || {});
    zone.nextFortificationId = 1;
    zone.fortifications = [];
    return { v: 8, world: data.world, clock: data.clock, zone };
  }

  function migrateV8(data) {
    const zone = Object.assign(defaultZone(), data.zone || {}),
      previous = data.world || {};
    zone.regions = [];
    zone.expedition = null;
    return {
      v: 9,
      world: {
        seed: intOr(previous.seed, null),
        configured: true,
        source: "procedural",
        size: "classic",
        mapPackId: null,
        mapHash: null,
        name: "Distrito procedural",
        center: null,
        projection: null,
        dataTimestamp: null,
        elevationSource: null,
      },
      clock: data.clock,
      zone,
    };
  }

  function normalizeOrder(raw) {
    if (
      !raw ||
      !Number.isInteger(raw.kind) ||
      raw.kind < CFG.ORDER.MOVE ||
      raw.kind > CFG.ORDER.ATTACK_MOVE
    )
      return null;
    const x = numberOr(raw.x, NaN),
      y = numberOr(raw.y, NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return {
      kind: raw.kind,
      x,
      y,
      buildingId: Number.isInteger(raw.buildingId) ? raw.buildingId : null,
    };
  }

  function normalizeCitizen(raw) {
    if (!raw || !Number.isInteger(raw.id) || raw.id < 1) return null;
    const role = intOr(raw.role, CFG.ROLE.WORKER),
      maxHP = clamp(numberOr(raw.maxHP, CFG.CITIZEN.MAX_HP), 1, CFG.CITIZEN.MAX_HP);
    return {
      id: raw.id,
      x: numberOr(raw.x, 0),
      y: numberOr(raw.y, 0),
      hp: clamp(numberOr(raw.hp, maxHP), 0, maxHP),
      maxHP,
      moral: clamp(numberOr(raw.moral, CFG.CITIZEN.START_MORAL), 0, 100),
      hunger: clamp(numberOr(raw.hunger, 0), 0, 100),
      role: role >= CFG.ROLE.WORKER && role <= CFG.ROLE.DEAD ? role : CFG.ROLE.WORKER,
      workerState: clamp(
        intOr(raw.workerState, CFG.WORKER_STATE.IDLE),
        CFG.WORKER_STATE.IDLE,
        CFG.WORKER_STATE.RESTING,
      ),
      jobId: Number.isInteger(raw.jobId) ? raw.jobId : null,
      carry: resources(raw.carry),
      squadId: Number.isInteger(raw.squadId) ? raw.squadId : null,
      weapon: clamp(intOr(raw.weapon, CFG.WEAPON.MACHETE), CFG.WEAPON.MACHETE, CFG.WEAPON.RIFLE),
    };
  }

  function normalizeJob(raw) {
    if (
      !raw ||
      !Number.isInteger(raw.id) ||
      raw.id < 1 ||
      (raw.type !== CFG.JOB.SALVAGE && raw.type !== CFG.JOB.BUILD && raw.type !== CFG.JOB.PRODUCE)
    )
      return null;
    const assigned = [];
    if (Array.isArray(raw.assigned))
      for (let i = 0; i < raw.assigned.length; i++)
        if (Number.isInteger(raw.assigned[i]) && !assigned.includes(raw.assigned[i]))
          assigned.push(raw.assigned[i]);
    return {
      id: raw.id,
      type: raw.type,
      targetId: Math.max(0, intOr(raw.targetId, 0)),
      priority: clamp(
        intOr(raw.priority, CFG.PRIORITY.NORMAL),
        CFG.PRIORITY.OFF,
        CFG.PRIORITY.HIGH,
      ),
      capacity: clamp(intOr(raw.capacity, CFG.TASK.SALVAGE_CAPACITY), 1, 12),
      progress: Math.max(0, numberOr(raw.progress, 0)),
      state:
        raw.state === CFG.JOB_STATE.COMPLETE || raw.state === CFG.JOB_STATE.CANCELED
          ? raw.state
          : CFG.JOB_STATE.ACTIVE,
      assigned,
      buildUse:
        raw.type === CFG.JOB.BUILD
          ? clamp(
              intOr(raw.buildUse, CFG.BUILDING_USE.SHELTER),
              CFG.BUILDING_USE.SHELTER,
              CFG.BUILDING_USE.POWER,
            )
          : null,
      reserved: resources(raw.reserved),
    };
  }

  function normalizeSquad(raw) {
    if (!raw || !Number.isInteger(raw.id) || raw.id < 1) return null;
    const members = [],
      equipment = [],
      orders = [];
    if (Array.isArray(raw.members))
      for (let i = 0; i < raw.members.length && members.length < CFG.SQUAD.MAX_MEMBERS; i++)
        if (Number.isInteger(raw.members[i]) && !members.includes(raw.members[i]))
          members.push(raw.members[i]);
    if (Array.isArray(raw.equipment))
      for (let i = 0; i < raw.equipment.length && i < CFG.SQUAD.MAX_MEMBERS; i++)
        equipment.push(
          clamp(intOr(raw.equipment[i], CFG.WEAPON.MACHETE), CFG.WEAPON.MACHETE, CFG.WEAPON.RIFLE),
        );
    if (Array.isArray(raw.orders))
      for (let i = 0; i < raw.orders.length && orders.length < CFG.AGENT.MAX_ORDERS; i++) {
        const order = normalizeOrder(raw.orders[i]);
        if (order) orders.push(order);
      }
    return {
      id: raw.id,
      members,
      inventory: resources(raw.inventory),
      capacity: clamp(intOr(raw.capacity, CFG.SQUAD.INVENTORY_CAPACITY), 1, 200),
      equipment,
      orders,
      orderIndex: clamp(intOr(raw.orderIndex, 0), 0, orders.length),
      patrolLoop: Boolean(raw.patrolLoop),
      resumeBuildingId: Number.isInteger(raw.resumeBuildingId) ? raw.resumeBuildingId : null,
      garrisonBuildingId: Number.isInteger(raw.garrisonBuildingId) ? raw.garrisonBuildingId : null,
      retreating: Boolean(raw.retreating),
      state: typeof raw.state === "string" ? raw.state.slice(0, 24) : "idle",
    };
  }

  function normalizeFortification(raw) {
    if (!raw || !Number.isInteger(raw.id) || raw.id < 1) return null;
    const kind = clamp(
        intOr(raw.kind, CFG.FORTIFICATION.WALL),
        CFG.FORTIFICATION.WALL,
        CFG.FORTIFICATION.TRAP,
      ),
      maxHP = Math.max(1, numberOr(raw.maxHP, CFG.DEFENSE.HP[kind]));
    return {
      id: raw.id,
      kind,
      x: numberOr(raw.x, 0),
      y: numberOr(raw.y, 0),
      hp: clamp(numberOr(raw.hp, maxHP), 0, maxHP),
      maxHP,
      armed: kind === CFG.FORTIFICATION.TRAP ? raw.armed !== false : false,
    };
  }

  function normalizeBuilding(raw) {
    if (!raw || !Number.isInteger(raw.id) || raw.id < 0) return null;
    return {
      id: raw.id,
      sourceKey: typeof raw.sourceKey === "string" ? raw.sourceKey.slice(0, 80) : null,
      poi: clamp(intOr(raw.poi, CFG.POI.RESIDENCE), CFG.POI.RESIDENCE, CFG.POI.LIBRARY),
      salvage: resources(raw.salvage),
      loot: resources(raw.loot),
      lootWeapons: resources(raw.lootWeapons),
      revealed: Boolean(raw.revealed),
      cleared: Boolean(raw.cleared),
      looted: Boolean(raw.looted),
      scavengeProgress: Math.max(0, numberOr(raw.scavengeProgress, 0)),
      infectedRemaining: clamp(intOr(raw.infectedRemaining, 0), 0, 32),
      demolished: Boolean(raw.demolished),
      use: clamp(
        intOr(raw.use, CFG.BUILDING_USE.ABANDONED),
        CFG.BUILDING_USE.ABANDONED,
        CFG.BUILDING_USE.POWER,
      ),
      hp: Math.max(0, numberOr(raw.hp, 0)),
      maxHP: Math.max(0, numberOr(raw.maxHP, 0)),
      active: raw.active !== false,
      productionT: Math.max(0, numberOr(raw.productionT, 0)),
    };
  }

  function normalizeDefense(raw) {
    const clean = defaultDefense();
    if (!raw || typeof raw !== "object") return clean;
    clean.lastStartedDay = Math.max(0, intOr(raw.lastStartedDay, 0));
    clean.lastCompletedDay = Math.max(0, intOr(raw.lastCompletedDay, 0));
    clean.active = Boolean(raw.active);
    clean.pending = clamp(intOr(raw.pending, 0), 0, 500);
    clean.live = clamp(intOr(raw.live, 0), 0, 500);
    clean.spawned = clamp(intOr(raw.spawned, 0), 0, 500);
    clean.kills = clamp(intOr(raw.kills, 0), 0, 5000);
    clean.citizensLost = clamp(intOr(raw.citizensLost, 0), 0, 1000);
    clean.buildingDamage = Math.max(0, numberOr(raw.buildingDamage, 0));
    clean.breached = Boolean(raw.breached);
    clean.direction = clamp(intOr(raw.direction, 0), 0, 3);
    if (raw.report && typeof raw.report === "object")
      clean.report = {
        day: Math.max(1, intOr(raw.report.day, 1)),
        kills: Math.max(0, intOr(raw.report.kills, 0)),
        citizensLost: Math.max(0, intOr(raw.report.citizensLost, 0)),
        buildingDamage: Math.max(0, intOr(raw.report.buildingDamage, 0)),
        breached: Boolean(raw.report.breached),
      };
    return clean;
  }

  function normalizeRegion(raw) {
    if (!raw || typeof raw.id !== "string" || raw.id.length > 40) return null;
    return {
      id: raw.id,
      discovered: Boolean(raw.discovered),
      scouted: Boolean(raw.scouted),
      loot: clamp(intOr(raw.loot, 0), 0, 9999),
      threat: clamp(intOr(raw.threat, 0), 0, 99),
    };
  }

  function normalizeExpedition(raw) {
    if (!raw || typeof raw.regionId !== "string" || raw.regionId.length > 40) return null;
    return {
      regionId: raw.regionId,
      remaining: clamp(numberOr(raw.remaining, 0), 0, 1440),
    };
  }

  function normalize(data) {
    const clean = defaultData();
    if (!data || data.v !== CFG.SAVE_VERSION) return clean;
    if (data.world) {
      const source = data.world;
      clean.world.seed = intOr(source.seed, null);
      clean.world.configured = Boolean(source.configured);
      clean.world.source = source.source === "osm" ? "osm" : "procedural";
      clean.world.size = Object.hasOwn(CFG.MAP.SIZE_PRESETS, source.size) ? source.size : "classic";
      clean.world.mapPackId =
        typeof source.mapPackId === "string" ? source.mapPackId.slice(0, 180) : null;
      clean.world.mapHash = typeof source.mapHash === "string" ? source.mapHash.slice(0, 32) : null;
      clean.world.name =
        typeof source.name === "string" ? source.name.slice(0, 120) : "Distrito procedural";
      if (
        source.center &&
        Number.isFinite(Number(source.center.lat)) &&
        Number.isFinite(Number(source.center.lon))
      )
        clean.world.center = { lat: Number(source.center.lat), lon: Number(source.center.lon) };
      clean.world.projection =
        typeof source.projection === "string" ? source.projection.slice(0, 40) : null;
      clean.world.dataTimestamp =
        typeof source.dataTimestamp === "string" ? source.dataTimestamp.slice(0, 40) : null;
      clean.world.elevationSource =
        typeof source.elevationSource === "string" ? source.elevationSource.slice(0, 80) : null;
    }
    if (data.clock) {
      clean.clock.day = Math.max(1, intOr(data.clock.day, clean.clock.day));
      clean.clock.minute = clamp(numberOr(data.clock.minute, clean.clock.minute), 0, 1439.999);
      clean.clock.speed = CFG.CLOCK.SPEEDS.includes(data.clock.speed) ? data.clock.speed || 1 : 1;
      clean.clock.paused = Boolean(data.clock.paused);
    }
    const source = data.zone || {},
      zone = clean.zone;
    zone.hqId = Number.isInteger(source.hqId) ? source.hqId : null;
    zone.initialized = Boolean(source.initialized);
    zone.stock = resources(source.stock);
    zone.tech = Array.from({ length: CFG.TECH.COUNT }, (_, id) =>
      Boolean(source.tech && source.tech[id]),
    );
    zone.defense = normalizeDefense(source.defense);
    const citizenIds = [],
      jobIds = [],
      squadIds = [],
      fortificationIds = [],
      buildingIds = [];
    if (Array.isArray(source.citizens))
      for (let i = 0; i < source.citizens.length; i++) {
        const citizen = normalizeCitizen(source.citizens[i]);
        if (citizen && !citizenIds.includes(citizen.id)) {
          citizenIds.push(citizen.id);
          zone.citizens.push(citizen);
        }
      }
    if (Array.isArray(source.jobs))
      for (let i = 0; i < source.jobs.length; i++) {
        const job = normalizeJob(source.jobs[i]);
        if (job && !jobIds.includes(job.id)) {
          jobIds.push(job.id);
          zone.jobs.push(job);
        }
      }
    if (Array.isArray(source.squads))
      for (let i = 0; i < source.squads.length; i++) {
        const squad = normalizeSquad(source.squads[i]);
        if (squad && !squadIds.includes(squad.id)) {
          squadIds.push(squad.id);
          zone.squads.push(squad);
        }
      }
    if (Array.isArray(source.fortifications))
      for (let i = 0; i < source.fortifications.length; i++) {
        const fortification = normalizeFortification(source.fortifications[i]);
        if (fortification && fortification.hp > 0 && !fortificationIds.includes(fortification.id)) {
          fortificationIds.push(fortification.id);
          zone.fortifications.push(fortification);
        }
      }
    if (Array.isArray(source.buildings))
      for (let i = 0; i < source.buildings.length; i++) {
        const building = normalizeBuilding(source.buildings[i]);
        if (building && !buildingIds.includes(building.id)) {
          buildingIds.push(building.id);
          zone.buildings.push(building);
        }
      }
    const regionIds = [];
    if (Array.isArray(source.regions))
      for (let i = 0; i < source.regions.length; i++) {
        const region = normalizeRegion(source.regions[i]);
        if (region && !regionIds.includes(region.id)) {
          regionIds.push(region.id);
          zone.regions.push(region);
        }
      }
    zone.expedition = normalizeExpedition(source.expedition);
    zone.nextCitizenId = Math.max(1, intOr(source.nextCitizenId, 1));
    zone.nextJobId = Math.max(1, intOr(source.nextJobId, 1));
    zone.nextSquadId = Math.max(1, intOr(source.nextSquadId, 1));
    zone.nextFortificationId = Math.max(1, intOr(source.nextFortificationId, 1));
    for (let i = 0; i < zone.citizens.length; i++)
      zone.nextCitizenId = Math.max(zone.nextCitizenId, zone.citizens[i].id + 1);
    for (let i = 0; i < zone.jobs.length; i++)
      zone.nextJobId = Math.max(zone.nextJobId, zone.jobs[i].id + 1);
    for (let i = 0; i < zone.squads.length; i++)
      zone.nextSquadId = Math.max(zone.nextSquadId, zone.squads[i].id + 1);
    for (let i = 0; i < zone.fortifications.length; i++)
      zone.nextFortificationId = Math.max(zone.nextFortificationId, zone.fortifications[i].id + 1);
    return clean;
  }

  class ZoneSave {
    constructor(storage) {
      this.storage = storage === undefined ? ZoneSave.browserStorage() : storage;
    }

    static browserStorage() {
      try {
        return window.localStorage;
      } catch {
        return null;
      }
    }

    static migrate(raw) {
      if (!raw || typeof raw !== "object") return defaultData();
      let data = raw;
      if (data.v === 1) data = migrateV1(data);
      if (data.v === 2) data = migrateV2(data);
      if (data.v === 3) data = migrateV3(data);
      if (data.v === 4) data = migrateV4(data);
      if (data.v === 5) data = migrateV5(data);
      if (data.v === 6) data = migrateV6(data);
      if (data.v === 7) data = migrateV7(data);
      if (data.v === 8) data = migrateV8(data);
      return normalize(data);
    }

    static migrateV3(data) {
      return migrateV3(data);
    }

    static migrateV4(data) {
      return migrateV4(data);
    }

    static migrateV5(data) {
      return migrateV5(data);
    }

    static migrateV6(data) {
      return migrateV6(data);
    }

    static migrateV7(data) {
      return migrateV7(data);
    }

    static migrateV8(data) {
      return migrateV8(data);
    }

    static normalize(data) {
      return normalize(data);
    }

    load() {
      if (!this.storage) return defaultData();
      try {
        return ZoneSave.migrate(JSON.parse(this.storage.getItem(CFG.SAVE_KEY)));
      } catch {
        return defaultData();
      }
    }

    exists() {
      if (!this.storage) return false;
      try {
        return this.storage.getItem(CFG.SAVE_KEY) !== null;
      } catch {
        return false;
      }
    }

    write(data) {
      if (!this.storage) return false;
      try {
        this.storage.setItem(CFG.SAVE_KEY, JSON.stringify(normalize(data)));
        return true;
      } catch {
        return false;
      }
    }

    clear() {
      if (!this.storage) return;
      try {
        this.storage.removeItem(CFG.SAVE_KEY);
      } catch {}
    }
  }

  class ZoneState {
    constructor(options) {
      const opts = options || {};
      this.store = new ZoneSave(opts.storage);
      this.hasSave = opts.fresh ? false : this.store.exists();
      this.data = opts.fresh ? defaultData() : this.store.load();
      this.zone = this.data.zone;
      this.stock = this.zone.stock;
      this.day = this.data.clock.day;
      this.minute = this.data.clock.minute;
      this.speed = this.data.clock.speed;
      this.paused = this.data.clock.paused;
      this.seed = this.data.world.seed;
      this.hqId = this.zone.hqId;
      this.capture = null;
    }

    attachSeed(seed) {
      if (!Number.isInteger(this.seed)) this.seed = seed | 0;
      return this.seed;
    }

    setHQ(id) {
      this.hqId = Number.isInteger(id) ? id : null;
      this.zone.hqId = this.hqId;
    }

    setMapMeta(meta) {
      const world = this.data.world;
      world.configured = meta.configured !== false;
      world.source = meta.source === "osm" ? "osm" : "procedural";
      world.size = Object.hasOwn(CFG.MAP.SIZE_PRESETS, meta.size) ? meta.size : "classic";
      world.mapPackId = typeof meta.mapPackId === "string" ? meta.mapPackId : null;
      world.mapHash = typeof meta.mapHash === "string" ? meta.mapHash : null;
      world.name = typeof meta.name === "string" ? meta.name.slice(0, 120) : "Distrito procedural";
      world.center = meta.center || null;
      world.projection = typeof meta.projection === "string" ? meta.projection : null;
      world.dataTimestamp = typeof meta.dataTimestamp === "string" ? meta.dataTimestamp : null;
      world.elevationSource =
        typeof meta.elevationSource === "string" ? meta.elevationSource.slice(0, 80) : null;
    }

    setSpeed(speed) {
      if (!CFG.CLOCK.SPEEDS.includes(speed)) return false;
      if (speed === 0) this.paused = true;
      else {
        this.speed = speed;
        this.paused = false;
      }
      return true;
    }

    scale() {
      return this.paused ? 0 : this.speed;
    }

    advance(dt) {
      const previousDay = this.day;
      this.minute += dt * CFG.CLOCK.MINUTES_PER_SECOND;
      while (this.minute >= 1440) {
        this.minute -= 1440;
        this.day++;
      }
      return this.day !== previousDay;
    }

    phase() {
      const m = this.minute;
      if (m >= CFG.CLOCK.NIGHT || m < CFG.CLOCK.DAWN) return "night";
      if (m < CFG.CLOCK.DAY) return "dawn";
      if (m < CFG.CLOCK.DUSK) return "day";
      return "dusk";
    }

    clockText() {
      const total = Math.floor(this.minute),
        h = (total / 60) | 0,
        m = total % 60;
      return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
    }

    save() {
      if (this.capture) this.capture();
      this.data.v = CFG.SAVE_VERSION;
      this.data.world.seed = this.seed;
      this.data.clock.day = this.day;
      this.data.clock.minute = this.minute;
      this.data.clock.speed = this.speed;
      this.data.clock.paused = this.paused;
      this.zone.hqId = this.hqId;
      return this.store.write(this.data);
    }
  }

  ZS.ZoneSave = ZoneSave;
  ZS.ZoneState = ZoneState;
})();
