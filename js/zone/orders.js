/* Small, explicit command queue for the phase-one survey team. Orders are
   allocated only on player input; the per-agent update path reuses them. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});
  const CFG = ZS.ZoneConfig;

  class ZoneOrders {
    issueMove(selected, x, y, append, building, nav) {
      if (!selected.length) return 0;
      const cols = Math.ceil(Math.sqrt(selected.length));
      for (let i = 0; i < selected.length; i++) {
        const a = selected[i];
        if (!append) this.clear(a);
        if (a.orders.length - a.orderIndex >= CFG.AGENT.MAX_ORDERS) continue;
        const col = i % cols,
          row = (i / cols) | 0,
          tx = x + (col - (cols - 1) / 2) * CFG.AGENT.FORMATION_GAP,
          ty = y + (row - (Math.ceil(selected.length / cols) - 1) / 2) * CFG.AGENT.FORMATION_GAP,
          point = nav.nearestWalkable(tx, ty, 100, false);
        if (!point) continue;
        a.orders.push({
          kind: building ? CFG.ORDER.ENTER : CFG.ORDER.MOVE,
          x: point.x,
          y: point.y,
          buildingId: building ? building.id : null,
        });
      }
      return selected.length;
    }

    clear(a) {
      a.orders.length = 0;
      a.orderIndex = 0;
      a.zoneBuildingId = null;
    }

    update(a, dt, t, nav) {
      if (a.orderIndex >= a.orders.length) {
        if (a.orderIndex) {
          a.orders.length = 0;
          a.orderIndex = 0;
        }
        a.wantMove = false;
        return;
      }
      const order = a.orders[a.orderIndex],
        dx = order.x - a.x,
        dy = order.y - a.y;
      a.a = Math.atan2(dy, dx);
      if (dx * dx + dy * dy <= CFG.AGENT.ARRIVE_R * CFG.AGENT.ARRIVE_R) {
        a.zoneBuildingId = order.buildingId;
        a.orderIndex++;
        a.wantMove = false;
        return;
      }
      ZS.planAndFollow(a, order, false, CFG.AGENT.SPEED, dt, t, nav);
    }

    pending(a) {
      return Math.max(0, a.orders.length - a.orderIndex);
    }
  }

  ZS.ZoneOrders = ZoneOrders;
})();
