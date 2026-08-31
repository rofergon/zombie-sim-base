/* ScenarioZone orchestrates the colony slice. Persistent citizens, jobs,
   squads and scavenging live in focused zone modules rather than the core. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});
  const CFG = ZS.ZoneConfig;
  const CI = { x: 0, y: 0, zoom: 0.72, ease: 0.55 };
  const ROUTE_DASH = [1, 7];
  const SOLID_LINE = [];
  const TECH_NAME = Object.freeze({
    [CFG.TECH.AGRICULTURE]: "Agricultura",
    [CFG.TECH.POWER]: "Energía",
    [CFG.TECH.FORTIFICATIONS]: "Fortificaciones",
    [CFG.TECH.MEDICINE]: "Medicina mejorada",
    [CFG.TECH.FERTILIZATION]: "Técnicas de fertilización",
    [CFG.TECH.GREENHOUSES]: "Invernaderos",
    [CFG.TECH.EFFICIENT_COOKING]: "Cocina eficiente",
  });

  class ScenarioZone {
    constructor() {
      const params = new URLSearchParams(window.location.search);
      this.state = new ZS.ZoneState({ fresh: params.get("fresh") === "1" });
      this.geo = new ZS.ZoneGeo(this.state, params);
      this.map = new ZS.ZoneMap(this.state, this.geo);
      this.orders = new ZS.ZoneOrders();
      this.citizens = new ZS.ZoneCitizens(this.state, this.map);
      this.tasks = new ZS.ZoneTasks(this.state, this.map);
      this.gathering = new ZS.ZoneGathering(this.state, this.map);
      this.squads = new ZS.ZoneSquads(this.state, this.map);
      this.scavenge = new ZS.ZoneScavenge(this.state, this.map);
      this.adaptations = new ZS.ZoneAdaptations(this.state, this.map);
      this.agriculture = new ZS.ZoneAgriculture(this.state, this.map);
      this.fortifications = new ZS.ZoneFortifications(this.state, this.map);
      this.defense = new ZS.ZoneDefense(this.state, this.map, this.fortifications);
      this.regions = new ZS.ZoneRegions(this.state, this.map);
      this.campaign = new ZS.ZoneCampaign(this.state, this.map);
      this.ui = new ZS.ZoneUI(document.getElementById("zone-ui"));
      this.usesTimeScale = true;
      this.timeScale = 0;
      this.tickEmpty = true;
      this.paused = false;
      this.agents = null;
      this.world = null;
      this.nav = null;
      this.selected = [];
      this.selectedBuilding = null;
      this.selectedGatherJob = null;
      this.squadRosterOpen = false;
      this.hoverBuilding = null;
      this.spacePan = false;
      this.commandMode = null;
      this.areaTargets = [];
      this.systemPanel = null;
      this.alerts = [];
      this.mapLayers = {
        full: false,
        loot: false,
        adapted: false,
        production: false,
        priorities: false,
        threats: false,
        power: false,
        ranges: false,
        defenses: false,
      };
      this.controlGroups = Array.from({ length: 10 }, () => []);
      this.lastGroupKey = -1;
      this.lastGroupT = 0;
      this.orderPing = { x: 0, y: 0, until: 0, seed: 0 };
      this.drag = {
        active: false,
        kind: "select",
        x0: 0,
        y0: 0,
        x1: 0,
        y1: 0,
        additive: false,
        append: false,
      };
      this.saveT = 0;
      this.clockStamp = -1;
      this.uiT = 0;
      this.uiDirty = true;
      this.hudData = {
        hidden: true,
        title: "",
        stats: "",
        hint: "Clic izq. seleccionar · clic der. ordenar · Shift pone en cola · Espacio+arrastre desplaza",
        legend() {},
        overlay: () => {
          const card = this.defense.reportCard();
          if (card) return { card };
          const ending = this.campaign.endingCard();
          return ending ? { card: ending } : null;
        },
      };
      this.ui.connect({
        speed: (speed) => this.setSpeed(speed),
        establishHQ: () => this.establishHQ(),
        home: () => this.centerHome(),
        reset: () => this.resetCampaign(),
        salvage: () => this.createSalvage(),
        cancelJob: () => this.cancelSelectedJob(),
        priority: (priority) => this.setSelectedPriority(priority),
        createSquad: () => this.createSquad(),
        returnHQ: () => this.returnSelectedSquad(),
        patrol: () => this.patrolSelectedSquad(),
        disband: () => this.disbandSelectedSquad(),
        adapt: (use) => this.adaptSelectedBuilding(use),
        toggleBuilding: () => this.toggleSelectedBuilding(),
        repairBuilding: () => this.repairSelectedBuilding(),
        research: (tech) => this.research(tech),
        researchStaff: (id, delta) => this.setResearchStaff(id, delta),
        armGather: (resource) => this.armGather(resource),
        gatherStaff: (id, delta) => this.setGatherStaff(id, delta),
        gatherPriority: (id) => this.cycleGatherPriority(id),
        gatherCancel: (id) => this.cancelGatherArea(id),
        gatherFocus: (id) => this.focusGatherArea(id),
        selectSquad: (id, additive) => this.selectSquad(id, additive),
        focusSquad: (id) => this.focusSquad(id),
        toggleRoster: () => this.toggleSquadRoster(),
        armOrder: () => this.armOrder(),
        armArea: () => this.armAreaScavenge(),
        armAttack: () => this.armAttack(),
        armGarrison: () => this.armGarrison(),
        mapContext: (sx, sy, append) => this.issueScreenOrder(sx, sy, append),
        retreat: () => this.retreatSelectedSquads(),
        armDefense: (kind) => this.armDefense(kind),
        armField: (kind) => this.armField(kind),
        fieldAction: (id, action) => this.fieldAction(id, action),
        productionAction: (id, action) => this.productionAction(id, action),
        focusField: (id) => this.focusField(id),
        stop: () => this.stopSelectedSquads(),
        openSystem: (name) => this.openSystem(name),
        closeSystem: () => this.openSystem(null),
        toggleLayer: (name) => this.toggleMapLayer(name),
        focusAlert: (index) => this.focusAlert(index),
        focusCitizen: (id) => this.focusCitizen(id),
        expedition: (id) => this.startExpedition(id),
        exportMap: () => this.geo.exportPack(),
        campaignChoice: (eventId, choiceId) => this.resolveCampaignChoice(eventId, choiceId),
        campaignResearch: () => this.advanceCampaignCure(),
        campaignTrade: (factionId) => this.campaignTrade(factionId),
        campaignLaw: (lawId) => this.campaignLaw(lawId),
      });
      this.state.capture = () => this._capture();
      window.addEventListener("keydown", (event) => {
        if (this._typingInControl(event.target)) return;
        if (event.code === "Space") {
          this.spacePan = true;
          event.preventDefault();
        } else if (/^Digit[1-9]$/.test(event.code)) {
          const index = Number(event.code.slice(5));
          if (event.ctrlKey || event.metaKey) this._assignControlGroup(index);
          else this._recallControlGroup(index);
          event.preventDefault();
        } else if (event.code === "Escape") {
          this._cancelCommand();
          this._clearSelection();
          this.selectedBuilding = null;
          this.squadRosterOpen = false;
          this._refreshSelection();
        } else if (event.code === "KeyS") {
          this.stopSelectedSquads();
        } else if (event.code === "KeyH") {
          this.returnSelectedSquad();
        } else if (event.code === "KeyP") {
          this.patrolSelectedSquad();
        } else if (event.code === "KeyV") {
          this.armAreaScavenge();
        } else if (event.code === "KeyA") {
          this.armAttack();
        } else if (event.code === "KeyG") {
          this.armGarrison();
        } else if (event.code === "KeyR") {
          this.retreatSelectedSquads();
        }
      });
      window.addEventListener("keyup", (event) => {
        if (event.code === "Space") this.spacePan = false;
      });
      const canvas = document.getElementById("c");
      canvas.addEventListener("contextmenu", (event) => event.preventDefault());
      canvas.addEventListener("pointermove", (event) => this._hoverAt(event));
      canvas.addEventListener("pointerleave", () => this._clearHover());
      window.addEventListener("beforeunload", () => this.state.save());
    }

    async bootstrap() {
      await this.geo.prepare();
    }

    worldOptions() {
      return this.geo.worldOptions();
    }

    terrain(world, nav) {
      this.world = world;
      this.nav = nav;
      this.map.prepare(world, nav);
      this.gathering.prepare(world, nav);
      this.map.onDemolished = (record) => {
        if (this.selectedBuilding === record) this.selectedBuilding = null;
        if (this.hoverBuilding === record) this.hoverBuilding = null;
        this.ui.toast(record.name + " ha sido desmantelado.");
        this.state.save();
        this._markUI();
      };
      this.regions.prepare();
      this.agriculture.prepare(world, nav);
      this.fortifications.prepare(world, nav);
      this.selectedBuilding = this.map.hq || this.map.recommended;
      this.timeScale = this.map.hq ? this.state.scale() : 0;
      this._refreshClock(true);
      this._refreshSelection();
    }

    attachStains(_stains) {}

    init(agents) {
      this.agents = agents;
      this._wirePopulation();
    }

    _wirePopulation() {
      this.citizens.initialize(this.agents, (x, y, st) => this.makeAgent(x, y, st));
      this.citizens.connect(this.tasks, this.squads, () => this._markUI());
      this.tasks.connect(this.citizens, () => this._markUI());
      this.squads.connect(this.citizens, this.scavenge, this.agents, () => this._markUI());
      this.scavenge.connect(this.citizens, this.squads, this, this.agents, () => this._markUI());
      this.tasks.connectAdaptations(this.adaptations);
      this.tasks.connectAgriculture(this.agriculture);
      this.gathering.connect(this.tasks, () => this._markUI());
      this.adaptations.connect(
        this.citizens,
        this.tasks,
        () => this._markUI(),
        (tech) => {
          this.ui.toast((TECH_NAME[tech] || "La tecnología") + " ha sido investigada.");
          this._markUI();
        },
      );
      this.agriculture.connect(this.tasks, this.citizens, this.fortifications, () =>
        this._markUI(),
      );
      this.fortifications.connectAgriculture(this.agriculture);
      this.defense.connectAgriculture(this.agriculture);
      this.citizens.connectAdaptations(this.adaptations);
      this.defense.connect(this.citizens, this.squads, this, this.agents, () => {
        this._markUI();
        this._refreshClock(true);
        this._refreshSettlement();
      });
      this.fortifications.connect(this, this.agents, () => this._markUI());
      this.regions.connect(() => this._markUI());
      this.citizens.connectCampaign(this.campaign);
      this.campaign.connect(this.citizens, this.adaptations, this.defense, this.regions, this, () =>
        this._markUI(),
      );
      this.tasks.reconcile();
      this._markUI();
      this._refreshSettlement();
      this._refreshSelection();
    }

    maintain(_agents, dt) {
      this.state.advance(dt);
      this.map.update(dt);
      this.adaptations.update(dt);
      this.agriculture.update(dt);
      this.defense.update(dt, performance.now() / 1000, this.nav);
      this.fortifications.update(dt);
      this.regions.update(dt);
      this.campaign.update(dt);
      this.saveT += dt;
      if (this.saveT >= 10) {
        this.saveT = 0;
        this.state.save();
      }
      this._refreshClock(false);
    }

    frame(_agents, dt) {
      this.tasks.updateBoard(dt);
      this._pruneSelection();
      this.uiT += dt;
      if (this.uiDirty || this.uiT >= 0.25) {
        this.uiT = 0;
        this.uiDirty = false;
        this._refreshSettlement();
        this._refreshSelection();
      }
    }

    update(agent, dt, t, _grid, nav) {
      if (agent.dead) return;
      agent.muzzle = Math.max(0, (agent.muzzle || 0) - dt);
      if (agent.zoneEnemy) {
        if (agent.zoneHorde) this.defense.updateEnemy(agent, dt, t, nav);
        else this.scavenge.updateEnemy(agent, dt, t, nav);
        return;
      }
      this.citizens.updateNeeds(agent, dt);
      if (agent.role === CFG.ROLE.SQUAD) this.squads.update(agent, dt, t, nav);
      else this.tasks.updateWorker(agent, dt, t, nav);
    }

    left(_agents) {
      return 1;
    }

    counts(_agents) {
      const stats = this.citizens.stats();
      return { population: stats.population, squads: this.squads.list.length };
    }

    hostile(agent) {
      return Boolean(agent.zoneEnemy);
    }

    walkBlocked(agent) {
      return Boolean(agent.zoneEnemy);
    }

    maxSpeed(agent) {
      const squad = agent.squadId !== null ? this.squads.at(agent.squadId) : null;
      return agent.zoneEnemy
        ? agent.zoneHorde
          ? this.defense.enemySpeed(agent)
          : 72
        : CFG.AGENT.SPEED *
            (agent.squadRank > 0 ? 1.18 : 1) *
            (squad && squad.retreating ? CFG.DEFENSE.RETREAT_SPEED_MULTIPLIER : 1);
    }

    makeAgent(x, y, st) {
      const agent = ZS.ScenarioZombie.prototype.makeAgent.call(this, x, y, st || 0, false);
      agent.selected = false;
      agent.orders = [];
      agent.orderIndex = 0;
      agent.zoneBuildingId = null;
      agent.zoneCitizen = false;
      agent.zoneEnemy = false;
      agent.zoneHorde = false;
      agent.zoneEnemyType = CFG.ENEMY.SHAMBLER;
      agent.squadId = null;
      agent.squadRank = -1;
      return agent;
    }

    drawGround(c, world) {
      this.map.drawGround(c);
      this.gathering.drawGround(c);
      this.agriculture.drawGround(c);
      this.fortifications.drawGround(c);
      const minute = this.state.minute;
      let alpha = 0;
      if (minute >= CFG.CLOCK.NIGHT || minute < CFG.CLOCK.DAWN) alpha = 0.3;
      else if (minute < CFG.CLOCK.DAY)
        alpha = 0.3 * (1 - (minute - CFG.CLOCK.DAWN) / (CFG.CLOCK.DAY - CFG.CLOCK.DAWN));
      else if (minute >= CFG.CLOCK.DUSK)
        alpha = 0.3 * ((minute - CFG.CLOCK.DUSK) / (CFG.CLOCK.NIGHT - CFG.CLOCK.DUSK));
      if (alpha <= 0.001) return;
      c.fillStyle = "rgba(31,35,52," + alpha.toFixed(3) + ")";
      c.fillRect(0, 0, world.w, world.h);
    }

    drawPermanentGround(c, world) {
      this.map.drawPermanentGround(c, world.visibleRect);
    }

    drawBuildingOverlay(c, shape) {
      const record = this.map.at(shape.zoneId),
        job = record && this.tasks.forBuilding(record.id);
      this.map.drawBuildingOverlay(
        c,
        shape,
        false,
        Boolean(this.hoverBuilding && this.hoverBuilding.id === shape.zoneId),
        this._isAreaTarget(shape.zoneId),
        this.mapLayers,
        job,
      );
      if (!record || (!job && !record.revealed)) return;
      c.save();
      c.strokeStyle = job ? "rgba(126,89,48,0.8)" : "rgba(79,105,55,0.7)";
      c.fillStyle = job ? "rgba(191,143,73,0.18)" : "rgba(112,148,72,0.16)";
      c.lineWidth = 1.3;
      ZS.wcirc(c, record.cx, shape.y - 10, job ? 6 : 4, shape.seed + 509, 0.8);
      c.fill();
      c.restore();
    }

    _drawSelectionRect(c, x, y, w, h, seed, zoom) {
      const amp = Math.max(2, 2 / zoom);
      c.lineWidth = Math.max(2, 2 / zoom);
      ZS.wline(c, x, y, x + w, y, seed, amp);
      ZS.wline(c, x + w, y, x + w, y + h, seed + 1, amp);
      ZS.wline(c, x + w, y + h, x, y + h, seed + 2, amp);
      ZS.wline(c, x, y + h, x, y, seed + 3, amp);
    }

    _drawSelectedBuilding(c, zoom) {
      const record = this.selectedBuilding;
      if (!record || record.demolished) return;
      const shape = record.shape,
        points = shape.halo || shape.footprint;
      c.save();
      c.strokeStyle = "rgba(79,105,55,0.92)";
      c.lineWidth = Math.max(2, 2 / zoom);
      if (points) {
        ZS.wpoly(c, points, shape.seed + 511, Math.max(0.7, 0.7 / zoom), true);
        c.stroke();
      } else {
        const pad = 7;
        this._drawSelectionRect(
          c,
          shape.x - pad,
          shape.y - pad,
          shape.w + pad * 2,
          shape.h + pad * 2,
          shape.seed + 511,
          zoom,
        );
      }
      c.restore();
    }

    draw(c, agent, t) {
      ZS.ScenarioZombie.prototype.draw.call(this, c, agent, t);
      if (!agent.selected) return;
      c.save();
      c.strokeStyle = "rgba(79,105,55,0.95)";
      c.lineWidth = 1.8;
      ZS.wcirc(c, agent.x, agent.y - 4, 13, agent.seed + 301, 1.2);
      c.restore();
    }

    drawOverlay(c) {
      const cam = ZS.debug && ZS.debug.cam,
        zoom = Math.max(0.05, cam ? cam.zoom : 1);
      c.save();
      c.lineCap = "round";
      c.lineJoin = "round";
      this.fortifications.drawOverlay(c, this.mapLayers.defenses);
      this.agriculture.drawOverlay(c, this.mapLayers.production);
      this.map.drawHeadquartersFlag(c, zoom);
      this.gathering.drawOverlay(c, this.selectedGatherJob, zoom);
      this._drawSelectedBuilding(c, zoom);
      for (let i = 0; i < this.selected.length; i++) {
        const agent = this.selected[i];
        if (agent.squadId !== null && agent.squadRank > 0) continue;
        const squad = this.squads.at(agent.squadId);
        if (!squad || !squad.orders.length) continue;
        c.setLineDash(ROUTE_DASH);
        c.strokeStyle = "rgba(246,241,227,0.9)";
        c.lineWidth = 4.2;
        this._drawRouteLines(c, agent, squad);
        c.strokeStyle = "rgba(79,105,55,0.88)";
        c.lineWidth = 1.8;
        this._drawRouteLines(c, agent, squad);
        c.setLineDash(SOLID_LINE);
        let scavengeStep = 0;
        const first = squad.patrolLoop ? 0 : squad.orderIndex;
        for (let j = first; j < squad.orders.length; j++) {
          const order = squad.orders[j],
            building = Number.isInteger(order.buildingId) ? this.map.at(order.buildingId) : null,
            markerX = building ? building.cx : order.x,
            markerY = building ? building.cy : order.y;
          if (order.kind === CFG.ORDER.SCAVENGE) {
            scavengeStep++;
            c.fillStyle = "rgba(246,241,227,0.88)";
            c.strokeStyle = "rgba(79,105,55,0.75)";
            ZS.wcirc(c, markerX, markerY, 8, agent.seed + j * 17 + 503, 0.8);
            c.fill();
            c.fillStyle = "rgba(61,52,43,0.9)";
            c.font = 'bold 9px "Segoe Script", "Bradley Hand", cursive';
            c.textAlign = "center";
            c.textBaseline = "middle";
            c.fillText(String(scavengeStep), markerX, markerY + 0.5);
          } else {
            c.fillStyle = "rgba(246,241,227,0.88)";
            c.strokeStyle = "rgba(79,105,55,0.82)";
            ZS.wcirc(c, markerX, markerY, 4.5, agent.seed + j * 17 + 503, 0.7);
            c.fill();
          }
        }
      }
      if (this.mapLayers.ranges) {
        c.setLineDash(ROUTE_DASH);
        c.strokeStyle = "rgba(125,72,48,0.3)";
        c.lineWidth = 1.2;
        for (let i = 0; i < this.squads.list.length; i++) {
          const leader = this.citizens.at(this.squads.list[i].members[0]);
          if (leader && !leader.dead)
            ZS.wcirc(c, leader.x, leader.y, CFG.SQUAD.FIRE_RANGE, leader.seed + 1701, 1.4);
        }
        c.setLineDash(SOLID_LINE);
      }
      if (this.drag.active) {
        const x = Math.min(this.drag.x0, this.drag.x1),
          y = Math.min(this.drag.y0, this.drag.y1),
          w = Math.abs(this.drag.x1 - this.drag.x0),
          h = Math.abs(this.drag.y1 - this.drag.y0);
        const area = this.drag.kind === "area",
          gather = this.drag.kind === "gather",
          workArea = area || gather;
        c.strokeStyle = gather
          ? "rgba(55,104,116,0.92)"
          : area
            ? "rgba(79,105,55,0.88)"
            : "rgba(61,52,43,0.75)";
        c.fillStyle = gather
          ? "rgba(79,151,166,0.16)"
          : area
            ? "rgba(112,148,72,0.14)"
            : "rgba(112,148,72,0.08)";
        c.fillRect(x, y, w, h);
        this._drawSelectionRect(c, x, y, w, h, 1, zoom);
        if (workArea) {
          c.fillStyle = "rgba(61,52,43,0.88)";
          c.font = 'bold 12px "Segoe Script", "Bradley Hand", cursive';
          c.textAlign = "center";
          c.textBaseline = "bottom";
          c.fillText(
            (gather ? this.gathering.previewNodes.length : this.areaTargets.length) +
              (gather ? " recursos" : " objetivos"),
            x + w / 2,
            y - 7,
          );
        }
      }
      const pingLife = this.orderPing.until - performance.now();
      if (pingLife > 0) {
        const progress = 1 - pingLife / 520,
          radius = 7 + progress * 14;
        c.strokeStyle = "rgba(79,105,55," + (0.8 * (1 - progress)).toFixed(3) + ")";
        c.lineWidth = 1.8;
        ZS.wcirc(c, this.orderPing.x, this.orderPing.y, radius, this.orderPing.seed, 1.2);
      }
      this.defense.drawWarning(c);
      this.fortifications.drawPreview(c);
      this.agriculture.drawPreview(c);
      c.restore();
    }

    _drawRouteLines(c, agent, squad) {
      const current = squad.orders[squad.orderIndex] || squad.orders[0];
      this._drawActiveRoute(c, agent, current);
      if (squad.patrolLoop && squad.orders.length >= 2) {
        for (let i = 0; i < squad.orders.length; i++) {
          const from = squad.orders[i],
            to = squad.orders[(i + 1) % squad.orders.length];
          this._drawRouteLeg(c, from, to, squad.routePaths[i], agent.seed + i * 131 + 401);
        }
        return;
      }
      for (let i = squad.orderIndex; i < squad.orders.length - 1; i++) {
        const from = squad.orders[i],
          to = squad.orders[i + 1];
        this._drawRouteLeg(c, from, to, squad.routePaths[i], agent.seed + i * 131 + 401);
      }
    }

    _drawActiveRoute(c, agent, target) {
      let x = agent.x,
        y = agent.y;
      const followsCurrent =
        agent.path &&
        agent.gx !== null &&
        Math.hypot(agent.gx - target.x, agent.gy - target.y) < 24;
      if (followsCurrent)
        for (let i = agent.pi; i < agent.path.length; i++) {
          const point = agent.path[i];
          if (Math.hypot(x - point.x, y - point.y) > 1)
            ZS.wline(c, x, y, point.x, point.y, agent.seed + i * 17 + 397, 1);
          x = point.x;
          y = point.y;
        }
      if (Math.hypot(x - target.x, y - target.y) > 1)
        ZS.wline(c, x, y, target.x, target.y, agent.seed + 389, 1);
    }

    _drawRouteLeg(c, from, to, path, seed) {
      let x = from.x,
        y = from.y;
      if (path)
        for (let i = 0; i < path.length; i++) {
          const point = path[i];
          if (Math.hypot(x - point.x, y - point.y) > 1)
            ZS.wline(c, x, y, point.x, point.y, seed + i * 17, 1);
          x = point.x;
          y = point.y;
        }
      if (Math.hypot(x - to.x, y - to.y) > 1) ZS.wline(c, x, y, to.x, to.y, seed + 113, 1);
    }

    drawFX(c, fx) {
      ZS.ScenarioZombie.prototype.drawFX.call(this, c, fx);
    }

    pointerDown(x, y, event) {
      if (this.defense.data.report) {
        this.defense.dismissReport();
        return true;
      }
      if (this.campaign.data.endingUnread) {
        this.campaign.dismissEnding();
        return true;
      }
      if (this.spacePan || event.button === 1) return false;
      if (
        this.commandMode &&
        (this.commandMode.startsWith("defense:") ||
          this.commandMode.startsWith("farm:") ||
          this.commandMode.startsWith("gather:")) &&
        event.button === 2
      ) {
        this._cancelCommand();
        this.ui.toast("Colocación cancelada.");
        return true;
      }
      if (event.button === 2) {
        if (event.shiftKey) {
          if (!this._selectedSquads().length) {
            this.ui.toast("Selecciona una o más escuadras primero.");
            return true;
          }
          this._startDrag("area", x, y, false, true);
          return true;
        }
        this._issueOrder(x, y, event.shiftKey);
        return true;
      }
      if (event.button !== 0) return false;
      if (this.commandMode && this.commandMode.startsWith("defense:")) {
        const value = this.commandMode.slice(8);
        if (value === "remove") {
          const removed = this.fortifications.removeAt(x, y, true);
          this.ui.toast(
            removed
              ? this.fortifications.label(removed.kind) +
                  " retirada; se recuperó la mitad del coste."
              : "No hay una defensa en esa casilla.",
          );
        } else {
          const kind = Number(value),
            placed = this.fortifications.place(x, y, kind);
          this.ui.toast(
            placed
              ? this.fortifications.label(kind) + " colocada. Puedes seguir construyendo."
              : this.fortifications.placementReason(x, y, kind),
          );
        }
        this.fortifications.clearPreview();
        this._markUI();
        return true;
      }
      if (this.commandMode && this.commandMode.startsWith("farm:")) {
        const value = this.commandMode.slice(5);
        if (value === "remove") {
          const removed = this.agriculture.removeAt(x, y, true);
          this.ui.toast(
            removed
              ? this.agriculture.label(removed.kind) + " retirado; se recuperó la mitad del coste."
              : "No hay un campo en ese lugar.",
          );
        } else {
          const kind = Number(value),
            placed = this.agriculture.place(x, y, kind);
          this.ui.toast(
            placed
              ? this.agriculture.label(kind) + " preparado. Puedes seguir trazando cultivos."
              : this.agriculture.placementReason(x, y, kind),
          );
        }
        this.agriculture.clearPreview();
        this._markUI();
        return true;
      }
      if (this.commandMode && this.commandMode.startsWith("gather:")) {
        this._startDrag("gather", x, y, false, false);
        return true;
      }
      if (this.commandMode === "order") {
        this._issueOrder(x, y, event.shiftKey);
        this._cancelCommand();
        return true;
      }
      if (this.commandMode === "attack") {
        this._issueAttackMove(x, y, event.shiftKey);
        this._cancelCommand();
        return true;
      }
      if (this.commandMode === "garrison") {
        this._issueGarrison(x, y, event.shiftKey);
        this._cancelCommand();
        return true;
      }
      if (this.commandMode === "area") {
        this._startDrag("area", x, y, false, event.shiftKey);
        return true;
      }
      this._startDrag("select", x, y, event.shiftKey || event.ctrlKey || event.metaKey, false);
      return true;
    }

    pointerMove(x, y) {
      if (this.commandMode && this.commandMode.startsWith("defense:")) {
        const value = this.commandMode.slice(8);
        this.fortifications.setPreview(x, y, value === "remove" ? 0 : Number(value));
      }
      if (this.commandMode && this.commandMode.startsWith("farm:")) {
        const value = this.commandMode.slice(5);
        this.agriculture.setPreview(x, y, value === "remove" ? 0 : Number(value));
      }
      if (!this.drag.active) return;
      this.drag.x1 = x;
      this.drag.y1 = y;
      if (this.drag.kind === "area") this._updateAreaTargets(false);
      else if (this.drag.kind === "gather")
        this.gathering.setPreview(Number(this.commandMode.slice(7)), this._areaBounds(false));
    }

    pointerUp(x, y) {
      if (!this.drag.active) return;
      this.drag.x1 = x;
      this.drag.y1 = y;
      const cam = ZS.debug && ZS.debug.cam,
        zoom = cam ? cam.zoom : 1,
        dx = this.drag.x1 - this.drag.x0,
        dy = this.drag.y1 - this.drag.y0,
        moved = Math.hypot(dx, dy) * zoom > 8;
      if (this.drag.kind === "area") {
        if (moved) this._issueScavengeArea(this._areaBounds(false), this.drag.append);
        else if (this.commandMode === "area")
          this._issueScavengeArea(this._areaBounds(true), this.drag.append);
        else this._issueOrder(x, y, true);
      } else if (this.drag.kind === "gather") {
        const resource = Number(this.commandMode.slice(7));
        this.createGatherArea(resource, this._areaBounds(!moved));
      } else if (moved) this._boxSelect(this.drag.additive);
      else this._pointSelect(x, y, this.drag.additive, zoom);
      this.drag.active = false;
      this.areaTargets.length = 0;
      if (
        this.commandMode === "area" ||
        (this.commandMode && this.commandMode.startsWith("gather:"))
      )
        this._cancelCommand();
      this._refreshSelection();
    }

    tap(_agents, _world, _x, _y, _event) {}

    adaptSelectedBuilding(use) {
      const job = this.adaptations.start(this.selectedBuilding, use);
      this.ui.toast(
        job
          ? "Adaptación en cola; materiales reservados."
          : "Esta adaptación está bloqueada o no puedes pagarla.",
      );
      this._markUI();
      return Boolean(job);
    }

    toggleSelectedBuilding() {
      const result = this.adaptations.toggle(this.selectedBuilding);
      if (result)
        this.ui.toast(this.selectedBuilding.active ? "Edificio activado." : "Edificio pausado.");
      this._markUI();
      return result;
    }

    repairSelectedBuilding() {
      const result = this.adaptations.repair(this.selectedBuilding);
      this.ui.toast(
        result
          ? "Reparaciones completadas."
          : "La reparación necesita madera y ladrillo, o no hace falta.",
      );
      this._markUI();
      return result;
    }

    research(tech) {
      const result = this.adaptations.research(tech);
      this.ui.toast(
        result
          ? "Investigación iniciada. Cada habitante asignado aumentará la velocidad."
          : this.adaptations.researchBlockReason(tech),
      );
      this._markUI();
      return result;
    }

    setResearchStaff(buildingId, delta) {
      const result = this.adaptations.setResearchStaff(buildingId, delta);
      if (!result)
        this.ui.toast(
          delta > 0
            ? "El centro ya alcanzó su capacidad o no está disponible."
            : "El centro ya está sin personal.",
        );
      this._markUI();
      return result;
    }

    resolveCampaignChoice(eventId, choiceId) {
      const result = this.campaign.choose(eventId, choiceId);
      this.ui.toast(
        result
          ? "La decisión queda registrada en el diario de la Zona."
          : "Esa opción no está disponible.",
      );
      this._markUI();
      return result;
    }

    advanceCampaignCure() {
      const result = this.campaign.advanceCure();
      this.ui.toast(
        result ? "Proyecto Aurora avanza a una nueva etapa." : this.campaign.cureBlockReason(),
      );
      this._markUI();
      return result;
    }

    campaignTrade(factionId) {
      const result = this.campaign.trade(factionId);
      this.ui.toast(
        result
          ? "Intercambio completado. La ruta volverá a estar disponible mañana."
          : "El intercambio no está disponible o faltan recursos.",
      );
      this._markUI();
      return result;
    }

    campaignLaw(lawId) {
      const result = this.campaign.setLaw(lawId);
      this.ui.toast(
        result
          ? "La nueva directiva entra en vigor."
          : "Solo puedes cambiar de directiva una vez por día.",
      );
      this._markUI();
      return result;
    }

    setSpeed(speed) {
      if (!this.map.hq && speed !== 0) {
        this.ui.toast("Establece una base antes de poner en marcha el reloj.");
        return;
      }
      if (!this.state.setSpeed(speed)) return;
      this.timeScale = this.state.scale();
      this.state.save();
      this._refreshClock(true);
    }

    establishHQ() {
      const record = this.selectedBuilding;
      if (!record || this.map.hq || !this.map.setHQ(record.id)) return false;
      this.state.setSpeed(1);
      this.timeScale = 1;
      this._wirePopulation();
      this.state.save();
      this.centerHome();
      this.ui.toast("Base establecida. Los trabajadores y la primera escuadra están listos.");
      this._refreshClock(true);
      this._markUI();
      return true;
    }

    issueScreenOrder(screenX, screenY, append) {
      const cam = ZS.debug && ZS.debug.cam;
      if (!cam) return false;
      const point = cam.toWorld(screenX, screenY, innerWidth, innerHeight);
      return this._issueOrder(point.x, point.y, append);
    }

    createSalvage() {
      if (!this.selectedBuilding) return false;
      if (!this.map.reachable(this.selectedBuilding)) {
        this.ui.toast("No hay una ruta peatonal desde la base hasta este edificio.");
        return false;
      }
      const job = this.tasks.postSalvage(this.selectedBuilding.id, CFG.PRIORITY.NORMAL);
      this.ui.toast(
        job
          ? "Desguace en cola; trabajadores disponibles asignados."
          : "No hay materiales para desguazar aquí.",
      );
      this._markUI();
      return Boolean(job);
    }

    cancelSelectedJob() {
      const job = this.selectedBuilding && this.tasks.forBuilding(this.selectedBuilding.id),
        result = Boolean(job && this.tasks.cancel(job.id));
      if (result)
        this.ui.toast(
          job.type === CFG.JOB.BUILD
            ? "Adaptación cancelada; materiales reservados devueltos."
            : "Tarea cancelada; los materiales transportados volverán a la base.",
        );
      this._markUI();
      return result;
    }

    setSelectedPriority(priority) {
      const job = this.selectedBuilding && this.tasks.forBuilding(this.selectedBuilding.id),
        result = Boolean(job && this.tasks.setPriority(job.id, priority));
      this._markUI();
      return result;
    }

    createSquad() {
      const squad = this.squads.create(this.selected, false);
      if (!squad) {
        this.ui.toast("Selecciona hasta cuatro trabajadores libres.");
        return false;
      }
      this._clearSelection();
      for (let i = 0; i < squad.members.length; i++) {
        const member = this.citizens.at(squad.members[i]);
        if (member) this._addSelected(member);
      }
      this.ui.toast("Escuadra " + squad.id + " formada.");
      this._markUI();
      return true;
    }

    returnSelectedSquad() {
      const squads = this._selectedSquads();
      let count = 0;
      for (let i = 0; i < squads.length; i++) if (this.squads.returnHQ(squads[i], null)) count++;
      const result = count > 0;
      if (result)
        this.ui.toast(
          count === 1 ? "La escuadra regresa a la base." : count + " escuadras regresan a la base.",
        );
      this._markUI();
      return result;
    }

    patrolSelectedSquad() {
      const squads = this._selectedSquads();
      let count = 0;
      for (let i = 0; i < squads.length; i++) if (this.squads.patrolQueued(squads[i])) count++;
      const result = count > 0;
      this.ui.toast(
        result
          ? count === 1
            ? "Los puntos en cola forman ahora una patrulla en bucle."
            : count + " rutas de patrulla activadas."
          : "Pon en cola al menos dos movimientos por tierra primero.",
      );
      this._markUI();
      return result;
    }

    disbandSelectedSquad() {
      const squads = this._selectedSquads();
      let count = 0;
      for (let i = squads.length - 1; i >= 0; i--) if (this.squads.disband(squads[i].id)) count++;
      const result = count > 0;
      this.ui.toast(
        result
          ? count === 1
            ? "La escuadra volvió al grupo de trabajadores."
            : count + " escuadras volvieron al grupo de trabajadores."
          : "Una escuadra solo puede disolverse dentro de la base.",
      );
      this._markUI();
      return result;
    }

    centerHome() {
      const target = this.map.hq || this.map.recommended,
        cam = ZS.debug && ZS.debug.cam;
      if (!target || !cam) return;
      cam.auto = false;
      cam.x = target.cx;
      cam.y = target.cy;
      cam.zoom = Math.max(cam.minZoom, 0.75);
      cam.clamp(window.innerWidth, window.innerHeight);
    }

    focusSquad(id) {
      const squad = this.squads.at(id);
      if (!squad) return false;
      return this._focusSquads([squad]);
    }

    focusCitizen(id) {
      const citizen = this.citizens.at(id),
        cam = ZS.debug && ZS.debug.cam;
      if (!citizen || citizen.dead || !cam) return false;
      this.squadRosterOpen = false;
      this._clearSelection();
      if (citizen.squadId !== null) this._addSquadSelected(this.squads.at(citizen.squadId));
      else this._addSelected(citizen);
      this.selectedBuilding = null;
      cam.auto = false;
      cam.x = citizen.x;
      cam.y = citizen.y;
      cam.zoom = Math.max(cam.minZoom, 1.05);
      cam.clamp(window.innerWidth, window.innerHeight);
      this._refreshSelection();
      return true;
    }

    openSystem(name) {
      this.systemPanel = this.systemPanel === name ? null : name;
      this.ui.setSystemPanel(this.systemPanel, this._systemModel());
      return this.systemPanel;
    }

    toggleMapLayer(name) {
      if (!(name in this.mapLayers)) return false;
      this.mapLayers[name] = !this.mapLayers[name];
      this.ui.setLayerState(this.mapLayers);
      return this.mapLayers[name];
    }

    focusAlert(index) {
      const alert = this.alerts[index];
      if (!alert) return false;
      if (alert.target === "home") {
        this.centerHome();
        return true;
      }
      if (alert.target === "building") {
        const record = this.map.at(alert.id),
          cam = ZS.debug && ZS.debug.cam;
        if (!record || !cam) return false;
        this._clearSelection();
        this.selectedBuilding = record;
        cam.auto = false;
        cam.x = record.cx;
        cam.y = record.cy;
        cam.zoom = Math.max(cam.minZoom, 0.95);
        cam.clamp(window.innerWidth, window.innerHeight);
        this._refreshSelection();
        return true;
      }
      if (alert.target === "squad") return this.focusSquad(alert.id);
      if (alert.target === "citizen") return this.focusCitizen(alert.id);
      if (alert.target === "campaign") {
        this.systemPanel = "radio";
        this.ui.setSystemPanel(this.systemPanel, this._systemModel());
        return true;
      }
      return false;
    }

    selectSquad(id, additive) {
      const squad = this.squads.at(id);
      if (!squad) return false;
      this.squadRosterOpen = false;
      if (!additive) this._clearSelection();
      if (additive && this._squadIsSelected(squad)) this._removeSquadSelected(squad);
      else this._addSquadSelected(squad);
      this.selectedBuilding = null;
      this._cancelCommand();
      this._refreshSelection();
      return true;
    }

    toggleSquadRoster() {
      if (!this.map.hq) return false;
      this.squadRosterOpen = !this.squadRosterOpen;
      if (this.squadRosterOpen) {
        this._cancelCommand();
        this._clearSelection();
        this.selectedBuilding = null;
      }
      this._refreshSelection();
      return this.squadRosterOpen;
    }

    armOrder() {
      if (!this._selectedSquads().length) {
        this.ui.toast("Selecciona una o más escuadras primero.");
        return false;
      }
      this.commandMode = "order";
      document.getElementById("c").classList.add("zone-commanding");
      this.ui.setCommandMode("order");
      this.ui.toast("Elige el suelo o un edificio. Shift conserva la ruta existente.");
      return true;
    }

    armAreaScavenge() {
      if (!this._selectedSquads().length) {
        this.ui.toast("Selecciona una o más escuadras primero.");
        return false;
      }
      this.commandMode = "area";
      document.getElementById("c").classList.add("zone-commanding");
      this.ui.setCommandMode("area");
      this.ui.toast("Arrastra sobre edificios abandonados para crear rutas automáticas de saqueo.");
      return true;
    }

    armGather(resource) {
      if (!this.map.hq || (resource !== CFG.RESOURCE.WOOD && resource !== CFG.RESOURCE.METAL))
        return false;
      this._cancelCommand();
      this.commandMode = "gather:" + resource;
      this.systemPanel = "resources";
      document.getElementById("c").classList.add("zone-commanding");
      this.ui.setSystemPanel(this.systemPanel, this._systemModel());
      this.ui.setCommandMode(this.commandMode);
      this.ui.toast(
        "Arrastra sobre " +
          (resource === CFG.RESOURCE.WOOD
            ? "los árboles que quieres talar."
            : "edificios abandonados para recuperar su metal."),
      );
      return true;
    }

    createGatherArea(resource, bounds) {
      const job = this.gathering.create(resource, bounds);
      if (!job) {
        this.ui.toast(
          resource === CFG.RESOURCE.WOOD
            ? "No hay árboles libres y accesibles dentro del área."
            : "No hay metal libre y accesible dentro del área.",
        );
        return false;
      }
      this.selectedGatherJob = job.id;
      this.orderPing.x = (bounds.x0 + bounds.x1) / 2;
      this.orderPing.y = (bounds.y0 + bounds.y1) / 2;
      this.orderPing.until = performance.now() + 520;
      this.orderPing.seed++;
      this.ui.toast(
        "Área de " +
          this.gathering.label(resource) +
          " marcada · " +
          job.nodeIds.length +
          " punto" +
          (job.nodeIds.length === 1 ? "" : "s") +
          " · " +
          job.capacity +
          " trabajadores.",
      );
      this._markUI();
      return true;
    }

    setGatherStaff(id, delta) {
      const job = this.tasks.at(id),
        result = Boolean(
          job && job.type === CFG.JOB.GATHER && this.tasks.setCapacity(id, job.capacity + delta),
        );
      if (!result) this.ui.toast("Ese límite de trabajadores ya está alcanzado.");
      this._markUI();
      return result;
    }

    cycleGatherPriority(id) {
      const job = this.tasks.at(id);
      if (!job || job.type !== CFG.JOB.GATHER) return false;
      const next = job.priority >= CFG.PRIORITY.HIGH ? CFG.PRIORITY.LOW : job.priority + 1,
        result = this.tasks.setPriority(id, next);
      this._markUI();
      return result;
    }

    cancelGatherArea(id) {
      const job = this.tasks.at(id),
        result = Boolean(job && job.type === CFG.JOB.GATHER && this.tasks.cancel(id));
      if (result && this.selectedGatherJob === id) this.selectedGatherJob = null;
      this.ui.toast(result ? "Área de recolección cancelada." : "El área ya no está activa.");
      this._markUI();
      return result;
    }

    focusGatherArea(id) {
      const job = this.tasks.at(id),
        cam = ZS.debug && ZS.debug.cam;
      if (!job || job.type !== CFG.JOB.GATHER || !job.bounds || !cam) return false;
      this.selectedGatherJob = id;
      this.selectedBuilding = null;
      this._clearSelection();
      cam.auto = false;
      cam.x = (job.bounds.x0 + job.bounds.x1) / 2;
      cam.y = (job.bounds.y0 + job.bounds.y1) / 2;
      cam.zoom = Math.max(cam.minZoom, 0.9);
      cam.clamp(window.innerWidth, window.innerHeight);
      this._markUI();
      return true;
    }

    armAttack() {
      if (!this._selectedSquads().length) {
        this.ui.toast("Selecciona una o más escuadras primero.");
        return false;
      }
      this.commandMode = "attack";
      document.getElementById("c").classList.add("zone-commanding");
      this.ui.setCommandMode("attack");
      this.ui.toast("Elige un punto: las patrullas avanzarán combatiendo hasta allí.");
      return true;
    }

    armGarrison() {
      if (!this._selectedSquads().length) {
        this.ui.toast("Selecciona una o más escuadras primero.");
        return false;
      }
      this.commandMode = "garrison";
      document.getElementById("c").classList.add("zone-commanding");
      this.ui.setCommandMode("garrison");
      this.ui.toast("Elige un edificio despejado para guarnecerlo.");
      return true;
    }

    armDefense(kind) {
      if (!this.map.hq) return false;
      if (kind !== 0 && !this.fortifications.isUnlocked(kind)) {
        this.ui.toast("La torre requiere investigar Fortificaciones.");
        return false;
      }
      this.commandMode = kind === 0 ? "defense:remove" : "defense:" + kind;
      document.getElementById("c").classList.add("zone-commanding");
      this.ui.setCommandMode(this.commandMode);
      this.ui.toast(
        kind === 0
          ? "Elige una defensa para retirarla y recuperar la mitad del coste."
          : "Coloca " +
              this.fortifications.label(kind) +
              " sobre terreno libre · clic derecho o Escape cancela.",
      );
      return true;
    }

    armField(kind) {
      if (!this.map.hq) return false;
      if (kind !== 0 && !this.agriculture.isUnlocked(kind)) {
        this.ui.toast("Investiga Agricultura antes de preparar campos.");
        return false;
      }
      this.commandMode = kind === 0 ? "farm:remove" : "farm:" + kind;
      document.getElementById("c").classList.add("zone-commanding");
      this.ui.setCommandMode(this.commandMode);
      this.ui.toast(
        kind === 0
          ? "Elige un campo para retirarlo y recuperar la mitad del coste."
          : "Coloca " +
              this.agriculture.label(kind) +
              " sobre terreno libre · clic derecho o Escape cancela.",
      );
      return true;
    }

    fieldAction(id, action) {
      const field = this.agriculture.at(id);
      if (!field) return false;
      let result = false;
      if (action === "toggle") result = this.agriculture.toggle(field);
      else if (action === "fertilizer") result = this.agriculture.toggleFertilizer(field);
      else if (action === "priority") result = this.agriculture.cyclePriority(field);
      this.ui.toast(
        result
          ? "Ajuste del campo aplicado."
          : "Ese ajuste está bloqueado o el campo ya no está operativo.",
      );
      this._markUI();
      return result;
    }

    productionAction(id, action) {
      const record = this.map.at(id);
      if (!record) return false;
      let result = false;
      if (action === "toggle") result = this.adaptations.toggle(record);
      else if (action === "recipe")
        result = this.adaptations.setRecipe(
          record,
          record.recipe === CFG.RECIPE.GRAIN ? CFG.RECIPE.MEAT : CFG.RECIPE.GRAIN,
        );
      else if (action === "fertilizer") result = this.adaptations.toggleFertilizer(record);
      this.ui.toast(result ? "Producción ajustada." : "Ese ajuste no está disponible.");
      this._markUI();
      return result;
    }

    focusField(id) {
      const field = this.agriculture.at(id),
        cam = ZS.debug && ZS.debug.cam;
      if (!field || !cam) return false;
      cam.auto = false;
      cam.x = field.x;
      cam.y = field.y;
      cam.zoom = Math.max(cam.minZoom, 1.05);
      cam.clamp(window.innerWidth, window.innerHeight);
      return true;
    }

    retreatSelectedSquads() {
      const squads = this._selectedSquads();
      let count = 0;
      for (let i = 0; i < squads.length; i++) if (this.squads.retreat(squads[i])) count++;
      this.ui.toast(
        count
          ? count === 1
            ? "Retirada: la patrulla corre al cuartel general."
            : "Retirada de " + count + " patrullas hacia el cuartel general."
          : "Selecciona patrullas para ordenar una retirada.",
      );
      this._markUI();
      return count > 0;
    }

    stopSelectedSquads() {
      const squads = this._selectedSquads();
      for (let i = 0; i < squads.length; i++) this.squads.clearOrders(squads[i]);
      if (squads.length)
        this.ui.toast(
          squads.length === 1
            ? "La escuadra mantiene la posición."
            : "Las escuadras mantienen la posición.",
        );
      this._markUI();
      return squads.length > 0;
    }

    resetCampaign() {
      if (!window.confirm("¿Borrar esta zona y generar un nuevo asentamiento?")) return;
      this.state.store.clear();
      window.location.href = window.location.pathname;
    }

    startExpedition(id) {
      const started = this.regions.start(id, this.squads.list.length);
      this.ui.toast(
        started
          ? "La expedición ha partido. Regresará en unas tres horas."
          : "Hace falta una patrulla, 6 de comida, 2 de munición y una ruta conectada.",
      );
      this._markUI();
      return started;
    }

    camInterest(_dt) {
      const target = this.map.hq || this.map.recommended;
      if (!target) return null;
      CI.x = target.cx;
      CI.y = target.cy;
      return CI;
    }

    hud(_agents, _wave) {
      return this.hudData;
    }

    _issueOrder(x, y, append) {
      const squads = this._selectedSquads();
      if (!squads.length) {
        this.ui.toast("Selecciona una o más escuadras primero.");
        return false;
      }
      const building = this.map.buildingAt(x, y);
      let count = 0;
      for (let i = 0; i < squads.length; i++) {
        let tx = x,
          ty = y;
        if (!building && squads.length > 1) {
          const angle = (i / squads.length) * Math.PI * 2;
          tx += Math.cos(angle) * 28;
          ty += Math.sin(angle) * 28;
        }
        if (this.squads.issueContext(squads[i], tx, ty, append, building)) count++;
      }
      if (!count) return false;
      this.orderPing.x = x;
      this.orderPing.y = y;
      this.orderPing.until = performance.now() + 520;
      this.orderPing.seed++;
      this.ui.toast(
        building
          ? building === this.map.hq ||
            building.looted ||
            building.use !== CFG.BUILDING_USE.ABANDONED
            ? count === 1
              ? "Orden de guarnición emitida."
              : count + " escuadras enviadas a guarnecer."
            : count === 1
              ? "Orden de saqueo emitida."
              : count + " escuadras enviadas a saquear."
          : append
            ? count === 1
              ? "Orden puesta en cola."
              : "Órdenes en cola para " + count + " escuadras."
            : count === 1
              ? "Orden de movimiento emitida."
              : count + " escuadras en movimiento.",
      );
      this._markUI();
      return true;
    }

    _issueAttackMove(x, y, append) {
      const squads = this._selectedSquads();
      if (!squads.length) return false;
      let count = 0;
      for (let i = 0; i < squads.length; i++) {
        const angle = squads.length > 1 ? (i / squads.length) * Math.PI * 2 : 0,
          tx = x + Math.cos(angle) * (squads.length > 1 ? 24 : 0),
          ty = y + Math.sin(angle) * (squads.length > 1 ? 24 : 0);
        if (this.squads.issueAttackMove(squads[i], tx, ty, append)) count++;
      }
      if (!count) return false;
      this.orderPing.x = x;
      this.orderPing.y = y;
      this.orderPing.until = performance.now() + 520;
      this.orderPing.seed++;
      this.ui.toast(
        count === 1
          ? "Orden de ataque y avance emitida."
          : count + " patrullas avanzan combatiendo.",
      );
      this._markUI();
      return true;
    }

    _issueGarrison(x, y, append) {
      const squads = this._selectedSquads(),
        building = this.map.buildingAt(x, y);
      if (!squads.length || !building || !building.revealed || !building.cleared) {
        this.ui.toast("Elige un edificio despejado para guarnecerlo.");
        return false;
      }
      let count = 0;
      for (let i = 0; i < squads.length; i++)
        if (this.squads.issueGarrison(squads[i], building, append)) count++;
      if (!count) return false;
      this.ui.toast(
        count === 1
          ? "La patrulla guarnecerá " + (building === this.map.hq ? "el CG." : building.name + ".")
          : count + " patrullas guarnecerán el edificio.",
      );
      this._markUI();
      return true;
    }

    _issueScavengeArea(bounds, append) {
      const squads = this._selectedSquads();
      if (!squads.length) {
        this.ui.toast("Selecciona una o más escuadras primero.");
        return false;
      }
      const records = this._recordsInArea(bounds),
        result = this.squads.issueArea(squads, records, append);
      if (!result.assigned) {
        this.ui.toast(
          result.considered
            ? "Las rutas de esas escuadras están llenas. Deténlas o sustituye la ruta."
            : "No hay edificios abandonados sin reclamar y con botín en esa zona.",
        );
        return false;
      }
      this.orderPing.x = (bounds.x0 + bounds.x1) / 2;
      this.orderPing.y = (bounds.y0 + bounds.y1) / 2;
      this.orderPing.until = performance.now() + 520;
      this.orderPing.seed++;
      this.ui.toast(
        result.assigned +
          " edificio" +
          (result.assigned === 1 ? "" : "s") +
          " distribuido" +
          (result.assigned === 1 ? "" : "s") +
          " entre " +
          squads.length +
          " escuadra" +
          (squads.length === 1 ? "." : "s."),
      );
      this._markUI();
      return true;
    }

    _startDrag(kind, x, y, additive, append) {
      this.drag.active = true;
      this.drag.kind = kind;
      this.drag.x0 = this.drag.x1 = x;
      this.drag.y0 = this.drag.y1 = y;
      this.drag.additive = additive;
      this.drag.append = append;
      if (kind === "area") this._updateAreaTargets(false);
      else if (kind === "gather")
        this.gathering.setPreview(Number(this.commandMode.slice(7)), this._areaBounds(false));
    }

    _areaBounds(expandClick) {
      const radius = expandClick ? 145 : 0;
      return {
        x0: Math.min(this.drag.x0, this.drag.x1) - radius,
        y0: Math.min(this.drag.y0, this.drag.y1) - radius,
        x1: Math.max(this.drag.x0, this.drag.x1) + radius,
        y1: Math.max(this.drag.y0, this.drag.y1) + radius,
      };
    }

    _updateAreaTargets(expandClick) {
      const records = this._recordsInArea(this._areaBounds(expandClick));
      this.areaTargets.length = 0;
      for (let i = 0; i < records.length; i++) this.areaTargets.push(records[i]);
    }

    _recordsInArea(bounds) {
      const records = [];
      for (let i = 0; i < this.map.records.length; i++) {
        const record = this.map.records[i],
          shape = record.shape;
        if (
          record === this.map.hq ||
          record.use !== CFG.BUILDING_USE.ABANDONED ||
          record.looted ||
          this.map.lootTotal(record) <= 0 ||
          shape.x + shape.w < bounds.x0 ||
          shape.x > bounds.x1 ||
          shape.y + shape.h < bounds.y0 ||
          shape.y > bounds.y1
        )
          continue;
        records.push(record);
      }
      return records;
    }

    _isAreaTarget(id) {
      for (let i = 0; i < this.areaTargets.length; i++)
        if (this.areaTargets[i].id === id) return true;
      return false;
    }

    _pointSelect(x, y, additive, zoom) {
      this.squadRosterOpen = false;
      let nearest = null,
        best = Math.pow(CFG.AGENT.SELECT_R / Math.max(0.5, zoom), 2);
      for (let i = 0; this.agents && i < this.agents.length; i++) {
        const agent = this.agents[i];
        if (!agent.zoneCitizen || agent.dead) continue;
        const dx = agent.x - x,
          dy = agent.y - y,
          d = dx * dx + dy * dy;
        if (d < best) {
          best = d;
          nearest = agent;
        }
      }
      if (nearest) {
        if (nearest.squadId !== null) {
          const squad = this.squads.at(nearest.squadId);
          if (!additive) this._clearSelection();
          if (additive && this._squadIsSelected(squad)) this._removeSquadSelected(squad);
          else this._addSquadSelected(squad);
        } else {
          if (!additive) this._clearSelection();
          if (nearest.selected && additive) this._removeSelected(nearest);
          else if (!nearest.selected) this._addSelected(nearest);
        }
        this.selectedBuilding = null;
        this.selectedGatherJob = null;
        return;
      }
      const gatherJob = this.gathering.atPoint(x, y, zoom);
      if (gatherJob) {
        if (!additive) this._clearSelection();
        this.selectedBuilding = null;
        this.selectedGatherJob = gatherJob.id;
        this.systemPanel = "resources";
        return;
      }
      const building = this.map.buildingAt(x, y);
      if (!additive) this._clearSelection();
      this.selectedBuilding = building;
      this.selectedGatherJob = null;
    }

    _boxSelect(additive) {
      this.squadRosterOpen = false;
      if (!additive) this._clearSelection();
      const x0 = Math.min(this.drag.x0, this.drag.x1),
        x1 = Math.max(this.drag.x0, this.drag.x1),
        y0 = Math.min(this.drag.y0, this.drag.y1),
        y1 = Math.max(this.drag.y0, this.drag.y1);
      const squadIds = [];
      for (let i = 0; this.agents && i < this.agents.length; i++) {
        const agent = this.agents[i];
        if (
          agent.zoneCitizen &&
          !agent.dead &&
          agent.squadId !== null &&
          agent.x >= x0 &&
          agent.x <= x1 &&
          agent.y >= y0 &&
          agent.y <= y1 &&
          !squadIds.includes(agent.squadId)
        )
          squadIds.push(agent.squadId);
      }
      if (squadIds.length) {
        for (let i = 0; i < squadIds.length; i++)
          this._addSquadSelected(this.squads.at(squadIds[i]));
        this.selectedBuilding = null;
        return;
      }
      for (let i = 0; this.agents && i < this.agents.length; i++) {
        const agent = this.agents[i];
        if (
          !agent.zoneCitizen ||
          agent.dead ||
          agent.x < x0 ||
          agent.x > x1 ||
          agent.y < y0 ||
          agent.y > y1 ||
          agent.selected
        )
          continue;
        this._addSelected(agent);
      }
      if (this.selected.length) this.selectedBuilding = null;
    }

    _addSelected(agent) {
      if (!agent || agent.selected) return;
      agent.selected = true;
      this.selected.push(agent);
    }

    _addSquadSelected(squad) {
      if (!squad) return;
      for (let i = 0; i < squad.members.length; i++)
        this._addSelected(this.citizens.at(squad.members[i]));
    }

    _clearSelection() {
      for (let i = 0; i < this.selected.length; i++) this.selected[i].selected = false;
      this.selected.length = 0;
    }

    _removeSelected(agent) {
      agent.selected = false;
      const index = this.selected.indexOf(agent);
      if (index >= 0) this.selected.splice(index, 1);
    }

    _removeSquadSelected(squad) {
      if (!squad) return;
      for (let i = 0; i < squad.members.length; i++) {
        const member = this.citizens.at(squad.members[i]);
        if (member) this._removeSelected(member);
      }
    }

    _pruneSelection() {
      for (let i = this.selected.length - 1; i >= 0; i--)
        if (this.selected[i].dead || !this.selected[i].zoneCitizen) {
          this.selected[i].selected = false;
          this.selected.splice(i, 1);
          this.uiDirty = true;
        }
    }

    _selectedSquad() {
      const squads = this._selectedSquads();
      return squads.length === 1 ? squads[0] : null;
    }

    _selectedSquads() {
      const result = [];
      for (let i = 0; i < this.selected.length; i++) {
        const id = this.selected[i].squadId;
        if (id === null) continue;
        const squad = this.squads.at(id);
        if (squad && !result.includes(squad)) result.push(squad);
      }
      return result;
    }

    _squadIsSelected(squad) {
      if (!squad || !squad.members.length) return false;
      for (let i = 0; i < squad.members.length; i++) {
        const member = this.citizens.at(squad.members[i]);
        if (!member || !member.selected) return false;
      }
      return true;
    }

    _typingInControl(target) {
      if (!target || !target.tagName) return false;
      return (
        target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA"
      );
    }

    _cancelCommand() {
      this.commandMode = null;
      this.areaTargets.length = 0;
      this.gathering.clearPreview();
      this.fortifications.clearPreview();
      this.agriculture.clearPreview();
      document.getElementById("c").classList.remove("zone-commanding");
      this.ui.setCommandMode(null);
    }

    _assignControlGroup(index) {
      const squads = this._selectedSquads();
      if (!squads.length) {
        this.ui.toast("Selecciona escuadras antes de asignar un grupo de control.");
        return false;
      }
      const group = this.controlGroups[index];
      group.length = 0;
      for (let i = 0; i < squads.length; i++) group.push(squads[i].id);
      this.ui.toast(
        "Grupo de control " +
          index +
          " asignado a " +
          squads.length +
          " escuadra" +
          (squads.length === 1 ? "." : "s."),
      );
      this._markUI();
      return true;
    }

    _recallControlGroup(index) {
      const group = this.controlGroups[index],
        squads = [];
      for (let i = 0; i < group.length; i++) {
        const squad = this.squads.at(group[i]);
        if (squad) squads.push(squad);
      }
      if (!squads.length) {
        this.ui.toast("El grupo de control " + index + " está vacío.");
        return false;
      }
      this.squadRosterOpen = false;
      this._clearSelection();
      for (let i = 0; i < squads.length; i++) this._addSquadSelected(squads[i]);
      this.selectedBuilding = null;
      this._cancelCommand();
      this._refreshSelection();
      const now = performance.now();
      if (this.lastGroupKey === index && now - this.lastGroupT < 420) this._focusSquads(squads);
      this.lastGroupKey = index;
      this.lastGroupT = now;
      return true;
    }

    _focusSquads(squads) {
      const cam = ZS.debug && ZS.debug.cam;
      if (!cam || !squads.length) return false;
      let x = 0,
        y = 0,
        count = 0;
      for (let i = 0; i < squads.length; i++) {
        const leader = this.citizens.at(squads[i].members[0]);
        if (!leader) continue;
        x += leader.x;
        y += leader.y;
        count++;
      }
      if (!count) return false;
      cam.auto = false;
      cam.x = x / count;
      cam.y = y / count;
      cam.zoom = Math.max(cam.minZoom, 0.9);
      cam.clamp(window.innerWidth, window.innerHeight);
      return true;
    }

    _hoverAt(event) {
      const cam = ZS.debug && ZS.debug.cam;
      if (!cam || this.drag.active) return;
      const point = cam.toWorld(
          event.clientX,
          event.clientY,
          window.innerWidth,
          window.innerHeight,
        ),
        building = this.map.buildingAt(point.x, point.y),
        gatherJob = this.gathering.atPoint(point.x, point.y, cam.zoom),
        squads = this._selectedSquads();
      this.hoverBuilding = building;
      let hint = "Clic izq. seleccionar";
      if (this.commandMode && this.commandMode.startsWith("defense:")) {
        const value = this.commandMode.slice(8),
          kind = value === "remove" ? 0 : Number(value);
        this.fortifications.setPreview(point.x, point.y, kind);
        hint =
          value === "remove"
            ? "Clic para retirar esta defensa · clic der. cancela"
            : "Clic para colocar " + this.fortifications.label(kind) + " · clic der. cancela";
      } else if (this.commandMode && this.commandMode.startsWith("farm:")) {
        const value = this.commandMode.slice(5),
          kind = value === "remove" ? 0 : Number(value);
        this.agriculture.setPreview(point.x, point.y, kind);
        hint =
          value === "remove"
            ? "Clic para retirar este campo · clic der. cancela"
            : "Clic para preparar " + this.agriculture.label(kind) + " · clic der. cancela";
      } else if (this.commandMode && this.commandMode.startsWith("gather:"))
        hint = "Arrastra un área de " + this.gathering.label(Number(this.commandMode.slice(7)));
      else if (this.commandMode === "area")
        hint = "Arrastra para distribuir objetivos de saqueo · Shift añade";
      else if (this.commandMode === "attack") hint = "Clic para atacar y avanzar hasta aquí";
      else if (this.commandMode === "garrison")
        hint = building ? "Clic para guarnecer este edificio" : "Elige un edificio despejado";
      else if (squads.length)
        hint = building
          ? building === this.map.hq || building.looted
            ? "Clic der. guarnecer · Shift pone en cola"
            : "Clic der. saquear · Shift pone en cola"
          : "Clic der. mover · Shift pone en cola";
      else if (gatherJob)
        hint =
          "Clic para gestionar área de " +
          this.gathering.label(gatherJob.resource) +
          " · " +
          gatherJob.assigned.length +
          "/" +
          gatherJob.capacity +
          " trabajadores";
      else if (building)
        hint = "Clic izq. inspeccionar " + (building === this.map.hq ? "CG" : building.name);
      this.ui.showMapHint(hint, event.clientX, event.clientY);
    }

    _clearHover() {
      this.hoverBuilding = null;
      this.ui.hideMapHint();
    }

    _objectiveProgress() {
      let salvage = false,
        scouted = false,
        adapted = false;
      for (let i = 0; i < this.tasks.jobs.length; i++)
        if (
          this.tasks.jobs[i].type === CFG.JOB.SALVAGE ||
          this.tasks.jobs[i].type === CFG.JOB.GATHER
        ) {
          salvage = true;
          break;
        }
      for (let i = 0; i < this.map.records.length; i++) {
        const record = this.map.records[i];
        if (record !== this.map.hq && record.revealed) scouted = true;
        if (record !== this.map.hq && record.use !== CFG.BUILDING_USE.ABANDONED) adapted = true;
      }
      return {
        hq: Boolean(this.map.hq),
        salvage,
        scouted,
        adapted,
        survived: this.state.day > 1,
        campaignPending: Boolean(this.campaign.data.pending),
        cureStage: this.campaign.data.cureStage,
        campaignEnding: this.campaign.data.ending,
      };
    }

    _collectAlerts(stats) {
      const alerts = [],
        housing = this.adaptations.housingCapacity(),
        storage = this.adaptations.storageCapacity();
      let hungriest = null,
        stored = 0,
        unpowered = null,
        stalled = null;
      for (let i = 0; i < this.state.stock.length; i++) stored += this.state.stock[i];
      for (let i = 0; i < this.citizens.byId.length; i++) {
        const citizen = this.citizens.byId[i];
        if (!citizen || citizen.dead) continue;
        if (!hungriest || citizen.hunger > hungriest.hunger) hungriest = citizen;
      }
      for (let i = 0; i < this.map.records.length; i++) {
        const record = this.map.records[i],
          job = this.tasks.forBuilding(record.id);
        if (
          !unpowered &&
          record.use !== CFG.BUILDING_USE.ABANDONED &&
          record !== this.map.hq &&
          record.active &&
          record.hp > 0 &&
          record.powered === false &&
          [
            CFG.BUILDING_USE.COOKHOUSE,
            CFG.BUILDING_USE.WORKSHOP,
            CFG.BUILDING_USE.RESEARCH,
            CFG.BUILDING_USE.MEDBAY,
            CFG.BUILDING_USE.FARM,
            CFG.BUILDING_USE.BARN,
          ].includes(record.use)
        )
          unpowered = record;
        if (
          !stalled &&
          job &&
          job.type === CFG.JOB.PRODUCE &&
          (job.priority === CFG.PRIORITY.OFF || !this.adaptations.canProduce(record))
        )
          stalled = record;
      }
      if (hungriest && hungriest.hunger >= 72)
        alerts.push({
          kind: "food",
          title: "Hambre crítica",
          detail: "Habitante " + hungriest.cid + " · " + Math.round(hungriest.hunger) + "%",
          target: "citizen",
          id: hungriest.cid,
        });
      if (stats.population > housing)
        alerts.push({
          kind: "housing",
          title: "Falta alojamiento",
          detail: stats.population + " habitantes · " + housing + " plazas",
          target: "home",
          id: null,
        });
      if (storage > 0 && stored >= storage * 0.9)
        alerts.push({
          kind: "storage",
          title: "Almacén casi lleno",
          detail: stored + " / " + storage + " unidades",
          target: "home",
          id: null,
        });
      if (unpowered)
        alerts.push({
          kind: "power",
          title: "Edificio sin energía",
          detail: this.map.useLabel(unpowered.use),
          target: "building",
          id: unpowered.id,
        });
      if (stalled)
        alerts.push({
          kind: "production",
          title: "Producción detenida",
          detail: this.map.useLabel(stalled.use),
          target: "building",
          id: stalled.id,
        });
      for (let i = 0; i < this.squads.list.length; i++) {
        const squad = this.squads.list[i];
        if (squad.state === "encounter") {
          alerts.push({
            kind: "threat",
            title: "Patrulla en combate",
            detail: "Patrulla " + squad.id + " necesita atención",
            target: "squad",
            id: squad.id,
          });
          break;
        }
      }
      const warning = this.defense.warning();
      if (warning.active)
        alerts.push({
          kind: "threat",
          title: "Horda aproximándose",
          detail: warning.minutes + " min · desde " + warning.direction,
          target: "home",
          id: null,
        });
      if (this.defense.data.active)
        alerts.push({
          kind: "threat",
          title: "Ataque a la zona",
          detail: this.defense.status().remaining + " infectados restantes",
          target: "home",
          id: null,
        });
      if (this.campaign.data.pending)
        alerts.push({
          kind: "radio",
          title: "Transmisión pendiente",
          detail: "La campaña espera una decisión",
          target: "campaign",
          id: null,
        });
      return alerts.slice(0, 5);
    }

    _systemModel() {
      const citizens = [],
        useCounts = [],
        productionBuildings = [],
        stats = this.citizens.stats();
      for (let i = 0; i < this.citizens.byId.length; i++) {
        const citizen = this.citizens.byId[i];
        if (!citizen || citizen.dead) continue;
        citizens.push({
          id: citizen.cid,
          hp: citizen.hp,
          maxHP: citizen.maxHP,
          moral: citizen.moral,
          hunger: citizen.hunger,
          role: citizen.role,
          workerState: citizen.workerState,
          jobId: citizen.jobId,
          squadId: citizen.squadId,
          weapon: citizen.weapon,
          name: citizen.name,
          arrivalDay: citizen.arrivalDay,
        });
      }
      for (let use = CFG.BUILDING_USE.SHELTER; use <= CFG.BUILDING_USE.BARN; use++)
        useCounts.push({
          use,
          count: this.map.countUse(use),
          unlocked: this.adaptations.isUnlocked(use),
        });
      for (let i = 0; i < this.map.records.length; i++) {
        const record = this.map.records[i];
        if (
          [CFG.BUILDING_USE.COOKHOUSE, CFG.BUILDING_USE.FARM, CFG.BUILDING_USE.BARN].includes(
            record.use,
          )
        )
          productionBuildings.push(record);
      }
      return {
        enabled: Boolean(this.map.hq),
        stats,
        stock: this.state.stock,
        storage: this.adaptations.storageCapacity(),
        housing: this.adaptations.housingCapacity(),
        power: this.adaptations.power,
        citizens,
        squads: this.squads.list,
        jobs: this.tasks.jobs,
        useCounts,
        tech: this.state.zone.tech,
        research: this.adaptations.researchModel(),
        gathering: this.gathering.model(),
        fortificationCounts: this.fortifications.counts(),
        defense: this.defense.status(),
        regions: this.regions.model(this.squads.list.length),
        mapPackAvailable: Boolean(this.geo.pack),
        campaign: this.campaign.model(),
        agriculture: {
          weather: this.agriculture.weather(),
          fields: this.agriculture.list,
          buildings: productionBuildings,
          controller: this.agriculture,
          adaptations: this.adaptations,
        },
        selectedBuilding: this.selectedBuilding,
        selectedCanAdapt: Boolean(
          this.selectedBuilding &&
          this.map.reachable(this.selectedBuilding) &&
          this.selectedBuilding !== this.map.hq &&
          this.selectedBuilding.use === CFG.BUILDING_USE.ABANDONED &&
          this.selectedBuilding.revealed &&
          this.selectedBuilding.cleared &&
          !this.tasks.forBuilding(this.selectedBuilding.id),
        ),
      };
    }

    _refreshClock(force) {
      const stamp = this.state.day * 1440 + Math.floor(this.state.minute);
      if (!force && stamp === this.clockStamp) return;
      this.clockStamp = stamp;
      this.ui.refreshClock(this.state, Boolean(this.map.hq));
    }

    _refreshSettlement() {
      const stats = this.citizens.stats();
      this.ui.setMapIdentity(this.state.data.world);
      this.ui.refreshSettlement(
        stats,
        this.state.stock,
        Boolean(this.map.hq),
        this.adaptations,
        this.defense.status(),
      );
      this.alerts = this._collectAlerts(stats);
      this.ui.refreshAlerts(this.alerts, Boolean(this.map.hq));
      this.ui.setLayerState(this.mapLayers);
      this.ui.setSystemPanel(this.systemPanel, this._systemModel());
      this.ui.refreshObjectives(this._objectiveProgress());
    }

    _refreshSelection() {
      this.ui.refreshSquads(
        this.squads.list,
        this._selectedSquads(),
        this.squads,
        this.controlGroups,
        this.citizens,
      );
      this.ui.setRosterControl(Boolean(this.map.hq), this.squadRosterOpen);
      if (!this.map.hq) {
        this.ui.showSetup(this.selectedBuilding, this.map.suitableHQ(this.selectedBuilding));
        return;
      }
      if (this.squadRosterOpen) {
        this.ui.showRoster();
        return;
      }
      if (this.selected.length) {
        const squads = this._selectedSquads();
        let pending = 0;
        for (let i = 0; i < squads.length; i++)
          pending += Math.max(0, squads[i].orders.length - squads[i].orderIndex);
        this.ui.showAgents(this.selected, squads, pending, this.citizens, this.squads);
      } else if (this.selectedBuilding) {
        this.ui.showBuilding(
          this.selectedBuilding,
          this.selectedBuilding === this.map.hq,
          this.tasks.forBuilding(this.selectedBuilding.id),
          this.map,
          this.adaptations,
        );
      } else this.ui.showNone(true);
    }

    _markUI() {
      this.uiDirty = true;
      if (this.timeScale === 0 || this.paused) {
        this.uiDirty = false;
        this._refreshSettlement();
        this._refreshSelection();
      }
    }

    _capture() {
      if (!this.map.records.length) return;
      this.map.capture();
      this.squads.capture();
      this.citizens.capture();
      this.agriculture.capture();
      this.fortifications.capture();
      this.defense.capture();
      this.regions.capture();
    }

    /* Verification hooks call the same production command paths as the UI. */
    debugSelectBuilding(id) {
      this.squadRosterOpen = false;
      this._clearSelection();
      this.selectedBuilding = this.map.at(id);
      this._refreshSelection();
      return Boolean(this.selectedBuilding);
    }

    debugSelectSquad(id) {
      const squad = this.squads.at(id);
      if (!squad) return 0;
      this.squadRosterOpen = false;
      this._clearSelection();
      this._addSquadSelected(squad);
      this.selectedBuilding = null;
      this._refreshSelection();
      return this.selected.length;
    }

    debugSelectWorkers(count) {
      this.squadRosterOpen = false;
      this._clearSelection();
      for (let i = 0; i < this.citizens.byId.length && this.selected.length < count; i++) {
        const worker = this.citizens.byId[i];
        if (worker && worker.role === CFG.ROLE.WORKER && worker.jobId === null)
          this._addSelected(worker);
      }
      this.selectedBuilding = null;
      this._refreshSelection();
      return this.selected.length;
    }

    debugSelectAll() {
      const first = this.squads.list[0];
      return first ? this.debugSelectSquad(first.id) : 0;
    }

    debugIssueMove(x, y, append) {
      return this._issueOrder(x, y, Boolean(append));
    }

    debugIssueScavengeArea(x0, y0, x1, y1, append) {
      return this._issueScavengeArea({ x0, y0, x1, y1 }, Boolean(append));
    }

    debugCreateSalvage(id, priority) {
      this.debugSelectBuilding(id);
      const job = this.tasks.postSalvage(id, priority);
      this._markUI();
      return job ? job.id : null;
    }

    debugSetPatrol(id, points, loop) {
      return this.squads.setPatrol(this.squads.at(id), points, loop);
    }

    debugPlaceFortification(x, y, kind) {
      return this.fortifications.place(x, y, kind);
    }

    debugPlaceField(x, y, kind) {
      return this.agriculture.place(x, y, kind);
    }

    debugIssueAttackMove(x, y, append) {
      return this._issueAttackMove(x, y, Boolean(append));
    }

    debugIssueGarrison(x, y, append) {
      return this._issueGarrison(x, y, Boolean(append));
    }

    debugRetreat() {
      return this.retreatSelectedSquads();
    }
  }

  ZS.ScenarioZone = ScenarioZone;
})();
