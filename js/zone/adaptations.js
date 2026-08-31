/* Phase-four settlement layer: finite construction costs, stable research
   unlocks, power allocation and staffed production in adapted buildings. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});
  const CFG = ZS.ZoneConfig;
  const R = CFG.RESOURCE;
  const U = CFG.BUILDING_USE;
  const T = CFG.TECH;

  const POWERED_USES = Object.freeze([
    U.COOKHOUSE,
    U.WORKSHOP,
    U.RESEARCH,
    U.MEDBAY,
    U.FARM,
    U.BARN,
  ]);

  class ZoneAdaptations {
    constructor(state, map) {
      this.state = state;
      this.map = map;
      this.citizens = null;
      this.tasks = null;
      this.onChanged = null;
      this.power = { capacity: 1, demand: 0, used: 0 };
      this.updateT = 0;
      this.medT = 0;
      this.overcrowded = false;
    }

    connect(citizens, tasks, onChanged) {
      this.citizens = citizens;
      this.tasks = tasks;
      this.onChanged = onChanged;
      this.recalculatePower();
      this.ensureProductionJobs();
    }

    isUnlocked(use) {
      if (use === U.FARM) return Boolean(this.state.zone.tech[T.GREENHOUSES]);
      if (use === U.POWER) return Boolean(this.state.zone.tech[T.POWER]);
      if (use === U.BARN) return true;
      return use >= U.SHELTER && use <= U.SQUAD_QUARTERS;
    }

    cost(use) {
      return CFG.ADAPT.COSTS[use] || null;
    }

    canAfford(use) {
      const cost = this.cost(use);
      if (!cost) return false;
      for (let i = 0; i < R.COUNT; i++) if (this.state.stock[i] < (cost[i] || 0)) return false;
      return true;
    }

    start(record, use) {
      if (
        !record ||
        record === this.map.hq ||
        record.use !== U.ABANDONED ||
        !record.revealed ||
        !record.cleared ||
        !this.isUnlocked(use) ||
        !this.canAfford(use)
      )
        return null;
      return this.tasks.postBuild(record.id, use, this.cost(use));
    }

    complete(record, use) {
      const fortified = Boolean(this.state.zone.tech[T.FORTIFICATIONS]);
      if (!this.map.adapt(record, use, fortified)) return false;
      this.recalculatePower();
      if (this.onChanged) this.onChanged();
      return true;
    }

    ensureProductionJobs() {
      for (let i = 0; i < this.map.records.length; i++) {
        const record = this.map.records[i];
        if (
          [U.COOKHOUSE, U.WORKSHOP, U.FARM, U.BARN].includes(record.use) &&
          !this.tasks.forBuilding(record.id)
        )
          this.tasks.postProduction(record.id);
        const job = this.tasks.forBuilding(record.id);
        if (job && job.type === CFG.JOB.PRODUCE) job.capacity = this.productionCapacity(record);
      }
    }

    research(tech) {
      if (!Number.isInteger(tech) || tech <= 0 || tech >= T.COUNT) return false;
      if (this.state.zone.tech[tech] || this.map.countUse(U.RESEARCH) <= 0) return false;
      if (
        [T.FERTILIZATION, T.GREENHOUSES, T.EFFICIENT_COOKING].includes(tech) &&
        !this.state.zone.tech[T.AGRICULTURE]
      )
        return false;
      const cost = CFG.RESEARCH.COSTS[tech];
      if (this.state.stock[R.SCIENCE] < cost) return false;
      this.state.stock[R.SCIENCE] -= cost;
      this.state.zone.tech[tech] = true;
      if (tech === T.FORTIFICATIONS)
        for (let i = 0; i < this.map.records.length; i++) {
          const record = this.map.records[i];
          if (record.use === U.ABANDONED || record.maxHP <= 0) continue;
          const oldMax = record.maxHP;
          record.maxHP *= 1.35;
          record.hp += record.maxHP - oldMax;
        }
      if (this.onChanged) this.onChanged();
      return true;
    }

    setRecipe(record, recipe) {
      if (
        !record ||
        record.use !== U.COOKHOUSE ||
        (recipe !== CFG.RECIPE.GRAIN && recipe !== CFG.RECIPE.MEAT)
      )
        return false;
      record.recipe = recipe;
      if (this.onChanged) this.onChanged();
      return true;
    }

    toggleFertilizer(record) {
      if (!record || record.use !== U.FARM || !this.state.zone.tech[T.FERTILIZATION]) return false;
      record.fertilized = !record.fertilized;
      if (this.onChanged) this.onChanged();
      return true;
    }

    toggle(record) {
      if (!record || record.use === U.ABANDONED || record === this.map.hq) return false;
      record.active = !record.active;
      const job = this.tasks.forBuilding(record.id);
      if (job && job.type === CFG.JOB.PRODUCE)
        this.tasks.setPriority(job.id, record.active ? CFG.PRIORITY.NORMAL : CFG.PRIORITY.OFF);
      this.recalculatePower();
      if (this.onChanged) this.onChanged();
      return true;
    }

    repair(record) {
      if (!record || record.maxHP <= 0 || record.hp >= record.maxHP) return false;
      const units = Math.max(1, Math.ceil((record.maxHP - record.hp) / 25));
      if (this.state.stock[R.WOOD] < units || this.state.stock[R.BRICK] < units) return false;
      this.state.stock[R.WOOD] -= units;
      this.state.stock[R.BRICK] -= units;
      record.hp = Math.min(record.maxHP, record.hp + units * 25);
      if (this.onChanged) this.onChanged();
      return true;
    }

    recalculatePower() {
      const power = this.power;
      power.capacity = 1 + this.map.countUse(U.POWER) * CFG.ADAPT.POWER_PER_GENERATOR;
      power.demand = 0;
      power.used = 0;
      for (let i = 0; i < this.map.records.length; i++) this.map.records[i].powered = false;
      for (let i = 0; i < this.map.records.length; i++) {
        const record = this.map.records[i];
        if (!record.active || record.hp <= 0 || !POWERED_USES.includes(record.use)) continue;
        power.demand++;
        if (power.used < power.capacity) {
          record.powered = true;
          power.used++;
        }
      }
      return power;
    }

    update(dt) {
      this.updateT += dt;
      if (this.updateT >= 0.5) {
        this.updateT = 0;
        this.recalculatePower();
        this.overcrowded = this.citizens.stats().population > this.housingCapacity();
      }
      this.medT += dt;
      if (this.medT < CFG.ADAPT.MEDBAY_SECONDS || this.map.countUse(U.MEDBAY) <= 0) return;
      this.medT = 0;
      let bay = null;
      for (let i = 0; i < this.map.records.length; i++)
        if (this.map.records[i].use === U.MEDBAY && this.map.records[i].powered) {
          bay = this.map.records[i];
          break;
        }
      if (!bay || this.state.stock[R.MEDICINE] <= 0) return;
      for (let i = 0; i < this.citizens.byId.length; i++) {
        const citizen = this.citizens.byId[i];
        if (!citizen || citizen.dead || citizen.hp >= citizen.maxHP) continue;
        this.state.stock[R.MEDICINE]--;
        const bonus = this.state.zone.tech[T.MEDICINE] ? 1.5 : 1;
        citizen.hp = Math.min(citizen.maxHP, citizen.hp + CFG.ADAPT.MEDBAY_HEAL * bonus);
        if (this.onChanged) this.onChanged();
        break;
      }
    }

    produce(record) {
      if (!record || !record.active || !record.powered || record.hp <= 0) return false;
      if (record.use === U.FARM) {
        const fertilized = record.fertilized && this.state.zone.tech[T.FERTILIZATION];
        if (fertilized) this.state.stock[R.FERTILIZER] -= CFG.ADAPT.FARM_FERTILIZER;
        this.state.stock[R.GRAIN] += fertilized
          ? CFG.ADAPT.FARM_FERTILIZED_GRAIN
          : CFG.ADAPT.FARM_GRAIN;
        return true;
      }
      if (record.use === U.BARN) {
        this.state.stock[R.GRAIN] -= CFG.ADAPT.BARN_GRAIN;
        this.state.stock[R.MEAT] += CFG.ADAPT.BARN_MEAT;
        this.state.stock[R.FERTILIZER] += CFG.ADAPT.BARN_FERTILIZER;
        return true;
      }
      if (record.use === U.COOKHOUSE) {
        this.state.stock[R.WOOD] -= CFG.ADAPT.COOKHOUSE_WOOD;
        if (record.recipe === CFG.RECIPE.GRAIN) {
          this.state.stock[R.GRAIN] -= CFG.ADAPT.COOKHOUSE_GRAIN;
          this.state.stock[R.FOOD] += CFG.ADAPT.COOKHOUSE_GRAIN_FOOD;
        } else {
          this.state.stock[R.MEAT] -= CFG.ADAPT.COOKHOUSE_MEAT;
          this.state.stock[R.FOOD] += CFG.ADAPT.COOKHOUSE_MEAT_FOOD;
        }
        return true;
      }
      if (record.use === U.WORKSHOP && this.state.stock[R.METAL] >= CFG.ADAPT.WORKSHOP_METAL) {
        this.state.stock[R.METAL] -= CFG.ADAPT.WORKSHOP_METAL;
        this.state.stock[R.AMMO] += CFG.ADAPT.WORKSHOP_AMMO;
        return true;
      }
      return false;
    }

    productionSeconds(record) {
      if (!record) return Infinity;
      if (record.use === U.FARM) return CFG.ADAPT.FARM_SECONDS;
      if (record.use === U.BARN) return CFG.ADAPT.BARN_SECONDS;
      if (record.use === U.COOKHOUSE)
        return CFG.ADAPT.COOKHOUSE_SECONDS * (this.state.zone.tech[T.EFFICIENT_COOKING] ? 0.75 : 1);
      return CFG.ADAPT.WORKSHOP_SECONDS;
    }

    productionCapacity(record) {
      if (!record) return 1;
      if (record.use === U.FARM || record.use === U.WORKSHOP) return record.use === U.FARM ? 2 : 1;
      return Math.max(1, Math.min(12, Math.round(record.area / 7000)));
    }

    canProduce(record) {
      if (!record || !record.active || !record.powered || record.hp <= 0) return false;
      if (record.use === U.FARM)
        return (
          !record.fertilized ||
          (this.state.zone.tech[T.FERTILIZATION] &&
            this.state.stock[R.FERTILIZER] >= CFG.ADAPT.FARM_FERTILIZER)
        );
      if (record.use === U.BARN) return this.state.stock[R.GRAIN] >= CFG.ADAPT.BARN_GRAIN;
      if (record.use === U.COOKHOUSE)
        return (
          this.state.stock[R.WOOD] >= CFG.ADAPT.COOKHOUSE_WOOD &&
          (record.recipe === CFG.RECIPE.GRAIN
            ? this.state.stock[R.GRAIN] >= CFG.ADAPT.COOKHOUSE_GRAIN
            : this.state.stock[R.MEAT] >= CFG.ADAPT.COOKHOUSE_MEAT)
        );
      if (record.use === U.WORKSHOP) return this.state.stock[R.METAL] >= CFG.ADAPT.WORKSHOP_METAL;
      return false;
    }

    productionStatus(record) {
      if (!record || record.hp <= 0) return "destruido";
      if (!record.active) return "pausado";
      if (!record.powered) return "sin energía";
      if (!this.canProduce(record)) {
        if (record.use === U.FARM && record.fertilized) return "sin fertilizante";
        if (record.use === U.BARN) return "sin grano";
        if (record.use === U.COOKHOUSE)
          return record.recipe === CFG.RECIPE.GRAIN ? "sin grano o madera" : "sin carne o madera";
        return "sin insumos";
      }
      return "produciendo";
    }

    foodReliefMultiplier() {
      return 1;
    }

    housingCapacity() {
      let capacity = this.map.hq ? this.map.hq.capacity : 0;
      for (let i = 0; i < this.map.records.length; i++) {
        const record = this.map.records[i];
        if (record.use === U.SHELTER && record.hp > 0)
          capacity += Math.max(4, Math.floor(record.area / 650));
      }
      return capacity;
    }

    storageCapacity() {
      let capacity = this.map.hq ? Math.max(160, this.map.hq.capacity * 10) : 0;
      for (let i = 0; i < this.map.records.length; i++) {
        const record = this.map.records[i];
        if (record.use === U.WAREHOUSE && record.hp > 0)
          capacity += Math.max(120, Math.floor(record.area / 32));
      }
      return capacity;
    }

    squadCapacity() {
      return 2 + this.map.countUse(U.SQUAD_QUARTERS);
    }
  }

  ZS.ZoneAdaptations = ZoneAdaptations;
})();
