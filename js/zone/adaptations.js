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
      this.onResearchComplete = null;
      this.power = { capacity: 1, demand: 0, used: 0 };
      this.updateT = 0;
      this.medT = 0;
      this.overcrowded = false;
    }

    connect(citizens, tasks, onChanged, onResearchComplete) {
      this.citizens = citizens;
      this.tasks = tasks;
      this.onChanged = onChanged;
      this.onResearchComplete = onResearchComplete || null;
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
          [U.COOKHOUSE, U.WORKSHOP, U.RESEARCH, U.FARM, U.BARN].includes(record.use) &&
          !this.tasks.forBuilding(record.id)
        )
          this.tasks.postProduction(record.id);
        const job = this.tasks.forBuilding(record.id);
        if (job && job.type === CFG.JOB.RESEARCH)
          job.capacity = Math.min(job.capacity, this.researchCapacity(record));
        else if (job && job.type === CFG.JOB.PRODUCE)
          job.capacity = this.productionCapacity(record);
      }
    }

    research(tech) {
      this.recalculatePower();
      if (this.researchBlockReason(tech)) return false;
      const cost = CFG.RESEARCH.COSTS[tech];
      this.state.stock[R.SCIENCE] -= cost;
      this.state.zone.research.current = tech;
      this.state.zone.research.progress = 0;
      if (this.onChanged) this.onChanged();
      return true;
    }

    researchBlockReason(tech) {
      if (!Number.isInteger(tech) || tech <= 0 || tech >= T.COUNT)
        return "Proyecto de investigación inválido.";
      if (this.state.zone.tech[tech]) return "Esta tecnología ya fue investigada.";
      const current = this.state.zone.research.current;
      if (current)
        return current === tech
          ? "Esta tecnología ya está en curso."
          : "Termina la investigación actual antes de iniciar otra.";
      if (
        [T.FERTILIZATION, T.GREENHOUSES, T.EFFICIENT_COOKING].includes(tech) &&
        !this.state.zone.tech[T.AGRICULTURE]
      )
        return "Primero investiga Agricultura.";
      let centers = 0,
        operational = 0,
        assigned = 0;
      for (let i = 0; i < this.map.records.length; i++) {
        const record = this.map.records[i];
        if (record.use !== U.RESEARCH) continue;
        centers++;
        if (!record.active || !record.powered || record.hp <= 0) continue;
        operational++;
        const job = this.tasks && this.tasks.forBuilding(record.id);
        if (job && job.type === CFG.JOB.RESEARCH && job.priority !== CFG.PRIORITY.OFF)
          assigned += job.assigned.length;
      }
      if (!centers) return "Adapta primero un centro de investigación.";
      if (!operational) return "Hace falta un centro activo, intacto y con energía.";
      if (!assigned) return "Asigna al menos un habitante al centro de investigación.";
      if (this.state.stock[R.SCIENCE] < CFG.RESEARCH.COSTS[tech])
        return "No hay suficientes materiales de ciencia.";
      return "";
    }

    workResearch(record, dt) {
      if (
        !record ||
        record.use !== U.RESEARCH ||
        !record.active ||
        !record.powered ||
        record.hp <= 0 ||
        dt <= 0
      )
        return false;
      const research = this.state.zone.research,
        tech = research.current;
      if (tech) {
        research.progress += dt;
        if (research.progress >= CFG.RESEARCH.WORK[tech]) this._completeResearch(tech);
        return true;
      }
      research.materialProgress += dt;
      if (research.materialProgress >= CFG.RESEARCH.SCIENCE_SECONDS) {
        const produced = Math.floor(research.materialProgress / CFG.RESEARCH.SCIENCE_SECONDS);
        research.materialProgress -= produced * CFG.RESEARCH.SCIENCE_SECONDS;
        this.state.stock[R.SCIENCE] += produced;
        if (this.onChanged) this.onChanged();
      }
      return true;
    }

    _completeResearch(tech) {
      const research = this.state.zone.research;
      this.state.zone.tech[tech] = true;
      research.current = 0;
      research.progress = 0;
      if (tech === T.FORTIFICATIONS)
        for (let i = 0; i < this.map.records.length; i++) {
          const record = this.map.records[i];
          if (record.use === U.ABANDONED || record.maxHP <= 0) continue;
          const oldMax = record.maxHP;
          record.maxHP *= 1.35;
          record.hp += record.maxHP - oldMax;
        }
      if (this.onChanged) this.onChanged();
      if (this.onResearchComplete) this.onResearchComplete(tech);
    }

    researchCapacity(record) {
      if (!record) return 1;
      const area = Number.isFinite(record.area) ? record.area : 0;
      return Math.max(
        1,
        Math.min(CFG.RESEARCH.MAX_STAFF, Math.round(area / CFG.RESEARCH.AREA_PER_STAFF)),
      );
    }

    setResearchStaff(buildingId, delta) {
      const record = this.map.at(buildingId),
        job = record && this.tasks.forBuilding(record.id);
      if (!record || record.use !== U.RESEARCH || !job || job.type !== CFG.JOB.RESEARCH)
        return false;
      const max = this.researchCapacity(record);
      if (delta < 0) {
        if (job.priority === CFG.PRIORITY.OFF) return false;
        if (job.capacity <= 1) return this.tasks.setPriority(job.id, CFG.PRIORITY.OFF);
        return this.tasks.setCapacity(job.id, job.capacity - 1);
      }
      if (delta > 0) {
        if (job.priority === CFG.PRIORITY.OFF)
          return this.tasks.setPriority(job.id, this.tasks.defaultPriorityFor(job));
        if (job.capacity >= max) return false;
        return this.tasks.setCapacity(job.id, job.capacity + 1);
      }
      return false;
    }

    _workingResearchers(job) {
      if (!job || !this.citizens) return 0;
      let working = 0;
      for (let i = 0; i < job.assigned.length; i++) {
        const worker = this.citizens.at(job.assigned[i]);
        if (
          worker &&
          !worker.dead &&
          worker.jobId === job.id &&
          worker.workerState === CFG.WORKER_STATE.WORKING
        )
          working++;
      }
      return working;
    }

    researchModel() {
      const centers = [];
      let assigned = 0,
        working = 0,
        maxStaff = 0;
      for (let i = 0; i < this.map.records.length; i++) {
        const record = this.map.records[i];
        if (record.use !== U.RESEARCH) continue;
        const job = this.tasks && this.tasks.forBuilding(record.id),
          centerAssigned = job ? job.assigned.length : 0,
          operational = record.active && record.powered && record.hp > 0,
          centerWorking = operational ? this._workingResearchers(job) : 0,
          centerMax = this.researchCapacity(record);
        assigned += centerAssigned;
        working += centerWorking;
        maxStaff += centerMax;
        centers.push({
          id: record.id,
          active: record.active,
          powered: Boolean(record.powered),
          hp: record.hp,
          assigned: centerAssigned,
          working: centerWorking,
          capacity: job && job.priority !== CFG.PRIORITY.OFF ? job.capacity : 0,
          max: centerMax,
        });
      }
      const research = this.state.zone.research,
        work = research.current ? CFG.RESEARCH.WORK[research.current] : 0;
      return {
        current: research.current,
        progress: research.progress,
        work,
        materialProgress: research.materialProgress,
        assigned,
        working,
        maxStaff,
        centers,
        controller: this,
      };
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
      if (job && (job.type === CFG.JOB.PRODUCE || job.type === CFG.JOB.RESEARCH))
        this.tasks.setPriority(
          job.id,
          record.active ? this.tasks.defaultPriorityFor(job) : CFG.PRIORITY.OFF,
        );
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
