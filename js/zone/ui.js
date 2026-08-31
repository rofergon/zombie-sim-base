/* Persistent, low-frequency DOM controls for the Zone. Canvas owns the map;
   this panel only reflects state and calls scenario command methods. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});
  const CFG = ZS.ZoneConfig;
  const R = CFG.RESOURCE;

  const ROLE_LABEL = Object.freeze({
    [CFG.ROLE.WORKER]: "trabajador",
    [CFG.ROLE.SQUAD]: "miembro de escuadra",
    [CFG.ROLE.INJURED]: "herido",
    [CFG.ROLE.DEAD]: "muerto",
  });
  const WORK_LABEL = Object.freeze({
    [CFG.WORKER_STATE.IDLE]: "en espera",
    [CFG.WORKER_STATE.TO_JOB]: "yendo al trabajo",
    [CFG.WORKER_STATE.WORKING]: "trabajando",
    [CFG.WORKER_STATE.RETURNING]: "regresando a la base",
    [CFG.WORKER_STATE.RESTING]: "descansando",
  });
  const PHASE_LABEL = Object.freeze({
    dawn: "amanecer",
    day: "día",
    dusk: "crepúsculo",
    night: "noche",
  });
  const RESOURCE_LABEL = Object.freeze([
    "comida",
    "madera",
    "metal",
    "ladrillo",
    "munición",
    "medicina",
    "ciencia",
  ]);
  const RESOURCE_ICON = Object.freeze([
    "zi-food",
    "zi-wood",
    "zi-metal",
    "zi-brick",
    "zi-ammo",
    "zi-medicine",
    "zi-science",
  ]);
  const USE_LABEL = Object.freeze({
    [CFG.BUILDING_USE.SHELTER]: "refugio",
    [CFG.BUILDING_USE.WAREHOUSE]: "almacén",
    [CFG.BUILDING_USE.COOKHOUSE]: "cocina",
    [CFG.BUILDING_USE.WORKSHOP]: "taller de munición",
    [CFG.BUILDING_USE.RESEARCH]: "centro de investigación",
    [CFG.BUILDING_USE.MEDBAY]: "enfermería",
    [CFG.BUILDING_USE.SQUAD_QUARTERS]: "cuartel de patrullas",
    [CFG.BUILDING_USE.FARM]: "granja en azotea",
    [CFG.BUILDING_USE.POWER]: "generador",
  });
  const TECH_LABEL = Object.freeze({
    [CFG.TECH.AGRICULTURE]: "Agricultura",
    [CFG.TECH.POWER]: "Energía",
    [CFG.TECH.FORTIFICATIONS]: "Fortificaciones",
    [CFG.TECH.MEDICINE]: "Medicina mejorada",
  });
  const SYSTEM_META = Object.freeze({
    build: ["Construcción", "zi-build"],
    citizens: ["Habitantes", "zi-worker"],
    research: ["Investigación", "zi-research"],
    economy: ["Economía", "zi-production"],
    laws: ["Leyes", "zi-laws"],
    radio: ["Radio", "zi-radio"],
    expedition: ["Expediciones", "zi-expedition"],
    defense: ["Defensa", "zi-threat"],
  });
  const SQUAD_STATE_LABEL = Object.freeze({
    idle: "en espera",
    "moving to scavenge": "yendo a saquear",
    encounter: "encuentro",
    scavenging: "saqueando",
    returning: "regresando",
    patrolling: "patrullando",
    "attack moving": "avanzando y combatiendo",
    "holding fire line": "manteniendo la línea",
    "moving to garrison": "yendo a guarnecer",
    garrisoned: "guarnecida",
    retreating: "retirada de emergencia",
    "resuming scavenge": "reanudando saqueo",
    "loot left for another loadout": "botín restante",
  });

  class ZoneUI {
    constructor(root) {
      this.root = root;
      this.callbacks = null;
      this.root.innerHTML =
        `
        <header class="zone-topbar">
          <section id="zone-settlement" class="zone-ledger" hidden aria-label="recursos del asentamiento">
            <button class="zone-metric zone-population" type="button" data-system="citizens" data-tip="Población viva y estado de la fuerza laboral">
              <span class="zone-icon zi-pop" aria-hidden="true"></span><span class="zone-metric-copy"><small>habitantes</small><b id="zone-pop">0</b></span>
            </button>
            <button class="zone-metric" type="button" data-system="economy" data-tip="Comida almacenada · la flecha muestra la tendencia reciente">
              <span class="zone-icon zi-food" aria-hidden="true"></span><span class="zone-metric-copy"><small>comida</small><b id="zone-food">0</b></span><i data-trend="0">•</i>
            </button>
            <button class="zone-metric" type="button" data-system="economy" data-tip="Madera para construcción y reparaciones">
              <span class="zone-icon zi-wood" aria-hidden="true"></span><span class="zone-metric-copy"><small>madera</small><b id="zone-wood">0</b></span><i data-trend="1">•</i>
            </button>
            <button class="zone-metric" type="button" data-system="economy" data-tip="Metal para talleres, munición y energía">
              <span class="zone-icon zi-metal" aria-hidden="true"></span><span class="zone-metric-copy"><small>metal</small><b id="zone-metal">0</b></span><i data-trend="2">•</i>
            </button>
            <button class="zone-metric" type="button" data-system="economy" data-tip="Ladrillo para adaptar y reparar edificios">
              <span class="zone-icon zi-brick" aria-hidden="true"></span><span class="zone-metric-copy"><small>ladrillo</small><b id="zone-brick">0</b></span><i data-trend="3">•</i>
            </button>
            <button class="zone-metric" type="button" data-system="economy" data-tip="Munición compartida en el asentamiento">
              <span class="zone-icon zi-ammo" aria-hidden="true"></span><span class="zone-metric-copy"><small>munición</small><b id="zone-ammo">0</b></span><i data-trend="4">•</i>
            </button>
            <button class="zone-metric" type="button" data-system="economy" data-tip="Medicina para patrullas y enfermerías">
              <span class="zone-icon zi-medicine" aria-hidden="true"></span><span class="zone-metric-copy"><small>medicina</small><b id="zone-medicine">0</b></span><i data-trend="5">•</i>
            </button>
            <button class="zone-metric" type="button" data-system="research" data-tip="Ciencia recuperada en bibliotecas">
              <span class="zone-icon zi-science" aria-hidden="true"></span><span class="zone-metric-copy"><small>ciencia</small><b id="zone-science">0</b></span><i data-trend="6">•</i>
            </button>
            <button class="zone-metric zone-utility" type="button" data-system="economy" data-tip="Energía utilizada frente a la capacidad de la red">
              <span class="zone-icon zi-power" aria-hidden="true"></span><span class="zone-metric-copy"><small>energía</small><b id="zone-power">0/1</b></span>
            </button>
            <button class="zone-metric zone-utility" type="button" data-system="citizens" data-tip="Población frente a plazas de alojamiento">
              <span class="zone-icon zi-housing" aria-hidden="true"></span><span class="zone-metric-copy"><small>alojamiento</small><b id="zone-housing">0</b></span>
            </button>
            <span class="zone-storage" data-tip="Ocupación total estimada de almacenes"><span class="zone-icon zi-storage" aria-hidden="true"></span><b id="zone-storage">0/0</b></span>
            <span class="zone-workforce"><b id="zone-free">0</b> libres · <b id="zone-assigned">0</b> asignados · <b id="zone-moral">0</b>% moral</span>
          </section>
          <section class="zone-clock" aria-label="reloj de simulación">
            <div class="zone-clock-line"><span id="zone-day">DÍA 1</span><strong id="zone-time">07:00</strong><span id="zone-phase">AMANECER</span></div>
            <div class="zone-speeds" aria-label="velocidad de simulación">
              <button type="button" data-speed="0" data-tip="Pausar">Ⅱ</button><button type="button" data-speed="1" data-tip="Velocidad normal">×1</button><button type="button" data-speed="2" data-tip="Velocidad doble">×2</button><button type="button" data-speed="4" data-tip="Velocidad cuádruple">×4</button>
            </div>
          </section>
          <section id="zone-alerts" class="zone-alert-strip" hidden aria-label="alertas del asentamiento"></section>
        </header>` +
        '<aside class="zone-panel zone-missions"><h1>LA ZONA</h1><p id="zone-map-identity" class="zone-map-identity">Distrito procedural</p>' +
        '<p id="zone-objective" class="zone-objective">Asegura un cuartel general y prepara el distrito.</p>' +
        '<ol id="zone-objectives" class="zone-objectives">' +
        '<li data-objective="hq">Elige el cuartel general</li>' +
        '<li data-objective="salvage">Asigna trabajadores al desguace</li>' +
        '<li data-objective="scouted">Explora y limpia un edificio</li>' +
        '<li data-objective="adapted">Adapta un edificio despejado</li>' +
        '<li data-objective="survived">Sobrevive a la primera noche</li>' +
        "</ol>" +
        '<span id="zone-night-status" class="zone-night-status">vigilancia nocturna pendiente</span>' +
        '<button id="zone-home" class="zone-home" type="button">⌂ centrar en candidato</button>' +
        '<button id="zone-reset" class="zone-reset" type="button">↻ nueva zona</button>' +
        "</aside>" +
        '<button id="zone-roster-toggle" class="zone-roster-toggle" type="button" hidden aria-expanded="false" aria-controls="zone-squad-list"><span class="zone-icon zi-squads" aria-hidden="true"></span> PATRULLAS <b id="zone-roster-toggle-count">0</b></button>' +
        '<aside class="zone-panel zone-inspector" hidden>' +
        '<section class="zone-roster" hidden><header><strong>PATRULLAS DE CAMPO</strong><span id="zone-squad-count">0</span></header>' +
        '<div id="zone-squad-list" class="zone-squad-list"><p>No hay patrullas listas.</p></div></section>' +
        '<section class="zone-card" hidden><h2 id="zone-selection-title">Sin selección</h2>' +
        '<div id="zone-selection-visual" class="zone-selection-visual" hidden></div>' +
        '<p id="zone-selection-meta">Haz clic en un edificio o superviviente.</p>' +
        '<p id="zone-selection-detail" class="zone-detail"></p><div id="zone-member-detail" class="zone-member-detail" hidden></div>' +
        '<button id="zone-hq-action" type="button" hidden>Establecer base aquí</button>' +
        '<div id="zone-job-actions" hidden>' +
        '<button id="zone-salvage" type="button">Crear tarea de desguace</button>' +
        '<button id="zone-cancel-job" type="button" hidden>Cancelar desguace</button>' +
        '<label>prioridad <select id="zone-priority"><option value="0">desactivada</option><option value="1">baja</option><option value="2">normal</option><option value="3">alta</option></select></label>' +
        "</div>" +
        '<div id="zone-squad-actions" hidden>' +
        '<button id="zone-create-squad" type="button">Crear escuadra</button>' +
        '<button id="zone-return" type="button">Regresar a la base</button>' +
        '<button id="zone-patrol" type="button">Patrulla en bucle</button>' +
        '<button id="zone-disband" type="button">Disolver en la base</button>' +
        "</div>" +
        '<div id="zone-adapt-actions" hidden>' +
        '<select id="zone-adapt-use" aria-label="adaptación del edificio">' +
        '<option value="2">refugio · M12 L8</option>' +
        '<option value="3">almacén · M10 Me4 L8</option>' +
        '<option value="4">cocina · M10 Me6 L6</option>' +
        '<option value="5">taller de munición · M12 Me10 L4</option>' +
        '<option value="6">centro de investigación · M12 Me8 L8</option>' +
        '<option value="7">enfermería · M10 Me6 L8</option>' +
        '<option value="8">cuartel de escuadra · M16 Me8 L8</option>' +
        '<option value="9">granja en azotea · requiere investigación</option>' +
        '<option value="10">generador · requiere investigación</option>' +
        "</select>" +
        '<button id="zone-adapt" type="button">Adaptar edificio</button>' +
        '<button id="zone-toggle-building" type="button">Pausar operación</button>' +
        '<button id="zone-repair-building" type="button">Reparar</button>' +
        '<div id="zone-research-actions" hidden>' +
        '<button type="button" data-tech="1">Agricultura · C8</button>' +
        '<button type="button" data-tech="2">Energía · C10</button>' +
        '<button type="button" data-tech="3">Fortificaciones · C12</button>' +
        '<button type="button" data-tech="4">Medicina · C8</button>' +
        "</div>" +
        "</div></section>" +
        "</aside>" +
        '<nav class="zone-main-dock" hidden aria-label="menú principal">' +
        '<button type="button" data-system="build" data-tip="Construcción y adaptación"><span class="zone-icon zi-build"></span><small>construir</small></button>' +
        '<button type="button" data-main-action="scavenge" data-tip="Marcar una zona de saqueo"><span class="zone-icon zi-scavenge"></span><small>saquear</small></button>' +
        '<button type="button" data-system="citizens" data-tip="Habitantes y trabajo"><span class="zone-icon zi-worker"></span><small>habitantes</small></button>' +
        '<button type="button" data-main-action="squads" data-tip="Patrullas de campo"><span class="zone-icon zi-squads"></span><small>patrullas</small></button>' +
        '<button type="button" data-system="research" data-tip="Árbol de investigación"><span class="zone-icon zi-research"></span><small>investigar</small></button>' +
        '<button type="button" data-system="defense" data-tip="Fortificaciones y defensa activa"><span class="zone-icon zi-threat"></span><small>defender</small></button>' +
        '<div class="zone-system-shortcuts">' +
        '<button type="button" data-system="economy" data-tip="Economía"><span class="zone-icon zi-production"></span></button>' +
        '<button type="button" data-system="laws" data-tip="Leyes"><span class="zone-icon zi-laws"></span></button>' +
        '<button type="button" data-system="radio" data-tip="Radio y transmisiones"><span class="zone-icon zi-radio"></span></button>' +
        '<button type="button" data-system="expedition" data-tip="Expediciones"><span class="zone-icon zi-expedition"></span></button>' +
        "</div></nav>" +
        '<aside class="zone-system-panel" hidden aria-label="panel de sistema"><header><span id="zone-system-icon" class="zone-icon zi-build"></span><div><small>SISTEMA</small><h2 id="zone-system-title">Construcción</h2></div><button id="zone-system-close" type="button" aria-label="cerrar">×</button></header><div id="zone-system-body" class="zone-system-body"></div></aside>' +
        '<nav class="zone-layer-tools" hidden aria-label="capas del mapa"><button id="zone-layer-toggle" type="button" data-tip="Capas y filtros"><span class="zone-icon zi-layers"></span></button><div class="zone-layer-menu" hidden>' +
        '<button type="button" data-layer="full"><span class="zone-icon zi-layers"></span><small>info completa</small></button>' +
        '<button type="button" data-layer="loot"><span class="zone-icon zi-loot"></span><small>botín / POI</small></button>' +
        '<button type="button" data-layer="adapted"><span class="zone-icon zi-adapt"></span><small>adaptados</small></button>' +
        '<button type="button" data-layer="production"><span class="zone-icon zi-production"></span><small>producción</small></button>' +
        '<button type="button" data-layer="priorities"><span class="zone-icon zi-priority"></span><small>prioridades</small></button>' +
        '<button type="button" data-layer="threats"><span class="zone-icon zi-threat"></span><small>amenazas</small></button>' +
        '<button type="button" data-layer="power"><span class="zone-icon zi-power"></span><small>energía</small></button>' +
        '<button type="button" data-layer="ranges"><span class="zone-icon zi-squads"></span><small>alcances</small></button>' +
        '<button type="button" data-layer="defenses"><span class="zone-icon zi-threat"></span><small>defensas</small></button>' +
        "</div></nav>" +
        '<nav class="zone-command-bar" aria-label="órdenes de la escuadra seleccionada" hidden>' +
        '<button id="zone-arm-order" type="button"><b>RMB</b><span>mover / actuar</span></button>' +
        '<button id="zone-area-scavenge" type="button"><b>V</b><span>saquear zona</span></button>' +
        '<button id="zone-stop" type="button"><b>S</b><span>mantener</span></button>' +
        '<button id="zone-command-return" type="button"><b>H</b><span>regresar a base</span></button>' +
        '<button id="zone-command-patrol" type="button"><b>P</b><span>repetir ruta</span></button>' +
        '<button id="zone-attack" type="button"><b>A</b><span>atacar / avanzar</span></button>' +
        '<button id="zone-garrison" type="button"><b>G</b><span>guarnecer</span></button>' +
        '<button id="zone-retreat" type="button"><b>R</b><span>retirada</span></button>' +
        "<p><b>LMB</b> seleccionar · <b>Ctrl+LMB</b> varias · <b>Shift+RMB</b> poner en cola<br><b>Espacio+arrastre</b> desplazar · <b>rueda</b> zoom · <b>Ctrl+1–9</b> grupo</p>" +
        "</nav>" +
        '<p id="zone-toast" class="zone-toast" aria-live="polite"></p>' +
        '<p id="zone-map-hint" class="zone-map-hint" hidden></p>' +
        '<a id="zone-osm-credit" class="zone-osm-credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" hidden>© OpenStreetMap contributors · ODbL</a>';
      const q = (selector) => root.querySelector(selector);
      this.day = q("#zone-day");
      this.time = q("#zone-time");
      this.phase = q("#zone-phase");
      this.objective = q("#zone-objective");
      this.title = q("#zone-selection-title");
      this.selectionVisual = q("#zone-selection-visual");
      this.meta = q("#zone-selection-meta");
      this.detail = q("#zone-selection-detail");
      this.memberDetail = q("#zone-member-detail");
      this.hqAction = q("#zone-hq-action");
      this.jobActions = q("#zone-job-actions");
      this.salvage = q("#zone-salvage");
      this.cancelJob = q("#zone-cancel-job");
      this.priority = q("#zone-priority");
      this.squadActions = q("#zone-squad-actions");
      this.createSquad = q("#zone-create-squad");
      this.returnButton = q("#zone-return");
      this.patrol = q("#zone-patrol");
      this.disband = q("#zone-disband");
      this.adaptActions = q("#zone-adapt-actions");
      this.adaptUse = q("#zone-adapt-use");
      this.adapt = q("#zone-adapt");
      this.toggleBuilding = q("#zone-toggle-building");
      this.repairBuilding = q("#zone-repair-building");
      this.researchActions = q("#zone-research-actions");
      this.home = q("#zone-home");
      this.reset = q("#zone-reset");
      this.toastEl = q("#zone-toast");
      this.ledger = q("#zone-settlement");
      this.population = q("#zone-pop");
      this.free = q("#zone-free");
      this.assigned = q("#zone-assigned");
      this.moral = q("#zone-moral");
      this.resourceEls = [
        q("#zone-food"),
        q("#zone-wood"),
        q("#zone-metal"),
        q("#zone-brick"),
        q("#zone-ammo"),
        q("#zone-medicine"),
        q("#zone-science"),
      ];
      this.power = q("#zone-power");
      this.housing = q("#zone-housing");
      this.storage = q("#zone-storage");
      this.trendEls = root.querySelectorAll("[data-trend]");
      this.lastStock = Array.from({ length: R.COUNT }, () => 0);
      this.stockTrend = Array.from({ length: R.COUNT }, () => 0);
      this.stockSampleT = 0;
      this.nightStatus = q("#zone-night-status");
      this.objectives = root.querySelectorAll("[data-objective]");
      this.squadCount = q("#zone-squad-count");
      this.squadList = q("#zone-squad-list");
      this.rosterToggle = q("#zone-roster-toggle");
      this.rosterToggleCount = q("#zone-roster-toggle-count");
      this.inspector = q(".zone-inspector");
      this.roster = q(".zone-roster");
      this.card = q(".zone-card");
      this.commandBar = q(".zone-command-bar");
      this.armOrder = q("#zone-arm-order");
      this.areaScavenge = q("#zone-area-scavenge");
      this.stop = q("#zone-stop");
      this.commandReturn = q("#zone-command-return");
      this.commandPatrol = q("#zone-command-patrol");
      this.attack = q("#zone-attack");
      this.garrison = q("#zone-garrison");
      this.retreat = q("#zone-retreat");
      this.mapHint = q("#zone-map-hint");
      this.mapIdentity = q("#zone-map-identity");
      this.osmCredit = q("#zone-osm-credit");
      this.alertStrip = q("#zone-alerts");
      this.alertSignature = "";
      this.mainDock = q(".zone-main-dock");
      this.systemPanel = q(".zone-system-panel");
      this.systemTitle = q("#zone-system-title");
      this.systemIcon = q("#zone-system-icon");
      this.systemBody = q("#zone-system-body");
      this.systemClose = q("#zone-system-close");
      this.layerTools = q(".zone-layer-tools");
      this.layerToggle = q("#zone-layer-toggle");
      this.layerMenu = q(".zone-layer-menu");
      this.systemName = null;
      this.systemSignature = "";
      this.speedButtons = root.querySelectorAll("[data-speed]");
      for (const button of this.speedButtons)
        button.addEventListener("click", () => {
          if (this.callbacks) this.callbacks.speed(Number(button.dataset.speed));
        });
      this.hqAction.addEventListener("click", () => this.callbacks && this.callbacks.establishHQ());
      this.home.addEventListener("click", () => this.callbacks && this.callbacks.home());
      this.reset.addEventListener("click", () => this.callbacks && this.callbacks.reset());
      this.salvage.addEventListener("click", () => this.callbacks && this.callbacks.salvage());
      this.cancelJob.addEventListener("click", () => this.callbacks && this.callbacks.cancelJob());
      this.priority.addEventListener(
        "change",
        () => this.callbacks && this.callbacks.priority(Number(this.priority.value)),
      );
      this.createSquad.addEventListener(
        "click",
        () => this.callbacks && this.callbacks.createSquad(),
      );
      this.returnButton.addEventListener(
        "click",
        () => this.callbacks && this.callbacks.returnHQ(),
      );
      this.patrol.addEventListener("click", () => this.callbacks && this.callbacks.patrol());
      this.disband.addEventListener("click", () => this.callbacks && this.callbacks.disband());
      this.armOrder.addEventListener("click", () => this.callbacks && this.callbacks.armOrder());
      this.areaScavenge.addEventListener("click", () => this.callbacks && this.callbacks.armArea());
      this.stop.addEventListener("click", () => this.callbacks && this.callbacks.stop());
      this.commandReturn.addEventListener(
        "click",
        () => this.callbacks && this.callbacks.returnHQ(),
      );
      this.commandPatrol.addEventListener("click", () => this.callbacks && this.callbacks.patrol());
      this.attack.addEventListener("click", () => this.callbacks && this.callbacks.armAttack());
      this.garrison.addEventListener("click", () => this.callbacks && this.callbacks.armGarrison());
      this.retreat.addEventListener("click", () => this.callbacks && this.callbacks.retreat());
      this.rosterToggle.addEventListener(
        "click",
        () => this.callbacks && this.callbacks.toggleRoster(),
      );
      this.squadList.addEventListener("click", (event) => {
        const focus = event.target.closest("[data-focus-squad]"),
          select = event.target.closest("[data-select-squad]");
        if (focus && this.callbacks) this.callbacks.focusSquad(Number(focus.dataset.focusSquad));
        else if (select && this.callbacks)
          this.callbacks.selectSquad(
            Number(select.dataset.selectSquad),
            event.ctrlKey || event.metaKey || event.shiftKey,
          );
      });
      this.adapt.addEventListener(
        "click",
        () => this.callbacks && this.callbacks.adapt(Number(this.adaptUse.value)),
      );
      this.toggleBuilding.addEventListener(
        "click",
        () => this.callbacks && this.callbacks.toggleBuilding(),
      );
      this.repairBuilding.addEventListener(
        "click",
        () => this.callbacks && this.callbacks.repairBuilding(),
      );
      for (const button of this.researchActions.querySelectorAll("[data-tech]"))
        button.addEventListener(
          "click",
          () => this.callbacks && this.callbacks.research(Number(button.dataset.tech)),
        );
      this.systemClose.addEventListener(
        "click",
        () => this.callbacks && this.callbacks.closeSystem(),
      );
      this.layerToggle.addEventListener("click", () => {
        this.layerMenu.hidden = !this.layerMenu.hidden;
        this.layerToggle.classList.toggle("on", !this.layerMenu.hidden);
      });
      this.root.addEventListener("click", (event) => {
        const system = event.target.closest("[data-system]"),
          action = event.target.closest("[data-main-action]"),
          layer = event.target.closest("[data-layer]"),
          alert = event.target.closest("[data-alert-index]"),
          citizen = event.target.closest("[data-focus-citizen]"),
          research = event.target.closest("[data-system-tech]"),
          adapt = event.target.closest("[data-system-adapt-submit]"),
          defenseBuild = event.target.closest("[data-defense-build]"),
          defenseRemove = event.target.closest("[data-defense-remove]"),
          expedition = event.target.closest("[data-expedition-region]"),
          exportMap = event.target.closest("[data-export-map]"),
          campaignChoice = event.target.closest("[data-campaign-choice]"),
          campaignResearch = event.target.closest("[data-campaign-research]"),
          campaignTrade = event.target.closest("[data-campaign-trade]"),
          campaignLaw = event.target.closest("[data-campaign-law]");
        if (system && this.callbacks) this.callbacks.openSystem(system.dataset.system);
        else if (action && this.callbacks) {
          if (action.dataset.mainAction === "scavenge") this.callbacks.armArea();
          else if (action.dataset.mainAction === "squads") this.callbacks.toggleRoster();
        } else if (layer && this.callbacks) this.callbacks.toggleLayer(layer.dataset.layer);
        else if (alert && this.callbacks)
          this.callbacks.focusAlert(Number(alert.dataset.alertIndex));
        else if (citizen && this.callbacks)
          this.callbacks.focusCitizen(Number(citizen.dataset.focusCitizen));
        else if (research && this.callbacks)
          this.callbacks.research(Number(research.dataset.systemTech));
        else if (adapt && this.callbacks) {
          const select = this.root.querySelector("[data-system-adapt]");
          if (select) this.callbacks.adapt(Number(select.value));
        } else if (defenseBuild && this.callbacks)
          this.callbacks.armDefense(Number(defenseBuild.dataset.defenseBuild));
        else if (defenseRemove && this.callbacks) this.callbacks.armDefense(0);
        else if (expedition && this.callbacks)
          this.callbacks.expedition(expedition.dataset.expeditionRegion);
        else if (exportMap && this.callbacks) this.callbacks.exportMap();
        else if (campaignChoice && this.callbacks)
          this.callbacks.campaignChoice(
            campaignChoice.dataset.campaignEvent,
            campaignChoice.dataset.campaignChoice,
          );
        else if (campaignResearch && this.callbacks) this.callbacks.campaignResearch();
        else if (campaignTrade && this.callbacks)
          this.callbacks.campaignTrade(Number(campaignTrade.dataset.campaignTrade));
        else if (campaignLaw && this.callbacks)
          this.callbacks.campaignLaw(Number(campaignLaw.dataset.campaignLaw));
      });
    }

    connect(callbacks) {
      this.callbacks = callbacks;
    }

    setMapIdentity(world) {
      this.mapIdentity.textContent =
        (world.name || "Distrito procedural") + " · " + (world.size || "classic");
      this.osmCredit.hidden = world.source !== "osm";
      this.osmCredit.textContent = world.elevationSource
        ? "© OpenStreetMap contributors · ODbL · relieve: " + world.elevationSource
        : "© OpenStreetMap contributors · ODbL";
    }

    refreshClock(state, enabled) {
      this.day.textContent = "DÍA " + state.day;
      this.time.textContent = state.clockText();
      this.phase.textContent = (PHASE_LABEL[state.phase()] || state.phase()).toUpperCase();
      const active = state.paused ? 0 : state.speed;
      for (const button of this.speedButtons) {
        const speed = Number(button.dataset.speed);
        button.classList.toggle("on", speed === active);
        button.disabled = !enabled && speed !== 0;
      }
    }

    refreshSettlement(stats, stock, enabled, adaptations, defense) {
      this.ledger.hidden = !enabled;
      this.mainDock.hidden = !enabled;
      this.layerTools.hidden = !enabled;
      if (!enabled) return;
      this.population.textContent = stats.population;
      this.free.textContent = stats.free;
      this.assigned.textContent = stats.assigned;
      this.moral.textContent = Math.round(stats.moral);
      for (let i = 0; i < this.resourceEls.length; i++) this.resourceEls[i].textContent = stock[i];
      this.power.textContent = adaptations.power.used + "/" + adaptations.power.capacity;
      const housing = adaptations.housingCapacity(),
        capacity = adaptations.storageCapacity();
      let stored = 0;
      for (let i = 0; i < stock.length; i++) stored += stock[i];
      this.housing.textContent = stats.population + "/" + housing;
      this.storage.textContent = stored + "/" + capacity;
      this.storage.parentElement.classList.toggle(
        "warning",
        capacity > 0 && stored >= capacity * 0.9,
      );
      const now = performance.now();
      if (!this.stockSampleT) {
        this.stockSampleT = now;
        for (let i = 0; i < stock.length; i++) this.lastStock[i] = stock[i];
      } else if (now - this.stockSampleT >= 1800) {
        this.stockSampleT = now;
        for (let i = 0; i < stock.length; i++) {
          this.stockTrend[i] = Math.sign(stock[i] - this.lastStock[i]);
          this.lastStock[i] = stock[i];
        }
      }
      for (const el of this.trendEls) {
        const trend = this.stockTrend[Number(el.dataset.trend)] || 0;
        el.textContent = trend > 0 ? "↑" : trend < 0 ? "↓" : "•";
        el.classList.toggle("up", trend > 0);
        el.classList.toggle("down", trend < 0);
      }
      this.nightStatus.textContent = defense.active
        ? "HORDA DESDE " +
          defense.direction.toUpperCase() +
          " · " +
          defense.remaining +
          " restantes · CG " +
          defense.hqHP +
          "/" +
          defense.hqMaxHP
        : defense.warning.active
          ? "ALERTA · " +
            defense.warning.minutes +
            " MIN · AMENAZA DESDE " +
            defense.warning.direction.toUpperCase()
          : "vigilancia nocturna lista · CG " + defense.hqHP + "/" + defense.hqMaxHP;
      this.nightStatus.classList.toggle("active", defense.active || defense.warning.active);
    }

    refreshObjectives(progress) {
      let activeFound = false;
      for (const item of this.objectives) {
        const complete = Boolean(progress[item.dataset.objective]);
        item.classList.toggle("done", complete);
        const active = !complete && !activeFound;
        item.classList.toggle("active", active);
        if (active) activeFound = true;
      }
      if (!progress.hq)
        this.objective.textContent = "Elige un edificio existente para establecer la primera base.";
      else if (!progress.salvage)
        this.objective.textContent =
          "Selecciona un edificio abandonado y asigna trabajadores al desguace.";
      else if (!progress.scouted)
        this.objective.textContent =
          "Selecciona una escuadra y haz clic derecho en un edificio para registrarlo.";
      else if (!progress.adapted)
        this.objective.textContent = "Despeja un edificio y adáptalo para el asentamiento.";
      else if (!progress.survived)
        this.objective.textContent = "Trae las escuadras antes de la noche y defiende la base.";
      else if (progress.campaignPending)
        this.objective.textContent = "La radio espera una decisión. Abre la transmisión pendiente.";
      else if (!progress.campaignEnding && progress.cureStage < CFG.CURE_STAGE.FORMULA)
        this.objective.textContent =
          "Proyecto Aurora: desarrolla la cura y mantén unida a la red de supervivientes.";
      else if (!progress.campaignEnding)
        this.objective.textContent = "La fórmula está lista. Decide qué futuro tendrá La Zona.";
      else
        this.objective.textContent =
          "La campaña ha terminado, pero La Zona puede seguir creciendo indefinidamente.";
    }

    refreshAlerts(alerts, enabled) {
      this.alertStrip.hidden = !enabled || !alerts.length;
      const icon = {
        food: "zi-food",
        housing: "zi-housing",
        storage: "zi-storage",
        power: "zi-power",
        production: "zi-production",
        threat: "zi-threat",
        radio: "zi-radio",
      };
      for (let i = 0; i < alerts.length; i++) {
        const alert = alerts[i];
        let button = this.alertStrip.children[i];
        if (!button) {
          button = document.createElement("button");
          const pictogram = document.createElement("span"),
            copy = document.createElement("span"),
            title = document.createElement("b"),
            detail = document.createElement("small");
          button.type = "button";
          copy.append(title, detail);
          button.append(pictogram, copy);
          this.alertStrip.appendChild(button);
        }
        button.dataset.alertIndex = i;
        button.title = "Centrar en el problema";
        const pictogram = button.firstElementChild,
          title = button.querySelector("b"),
          detail = button.querySelector("small");
        pictogram.className = "zone-icon " + (icon[alert.kind] || "zi-threat");
        title.textContent = alert.title;
        detail.textContent = alert.detail;
      }
      while (this.alertStrip.children.length > alerts.length)
        this.alertStrip.lastElementChild.remove();
    }

    setLayerState(layers) {
      for (const button of this.root.querySelectorAll("[data-layer]"))
        button.classList.toggle("on", Boolean(layers[button.dataset.layer]));
    }

    setSystemPanel(name, model) {
      this.systemName = name;
      this.systemPanel.hidden = !name || !model.enabled;
      for (const button of this.root.querySelectorAll("[data-system]"))
        button.classList.toggle("on", Boolean(name && button.dataset.system === name));
      if (this.systemPanel.hidden) return;
      const meta = SYSTEM_META[name] || ["Sistema", "zi-build"];
      this.systemTitle.textContent = meta[0];
      this.systemIcon.className = "zone-icon " + meta[1];
      let signatureData = [name];
      if (name === "build")
        signatureData = [
          name,
          model.useCounts,
          model.selectedBuilding && model.selectedBuilding.id,
          model.selectedCanAdapt,
        ];
      else if (name === "citizens")
        signatureData = [
          name,
          model.stats.population,
          model.stats.free,
          model.stats.assigned,
          Math.round(model.stats.moral),
          model.citizens.map((citizen) => [
            citizen.id,
            Math.ceil(citizen.hp),
            Math.round(citizen.moral),
            Math.round(citizen.hunger),
            citizen.role,
            citizen.workerState,
            citizen.jobId,
            citizen.squadId,
            citizen.weapon,
            citizen.name,
            citizen.arrivalDay,
          ]),
        ];
      else if (name === "research") signatureData = [name, model.stock[R.SCIENCE], model.tech];
      else if (name === "economy")
        signatureData = [
          name,
          model.stock,
          model.storage,
          model.housing,
          model.power.used,
          model.power.capacity,
          model.jobs.filter((job) => job.state === CFG.JOB_STATE.ACTIVE).length,
        ];
      else if (name === "defense")
        signatureData = [
          name,
          model.stock,
          model.fortificationCounts,
          model.tech[CFG.TECH.FORTIFICATIONS],
          model.defense.active,
          model.defense.warning,
        ];
      else if (name === "expedition")
        signatureData = [name, model.regions, model.stock[R.FOOD], model.stock[R.AMMO]];
      else if (name === "radio" || name === "laws") signatureData = [name, model.campaign];
      const signature = JSON.stringify(signatureData);
      if (signature === this.systemSignature) return;
      this.systemSignature = signature;
      if (name === "build") this._renderBuildSystem(model);
      else if (name === "citizens") this._renderCitizensSystem(model);
      else if (name === "research") this._renderResearchSystem(model);
      else if (name === "economy") this._renderEconomySystem(model);
      else if (name === "defense") this._renderDefenseSystem(model);
      else if (name === "expedition") this._renderExpeditionSystem(model);
      else if (name === "radio") this._renderRadioSystem(model);
      else if (name === "laws") this._renderLawsSystem(model);
      else this._renderLockedSystem(name);
    }

    _renderBuildSystem(model) {
      const selected = model.selectedBuilding;
      let html =
        '<p class="zone-system-lead">Adapta edificios despejados. Selecciona uno en el mapa para ver costes y comenzar la obra.</p>';
      if (selected)
        html +=
          '<div class="zone-system-callout"><b>' +
          (selected.name || "edificio seleccionado") +
          "</b><span>" +
          (selected.revealed
            ? selected.cleared
              ? "despejado"
              : "amenaza presente"
            : "sin explorar") +
          "</span></div>";
      html += '<div class="zone-building-catalog">';
      for (let i = 0; i < model.useCounts.length; i++) {
        const row = model.useCounts[i];
        html +=
          '<div class="zone-catalog-item ' +
          (row.unlocked ? "" : "locked") +
          '"><span class="zone-icon ' +
          (row.use === CFG.BUILDING_USE.POWER
            ? "zi-power"
            : row.use === CFG.BUILDING_USE.RESEARCH
              ? "zi-research"
              : "zi-adapt") +
          '"></span><span><b>' +
          USE_LABEL[row.use] +
          "</b><small>" +
          row.count +
          (row.count === 1 ? " operativo" : " operativos") +
          (row.unlocked ? "" : " · bloqueado") +
          "</small></span></div>";
      }
      html +=
        '</div><div class="zone-system-adapt-command"><label for="zone-system-adapt">adaptar edificio seleccionado</label><select id="zone-system-adapt" data-system-adapt>';
      for (let i = 0; i < model.useCounts.length; i++) {
        const row = model.useCounts[i],
          cost = CFG.ADAPT.COSTS[row.use];
        html +=
          '<option value="' +
          row.use +
          '" ' +
          (row.unlocked ? "" : "disabled") +
          ">" +
          USE_LABEL[row.use] +
          " · madera " +
          cost[R.WOOD] +
          " · metal " +
          cost[R.METAL] +
          " · ladrillo " +
          cost[R.BRICK] +
          "</option>";
      }
      html +=
        '</select><button type="button" data-system-adapt-submit ' +
        (model.selectedCanAdapt ? "" : "disabled") +
        '><span class="zone-icon zi-adapt"></span>Adaptar edificio</button></div>';
      this.systemBody.innerHTML = html;
    }

    _renderCitizensSystem(model) {
      let html =
        '<div class="zone-system-stats"><span><b>' +
        model.stats.population +
        "</b> habitantes</span><span><b>" +
        model.stats.free +
        "</b> libres</span><span><b>" +
        model.stats.assigned +
        "</b> asignados</span><span><b>" +
        Math.round(model.stats.moral) +
        '%</b> moral</span></div><div class="zone-citizen-list">';
      for (let i = 0; i < model.citizens.length; i++) {
        const citizen = model.citizens[i],
          role =
            citizen.squadId === null ? ROLE_LABEL[citizen.role] : "patrulla " + citizen.squadId,
          state = citizen.squadId === null ? WORK_LABEL[citizen.workerState] : "en servicio";
        html +=
          '<button type="button" data-focus-citizen="' +
          citizen.id +
          '"><span class="zone-icon zi-worker"></span><span><b>' +
          (citizen.name || "Habitante " + citizen.id) +
          "</b><small>" +
          role +
          " · " +
          state +
          " · llegó día " +
          citizen.arrivalDay +
          '</small></span><span class="zone-citizen-vitals"><i><em style="width:' +
          Math.max(0, Math.min(100, (citizen.hp / citizen.maxHP) * 100)) +
          '%"></em></i><small>HP ' +
          Math.ceil(citizen.hp) +
          " · hambre " +
          Math.round(citizen.hunger) +
          "%</small></span></button>";
      }
      this.systemBody.innerHTML = html + "</div>";
    }

    _renderResearchSystem(model) {
      const science = model.stock[R.SCIENCE];
      let html =
        '<div class="zone-system-callout"><span class="zone-icon zi-science"></span><b>' +
        science +
        ' ciencia disponible</b></div><p class="zone-system-lead">Requiere un centro de investigación operativo.</p><div class="zone-tech-list">';
      for (let tech = CFG.TECH.AGRICULTURE; tech < CFG.TECH.COUNT; tech++) {
        const unlocked = Boolean(model.tech[tech]),
          cost = CFG.RESEARCH.COSTS[tech];
        html +=
          '<button type="button" data-system-tech="' +
          tech +
          '" ' +
          (unlocked ? "disabled" : "") +
          '><span class="zone-icon zi-research"></span><span><b>' +
          TECH_LABEL[tech] +
          "</b><small>" +
          (unlocked ? "investigado" : cost + " ciencia") +
          "</small></span></button>";
      }
      this.systemBody.innerHTML = html + "</div>";
    }

    _renderEconomySystem(model) {
      let stored = 0,
        html = '<div class="zone-economy-list">';
      for (let i = 0; i < model.stock.length; i++) {
        stored += model.stock[i];
        const trend = this.stockTrend[i] || 0;
        html +=
          '<div><span class="zone-icon ' +
          RESOURCE_ICON[i] +
          '"></span><span><b>' +
          RESOURCE_LABEL[i] +
          "</b><small>almacenado</small></span><strong>" +
          model.stock[i] +
          ' <i class="' +
          (trend > 0 ? "up" : trend < 0 ? "down" : "") +
          '">' +
          (trend > 0 ? "↑" : trend < 0 ? "↓" : "•") +
          "</i></strong></div>";
      }
      html +=
        '</div><div class="zone-capacity-card"><span><b>almacenamiento</b><small>' +
        stored +
        " / " +
        model.storage +
        '</small></span><i><em style="width:' +
        Math.min(100, model.storage ? (stored / model.storage) * 100 : 0) +
        '%"></em></i></div><div class="zone-system-stats"><span><b>' +
        model.power.used +
        "/" +
        model.power.capacity +
        "</b> energía</span><span><b>" +
        model.housing +
        "</b> alojamiento</span><span><b>" +
        model.jobs.filter((job) => job.state === CFG.JOB_STATE.ACTIVE).length +
        "</b> tareas</span></div>";
      this.systemBody.innerHTML = html;
    }

    _renderDefenseSystem(model) {
      const labels = ["", "Muro", "Puerta", "Torre de vigilancia", "Trampa"],
        descriptions = [
          "",
          "Bloquea a todos y obliga a la horda a abrir una brecha.",
          "Permite el paso de habitantes, pero detiene infectados.",
          "Dispara automáticamente y consume munición del asentamiento.",
          "Inflige daño al primer grupo infectado que la pisa.",
        ];
      let html = model.defense.warning.active
        ? '<div class="zone-defense-warning"><b>ALERTA DE HORDA</b><span>' +
          model.defense.warning.minutes +
          " min · desde " +
          model.defense.warning.direction +
          "</span></div>"
        : '<p class="zone-system-lead">Traza un perímetro sobre terreno libre. Clic derecho o Escape cancela el modo de colocación.</p>';
      html += '<div class="zone-defense-catalog">';
      for (let kind = CFG.FORTIFICATION.WALL; kind < CFG.FORTIFICATION.COUNT; kind++) {
        const cost = CFG.DEFENSE.COSTS[kind],
          unlocked = kind !== CFG.FORTIFICATION.TOWER || model.tech[CFG.TECH.FORTIFICATIONS];
        html +=
          '<button type="button" data-defense-build="' +
          kind +
          '" ' +
          (unlocked ? "" : "disabled") +
          '><span class="zone-defense-glyph">' +
          (kind === CFG.FORTIFICATION.WALL
            ? "▰"
            : kind === CFG.FORTIFICATION.GATE
              ? "⋀"
              : kind === CFG.FORTIFICATION.TOWER
                ? "⌂"
                : "×") +
          "</span><span><b>" +
          labels[kind] +
          " · " +
          model.fortificationCounts[kind] +
          "</b><small>" +
          descriptions[kind] +
          "</small><em>madera " +
          cost[R.WOOD] +
          " · metal " +
          cost[R.METAL] +
          " · ladrillo " +
          cost[R.BRICK] +
          (unlocked ? "" : " · requiere Fortificaciones") +
          "</em></span></button>";
      }
      html +=
        '</div><button class="zone-defense-remove" type="button" data-defense-remove>Retirar defensa · recupera 50%</button>';
      this.systemBody.innerHTML = html;
    }

    _renderExpeditionSystem(model) {
      const region = model.regions,
        expedition = region.expedition;
      let html =
        '<div class="zone-system-callout"><span class="zone-icon zi-expedition"></span><span><b>' +
        region.name +
        "</b><small>" +
        region.size +
        " · " +
        (region.source === "osm" ? "cartografía real" : "cartografía procedural") +
        "</small></span></div>";
      if (expedition)
        html +=
          '<div class="zone-defense-warning"><b>EXPEDICIÓN EN RUTA</b><span>' +
          Math.ceil(expedition.remaining) +
          " min restantes</span></div>";
      html +=
        '<p class="zone-system-lead">Los sectores centrales se simulan completos. Los exteriores se exploran como rutas regionales conectadas.</p><div class="zone-region-grid">';
      let minX = Infinity,
        minY = Infinity;
      for (let i = 0; i < region.nodes.length; i++) {
        minX = Math.min(minX, region.nodes[i].gx);
        minY = Math.min(minY, region.nodes[i].gy);
      }
      for (let i = 0; i < region.nodes.length; i++) {
        const node = region.nodes[i],
          label = node.active
            ? "zona activa"
            : node.scouted
              ? "explorado · botín " + node.loot
              : node.discovered
                ? "ruta conocida · amenaza " + node.threat
                : "sector sin explorar";
        html +=
          '<button type="button" style="--rx:' +
          (node.gx - minX + 1) +
          ";--ry:" +
          (node.gy - minY + 1) +
          '" data-expedition-region="' +
          node.id +
          '" class="' +
          (node.active ? "active" : node.scouted ? "scouted" : "") +
          '" ' +
          (node.canStart ? "" : "disabled") +
          ' title="' +
          label +
          '"><b>' +
          (node.active ? "■" : node.scouted ? "✓" : node.discovered ? "?" : "·") +
          "</b><small>" +
          label +
          "</small></button>";
      }
      html +=
        '</div><p class="zone-expedition-cost">Explorar: 1 patrulla · 6 comida · 2 munición · 3 horas</p>' +
        (model.mapPackAvailable
          ? '<button type="button" class="zone-export-map" data-export-map>Exportar MapPack para uso offline</button>'
          : "");
      this.systemBody.innerHTML = html;
    }

    _renderRadioSystem(model) {
      const campaign = model.campaign,
        cure = campaign.cure;
      let html =
        '<div class="zone-campaign-heading"><span class="zone-icon zi-radio"></span><span><small>' +
        campaign.actLabel +
        "</small><b>PROYECTO AURORA</b></span></div>";
      if (campaign.pending) {
        const event = campaign.pending;
        html +=
          '<article class="zone-campaign-event"><header><small>' +
          event.from +
          "</small><h3>" +
          event.title +
          "</h3></header>";
        for (let i = 0; i < event.body.length; i++) html += "<p>" + event.body[i] + "</p>";
        html += '<div class="zone-campaign-choices">';
        for (let i = 0; i < event.choices.length; i++) {
          const choice = event.choices[i];
          html +=
            '<button type="button" data-campaign-event="' +
            event.id +
            '" data-campaign-choice="' +
            choice.id +
            '" ' +
            (choice.available ? "" : "disabled") +
            "><b>" +
            choice.label +
            "</b><small>" +
            (choice.available ? choice.detail : choice.reason) +
            "</small></button>";
        }
        html += "</div></article>";
      }
      html +=
        '<section class="zone-cure-card"><header><span class="zone-icon zi-medicine"></span><span><small>ETAPA ' +
        cure.stage +
        " / " +
        CFG.CURE_STAGE.FORMULA +
        "</small><b>" +
        cure.label +
        '</b></span></header><div class="zone-cure-progress"><i style="width:' +
        cure.progress +
        '%"></i></div><p>' +
        cure.detail +
        "</p>";
      if (!cure.complete) {
        html +=
          '<button type="button" data-campaign-research ' +
          (cure.canAdvance ? "" : "disabled") +
          '><span class="zone-icon zi-research"></span><span><b>Completar siguiente etapa</b><small>' +
          (cure.cost
            ? cure.cost[R.SCIENCE] + " ciencia · " + cure.cost[R.MEDICINE] + " medicina"
            : cure.blockReason) +
          "</small></span></button>";
        if (!cure.canAdvance)
          html += '<small class="zone-cure-block">' + cure.blockReason + "</small>";
      } else html += "<strong>FÓRMULA COMPLETA</strong>";
      html +=
        '</section><section class="zone-factions"><header><small>MUNDO HUMANO</small><h3>Redes en contacto</h3></header>';
      for (let i = 0; i < campaign.factions.length; i++) {
        const faction = campaign.factions[i];
        html += '<article class="' + (faction.unlocked ? "" : "locked") + '"><div><b>';
        html += faction.unlocked ? faction.name : "Frecuencia desconocida";
        html +=
          "</b><small>" +
          (faction.unlocked ? faction.description : "Aún no has establecido contacto.") +
          '</small></div><div class="zone-standing"><i style="width:' +
          (faction.standing + 100) / 2 +
          '%"></i></div><span>' +
          (faction.unlocked ? faction.status + " · " + faction.standing : "sin señal") +
          "</span>";
        if (faction.unlocked)
          html +=
            '<button type="button" data-campaign-trade="' +
            faction.id +
            '" ' +
            (faction.canTrade ? "" : "disabled") +
            "><b>Intercambiar</b><small>" +
            faction.trade +
            " · una vez por día</small></button>";
        html += "</article>";
      }
      html +=
        '</section><section class="zone-campaign-log"><header><small>DIARIO DE LA ZONA</small></header>';
      if (!campaign.history.length) html += "<p>Aún no hay decisiones registradas.</p>";
      for (let i = 0; i < campaign.history.length; i++) {
        const entry = campaign.history[i];
        html +=
          "<article><small>DÍA " +
          entry.day +
          " · " +
          entry.title +
          "</small><b>" +
          entry.choice +
          "</b><p>" +
          entry.outcome +
          "</p></article>";
      }
      this.systemBody.innerHTML = html + "</section>";
    }

    _renderLawsSystem(model) {
      const laws = model.campaign.laws;
      if (!laws.unlocked) {
        this._renderLockedSystem("laws");
        return;
      }
      let html =
        '<p class="zone-system-lead">La asamblea puede cambiar una directiva por día. Cada política altera la vida diaria y las consecuencias de los rescates.</p><div class="zone-law-list">';
      for (let i = 0; i < laws.choices.length; i++) {
        const law = laws.choices[i],
          active = law.id === laws.current;
        html +=
          '<button type="button" data-campaign-law="' +
          law.id +
          '" class="' +
          (active ? "active" : "") +
          '" ' +
          (active || !laws.canChange ? "disabled" : "") +
          '><span class="zone-icon zi-laws"></span><span><b>' +
          law.name +
          "</b><small>" +
          law.detail +
          "</small><em>" +
          (active ? "EN VIGOR" : laws.canChange ? "promulgar" : "asamblea cerrada hasta mañana") +
          "</em></span></button>";
      }
      this.systemBody.innerHTML = html + "</div>";
    }

    _renderLockedSystem(name) {
      const copy = {
        laws: [
          "Las leyes llegarán con el crecimiento poblacional.",
          "El panel queda preparado para decisiones que modifiquen moral, raciones y cuidados.",
        ],
        radio: [
          "La radio todavía guarda silencio.",
          "Aquí aparecerán transmisiones, peticiones de auxilio y el registro de eventos.",
        ],
        expedition: [
          "No hay rutas regionales disponibles.",
          "Este espacio alojará expediciones, vehículos y destinos fuera del distrito.",
        ],
      }[name] || ["Sistema no disponible.", "Esta sección se activará en una fase posterior."];
      this.systemBody.innerHTML =
        '<div class="zone-locked-system"><span class="zone-icon ' +
        (SYSTEM_META[name] ? SYSTEM_META[name][1] : "zi-threat") +
        '"></span><b>' +
        copy[0] +
        "</b><p>" +
        copy[1] +
        "</p><small>PREPARADO · AÚN NO IMPLEMENTADO</small></div>";
    }

    refreshSquads(list, selected, squads, controlGroups, citizens) {
      this.squadCount.textContent = list.length;
      this.rosterToggleCount.textContent = list.length;
      this.squadList.replaceChildren();
      if (!list.length) {
        const empty = document.createElement("p");
        empty.textContent = "No hay escuadras listas.";
        this.squadList.appendChild(empty);
        return;
      }
      for (let i = 0; i < list.length; i++) {
        const squad = list[i],
          row = document.createElement("div"),
          select = document.createElement("button"),
          focus = document.createElement("button"),
          title = document.createElement("strong"),
          detail = document.createElement("small"),
          members = document.createElement("span"),
          supplies = document.createElement("span"),
          groups = [];
        for (let n = 1; n < controlGroups.length; n++)
          if (controlGroups[n].includes(squad.id)) groups.push(n);
        row.className = "zone-squad-row";
        select.type = "button";
        select.className = "zone-squad-select";
        select.dataset.selectSquad = squad.id;
        select.classList.toggle("on", selected.includes(squad));
        title.textContent = "PATRULLA " + squad.id;
        detail.textContent =
          (SQUAD_STATE_LABEL[squad.state] || squad.state) +
          (groups.length ? " · [" + groups.join(",") + "]" : "");
        members.className = "zone-squad-members";
        for (let slot = 0; slot < CFG.SQUAD.MAX_MEMBERS; slot++) {
          const memberSlot = document.createElement("span"),
            member = slot < squad.members.length ? citizens.at(squad.members[slot]) : null;
          memberSlot.className = "zone-member-slot" + (member ? "" : " empty");
          if (member) {
            const portrait = document.createElement("span"),
              hp = document.createElement("i"),
              hpFill = document.createElement("em"),
              weapon = document.createElement("small");
            this._setPortrait(portrait, member);
            hpFill.style.width =
              Math.max(0, Math.min(100, (member.hp / member.maxHP) * 100)).toFixed(1) + "%";
            hp.appendChild(hpFill);
            weapon.textContent = this._weaponLabel(member.weapon);
            memberSlot.title =
              (member.name || "Habitante " + member.cid) +
              " · HP " +
              Math.ceil(member.hp) +
              "/" +
              member.maxHP +
              " · " +
              weapon.textContent;
            memberSlot.append(portrait, hp, weapon);
          } else memberSlot.textContent = "+";
          members.appendChild(memberSlot);
        }
        supplies.className = "zone-squad-supplies";
        supplies.textContent =
          "munición " +
          squad.inventory[R.AMMO] +
          " · carga " +
          squads.inventoryTotal(squad) +
          "/" +
          squad.capacity +
          " · respuesta automática · a pie";
        select.append(title, detail, members, supplies);
        focus.type = "button";
        focus.className = "zone-squad-focus";
        focus.dataset.focusSquad = squad.id;
        focus.title =
          "centrar la cámara en la patrulla " +
          squad.id +
          (groups.length ? " (grupo " + groups.join(", ") + ")" : "");
        focus.textContent = "⌖";
        row.append(select, focus);
        this.squadList.appendChild(row);
      }
    }

    _hideActions() {
      this.hqAction.hidden = true;
      this.jobActions.hidden = true;
      this.squadActions.hidden = true;
      this.adaptActions.hidden = true;
      this.researchActions.hidden = true;
      this.commandBar.hidden = true;
      this.selectionVisual.hidden = true;
      this.selectionVisual.replaceChildren();
      this.memberDetail.hidden = true;
    }

    _showSelection() {
      this.inspector.hidden = false;
      this.roster.hidden = true;
      this.card.hidden = false;
    }

    showRoster() {
      this._hideActions();
      this.inspector.hidden = false;
      this.roster.hidden = false;
      this.card.hidden = true;
    }

    setRosterControl(enabled, open) {
      this.rosterToggle.hidden = !enabled;
      this.rosterToggle.classList.toggle("on", open);
      this.rosterToggle.setAttribute("aria-expanded", String(open));
      this.rosterToggle.title = open ? "Cerrar lista de patrullas" : "Abrir lista de patrullas";
    }

    showSetup(record, suitable) {
      this._hideActions();
      this._showSelection();
      this.home.textContent = "⌂ centrar en candidato";
      this.detail.textContent = "";
      if (!record) {
        this.title.textContent = "No hay edificio seleccionado";
        this.meta.textContent = "El reloj espera hasta establecer una base.";
        return;
      }
      this.title.textContent = record.name;
      this.meta.textContent =
        Math.round(record.area / 100) +
        " m² · " +
        (suitable ? "cuartel general adecuado" : "demasiado pequeño");
      this.hqAction.hidden = !suitable;
    }

    showBuilding(record, isHQ, job, map, adaptations) {
      this._hideActions();
      this._showSelection();
      this.home.textContent = "⌂ centrar en la base";
      const abandoned = record.use === CFG.BUILDING_USE.ABANDONED;
      this.title.textContent = isHQ
        ? "Cuartel general"
        : abandoned
          ? "Edificio abandonado"
          : record.name;
      this.meta.textContent =
        Math.round(record.area / 100) +
        " m² · " +
        (isHQ
          ? "operativo"
          : abandoned
            ? record.revealed
              ? record.poiLabel + " · " + record.name
              : "sin explorar · " + record.name
            : map.useLabel(record.use));
      if (isHQ) {
        this.detail.textContent =
          "La población descansa, deposita la carga y repone suministros aquí · capacidad " +
          record.capacity +
          ".\nestructura " +
          Math.ceil(record.hp) +
          "/" +
          Math.ceil(record.maxHP);
        this.adaptActions.hidden = false;
        this.adaptUse.hidden = true;
        this.adapt.hidden = true;
        this.toggleBuilding.hidden = true;
        this.repairBuilding.hidden = record.hp >= record.maxHP;
        return;
      }
      const reachable = map.reachable(record);
      if (abandoned) this._renderBuildingVisual(record, map);
      this.jobActions.hidden = !abandoned || !reachable;
      this.salvage.hidden = Boolean(job) || map.materialsTotal(record) <= 0;
      this.cancelJob.hidden = !job;
      this.priority.disabled = !job;
      this.priority.value = String(job ? job.priority : CFG.PRIORITY.NORMAL);
      this.detail.textContent = !reachable
        ? "Sin acceso peatonal desde la base: no se asignarán trabajadores ni patrullas."
        : record.revealed
          ? "amenaza " +
            record.infectedRemaining +
            " · " +
            (record.cleared ? "despejado" : "presencia hostil") +
            (job
              ? "\n" +
                job.assigned.length +
                "/" +
                job.capacity +
                " trabajadores · " +
                this._jobLabel(job) +
                " " +
                this._jobProgress(job, adaptations) +
                "%"
              : "\nsin tarea de desguace")
          : "Registro pendiente. El interior, la amenaza y sus recursos aún no se conocen." +
            (job
              ? "\n" +
                job.assigned.length +
                "/" +
                job.capacity +
                " trabajadores · " +
                this._jobLabel(job) +
                " " +
                this._jobProgress(job, adaptations) +
                "%"
              : "");
      this.adaptActions.hidden = !reachable;
      const canAdapt =
        reachable &&
        record.use === CFG.BUILDING_USE.ABANDONED &&
        record.revealed &&
        record.cleared &&
        !job;
      this.adaptUse.hidden = !canAdapt;
      this.adapt.hidden = !canAdapt;
      this.toggleBuilding.hidden = record.use === CFG.BUILDING_USE.ABANDONED;
      this.toggleBuilding.textContent = record.active ? "Pausar operación" : "Activar operación";
      this.repairBuilding.hidden = record.maxHP <= 0 || record.hp >= record.maxHP;
      this.researchActions.hidden = record.use !== CFG.BUILDING_USE.RESEARCH;
      for (const option of this.adaptUse.options)
        option.disabled = !adaptations.isUnlocked(Number(option.value));
      for (const button of this.researchActions.querySelectorAll("[data-tech]"))
        button.disabled = Boolean(adaptations.state.zone.tech[Number(button.dataset.tech)]);
    }

    _jobLabel(job) {
      if (job.type === CFG.JOB.BUILD) return "construcción";
      if (job.type === CFG.JOB.PRODUCE) return "producción";
      return "desguace";
    }

    _weaponLabel(weapon) {
      if (weapon === CFG.WEAPON.RIFLE) return "rifle";
      if (weapon === CFG.WEAPON.PISTOL) return "pistola";
      return "machete";
    }

    _setPortrait(element, member) {
      const index = Math.abs((member.cid || 1) - 1) % 16,
        column = index % 4,
        row = (index / 4) | 0;
      element.className = "zone-portrait";
      element.style.backgroundPosition =
        ((column / 3) * 100).toFixed(3) + "% " + ((row / 3) * 100).toFixed(3) + "%";
      element.setAttribute("role", "img");
      element.setAttribute("aria-label", "Retrato de " + (member.name || "habitante"));
    }

    _renderBuildingVisual(record, map) {
      const banner = document.createElement("figure"),
        image = document.createElement("img"),
        badge = document.createElement("figcaption"),
        progress = document.createElement("section"),
        progressHeader = document.createElement("header"),
        progressLabel = document.createElement("small"),
        progressValue = document.createElement("b"),
        progressTrack = document.createElement("i"),
        progressFill = document.createElement("em"),
        rack = document.createElement("section"),
        rackHeader = document.createElement("header"),
        rackLabel = document.createElement("small"),
        rackValue = document.createElement("b"),
        slots = document.createElement("div"),
        total = map.lootTotal(record),
        capacity = Math.max(record.lootCapacity || total, total),
        percent = record.looted
          ? 100
          : record.revealed && capacity
            ? Math.round(((capacity - total) / capacity) * 100)
            : 0;
      image.src = "assets/zone/scenes/abandoned-building.png";
      image.alt = "Fachada dibujada de un edificio urbano abandonado";
      image.decoding = "async";
      badge.textContent = record.revealed ? record.poiLabel : "ABANDONADO · SIN EXPLORAR";
      banner.className = "zone-building-banner";
      banner.append(image, badge);
      progress.className = "zone-building-progress";
      progressLabel.textContent = record.looted ? "REGISTRO COMPLETADO" : "PROGRESO DE REGISTRO";
      progressValue.textContent = record.revealed ? percent + "%" : "PENDIENTE";
      progressFill.style.width = percent + "%";
      progressTrack.appendChild(progressFill);
      progressHeader.append(progressLabel, progressValue);
      progress.append(progressHeader, progressTrack);
      rack.className = "zone-resource-rack";
      rackLabel.textContent = "RECURSOS ENCONTRADOS";
      rackValue.textContent = record.revealed ? total + " restantes" : "?";
      rackHeader.append(rackLabel, rackValue);
      slots.className = "zone-resource-slots";
      if (!record.revealed) {
        const unknown = document.createElement("span"),
          unknownLabel = document.createElement("small");
        unknown.className = "zone-resource-unknown";
        unknown.textContent = "?";
        unknownLabel.textContent = "Envía una patrulla para descubrir el contenido";
        slots.classList.add("unknown");
        slots.append(unknown, unknownLabel);
      } else {
        for (let i = 0; i < R.COUNT; i++)
          if (record.loot[i] > 0)
            this._appendResourceSlot(slots, RESOURCE_ICON[i], RESOURCE_LABEL[i], record.loot[i]);
        for (let weapon = CFG.WEAPON.PISTOL; weapon <= CFG.WEAPON.RIFLE; weapon++)
          if (record.lootWeapons[weapon] > 0)
            this._appendResourceSlot(
              slots,
              "zi-ammo",
              this._weaponLabel(weapon),
              record.lootWeapons[weapon],
            );
        if (!slots.childElementCount) {
          const empty = document.createElement("small");
          empty.className = "zone-resource-empty";
          empty.textContent = "No quedan recursos recuperables.";
          slots.appendChild(empty);
        }
      }
      rack.append(rackHeader, slots);
      this.selectionVisual.replaceChildren(banner, progress, rack);
      this.selectionVisual.hidden = false;
    }

    _appendResourceSlot(container, iconName, label, count) {
      const slot = document.createElement("span"),
        icon = document.createElement("span"),
        copy = document.createElement("span"),
        value = document.createElement("b"),
        name = document.createElement("small");
      slot.className = "zone-resource-slot";
      icon.className = "zone-icon " + iconName;
      value.textContent = String(count);
      name.textContent = label;
      copy.append(value, name);
      slot.append(icon, copy);
      container.appendChild(slot);
    }

    _jobProgress(job, adaptations) {
      if (job.type === CFG.JOB.BUILD)
        return Math.min(100, Math.round((job.progress / CFG.TASK.BUILD_SECONDS) * 100));
      if (job.type === CFG.JOB.PRODUCE) {
        const record = adaptations.map.at(job.targetId),
          seconds = adaptations.productionSeconds(record);
        return Math.min(100, Math.round((job.progress / seconds) * 100));
      }
      return Math.min(100, Math.round((job.progress / CFG.TASK.SALVAGE_SECONDS) * 100));
    }

    showAgents(selected, selectedSquads, pending, citizens, squads) {
      this._hideActions();
      this._showSelection();
      this.home.textContent = "⌂ centrar en la base";
      if (selectedSquads.length) {
        this.commandBar.hidden = false;
        this.squadActions.hidden = false;
        this.createSquad.hidden = true;
        this.returnButton.hidden = false;
        this.patrol.hidden = false;
        this.disband.hidden = false;
        let members = 0,
          cargo = 0,
          capacity = 0,
          ammo = 0,
          medicine = 0,
          inventory = Array.from({ length: R.COUNT }, () => 0);
        for (let i = 0; i < selectedSquads.length; i++) {
          const squad = selectedSquads[i];
          members += squad.members.length;
          cargo += squads.inventoryTotal(squad);
          capacity += squad.capacity;
          ammo += squad.inventory[R.AMMO];
          medicine += squad.inventory[R.MEDICINE];
          for (let resource = 0; resource < R.COUNT; resource++)
            inventory[resource] += squad.inventory[resource];
        }
        this.title.textContent =
          selectedSquads.length === 1
            ? "Patrulla " + selectedSquads[0].id + " · " + members + "/4"
            : selectedSquads.length + " patrullas · " + members + " personas";
        this.meta.textContent =
          selectedSquads.length === 1
            ? SQUAD_STATE_LABEL[selectedSquads[0].state] || selectedSquads[0].state
            : "mando conjunto";
        if (pending) this.meta.textContent += " · " + pending + " en cola";
        this.detail.textContent =
          "carga " +
          cargo +
          "/" +
          capacity +
          " · munición " +
          ammo +
          " · botiquines " +
          medicine +
          "\nRMB actuar · V saquear zona · Shift+RMB añade órdenes · Ctrl+1–9 grupos";
        this._renderSquadVisual(inventory, cargo, capacity);
        this.memberDetail.replaceChildren();
        this.memberDetail.hidden = false;
        for (let i = 0; i < selectedSquads.length; i++) {
          const squad = selectedSquads[i];
          for (let slot = 0; slot < CFG.SQUAD.MAX_MEMBERS; slot++) {
            const card = document.createElement("div"),
              member = slot < squad.members.length ? citizens.at(squad.members[slot]) : null;
            card.className = "zone-member-card" + (member ? "" : " empty");
            if (!member) {
              card.textContent = "plaza libre";
              this.memberDetail.appendChild(card);
              continue;
            }
            const portrait = document.createElement("span"),
              copy = document.createElement("span"),
              name = document.createElement("b"),
              state = document.createElement("small"),
              hp = document.createElement("i"),
              fill = document.createElement("em");
            this._setPortrait(portrait, member);
            name.textContent = member.name || "Habitante " + member.cid;
            state.textContent =
              this._weaponLabel(member.weapon) +
              " · HP " +
              Math.ceil(member.hp) +
              "/" +
              member.maxHP;
            fill.style.width =
              Math.max(0, Math.min(100, (member.hp / member.maxHP) * 100)).toFixed(1) + "%";
            hp.appendChild(fill);
            copy.append(name, hp, state);
            card.append(portrait, copy);
            this.memberDetail.appendChild(card);
          }
        }
        return;
      }
      let freeWorkers = 0;
      for (let i = 0; i < selected.length; i++)
        if (selected[i].role === CFG.ROLE.WORKER && selected[i].jobId === null) freeWorkers++;
      this.squadActions.hidden = freeWorkers < 1;
      this.createSquad.hidden = false;
      this.returnButton.hidden = true;
      this.patrol.hidden = true;
      this.disband.hidden = true;
      this.title.textContent =
        selected.length === 1 ? "Habitante " + selected[0].cid : selected.length + " habitantes";
      if (selected.length === 1) {
        const a = selected[0];
        this._renderCitizenVisual(a);
        this.meta.textContent = ROLE_LABEL[a.role] + " · HP " + Math.ceil(a.hp) + "/" + a.maxHP;
        this.detail.textContent =
          "moral " +
          Math.round(a.moral) +
          "% · hambre " +
          Math.round(a.hunger) +
          "%\n" +
          WORK_LABEL[a.workerState] +
          (a.jobId === null ? "" : " · tarea " + a.jobId) +
          (citizens.carryTotal(a) ? " · carga " + citizens.carryTotal(a) : "");
      } else {
        this.meta.textContent = freeWorkers + " trabajadores libres pueden formar una escuadra";
        this.detail.textContent = "Una escuadra acepta como máximo cuatro habitantes disponibles.";
      }
    }

    _renderSquadVisual(inventory, cargo, capacity) {
      const rack = document.createElement("section"),
        header = document.createElement("header"),
        label = document.createElement("small"),
        value = document.createElement("b"),
        slots = document.createElement("div");
      rack.className = "zone-resource-rack zone-squad-resource-rack";
      label.textContent = "RECURSOS / CAPACIDAD";
      value.textContent = cargo + " / " + capacity;
      header.append(label, value);
      slots.className = "zone-resource-slots";
      for (let i = 0; i < R.COUNT; i++)
        if (inventory[i] > 0)
          this._appendResourceSlot(slots, RESOURCE_ICON[i], RESOURCE_LABEL[i], inventory[i]);
      if (!slots.childElementCount) {
        const empty = document.createElement("small");
        empty.className = "zone-resource-empty";
        empty.textContent = "La patrulla no lleva recursos.";
        slots.appendChild(empty);
      }
      rack.append(header, slots);
      this.selectionVisual.replaceChildren(rack);
      this.selectionVisual.hidden = false;
    }

    _renderCitizenVisual(citizen) {
      const card = document.createElement("section"),
        portrait = document.createElement("span"),
        copy = document.createElement("span"),
        name = document.createElement("b"),
        detail = document.createElement("small");
      card.className = "zone-citizen-portrait-card";
      this._setPortrait(portrait, citizen);
      name.textContent = citizen.name || "Habitante " + citizen.cid;
      detail.textContent = "Llegó el día " + citizen.arrivalDay;
      copy.append(name, detail);
      card.append(portrait, copy);
      this.selectionVisual.replaceChildren(card);
      this.selectionVisual.hidden = false;
    }

    showNone(hasHQ) {
      this._hideActions();
      this.home.textContent = hasHQ ? "⌂ centrar en la base" : "⌂ centrar en candidato";
      if (hasHQ) {
        this.inspector.hidden = true;
        this.roster.hidden = true;
        this.card.hidden = true;
        return;
      }
      this._showSelection();
      this.title.textContent = "Sin selección";
      this.meta.textContent = hasHQ
        ? "Haz clic en un habitante o edificio."
        : "El reloj espera hasta establecer una base.";
      this.detail.textContent = "";
    }

    toast(text) {
      this.toastEl.textContent = text;
    }

    setCommandMode(mode) {
      this.armOrder.classList.toggle("on", mode === "order");
      this.areaScavenge.classList.toggle("on", mode === "area");
      this.attack.classList.toggle("on", mode === "attack");
      this.garrison.classList.toggle("on", mode === "garrison");
    }

    showMapHint(text, x, y) {
      this.mapHint.textContent = text;
      this.mapHint.style.left = Math.min(window.innerWidth - 220, x + 16) + "px";
      this.mapHint.style.top = Math.min(window.innerHeight - 44, y + 18) + "px";
      this.mapHint.hidden = false;
    }

    hideMapHint() {
      this.mapHint.hidden = true;
    }
  }

  ZS.ZoneUI = ZoneUI;
})();
