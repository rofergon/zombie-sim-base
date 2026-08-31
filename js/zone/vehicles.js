/* Persistent recoverable vehicles. A recovered vehicle belongs to one squad,
   follows its leader on the hot map and can shorten a regional expedition. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});
  const CFG = ZS.ZoneConfig;
  const R = CFG.RESOURCE;

  class ZoneVehicles {
    constructor(state, map) {
      this.state = state;
      this.map = map;
      this.list = state.zone.vehicles;
      this.squads = null;
      this.citizens = null;
      this.onChanged = null;
    }

    prepare() {
      if (this.list.length) return;
      const preset = this.state.data.world.size,
        count = CFG.VEHICLES.MAP_COUNT[preset] || 2,
        candidates = [];
      for (let i = 0; i < this.map.records.length; i++) {
        const record = this.map.records[i];
        if (record === this.map.hq || record.demolished || !this.map.entryPoint(record)) continue;
        candidates.push(record);
      }
      candidates.sort(
        (a, b) =>
          ZS.hash(this.state.seed + a.id * 173 + 91) - ZS.hash(this.state.seed + b.id * 173 + 91),
      );
      for (let i = 0; i < count && i < candidates.length; i++) {
        const record = candidates[i],
          entry = record.shape.door.front,
          point = this.map.nav.nearestWalkable(entry.x + 24, entry.y + 18, 90, false) || entry,
          roll = ZS.hash(this.state.seed + record.id * 419 + 37),
          kind = roll > 0.78 ? CFG.VEHICLE.TRUCK : roll > 0.42 ? CFG.VEHICLE.VAN : CFG.VEHICLE.CAR,
          maxHP = CFG.VEHICLES.HP[kind];
        this.list.push({
          id: this.state.zone.nextVehicleId++,
          kind,
          x: point.x,
          y: point.y,
          a: ZS.hash(this.state.seed + record.id * 53) * Math.PI * 2,
          hp: Math.round(maxHP * (0.46 + roll * 0.38)),
          maxHP,
          fuel: 1 + Math.floor(roll * 4),
          capacity: CFG.VEHICLES.CAPACITY[kind],
          recovered: false,
          squadId: null,
          lastX: point.x,
          lastY: point.y,
        });
      }
      this.capture();
    }

    connect(squads, citizens, onChanged) {
      this.squads = squads;
      this.citizens = citizens;
      this.onChanged = onChanged;
      for (let i = 0; i < this.list.length; i++) {
        const vehicle = this.list[i];
        vehicle.lastX = vehicle.x;
        vehicle.lastY = vehicle.y;
        if (vehicle.squadId === null) continue;
        const squad = squads.at(vehicle.squadId);
        if (!squad) {
          vehicle.squadId = null;
          continue;
        }
        squad.vehicleId = vehicle.id;
        squad.capacity = CFG.SQUAD.INVENTORY_CAPACITY + vehicle.capacity;
      }
    }

    at(id) {
      for (let i = 0; i < this.list.length; i++) if (this.list[i].id === id) return this.list[i];
      return null;
    }

    atPoint(x, y, radius) {
      const range = radius || 34;
      let best = null,
        bestDistance = range * range;
      for (let i = 0; i < this.list.length; i++) {
        const vehicle = this.list[i];
        if (vehicle.hp <= 0) continue;
        const dx = vehicle.x - x,
          dy = vehicle.y - y,
          distance = dx * dx + dy * dy;
        if (distance <= bestDistance) {
          best = vehicle;
          bestDistance = distance;
        }
      }
      return best;
    }

    recover(squad, vehicle) {
      if (!squad || !vehicle || vehicle.hp <= 0) return false;
      if (vehicle.squadId !== null && vehicle.squadId !== squad.id) return false;
      const previous = this.at(squad.vehicleId);
      if (previous && previous !== vehicle) previous.squadId = null;
      vehicle.recovered = true;
      vehicle.squadId = squad.id;
      squad.vehicleId = vehicle.id;
      squad.capacity = CFG.SQUAD.INVENTORY_CAPACITY + vehicle.capacity;
      squad.state = "motorized";
      this._refuelAtHQ(squad, vehicle);
      if (this.onChanged) this.onChanged();
      return true;
    }

    releaseSquad(squad) {
      if (!squad) return;
      const vehicle = this.at(squad.vehicleId);
      if (vehicle) vehicle.squadId = null;
      squad.vehicleId = null;
      squad.capacity = CFG.SQUAD.INVENTORY_CAPACITY;
    }

    update(dt) {
      if (!this.squads || !this.citizens) return;
      for (let i = 0; i < this.list.length; i++) {
        const vehicle = this.list[i];
        if (!vehicle.recovered || vehicle.squadId === null || vehicle.hp <= 0) continue;
        const squad = this.squads.at(vehicle.squadId),
          leader = squad && this.citizens.at(squad.members[0]);
        if (!squad || !leader || squad.away) continue;
        const dx = leader.x - vehicle.x,
          dy = leader.y - vehicle.y,
          distance = Math.hypot(dx, dy);
        if (distance > 1) vehicle.a = Math.atan2(dy, dx);
        vehicle.x = leader.x;
        vehicle.y = leader.y + 8;
        if (vehicle.fuel > 0 && Math.hypot(leader.vx, leader.vy) > 18)
          vehicle.fuel = Math.max(0, vehicle.fuel - dt * 0.014);
        this._refuelAtHQ(squad, vehicle);
      }
    }

    _refuelAtHQ(squad, vehicle) {
      if (!this.map.hq || !vehicle || vehicle.fuel >= 6 || this.state.stock[R.FUEL] <= 0) return;
      let atHQ = true;
      for (let i = 0; i < squad.members.length; i++) {
        const member = this.citizens && this.citizens.at(squad.members[i]);
        if (member && member.bld !== this.map.hq.id) {
          atHQ = false;
          break;
        }
      }
      if (!atHQ) return;
      const amount = Math.min(6 - vehicle.fuel, this.state.stock[R.FUEL]);
      vehicle.fuel += amount;
      this.state.stock[R.FUEL] -= amount;
    }

    speedMultiplier(squad) {
      const vehicle = squad && this.at(squad.vehicleId);
      return vehicle && vehicle.recovered && vehicle.hp > 0 && vehicle.fuel > 0
        ? CFG.VEHICLES.EXPEDITION_SPEED[vehicle.kind]
        : 1;
    }

    expeditionVehicle(squad) {
      const vehicle = squad && this.at(squad.vehicleId);
      return vehicle && vehicle.recovered && vehicle.hp > 0 && vehicle.fuel >= 2 ? vehicle : null;
    }

    damage(id, amount) {
      const vehicle = this.at(id);
      if (!vehicle) return 0;
      const damage = Math.min(vehicle.hp, Math.max(0, amount));
      vehicle.hp -= damage;
      if (vehicle.hp <= 0) {
        const squad = this.squads && this.squads.at(vehicle.squadId);
        if (squad) this.releaseSquad(squad);
      }
      return damage;
    }

    model() {
      let recovered = 0;
      for (let i = 0; i < this.list.length; i++) if (this.list[i].recovered) recovered++;
      return { list: this.list, recovered };
    }

    capture() {
      this.state.zone.vehicles = this.list.map((vehicle) => ({
        id: vehicle.id,
        kind: vehicle.kind,
        x: vehicle.x,
        y: vehicle.y,
        a: vehicle.a,
        hp: vehicle.hp,
        maxHP: vehicle.maxHP,
        fuel: vehicle.fuel,
        capacity: vehicle.capacity,
        recovered: vehicle.recovered,
        squadId: vehicle.squadId,
      }));
    }

    drawOverlay(c) {
      for (let i = 0; i < this.list.length; i++) {
        const vehicle = this.list[i];
        if (vehicle.hp <= 0) continue;
        c.save();
        c.translate(vehicle.x, vehicle.y);
        c.rotate(vehicle.a || 0);
        c.fillStyle = vehicle.recovered ? "rgba(91,111,70,0.72)" : "rgba(111,96,78,0.55)";
        c.strokeStyle = vehicle.recovered ? "rgba(47,67,40,0.94)" : "rgba(70,61,51,0.86)";
        c.lineWidth = 1.6;
        const length =
            vehicle.kind === CFG.VEHICLE.TRUCK ? 42 : vehicle.kind === CFG.VEHICLE.VAN ? 35 : 30,
          width = vehicle.kind === CFG.VEHICLE.TRUCK ? 19 : 16,
          seed = vehicle.id * 97 + 2600;
        c.beginPath();
        ZS.wline(c, -length / 2, -width / 2, length / 2, -width / 2, seed, 0.8);
        ZS.wline(c, length / 2, -width / 2, length / 2, width / 2, seed + 1, 0.8);
        ZS.wline(c, length / 2, width / 2, -length / 2, width / 2, seed + 2, 0.8);
        ZS.wline(c, -length / 2, width / 2, -length / 2, -width / 2, seed + 3, 0.8);
        c.fill();
        c.stroke();
        c.beginPath();
        ZS.wline(c, -5, -width / 2, 2, width / 2, seed + 5, 0.6);
        ZS.wline(c, 8, -width / 2, 11, width / 2, seed + 6, 0.6);
        c.stroke();
        c.fillStyle = "rgba(45,42,38,0.9)";
        for (let side = -1; side <= 1; side += 2) {
          ZS.wcirc(c, -length * 0.28, side * width * 0.55, 3.2, seed + 9 + side, 0.5);
          c.fill();
          ZS.wcirc(c, length * 0.28, side * width * 0.55, 3.2, seed + 12 + side, 0.5);
          c.fill();
        }
        c.restore();
      }
    }
  }

  ZS.ZoneVehicles = ZoneVehicles;
})();
