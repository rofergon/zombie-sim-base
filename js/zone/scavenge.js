/* Finite seeded loot and small, building-bound infected encounters. Hidden
   threats are counts in building state until the first squad reveals them. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});
  const CFG = ZS.ZoneConfig;
  const R = CFG.RESOURCE;

  class ZoneScavenge {
    constructor(state, map) {
      this.state = state;
      this.map = map;
      this.citizens = null;
      this.squads = null;
      this.scenario = null;
      this.agents = null;
      this.onChanged = null;
    }

    connect(citizens, squads, scenario, agents, onChanged) {
      this.citizens = citizens;
      this.squads = squads;
      this.scenario = scenario;
      this.agents = agents;
      this.onChanged = onChanged;
    }

    updateSquad(squad, order, leader, dt, t, nav) {
      const record = this.map.at(order.buildingId);
      if (
        !record ||
        record.demolished ||
        record.demolitionT ||
        !this.map.entryPoint(record) ||
        record === this.map.hq ||
        record.looted
      )
        return "complete";
      if (leader.bld !== record.id) {
        squad.state = "moving to scavenge";
        const result = ZS.planAndFollow(leader, order, false, CFG.AGENT.SPEED, dt, t, nav);
        return result === "fail" ? "blocked" : "moving";
      }
      if (!record.revealed) {
        record.revealed = true;
        this._materialize(record, squad.id);
      } else if (record.infectedRemaining > 0 && !record.encounterSpawned)
        this._materialize(record, squad.id);
      const threat = this._livingThreat(record.id);
      if (threat > 0) {
        squad.state = "encounter";
        return "encounter";
      }
      record.infectedRemaining = 0;
      record.cleared = true;
      squad.state = "scavenging";
      record.scavengeProgress += dt;
      let transferable = true;
      while (record.scavengeProgress >= CFG.SCAVENGE.TICK_SECONDS) {
        record.scavengeProgress -= CFG.SCAVENGE.TICK_SECONDS;
        if (!this._takeOne(record, squad)) {
          transferable = false;
          break;
        }
      }
      if (this.map.lootTotal(record) <= 0) {
        record.looted = true;
        squad.state = "idle";
        if (this.onChanged) this.onChanged();
        return "complete";
      }
      if (this.squads.inventoryTotal(squad) >= squad.capacity) {
        this.squads.returnHQ(squad, record.id, true);
        if (this.onChanged) this.onChanged();
        return "returning";
      }
      if (!transferable) {
        squad.state = "loot left for another loadout";
        return "complete";
      }
      return "scavenging";
    }

    _materialize(record, squadId) {
      if (record.encounterSpawned) return;
      record.encounterSpawned = true;
      const count = record.infectedRemaining;
      for (let i = 0; i < count; i++) {
        const room = record.shape.rooms[i % record.shape.rooms.length],
          x = room[0] + 16 + ((i * 31) % Math.max(20, room[2] - 32)),
          y = room[1] + 16 + ((i * 47) % Math.max(20, room[3] - 32)),
          agent = this.scenario.makeAgent(x, y, 2);
        agent.zoneEnemy = true;
        agent.encounterBuildingId = record.id;
        agent.targetSquadId = squadId;
        agent.hp = CFG.SCAVENGE.ENCOUNTER_HP;
        agent.maxHP = agent.hp;
        agent.enemyTarget = { x, y };
        agent.attackT = 0;
        this.agents.push(agent);
      }
      if (!count) record.cleared = true;
      if (this.onChanged) this.onChanged();
    }

    _livingThreat(buildingId) {
      let count = 0;
      for (let i = 0; i < this.agents.length; i++) {
        const agent = this.agents[i];
        if (agent.zoneEnemy && !agent.dead && agent.encounterBuildingId === buildingId) count++;
      }
      return count;
    }

    _takeOne(record, squad) {
      if (this.squads.inventoryTotal(squad) >= squad.capacity) return false;
      for (let id = 0; id < R.COUNT; id++)
        if (record.loot[id] > 0) {
          record.loot[id]--;
          squad.inventory[id]++;
          if (this.onChanged) this.onChanged();
          return true;
        }
      for (let weapon = CFG.WEAPON.RIFLE; weapon >= CFG.WEAPON.PISTOL; weapon--)
        if (record.lootWeapons[weapon] > 0) {
          if (this._equip(squad, weapon)) {
            record.lootWeapons[weapon]--;
            if (this.onChanged) this.onChanged();
            return true;
          }
        }
      return false;
    }

    _equip(squad, weapon) {
      let index = -1;
      for (let i = 0; i < squad.equipment.length; i++)
        if (squad.equipment[i] < weapon) {
          index = i;
          break;
        }
      if (index < 0 && squad.equipment.length < squad.members.length)
        index = squad.equipment.length;
      if (index < 0) return false;
      squad.equipment[index] = weapon;
      const member = this.citizens.at(squad.members[index]);
      if (member) {
        member.weapon = weapon;
        member.gun = true;
        member.wep = weapon === CFG.WEAPON.RIFLE ? "rifle" : "pistol";
      }
      return true;
    }

    autoCombat(member, squad, dt, _t, nav) {
      member.attackT = Math.max(0, member.attackT - dt);
      if (member.hp < member.maxHP * 0.45 && squad.inventory[R.MEDICINE] > 0) {
        squad.inventory[R.MEDICINE]--;
        member.hp = Math.min(member.maxHP, member.hp + 38);
      }
      let target = null,
        best = Infinity;
      const hasAmmo = squad.inventory[R.AMMO] > 0,
        weapon = hasAmmo ? member.weapon : CFG.WEAPON.MACHETE,
        range =
          weapon === CFG.WEAPON.MACHETE
            ? CFG.SQUAD.MELEE_RANGE
            : CFG.SQUAD.FIRE_RANGE *
              (this.squads.isGarrisoned(member) ? CFG.DEFENSE.GARRISON_RANGE_MULTIPLIER : 1),
        range2 = range * range;
      for (let i = 0; i < this.agents.length; i++) {
        const enemy = this.agents[i];
        if (!enemy.zoneEnemy || enemy.dead) continue;
        const building = this.map.at(enemy.encounterBuildingId);
        if (
          building &&
          building.shape.door &&
          !building.shape.door.broken &&
          member.bld !== building.id
        )
          continue;
        const dx = enemy.x - member.x,
          dy = enemy.y - member.y,
          d = dx * dx + dy * dy;
        if (d >= best || d > range2 || !nav.los(member.x, member.y, enemy.x, enemy.y, false))
          continue;
        target = enemy;
        best = d;
      }
      if (!target || member.attackT > 0) return;
      member.a = Math.atan2(target.y - member.y, target.x - member.x);
      member.activeWeapon = weapon;
      member.attackT =
        weapon === CFG.WEAPON.MACHETE ? CFG.SQUAD.MELEE_SECONDS : CFG.SQUAD.FIRE_SECONDS;
      let damage = 1;
      if (weapon !== CFG.WEAPON.MACHETE) {
        squad.inventory[R.AMMO]--;
        damage = weapon === CFG.WEAPON.RIFLE ? 2 : 1;
        member.muzzle = 0.1;
        ZS.fx.push({ x0: member.x, y0: member.y - 7, x1: target.x, y1: target.y - 6, t: 0.1 });
        if (ZS.sound)
          ZS.sound.event(
            weapon === CFG.WEAPON.RIFLE ? "shot_rifle" : "shot_smg",
            member.x,
            member.y,
          );
      }
      target.hp -= damage;
      target.flash = 0.1;
      if (target.hp <= 0) this.killEnemy(target);
    }

    updateEnemy(enemy, dt, _t, nav) {
      enemy.attackT = Math.max(0, enemy.attackT - dt);
      const squad = this.squads.at(enemy.targetSquadId);
      let target = null,
        best = Infinity;
      if (squad)
        for (let i = 0; i < squad.members.length; i++) {
          const member = this.citizens.at(squad.members[i]);
          if (!member || member.dead) continue;
          const building = this.map.at(enemy.encounterBuildingId);
          if (
            building &&
            building.shape.door &&
            !building.shape.door.broken &&
            member.bld !== building.id
          )
            continue;
          const dx = member.x - enemy.x,
            dy = member.y - enemy.y,
            d = dx * dx + dy * dy;
          if (d < best && nav.los(enemy.x, enemy.y, member.x, member.y, false)) {
            best = d;
            target = member;
          }
        }
      if (!target) {
        enemy.vx *= Math.max(0, 1 - dt * 5);
        enemy.vy *= Math.max(0, 1 - dt * 5);
        return;
      }
      const distance = Math.sqrt(best);
      enemy.a = Math.atan2(target.y - enemy.y, target.x - enemy.x);
      if (distance <= 17) {
        enemy.vx *= Math.max(0, 1 - dt * 6);
        enemy.vy *= Math.max(0, 1 - dt * 6);
        if (enemy.attackT <= 0) {
          enemy.attackT = CFG.SCAVENGE.ATTACK_SECONDS;
          target.hp -=
            9 * (this.squads.isGarrisoned(target) ? CFG.DEFENSE.GARRISON_DAMAGE_MULTIPLIER : 1);
          target.flash = 0.12;
          target.moral = Math.max(0, target.moral - 2);
          if (target.hp <= 0) this.citizens.kill(target);
        }
        return;
      }
      enemy.vx += (Math.cos(enemy.a) * 72 - enemy.vx) * dt * 2.8;
      enemy.vy += (Math.sin(enemy.a) * 72 - enemy.vy) * dt * 2.8;
      enemy.wantMove = true;
    }

    killEnemy(enemy) {
      if (!enemy || enemy.dead) return;
      if (enemy.zoneHorde && this.scenario.defense) {
        this.scenario.defense.killEnemy(enemy);
        return;
      }
      enemy.dead = true;
      const record = this.map.at(enemy.encounterBuildingId);
      if (record) {
        record.infectedRemaining = Math.max(0, record.infectedRemaining - 1);
        if (!record.infectedRemaining) record.cleared = true;
      }
      if (this.onChanged) this.onChanged();
    }
  }

  ZS.ZoneScavenge = ZoneScavenge;
})();
