/* Abstract connected sectors around the fully simulated zone. Expeditions are
   deliberately campaign-scale: squads disappear into a timed mission instead
   of forcing thousands of off-camera agents into the hot simulation. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});
  const CFG = ZS.ZoneConfig;
  const R = CFG.RESOURCE;

  class ZoneRegions {
    constructor(state, map) {
      this.state = state;
      this.map = map;
      this.nodes = [];
      this.byId = new Map();
      this.onChanged = null;
      this.squads = null;
      this.citizens = null;
      this.vehicles = null;
    }

    prepare() {
      this.nodes.length = 0;
      this.byId.clear();
      const world = this.state.data.world,
        preset = CFG.MAP.SIZE_PRESETS[world.size] || CFG.MAP.SIZE_PRESETS.classic,
        cells = preset.cells || 1,
        definitions =
          this.map.regions && this.map.regions.length
            ? this.map.regions
            : ZS.ZoneMapPack.regions(
                0,
                0,
                CFG.MAP.SIZE_PRESETS[cells === 1 ? "compact" : world.size],
              ),
        saved = this.state.zone.regions || [];
      for (let i = 0; i < definitions.length; i++) {
        const definition = definitions[i];
        let old = null;
        for (let j = 0; j < saved.length; j++)
          if (saved[j].id === definition.id) {
            old = saved[j];
            break;
          }
        const roll = ZS.hash((this.state.seed || 1) + definition.gx * 191 + definition.gy * 313),
          node = {
            id: definition.id,
            gx: definition.gx,
            gy: definition.gy,
            active: Boolean(definition.active),
            links: definition.links.slice(),
            lat: definition.lat,
            lon: definition.lon,
            discovered: definition.active || Boolean(old && old.discovered),
            scouted: definition.active || Boolean(old && old.scouted),
            loot: old ? old.loot : Math.round(18 + roll * 42),
            threat: old ? old.threat : Math.round(1 + roll * 5),
          };
        this.nodes.push(node);
        this.byId.set(node.id, node);
      }
      this.capture();
    }

    connect(squads, citizens, vehicles, onChanged) {
      this.squads = squads;
      this.citizens = citizens;
      this.vehicles = vehicles;
      this.onChanged = onChanged;
      const expedition = this.state.zone.expedition;
      if (expedition) {
        const squad = squads.at(expedition.squadId);
        if (!squad) this.state.zone.expedition = null;
        else this._setAway(squad, true);
      }
    }

    canStart(id, squadId) {
      const node = this.byId.get(id);
      if (!node || node.active || node.scouted || this.state.zone.expedition || !this.squads)
        return false;
      let connected = false;
      for (let i = 0; i < node.links.length; i++) {
        const neighbor = this.byId.get(node.links[i]);
        if (neighbor && neighbor.discovered) {
          connected = true;
          break;
        }
      }
      return (
        connected &&
        Boolean(this._readySquad(squadId)) &&
        this.state.stock[R.FOOD] >= 6 &&
        this.state.stock[R.AMMO] >= 2
      );
    }

    start(id, squadId) {
      if (!this.canStart(id, squadId)) return false;
      const squad = this._readySquad(squadId),
        vehicle = this.vehicles && this.vehicles.expeditionVehicle(squad),
        speed = vehicle ? CFG.VEHICLES.EXPEDITION_SPEED[vehicle.kind] : 1,
        duration = Math.ceil(180 / speed);
      if (!squad) return false;
      this.state.stock[R.FOOD] -= 6;
      this.state.stock[R.AMMO] -= 2;
      if (vehicle) vehicle.fuel = Math.max(0, vehicle.fuel - CFG.VEHICLES.EXPEDITION_FUEL);
      this.squads.clearOrders(squad);
      this._setAway(squad, true);
      squad.state = vehicle ? "motorized expedition" : "expedition";
      this.state.zone.expedition = {
        regionId: id,
        remaining: duration,
        duration,
        squadId: squad.id,
        vehicleId: vehicle ? vehicle.id : null,
        seed: (this.state.seed ^ (this.state.day * 977) ^ (squad.id * 131)) | 0,
      };
      if (this.onChanged) this.onChanged();
      return true;
    }

    update(dt) {
      const expedition = this.state.zone.expedition;
      if (!expedition) return;
      expedition.remaining = Math.max(0, expedition.remaining - dt * CFG.CLOCK.MINUTES_PER_SECOND);
      if (expedition.remaining > 0) return;
      const node = this.byId.get(expedition.regionId),
        squad = this.squads && this.squads.at(expedition.squadId);
      if (node && squad) {
        node.discovered = true;
        node.scouted = true;
        const skill = this._squadSkill(squad, CFG.SKILL.SCAVENGE),
          recovered = Math.min(
            node.loot,
            Math.max(4, Math.round(node.loot * (0.3 + skill * 0.025))),
            Math.max(0, squad.capacity - this.squads.inventoryTotal(squad)),
          ),
          food = Math.floor(recovered * 0.3),
          wood = Math.floor(recovered * 0.24),
          metal = Math.floor(recovered * 0.2),
          medicine = Math.floor(recovered * 0.08),
          fuel = Math.floor(recovered * 0.1),
          assigned = food + wood + metal + medicine + fuel;
        squad.inventory[R.FOOD] += food + (recovered - assigned);
        squad.inventory[R.WOOD] += wood;
        squad.inventory[R.METAL] += metal;
        squad.inventory[R.MEDICINE] += medicine;
        squad.inventory[R.FUEL] += fuel;
        node.loot = Math.max(0, node.loot - recovered);
        const combat = this._squadSkill(squad, CFG.SKILL.COMBAT),
          pressure = Math.max(0, node.threat - Math.floor(combat / 3)),
          roll = ZS.hash(expedition.seed + node.threat * 59);
        node.threat = Math.max(0, node.threat - 1 - Math.floor(combat / 5));
        if (pressure > 1 && roll < Math.min(0.7, pressure * 0.09)) {
          const member = this.citizens.at(squad.members[(roll * squad.members.length) | 0]);
          if (member) {
            member.hp = Math.max(1, member.hp - (8 + pressure * 3));
            this.citizens.expose(member, 6 + pressure * 2);
          }
          if (Number.isInteger(expedition.vehicleId) && this.vehicles)
            this.vehicles.damage(expedition.vehicleId, 4 + pressure * 2);
        }
        for (let i = 0; i < squad.members.length; i++) {
          const member = this.citizens.at(squad.members[i]);
          if (member) this.citizens.addSkill(member, CFG.SKILL.SCAVENGE, 2 + recovered * 0.04);
        }
        this._returnSquad(squad);
      }
      if (squad && squad.away) this._returnSquad(squad);
      this.state.zone.expedition = null;
      this.capture();
      if (this.onChanged) this.onChanged();
    }

    _readySquad(preferredId) {
      if (!this.squads || !this.citizens || !this.map.hq) return null;
      const preferred = Number.isInteger(preferredId) ? this.squads.at(preferredId) : null;
      if (preferred && this._isReady(preferred)) return preferred;
      for (let i = 0; i < this.squads.list.length; i++)
        if (this._isReady(this.squads.list[i])) return this.squads.list[i];
      return null;
    }

    _isReady(squad) {
      if (!squad || squad.away || !squad.members.length) return false;
      for (let i = 0; i < squad.members.length; i++) {
        const member = this.citizens.at(squad.members[i]);
        if (!member || member.dead || member.bld !== this.map.hq.id) return false;
      }
      return true;
    }

    _setAway(squad, away) {
      squad.away = away;
      for (let i = 0; i < squad.members.length; i++) {
        const member = this.citizens.at(squad.members[i]);
        if (!member) continue;
        member.away = away;
        member.selected = false;
        member.vx = member.vy = 0;
        member.wantMove = false;
      }
    }

    _returnSquad(squad) {
      const door = this.map.hq && this.map.hq.shape.door,
        point = door ? door.inner : this.map.hq;
      this._setAway(squad, false);
      for (let i = 0; i < squad.members.length; i++) {
        const member = this.citizens.at(squad.members[i]);
        if (!member || !point) continue;
        member.x = (point.x === undefined ? point.cx : point.x) + (i - 1.5) * 10;
        member.y = point.y === undefined ? point.cy : point.y;
        member.bld = this.map.hq.id;
      }
      squad.state = "expedition returned";
      this.squads.returnHQ(squad, null, false);
    }

    _squadSkill(squad, kind) {
      let total = 0,
        count = 0;
      for (let i = 0; i < squad.members.length; i++) {
        const member = this.citizens.at(squad.members[i]);
        if (!member) continue;
        total += member.skills[kind] || 0;
        count++;
      }
      return count ? total / count : 0;
    }

    capture() {
      this.state.zone.regions = this.nodes.map((node) => ({
        id: node.id,
        discovered: node.discovered,
        scouted: node.scouted,
        loot: node.loot,
        threat: node.threat,
      }));
    }

    model(selectedSquadId) {
      const expedition = this.state.zone.expedition;
      return {
        name: this.state.data.world.name,
        size: this.state.data.world.size,
        source: this.state.data.world.source,
        expedition,
        nodes: this.nodes.map((node) => ({
          id: node.id,
          gx: node.gx,
          gy: node.gy,
          active: node.active,
          discovered: node.discovered,
          scouted: node.scouted,
          loot: node.loot,
          threat: node.threat,
          canStart: this.canStart(node.id, selectedSquadId),
        })),
        readySquadId: this._readySquad(selectedSquadId)
          ? this._readySquad(selectedSquadId).id
          : null,
      };
    }
  }

  ZS.ZoneRegions = ZoneRegions;
})();
