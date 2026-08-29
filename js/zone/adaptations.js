/* Phase-four settlement layer: finite construction costs, stable research
   unlocks, power allocation and staffed production in adapted buildings. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});
  const CFG = ZS.ZoneConfig;
  const R = CFG.RESOURCE;
  const U = CFG.BUILDING_USE;
  const T = CFG.TECH;

  const POWERED_USES = Object.freeze([U.COOKHOUSE, U.WORKSHOP, U.RESEARCH, U.MEDBAY, U.FARM]);

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
      this.foodMultiplier = 1;
    }

    connect(citizens, tasks, onChanged) {
      this.citizens = citizens;
      this.tasks = tasks;
      this.onChanged = onChanged;
      this.recalculatePower();
      this.ensureProductionJobs();
    }

    isUnlocked(use) {
      if (use === U.FARM) return Boolean(this.state.zone.tech[T.AGRICULTURE]);
      if (use === U.POWER) return Boolean(this.state.zone.tech[T.POWER]);
      return use >= U.SHELTER && use <= U.SQUAD_QUARTERS;
    }

    cost(use) {
      return CFG.ADAPT.COSTS[use] || null;
    }

    canAfford(use) {
      const cost = this.cost(use);
      if (!cost) return false;
      for (let i = 0; i < R.COUNT; i++) if (this.state.stock[i] < cost[i]) return false;
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
          (record.use === U.FARM || record.use === U.WORKSHOP) &&
          !this.tasks.forBuilding(record.id)
        )
          this.tasks.postProduction(record.id);
      }
    }

    research(tech) {
      if (!Number.isInteger(tech) || tech <= 0 || tech >= T.COUNT) return false;
      if (this.state.zone.tech[tech] || this.map.countUse(U.RESEARCH) <= 0) return false;
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
      this.foodMultiplier = 1;
      for (let i = 0; i < this.map.records.length; i++) this.map.records[i].powered = false;
      for (let i = 0; i < this.map.records.length; i++) {
        const record = this.map.records[i];
        if (!record.active || record.hp <= 0 || !POWERED_USES.includes(record.use)) continue;
        power.demand++;
        if (power.used < power.capacity) {
          record.powered = true;
          power.used++;
          if (record.use === U.COOKHOUSE) this.foodMultiplier = 1.35;
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
        this.state.stock[R.FOOD] += CFG.ADAPT.FARM_FOOD;
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
      return record && record.use === U.FARM ? CFG.ADAPT.FARM_SECONDS : CFG.ADAPT.WORKSHOP_SECONDS;
    }

    foodReliefMultiplier() {
      return this.foodMultiplier;
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
