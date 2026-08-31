/* Event-driven settlement task board. Workers never scan the job list in
   their frame update; assignment happens only while the board is dirty or
   during a low-frequency safety reconciliation. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});
  const CFG = ZS.ZoneConfig;
  const R = CFG.RESOURCE;
  const WS = CFG.WORKER_STATE;
  const SALVAGE_IDS = Object.freeze([R.WOOD, R.METAL, R.BRICK]);

  class ZoneTasks {
    constructor(state, map) {
      this.state = state;
      this.map = map;
      this.citizens = null;
      this.jobs = state.zone.jobs;
      this.workPolicy = state.zone.workPolicy;
      this.workAssigned = new Int16Array(CFG.WORK_KIND.COUNT);
      this.dirty = true;
      this.reconcileT = 0;
      this.onChanged = null;
      this.adaptations = null;
      this.agriculture = null;
      this.gathering = null;
    }

    connect(citizens, onChanged) {
      this.citizens = citizens;
      this.onChanged = onChanged;
    }

    connectAdaptations(adaptations) {
      this.adaptations = adaptations;
    }

    connectAgriculture(agriculture) {
      this.agriculture = agriculture;
    }

    connectGathering(gathering) {
      this.gathering = gathering;
    }

    markDirty() {
      this.dirty = true;
    }

    at(id) {
      for (let i = 0; i < this.jobs.length; i++) if (this.jobs[i].id === id) return this.jobs[i];
      return null;
    }

    forBuilding(buildingId) {
      for (let i = 0; i < this.jobs.length; i++) {
        const job = this.jobs[i];
        if (
          job.targetKind === "building" &&
          job.targetId === buildingId &&
          job.state === CFG.JOB_STATE.ACTIVE
        )
          return job;
      }
      return null;
    }

    forField(fieldId) {
      for (let i = 0; i < this.jobs.length; i++) {
        const job = this.jobs[i];
        if (
          job.targetKind === "field" &&
          job.targetId === fieldId &&
          job.state === CFG.JOB_STATE.ACTIVE
        )
          return job;
      }
      return null;
    }

    workKind(job, target) {
      if (!job) return -1;
      if (job.type === CFG.JOB.BUILD || job.type === CFG.JOB.REPAIR)
        return CFG.WORK_KIND.BUILD;
      if (job.type === CFG.JOB.SALVAGE) return CFG.WORK_KIND.SALVAGE;
      if (job.type === CFG.JOB.GATHER)
        return job.resource === R.WOOD ? CFG.WORK_KIND.WOOD : CFG.WORK_KIND.METAL;
      if (job.type === CFG.JOB.RESEARCH) return CFG.WORK_KIND.RESEARCH;
      if (job.type !== CFG.JOB.PRODUCE) return -1;
      if (job.targetKind === "field") return CFG.WORK_KIND.FARMING;
      const record = target || this.map.at(job.targetId);
      if (!record) return CFG.WORK_KIND.INDUSTRY;
      if (record.use === CFG.BUILDING_USE.FARM) return CFG.WORK_KIND.FARMING;
      if (
        record.use === CFG.BUILDING_USE.COOKHOUSE ||
        record.use === CFG.BUILDING_USE.BARN
      )
        return CFG.WORK_KIND.FOOD;
      return CFG.WORK_KIND.INDUSTRY;
    }

    _defaultPriority(kind) {
      return kind >= 0 && kind < CFG.WORK_KIND.COUNT
        ? this.workPolicy.priorities[kind]
        : CFG.PRIORITY.MEDIUM;
    }

    defaultPriorityFor(job) {
      return this._defaultPriority(this.workKind(job));
    }

    postSalvage(buildingId, priority) {
      const record = this.map.at(buildingId);
      if (
        !record ||
        !this.map.reachable(record) ||
        record === this.map.hq ||
        this.map.materialsTotal(record) <= 0 ||
        (this.gathering && this.gathering.isBuildingClaimed(buildingId))
      )
        return null;
      const current = this.forBuilding(buildingId);
      if (current) return current;
      const job = {
        id: this.state.zone.nextJobId++,
        type: CFG.JOB.SALVAGE,
        targetId: buildingId,
        targetKind: "building",
        priority: Number.isInteger(priority)
          ? priority
          : this._defaultPriority(CFG.WORK_KIND.SALVAGE),
        capacity: CFG.TASK.SALVAGE_CAPACITY,
        progress: 0,
        state: CFG.JOB_STATE.ACTIVE,
        assigned: [],
        buildUse: null,
        reserved: Array.from({ length: R.COUNT }, () => 0),
      };
      this.jobs.push(job);
      this.markDirty();
      this.reconcile();
      if (this.onChanged) this.onChanged();
      return job;
    }

    postGather(resource, bounds, nodeIds, total) {
      if (
        !this.gathering ||
        !bounds ||
        !Array.isArray(nodeIds) ||
        !nodeIds.length ||
        (resource !== R.WOOD && resource !== R.METAL)
      )
        return null;
      const job = {
        id: this.state.zone.nextJobId++,
        type: CFG.JOB.GATHER,
        targetId: 0,
        targetKind: "resource",
        resource,
        bounds: { x0: bounds.x0, y0: bounds.y0, x1: bounds.x1, y1: bounds.y1 },
        nodeIds: nodeIds.slice(0, CFG.GATHER.MAX_NODES_PER_AREA),
        total: Math.max(0, total | 0),
        priority: this._defaultPriority(
          resource === R.WOOD ? CFG.WORK_KIND.WOOD : CFG.WORK_KIND.METAL,
        ),
        capacity: CFG.GATHER.DEFAULT_WORKERS,
        progress: 0,
        state: CFG.JOB_STATE.ACTIVE,
        assigned: [],
        buildUse: null,
        reserved: Array.from({ length: R.COUNT }, () => 0),
      };
      this.jobs.push(job);
      this.markDirty();
      this.reconcile();
      if (this.onChanged) this.onChanged();
      return job;
    }

    postBuild(buildingId, use, cost) {
      const record = this.map.at(buildingId);
      if (!this.map.reachable(record) || this.forBuilding(buildingId) || !Array.isArray(cost))
        return null;
      for (let i = 0; i < R.COUNT; i++) if (this.state.stock[i] < (cost[i] || 0)) return null;
      const reserved = Array.from({ length: R.COUNT }, () => 0);
      for (let i = 0; i < R.COUNT; i++) {
        reserved[i] = cost[i] || 0;
        this.state.stock[i] -= reserved[i];
      }
      const job = {
        id: this.state.zone.nextJobId++,
        type: CFG.JOB.BUILD,
        targetId: buildingId,
        targetKind: "building",
        priority: this._defaultPriority(CFG.WORK_KIND.BUILD),
        capacity: CFG.TASK.BUILD_CAPACITY,
        progress: 0,
        state: CFG.JOB_STATE.ACTIVE,
        assigned: [],
        buildUse: use,
        reserved,
      };
      this.jobs.push(job);
      this.markDirty();
      this.reconcile();
      if (this.onChanged) this.onChanged();
      return job;
    }

    postProduction(buildingId) {
      const record = this.map.at(buildingId);
      if (!this.map.reachable(record)) return null;
      const current = this.forBuilding(buildingId);
      if (current) return current;
      const research = record.use === CFG.BUILDING_USE.RESEARCH;
      const job = {
        id: this.state.zone.nextJobId++,
        type: research ? CFG.JOB.RESEARCH : CFG.JOB.PRODUCE,
        targetId: buildingId,
        targetKind: "building",
        priority: this._defaultPriority(
          research ? CFG.WORK_KIND.RESEARCH : this.workKind({ type: CFG.JOB.PRODUCE }, record),
        ),
        capacity: this.adaptations
          ? research
            ? Math.min(CFG.RESEARCH.DEFAULT_STAFF, this.adaptations.researchCapacity(record))
            : this.adaptations.productionCapacity(record)
          : CFG.TASK.PRODUCE_CAPACITY,
        progress: 0,
        state: CFG.JOB_STATE.ACTIVE,
        assigned: [],
        buildUse: null,
        reserved: Array.from({ length: R.COUNT }, () => 0),
      };
      this.jobs.push(job);
      this.markDirty();
      this.reconcile();
      if (this.onChanged) this.onChanged();
      return job;
    }

    postFieldProduction(fieldId, capacity) {
      const field = this.agriculture && this.agriculture.at(fieldId);
      if (!field) return null;
      const current = this.forField(fieldId);
      if (current) return current;
      const job = {
        id: this.state.zone.nextJobId++,
        type: CFG.JOB.PRODUCE,
        targetId: fieldId,
        targetKind: "field",
        priority: this._defaultPriority(CFG.WORK_KIND.FARMING),
        capacity: Math.max(1, capacity | 0),
        progress: 0,
        state: CFG.JOB_STATE.ACTIVE,
        assigned: [],
        buildUse: null,
        reserved: Array.from({ length: R.COUNT }, () => 0),
      };
      this.jobs.push(job);
      this.markDirty();
      this.reconcile();
      if (this.onChanged) this.onChanged();
      return job;
    }

    cancel(id) {
      const job = this.at(id);
      if (!job || job.state !== CFG.JOB_STATE.ACTIVE) return false;
      job.state = CFG.JOB_STATE.CANCELED;
      if (job.type === CFG.JOB.BUILD)
        for (let i = 0; i < R.COUNT; i++) {
          this.state.stock[i] += job.reserved[i] || 0;
          job.reserved[i] = 0;
        }
      for (let i = job.assigned.length - 1; i >= 0; i--) {
        const worker = this.citizens.at(job.assigned[i]);
        if (!worker) continue;
        worker.jobId = null;
        worker.workerState = this.citizens.carryTotal(worker) ? WS.RETURNING : WS.IDLE;
      }
      job.assigned.length = 0;
      this.markDirty();
      if (this.onChanged) this.onChanged();
      return true;
    }

    setPriority(id, priority) {
      const job = this.at(id);
      if (!job || job.state !== CFG.JOB_STATE.ACTIVE) return false;
      job.priority = Math.max(
        CFG.PRIORITY.OFF,
        Math.min(CFG.PRIORITY.HIGHEST, priority | 0),
      );
      this._releaseJobWorkers(job, false);
      this.markDirty();
      this.reconcile();
      if (this.onChanged) this.onChanged();
      return true;
    }

    setWorkPriority(kind, priority) {
      if (!Number.isInteger(kind) || kind < 0 || kind >= CFG.WORK_KIND.COUNT) return false;
      const next = Math.max(
        CFG.PRIORITY.OFF,
        Math.min(CFG.PRIORITY.HIGHEST, priority | 0),
      );
      if (this.workPolicy.priorities[kind] === next) return false;
      this.workPolicy.priorities[kind] = next;
      for (let i = 0; i < this.jobs.length; i++) {
        const job = this.jobs[i];
        if (job.state !== CFG.JOB_STATE.ACTIVE || this.workKind(job) !== kind) continue;
        job.priority = next;
        this._releaseJobWorkers(job, false);
      }
      this.markDirty();
      this.reconcile();
      if (this.onChanged) this.onChanged();
      return true;
    }

    setWorkMax(kind, maximum) {
      if (!Number.isInteger(kind) || kind < 0 || kind >= CFG.WORK_KIND.COUNT) return false;
      const next = Math.max(0, Math.min(CFG.WORK.MAX_WORKERS, maximum | 0));
      if (this.workPolicy.max[kind] === next) return false;
      this.workPolicy.max[kind] = next;
      this.markDirty();
      this.reconcile();
      if (this.onChanged) this.onChanged();
      return true;
    }

    adjustWorkMax(kind, delta) {
      const row = this._workTotals(kind),
        current = this.workPolicy.max[kind],
        baseline = current >= CFG.WORK.MAX_WORKERS ? row.requested : current;
      return this.setWorkMax(kind, baseline + (delta | 0));
    }

    laborModel() {
      const rows = [];
      for (let kind = 0; kind < CFG.WORK_KIND.COUNT; kind++) {
        const totals = this._workTotals(kind);
        rows.push({
          kind,
          priority: this.workPolicy.priorities[kind],
          max: this.workPolicy.max[kind],
          assigned: totals.assigned,
          requested: totals.requested,
          jobs: totals.jobs,
          blocked: totals.blocked,
        });
      }
      return rows;
    }

    setCapacity(id, capacity) {
      const job = this.at(id);
      if (!job || job.state !== CFG.JOB_STATE.ACTIVE) return false;
      const next = Math.max(
        job.type === CFG.JOB.GATHER ? 0 : 1,
        Math.min(job.type === CFG.JOB.GATHER ? CFG.GATHER.MAX_WORKERS : 12, capacity | 0),
      );
      if (next === job.capacity) return false;
      job.capacity = next;
      while (job.assigned.length > job.capacity) {
        const worker = this.citizens.at(job.assigned.pop());
        if (!worker || worker.jobId !== job.id) continue;
        worker.jobId = null;
        worker.workerState = this.citizens.carryTotal(worker) ? WS.RETURNING : WS.IDLE;
      }
      this.markDirty();
      this.reconcile();
      if (this.onChanged) this.onChanged();
      return true;
    }

    _releaseJobWorkers(job, keepCargo) {
      for (let i = job.assigned.length - 1; i >= 0; i--) {
        const worker = this.citizens.at(job.assigned[i]);
        if (keepCargo && worker && this.citizens.carryTotal(worker) > 0) continue;
        job.assigned.splice(i, 1);
        if (!worker || worker.jobId !== job.id) continue;
        worker.jobId = null;
        worker.workerState = this.citizens.carryTotal(worker) ? WS.RETURNING : WS.IDLE;
      }
    }

    updateBoard(dt) {
      this.reconcileT += dt;
      if (!this.dirty && this.reconcileT < CFG.TASK.RECONCILE_SECONDS) return;
      this.reconcileT = 0;
      this.reconcile();
    }

    reconcile() {
      if (!this.citizens) return;
      this.dirty = false;
      this.workAssigned.fill(0);
      for (let i = 0; i < this.jobs.length; i++) {
        const job = this.jobs[i];
        if (job.state !== CFG.JOB_STATE.ACTIVE) continue;
        const gatherExhausted =
            job.type === CFG.JOB.GATHER && (!this.gathering || this.gathering.available(job) <= 0),
          target = this._target(job),
          eligible = this._eligible(job, target);
        if (!gatherExhausted && !this._reachable(job, target)) {
          this.cancel(job.id);
          continue;
        }
        for (let j = job.assigned.length - 1; j >= 0; j--) {
          const worker = this.citizens.at(job.assigned[j]);
          if (
            !worker ||
            worker.dead ||
            worker.role !== CFG.ROLE.WORKER ||
            worker.jobId !== job.id ||
            job.priority === CFG.PRIORITY.OFF ||
            !eligible ||
            j >= job.capacity
          ) {
            this._detachWorker(job, j, worker);
          }
        }
        if (
          job.type === CFG.JOB.SALVAGE &&
          this.map.materialsTotal(this.map.at(job.targetId)) <= 0 &&
          !this._hasInFlight(job)
        )
          this._complete(job);
        else if (gatherExhausted && !this._hasInFlight(job)) this._complete(job);
        else {
          const kind = this.workKind(job, target);
          if (kind >= 0) this.workAssigned[kind] += job.assigned.length;
        }
      }
      this._trimWorkMaximums();
      if (this.state.phase() === "dusk" || this.state.phase() === "night") return;
      for (
        let priority = CFG.PRIORITY.HIGHEST;
        priority >= CFG.PRIORITY.LOWEST;
        priority--
      ) {
        let assigned = true;
        while (assigned) {
          assigned = false;
          for (let i = 0; i < this.jobs.length; i++) {
            const job = this.jobs[i],
              target = this._target(job);
            if (
              job.state !== CFG.JOB_STATE.ACTIVE ||
              job.priority !== priority ||
              job.assigned.length >= job.capacity ||
              !this._eligible(job, target)
            )
              continue;
            const kind = this.workKind(job, target),
              categoryFull = kind >= 0 && this.workAssigned[kind] >= this.workPolicy.max[kind];
            let worker = categoryFull ? null : this._freeWorker();
            if (!worker) worker = this._preemptWorker(priority, kind, categoryFull);
            if (!worker) continue;
            worker.jobId = job.id;
            worker.workerState = WS.TO_JOB;
            worker.workT = 0;
            job.assigned.push(worker.cid);
            if (kind >= 0) this.workAssigned[kind]++;
            assigned = true;
          }
        }
      }
    }

    _eligible(job, target) {
      if (!job || job.state !== CFG.JOB_STATE.ACTIVE || job.priority === CFG.PRIORITY.OFF)
        return false;
      if (!this._reachable(job, target)) return false;
      if (job.type === CFG.JOB.GATHER)
        return Boolean(this.gathering && this.gathering.available(job) > 0);
      if (job.type === CFG.JOB.SALVAGE) return this.map.materialsTotal(target) > 0;
      if (job.type === CFG.JOB.RESEARCH)
        return Boolean(
          target &&
          target.use === CFG.BUILDING_USE.RESEARCH &&
          target.active &&
          target.powered &&
          target.hp > 0,
        );
      if (job.type === CFG.JOB.PRODUCE) {
        const controller = job.targetKind === "field" ? this.agriculture : this.adaptations;
        return Boolean(controller && controller.canProduce(target));
      }
      return true;
    }

    _detachWorker(job, index, worker) {
      job.assigned.splice(index, 1);
      if (!worker || worker.jobId !== job.id) return;
      worker.jobId = null;
      worker.workerState = this.citizens.carryTotal(worker) ? WS.RETURNING : WS.IDLE;
    }

    _trimWorkMaximums() {
      for (let kind = 0; kind < CFG.WORK_KIND.COUNT; kind++) {
        const maximum = this.workPolicy.max[kind];
        if (this.workAssigned[kind] <= maximum) continue;
        for (
          let priority = CFG.PRIORITY.LOWEST;
          priority <= CFG.PRIORITY.HIGHEST && this.workAssigned[kind] > maximum;
          priority++
        )
          for (let i = this.jobs.length - 1; i >= 0 && this.workAssigned[kind] > maximum; i--) {
            const job = this.jobs[i];
            if (
              job.state !== CFG.JOB_STATE.ACTIVE ||
              job.priority !== priority ||
              this.workKind(job) !== kind
            )
              continue;
            while (job.assigned.length && this.workAssigned[kind] > maximum) {
              const index = job.assigned.length - 1,
                worker = this.citizens.at(job.assigned[index]);
              this._detachWorker(job, index, worker);
              this.workAssigned[kind]--;
            }
          }
      }
    }

    _preemptWorker(priority, targetKind, categoryFull) {
      let source = null,
        sourceIndex = -1,
        sourcePriority = CFG.PRIORITY.HIGHEST + 1;
      for (let i = 0; i < this.jobs.length; i++) {
        const job = this.jobs[i];
        if (
          job.state !== CFG.JOB_STATE.ACTIVE ||
          job.priority >= priority ||
          !job.assigned.length ||
          (categoryFull && this.workKind(job) !== targetKind) ||
          job.priority >= sourcePriority
        )
          continue;
        for (let j = job.assigned.length - 1; j >= 0; j--) {
          const worker = this.citizens.at(job.assigned[j]);
          if (!worker || this.citizens.carryTotal(worker) > 0) continue;
          source = job;
          sourceIndex = j;
          sourcePriority = job.priority;
          break;
        }
      }
      if (!source) return null;
      const worker = this.citizens.at(source.assigned[sourceIndex]),
        kind = this.workKind(source);
      this._detachWorker(source, sourceIndex, worker);
      if (kind >= 0) this.workAssigned[kind]--;
      return worker;
    }

    _freeWorker() {
      for (let i = 0; i < this.citizens.byId.length; i++) {
        const worker = this.citizens.byId[i];
        if (
          worker &&
          !worker.dead &&
          worker.role === CFG.ROLE.WORKER &&
          worker.jobId === null &&
          this.citizens.carryTotal(worker) === 0
        )
          return worker;
      }
      return null;
    }

    _workTotals(kind) {
      const totals = { assigned: 0, requested: 0, jobs: 0, blocked: 0 };
      for (let i = 0; i < this.jobs.length; i++) {
        const job = this.jobs[i];
        if (job.state !== CFG.JOB_STATE.ACTIVE || this.workKind(job) !== kind) continue;
        totals.jobs++;
        totals.assigned += job.assigned.length;
        totals.requested += job.capacity;
        if (!this._eligible(job, this._target(job))) totals.blocked++;
      }
      return totals;
    }

    _hasInFlight(job) {
      for (let i = 0; i < job.assigned.length; i++) {
        const worker = this.citizens.at(job.assigned[i]);
        if (worker && this.citizens.carryTotal(worker)) return true;
      }
      return false;
    }

    _complete(job) {
      if (job.type === CFG.JOB.BUILD) {
        const record = this.map.at(job.targetId);
        if (!this.adaptations || !this.adaptations.complete(record, job.buildUse)) return false;
        for (let i = 0; i < R.COUNT; i++) job.reserved[i] = 0;
      } else if (job.type === CFG.JOB.SALVAGE) {
        this.map.startDemolition(this.map.at(job.targetId));
      }
      job.state = CFG.JOB_STATE.COMPLETE;
      if (job.type === CFG.JOB.BUILD && this.adaptations) this.adaptations.ensureProductionJobs();
      for (let i = job.assigned.length - 1; i >= 0; i--) {
        const worker = this.citizens.at(job.assigned[i]);
        if (!worker) continue;
        worker.jobId = null;
        worker.workerState = this.citizens.carryTotal(worker) ? WS.RETURNING : WS.IDLE;
      }
      job.assigned.length = 0;
      this.markDirty();
      if (this.onChanged) this.onChanged();
      return true;
    }

    releaseCitizen(worker, died) {
      if (!worker || worker.jobId === null) return;
      const job = this.at(worker.jobId);
      if (job) {
        const index = job.assigned.indexOf(worker.cid);
        if (index >= 0) job.assigned.splice(index, 1);
        if (died) {
          if (job.type === CFG.JOB.GATHER && this.gathering)
            this.gathering.restoreCargo(job, worker);
          else {
            const record = this.map.at(job.targetId);
            if (record)
              for (let i = 0; i < R.COUNT; i++) {
                record.salvage[i] += worker.carry[i];
                worker.carry[i] = 0;
              }
          }
        }
      }
      worker.jobId = null;
      worker.workerState = died
        ? WS.IDLE
        : this.citizens.carryTotal(worker)
          ? WS.RETURNING
          : WS.IDLE;
      this.markDirty();
    }

    returnForNight(worker) {
      if (!worker || worker.role !== CFG.ROLE.WORKER || worker.dead) return;
      worker.workerState = worker.bld === this.state.hqId ? WS.RESTING : WS.RETURNING;
    }

    updateWorker(worker, dt, t, nav) {
      if (worker.dead || worker.role !== CFG.ROLE.WORKER) return;
      const night = this.state.phase() === "dusk" || this.state.phase() === "night";
      if (night && worker.workerState !== WS.RETURNING && worker.workerState !== WS.RESTING)
        this.returnForNight(worker);
      const job = worker.jobId === null ? null : this.at(worker.jobId);
      if (!job || job.state !== CFG.JOB_STATE.ACTIVE) {
        worker.jobId = null;
        if (this.citizens.carryTotal(worker)) worker.workerState = WS.RETURNING;
        else if (night)
          worker.workerState = worker.bld === this.state.hqId ? WS.RESTING : WS.RETURNING;
        else worker.workerState = WS.IDLE;
      }
      if (worker.workerState === WS.TO_JOB) this._toJob(worker, job, dt, t, nav);
      else if (worker.workerState === WS.WORKING) this._work(worker, job, dt);
      else if (worker.workerState === WS.RETURNING) this._return(worker, job, dt, t, nav, night);
      else {
        worker.wantMove = false;
        worker.vx *= Math.max(0, 1 - dt * 5);
        worker.vy *= Math.max(0, 1 - dt * 5);
        if (!night && worker.workerState === WS.RESTING) {
          worker.workerState = job ? WS.TO_JOB : WS.IDLE;
          this.markDirty();
        }
      }
    }

    _toJob(worker, job, dt, t, nav) {
      if (!job) return;
      const record = this._target(job, worker),
        door = record && record.shape && record.shape.door,
        target = door ? door.inner : record;
      if (!target) {
        if (this.citizens.carryTotal(worker)) worker.workerState = WS.RETURNING;
        else {
          this._complete(job);
          worker.workerState = WS.IDLE;
        }
        return;
      }
      if (job.targetKind === "field")
        this.agriculture.workerPoint(record, worker.cid, worker.workTarget);
      else {
        worker.workTarget.x = target.x === undefined ? target.cx : target.x;
        worker.workTarget.y = target.y === undefined ? target.cy : target.y;
      }
      const result = ZS.planAndFollow(
        worker,
        worker.workTarget,
        false,
        CFG.AGENT.SPEED,
        dt,
        t,
        nav,
      );
      if (result === "arrived" || (job.targetKind === "building" && worker.bld === job.targetId)) {
        worker.workerState = WS.WORKING;
        worker.zoneBuildingId = job.targetId;
        worker.workT = 0;
        worker.vx = worker.vy = 0;
      }
    }

    _work(worker, job, dt) {
      if (!job) return;
      if (job.type === CFG.JOB.BUILD) {
        job.progress += dt;
        if (job.progress >= CFG.TASK.BUILD_SECONDS) this._complete(job);
        return;
      }
      if (job.type === CFG.JOB.RESEARCH) {
        const record = this._target(job);
        worker.wantMove = false;
        worker.vx *= Math.max(0, 1 - dt * 6);
        worker.vy *= Math.max(0, 1 - dt * 6);
        if (this.adaptations) this.adaptations.workResearch(record, dt);
        return;
      }
      if (job.type === CFG.JOB.PRODUCE) {
        const record = this._target(job),
          controller = job.targetKind === "field" ? this.agriculture : this.adaptations,
          seconds = controller ? controller.productionSeconds(record) : Infinity;
        worker.wantMove = false;
        worker.vx *= Math.max(0, 1 - dt * 6);
        worker.vy *= Math.max(0, 1 - dt * 6);
        if (!record || !controller || !controller.canProduce(record)) return;
        job.progress += dt;
        if (job.progress >= seconds) {
          job.progress -= seconds;
          if (controller.produce(record) && this.onChanged) this.onChanged();
        }
        return;
      }
      if (job.type === CFG.JOB.GATHER) {
        worker.wantMove = false;
        worker.vx *= Math.max(0, 1 - dt * 6);
        worker.vy *= Math.max(0, 1 - dt * 6);
        worker.workT += dt;
        if (worker.workT < CFG.GATHER.WORK_SECONDS) return;
        worker.workT = 0;
        const room = CFG.CITIZEN.CARRY_CAPACITY - this.citizens.carryTotal(worker),
          amount = this.gathering ? this.gathering.collect(job, worker, room) : 0;
        worker.workerState = amount ? WS.RETURNING : WS.TO_JOB;
        return;
      }
      const record = this.map.at(job.targetId);
      if (!record || this.map.materialsTotal(record) <= 0) {
        worker.workerState = WS.RETURNING;
        return;
      }
      job.progress += dt;
      if (job.progress < CFG.TASK.SALVAGE_SECONDS) return;
      job.progress -= CFG.TASK.SALVAGE_SECONDS;
      let room = CFG.CITIZEN.CARRY_CAPACITY - this.citizens.carryTotal(worker);
      for (let i = 0; i < SALVAGE_IDS.length && room > 0; i++) {
        const id = SALVAGE_IDS[i],
          amount = Math.min(room, record.salvage[id]);
        record.salvage[id] -= amount;
        worker.carry[id] += amount;
        room -= amount;
      }
      worker.workerState = WS.RETURNING;
      if (this.onChanged) this.onChanged();
    }

    _return(worker, job, dt, t, nav, night) {
      const hq = this.map.hq,
        door = hq && hq.shape.door,
        target = door ? door.inner : hq;
      if (!target) return;
      worker.workTarget.x = target.x === undefined ? target.cx : target.x;
      worker.workTarget.y = target.y === undefined ? target.cy : target.y;
      const result = ZS.planAndFollow(
        worker,
        worker.workTarget,
        false,
        CFG.AGENT.SPEED,
        dt,
        t,
        nav,
      );
      if (result !== "arrived" && worker.bld !== hq.id) return;
      for (let i = 0; i < R.COUNT; i++) {
        this.state.stock[i] += worker.carry[i];
        worker.carry[i] = 0;
      }
      if (night) worker.workerState = WS.RESTING;
      else if (
        job &&
        job.state === CFG.JOB_STATE.ACTIVE &&
        (job.type === CFG.JOB.GATHER
          ? this.gathering && this.gathering.available(job) > 0
          : job.type !== CFG.JOB.SALVAGE || this.map.materialsTotal(this.map.at(job.targetId)))
      )
        worker.workerState = WS.TO_JOB;
      else {
        if (job) this._complete(job);
        worker.jobId = null;
        worker.workerState = WS.IDLE;
      }
      worker.vx = worker.vy = 0;
      if (this.onChanged) this.onChanged();
    }

    _target(job, worker) {
      if (!job) return null;
      if (job.targetKind === "field" && this.agriculture) return this.agriculture.at(job.targetId);
      if (job.targetKind === "resource" && this.gathering)
        return this.gathering.target(job, worker || null);
      return this.map.at(job.targetId);
    }

    _reachable(job, target) {
      if (!job) return false;
      if (job.targetKind === "field")
        return Boolean(this.agriculture && this.agriculture.reachable(target));
      if (job.targetKind === "resource")
        return Boolean(this.gathering && this.gathering.reachable(job));
      return this.map.reachable(target);
    }
  }

  ZS.ZoneTasks = ZoneTasks;
})();
