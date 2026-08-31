/* Settlement storage is a real constraint. Cargo is delivered to the nearest
   active warehouse (or HQ), stays on its carrier when full, and production
   pauses before it could create resources without storage space. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});
  const CFG = ZS.ZoneConfig;
  const U = CFG.BUILDING_USE;
  const R = CFG.RESOURCE;

  class ZoneLogistics {
    constructor(state, map, adaptations) {
      this.state = state;
      this.map = map;
      this.adaptations = adaptations;
    }

    stored() {
      let total = 0;
      for (let i = 0; i < this.state.stock.length; i++) total += this.state.stock[i];
      return total;
    }

    capacity() {
      return this.adaptations ? this.adaptations.storageCapacity() : 0;
    }

    room() {
      return Math.max(0, this.capacity() - this.stored());
    }

    canFit(amount) {
      return this.room() >= Math.max(0, amount || 0);
    }

    deposit(resource, amount) {
      if (!Number.isInteger(resource) || resource < 0 || resource >= R.COUNT) return 0;
      const accepted = Math.min(Math.max(0, amount || 0), this.room());
      this.state.stock[resource] += accepted;
      return accepted;
    }

    depositCargo(cargo) {
      let accepted = 0;
      for (let i = 0; i < R.COUNT && this.room() > 0; i++) {
        const amount = this.deposit(i, cargo[i] || 0);
        cargo[i] -= amount;
        accepted += amount;
      }
      return accepted;
    }

    cargoTotal(cargo) {
      let total = 0;
      for (let i = 0; i < R.COUNT; i++) total += cargo[i] || 0;
      return total;
    }

    target(worker, forceHQ) {
      if (!this.map.hq) return null;
      if (forceHQ || !worker) return this.map.hq;
      const current = Number.isInteger(worker.logisticsBuildingId)
        ? this.map.at(worker.logisticsBuildingId)
        : null;
      if (this._usable(current)) return current;
      let target = this.map.hq,
        best = Math.hypot(worker.x - target.cx, worker.y - target.cy);
      for (let i = 0; i < this.map.records.length; i++) {
        const record = this.map.records[i];
        if (record.use !== U.WAREHOUSE || !this._usable(record)) continue;
        const distance = Math.hypot(worker.x - record.cx, worker.y - record.cy);
        if (distance < best) {
          best = distance;
          target = record;
        }
      }
      worker.logisticsBuildingId = target.id;
      return target;
    }

    clearTarget(worker) {
      if (worker) worker.logisticsBuildingId = null;
    }

    _usable(record) {
      return Boolean(record && !record.demolished && record.hp > 0 && this.map.entryPoint(record));
    }
  }

  ZS.ZoneLogistics = ZoneLogistics;
})();
