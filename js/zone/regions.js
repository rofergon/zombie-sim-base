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

    connect(onChanged) {
      this.onChanged = onChanged;
    }

    canStart(id, squadCount) {
      const node = this.byId.get(id);
      if (!node || node.active || node.scouted || this.state.zone.expedition || squadCount < 1)
        return false;
      let connected = false;
      for (let i = 0; i < node.links.length; i++) {
        const neighbor = this.byId.get(node.links[i]);
        if (neighbor && neighbor.discovered) {
          connected = true;
          break;
        }
      }
      return connected && this.state.stock[R.FOOD] >= 6 && this.state.stock[R.AMMO] >= 2;
    }

    start(id, squadCount) {
      if (!this.canStart(id, squadCount)) return false;
      this.state.stock[R.FOOD] -= 6;
      this.state.stock[R.AMMO] -= 2;
      this.state.zone.expedition = { regionId: id, remaining: 180 };
      if (this.onChanged) this.onChanged();
      return true;
    }

    update(dt) {
      const expedition = this.state.zone.expedition;
      if (!expedition) return;
      expedition.remaining = Math.max(0, expedition.remaining - dt * CFG.CLOCK.MINUTES_PER_SECOND);
      if (expedition.remaining > 0) return;
      const node = this.byId.get(expedition.regionId);
      if (node) {
        node.discovered = true;
        node.scouted = true;
        const recovered = Math.max(4, Math.round(node.loot * 0.35));
        this.state.stock[R.FOOD] += Math.ceil(recovered * 0.35);
        this.state.stock[R.WOOD] += Math.ceil(recovered * 0.3);
        this.state.stock[R.METAL] += Math.ceil(recovered * 0.2);
        this.state.stock[R.MEDICINE] += Math.floor(recovered * 0.08);
        node.loot = Math.max(0, node.loot - recovered);
        node.threat = Math.max(0, node.threat - 1);
      }
      this.state.zone.expedition = null;
      this.capture();
      if (this.onChanged) this.onChanged();
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

    model(squadCount) {
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
          canStart: this.canStart(node.id, squadCount),
        })),
      };
    }
  }

  ZS.ZoneRegions = ZoneRegions;
})();
