/* Infection-zone mode configuration. All persistent IDs and tuning values
   live here so saves do not depend on display strings or object order. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});

  const RESOURCE = Object.freeze({
    FOOD: 0,
    WOOD: 1,
    METAL: 2,
    BRICK: 3,
    AMMO: 4,
    MEDICINE: 5,
    SCIENCE: 6,
    COUNT: 7,
  });

  const JOB = Object.freeze({
    IDLE: 0,
    BUILD: 1,
    REPAIR: 2,
    GATHER: 3,
    HAUL: 4,
    PRODUCE: 5,
    SALVAGE: 6,
  });

  const ROLE = Object.freeze({
    WORKER: 1,
    SQUAD: 2,
    INJURED: 3,
    DEAD: 4,
  });

  const WORKER_STATE = Object.freeze({
    IDLE: 0,
    TO_JOB: 1,
    WORKING: 2,
    RETURNING: 3,
    RESTING: 4,
  });

  const JOB_STATE = Object.freeze({ ACTIVE: 1, COMPLETE: 2, CANCELED: 3 });
  const PRIORITY = Object.freeze({ OFF: 0, LOW: 1, NORMAL: 2, HIGH: 3 });

  const BUILDING_USE = Object.freeze({
    ABANDONED: 0,
    HQ: 1,
    SHELTER: 2,
    WAREHOUSE: 3,
    COOKHOUSE: 4,
    WORKSHOP: 5,
    RESEARCH: 6,
    MEDBAY: 7,
    SQUAD_QUARTERS: 8,
    FARM: 9,
    POWER: 10,
  });

  const TECH = Object.freeze({
    AGRICULTURE: 1,
    POWER: 2,
    FORTIFICATIONS: 3,
    MEDICINE: 4,
    COUNT: 5,
  });

  const ORDER = Object.freeze({
    MOVE: 1,
    ENTER: 2,
    SCAVENGE: 3,
    PATROL: 4,
    RETURN_HQ: 5,
    ATTACK_MOVE: 6,
  });

  const FORTIFICATION = Object.freeze({ WALL: 1, GATE: 2, TOWER: 3, TRAP: 4, COUNT: 5 });
  const ENEMY = Object.freeze({ SHAMBLER: 0, RUNNER: 1, BRUTE: 2, COUNT: 3 });

  const POI = Object.freeze({
    RESIDENCE: 1,
    GROCERY: 2,
    PHARMACY: 3,
    POLICE: 4,
    WAREHOUSE: 5,
    WORKSHOP: 6,
    LIBRARY: 7,
  });

  const WEAPON = Object.freeze({ MACHETE: 1, PISTOL: 2, RIFLE: 3, COUNT: 4 });

  ZS.ZoneConfig = Object.freeze({
    SAVE_KEY: "zs.zone",
    SAVE_VERSION: 9,
    RESOURCE,
    JOB,
    ROLE,
    WORKER_STATE,
    JOB_STATE,
    PRIORITY,
    BUILDING_USE,
    ORDER,
    FORTIFICATION,
    ENEMY,
    POI,
    WEAPON,
    TECH,
    CLOCK: Object.freeze({
      START_DAY: 1,
      START_MINUTE: 7 * 60,
      MINUTES_PER_SECOND: 4,
      SPEEDS: Object.freeze([0, 1, 2, 4]),
      DAWN: 5 * 60,
      DAY: 7 * 60,
      DUSK: 18 * 60,
      NIGHT: 20 * 60,
    }),
    MAP: Object.freeze({
      BUILDING_DENSITY: 8,
      MAX_BUILDINGS: 72,
      BUILDING_SPREAD: 1.9,
      BUILDING_PAD: 20,
      BUILDING_TRIES: 140,
      BUILDING_SCALE_MIN: 0.5,
      BUILDING_SCALE_RANGE: 0.3,
      MIN_HQ_AREA: 7000,
      ROAD_WIDTH: 34,
      PIXELS_PER_METER: 4,
      SECTOR_METERS: 600,
      CHUNK_SIZE: 1024,
      SIZE_PRESETS: Object.freeze({
        classic: Object.freeze({ id: "classic", cells: 0, w: 3200, h: 2400 }),
        compact: Object.freeze({ id: "compact", cells: 1, w: 2400, h: 2400 }),
        standard: Object.freeze({ id: "standard", cells: 3, w: 7200, h: 7200 }),
        large: Object.freeze({ id: "large", cells: 5, w: 12000, h: 12000 }),
      }),
      MAX_BUILDINGS_BY_SIZE: Object.freeze({
        classic: 72,
        compact: 96,
        standard: 480,
        large: 1200,
      }),
    }),
    GEO: Object.freeze({
      NOMINATIM_URL: "https://nominatim.openstreetmap.org/search",
      OVERPASS_URL: "https://overpass-api.de/api/interpreter",
      OSM_MAP_URL: "https://api.openstreetmap.org/api/0.6/map",
      TILE_URL: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      TERRAIN_URL: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium",
      TERRAIN_ZOOM: 14,
      ELEVATION_SAMPLES: 9,
      NAV_CELL: 10,
      REQUEST_TIMEOUT_MS: 45000,
      MAP_PACK_VERSION: 1,
      CACHE_DB: "zs-zone-maps",
      CACHE_STORE: "packs",
      ATTRIBUTION: "© OpenStreetMap contributors · ODbL",
    }),
    AGENT: Object.freeze({
      START_COUNT: 16,
      START_SQUAD_COUNT: 4,
      SPEED: 92,
      ARRIVE_R: 10,
      SELECT_R: 20,
      FORMATION_GAP: 22,
      MAX_ORDERS: 12,
    }),
    CITIZEN: Object.freeze({
      MAX_HP: 100,
      START_MORAL: 78,
      HUNGER_PER_SECOND: 0.014,
      FOOD_AT_HUNGER: 1,
      FOOD_RELIEF: 28,
      STARVE_MORAL_PER_SECOND: 0.18,
      STARVE_HP_PER_SECOND: 0.08,
      REST_MORAL_PER_SECOND: 0.08,
      CARRY_CAPACITY: 8,
    }),
    STOCK: Object.freeze({ FOOD: 80, WOOD: 0, METAL: 0, BRICK: 0, AMMO: 32, MEDICINE: 4 }),
    TASK: Object.freeze({
      SALVAGE_CAPACITY: 3,
      SALVAGE_SECONDS: 1.8,
      BUILD_CAPACITY: 3,
      BUILD_SECONDS: 18,
      PRODUCE_CAPACITY: 1,
      RECONCILE_SECONDS: 1.5,
    }),
    SQUAD: Object.freeze({
      MAX_MEMBERS: 4,
      INVENTORY_CAPACITY: 36,
      FORMATION_GAP: 20,
      FIRE_RANGE: 170,
      MELEE_RANGE: 23,
      FIRE_SECONDS: 0.75,
      MELEE_SECONDS: 0.65,
      START_AMMO: 16,
      START_MEDICINE: 1,
    }),
    SCAVENGE: Object.freeze({ TICK_SECONDS: 0.45, ENCOUNTER_HP: 3, ATTACK_SECONDS: 1.05 }),
    ADAPT: Object.freeze({
      COSTS: Object.freeze({
        2: Object.freeze([0, 12, 0, 8, 0, 0, 0]),
        3: Object.freeze([0, 10, 4, 8, 0, 0, 0]),
        4: Object.freeze([0, 10, 6, 6, 0, 0, 0]),
        5: Object.freeze([0, 12, 10, 4, 0, 0, 0]),
        6: Object.freeze([0, 12, 8, 8, 0, 0, 0]),
        7: Object.freeze([0, 10, 6, 8, 0, 0, 0]),
        8: Object.freeze([0, 16, 8, 8, 0, 0, 0]),
        9: Object.freeze([0, 14, 4, 6, 0, 0, 0]),
        10: Object.freeze([0, 12, 12, 4, 0, 0, 0]),
      }),
      POWER_PER_GENERATOR: 4,
      FARM_SECONDS: 8,
      FARM_FOOD: 3,
      WORKSHOP_SECONDS: 10,
      WORKSHOP_METAL: 1,
      WORKSHOP_AMMO: 3,
      MEDBAY_SECONDS: 5,
      MEDBAY_HEAL: 18,
    }),
    RESEARCH: Object.freeze({
      COSTS: Object.freeze([0, 8, 10, 12, 8]),
    }),
    DEFENSE: Object.freeze({
      GRID: 40,
      ALERT_MINUTES: 60,
      MAX_DISTANCE_FROM_HQ: 760,
      COSTS: Object.freeze({
        1: Object.freeze([0, 4, 0, 2, 0, 0, 0]),
        2: Object.freeze([0, 5, 2, 1, 0, 0, 0]),
        3: Object.freeze([0, 8, 6, 4, 0, 0, 0]),
        4: Object.freeze([0, 2, 2, 0, 0, 0, 0]),
      }),
      HP: Object.freeze([0, 90, 75, 110, 1]),
      TOWER_RANGE: 210,
      TOWER_SECONDS: 0.9,
      TOWER_DAMAGE: 2,
      TRAP_RANGE: 23,
      TRAP_DAMAGE: 4,
      GARRISON_RANGE_MULTIPLIER: 1.35,
      GARRISON_DAMAGE_MULTIPLIER: 0.45,
      RETREAT_SPEED_MULTIPLIER: 1.2,
    }),
    HORDE: Object.freeze({
      BASE_COUNT: 8,
      PER_DAY: 3,
      SPAWN_SECONDS: 2.4,
      HP_BASE: 3,
      HP_PER_DAY: 0.35,
      SPEED: 66,
      AGGRO_RANGE: 260,
      ATTACK_RANGE: 18,
      ATTACK_SECONDS: 1.05,
      CITIZEN_DAMAGE: 8,
      BUILDING_DAMAGE: 7,
      HQ_MAX_HP: 260,
      BUILDING_MAX_HP: 120,
    }),
  });
})();
