/* Persistent local threat ecology. Infested lairs and a raider hideout occupy
   real buildings, reveal near patrols, survive save/load and feed night/raid
   pressure until a squad clears their finite defenders. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});
  const CFG = ZS.ZoneConfig;
  const R = CFG.RESOURCE;

  class ZoneThreats {
    constructor(state, map) {
      this.state = state;
      this.map = map;
      this.list = state.zone.threats;
      this.citizens = null;
      this.squads = null;
      this.scenario = null;
      this.agents = null;
      this.onChanged = null;
      this.lastEvent = null;
    }

    prepare() {
      if (!this.list.length) this._seed();
      for (let i = 0; i < this.map.records.length; i++) this.map.records[i].zoneThreatId = null;
      for (let i = 0; i < this.list.length; i++) {
        const site = this.list[i],
          record = this.map.at(site.buildingId);
        if (!record || record === this.map.hq) {
          site.cleared = true;
          site.strength = 0;
          continue;
        }
        record.zoneThreatId = site.id;
        if (!site.cleared)
          record.infectedRemaining = Math.max(record.infectedRemaining, site.strength);
      }
      this.capture();
    }

    _seed() {
      const candidates = [];
      for (let i = 0; i < this.map.records.length; i++) {
        const record = this.map.records[i];
        if (
          record === this.map.hq ||
          record === this.map.recommended ||
          record.demolished ||
          !this.map.entryPoint(record)
        )
          continue;
        candidates.push(record);
      }
      candidates.sort(
        (a, b) =>
          ZS.hash(this.state.seed + a.id * 701 + 17) - ZS.hash(this.state.seed + b.id * 701 + 17),
      );
      const count = Math.min(CFG.THREATS.SITE_COUNT, candidates.length);
      for (let i = 0; i < count; i++) {
        const record = candidates[i],
          kind = i === count - 1 ? CFG.THREAT.RAIDERS : CFG.THREAT.LAIR,
          strength =
            kind === CFG.THREAT.RAIDERS
              ? 4
              : 3 + ((ZS.hash(this.state.seed + record.id * 43) * 4) | 0);
        this.list.push({
          id: this.state.zone.nextThreatId++,
          kind,
          buildingId: record.id,
          strength,
          maxStrength: strength,
          revealed: false,
          cleared: false,
          lastRaidDay: 0,
        });
      }
    }

    connect(citizens, squads, scenario, agents, onChanged) {
      this.citizens = citizens;
      this.squads = squads;
      this.scenario = scenario;
      this.agents = agents;
      this.onChanged = onChanged;
    }

    at(id) {
      for (let i = 0; i < this.list.length; i++) if (this.list[i].id === id) return this.list[i];
      return null;
    }

    forBuilding(buildingId) {
      const record = this.map.at(buildingId);
      return record && Number.isInteger(record.zoneThreatId) ? this.at(record.zoneThreatId) : null;
    }

    clearAtHeadquarters(record) {
      const site = record && this.forBuilding(record.id);
      if (!site) return false;
      site.cleared = true;
      site.strength = 0;
      record.zoneThreatId = null;
      record.infectedRemaining = 0;
      this.capture();
      return true;
    }

    materialize(record, squadId) {
      const site = record && this.forBuilding(record.id);
      if (!site || site.cleared || site.strength <= 0) return false;
      record.encounterSpawned = true;
      site.revealed = true;
      record.revealed = true;
      record.infectedRemaining = site.strength;
      for (let i = 0; i < site.strength; i++) {
        const room = record.shape.rooms[i % record.shape.rooms.length],
          x = room[0] + 16 + ((i * 31) % Math.max(20, room[2] - 32)),
          y = room[1] + 16 + ((i * 47) % Math.max(20, room[3] - 32)),
          raider = site.kind === CFG.THREAT.RAIDERS,
          agent = this.scenario.makeAgent(x, y, raider ? 0 : 2);
        agent.zoneEnemy = true;
        agent.zoneRaider = raider;
        agent.zoneThreatId = site.id;
        agent.encounterBuildingId = record.id;
        agent.targetSquadId = squadId;
        agent.hp = raider ? 5 : CFG.SCAVENGE.ENCOUNTER_HP;
        agent.maxHP = agent.hp;
        agent.enemyTarget = { x, y };
        agent.attackT = 0;
        this.agents.push(agent);
      }
      if (this.onChanged) this.onChanged();
      return true;
    }

    killEnemy(enemy) {
      const site = enemy && this.at(enemy.zoneThreatId);
      if (!site || enemy.dead) return false;
      enemy.dead = true;
      site.strength = Math.max(0, site.strength - 1);
      const record = this.map.at(site.buildingId);
      if (record) record.infectedRemaining = site.strength;
      if (!site.strength) {
        site.cleared = true;
        if (record) {
          record.cleared = true;
          record.loot[R.FUEL] += site.kind === CFG.THREAT.RAIDERS ? 5 : 2;
          record.loot[R.AMMO] += site.kind === CFG.THREAT.RAIDERS ? 8 : 2;
        }
        this.lastEvent =
          site.kind === CFG.THREAT.RAIDERS
            ? "Escondite de saqueadores neutralizado"
            : "Guarida infectada destruida";
      }
      if (this.onChanged) this.onChanged();
      return true;
    }

    update() {
      if (!this.citizens) return;
      for (let i = 0; i < this.list.length; i++) {
        const site = this.list[i];
        if (site.cleared || site.revealed) continue;
        const record = this.map.at(site.buildingId);
        if (!record) continue;
        for (let j = 0; j < this.squads.list.length; j++) {
          const squad = this.squads.list[j];
          if (squad.away) continue;
          const leader = this.citizens.at(squad.members[0]);
          if (leader && Math.hypot(leader.x - record.cx, leader.y - record.cy) <= 260) {
            site.revealed = true;
            this.lastEvent =
              site.kind === CFG.THREAT.RAIDERS
                ? "Se ha localizado un escondite hostil"
                : "Se ha localizado una guarida infectada";
            if (this.onChanged) this.onChanged();
            break;
          }
        }
      }
      if (this.state.phase() !== "day") return;
      for (let i = 0; i < this.list.length; i++) {
        const site = this.list[i];
        if (
          site.kind !== CFG.THREAT.RAIDERS ||
          site.cleared ||
          this.state.day - site.lastRaidDay < CFG.THREATS.RAID_INTERVAL_DAYS
        )
          continue;
        site.lastRaidDay = this.state.day;
        const resource =
            this.state.stock[R.FOOD] >= this.state.stock[R.MEDICINE] ? R.FOOD : R.MEDICINE,
          loss = Math.min(this.state.stock[resource], CFG.THREATS.RAID_LOSS + site.strength);
        this.state.stock[resource] -= loss;
        this.lastEvent = loss
          ? "Los saqueadores interceptaron un porte: −" +
            loss +
            (resource === R.FOOD ? " comida" : " medicina")
          : "Los saqueadores tantearon la zona sin encontrar suministros";
        if (this.onChanged) this.onChanged();
      }
    }

    nightMultiplier() {
      let lairs = 0;
      for (let i = 0; i < this.list.length; i++)
        if (this.list[i].kind === CFG.THREAT.LAIR && !this.list[i].cleared) lairs++;
      return 1 + lairs * CFG.THREATS.LAIR_NIGHT_PRESSURE;
    }

    model() {
      let lairs = 0,
        raiders = 0,
        cleared = 0;
      for (let i = 0; i < this.list.length; i++) {
        const site = this.list[i];
        if (site.cleared) cleared++;
        else if (site.kind === CFG.THREAT.LAIR) lairs++;
        else raiders++;
      }
      return { sites: this.list, lairs, raiders, cleared, lastEvent: this.lastEvent };
    }

    capture() {
      this.state.zone.threats = this.list.map((site) => ({
        id: site.id,
        kind: site.kind,
        buildingId: site.buildingId,
        strength: site.strength,
        maxStrength: site.maxStrength,
        revealed: site.revealed,
        cleared: site.cleared,
        lastRaidDay: site.lastRaidDay,
      }));
    }

    drawOverlay(c, showHidden) {
      for (let i = 0; i < this.list.length; i++) {
        const site = this.list[i],
          record = this.map.at(site.buildingId);
        if (!record || site.cleared || (!site.revealed && !showHidden)) continue;
        const x = record.cx,
          y = record.shape.y - 18,
          seed = 3100 + site.id * 47;
        c.save();
        c.strokeStyle =
          site.kind === CFG.THREAT.RAIDERS ? "rgba(116,64,43,0.9)" : "rgba(111,47,48,0.9)";
        c.fillStyle =
          site.kind === CFG.THREAT.RAIDERS ? "rgba(183,118,72,0.2)" : "rgba(146,57,62,0.2)";
        c.lineWidth = 2;
        ZS.wcirc(c, x, y, 11, seed, 1.1);
        c.fill();
        c.stroke();
        if (site.kind === CFG.THREAT.RAIDERS) {
          ZS.wline(c, x - 5, y + 5, x + 5, y - 5, seed + 3, 0.8);
          ZS.wline(c, x - 5, y - 5, x + 5, y + 5, seed + 4, 0.8);
        } else {
          ZS.wline(c, x, y - 7, x, y + 4, seed + 3, 0.8);
          ZS.wcirc(c, x, y + 7, 1.3, seed + 4, 0.4);
          c.fill();
        }
        c.restore();
      }
    }
  }

  ZS.ZoneThreats = ZoneThreats;
})();
