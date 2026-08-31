/* Persistent citizens and their slow needs. Movement and jobs are delegated
   to task/squad controllers; citizen IDs never depend on core array indices. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});
  const CFG = ZS.ZoneConfig;
  const R = CFG.RESOURCE;
  const FIRST_NAMES = Object.freeze([
    "Adriana",
    "Amalia",
    "Bruno",
    "Camilo",
    "Celia",
    "Damián",
    "Elena",
    "Eva",
    "Fabián",
    "Gabriel",
    "Inés",
    "Irene",
    "Jairo",
    "Julia",
    "Lina",
    "Lucía",
    "Mateo",
    "Nadia",
    "Noé",
    "Omar",
    "Pilar",
    "Rafael",
    "Sara",
    "Tomás",
    "Vera",
    "Yago",
  ]);
  const LAST_NAMES = Object.freeze([
    "Acosta",
    "Becerra",
    "Cano",
    "Duarte",
    "Ferrer",
    "Galán",
    "Ibarra",
    "León",
    "Mora",
    "Nieves",
    "Pardo",
    "Ríos",
    "Soler",
    "Vega",
  ]);

  function emptyResources() {
    return Array.from({ length: R.COUNT }, () => 0);
  }

  class ZoneCitizens {
    constructor(state, map) {
      this.state = state;
      this.map = map;
      this.byId = [];
      this.agents = null;
      this.tasks = null;
      this.squads = null;
      this.onChanged = null;
      this.needStamp = 0;
      this.adaptations = null;
      this.campaign = null;
      this.makeAgent = null;
    }

    connect(tasks, squads, onChanged) {
      this.tasks = tasks;
      this.squads = squads;
      this.onChanged = onChanged;
    }

    connectAdaptations(adaptations) {
      this.adaptations = adaptations;
    }

    connectCampaign(campaign) {
      this.campaign = campaign;
    }

    initialize(agents, makeAgent) {
      this.agents = agents;
      this.makeAgent = makeAgent;
      this.byId.length = 0;
      const saved = this.state.zone.citizens;
      if (this.state.zone.initialized) {
        for (let i = 0; i < saved.length; i++) {
          const raw = saved[i];
          if (raw.role === CFG.ROLE.DEAD || raw.hp <= 0) continue;
          const agent = makeAgent(raw.x, raw.y, 0);
          this._apply(agent, raw);
          agents.push(agent);
          this.byId[agent.cid] = agent;
        }
        return;
      }
      if (!this.map.hq) return;
      this.state.zone.initialized = true;
      this.state.stock[R.FOOD] = CFG.STOCK.FOOD;
      this.state.stock[R.WOOD] = CFG.STOCK.WOOD;
      this.state.stock[R.METAL] = CFG.STOCK.METAL;
      this.state.stock[R.BRICK] = CFG.STOCK.BRICK;
      this.state.stock[R.AMMO] = CFG.STOCK.AMMO;
      this.state.stock[R.MEDICINE] = CFG.STOCK.MEDICINE;
      const door = this.map.hq.shape.door,
        origin = door ? door.inner : this.map.hq,
        cols = 4;
      for (let i = 0; i < CFG.AGENT.START_COUNT; i++) {
        const x = origin.x + ((i % cols) - 1.5) * 16,
          y = origin.y + (((i / cols) | 0) - 1.5) * 16,
          point = this.map.nav.nearestWalkable(x, y, 100, false),
          agent = makeAgent(point ? point.x : origin.x, point ? point.y : origin.y, 0),
          id = this.state.zone.nextCitizenId++;
        this._apply(agent, {
          id,
          x: agent.x,
          y: agent.y,
          hp: CFG.CITIZEN.MAX_HP,
          maxHP: CFG.CITIZEN.MAX_HP,
          moral: CFG.CITIZEN.START_MORAL,
          hunger: 0,
          role: i < CFG.AGENT.START_SQUAD_COUNT ? CFG.ROLE.SQUAD : CFG.ROLE.WORKER,
          workerState: CFG.WORKER_STATE.IDLE,
          jobId: null,
          carry: emptyResources(),
          squadId: null,
          weapon: i === 0 ? CFG.WEAPON.RIFLE : i < 3 ? CFG.WEAPON.PISTOL : CFG.WEAPON.MACHETE,
        });
        agents.push(agent);
        this.byId[id] = agent;
      }
      this.capture();
    }

    _apply(agent, raw) {
      agent.cid = raw.id;
      agent.hp = raw.hp;
      agent.maxHP = raw.maxHP;
      agent.moral = raw.moral;
      agent.hunger = raw.hunger;
      agent.role = raw.role;
      agent.workerState = raw.workerState;
      agent.jobId = raw.jobId;
      agent.carry = emptyResources();
      for (let i = 0; i < R.COUNT; i++) agent.carry[i] = raw.carry[i] || 0;
      agent.squadId = raw.squadId;
      agent.weapon = raw.weapon || CFG.WEAPON.MACHETE;
      agent.zoneCitizen = true;
      agent.formationTarget = { x: agent.x, y: agent.y };
      agent.workTarget = { x: agent.x, y: agent.y };
      agent.workT = 0;
      agent.attackT = 0;
      agent.name = raw.name || this._nameFor(raw.id);
      agent.arrivalDay = Math.max(1, raw.arrivalDay || 1);
    }

    _nameFor(id) {
      const seed = (this.state.seed || 1) + id * 977,
        first = FIRST_NAMES[(ZS.hash(seed) * FIRST_NAMES.length) | 0],
        last = LAST_NAMES[(ZS.hash(seed + 431) * LAST_NAMES.length) | 0];
      return first + " " + last;
    }

    recruit(count, options) {
      if (!this.map.hq || !this.makeAgent || !this.agents) return [];
      const added = [],
        total = Math.max(0, Math.min(12, count | 0)),
        opts = options || {},
        door = this.map.hq.shape.door,
        origin = door ? door.front : this.map.hq;
      for (let i = 0; i < total; i++) {
        const angle = (i / Math.max(1, total)) * Math.PI * 2,
          radius = 28 + (i % 3) * 11,
          x = (origin.x === undefined ? origin.cx : origin.x) + Math.cos(angle) * radius,
          y = (origin.y === undefined ? origin.cy : origin.y) + Math.sin(angle) * radius,
          point = this.map.nav.nearestWalkable(x, y, 140, false),
          agent = this.makeAgent(point ? point.x : x, point ? point.y : y, 0),
          id = this.state.zone.nextCitizenId++;
        this._apply(agent, {
          id,
          x: agent.x,
          y: agent.y,
          hp: CFG.CITIZEN.MAX_HP,
          maxHP: CFG.CITIZEN.MAX_HP,
          moral: Math.max(0, Math.min(100, opts.moral || CFG.CITIZEN.START_MORAL)),
          hunger: Math.max(0, opts.hunger || 0),
          role: CFG.ROLE.WORKER,
          workerState: CFG.WORKER_STATE.IDLE,
          jobId: null,
          carry: emptyResources(),
          squadId: null,
          weapon: CFG.WEAPON.MACHETE,
          name: null,
          arrivalDay: this.state.day,
        });
        this.agents.push(agent);
        this.byId[id] = agent;
        added.push(agent);
      }
      this.capture();
      if (this.tasks) this.tasks.markDirty();
      if (this.onChanged) this.onChanged();
      return added;
    }

    adjustMorale(amount) {
      for (let i = 0; i < this.byId.length; i++) {
        const agent = this.byId[i];
        if (!agent || agent.dead) continue;
        agent.moral = Math.max(0, Math.min(100, agent.moral + amount));
      }
      if (this.onChanged) this.onChanged();
    }

    updateNeeds(agent, dt) {
      if (!agent.zoneCitizen || agent.dead) return;
      agent.hunger = Math.min(100, agent.hunger + dt * CFG.CITIZEN.HUNGER_PER_SECOND);
      if (agent.hunger >= CFG.CITIZEN.FOOD_AT_HUNGER && this.state.stock[R.FOOD] > 0) {
        this.state.stock[R.FOOD]--;
        const multiplier =
          (this.adaptations ? this.adaptations.foodReliefMultiplier() : 1) *
          (this.campaign ? this.campaign.foodReliefMultiplier() : 1);
        agent.hunger = Math.max(0, agent.hunger - CFG.CITIZEN.FOOD_RELIEF * multiplier);
      } else if (agent.hunger >= CFG.CITIZEN.FOOD_AT_HUNGER) {
        agent.moral = Math.max(0, agent.moral - dt * CFG.CITIZEN.STARVE_MORAL_PER_SECOND);
        if (agent.hunger >= 15 || agent.moral <= 0) {
          agent.hp -= dt * CFG.CITIZEN.STARVE_HP_PER_SECOND;
          if (agent.hp <= 0) this.kill(agent);
        }
      }
      if (agent.workerState === CFG.WORKER_STATE.RESTING && agent.bld === this.state.hqId)
        agent.moral = Math.min(100, agent.moral + dt * CFG.CITIZEN.REST_MORAL_PER_SECOND);
      if (this.adaptations && this.state.phase() === "night" && this.adaptations.overcrowded)
        agent.moral = Math.max(0, agent.moral - dt * 0.025);
      if (this.campaign) this.campaign.updateCitizen(agent, dt);
    }

    kill(agent) {
      if (!agent || agent.dead) return false;
      agent.hp = 0;
      agent.role = CFG.ROLE.DEAD;
      agent.dead = true;
      if (this.tasks) this.tasks.releaseCitizen(agent, true);
      if (this.squads) this.squads.removeCitizen(agent, true);
      this.byId[agent.cid] = null;
      if (this.onChanged) this.onChanged();
      return true;
    }

    changeRole(agent, role) {
      if (!agent || agent.dead || agent.role === role) return false;
      if (this.tasks) this.tasks.releaseCitizen(agent, false);
      agent.role = role;
      if (this.tasks) this.tasks.markDirty();
      if (this.onChanged) this.onChanged();
      return true;
    }

    at(id) {
      return Number.isInteger(id) ? this.byId[id] || null : null;
    }

    carryTotal(agent) {
      let total = 0;
      for (let i = 0; i < R.COUNT; i++) total += agent.carry[i];
      return total;
    }

    stats() {
      let population = 0,
        free = 0,
        assigned = 0,
        moral = 0;
      for (let i = 0; i < this.byId.length; i++) {
        const a = this.byId[i];
        if (!a || a.dead) continue;
        population++;
        moral += a.moral;
        if (a.role === CFG.ROLE.WORKER) {
          if (a.jobId === null) free++;
          else assigned++;
        }
      }
      return { population, free, assigned, moral: population ? moral / population : 0 };
    }

    capture() {
      const out = [];
      for (let i = 0; i < this.byId.length; i++) {
        const a = this.byId[i];
        if (!a || a.dead || a.role === CFG.ROLE.DEAD) continue;
        out.push({
          id: a.cid,
          x: a.x,
          y: a.y,
          hp: a.hp,
          maxHP: a.maxHP,
          moral: a.moral,
          hunger: a.hunger,
          role: a.role,
          workerState: a.workerState,
          jobId: a.jobId,
          carry: a.carry.slice(),
          squadId: a.squadId,
          weapon: a.weapon,
          name: a.name,
          arrivalDay: a.arrivalDay,
        });
      }
      this.state.zone.citizens = out;
    }
  }

  ZS.ZoneCitizens = ZoneCitizens;
})();
