/* Phaser/WebGL sketch compositor.
   ZS still owns the clock, camera, simulation and input. Phaser keeps only
   visible ground sectors and shared sketch atlases, while the overlay canvas
   retains effects, building annotations, routes, speech and the HUD. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});
  const BOIL_MS = 140;
  const HOLD_CHUNK_SIZE = 512;
  const MAX_CHUNKS = 24;
  const MAX_ZONE_BUILDINGS = 160;
  const MAX_ZONE_TREES = 256;
  const ATLAS_SIZE = 512;
  const BUILDING_SIZES = [128, 256, 320, 512, 1024, 2048];
  const GROUND_DEPTH = -100000;
  const EMPTY = [];

  function webglRendererName(game) {
    const gl = game && game.renderer && game.renderer.gl;
    if (!gl) return "";
    try {
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || "");
    } catch {
      return "";
    }
  }

  function browserWebGLRendererName() {
    const canvas = document.createElement("canvas"),
      gl = canvas.getContext("webgl", { powerPreference: "high-performance" });
    if (!gl) return "";
    try {
      const info = gl.getExtension("WEBGL_debug_renderer_info"),
        name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || ""),
        lose = gl.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
      return name;
    } catch {
      return "";
    }
  }

  class SketchAtlas {
    constructor(renderer, kind, cellSize, anchorY, pageSize, pixelRatio) {
      this.renderer = renderer;
      this.scene = renderer.scene;
      this.kind = kind;
      this.cellSize = cellSize;
      this.anchorY = anchorY;
      this.pageSize = Math.max(cellSize, pageSize || ATLAS_SIZE);
      this.pixelRatio = pixelRatio || 1;
      this.cols = Math.max(1, Math.floor(this.pageSize / cellSize));
      this.capacity = this.cols * this.cols;
      this.pages = [];
      this.records = new Map();
      this.serial = 0;
    }

    _newPage() {
      const index = this.pages.length,
        canvas = document.createElement("canvas");
      canvas.width = this.pageSize * this.pixelRatio;
      canvas.height = this.pageSize * this.pixelRatio;
      const context = canvas.getContext("2d"),
        key = "zs-" + this.renderer.id + "-" + this.kind + "-atlas-" + index,
        texture = this.scene.textures.addCanvas(key, canvas),
        free = [];
      for (let slot = this.capacity - 1; slot >= 0; slot--) {
        const x = (slot % this.cols) * this.cellSize * this.pixelRatio,
          y = Math.floor(slot / this.cols) * this.cellSize * this.pixelRatio,
          size = this.cellSize * this.pixelRatio;
        texture.add("slot-" + slot, 0, x, y, size, size);
        free.push(slot);
      }
      const page = { index, canvas, context, key, texture, free, dirty: false };
      this.pages.push(page);
      return page;
    }

    _allocate(object) {
      let page = null;
      for (let i = 0; i < this.pages.length; i++)
        if (this.pages[i].free.length) {
          page = this.pages[i];
          break;
        }
      if (!page) page = this._newPage();
      const slot = page.free.pop(),
        image = this.scene.add.image(0, 0, page.key, "slot-" + slot),
        originY = this.kind.startsWith("building") ? 0.5 : this.anchorY / this.cellSize,
        record = {
          object,
          page,
          slot,
          image,
          seen: this.serial,
          visualStamp: this._visualStamp(object),
          dirty: true,
        };
      image.setOrigin(0.5, originY);
      if (this.pixelRatio !== 1) image.setDisplaySize(this.cellSize, this.cellSize);
      this.records.set(object, record);
      return record;
    }

    _release(record) {
      const page = record.page,
        x = (record.slot % this.cols) * this.cellSize * this.pixelRatio,
        y = Math.floor(record.slot / this.cols) * this.cellSize * this.pixelRatio,
        size = this.cellSize * this.pixelRatio;
      page.context.clearRect(x, y, size, size);
      page.free.push(record.slot);
      page.dirty = true;
      record.image.destroy();
      this.records.delete(record.object);
    }

    _visualStamp(object) {
      if (!this.kind.startsWith("building")) return 0;
      const door = object.door;
      if (!door) return object.hidden ? 1 : 0;
      const damage = door.maxHp > 0 ? 1 - door.hp / door.maxHp : 0;
      return (
        (object.hidden ? 1 : 0) |
        (door.broken ? 2 : 0) |
        (damage > 0.15 ? 4 : 0) |
        (damage > 0.55 ? 8 : 0)
      );
    }

    _position(record, object) {
      const image = record.image;
      let x = 0,
        y = 0,
        depth = 0;
      if (this.kind === "agent" || this.kind === "tree") {
        x = object.x;
        y = object.y;
        depth = object.y;
      } else if (this.kind === "block") {
        x = (object.x0 + object.x1) / 2;
        y = object.by;
        depth = object.by;
      } else {
        x = object.x + object.w / 2;
        y = object.y + object.h / 2;
        depth = object.y + object.h;
      }
      image.x = x;
      image.y = y;
      if (image.depth !== depth) image.setDepth(depth);
    }

    sync(items) {
      this.serial++;
      let changed = false;
      for (let i = 0; i < items.length; i++) {
        const object = items[i];
        let record = this.records.get(object);
        if (!record) {
          record = this._allocate(object);
          changed = true;
        }
        record.seen = this.serial;
        const visualStamp = this._visualStamp(object);
        if (record.visualStamp !== visualStamp) {
          record.visualStamp = visualStamp;
          record.dirty = true;
          changed = true;
        }
        this._position(record, object);
      }
      for (const record of this.records.values())
        if (record.seen !== this.serial) {
          this._release(record);
          changed = true;
        }
      return changed;
    }

    _paintObject(context, object, t) {
      if (this.kind === "agent") ZS.scenario.draw(context, object, t);
      else if (this.kind === "tree") ZS.drawTreeSketch(context, object, t);
      else if (this.kind === "block") ZS.scenario.drawBlock(context, object, t);
      else ZS.drawBuildingSketch(context, object);
    }

    paint(t, dirtyOnly) {
      for (const record of this.records.values()) {
        if (dirtyOnly && !record.dirty) continue;
        const page = record.page,
          context = page.context,
          x = (record.slot % this.cols) * this.cellSize * this.pixelRatio,
          y = Math.floor(record.slot / this.cols) * this.cellSize * this.pixelRatio,
          size = this.cellSize * this.pixelRatio,
          object = record.object;
        let anchorX = 0,
          anchorY = 0;
        if (this.kind === "agent" || this.kind === "tree") {
          anchorX = object.x;
          anchorY = object.y;
        } else if (this.kind === "block") {
          anchorX = (object.x0 + object.x1) / 2;
          anchorY = object.by;
        } else {
          anchorX = object.x + object.w / 2;
          anchorY = object.y + object.h / 2;
        }
        context.save();
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(x, y, size, size);
        context.beginPath();
        context.rect(x, y, size, size);
        context.clip();
        context.translate(x, y);
        context.scale(this.pixelRatio, this.pixelRatio);
        context.translate(this.cellSize / 2 - anchorX, this.anchorY - anchorY);
        this._paintObject(context, object, t);
        context.restore();
        record.dirty = false;
        page.dirty = true;
      }
      let uploads = 0;
      for (let i = 0; i < this.pages.length; i++) {
        const page = this.pages[i];
        if (!page.dirty) continue;
        page.texture.refresh();
        page.dirty = false;
        uploads++;
      }
      return uploads;
    }

    get size() {
      return this.records.size;
    }
  }

  class BuildingAtlasSet {
    constructor(renderer) {
      this.atlases = [];
      this.buckets = [];
      this.supported = true;
      this.paintCount = 0;
      for (let i = 0; i < BUILDING_SIZES.length; i++) {
        const size = BUILDING_SIZES[i],
          pageSize = size <= 320 ? size * 3 : size <= 512 ? 1024 : size;
        this.atlases.push(
          new SketchAtlas(renderer, "building-" + size, size, size / 2, pageSize, 2),
        );
        this.buckets.push([]);
      }
    }

    sync(items) {
      for (let i = 0; i < this.buckets.length; i++) this.buckets[i].length = 0;
      this.supported = true;
      for (let i = 0; i < items.length; i++) {
        const building = items[i];
        if (building.hidden) continue;
        const span = Math.max(building.w + 24, building.h + 24);
        let bucket = -1;
        for (let j = 0; j < BUILDING_SIZES.length; j++)
          if (span <= BUILDING_SIZES[j]) {
            bucket = j;
            break;
          }
        if (bucket < 0) {
          this.supported = false;
          break;
        }
        this.buckets[bucket].push(building);
      }
      if (!this.supported) for (let i = 0; i < this.buckets.length; i++) this.buckets[i].length = 0;
      let changed = false;
      for (let i = 0; i < this.atlases.length; i++)
        changed = this.atlases[i].sync(this.buckets[i]) || changed;
      return changed;
    }

    paint(t) {
      let uploads = 0;
      for (let i = 0; i < this.atlases.length; i++) uploads += this.atlases[i].paint(t, true);
      this.paintCount++;
      return uploads;
    }

    get size() {
      let total = 0;
      for (let i = 0; i < this.atlases.length; i++) total += this.atlases[i].size;
      return total;
    }

    get pages() {
      let total = 0;
      for (let i = 0; i < this.atlases.length; i++) total += this.atlases[i].pages.length;
      return total;
    }
  }

  class PhaserRenderer {
    constructor(canvas, world) {
      this.canvas = canvas;
      this.world = world;
      this.zone = Boolean(world.zoneMap);
      this.id = this.zone ? "zone" : "hold";
      this.chunkSize = this.zone
        ? Math.max(HOLD_CHUNK_SIZE, world.chunkSize || 1024)
        : HOLD_CHUNK_SIZE;
      this.ready = false;
      this.failed = false;
      this.paintCount = 0;
      this.paintMs = 0;
      this.scene = null;
      this.chunks = new Map();
      this.chunkTick = 0;
      this.groundStateKey = "";
      this.groundVersion = 0;
      this.actorBoil = -1;
      this.actorPaintCount = 0;
      this.actorPaintMs = 0;
      this.agentAtlas = null;
      this.blockAtlas = null;
      this.treeAtlas = null;
      this.buildingAtlases = null;
      this.visibleAgents = [];
      this.visibleTrees = [];
      this.visibleBuildings = [];
      this.overview = null;
      this.overviewActive = false;
      this.actorFallback = false;
      this.forceActorAtlases = new URLSearchParams(location.search).get("forceWebGLActors") === "1";
      this.rendererName = "";
      this.softwareRenderer = false;
      this.useActorAtlases = true;
      this.buildingLod = false;
      this.treeLod = false;
      this.renderOptions = this.zone
        ? {
            ground: true,
            baseGround: false,
            dynamicGround: true,
            trees: false,
            buildings: false,
            buildingOverlays: true,
            buildingInk: false,
            buildingInkWidth: 1.75,
            buildingInkAmp: 0.85,
            buildingInkAlpha: 0,
            blocks: false,
            agents: false,
          }
        : { ground: false, blocks: false, agents: false };
      this.pendingWidth = Math.max(1, window.innerWidth);
      this.pendingHeight = Math.max(1, window.innerHeight);

      if (!window.Phaser) {
        this.failed = true;
        return;
      }
      this.rendererName = browserWebGLRendererName();
      this.softwareRenderer = /swiftshader|llvmpipe|software/i.test(this.rendererName);
      if (this.zone && this.softwareRenderer && !this.forceActorAtlases) {
        this.failed = true;
        this.useActorAtlases = false;
        this.stats = {
          backend: "canvas2d-software-fallback",
          mode: this.id,
          actorBackend: "canvas-software-fallback",
          softwareRenderer: true,
          rendererName: this.rendererName,
        };
        return;
      }

      const renderer = this;
      try {
        this.game = new Phaser.Game({
          type: Phaser.WEBGL,
          canvas,
          width: this.pendingWidth,
          height: this.pendingHeight,
          transparent: false,
          backgroundColor: "#efe8d8",
          banner: false,
          render: {
            antialias: true,
            roundPixels: false,
            powerPreference: "high-performance",
          },
          audio: { noAudio: true },
          scene: {
            create() {
              renderer._create(this);
            },
          },
        });
      } catch (error) {
        this.failed = true;
        console.warn("Phaser renderer unavailable; using Canvas 2D", error);
      }
    }

    _create(scene) {
      this.scene = scene;
      scene.cameras.main.setBackgroundColor("#efe8d8");
      this.rendererName = webglRendererName(this.game);
      this.softwareRenderer = /swiftshader|llvmpipe|software/i.test(this.rendererName);
      this.useActorAtlases = !this.zone || !this.softwareRenderer || this.forceActorAtlases;
      this.agentAtlas = new SketchAtlas(this, "agent", 64, 40);
      if (this.zone) {
        this.treeAtlas = new SketchAtlas(this, "tree", 64, 48);
        this.buildingAtlases = new BuildingAtlasSet(this);
        this._createOverview();
      } else this.blockAtlas = new SketchAtlas(this, "block", 96, 88);
      this.ready = true;
      this.resize(this.pendingWidth, this.pendingHeight);
    }

    _createOverview() {
      const canvas = this.world.overviewCanvas;
      if (!canvas) return;
      const key = "zs-zone-overview",
        texture = this.scene.textures.addCanvas(key, canvas),
        image = this.scene.add
          .image(0, 0, key)
          .setOrigin(0, 0)
          .setDisplaySize(this.world.w, this.world.h)
          .setDepth(GROUND_DEPTH);
      image.visible = false;
      this.overview = { canvas, texture, image };
    }

    _chunk(cx, cy) {
      const key = cx + ":" + cy,
        current = this.chunks.get(key);
      if (current) return current;
      const size = this.chunkSize,
        x = cx * size,
        y = cy * size,
        width = Math.min(size, this.world.w - x),
        height = Math.min(size, this.world.h - y),
        source = document.createElement("canvas"),
        base = document.createElement("canvas");
      source.width = width;
      source.height = height;
      base.width = width;
      base.height = height;
      const context = source.getContext("2d", { alpha: false }),
        baseContext = base.getContext("2d", { alpha: false }),
        visible = { x0: x, y0: y, x1: x + width, y1: y + height };
      if (!context || !baseContext) return null;
      ZS.drawGroundBaseTexture(baseContext, this.world, visible);
      context.drawImage(base, 0, 0);
      const textureKey = "zs-" + this.id + "-ground-" + key,
        texture = this.scene.textures.addCanvas(textureKey, source),
        image = this.scene.add.image(x, y, textureKey).setOrigin(0, 0).setDepth(GROUND_DEPTH),
        record = {
          key,
          x,
          y,
          width,
          height,
          source,
          base,
          context,
          texture,
          image,
          boil: -1,
          version: -1,
          used: this.chunkTick,
        };
      this.chunks.set(key, record);
      return record;
    }

    _paint(record, t, boil, dynamic = true) {
      const visible = {
        x0: record.x,
        y0: record.y,
        x1: record.x + record.width,
        y1: record.y + record.height,
      };
      record.context.setTransform(1, 0, 0, 1, 0, 0);
      if (dynamic) {
        record.context.drawImage(record.base, 0, 0);
        ZS.drawGroundOverlayTexture(record.context, this.world, t, visible);
      } else ZS.drawGroundBaseTexture(record.context, this.world, visible);
      record.texture.refresh();
      record.boil = boil;
      record.version = this.groundVersion;
      this.paintCount++;
    }

    _updateGroundState() {
      const scenario = ZS.scenario;
      if (this.zone) {
        const stateKey = String(this.world.nav ? this.world.nav.version : 0);
        if (stateKey !== this.groundStateKey) {
          this.groundStateKey = stateKey;
          this.groundVersion++;
        }
        return;
      }
      const tiles = scenario.tiles,
        hover = scenario.hover,
        hoverTile =
          hover && tiles && typeof scenario.tool === "string"
            ? tiles.tileAt(hover.x, hover.y)
            : null,
        stateKey =
          (tiles ? tiles.version : 0) +
          ":" +
          scenario.phase +
          ":" +
          String(scenario.tool) +
          ":" +
          (hoverTile ? hoverTile[0] + "," + hoverTile[1] : "-");
      if (stateKey !== this.groundStateKey) {
        this.groundStateKey = stateKey;
        this.groundVersion++;
      }
    }

    _chunkAnimated(record) {
      if (this.zone) return true;
      const scenario = ZS.scenario;
      if (scenario.phase !== "day") return true;
      if (
        scenario.hover &&
        typeof scenario.tool === "string" &&
        scenario.hover.x >= record.x &&
        scenario.hover.x <= record.x + record.width &&
        scenario.hover.y >= record.y &&
        scenario.hover.y <= record.y + record.height
      )
        return true;
      return scenario.tiles.hasActive({
        x0: record.x,
        y0: record.y,
        x1: record.x + record.width,
        y1: record.y + record.height,
      });
    }

    _prune() {
      while (this.chunks.size > MAX_CHUNKS) {
        let oldest = null;
        for (const record of this.chunks.values())
          if (!oldest || record.used < oldest.used) oldest = record;
        if (!oldest) return;
        oldest.image.destroy();
        this.scene.textures.remove(oldest.texture.key);
        this.chunks.delete(oldest.key);
      }
    }

    _showOverview(show) {
      this.overviewActive = Boolean(show && this.overview);
      if (this.overview) this.overview.image.visible = this.overviewActive;
      for (const record of this.chunks.values()) record.image.visible = !this.overviewActive;
      if (!this.zone) return;
      // The static paper and floor wash live on the GPU. Roads, water ink,
      // defenses and time-of-day tint remain on the transparent overlay so
      // they can boil without uploading several megapixels every 140 ms.
      this.renderOptions.ground = true;
      this.renderOptions.baseGround = false;
      this.renderOptions.dynamicGround = true;
    }

    _syncHoldActors(sim, t, boil) {
      const blocks = this.world.blocks ? this.world.blocks.list : [],
        blocksChanged = this.blockAtlas.sync(blocks),
        agentsChanged = this.agentAtlas.sync(sim.agents),
        changed = blocksChanged || agentsChanged;
      if (!changed && boil === this.actorBoil) return;
      const started = performance.now();
      this.blockAtlas.paint(t);
      this.agentAtlas.paint(t);
      this.actorBoil = boil;
      this.actorPaintCount++;
      this.actorPaintMs = performance.now() - started;
    }

    _collectZoneActors(sim, visible) {
      const agents = this.visibleAgents;
      agents.length = 0;
      for (let i = 0; i < sim.agents.length; i++) {
        const agent = sim.agents[i];
        if (
          agent.x >= visible.x0 &&
          agent.x <= visible.x1 &&
          agent.y >= visible.y0 &&
          agent.y <= visible.y1
        )
          agents.push(agent);
      }
      if (this.world.queryVisible) {
        this.world.queryVisible("trees", visible, this.visibleTrees);
        this.world.queryVisible("buildings", visible, this.visibleBuildings);
        let count = 0;
        for (let i = 0; i < this.visibleTrees.length; i++) {
          const tree = this.visibleTrees[i];
          if (
            !tree.hidden &&
            tree.x >= visible.x0 - tree.r &&
            tree.x <= visible.x1 + tree.r &&
            tree.y >= visible.y0 &&
            tree.y <= visible.y1 + tree.r * 2
          )
            this.visibleTrees[count++] = tree;
        }
        this.visibleTrees.length = count;
        count = 0;
        for (let i = 0; i < this.visibleBuildings.length; i++) {
          const building = this.visibleBuildings[i];
          if (
            !building.hidden &&
            building.x + building.w >= visible.x0 &&
            building.x <= visible.x1 &&
            building.y + building.h >= visible.y0 &&
            building.y <= visible.y1
          )
            this.visibleBuildings[count++] = building;
        }
        this.visibleBuildings.length = count;
      } else {
        this.visibleTrees.length = 0;
        this.visibleBuildings.length = 0;
        for (let i = 0; i < this.world.trees.length; i++)
          if (!this.world.trees[i].hidden) this.visibleTrees.push(this.world.trees[i]);
        for (let i = 0; i < this.world.buildings.length; i++)
          this.visibleBuildings.push(this.world.buildings[i]);
      }
    }

    _syncZoneActors(sim, t, boil, visible) {
      this._collectZoneActors(sim, visible);
      if (!this.useActorAtlases) {
        const buildingsChanged = this.buildingAtlases.sync(EMPTY),
          treesChanged = this.treeAtlas.sync(EMPTY),
          agentsChanged = this.agentAtlas.sync(EMPTY);
        this.actorFallback = true;
        this.buildingLod = false;
        this.treeLod = false;
        this.renderOptions.agents = true;
        this.renderOptions.trees = true;
        this.renderOptions.buildings = true;
        this.renderOptions.buildingOverlays = true;
        if (buildingsChanged || treesChanged || agentsChanged) {
          this.buildingAtlases.paint(t);
          this.treeAtlas.paint(t);
          this.agentAtlas.paint(t);
        }
        return;
      }
      this.buildingLod = this.buildingLod
        ? this.visibleBuildings.length > MAX_ZONE_BUILDINGS - 32
        : this.visibleBuildings.length > MAX_ZONE_BUILDINGS;
      this.treeLod = this.visibleTrees.length > MAX_ZONE_TREES;
      const buildings = this.buildingLod ? EMPTY : this.visibleBuildings,
        trees = this.treeLod ? EMPTY : this.visibleTrees,
        buildingChanged = this.buildingAtlases.sync(buildings);
      this.actorFallback = !this.buildingAtlases.supported;
      const agentsChanged = this.agentAtlas.sync(this.actorFallback ? EMPTY : this.visibleAgents),
        treesChanged = this.treeAtlas.sync(this.actorFallback ? EMPTY : trees),
        actorsChanged = agentsChanged || treesChanged,
        actorsNeedPaint = actorsChanged || boil !== this.actorBoil;
      this.renderOptions.agents = this.actorFallback;
      this.renderOptions.trees = this.actorFallback;
      this.renderOptions.buildings = this.actorFallback;
      this.renderOptions.buildingOverlays = this.actorFallback || !this.buildingLod;
      if (!buildingChanged && !actorsNeedPaint) return;
      const started = performance.now();
      if (buildingChanged) this.buildingAtlases.paint(t);
      if (actorsNeedPaint) {
        this.treeAtlas.paint(t);
        this.agentAtlas.paint(t);
        this.actorBoil = boil;
      }
      this.actorPaintCount++;
      this.actorPaintMs = performance.now() - started;
    }

    resize(width, height) {
      this.pendingWidth = width;
      this.pendingHeight = height;
      this.canvas.style.width = width + "px";
      this.canvas.style.height = height + "px";
      if (!this.ready || this.failed || !this.scene.scale) return;
      this.scene.scale.resize(width, height);
    }

    update(cam, sim, t, width, height) {
      if (!this.ready || this.failed) return false;
      const camera = this.scene.cameras.main;
      camera.setZoom(cam.zoom);
      camera.centerOn(cam.x, cam.y);

      const boil = Math.floor((t * 1000) / BOIL_MS),
        visible = cam.visible(width, height, 80),
        size = this.chunkSize,
        x0 = Math.max(0, Math.floor(visible.x0 / size)),
        y0 = Math.max(0, Math.floor(visible.y0 / size)),
        x1 = Math.min(Math.ceil(this.world.w / size) - 1, Math.floor(visible.x1 / size)),
        y1 = Math.min(Math.ceil(this.world.h / size) - 1, Math.floor(visible.y1 / size)),
        visibleChunkCount = Math.max(0, x1 - x0 + 1) * Math.max(0, y1 - y0 + 1),
        useOverview = this.zone && visibleChunkCount > MAX_CHUNKS && this.overview;
      this._showOverview(useOverview);
      this._updateGroundState();
      this.chunkTick++;
      const started = performance.now(),
        paintsBefore = this.paintCount;
      if (!this.overviewActive)
        for (let cy = y0; cy <= y1; cy++)
          for (let cx = x0; cx <= x1; cx++) {
            const record = this._chunk(cx, cy);
            if (!record) continue;
            record.image.visible = true;
            record.used = this.chunkTick;
            if (this.zone) {
              if (record.version !== this.groundVersion) this._paint(record, t, boil, false);
            } else if (
              record.version !== this.groundVersion ||
              (this._chunkAnimated(record) && record.boil !== boil)
            )
              this._paint(record, t, boil);
          }
      if (this.paintCount !== paintsBefore) this.paintMs = performance.now() - started;
      this._prune();
      if (this.zone) this._syncZoneActors(sim, t, boil, visible);
      else this._syncHoldActors(sim, t, boil);

      if (this.zone) {
        const inkAlpha =
          !this.actorFallback && !this.overviewActive
            ? this.buildingLod
              ? 1
              : Math.max(0, Math.min(1, (1.05 - cam.zoom) / 0.35))
            : 0;
        this.renderOptions.buildingInk = inkAlpha > 0.001;
        this.renderOptions.buildingInkAlpha = inkAlpha;
        this.renderOptions.buildingInkWidth = Math.max(1.75, 1.25 / cam.zoom);
        this.renderOptions.buildingInkAmp = Math.max(0.85, 0.55 / cam.zoom);
      }

      const blockSprites = this.blockAtlas ? this.blockAtlas.size : 0,
        treeSprites = this.treeAtlas ? this.treeAtlas.size : 0,
        buildingSprites = this.buildingAtlases ? this.buildingAtlases.size : 0,
        actorAtlases =
          (this.blockAtlas ? this.blockAtlas.pages.length : 0) +
          (this.agentAtlas ? this.agentAtlas.pages.length : 0) +
          (this.treeAtlas ? this.treeAtlas.pages.length : 0) +
          (this.buildingAtlases ? this.buildingAtlases.pages : 0);
      this.stats = {
        backend: "phaser-webgl-sketch",
        mode: this.id,
        width,
        height,
        chunkSize: this.chunkSize,
        chunks: this.chunks.size,
        overview: this.overviewActive,
        paints: this.paintCount,
        lastPaintMs: this.paintMs,
        blockSprites,
        treeSprites,
        buildingSprites,
        buildingPaints: this.buildingAtlases ? this.buildingAtlases.paintCount : 0,
        agentSprites: this.agentAtlas.size,
        visibleBuildings: this.visibleBuildings.length,
        actorAtlases,
        actorPaints: this.actorPaintCount,
        lastActorPaintMs: this.actorPaintMs,
        actorFallback: this.actorFallback,
        actorBackend: this.useActorAtlases ? "webgl-atlas" : "canvas-software-fallback",
        softwareRenderer: this.softwareRenderer,
        rendererName: this.rendererName,
        buildingLod: this.buildingLod,
        buildingInk: Boolean(this.renderOptions.buildingInk),
        buildingInkAlpha: this.renderOptions.buildingInkAlpha || 0,
        buildingInkScreenWidth: (this.renderOptions.buildingInkWidth || 0) * cam.zoom,
        treeLod: this.treeLod,
      };
      return true;
    }

    destroy() {
      if (this.game) this.game.destroy(true);
      this.ready = false;
    }
  }

  ZS.PhaserRenderer = PhaserRenderer;
  ZS.PhaserGroundRenderer = PhaserRenderer;
})();
