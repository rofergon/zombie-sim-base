/* Original three-act human campaign for The Zone. Events are deterministic,
   choices are persisted by stable IDs, and every consequence flows through
   the same citizen/resource systems used by the simulation. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});
  const CFG = ZS.ZoneConfig;
  const R = CFG.RESOURCE;
  const F = CFG.FACTION;
  const L = CFG.LAW;
  const C = CFG.CURE_STAGE;
  const U = CFG.BUILDING_USE;

  const ACT_LABEL = Object.freeze([
    "Prólogo",
    "I · La señal",
    "II · La fractura",
    "III · Proyecto Aurora",
  ]);
  const CURE_LABEL = Object.freeze([
    "sin iniciar",
    "señal descifrada",
    "muestra viable",
    "prototipo",
    "ensayo validado",
    "fórmula estable",
  ]);
  const CURE_DETAIL = Object.freeze([
    "La Zona todavía no conoce el origen de la transmisión.",
    "Una voz médica repite una secuencia genética entre ráfagas de estática.",
    "La muestra conserva anticuerpos capaces de frenar la mutación.",
    "El laboratorio puede producir un compuesto experimental.",
    "El ensayo confirma inmunidad temporal sin síntomas graves.",
    "La fórmula puede fabricarse y transmitirse a otros asentamientos.",
  ]);
  const FACTION_META = Object.freeze([
    Object.freeze({
      id: F.FAROS,
      name: "Red de los Faros",
      short: "Faros",
      description: "Médicos y operadores de radio que mantienen corredores de rescate.",
      flag: "faction-faros",
      trade: "8 comida → 3 medicina + 2 ciencia",
    }),
    Object.freeze({
      id: F.COBALTO,
      name: "Caravana Cobalto",
      short: "Cobalto",
      description: "Conductores, mecánicos y familias que viven entre rutas bloqueadas.",
      flag: "faction-cobalto",
      trade: "10 madera → 14 comida + 3 metal",
    }),
    Object.freeze({
      id: F.BASTION,
      name: "Pacto del Bastión",
      short: "Bastión",
      description: "Comunidades fortificadas que anteponen el perímetro a cualquier promesa.",
      flag: "faction-bastion",
      trade: "8 metal → 18 munición",
    }),
  ]);
  const LAW_META = Object.freeze([
    Object.freeze({
      id: L.NONE,
      name: "Sin directiva",
      detail: "Cada refugio decide por su cuenta.",
    }),
    Object.freeze({
      id: L.OPEN_DOORS,
      name: "Puertas abiertas",
      detail: "Los rescates traen una persona adicional, pero también más presión nocturna.",
    }),
    Object.freeze({
      id: L.RATIONS,
      name: "Ración compartida",
      detail: "La comida rinde más; la moral cae lentamente por la escasez.",
    }),
    Object.freeze({
      id: L.QUARANTINE,
      name: "Protocolo sanitario",
      detail: "La cura requiere menos ciencia, pero llegan menos supervivientes.",
    }),
  ]);

  const EVENTS = Object.freeze({
    first_signal: Object.freeze({
      id: "first_signal",
      act: 1,
      from: "FRECUENCIA 91.7 · ORIGEN DESCONOCIDO",
      title: "La voz entre la estática",
      body: Object.freeze([
        "A las 09:13 la radio repite una secuencia de bases químicas y una frase: «Si todavía podéis medir una fiebre, todavía podéis detenerla».",
        "La doctora Mara Vela dice hablar desde una red de clínicas aisladas. Pide una confirmación y advierte que otros también escuchan.",
      ]),
      choices: Object.freeze([
        Object.freeze({
          id: "answer",
          label: "Responder con nuestras coordenadas",
          detail: "Faros +12 · moral +2 · comienza Proyecto Aurora",
        }),
        Object.freeze({
          id: "listen",
          label: "Escuchar sin revelar la base",
          detail: "+3 ciencia · Bastión +5 · Faros −3",
        }),
      ]),
    }),
    roof_survivors: Object.freeze({
      id: "roof_survivors",
      act: 1,
      from: "CANAL DE EMERGENCIA · AZOTEA DEL COLEGIO",
      title: "Cinco sombras y una sábana roja",
      body: Object.freeze([
        "Una familia y dos antiguos docentes llevan tres noches cercados. Han marcado su azotea con pintura roja y apenas conservan agua.",
        "La ruta atraviesa un corredor inseguro. En la planta baja también hay un almacén sellado que nadie podría cargar junto con los heridos.",
      ]),
      choices: Object.freeze([
        Object.freeze({
          id: "everyone",
          label: "Traerlos a todos",
          detail: "−12 comida · +5 habitantes · moral +5 · requiere alojamiento",
        }),
        Object.freeze({
          id: "specialists",
          label: "Evacuar primero a los heridos y docentes",
          detail: "−5 comida · −2 medicina · +2 habitantes · +5 ciencia",
        }),
        Object.freeze({
          id: "cache",
          label: "Asegurar el almacén y dejar una ruta marcada",
          detail: "+10 madera · +5 metal · +4 munición · moral −5",
        }),
      ]),
    }),
    cobalt_caravan: Object.freeze({
      id: "cobalt_caravan",
      act: 1,
      from: "CARAVANA COBALTO · CAMIÓN 3",
      title: "Motores al otro lado del puente",
      body: Object.freeze([
        "Un convoy azul se detiene fuera del distrito. No quiere entrar, pero ofrece una frecuencia comercial y noticias de las carreteras.",
        "Su jefa, Aixa Torres, busca madera seca y un lugar donde dejar a tres mecánicos agotados.",
      ]),
      choices: Object.freeze([
        Object.freeze({
          id: "trade",
          label: "Intercambiar madera por víveres",
          detail: "−10 madera · +16 comida · +4 metal · Cobalto +12",
        }),
        Object.freeze({
          id: "mechanics",
          label: "Acoger a los mecánicos",
          detail: "−8 comida · +3 habitantes · +4 metal · requiere alojamiento",
        }),
        Object.freeze({
          id: "frequencies",
          label: "Compartir frecuencias, no suministros",
          detail: "+2 ciencia · Faros +4 · Cobalto +4",
        }),
      ]),
    }),
    sample_route: Object.freeze({
      id: "sample_route",
      act: 2,
      from: "DRA. MARA VELA · RED DE LOS FAROS",
      title: "La nevera que aún respira",
      body: Object.freeze([
        "Los Faros localizaron una muestra de sangre anterior al colapso. Sigue fría gracias a una batería de hospital, pero el edificio quedará sin energía esta noche.",
        "Sin esa muestra la secuencia de la radio es solo una hipótesis. Hay tres maneras de obtenerla y ninguna es limpia.",
      ]),
      choices: Object.freeze([
        Object.freeze({
          id: "escort",
          label: "Enviar una patrulla armada",
          detail: "−6 munición · +6 ciencia · Faros +7 · requiere patrulla",
        }),
        Object.freeze({
          id: "medicine",
          label: "Pagar el transporte con medicina",
          detail: "−4 medicina · Cobalto +6",
        }),
        Object.freeze({
          id: "decode",
          label: "Reconstruir la muestra desde los registros",
          detail: "−6 ciencia · Bastión +4",
        }),
      ]),
    }),
    clinic_vote: Object.freeze({
      id: "clinic_vote",
      act: 2,
      from: "ASAMBLEA DEL CUARTEL GENERAL",
      title: "¿A quién pertenece una cama vacía?",
      body: Object.freeze([
        "Una patrulla encontró marcas de tiza que guían a desconocidos hacia La Zona. Los refugios discuten si son una promesa o una sentencia.",
        "La decisión se convertirá en la primera directiva pública del asentamiento. Podrá cambiarse más adelante, pero no sin coste político.",
      ]),
      choices: Object.freeze([
        Object.freeze({
          id: "open",
          label: "Mantener las puertas abiertas",
          detail: "Activa Puertas abiertas · Faros +10 · Bastión −8",
        }),
        Object.freeze({
          id: "rations",
          label: "Aceptar gente con ración compartida",
          detail: "Activa Ración compartida · Cobalto +6 · moral −2",
        }),
        Object.freeze({
          id: "quarantine",
          label: "Solo tras cuarentena y examen",
          detail: "Activa Protocolo sanitario · Bastión +10 · Faros −4",
        }),
      ]),
    }),
    district_blackout: Object.freeze({
      id: "district_blackout",
      act: 2,
      from: "FRECUENCIA VECINAL · SECTOR NORTE",
      title: "Cuando se apagó el último ascensor",
      body: Object.freeze([
        "Una comunidad improvisada pierde su generador. Hay personas atrapadas en pisos altos y el ruido ya atrae infectados.",
        "Cobalto puede remolcar la máquina; los Faros pueden guiar una evacuación; el Bastión propone sellar el bloque.",
      ]),
      choices: Object.freeze([
        Object.freeze({
          id: "repair",
          label: "Entregar piezas y reparar el generador",
          detail: "−6 metal · +2 habitantes · Cobalto +10",
        }),
        Object.freeze({
          id: "evacuate",
          label: "Evacuar por las escaleras de incendios",
          detail: "−8 comida · +3 habitantes · Faros +10",
        }),
        Object.freeze({
          id: "seal",
          label: "Sellar el acceso antes del anochecer",
          detail: "+8 munición · Bastión +12 · moral −6",
        }),
      ]),
    }),
    stolen_notes: Object.freeze({
      id: "stolen_notes",
      act: 3,
      from: "LABORATORIO AURORA · REGISTRO DE SEGURIDAD",
      title: "Las páginas que faltan",
      body: Object.freeze([
        "Alguien fotografió los cuadernos del laboratorio. Horas después las tres redes exigen acceso a la investigación y se acusan entre sí.",
        "Ocultar la fórmula puede proteger La Zona. Compartirla puede convertir una cura local en algo más grande.",
      ]),
      choices: Object.freeze([
        Object.freeze({
          id: "open_data",
          label: "Publicar los datos incompletos",
          detail: "+4 ciencia · todas las facciones +5",
        }),
        Object.freeze({
          id: "guard",
          label: "Cerrar el laboratorio y doblar la guardia",
          detail: "−8 munición · Bastión +12 · Faros −6",
        }),
        Object.freeze({
          id: "bargain",
          label: "Entregar una copia a Cobalto como garantía",
          detail: "+8 comida · +4 medicina · Cobalto +12",
        }),
      ]),
    }),
    water_tower: Object.freeze({
      id: "water_tower",
      act: 3,
      from: "REPETIDOR DE LA TORRE DE AGUA",
      title: "Los nombres leídos al amanecer",
      body: Object.freeze([
        "Una voz infantil lee seis nombres cada amanecer. La señal viene de una torre rodeada por una manada y está perdiendo potencia.",
        "Los refugios guardan silencio cuando la grabación termina. Todos saben que una expedición retrasará el trabajo de la cura.",
      ]),
      choices: Object.freeze([
        Object.freeze({
          id: "rescue",
          label: "Abrir un corredor de rescate",
          detail: "−10 comida · −6 munición · +4 habitantes · moral +8",
        }),
        Object.freeze({
          id: "guide",
          label: "Guiarlos por radio hasta un Faro",
          detail: "Faros +14 · +3 ciencia",
        }),
        Object.freeze({
          id: "silence",
          label: "Apagar la frecuencia en La Zona",
          detail: "Bastión +10 · moral −8",
        }),
      ]),
    }),
    trial_request: Object.freeze({
      id: "trial_request",
      act: 3,
      from: "LABORATORIO AURORA · PRIORIDAD ROJA",
      title: "El primer brazo",
      body: Object.freeze([
        "El prototipo neutraliza la muestra en vidrio. Para saber si protege a una persona hace falta un ensayo antes de que el compuesto pierda estabilidad.",
        "Tres habitantes se ofrecen. Afuera, la radio ya difunde rumores de una cura terminada que todavía no existe.",
      ]),
      choices: Object.freeze([
        Object.freeze({
          id: "volunteers",
          label: "Aceptar a los voluntarios",
          detail: "−4 medicina · moral +4 · Faros +8",
        }),
        Object.freeze({
          id: "controlled",
          label: "Exigir un ensayo controlado",
          detail: "−6 medicina · −6 ciencia · todas las facciones +4",
        }),
        Object.freeze({
          id: "rushed",
          label: "Probar una dosis reducida esta noche",
          detail: "−2 medicina · moral −7 · Bastión +8",
        }),
      ]),
    }),
    formula_ready: Object.freeze({
      id: "formula_ready",
      act: 3,
      from: "PROYECTO AURORA · MENSAJE PARA TODA LA ZONA",
      title: "Una fórmula y tres futuros",
      body: Object.freeze([
        "La fórmula es estable. No devuelve a quienes se transformaron, pero detiene la infección en personas expuestas y permite fabricar nuevas dosis.",
        "Transmitirla atraerá a miles de oyentes y a una horda siguiendo sus convoyes. Guardarla salvará primero a La Zona. Una coalición podría hacer ambas cosas.",
      ]),
      choices: Object.freeze([
        Object.freeze({
          id: "broadcast",
          label: "Transmitir la fórmula en abierto",
          detail: "Comienza la última noche · horda extrema · Faros +15",
        }),
        Object.freeze({
          id: "coalition",
          label: "Formar un corredor con las tres facciones",
          detail: "−12 comida · −8 munición · −4 medicina · requiere reputación 10 con todas",
        }),
        Object.freeze({
          id: "local",
          label: "Inmunizar La Zona y apagar la radio",
          detail: "Final inmediato · moral +12 · las facciones se alejan",
        }),
      ]),
    }),
  });

  const SCHEDULED_EVENTS = Object.freeze([
    "roof_survivors",
    "cobalt_caravan",
    "sample_route",
    "clinic_vote",
    "district_blackout",
    "stolen_notes",
    "water_tower",
  ]);

  class ZoneCampaign {
    constructor(state, map) {
      this.state = state;
      this.map = map;
      this.data = state.zone.campaign;
      this.citizens = null;
      this.adaptations = null;
      this.defense = null;
      this.regions = null;
      this.scenario = null;
      this.onChanged = null;
      this.updateT = 0;
    }

    connect(citizens, adaptations, defense, regions, scenario, onChanged) {
      this.citizens = citizens;
      this.adaptations = adaptations;
      this.defense = defense;
      this.regions = regions;
      this.scenario = scenario;
      this.onChanged = onChanged;
      if (!this.map.hq) return;
      if (this.data.pending || this.data.endingUnread) this._blockAndOpen();
      else if (!this.done("first_signal")) this.queue("first_signal", true);
    }

    flag(id) {
      return this.data.flags.includes(id);
    }

    addFlag(id) {
      if (!this.flag(id)) this.data.flags.push(id);
    }

    done(id) {
      return this.data.completed.includes(id);
    }

    queue(id, immediate) {
      const event = EVENTS[id];
      if (!event || this.done(id) || this.data.pending) return false;
      this.data.pending = id;
      this.data.act = Math.max(this.data.act, event.act);
      if (!immediate) this.data.lastEventDay = this.state.day;
      this._blockAndOpen();
      this.state.save();
      return true;
    }

    _blockAndOpen() {
      if (!this.scenario) return;
      if (this.data.endingUnread) this.scenario.paused = true;
      this.scenario.systemPanel = "radio";
      if (this.onChanged) this.onChanged();
    }

    hasBlocking() {
      return Boolean(this.data.endingUnread);
    }

    update(dt) {
      this.updateT += dt;
      if (this.updateT < 0.5) return;
      this.updateT = 0;
      if (
        !this.map.hq ||
        this.data.pending ||
        this.hasBlocking() ||
        this.data.ending ||
        this.defense.data.report
      )
        return;
      if (this.data.cureStage === C.PROTOTYPE && !this.flag("trial-approved")) {
        this.queue("trial_request", true);
        return;
      }
      if (this.data.cureStage === C.FORMULA && !this.done("formula_ready")) {
        this.queue("formula_ready", true);
        return;
      }
      if (
        this.defense.data.active ||
        this.data.finalNight > 0 ||
        this.state.phase() === "night" ||
        this.state.phase() === "dusk" ||
        this.state.day <= this.data.lastEventDay ||
        this.state.minute < 8 * 60
      )
        return;
      for (let i = 0; i < SCHEDULED_EVENTS.length; i++) {
        const id = SCHEDULED_EVENTS[i];
        if (!this.done(id) && this._eligible(id)) {
          this.queue(id, false);
          return;
        }
      }
    }

    _eligible(id) {
      if (id === "roof_survivors") return this.state.day >= 2 && this.done("first_signal");
      if (id === "cobalt_caravan") return this.state.day >= 3 && this.done("roof_survivors");
      if (id === "sample_route")
        return (
          this.state.day >= 3 &&
          this.data.cureStage === C.SIGNAL &&
          !this.flag("viable-sample") &&
          this.map.countUse(U.RESEARCH) > 0
        );
      if (id === "clinic_vote")
        return (
          this.state.day >= 4 &&
          this.done("roof_survivors") &&
          this.citizens.stats().population >= 16
        );
      if (id === "district_blackout") return this.state.day >= 5 && this.done("cobalt_caravan");
      if (id === "stolen_notes") return this.state.day >= 6 && this.data.cureStage >= C.SAMPLE;
      if (id === "water_tower") return this.state.day >= 7 && this.done("district_blackout");
      return false;
    }

    eventModel() {
      const event = EVENTS[this.data.pending];
      if (!event) return null;
      return {
        id: event.id,
        from: event.from,
        title: event.title,
        body: event.body,
        choices: event.choices.map((choice) => ({
          id: choice.id,
          label: choice.label,
          detail: choice.detail,
          available: this._choiceAvailable(event.id, choice.id),
          reason: this._choiceReason(event.id, choice.id),
        })),
      };
    }

    _choiceAvailable(eventId, choiceId) {
      const population = this.citizens.stats().population,
        housing = this.adaptations.housingCapacity();
      if (eventId === "roof_survivors" && choiceId === "everyone")
        return this.state.stock[R.FOOD] >= 12 && housing >= population + this._recruitCount(5);
      if (eventId === "roof_survivors" && choiceId === "specialists")
        return (
          this.state.stock[R.FOOD] >= 5 &&
          this.state.stock[R.MEDICINE] >= 2 &&
          housing >= population + this._recruitCount(2)
        );
      if (eventId === "cobalt_caravan" && choiceId === "trade")
        return this.state.stock[R.WOOD] >= 10;
      if (eventId === "cobalt_caravan" && choiceId === "mechanics")
        return this.state.stock[R.FOOD] >= 8 && housing >= population + this._recruitCount(3);
      if (eventId === "sample_route" && choiceId === "escort")
        return this.state.stock[R.AMMO] >= 6 && this.scenario.squads.list.length > 0;
      if (eventId === "sample_route" && choiceId === "medicine")
        return this.state.stock[R.MEDICINE] >= 4;
      if (eventId === "sample_route" && choiceId === "decode")
        return this.state.stock[R.SCIENCE] >= 6;
      if (eventId === "district_blackout" && choiceId === "repair")
        return this.state.stock[R.METAL] >= 6 && housing >= population + this._recruitCount(2);
      if (eventId === "district_blackout" && choiceId === "evacuate")
        return this.state.stock[R.FOOD] >= 8 && housing >= population + this._recruitCount(3);
      if (eventId === "stolen_notes" && choiceId === "guard") return this.state.stock[R.AMMO] >= 8;
      if (eventId === "water_tower" && choiceId === "rescue")
        return (
          this.state.stock[R.FOOD] >= 10 &&
          this.state.stock[R.AMMO] >= 6 &&
          housing >= population + this._recruitCount(4)
        );
      if (eventId === "trial_request" && choiceId === "volunteers")
        return this.state.stock[R.MEDICINE] >= 4;
      if (eventId === "trial_request" && choiceId === "controlled")
        return this.state.stock[R.MEDICINE] >= 6 && this.state.stock[R.SCIENCE] >= 6;
      if (eventId === "trial_request" && choiceId === "rushed")
        return this.state.stock[R.MEDICINE] >= 2;
      if (eventId === "formula_ready" && choiceId === "coalition")
        return (
          this.data.factions.every((standing) => standing >= 10) &&
          this.state.stock[R.FOOD] >= 12 &&
          this.state.stock[R.AMMO] >= 8 &&
          this.state.stock[R.MEDICINE] >= 4
        );
      return true;
    }

    _choiceReason(eventId, choiceId) {
      if (this._choiceAvailable(eventId, choiceId)) return "";
      if (eventId === "formula_ready" && choiceId === "coalition")
        return "Necesitas reputación 10 con cada facción y suministros para el corredor.";
      if (
        (eventId === "roof_survivors" && choiceId !== "cache") ||
        (eventId === "cobalt_caravan" && choiceId === "mechanics") ||
        (eventId === "district_blackout" && choiceId !== "seal") ||
        (eventId === "water_tower" && choiceId === "rescue")
      )
        return "Faltan suministros o plazas de alojamiento.";
      return "La Zona no tiene los recursos o la patrulla necesarios.";
    }

    choose(eventId, choiceId) {
      if (eventId !== this.data.pending) return false;
      const event = EVENTS[eventId],
        choice = event && event.choices.find((candidate) => candidate.id === choiceId);
      if (!choice || !this._choiceAvailable(eventId, choiceId)) return false;
      const outcome = this._applyChoice(eventId, choiceId);
      if (!outcome) return false;
      this.data.pending = null;
      if (!this.data.completed.includes(eventId)) this.data.completed.push(eventId);
      this._history(eventId, event.title, choice.label, outcome);
      if (this.scenario)
        this.scenario.paused = Boolean(this.defense.data.report || this.data.endingUnread);
      this.state.save();
      if (this.onChanged) this.onChanged();
      return true;
    }

    _applyChoice(eventId, choiceId) {
      if (eventId === "first_signal") {
        this.data.cureStage = C.SIGNAL;
        this.addFlag("faction-faros");
        if (choiceId === "answer") {
          this._standing(F.FAROS, 12);
          this.citizens.adjustMorale(2);
          return "La Zona entra en la Red de los Faros. El nombre Proyecto Aurora queda escrito en la pared del laboratorio.";
        }
        this._stock(R.SCIENCE, 3);
        this._standing(F.FAROS, -3);
        this._standing(F.BASTION, 5);
        return "La señal queda grabada sin revelar la base. Sus datos aceleran las primeras hipótesis.";
      }
      if (eventId === "roof_survivors") {
        if (choiceId === "everyone") {
          this._stock(R.FOOD, -12);
          const count = this._recruit(5);
          this.citizens.adjustMorale(5);
          this._standing(F.FAROS, 8);
          return (
            count +
            " supervivientes cruzan la puerta mientras los refugios improvisan nuevas literas."
          );
        }
        if (choiceId === "specialists") {
          this._stock(R.FOOD, -5);
          this._stock(R.MEDICINE, -2);
          const count = this._recruit(2);
          this._stock(R.SCIENCE, 5);
          this._standing(F.FAROS, 5);
          return (
            count +
            " personas llegan con cuadernos escolares llenos de observaciones sobre la fiebre."
          );
        }
        this._stock(R.WOOD, 10);
        this._stock(R.METAL, 5);
        this._stock(R.AMMO, 4);
        this.citizens.adjustMorale(-5);
        this._standing(F.BASTION, 10);
        return "La patrulla vuelve cargada. La sábana roja continúa visible hasta que cae la noche.";
      }
      if (eventId === "cobalt_caravan") {
        this.addFlag("faction-cobalto");
        if (choiceId === "trade") {
          this._stock(R.WOOD, -10);
          this._stock(R.FOOD, 16);
          this._stock(R.METAL, 4);
          this._standing(F.COBALTO, 12);
          return "Cobalto deja víveres, piezas y una frecuencia para futuros intercambios.";
        }
        if (choiceId === "mechanics") {
          this._stock(R.FOOD, -8);
          const count = this._recruit(3);
          this._stock(R.METAL, 4);
          this._standing(F.COBALTO, 10);
          return count + " mecánicos se quedan. El convoy parte más ligero y promete volver.";
        }
        this._stock(R.SCIENCE, 2);
        this._standing(F.COBALTO, 4);
        this._standing(F.FAROS, 4);
        return "La Zona entra en un mapa de voces que se extiende mucho más allá del distrito.";
      }
      if (eventId === "sample_route") {
        this.addFlag("viable-sample");
        if (choiceId === "escort") {
          this._stock(R.AMMO, -6);
          this._stock(R.SCIENCE, 6);
          this._standing(F.FAROS, 7);
          return "La nevera llega abollada y fría. La muestra viable ya está en el laboratorio.";
        }
        if (choiceId === "medicine") {
          this._stock(R.MEDICINE, -4);
          this._standing(F.COBALTO, 6);
          return "Un motociclista de Cobalto entrega la muestra antes del último latido de la batería.";
        }
        this._stock(R.SCIENCE, -6);
        this._standing(F.BASTION, 4);
        return "Los registros permiten sintetizar una muestra incompleta, pero suficiente para continuar.";
      }
      if (eventId === "clinic_vote") {
        this.addFlag("laws-unlocked");
        this.addFlag("faction-bastion");
        this.data.lawChangedDay = this.state.day;
        if (choiceId === "open") {
          this.data.law = L.OPEN_DOORS;
          this._standing(F.FAROS, 10);
          this._standing(F.BASTION, -8);
          return "Las marcas de tiza permanecen. La Zona acepta que sobrevivir también significa abrir.";
        }
        if (choiceId === "rations") {
          this.data.law = L.RATIONS;
          this._standing(F.COBALTO, 6);
          this.citizens.adjustMorale(-2);
          return "Cada plato pierde un poco para que una cama pueda ganar un nombre.";
        }
        this.data.law = L.QUARANTINE;
        this._standing(F.BASTION, 10);
        this._standing(F.FAROS, -4);
        return "La vieja clínica se convierte en frontera. Nadie entra sin pasar una noche bajo observación.";
      }
      if (eventId === "district_blackout") {
        if (choiceId === "repair") {
          this._stock(R.METAL, -6);
          const count = this._recruit(2);
          this._standing(F.COBALTO, 10);
          return (
            "El generador vuelve a toser. " +
            count +
            " personas eligen regresar con los mecánicos a La Zona."
          );
        }
        if (choiceId === "evacuate") {
          this._stock(R.FOOD, -8);
          const count = this._recruit(3);
          this._standing(F.FAROS, 10);
          return (
            count + " supervivientes descienden por una escalera iluminada con linternas verdes."
          );
        }
        this._stock(R.AMMO, 8);
        this._standing(F.BASTION, 12);
        this.citizens.adjustMorale(-6);
        return "El bloque queda sellado. El Pacto entrega munición; nadie pregunta qué quedó dentro.";
      }
      if (eventId === "stolen_notes") {
        if (choiceId === "open_data") {
          this._stock(R.SCIENCE, 4);
          for (let id = 0; id < F.COUNT; id++) this._standing(id, 5);
          return "Las copias se multiplican. Ya no existe una única puerta capaz de encerrar Proyecto Aurora.";
        }
        if (choiceId === "guard") {
          this._stock(R.AMMO, -8);
          this._standing(F.BASTION, 12);
          this._standing(F.FAROS, -6);
          return "El laboratorio queda bajo guardia. La investigación sigue, pero la red deja de confiar.";
        }
        this._stock(R.FOOD, 8);
        this._stock(R.MEDICINE, 4);
        this._standing(F.COBALTO, 12);
        return "Cobalto guarda una copia sellada y paga por el privilegio de ser indispensable.";
      }
      if (eventId === "water_tower") {
        if (choiceId === "rescue") {
          this._stock(R.FOOD, -10);
          this._stock(R.AMMO, -6);
          const count = this._recruit(4);
          this.citizens.adjustMorale(8);
          this._standing(F.FAROS, 8);
          return (
            "La voz infantil termina de leer los nombres desde la seguridad del cuartel general. Llegaron " +
            count +
            "."
          );
        }
        if (choiceId === "guide") {
          this._stock(R.SCIENCE, 3);
          this._standing(F.FAROS, 14);
          return "Los Faros confirman seis llegadas. La frecuencia permanece encendida al amanecer.";
        }
        this._standing(F.BASTION, 10);
        this.citizens.adjustMorale(-8);
        return "La radio local queda limpia. El silencio pesa más que la estática.";
      }
      if (eventId === "trial_request") {
        this.addFlag("trial-approved");
        if (choiceId === "volunteers") {
          this._stock(R.MEDICINE, -4);
          this.citizens.adjustMorale(4);
          this._standing(F.FAROS, 8);
          return "Los tres voluntarios despiertan con fiebre leve. Ninguno desarrolla la infección.";
        }
        if (choiceId === "controlled") {
          this._stock(R.MEDICINE, -6);
          this._stock(R.SCIENCE, -6);
          for (let id = 0; id < F.COUNT; id++) this._standing(id, 4);
          return "El ensayo tarda más, pero hasta el Pacto acepta sus resultados.";
        }
        this._stock(R.MEDICINE, -2);
        this.citizens.adjustMorale(-7);
        this._standing(F.BASTION, 8);
        const patient = this._firstLiving();
        if (patient) patient.hp = Math.max(20, patient.hp - 25);
        return "La dosis funciona. El voluntario sobrevive, aunque el método divide al asentamiento.";
      }
      if (eventId === "formula_ready") {
        if (choiceId === "broadcast") {
          this.data.endingPath = "broadcast";
          this.data.finalNight = 1;
          this._standing(F.FAROS, 15);
          return "Las antenas repiten la fórmula. Decenas de motores responden; detrás de ellos avanza una marea de infectados.";
        }
        if (choiceId === "coalition") {
          this._stock(R.FOOD, -12);
          this._stock(R.AMMO, -8);
          this._stock(R.MEDICINE, -4);
          this.data.endingPath = "coalition";
          this.data.finalNight = 1;
          for (let id = 0; id < F.COUNT; id++) this._standing(id, 12);
          return "Faros, Cobalto y Bastión forman un corredor. La señal viajará protegida si La Zona resiste una noche más.";
        }
        this.data.endingPath = "local";
        this.data.ending = "local";
        this.data.endingUnread = true;
        this.citizens.adjustMorale(12);
        for (let id = 0; id < F.COUNT; id++) this._standing(id, -15);
        return "La Zona recibe las primeras dosis. Afuera, las frecuencias llaman hasta que las baterías se agotan.";
      }
      return null;
    }

    canAdvanceCure() {
      const stage = this.data.cureStage;
      if (stage < C.SIGNAL || stage >= C.FORMULA || this.data.pending) return false;
      if (stage === C.SIGNAL && !this.flag("viable-sample")) return false;
      if (stage === C.PROTOTYPE && !this.flag("trial-approved")) return false;
      if (!this._operationalResearch()) return false;
      return this._canPay(this.cureCost(stage + 1));
    }

    cureCost(stage) {
      const source = CFG.CAMPAIGN.CURE_COSTS[stage];
      if (!source) return null;
      const cost = source.slice(),
        discount = this.data.law === L.QUARANTINE ? 2 : this.data.factions[F.FAROS] >= 25 ? 1 : 0;
      cost[R.SCIENCE] = Math.max(1, cost[R.SCIENCE] - discount);
      return cost;
    }

    advanceCure() {
      if (!this.canAdvanceCure()) return false;
      const next = this.data.cureStage + 1,
        cost = this.cureCost(next);
      this._pay(cost);
      this.data.cureStage = next;
      this.data.act = Math.max(this.data.act, next >= C.SAMPLE ? 3 : 2);
      this._history(
        "cure-" + next,
        "Proyecto Aurora",
        "Completar " + CURE_LABEL[next],
        CURE_DETAIL[next],
      );
      if (next === C.PROTOTYPE) this.queue("trial_request", true);
      else if (next === C.FORMULA) this.queue("formula_ready", true);
      this.state.save();
      if (this.onChanged) this.onChanged();
      return true;
    }

    cureBlockReason() {
      const stage = this.data.cureStage;
      if (stage === C.DORMANT) return "Espera una señal que dé inicio a la investigación.";
      if (stage === C.SIGNAL && !this.flag("viable-sample"))
        return "Hace falta recuperar una muestra viable mediante una transmisión.";
      if (stage === C.PROTOTYPE && !this.flag("trial-approved"))
        return "El prototipo necesita una decisión sobre el ensayo humano.";
      if (!this._operationalResearch())
        return "Hace falta un centro de investigación activo y con energía.";
      if (!this._canPay(this.cureCost(stage + 1)))
        return "Faltan ciencia o medicina para la siguiente etapa.";
      return "";
    }

    _operationalResearch() {
      for (let i = 0; i < this.map.records.length; i++) {
        const record = this.map.records[i];
        if (record.use === U.RESEARCH && record.active && record.hp > 0 && record.powered)
          return true;
      }
      return false;
    }

    setLaw(id) {
      if (
        !this.flag("laws-unlocked") ||
        !Number.isInteger(id) ||
        id <= L.NONE ||
        id >= L.COUNT ||
        id === this.data.law ||
        this.data.lawChangedDay === this.state.day
      )
        return false;
      this.data.law = id;
      this.data.lawChangedDay = this.state.day;
      this.citizens.adjustMorale(-2);
      this._history("law-" + id, "Asamblea", LAW_META[id].name, LAW_META[id].detail);
      this.state.save();
      if (this.onChanged) this.onChanged();
      return true;
    }

    trade(factionId) {
      if (
        !Number.isInteger(factionId) ||
        factionId < 0 ||
        factionId >= F.COUNT ||
        !this.flag(FACTION_META[factionId].flag) ||
        this.data.factions[factionId] < -25 ||
        this.data.lastTradeDay[factionId] === this.state.day
      )
        return false;
      if (factionId === F.FAROS) {
        if (this.state.stock[R.FOOD] < 8) return false;
        this._stock(R.FOOD, -8);
        this._stock(R.MEDICINE, 3);
        this._stock(R.SCIENCE, 2);
      } else if (factionId === F.COBALTO) {
        if (this.state.stock[R.WOOD] < 10) return false;
        this._stock(R.WOOD, -10);
        this._stock(R.FOOD, 14);
        this._stock(R.METAL, 3);
      } else {
        if (this.state.stock[R.METAL] < 8) return false;
        this._stock(R.METAL, -8);
        this._stock(R.AMMO, 18);
      }
      this.data.lastTradeDay[factionId] = this.state.day;
      this._standing(factionId, 2);
      this._history(
        "trade-" + factionId + "-" + this.state.day,
        FACTION_META[factionId].name,
        "Intercambio completado",
        FACTION_META[factionId].trade,
      );
      this.state.save();
      if (this.onChanged) this.onChanged();
      return true;
    }

    foodReliefMultiplier() {
      if (this.data.law === L.RATIONS) return 1.3;
      if (this.data.law === L.OPEN_DOORS) return 0.92;
      return 1;
    }

    updateCitizen(agent, dt) {
      if (this.data.law === L.RATIONS) agent.moral = Math.max(0, agent.moral - dt * 0.006);
      else if (this.data.law === L.OPEN_DOORS)
        agent.moral = Math.min(100, agent.moral + dt * 0.002);
      else if (this.data.law === L.QUARANTINE) agent.moral = Math.max(0, agent.moral - dt * 0.0015);
    }

    nightMultiplier() {
      let multiplier = this.data.law === L.OPEN_DOORS ? 1.08 : 1;
      if (this.data.finalNight === 1 || this.data.finalNight === 2)
        multiplier *=
          this.data.endingPath === "coalition"
            ? CFG.CAMPAIGN.COALITION_HORDE_MULTIPLIER
            : CFG.CAMPAIGN.FINAL_HORDE_MULTIPLIER;
      return multiplier;
    }

    onNightStarted() {
      if (this.data.finalNight !== 1) return false;
      this.data.finalNight = 2;
      this._history(
        "final-night-" + this.state.day,
        "Todas las frecuencias",
        "La última noche",
        "Los convoyes se acercan a la señal y la horda converge sobre La Zona.",
      );
      this.state.save();
      if (this.onChanged) this.onChanged();
      return true;
    }

    onNightEnded(cleared) {
      if (this.data.finalNight !== 2) return false;
      if (!cleared) {
        this.data.finalNight = 1;
        this.citizens.adjustMorale(-8);
        this._history(
          "final-failed-" + this.state.day,
          "Proyecto Aurora",
          "La señal se interrumpe",
          "El cuartel general sobrevive herido. El corredor esperará otra transmisión.",
        );
      } else {
        this.data.finalNight = 3;
        this.data.ending = this.data.endingPath === "coalition" ? "coalition" : "broadcast";
        this.data.endingUnread = true;
        this.citizens.adjustMorale(15);
        if (this.scenario) this.scenario.paused = true;
      }
      this.state.save();
      if (this.onChanged) this.onChanged();
      return true;
    }

    endingCard() {
      if (!this.data.endingUnread || !this.data.ending) return null;
      if (this.data.ending === "coalition")
        return {
          title: "Proyecto Aurora — una red de ciudades",
          lines: [
            "Faros, Cobalto y Bastión cruzaron el corredor",
            "la fórmula viaja en papel, radio y memoria",
            "La Zona seguirá creciendo después de los créditos",
            "final: nadie sobrevive solo",
          ],
          lost: false,
        };
      if (this.data.ending === "broadcast")
        return {
          title: "Proyecto Aurora — la señal sigue viva",
          lines: [
            "la última horda se quebró contra el perímetro",
            "la fórmula fue copiada por estaciones desconocidas",
            "al amanecer otras voces pronunciaron el nombre de La Zona",
            "final: frecuencia abierta",
          ],
          lost: false,
        };
      return {
        title: "Proyecto Aurora — el refugio",
        lines: [
          "cada habitante de La Zona recibió una dosis",
          "la fiebre dejó de decidir quién cruzaba la puerta",
          "afuera, las frecuencias terminaron en silencio",
          "final: la ciudad cerrada",
        ],
        lost: false,
      };
    }

    dismissEnding() {
      if (!this.data.endingUnread) return false;
      this.data.endingUnread = false;
      if (this.scenario)
        this.scenario.paused = Boolean(this.defense.data.report || this.data.pending);
      this.state.save();
      if (this.onChanged) this.onChanged();
      return true;
    }

    model() {
      const nextStage = Math.min(C.FORMULA, this.data.cureStage + 1),
        cost = this.data.cureStage < C.FORMULA ? this.cureCost(nextStage) : null;
      return {
        act: this.data.act,
        actLabel: ACT_LABEL[this.data.act],
        pending: this.eventModel(),
        history: this.data.history.slice().reverse(),
        cure: {
          stage: this.data.cureStage,
          label: CURE_LABEL[this.data.cureStage],
          detail: CURE_DETAIL[this.data.cureStage],
          progress: (this.data.cureStage / C.FORMULA) * 100,
          cost,
          canAdvance: this.canAdvanceCure(),
          blockReason: this.cureBlockReason(),
          complete: this.data.cureStage === C.FORMULA,
        },
        factions: FACTION_META.map((meta) => ({
          id: meta.id,
          name: meta.name,
          short: meta.short,
          description: meta.description,
          standing: this.data.factions[meta.id],
          status: this._standingLabel(this.data.factions[meta.id]),
          unlocked: this.flag(meta.flag),
          trade: meta.trade,
          canTrade:
            this.flag(meta.flag) &&
            this.data.factions[meta.id] >= -25 &&
            this.data.lastTradeDay[meta.id] !== this.state.day &&
            this._canTradeCost(meta.id),
        })),
        laws: {
          unlocked: this.flag("laws-unlocked"),
          current: this.data.law,
          canChange: this.data.lawChangedDay !== this.state.day,
          choices: LAW_META.slice(1),
        },
        ending: this.data.ending,
        finalNight: this.data.finalNight,
      };
    }

    _canTradeCost(id) {
      if (id === F.FAROS) return this.state.stock[R.FOOD] >= 8;
      if (id === F.COBALTO) return this.state.stock[R.WOOD] >= 10;
      return this.state.stock[R.METAL] >= 8;
    }

    _recruitCount(base) {
      return Math.max(
        1,
        base + (this.data.law === L.OPEN_DOORS ? 1 : 0) - (this.data.law === L.QUARANTINE ? 1 : 0),
      );
    }

    _recruit(base) {
      return this.citizens.recruit(this._recruitCount(base), { moral: 70, hunger: 4 }).length;
    }

    _standing(id, amount) {
      this.data.factions[id] = Math.max(-100, Math.min(100, this.data.factions[id] + amount));
    }

    _standingLabel(value) {
      if (value >= 50) return "aliados";
      if (value >= 20) return "cooperación";
      if (value >= -10) return "cautela";
      if (value >= -40) return "tensión";
      return "hostiles";
    }

    _stock(id, amount) {
      this.state.stock[id] = Math.max(0, this.state.stock[id] + amount);
    }

    _canPay(cost) {
      if (!cost) return false;
      for (let i = 0; i < R.COUNT; i++) if (this.state.stock[i] < cost[i]) return false;
      return true;
    }

    _pay(cost) {
      for (let i = 0; i < R.COUNT; i++) this.state.stock[i] -= cost[i];
    }

    _firstLiving() {
      for (let i = 0; i < this.citizens.byId.length; i++) {
        const citizen = this.citizens.byId[i];
        if (citizen && !citizen.dead) return citizen;
      }
      return null;
    }

    _history(id, title, choice, outcome) {
      this.data.history.push({ id, day: this.state.day, title, choice, outcome });
      while (this.data.history.length > CFG.CAMPAIGN.MAX_HISTORY) this.data.history.shift();
    }
  }

  ZS.ZoneCampaign = ZoneCampaign;
})();
