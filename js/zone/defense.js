/* Phase-five global night pressure. Horde agents exist only while revealed on
   the map; the save stores unspawned and living counts, then rematerializes
   them from the same deterministic edge after a reload. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});
  const CFG = ZS.ZoneConfig;
  const U = CFG.BUILDING_USE;
  const DIR_LABEL = Object.freeze(["norte", "este", "sur", "oeste"]);
  const DIR_VECTOR = Object.freeze([
    Object.freeze([0, -1]),
    Object.freeze([1, 0]),
    Object.freeze([0, 1]),
    Object.freeze([-1, 0]),
  ]);

  class ZoneDefense {
    constructor(state, map, fortifications) {
      this.state = state;
      this.map = map;
      this.fortifications = fortifications;
      this.agriculture = null;
      this.data = state.zone.defense;
      this.citizens = null;
      this.squads = null;
      this.scenario = null;
      this.agents = null;
      this.onChanged = null;
      this.phase = state.phase();
      this.spawnRemaining = this.data.active ? this.data.pending + this.data.live : 0;
      this.data.pending = this.spawnRemaining;
      this.data.live = 0;
      this.spawnT = 0;
      this.target = { x: 0, y: 0 };
      this.warningData = { active: false, minutes: 0, direction: "norte", directionId: 0 };
    }

    connect(citizens, squads, scenario, agents, onChanged) {
      this.citizens = citizens;
      this.squads = squads;
      this.scenario = scenario;
      this.agents = agents;
      this.onChanged = onChanged;
      if (this.data.report) scenario.paused = true;
      else if (this.phase === "night" && !this.data.active) this.startNight();
    }

    connectAgriculture(agriculture) {
      this.agriculture = agriculture;
    }

    update(dt, t, nav) {
      const phase = this.state.phase();
      if (phase !== this.phase) {
        const previous = this.phase;
        this.phase = phase;
        if (phase === "night" && previous !== "night") this.startNight();
        else if (previous === "night" && phase !== "night" && this.data.active)
          this.endNight(false);
      }
      if (!this.data.active || phase !== "night") return;
      this.spawnT -= dt;
      while (this.spawnRemaining > 0 && this.spawnT <= 0) {
        this._spawn(t, nav);
        this.spawnRemaining--;
        this.data.pending = this.spawnRemaining;
        this.data.spawned++;
        this.spawnT += Math.max(0.65, CFG.HORDE.SPAWN_SECONDS - this.state.day * 0.08);
      }
      if (this.spawnRemaining <= 0 && this.living() <= 0) this.endNight(true);
    }

    startNight() {
      if (!this.map.hq || this.data.lastStartedDay === this.state.day) return false;
      this.data.lastStartedDay = this.state.day;
      this.data.active = true;
      this.data.spawned = 0;
      this.data.kills = 0;
      this.data.citizensLost = 0;
      this.data.buildingDamage = 0;
      this.data.breached = false;
      this.data.direction = this.directionForDay(this.state.day);
      const population = this.citizens.stats().population,
        adapted = this.map.records.reduce(
          (count, record) =>
            count + (record.use !== CFG.BUILDING_USE.ABANDONED && record !== this.map.hq ? 1 : 0),
          0,
        );
      this.spawnRemaining = Math.ceil(
        (CFG.HORDE.BASE_COUNT +
          this.state.day * CFG.HORDE.PER_DAY +
          Math.floor(population / 20) +
          Math.floor(adapted / 3)) *
          (this.scenario.campaign ? this.scenario.campaign.nightMultiplier() : 1) *
          (this.scenario.threats ? this.scenario.threats.nightMultiplier() : 1),
      );
      this.data.pending = this.spawnRemaining;
      this.data.live = 0;
      this.spawnT = 0;
      const door = this.map.hq.shape.door,
        rally = door ? door.front : this.map.hq;
      for (let i = 0; i < this.squads.list.length; i++) {
        const squad = this.squads.list[i];
        if (squad.garrisonBuildingId !== null) {
          squad.state = "garrisoned";
          continue;
        }
        this.squads.returnHQ(squad, null);
        this.squads.issue(
          squad,
          CFG.ORDER.MOVE,
          rally.x === undefined ? rally.cx : rally.x,
          rally.y === undefined ? rally.cy : rally.y,
          null,
          true,
        );
      }
      if (ZS.sound) ZS.sound.event("horn", this.map.hq.cx, this.map.hq.cy);
      if (this.scenario.campaign) this.scenario.campaign.onNightStarted();
      if (this.onChanged) this.onChanged();
      return true;
    }

    _spawn(t, nav) {
      const world = this.map.world,
        direction = this.data.direction,
        offset = ((this.data.spawned * 83 + this.state.day * 47) % 700) - 350;
      const distance = Math.min(980, CFG.DEFENSE.MAX_DISTANCE_FROM_HQ + 220);
      let x = this.map.hq.cx,
        y = this.map.hq.cy;
      if (direction === 0) {
        x = this.map.hq.cx + offset;
        y = this.map.hq.cy - distance;
      } else if (direction === 1) {
        x = this.map.hq.cx + distance;
        y = this.map.hq.cy + offset;
      } else if (direction === 2) {
        x = this.map.hq.cx + offset;
        y = this.map.hq.cy + distance;
      } else {
        x = this.map.hq.cx - distance;
        y = this.map.hq.cy + offset;
      }
      x = ZS.clamp(x, 24, world.w - 24);
      y = ZS.clamp(y, 24, world.h - 24);
      const point = nav.nearestWalkable(x, y, 260, true) || nav.nearestWalkable(x, y, 260, false);
      if (!point) return;
      const enemy = this.scenario.makeAgent(point.x, point.y, 2);
      enemy.zoneEnemy = true;
      enemy.zoneHorde = true;
      enemy.encounterBuildingId = null;
      enemy.targetSquadId = null;
      const roll = ZS.hash(this.state.seed + this.state.day * 211 + this.data.spawned * 37);
      enemy.zoneEnemyType =
        this.state.day >= 3 && roll > 0.82
          ? CFG.ENEMY.BRUTE
          : roll > 0.55
            ? CFG.ENEMY.RUNNER
            : CFG.ENEMY.SHAMBLER;
      const hpMultiplier =
        enemy.zoneEnemyType === CFG.ENEMY.BRUTE
          ? 2.4
          : enemy.zoneEnemyType === CFG.ENEMY.RUNNER
            ? 0.75
            : 1;
      enemy.hp = Math.max(
        1,
        Math.round((CFG.HORDE.HP_BASE + this.state.day * CFG.HORDE.HP_PER_DAY) * hpMultiplier),
      );
      enemy.maxHP = enemy.hp;
      enemy.enemyTarget = { x: this.map.hq.cx, y: this.map.hq.cy };
      enemy.attackT = 0;
      enemy.planFailT = t;
      this.agents.push(enemy);
    }

    updateEnemy(enemy, dt, t, nav) {
      enemy.attackT = Math.max(0, enemy.attackT - dt);
      const fortification = this.fortifications.nearbyTarget(enemy, 58);
      if (fortification) {
        const distance = Math.hypot(fortification.x - enemy.x, fortification.y - enemy.y);
        if (distance <= CFG.HORDE.ATTACK_RANGE + 22) {
          this._stop(enemy, dt);
          if (enemy.attackT <= 0) {
            enemy.attackT = CFG.HORDE.ATTACK_SECONDS;
            const multiplier = enemy.zoneEnemyType === CFG.ENEMY.BRUTE ? 2 : 1;
            const damage = this.fortifications.damage(
              fortification,
              CFG.HORDE.BUILDING_DAMAGE * multiplier,
            );
            this.data.buildingDamage += damage;
          }
          return;
        }
      }
      let citizen = null,
        best = CFG.HORDE.AGGRO_RANGE * CFG.HORDE.AGGRO_RANGE;
      for (let i = 0; i < this.citizens.byId.length; i++) {
        const candidate = this.citizens.byId[i];
        if (!candidate || candidate.dead || candidate.away) continue;
        const dx = candidate.x - enemy.x,
          dy = candidate.y - enemy.y,
          distance = dx * dx + dy * dy;
        if (distance < best && nav.los(enemy.x, enemy.y, candidate.x, candidate.y, true)) {
          citizen = candidate;
          best = distance;
        }
      }
      if (citizen) {
        const distance = Math.sqrt(best);
        if (distance <= CFG.HORDE.ATTACK_RANGE) {
          this._stop(enemy, dt);
          if (enemy.attackT <= 0) {
            enemy.attackT = CFG.HORDE.ATTACK_SECONDS;
            const cover = this.squads.isGarrisoned(citizen)
              ? CFG.DEFENSE.GARRISON_DAMAGE_MULTIPLIER
              : 1;
            citizen.hp -= this.enemyDamage(enemy) * cover;
            citizen.flash = 0.12;
            citizen.moral = Math.max(0, citizen.moral - 3);
            this.citizens.expose(citizen, 5 + ZS.hash(enemy.seed + citizen.cid * 31) * 10);
            if (citizen.hp <= 0) {
              this.data.citizensLost++;
              this.citizens.kill(citizen);
            }
          }
          return;
        }
        this.target.x = citizen.x;
        this.target.y = citizen.y;
        ZS.planAndFollow(enemy, this.target, true, this.enemySpeed(enemy), dt, t, nav);
        return;
      }
      const building = this._targetBuilding(enemy),
        door = building && building.shape && building.shape.door,
        target = door ? door.front : building;
      if (!building || !target) return;
      this.target.x = target.x === undefined ? target.cx : target.x;
      this.target.y = target.y === undefined ? target.cy : target.y;
      const distance = Math.hypot(this.target.x - enemy.x, this.target.y - enemy.y);
      if (distance <= CFG.HORDE.ATTACK_RANGE + 3) {
        this._stop(enemy, dt);
        if (enemy.attackT <= 0) {
          enemy.attackT = CFG.HORDE.ATTACK_SECONDS;
          const multiplier = enemy.zoneEnemyType === CFG.ENEMY.BRUTE ? 2 : 1;
          const damage = Math.min(building.hp, CFG.HORDE.BUILDING_DAMAGE * multiplier);
          building.hp = Math.max(0, building.hp - damage);
          this.data.buildingDamage += damage;
          if (building.hp <= 0) {
            building.active = false;
            if (building === this.map.hq) {
              this.data.breached = true;
              this.endNight(false);
            }
          }
          if (this.onChanged) this.onChanged();
        }
        return;
      }
      ZS.planAndFollow(enemy, this.target, true, this.enemySpeed(enemy), dt, t, nav);
    }

    _stop(enemy, dt) {
      enemy.wantMove = false;
      enemy.vx *= Math.max(0, 1 - dt * 6);
      enemy.vy *= Math.max(0, 1 - dt * 6);
    }

    _targetBuilding(enemy) {
      let target = this.map.hq,
        best = target ? Math.hypot(target.cx - enemy.x, target.cy - enemy.y) : Infinity;
      for (let i = 0; i < this.map.records.length; i++) {
        const record = this.map.records[i];
        if (record.use === U.ABANDONED || record.hp <= 0 || record === this.map.hq) continue;
        const distance = Math.hypot(record.cx - enemy.x, record.cy - enemy.y);
        if (distance < best) {
          best = distance;
          target = record;
        }
      }
      if (this.agriculture)
        for (let i = 0; i < this.agriculture.list.length; i++) {
          const field = this.agriculture.list[i];
          if (field.hp <= 0) continue;
          const distance = Math.hypot(field.x - enemy.x, field.y - enemy.y);
          if (distance < best) {
            best = distance;
            target = field;
          }
        }
      return target;
    }

    directionForDay(day) {
      return (ZS.hash(this.state.seed + day * 97) * 4) | 0;
    }

    warning() {
      const remaining = CFG.CLOCK.NIGHT - this.state.minute,
        active =
          Boolean(this.map.hq) &&
          !this.data.active &&
          !this.data.report &&
          this.state.phase() === "dusk" &&
          remaining > 0 &&
          remaining <= CFG.DEFENSE.ALERT_MINUTES,
        directionId = this.directionForDay(this.state.day);
      this.warningData.active = active;
      this.warningData.minutes = active ? Math.max(0, Math.ceil(remaining)) : 0;
      this.warningData.direction = DIR_LABEL[directionId];
      this.warningData.directionId = directionId;
      return this.warningData;
    }

    enemySpeed(enemy) {
      if (enemy.zoneEnemyType === CFG.ENEMY.RUNNER) return CFG.HORDE.SPEED * 1.42;
      if (enemy.zoneEnemyType === CFG.ENEMY.BRUTE) return CFG.HORDE.SPEED * 0.72;
      return CFG.HORDE.SPEED;
    }

    enemyDamage(enemy) {
      if (enemy.zoneEnemyType === CFG.ENEMY.BRUTE) return CFG.HORDE.CITIZEN_DAMAGE * 1.75;
      if (enemy.zoneEnemyType === CFG.ENEMY.RUNNER) return CFG.HORDE.CITIZEN_DAMAGE * 0.75;
      return CFG.HORDE.CITIZEN_DAMAGE;
    }

    drawWarning(c) {
      const warning = this.warning();
      if (!warning.active || !this.map.hq) return;
      const hq = this.map.hq,
        distance = 105,
        vector = DIR_VECTOR[warning.directionId],
        x0 = hq.cx + vector[0] * 44,
        y0 = hq.cy + vector[1] * 44,
        x1 = hq.cx + vector[0] * distance,
        y1 = hq.cy + vector[1] * distance,
        sideX = -vector[1],
        sideY = vector[0];
      c.save();
      c.strokeStyle = "rgba(150,62,48,0.84)";
      c.fillStyle = "rgba(246,241,227,0.9)";
      c.lineWidth = 2.4;
      ZS.wline(c, x0, y0, x1, y1, 9101 + this.state.day, 1.4);
      ZS.wline(
        c,
        x1,
        y1,
        x1 - vector[0] * 15 + sideX * 8,
        y1 - vector[1] * 15 + sideY * 8,
        9107 + this.state.day,
        1,
      );
      ZS.wline(
        c,
        x1,
        y1,
        x1 - vector[0] * 15 - sideX * 8,
        y1 - vector[1] * 15 - sideY * 8,
        9113 + this.state.day,
        1,
      );
      c.font = 'bold 11px "Segoe Script", "Bradley Hand", cursive';
      c.textAlign = "center";
      c.fillText("amenaza · " + warning.direction, x1, y1 - 13);
      c.restore();
    }

    killEnemy(enemy) {
      if (!enemy || enemy.dead) return false;
      enemy.dead = true;
      this.data.kills++;
      if (this.onChanged) this.onChanged();
      return true;
    }

    living() {
      let count = 0;
      for (let i = 0; this.agents && i < this.agents.length; i++) {
        const agent = this.agents[i];
        if (agent.zoneHorde && !agent.dead) count++;
      }
      return count;
    }

    endNight(cleared) {
      if (!this.data.active) return false;
      this.data.active = false;
      this.data.lastCompletedDay = this.data.lastStartedDay;
      this.spawnRemaining = 0;
      this.data.pending = 0;
      this.data.live = 0;
      for (let i = 0; i < this.agents.length; i++)
        if (this.agents[i].zoneHorde) this.agents[i].dead = true;
      const report = {
        day: this.data.lastStartedDay,
        kills: this.data.kills,
        citizensLost: this.data.citizensLost,
        buildingDamage: Math.round(this.data.buildingDamage),
        breached: this.data.breached,
      };
      this.data.report = report;
      if (this.scenario.campaign) this.scenario.campaign.onNightEnded(cleared);
      if (cleared) {
        if (this.state.minute >= CFG.CLOCK.NIGHT) this.state.day++;
        this.state.minute = CFG.CLOCK.DAWN;
      }
      if (this.map.hq.hp <= 0) this.map.hq.hp = this.map.hq.maxHP * 0.35;
      this.scenario.paused = true;
      this.phase = this.state.phase();
      this.state.save();
      if (this.onChanged) this.onChanged();
      return true;
    }

    dismissReport() {
      if (!this.data.report) return false;
      this.data.report = null;
      this.scenario.paused = Boolean(
        this.scenario.campaign && this.scenario.campaign.hasBlocking(),
      );
      this.state.save();
      if (this.onChanged) this.onChanged();
      return true;
    }

    reportCard() {
      const report = this.data.report;
      if (!report) return null;
      return {
        title: report.breached
          ? "noche " + report.day + " — el cuartel general ha caído"
          : "noche " + report.day + " superada",
        lines: [
          report.kills + " infectados detenidos",
          report.citizensLost + " habitantes perdidos",
          report.buildingDamage + " de daño estructural",
          "la horda llegó desde el " + DIR_LABEL[this.data.direction],
        ],
        lost: report.breached,
      };
    }

    capture() {
      this.data.pending = this.spawnRemaining;
      this.data.live = this.living();
    }

    status() {
      const warning = this.warning();
      return {
        active: this.data.active,
        remaining: this.spawnRemaining + this.living(),
        kills: this.data.kills,
        direction: DIR_LABEL[this.data.direction],
        hqHP: this.map.hq ? Math.ceil(this.map.hq.hp) : 0,
        hqMaxHP: this.map.hq ? Math.ceil(this.map.hq.maxHP) : 0,
        warning,
      };
    }
  }

  ZS.ZoneDefense = ZoneDefense;
})();
