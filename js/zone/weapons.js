/* IFZ-style weapon slots, armory stock and persistent battlefield pickups.
   Citizens keep one equipped weapon; machetes are the free fallback. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});
  const CFG = ZS.ZoneConfig;
  const R = CFG.RESOURCE;
  const W = CFG.WEAPON;

  const DEFINITIONS = [];
  DEFINITIONS[W.MACHETE] = Object.freeze({
    id: W.MACHETE,
    label: "machete",
    range: 23,
    cooldown: 1.3,
    damage: 1,
    score: 0,
    sound: null,
    icon: "zw-machete",
    visual: null,
  });
  DEFINITIONS[W.PISTOL] = Object.freeze({
    id: W.PISTOL,
    label: "pistola",
    range: 150,
    cooldown: 0.6,
    damage: 1,
    score: 1,
    sound: "shot_smg",
    icon: "zw-pistol",
    visual: "pistol",
  });
  DEFINITIONS[W.RIFLE] = Object.freeze({
    id: W.RIFLE,
    label: "fusil de asalto",
    range: 225,
    cooldown: 0.3,
    damage: 3,
    score: 3,
    sound: "shot_rifle",
    icon: "zw-rifle",
    visual: "rifle",
  });
  DEFINITIONS[W.SHOTGUN] = Object.freeze({
    id: W.SHOTGUN,
    label: "escopeta",
    range: 180,
    cooldown: 0.6,
    damage: 3,
    farDamage: 2,
    score: 2,
    sound: "shot_shotgun",
    icon: "zw-shotgun",
    visual: "rifle",
  });
  DEFINITIONS[W.SNIPER] = Object.freeze({
    id: W.SNIPER,
    label: "rifle de francotirador",
    range: 330,
    cooldown: 0.3,
    damage: 6,
    score: 4,
    sound: "shot_rifle",
    icon: "zw-sniper",
    visual: "rifle",
  });
  Object.freeze(DEFINITIONS);

  const RESOURCE_ORDER = Object.freeze([
    R.AMMO,
    R.MEDICINE,
    R.FOOD,
    R.WOOD,
    R.METAL,
    R.BRICK,
    R.SCIENCE,
    R.GRAIN,
    R.MEAT,
    R.FERTILIZER,
  ]);

  function emptyResources() {
    return Array.from({ length: R.COUNT }, () => 0);
  }

  function emptyWeapons() {
    return Array.from({ length: W.COUNT }, () => 0);
  }

  function weaponTotal(source) {
    let total = 0;
    for (let id = W.PISTOL; id < W.COUNT; id++) total += source[id] || 0;
    return total;
  }

  function resourceTotal(source) {
    let total = 0;
    for (let id = 0; id < R.COUNT; id++) total += source[id] || 0;
    return total;
  }

  class ZoneWeapons {
    constructor(state, map) {
      this.state = state;
      this.map = map;
      this.armory = state.zone.armory;
      this.list = state.zone.weaponDrops;
      this.citizens = null;
      this.squads = null;
      this.onChanged = null;
    }

    connect(citizens, squads, onChanged) {
      this.citizens = citizens;
      this.squads = squads;
      this.onChanged = onChanged;
      for (let i = 0; i < squads.list.length; i++) this.prepareSquad(squads.list[i]);
    }

    definition(id) {
      return DEFINITIONS[id] || DEFINITIONS[W.MACHETE];
    }

    label(id) {
      return this.definition(id).label;
    }

    prepareSquad(squad) {
      if (!Array.isArray(squad.spareWeapons)) squad.spareWeapons = emptyWeapons();
      else
        for (let id = 0; id < W.COUNT; id++)
          squad.spareWeapons[id] = Math.max(0, squad.spareWeapons[id] | 0);
      squad.spareWeapons.length = W.COUNT;
    }

    applyAgentWeapon(agent, weapon) {
      const def = this.definition(weapon);
      agent.weapon = def.id;
      agent.gun = def.id !== W.MACHETE;
      agent.wep = def.visual;
    }

    damage(weapon, distance) {
      const def = this.definition(weapon);
      if (weapon === W.SHOTGUN && distance > def.range * 0.55) return def.farDamage;
      return def.damage;
    }

    squadRange(squad) {
      let range = DEFINITIONS[W.MACHETE].range;
      const hasAmmo = squad.inventory[R.AMMO] > 0;
      for (let i = 0; i < squad.equipment.length; i++) {
        const weapon = hasAmmo ? squad.equipment[i] : W.MACHETE;
        range = Math.max(range, this.definition(weapon).range);
      }
      return range;
    }

    cargoTotal(squad) {
      this.prepareSquad(squad);
      return weaponTotal(squad.spareWeapons);
    }

    _upgradeIndex(squad, weapon) {
      const score = this.definition(weapon).score;
      let index = -1,
        weakest = score;
      for (let i = 0; i < squad.members.length; i++) {
        const current = squad.equipment[i] || W.MACHETE,
          currentScore = this.definition(current).score;
        if (currentScore < weakest) {
          index = i;
          weakest = currentScore;
        }
      }
      return index;
    }

    _equipIndex(squad, index, weapon) {
      const old = squad.equipment[index] || W.MACHETE;
      squad.equipment[index] = weapon;
      const member = this.citizens && this.citizens.at(squad.members[index]);
      if (member) this.applyAgentWeapon(member, weapon);
      return old;
    }

    takeWeapon(squad, weapon) {
      if (!squad || weapon <= W.MACHETE || weapon >= W.COUNT) return false;
      this.prepareSquad(squad);
      const index = this._upgradeIndex(squad, weapon),
        old = index >= 0 ? squad.equipment[index] || W.MACHETE : W.MACHETE,
        cargo = this.squads.inventoryTotal(squad);
      if (index >= 0) {
        if (old !== W.MACHETE && cargo >= squad.capacity) return false;
        this._equipIndex(squad, index, weapon);
        if (old !== W.MACHETE) squad.spareWeapons[old]++;
      } else {
        if (cargo >= squad.capacity) return false;
        squad.spareWeapons[weapon]++;
      }
      if (this.onChanged) this.onChanged();
      return true;
    }

    equipFromArmory(squad, citizenId, weapon) {
      if (!squad || !this.canManage(squad)) return false;
      const index = squad.members.indexOf(citizenId);
      if (index < 0 || weapon < W.MACHETE || weapon >= W.COUNT) return false;
      const current = squad.equipment[index] || W.MACHETE;
      if (current === weapon) return true;
      if (weapon !== W.MACHETE && this.armory[weapon] <= 0) return false;
      if (weapon !== W.MACHETE) this.armory[weapon]--;
      if (current !== W.MACHETE) this.armory[current]++;
      this._equipIndex(squad, index, weapon);
      if (this.onChanged) this.onChanged();
      return true;
    }

    canManage(squad) {
      if (!squad || !this.map.hq) return false;
      for (let i = 0; i < squad.members.length; i++) {
        const member = this.citizens.at(squad.members[i]);
        if (member && member.bld !== this.map.hq.id) return false;
      }
      return true;
    }

    deposit(squad) {
      this.prepareSquad(squad);
      let moved = 0;
      for (let weapon = W.PISTOL; weapon < W.COUNT; weapon++) {
        moved += squad.spareWeapons[weapon];
        this.armory[weapon] += squad.spareWeapons[weapon];
        squad.spareWeapons[weapon] = 0;
      }
      return moved;
    }

    disarm(squad) {
      if (!squad) return;
      this.prepareSquad(squad);
      for (let i = 0; i < squad.members.length; i++) {
        const weapon = squad.equipment[i] || W.MACHETE;
        if (weapon !== W.MACHETE) this.armory[weapon]++;
        this._equipIndex(squad, i, W.MACHETE);
      }
      this.deposit(squad);
    }

    dropMember(agent, squad, index, lastMember) {
      if (!agent || !squad) return null;
      this.prepareSquad(squad);
      const weapon = squad.equipment[index] || agent.weapon || W.MACHETE;
      let hasContents = weapon !== W.MACHETE;
      if (lastMember)
        hasContents =
          hasContents ||
          resourceTotal(squad.inventory) > 0 ||
          weaponTotal(squad.spareWeapons) > 0;
      if (!hasContents) return null;
      const drop = this._dropNear(agent.x, agent.y) || this._createDrop(agent.x, agent.y);
      if (weapon !== W.MACHETE) drop.weapons[weapon]++;
      if (lastMember) {
        for (let id = 0; id < R.COUNT; id++) {
          drop.resources[id] += squad.inventory[id];
          squad.inventory[id] = 0;
        }
        for (let id = W.PISTOL; id < W.COUNT; id++) {
          drop.weapons[id] += squad.spareWeapons[id];
          squad.spareWeapons[id] = 0;
        }
      }
      if (this.onChanged) this.onChanged();
      return drop;
    }

    _createDrop(x, y) {
      const drop = {
        id: this.state.zone.nextWeaponDropId++,
        x,
        y,
        resources: emptyResources(),
        weapons: emptyWeapons(),
      };
      this.list.push(drop);
      return drop;
    }

    _dropNear(x, y) {
      for (let i = 0; i < this.list.length; i++) {
        const drop = this.list[i];
        if (Math.hypot(drop.x - x, drop.y - y) <= 44) return drop;
      }
      return null;
    }

    at(id) {
      for (let i = 0; i < this.list.length; i++) if (this.list[i].id === id) return this.list[i];
      return null;
    }

    atPoint(x, y, zoom) {
      const radius = CFG.SQUAD.PICKUP_RADIUS / Math.max(0.55, zoom || 1),
        radius2 = radius * radius;
      let best = radius2,
        found = null;
      for (let i = 0; i < this.list.length; i++) {
        const drop = this.list[i],
          dx = drop.x - x,
          dy = drop.y - y,
          distance = dx * dx + dy * dy;
        if (distance < best) {
          best = distance;
          found = drop;
        }
      }
      return found;
    }

    collect(drop, squad) {
      if (!drop || !squad || !this.at(drop.id)) return { weapons: 0, resources: 0 };
      let takenWeapons = 0,
        takenResources = 0;
      for (let weapon = W.SNIPER; weapon >= W.PISTOL; weapon--)
        while (drop.weapons[weapon] > 0 && this.takeWeapon(squad, weapon)) {
          drop.weapons[weapon]--;
          takenWeapons++;
        }
      for (let i = 0; i < RESOURCE_ORDER.length; i++) {
        const resource = RESOURCE_ORDER[i];
        while (
          drop.resources[resource] > 0 &&
          this.squads.inventoryTotal(squad) < squad.capacity
        ) {
          drop.resources[resource]--;
          squad.inventory[resource]++;
          takenResources++;
        }
      }
      if (this.empty(drop)) this.remove(drop);
      if ((takenWeapons || takenResources) && this.onChanged) this.onChanged();
      return { weapons: takenWeapons, resources: takenResources };
    }

    empty(drop) {
      return resourceTotal(drop.resources) + weaponTotal(drop.weapons) <= 0;
    }

    remove(drop) {
      const index = this.list.indexOf(drop);
      if (index >= 0) this.list.splice(index, 1);
    }

    contents(drop) {
      return {
        weapons: weaponTotal(drop.weapons),
        resources: resourceTotal(drop.resources),
      };
    }

    drawGround(c) {
      for (let i = 0; i < this.list.length; i++) this._drawDrop(c, this.list[i]);
    }

    _drawDrop(c, drop) {
      const seed = drop.id * 131 + 701;
      c.save();
      c.fillStyle = "rgba(246,241,227,0.78)";
      c.strokeStyle = "rgba(61,52,43,0.72)";
      c.lineWidth = 1.2;
      ZS.wcirc(c, drop.x, drop.y, 15, seed, 1.2);
      c.fill();
      let shown = 0;
      for (let weapon = W.SNIPER; weapon >= W.PISTOL && shown < 2; weapon--)
        if (drop.weapons[weapon] > 0) {
          this._drawWeapon(c, weapon, drop.x, drop.y - 3 + shown * 6, seed + shown * 37);
          shown++;
        }
      const contents = this.contents(drop),
        total = contents.weapons + contents.resources;
      if (!shown) {
        c.fillStyle = "rgba(126,89,48,0.32)";
        ZS.wcirc(c, drop.x, drop.y - 2, 6, seed + 17, 0.6);
        c.fill();
      }
      if (total > 1) {
        c.fillStyle = "rgba(61,52,43,0.88)";
        c.font = 'bold 8px "Segoe Script", "Bradley Hand", cursive';
        c.textAlign = "center";
        c.textBaseline = "top";
        c.fillText("×" + total, drop.x, drop.y + 11);
      }
      c.restore();
    }

    _drawWeapon(c, weapon, x, y, seed) {
      const length = weapon === W.PISTOL ? 13 : weapon === W.SHOTGUN ? 24 : weapon === W.SNIPER ? 27 : 22;
      c.save();
      c.translate(x, y);
      c.rotate((ZS.hash(seed) - 0.5) * 0.55);
      c.strokeStyle = "rgba(48,43,37,0.9)";
      c.lineWidth = 1.7;
      if (weapon === W.PISTOL) {
        ZS.wline(c, -6, -2, 6, -2, seed, 0.45);
        ZS.wline(c, 1, -1, -1, 6, seed + 5, 0.45);
        ZS.wline(c, -1, 6, -5, 4, seed + 9, 0.4);
        return c.restore();
      }
      ZS.wline(c, -length / 2, 0, length / 2, 0, seed, 0.55);
      ZS.wline(c, -length / 2, 0, -length / 2 + 6, 4, seed + 5, 0.5);
      ZS.wline(c, -2, 1, -4, 6, seed + 9, 0.45);
      if (weapon === W.RIFLE) ZS.wline(c, 0, 1, 2, 6, seed + 13, 0.45);
      else if (weapon === W.SHOTGUN) ZS.wline(c, 2, -2, 8, -2, seed + 13, 0.35);
      else {
        ZS.wline(c, -3, -3, 6, -3, seed + 13, 0.35);
        ZS.wcirc(c, 1, -3, 2, seed + 17, 0.25);
      }
      c.restore();
    }

    capture() {
      this.state.zone.armory = this.armory;
      this.state.zone.weaponDrops = this.list;
    }
  }

  ZS.ZoneWeaponDefs = DEFINITIONS;
  ZS.ZoneWeapons = ZoneWeapons;
})();
