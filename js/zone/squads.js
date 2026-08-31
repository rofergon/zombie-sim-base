/* Player squads own one command queue and one A* path on their leader.
   Members follow reusable formation targets, so a four-person squad never
   spends four identical navigation searches. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});
  const CFG = ZS.ZoneConfig;
  const R = CFG.RESOURCE;

  function emptyResources() {
    return Array.from({ length: R.COUNT }, () => 0);
  }

  class ZoneSquads {
    constructor(state, map) {
      this.state = state;
      this.map = map;
      this.citizens = null;
      this.scavenge = null;
      this.agents = null;
      this.list = state.zone.squads;
      this.onChanged = null;
    }

    connect(citizens, scavenge, agents, onChanged) {
      this.citizens = citizens;
      this.scavenge = scavenge;
      this.agents = agents;
      this.onChanged = onChanged;
      if (!this.list.length) {
        const initial = [];
        for (let i = 0; i < citizens.byId.length; i++) {
          const agent = citizens.byId[i];
          if (agent && agent.role === CFG.ROLE.SQUAD && initial.length < CFG.SQUAD.MAX_MEMBERS)
            initial.push(agent);
        }
        if (initial.length) this.create(initial, true);
      } else {
        for (let i = this.list.length - 1; i >= 0; i--) {
          const squad = this.list[i];
          this._prepare(squad);
          for (let j = squad.members.length - 1; j >= 0; j--) {
            const member = citizens.at(squad.members[j]);
            if (!member) squad.members.splice(j, 1);
            else this._bind(member, squad, j);
          }
          if (!squad.members.length) this.list.splice(i, 1);
        }
      }
    }

    _prepare(squad) {
      squad.inventory = Array.isArray(squad.inventory) ? squad.inventory : emptyResources();
      squad.equipment = Array.isArray(squad.equipment) ? squad.equipment : [];
      squad.orders = Array.isArray(squad.orders) ? squad.orders : [];
      squad.orderIndex = Math.max(0, Math.min(squad.orders.length, squad.orderIndex || 0));
      squad.capacity = squad.capacity || CFG.SQUAD.INVENTORY_CAPACITY;
      squad.patrolLoop = Boolean(squad.patrolLoop);
      squad.resumeBuildingId = Number.isInteger(squad.resumeBuildingId)
        ? squad.resumeBuildingId
        : null;
      squad.garrisonBuildingId = Number.isInteger(squad.garrisonBuildingId)
        ? squad.garrisonBuildingId
        : null;
      squad.retreating = Boolean(squad.retreating);
      squad.state = squad.state || "idle";
      squad.attackT = squad.attackT || 0;
      squad.routePaths = [];
      squad.trailX = new Float32Array(96);
      squad.trailY = new Float32Array(96);
      squad.trailHead = 0;
      squad.trailCount = 0;
      this._normalizeOrders(squad);
      this._rebuildRoutePaths(squad);
    }

    at(id) {
      for (let i = 0; i < this.list.length; i++) if (this.list[i].id === id) return this.list[i];
      return null;
    }

    create(candidates, initial) {
      if (!initial && this.list.length >= 2 + this.map.countUse(CFG.BUILDING_USE.SQUAD_QUARTERS))
        return null;
      const members = [];
      for (let i = 0; i < candidates.length && members.length < CFG.SQUAD.MAX_MEMBERS; i++) {
        const agent = candidates[i];
        if (!agent || agent.dead || agent.squadId !== null) continue;
        if (!initial && (agent.role !== CFG.ROLE.WORKER || this.citizens.carryTotal(agent) > 0))
          continue;
        members.push(agent.cid);
      }
      if (!members.length) return null;
      const squad = {
        id: this.state.zone.nextSquadId++,
        members,
        inventory: emptyResources(),
        capacity: CFG.SQUAD.INVENTORY_CAPACITY,
        equipment: [],
        orders: [],
        orderIndex: 0,
        patrolLoop: false,
        resumeBuildingId: null,
        garrisonBuildingId: null,
        retreating: false,
        state: "idle",
        attackT: 0,
      };
      this._prepare(squad);
      const ammo = Math.min(CFG.SQUAD.START_AMMO, this.state.stock[R.AMMO]),
        medicine = Math.min(CFG.SQUAD.START_MEDICINE, this.state.stock[R.MEDICINE]);
      squad.inventory[R.AMMO] = ammo;
      squad.inventory[R.MEDICINE] = medicine;
      this.state.stock[R.AMMO] -= ammo;
      this.state.stock[R.MEDICINE] -= medicine;
      this.list.push(squad);
      for (let i = 0; i < members.length; i++) {
        const member = this.citizens.at(members[i]);
        if (!member) continue;
        if (member.jobId !== null && this.citizens.tasks)
          this.citizens.tasks.releaseCitizen(member, false);
        member.jobId = null;
        member.workerState = CFG.WORKER_STATE.IDLE;
        member.role = CFG.ROLE.SQUAD;
        squad.equipment.push(member.weapon || CFG.WEAPON.MACHETE);
        this._bind(member, squad, i);
      }
      if (this.citizens.tasks) this.citizens.tasks.markDirty();
      if (this.onChanged) this.onChanged();
      return squad;
    }

    _bind(member, squad, rank) {
      member.squadId = squad.id;
      member.role = CFG.ROLE.SQUAD;
      member.squadRank = rank;
      member.orders = squad.orders;
      member.orderIndex = squad.orderIndex;
      member.weapon = squad.equipment[rank] || member.weapon || CFG.WEAPON.MACHETE;
      member.gun = member.weapon !== CFG.WEAPON.MACHETE;
      member.wep = member.weapon === CFG.WEAPON.RIFLE ? "rifle" : member.gun ? "pistol" : null;
    }

    removeCitizen(agent, died) {
      if (!agent || agent.squadId === null) return;
      const squad = this.at(agent.squadId);
      if (!squad) {
        agent.squadId = null;
        return;
      }
      const index = squad.members.indexOf(agent.cid);
      if (index >= 0) {
        squad.members.splice(index, 1);
        if (index < squad.equipment.length) squad.equipment.splice(index, 1);
      }
      agent.squadId = null;
      if (!died) {
        agent.role = CFG.ROLE.WORKER;
        agent.gun = false;
        agent.wep = null;
        agent.orders = [];
        agent.orderIndex = 0;
      }
      if (!squad.members.length) {
        for (let i = 0; i < R.COUNT; i++) this.state.stock[i] += squad.inventory[i];
        const squadIndex = this.list.indexOf(squad);
        if (squadIndex >= 0) this.list.splice(squadIndex, 1);
      } else
        for (let i = 0; i < squad.members.length; i++) {
          const member = this.citizens.at(squad.members[i]);
          if (member) this._bind(member, squad, i);
        }
      if (this.citizens.tasks) this.citizens.tasks.markDirty();
      if (this.onChanged) this.onChanged();
    }

    disband(id) {
      const squad = this.at(id);
      if (!squad || !this._atHQ(squad)) return false;
      for (let i = squad.members.length - 1; i >= 0; i--) {
        const member = this.citizens.at(squad.members[i]);
        if (member) this.removeCitizen(member, false);
      }
      return true;
    }

    issueContext(squad, x, y, append, building) {
      if (!squad) return false;
      let kind = CFG.ORDER.MOVE,
        tx = x,
        ty = y,
        buildingId = null;
      if (building) {
        if (!this.map.reachable(building)) return false;
        const entry = this.map.entryPoint(building);
        if (!entry) return false;
        tx = entry.x;
        ty = entry.y;
        buildingId = building.id;
        kind =
          building === this.map.hq || building.looted || building.use !== CFG.BUILDING_USE.ABANDONED
            ? CFG.ORDER.ENTER
            : CFG.ORDER.SCAVENGE;
      }
      return this.issue(squad, kind, tx, ty, buildingId, append);
    }

    issueAttackMove(squad, x, y, append) {
      const issued = this.issue(squad, CFG.ORDER.ATTACK_MOVE, x, y, null, append);
      if (issued) squad.state = "attack moving";
      return issued;
    }

    issueGarrison(squad, building, append) {
      if (!squad || !building || !building.shape || !this.map.reachable(building)) return false;
      const target = this.map.entryPoint(building);
      if (!target) return false;
      const issued = this.issue(
        squad,
        CFG.ORDER.ENTER,
        target.x === undefined ? target.cx : target.x,
        target.y === undefined ? target.cy : target.y,
        building.id,
        append,
      );
      if (issued) squad.state = "moving to garrison";
      return issued;
    }

    issue(squad, kind, x, y, buildingId, append) {
      if (!squad) return false;
      squad.garrisonBuildingId = null;
      squad.retreating = false;
      if (!append) this.clearOrders(squad);
      else this._compactOrders(squad);
      if (squad.orders.length - squad.orderIndex >= CFG.AGENT.MAX_ORDERS) return false;
      const record = Number.isInteger(buildingId) ? this.map.at(buildingId) : null,
        entry = record && this.map.reachable(record) ? this.map.entryPoint(record) : null,
        point = record ? entry : this.map.nav.nearestWalkable(x, y, 120, false);
      if (Number.isInteger(buildingId) && !record) return false;
      if (!point) return false;
      squad.orders.push({ kind, x: point.x, y: point.y, buildingId });
      squad.patrolLoop = false;
      this._rebuildRoutePaths(squad);
      this._syncOrderViews(squad);
      if (this.onChanged) this.onChanged();
      return true;
    }

    issueArea(squads, records, append) {
      if (!Array.isArray(squads) || !squads.length || !Array.isArray(records))
        return { assigned: 0, considered: 0, skipped: 0 };
      const selected = new Set(squads),
        claimed = new Set(),
        routes = [],
        candidates = [];
      if (!append) for (let i = 0; i < squads.length; i++) this.clearOrders(squads[i]);
      else for (let i = 0; i < squads.length; i++) this._compactOrders(squads[i]);
      for (let i = 0; i < this.list.length; i++) {
        const squad = this.list[i];
        if (!append && selected.has(squad)) continue;
        if (Number.isInteger(squad.resumeBuildingId)) claimed.add(squad.resumeBuildingId);
        for (let j = squad.orderIndex; j < squad.orders.length; j++) {
          const order = squad.orders[j];
          if (order.kind === CFG.ORDER.SCAVENGE && Number.isInteger(order.buildingId))
            claimed.add(order.buildingId);
        }
      }
      for (let i = 0; i < records.length; i++) {
        const record = records[i];
        if (
          !record ||
          record === this.map.hq ||
          record.use !== CFG.BUILDING_USE.ABANDONED ||
          !this.map.reachable(record) ||
          record.looted ||
          this.map.lootTotal(record) <= 0 ||
          claimed.has(record.id)
        )
          continue;
        claimed.add(record.id);
        candidates.push(record);
      }
      candidates.sort((a, b) => a.id - b.id);
      const considered = candidates.length;
      for (let i = 0; i < squads.length; i++) {
        const squad = squads[i],
          leader = this.citizens.at(squad.members[0]),
          last = squad.orders.length ? squad.orders[squad.orders.length - 1] : leader;
        if (!leader || squad.orders.length >= CFG.AGENT.MAX_ORDERS) continue;
        routes.push({ squad, x: last.x, y: last.y, added: 0 });
      }
      let assigned = 0;
      while (candidates.length && routes.length) {
        let bestRoute = -1,
          bestTarget = -1,
          bestAdded = Infinity,
          bestDistance = Infinity;
        for (let i = 0; i < routes.length; i++) {
          const route = routes[i];
          if (route.squad.orders.length >= CFG.AGENT.MAX_ORDERS) continue;
          for (let j = 0; j < candidates.length; j++) {
            const record = candidates[j],
              distance = Math.hypot(record.cx - route.x, record.cy - route.y);
            if (
              route.added < bestAdded ||
              (route.added === bestAdded && distance < bestDistance) ||
              (route.added === bestAdded &&
                distance === bestDistance &&
                (bestTarget < 0 || record.id < candidates[bestTarget].id))
            ) {
              bestRoute = i;
              bestTarget = j;
              bestAdded = route.added;
              bestDistance = distance;
            }
          }
        }
        if (bestRoute < 0 || bestTarget < 0) break;
        const route = routes[bestRoute],
          record = candidates.splice(bestTarget, 1)[0],
          target = this.map.entryPoint(record);
        if (!target) continue;
        if (
          this.issue(
            route.squad,
            CFG.ORDER.SCAVENGE,
            target.x === undefined ? target.cx : target.x,
            target.y === undefined ? target.cy : target.y,
            record.id,
            true,
          )
        ) {
          const order = route.squad.orders[route.squad.orders.length - 1];
          route.x = order.x;
          route.y = order.y;
          route.added++;
          assigned++;
        }
      }
      if (this.onChanged) this.onChanged();
      return { assigned, considered, skipped: considered - assigned };
    }

    returnHQ(squad, resumeBuildingId, preserveQueue) {
      if (!squad || !this.map.hq) return false;
      const target = this.map.entryPoint(this.map.hq),
        order = {
          kind: CFG.ORDER.RETURN_HQ,
          x: target ? target.x : 0,
          y: target ? target.y : 0,
          buildingId: this.map.hq.id,
        };
      if (!target) return false;
      if (preserveQueue && squad.orders[squad.orderIndex]) {
        squad.orders[squad.orderIndex] = order;
        squad.patrolLoop = false;
      } else {
        this.clearOrders(squad);
        squad.orders.push(order);
      }
      squad.resumeBuildingId = Number.isInteger(resumeBuildingId) ? resumeBuildingId : null;
      squad.garrisonBuildingId = null;
      squad.retreating = false;
      squad.state = "returning";
      this._rebuildRoutePaths(squad);
      this._syncOrderViews(squad);
      if (this.onChanged) this.onChanged();
      return true;
    }

    retreat(squad) {
      if (!this.returnHQ(squad, null, false)) return false;
      squad.retreating = true;
      squad.state = "retreating";
      return true;
    }

    setPatrol(squad, points, loop) {
      if (!squad || !Array.isArray(points) || points.length < 2) return false;
      this.clearOrders(squad);
      for (let i = 0; i < points.length && squad.orders.length < CFG.AGENT.MAX_ORDERS; i++) {
        const point = this.map.nav.nearestWalkable(points[i].x, points[i].y, 120, false);
        if (point)
          squad.orders.push({ kind: CFG.ORDER.PATROL, x: point.x, y: point.y, buildingId: null });
      }
      if (squad.orders.length < 2) {
        this.clearOrders(squad);
        return false;
      }
      squad.patrolLoop = Boolean(loop);
      squad.garrisonBuildingId = null;
      squad.retreating = false;
      squad.state = "patrolling";
      this._rebuildRoutePaths(squad);
      this._syncOrderViews(squad);
      return true;
    }

    patrolQueued(squad) {
      if (!squad) return false;
      const points = [];
      for (let i = squad.orderIndex; i < squad.orders.length; i++) {
        const order = squad.orders[i];
        if (order.kind === CFG.ORDER.MOVE || order.kind === CFG.ORDER.PATROL)
          points.push({ x: order.x, y: order.y });
      }
      return this.setPatrol(squad, points, true);
    }

    clearOrders(squad) {
      squad.orders.length = 0;
      squad.orderIndex = 0;
      squad.patrolLoop = false;
      squad.resumeBuildingId = null;
      squad.state = "idle";
      squad.routePaths.length = 0;
      if (this.citizens)
        for (let i = 0; i < squad.members.length; i++) {
          const member = this.citizens.at(squad.members[i]);
          if (!member) continue;
          member.vx = member.vy = 0;
          member.wantMove = false;
          member.path = null;
        }
      this._syncOrderViews(squad);
    }

    _compactOrders(squad) {
      if (!squad || squad.orderIndex <= 0) return;
      squad.orders.splice(0, squad.orderIndex);
      squad.orderIndex = 0;
      this._rebuildRoutePaths(squad);
      this._syncOrderViews(squad);
    }

    cancelPatrol(squad) {
      if (!squad || !squad.patrolLoop) return false;
      this.clearOrders(squad);
      return true;
    }

    update(member, dt, t, nav) {
      const squad = this.at(member.squadId);
      if (!squad || member.dead) return;
      member.orderIndex = squad.orderIndex;
      if (this.scavenge) this.scavenge.autoCombat(member, squad, dt, t, nav);
      if (!squad.orders.length) {
        member.wantMove = false;
        member.vx *= Math.max(0, 1 - dt * 7);
        member.vy *= Math.max(0, 1 - dt * 7);
        return;
      }
      if (member.cid === squad.members[0]) this._updateLeader(member, squad, dt, t, nav);
      else this._follow(member, squad, dt, nav);
    }

    _updateLeader(leader, squad, dt, t, nav) {
      squad.trailX[squad.trailHead] = leader.x;
      squad.trailY[squad.trailHead] = leader.y;
      squad.trailHead = (squad.trailHead + 1) % squad.trailX.length;
      squad.trailCount = Math.min(squad.trailX.length, squad.trailCount + 1);
      if (squad.orderIndex >= squad.orders.length) {
        if (squad.patrolLoop && squad.orders.length >= 2) squad.orderIndex = 0;
        else {
          const state = squad.garrisonBuildingId === null ? "idle" : "garrisoned";
          this.clearOrders(squad);
          squad.state = state;
          return;
        }
      }
      const order = squad.orders[squad.orderIndex];
      if (order.kind === CFG.ORDER.SCAVENGE && this.scavenge) {
        const result = this.scavenge.updateSquad(squad, order, leader, dt, t, nav);
        if (result === "complete") this._advance(squad);
        else if (result === "blocked") this._recoverRoute(leader, squad, nav);
        return;
      }
      const moveSpeed =
          CFG.AGENT.SPEED * (squad.retreating ? CFG.DEFENSE.RETREAT_SPEED_MULTIPLIER : 1),
        result = ZS.planAndFollow(leader, order, false, moveSpeed, dt, t, nav);
      if (result === "fail") {
        this._recoverRoute(leader, squad, nav);
        return;
      }
      if (result !== "arrived" && leader.bld !== order.buildingId) return;
      if (order.kind === CFG.ORDER.RETURN_HQ || order.kind === CFG.ORDER.ENTER) {
        leader.zoneBuildingId = order.buildingId;
        const building = this.map.at(order.buildingId),
          door = building && building.shape && building.shape.door,
          point = door && (door.front || door.inner);
        if (ZS.sound && building)
          ZS.sound.event("door_open", point ? point.x : building.cx, point ? point.y : building.cy);
        if (order.buildingId === this.map.hq.id && this._deposit(squad)) {
          this._syncOrderViews(squad);
          return;
        }
      }
      this._advance(squad);
      if (order.kind === CFG.ORDER.ENTER) {
        squad.garrisonBuildingId = order.buildingId;
        squad.state = "garrisoned";
      } else if (order.kind === CFG.ORDER.RETURN_HQ && squad.retreating) {
        squad.retreating = false;
        squad.garrisonBuildingId = this.map.hq.id;
        squad.state = "garrisoned";
      } else if (order.kind === CFG.ORDER.ATTACK_MOVE) squad.state = "holding fire line";
    }

    _advance(squad) {
      squad.orderIndex++;
      if (squad.orderIndex >= squad.orders.length) {
        if (squad.patrolLoop && squad.orders.length >= 2) squad.orderIndex = 0;
        else {
          this.clearOrders(squad);
          return;
        }
      }
      this._syncOrderViews(squad);
    }

    _recoverRoute(leader, squad, nav) {
      const order = squad.orders[squad.orderIndex],
        gx = Number.isFinite(leader.gx) ? leader.gx : order.x,
        gy = Number.isFinite(leader.gy) ? leader.gy : order.y,
        path = nav.astar(leader.x, leader.y, gx, gy, false, nav.n, false);
      if (path && path.length) {
        leader.path = path;
        leader.pi = 0;
        leader.gx = gx;
        leader.gy = gy;
        leader.navV0 = nav.version;
        leader.stuckT = 0;
        leader.planFailT = 0;
        squad.state = "rerouting";
        return;
      }
      squad.orders.splice(squad.orderIndex, 1);
      leader.path = null;
      leader.pi = 0;
      leader.planFailT = 0;
      if (!squad.orders.length || (squad.patrolLoop && squad.orders.length < 2)) {
        this.clearOrders(squad);
        squad.state = "route blocked";
      } else {
        if (squad.orderIndex >= squad.orders.length)
          squad.orderIndex = squad.patrolLoop ? 0 : squad.orders.length;
        this._rebuildRoutePaths(squad);
        this._syncOrderViews(squad);
        squad.state = "skipping blocked waypoint";
      }
      if (this.onChanged) this.onChanged();
    }

    _follow(member, squad, dt, nav) {
      const leader = this.citizens.at(squad.members[0]);
      if (!leader) return;
      const rank = member.squadRank || 1,
        side = rank % 2 ? -1 : 1,
        gap = CFG.SQUAD.FORMATION_GAP,
        ca = Math.cos(leader.a),
        sa = Math.sin(leader.a),
        lag = Math.min(squad.trailCount - 1, rank * 5),
        trailIndex =
          (squad.trailHead - 1 - Math.max(0, lag) + squad.trailX.length) % squad.trailX.length,
        baseX = squad.trailCount ? squad.trailX[trailIndex] : leader.x,
        baseY = squad.trailCount ? squad.trailY[trailIndex] : leader.y,
        oy = side * gap * 0.45;
      member.formationTarget.x = baseX - oy * sa;
      member.formationTarget.y = baseY + oy * ca;
      const dx = member.formationTarget.x - member.x,
        dy = member.formationTarget.y - member.y,
        d = Math.hypot(dx, dy);
      if (Math.hypot(member.x - leader.x, member.y - leader.y) > 105) {
        const recovery = nav.nearestWalkable(
          member.formationTarget.x,
          member.formationTarget.y,
          60,
          false,
        );
        if (recovery) {
          member.x = recovery.x;
          member.y = recovery.y;
          member.vx = member.vy = 0;
          member.path = null;
          return;
        }
      }
      if (d < 7) {
        member.vx *= Math.max(0, 1 - dt * 7);
        member.vy *= Math.max(0, 1 - dt * 7);
        return;
      }
      member.a = Math.atan2(dy, dx);
      const speed =
        (d > 80 ? CFG.AGENT.SPEED * 1.18 : CFG.AGENT.SPEED) *
        (squad.retreating ? CFG.DEFENSE.RETREAT_SPEED_MULTIPLIER : 1);
      member.vx += (Math.cos(member.a) * speed - member.vx) * dt * 3;
      member.vy += (Math.sin(member.a) * speed - member.vy) * dt * 3;
      member.wantMove = true;
    }

    _deposit(squad) {
      for (let i = 0; i < R.COUNT; i++) {
        this.state.stock[i] += squad.inventory[i];
        squad.inventory[i] = 0;
      }
      const ammo = Math.min(CFG.SQUAD.START_AMMO, this.state.stock[R.AMMO]),
        medicine = Math.min(CFG.SQUAD.START_MEDICINE, this.state.stock[R.MEDICINE]);
      squad.inventory[R.AMMO] = ammo;
      squad.inventory[R.MEDICINE] = medicine;
      this.state.stock[R.AMMO] -= ammo;
      this.state.stock[R.MEDICINE] -= medicine;
      const resume = squad.resumeBuildingId;
      squad.resumeBuildingId = null;
      if (Number.isInteger(resume)) {
        const record = this.map.at(resume);
        if (
          record &&
          !record.demolished &&
          !record.demolitionT &&
          !record.looted &&
          this.map.lootTotal(record) > 0 &&
          this.map.reachable(record)
        ) {
          const target = this.map.entryPoint(record);
          squad.orders[squad.orderIndex] = {
            kind: CFG.ORDER.SCAVENGE,
            x: target.x,
            y: target.y,
            buildingId: record.id,
          };
          squad.state = "resuming scavenge";
          this._rebuildRoutePaths(squad);
          if (this.onChanged) this.onChanged();
          return true;
        }
      }
      if (this.onChanged) this.onChanged();
      return false;
    }

    _normalizeOrders(squad) {
      for (let i = squad.orders.length - 1; i >= 0; i--) {
        const order = squad.orders[i];
        let point = null;
        if (Number.isInteger(order.buildingId)) {
          const record = this.map.at(order.buildingId);
          if (record && this.map.reachable(record)) point = this.map.entryPoint(record);
        } else point = this.map.nav.nearestWalkable(order.x, order.y, 120, false);
        if (!point) {
          squad.orders.splice(i, 1);
          if (i < squad.orderIndex) squad.orderIndex--;
          continue;
        }
        order.x = point.x;
        order.y = point.y;
      }
      squad.orderIndex = Math.max(0, Math.min(squad.orders.length, squad.orderIndex));
      if (squad.patrolLoop && squad.orders.length < 2) squad.patrolLoop = false;
    }

    _rebuildRoutePaths(squad) {
      if (!squad.routePaths) squad.routePaths = [];
      squad.routePaths.length = squad.orders.length;
      if (!this.map.nav || squad.orders.length < 2) return;
      const legs = squad.patrolLoop ? squad.orders.length : squad.orders.length - 1;
      for (let i = 0; i < legs; i++) {
        const from = squad.orders[i],
          to = squad.orders[(i + 1) % squad.orders.length];
        squad.routePaths[i] =
          Math.hypot(from.x - to.x, from.y - to.y) < 12
            ? null
            : this.map.nav.astar(from.x, from.y, to.x, to.y, false, 0, false);
      }
    }

    _syncOrderViews(squad) {
      for (let i = 0; i < squad.members.length; i++) {
        const member = this.citizens && this.citizens.at(squad.members[i]);
        if (!member) continue;
        member.orders = squad.orders;
        member.orderIndex = squad.orderIndex;
      }
    }

    inventoryTotal(squad) {
      let total = 0;
      for (let i = 0; i < R.COUNT; i++) total += squad.inventory[i];
      return total;
    }

    isGarrisoned(agent) {
      if (!agent || agent.squadId === null) return false;
      const squad = this.at(agent.squadId);
      return Boolean(
        squad && squad.garrisonBuildingId !== null && agent.bld === squad.garrisonBuildingId,
      );
    }

    _atHQ(squad) {
      for (let i = 0; i < squad.members.length; i++) {
        const member = this.citizens.at(squad.members[i]);
        if (member && member.bld !== this.map.hq.id) return false;
      }
      return true;
    }

    capture() {
      const out = [];
      for (let i = 0; i < this.list.length; i++) {
        const squad = this.list[i],
          orders = [];
        for (let j = 0; j < squad.orders.length; j++) {
          const order = squad.orders[j];
          orders.push({
            kind: order.kind,
            x: order.x,
            y: order.y,
            buildingId: order.buildingId,
          });
        }
        out.push({
          id: squad.id,
          members: squad.members.slice(),
          inventory: squad.inventory.slice(),
          capacity: squad.capacity,
          equipment: squad.equipment.slice(),
          orders,
          orderIndex: squad.orderIndex,
          patrolLoop: squad.patrolLoop,
          resumeBuildingId: squad.resumeBuildingId,
          garrisonBuildingId: squad.garrisonBuildingId,
          retreating: squad.retreating,
          state: squad.state,
        });
      }
      this.state.zone.squads = out;
    }
  }

  ZS.ZoneSquads = ZoneSquads;
})();
