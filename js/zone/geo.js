/* Real-world map selection, OpenStreetMap normalization and offline map-pack
   caching. Everything stays in one classic IIFE so zone.html still works when
   opened directly through file://. Live services are adapters: a deployment
   may replace their URLs without changing the game code. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});
  const CFG = ZS.ZoneConfig;
  const GEO = CFG.GEO;
  const MAP = CFG.MAP;
  const EARTH_M = 111320;

  function finite(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function hashText(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }

  function hashNumber(text) {
    return parseInt(hashText(text), 16) >>> 0;
  }

  function cleanText(value, fallback, max) {
    if (typeof value !== "string") return fallback || "";
    return (
      value
        .replace(/[<>]/g, "")
        .trim()
        .slice(0, max || 120) ||
      fallback ||
      ""
    );
  }

  function sizePreset(id) {
    return MAP.SIZE_PRESETS[id] || MAP.SIZE_PRESETS.standard;
  }

  function boundsOf(points) {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
  }

  function intersects(bounds, w, h, pad) {
    const p = pad || 0;
    return bounds.x1 >= -p && bounds.y1 >= -p && bounds.x0 <= w + p && bounds.y0 <= h + p;
  }

  function polygonArea(points) {
    let area = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++)
      area += points[j].x * points[i].y - points[i].x * points[j].y;
    return Math.abs(area) * 0.5;
  }

  function pointInPoly(x, y, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i],
        b = points[j];
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x)
        inside = !inside;
    }
    return inside;
  }

  function simplify(points, minDistance) {
    if (points.length < 3) return points;
    const out = [points[0]];
    let last = points[0];
    const d2 = minDistance * minDistance;
    for (let i = 1; i < points.length - 1; i++) {
      const p = points[i],
        dx = p.x - last.x,
        dy = p.y - last.y;
      if (dx * dx + dy * dy < d2) continue;
      out.push(p);
      last = p;
    }
    out.push(points[points.length - 1]);
    return out;
  }

  function mapBounds(lat, lon, preset) {
    const meters = Math.max(1, preset.cells) * MAP.SECTOR_METERS,
      halfLat = meters / EARTH_M / 2,
      halfLon = halfLat / Math.max(0.08, Math.cos((lat * Math.PI) / 180));
    return {
      south: lat - halfLat,
      west: lon - halfLon,
      north: lat + halfLat,
      east: lon + halfLon,
    };
  }

  function projector(lat, lon, w, h) {
    const lonScale = EARTH_M * Math.cos((lat * Math.PI) / 180) * MAP.PIXELS_PER_METER,
      latScale = EARTH_M * MAP.PIXELS_PER_METER;
    return (sourceLon, sourceLat) => ({
      x: w / 2 + (sourceLon - lon) * lonScale,
      y: h / 2 - (sourceLat - lat) * latScale,
    });
  }

  function selectedTags(tags) {
    const source = tags || {},
      out = {},
      keys = [
        "name",
        "building",
        "amenity",
        "shop",
        "landuse",
        "natural",
        "water",
        "waterway",
        "highway",
        "leisure",
        "entrance",
        "bridge",
        "tunnel",
        "addr:housenumber",
        "addr:street",
      ];
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (source[key] !== undefined) out[key] = cleanText(String(source[key]), "", 100);
    }
    return out;
  }

  function poiFromTags(tags) {
    const amenity = tags.amenity || "",
      shop = tags.shop || "",
      building = tags.building || "";
    if (["supermarket", "convenience", "greengrocer", "bakery", "food"].includes(shop))
      return CFG.POI.GROCERY;
    if (["pharmacy", "hospital", "clinic", "doctors"].includes(amenity)) return CFG.POI.PHARMACY;
    if (["police", "fire_station"].includes(amenity)) return CFG.POI.POLICE;
    if (["warehouse", "industrial"].includes(building) || tags.landuse === "industrial")
      return CFG.POI.WAREHOUSE;
    if (["garage", "garages", "service"].includes(building) || shop === "car_repair")
      return CFG.POI.WORKSHOP;
    if (["library", "school", "college", "university"].includes(amenity)) return CFG.POI.LIBRARY;
    return CFG.POI.RESIDENCE;
  }

  function roadWidth(tags) {
    const kind = tags.highway;
    if (kind === "motorway") return 38;
    if (kind === "trunk") return 34;
    if (kind === "primary") return 30;
    if (kind === "secondary") return 26;
    if (kind === "tertiary") return 22;
    if (kind === "residential" || kind === "living_street") return 18;
    if (kind === "service") return 12;
    return 7;
  }

  function joinWays(memberWays) {
    const remaining = memberWays.map((nodes) => nodes.slice()),
      rings = [];
    while (remaining.length) {
      const ring = remaining.pop();
      let changed = true;
      while (changed && ring[0] !== ring[ring.length - 1]) {
        changed = false;
        for (let i = remaining.length - 1; i >= 0; i--) {
          const part = remaining[i],
            first = ring[0],
            last = ring[ring.length - 1],
            pf = part[0],
            pl = part[part.length - 1];
          if (last === pf) ring.push(...part.slice(1));
          else if (last === pl) ring.push(...part.slice(0, -1).reverse());
          else if (first === pl) ring.unshift(...part.slice(0, -1));
          else if (first === pf) ring.unshift(...part.slice(1).reverse());
          else continue;
          remaining.splice(i, 1);
          changed = true;
          break;
        }
      }
      if (ring.length >= 4) rings.push(ring);
    }
    return rings;
  }

  function makeRegions(lat, lon, preset) {
    const cells = Math.max(1, preset.cells),
      radius = (cells - 1) / 2,
      outer = radius + 1,
      latStep = MAP.SECTOR_METERS / EARTH_M,
      lonStep = latStep / Math.max(0.08, Math.cos((lat * Math.PI) / 180)),
      regions = [];
    for (let gy = -outer; gy <= outer; gy++)
      for (let gx = -outer; gx <= outer; gx++) {
        const active = Math.abs(gx) <= radius && Math.abs(gy) <= radius;
        regions.push({
          id: "r:" + gx + ":" + gy,
          gx,
          gy,
          active,
          lat: lat - gy * latStep,
          lon: lon + gx * lonStep,
          links: [],
        });
      }
    const byId = new Map(regions.map((region) => [region.id, region]));
    for (let i = 0; i < regions.length; i++) {
      const r = regions[i],
        candidates = [
          "r:" + (r.gx - 1) + ":" + r.gy,
          "r:" + (r.gx + 1) + ":" + r.gy,
          "r:" + r.gx + ":" + (r.gy - 1),
          "r:" + r.gx + ":" + (r.gy + 1),
        ];
      for (let j = 0; j < candidates.length; j++)
        if (byId.has(candidates[j])) r.links.push(candidates[j]);
    }
    return regions;
  }

  function geometryHash(buildings, roads, waters) {
    const fingerprint = buildings
      .map(
        (building) =>
          building.sourceKey +
          ":" +
          Math.round(building.bounds.x0) +
          ":" +
          Math.round(building.bounds.y0),
      )
      .join("|");
    return hashText(fingerprint + "#" + roads.length + "#" + waters.length);
  }

  function normalizeOverpass(raw, selection, sizeId) {
    if (!raw || !Array.isArray(raw.elements))
      throw new Error("La respuesta OSM no contiene elementos.");
    const preset = sizePreset(sizeId),
      w = preset.w,
      h = preset.h,
      lat = finite(selection.lat, 0),
      lon = finite(selection.lon, 0),
      project = projector(lat, lon, w, h),
      nodes = new Map(),
      ways = new Map(),
      relations = [],
      elements = raw.elements;
    for (let i = 0; i < elements.length; i++) {
      const item = elements[i];
      if (item.type === "node") nodes.set(item.id, item);
      else if (item.type === "way") ways.set(item.id, item);
      else if (item.type === "relation") relations.push(item);
    }

    const pointsFor = (nodeIds) => {
      const points = [];
      for (let i = 0; i < nodeIds.length; i++) {
        const node = nodes.get(nodeIds[i]);
        if (node) points.push(project(node.lon, node.lat));
      }
      return simplify(points, 2.5);
    };
    const relationRings = (relation, role) => {
      const members = [];
      for (let i = 0; i < relation.members.length; i++) {
        const member = relation.members[i];
        if (member.type !== "way" || (member.role || "outer") !== role) continue;
        const way = ways.get(member.ref);
        if (way && Array.isArray(way.nodes)) members.push(way.nodes);
      }
      return joinWays(members)
        .map(pointsFor)
        .filter((points) => points.length >= 3);
    };

    const relationWayIds = new Set(),
      buildings = [],
      waters = [],
      land = [],
      roads = [],
      pois = [];
    for (let i = 0; i < relations.length; i++) {
      const relation = relations[i],
        tags = selectedTags(relation.tags);
      if (!tags.building && tags.natural !== "water" && !tags.water && !tags.landuse) continue;
      for (let j = 0; j < relation.members.length; j++)
        if (relation.members[j].type === "way") relationWayIds.add(relation.members[j].ref);
      const rings = relationRings(relation, "outer");
      for (let j = 0; j < rings.length; j++) {
        const points = rings[j],
          bounds = boundsOf(points);
        if (!intersects(bounds, w, h, 80)) continue;
        if (tags.building && polygonArea(points) >= 700)
          buildings.push({ sourceKey: "r/" + relation.id + ":" + j, points, bounds, tags });
        else if (tags.natural === "water" || tags.water || tags.waterway)
          waters.push({ sourceKey: "r/" + relation.id + ":" + j, points, bounds, tags });
        else if (tags.landuse || tags.leisure) land.push({ points, bounds, tags });
      }
    }

    for (const way of ways.values()) {
      const tags = selectedTags(way.tags),
        points = pointsFor(way.nodes || []);
      if (points.length < 2) continue;
      const bounds = boundsOf(points);
      if (!intersects(bounds, w, h, 80)) continue;
      if (tags.highway) {
        roads.push({
          sourceKey: "w/" + way.id,
          points,
          bounds,
          tags,
          width: roadWidth(tags),
          seed: hashNumber("road/" + way.id),
        });
      } else if (!relationWayIds.has(way.id) && tags.building && points.length >= 3) {
        if (polygonArea(points) >= 700)
          buildings.push({ sourceKey: "w/" + way.id, points, bounds, tags, nodeIds: way.nodes });
      } else if (
        !relationWayIds.has(way.id) &&
        points.length >= 3 &&
        (tags.natural === "water" || tags.water || tags.waterway === "riverbank")
      )
        waters.push({ sourceKey: "w/" + way.id, points, bounds, tags });
      else if (!relationWayIds.has(way.id) && points.length >= 3 && (tags.landuse || tags.leisure))
        land.push({ points, bounds, tags });
    }

    for (const node of nodes.values()) {
      const tags = selectedTags(node.tags);
      if (!tags.amenity && !tags.shop) continue;
      const point = project(node.lon, node.lat);
      if (point.x < 0 || point.y < 0 || point.x > w || point.y > h) continue;
      pois.push({ point, tags, poi: poiFromTags(tags) });
    }

    buildings.sort((a, b) => a.sourceKey.localeCompare(b.sourceKey));
    const maxBuildings = MAP.MAX_BUILDINGS_BY_SIZE[sizeId] || MAP.MAX_BUILDINGS_BY_SIZE.standard;
    if (buildings.length > maxBuildings) {
      buildings.sort((a, b) => {
        const acx = (a.bounds.x0 + a.bounds.x1) / 2 - w / 2,
          acy = (a.bounds.y0 + a.bounds.y1) / 2 - h / 2,
          bcx = (b.bounds.x0 + b.bounds.x1) / 2 - w / 2,
          bcy = (b.bounds.y0 + b.bounds.y1) / 2 - h / 2;
        return acx * acx + acy * acy - (bcx * bcx + bcy * bcy);
      });
      buildings.length = maxBuildings;
      buildings.sort((a, b) => a.sourceKey.localeCompare(b.sourceKey));
    }
    for (let i = 0; i < buildings.length; i++) {
      const building = buildings[i];
      building.id = i;
      building.poi = poiFromTags(building.tags);
      building.name =
        cleanText(building.tags.name, "", 80) ||
        cleanText(
          [building.tags["addr:street"], building.tags["addr:housenumber"]]
            .filter(Boolean)
            .join(" "),
          "edificio " + String(i + 1).padStart(3, "0"),
          80,
        );
      for (let j = 0; j < pois.length; j++) {
        const poi = pois[j];
        if (!pointInPoly(poi.point.x, poi.point.y, building.points)) continue;
        building.poi = poi.poi;
        if (poi.tags.name) building.name = cleanText(poi.tags.name, building.name, 80);
        break;
      }
      delete building.nodeIds;
    }

    const hash = geometryHash(buildings, roads, waters),
      bbox = mapBounds(lat, lon, preset);
    return {
      version: GEO.MAP_PACK_VERSION,
      id: "osm:" + lat.toFixed(5) + ":" + lon.toFixed(5) + ":" + sizeId + ":" + hash,
      hash,
      source: "osm",
      name: cleanText(selection.name, "Zona sin nombre", 120),
      center: { lat, lon },
      bbox,
      size: sizeId,
      width: w,
      height: h,
      pixelsPerMeter: MAP.PIXELS_PER_METER,
      fetchedAt: new Date().toISOString(),
      attribution: GEO.ATTRIBUTION,
      buildings,
      roads,
      waters,
      land,
      elevation: null,
      regions: makeRegions(lat, lon, preset),
    };
  }

  function normalizePack(raw) {
    if (!raw || raw.version !== GEO.MAP_PACK_VERSION || raw.source !== "osm")
      throw new Error("El archivo no es un MapPack compatible.");
    const size = sizePreset(raw.size),
      center = {
        lat: ZS.clamp(finite(raw.center && raw.center.lat, 0), -85, 85),
        lon: ZS.clamp(finite(raw.center && raw.center.lon, 0), -180, 180),
      },
      normalizePoints = (source, minimum) => {
        if (!Array.isArray(source) || source.length < minimum || source.length > 2048) return null;
        const points = [];
        for (let i = 0; i < source.length; i++) {
          const x = finite(source[i] && source[i].x, NaN),
            y = finite(source[i] && source[i].y, NaN);
          if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
          points.push({
            x: ZS.clamp(x, -200, size.w + 200),
            y: ZS.clamp(y, -200, size.h + 200),
          });
        }
        return points;
      },
      normalizeShapes = (source, kind, maximum) => {
        if (!Array.isArray(source) || source.length > maximum)
          throw new Error("El MapPack contiene demasiados elementos " + kind + ".");
        const out = [];
        for (let i = 0; i < source.length; i++) {
          const item = source[i] || {},
            points = normalizePoints(item.points, kind === "carretera" ? 2 : 3);
          if (!points) continue;
          const bounds = boundsOf(points);
          if (!intersects(bounds, size.w, size.h, 200)) continue;
          if (kind === "edificio" && polygonArea(points) < 700) continue;
          if (kind !== "carretera" && kind !== "edificio" && polygonArea(points) < 20) continue;
          const shape = {
            sourceKey: cleanText(item.sourceKey, kind + "/" + i, 100),
            points,
            bounds,
            tags: selectedTags(item.tags),
          };
          if (kind === "edificio") {
            shape.id = out.length;
            shape.name = cleanText(
              item.name,
              "edificio " + String(out.length + 1).padStart(3, "0"),
              80,
            );
            shape.poi = ZS.clamp(
              Math.trunc(finite(item.poi, CFG.POI.RESIDENCE)),
              CFG.POI.RESIDENCE,
              CFG.POI.LIBRARY,
            );
          } else if (kind === "carretera") {
            shape.width = ZS.clamp(finite(item.width, roadWidth(shape.tags)), 4, 48);
            shape.seed = Math.trunc(finite(item.seed, hashNumber(shape.sourceKey)));
          }
          out.push(shape);
        }
        return out;
      },
      buildings = normalizeShapes(
        raw.buildings,
        "edificio",
        MAP.MAX_BUILDINGS_BY_SIZE[size.id] || MAP.MAX_BUILDINGS_BY_SIZE.standard,
      ),
      roads = normalizeShapes(raw.roads, "carretera", 20000),
      waters = normalizeShapes(raw.waters, "agua", 5000),
      land = normalizeShapes(raw.land, "terreno", 5000),
      hash = geometryHash(buildings, roads, waters),
      pack = {
        version: GEO.MAP_PACK_VERSION,
        id: cleanText(raw.id, "", 180),
        hash,
        source: "osm",
        name: cleanText(raw.name, "Zona importada", 120),
        center,
        bbox: mapBounds(center.lat, center.lon, size),
        size: size.id,
        width: size.w,
        height: size.h,
        pixelsPerMeter: MAP.PIXELS_PER_METER,
        fetchedAt: cleanText(raw.fetchedAt, "", 40),
        attribution: GEO.ATTRIBUTION,
        buildings,
        roads,
        waters,
        land,
        elevation: normalizeElevation(raw.elevation),
        regions: makeRegions(center.lat, center.lon, size),
      };
    if (
      !pack.id ||
      !cleanText(raw.hash, "", 32) ||
      cleanText(raw.hash, "", 32) !== hash ||
      !pack.buildings.length
    )
      throw new Error("El MapPack está incompleto o no contiene edificios.");
    return pack;
  }

  function normalizeElevation(source) {
    if (!source) return null;
    const cols = Math.trunc(finite(source.cols, 0)),
      rows = Math.trunc(finite(source.rows, 0));
    if (
      cols < 2 ||
      rows < 2 ||
      cols > 32 ||
      rows > 32 ||
      !Array.isArray(source.values) ||
      source.values.length !== cols * rows
    )
      return null;
    const values = [];
    let min = Infinity,
      max = -Infinity;
    for (let i = 0; i < source.values.length; i++) {
      const height = finite(source.values[i], NaN);
      if (!Number.isFinite(height) || height < -500 || height > 9000) return null;
      values.push(height);
      min = Math.min(min, height);
      max = Math.max(max, height);
    }
    return {
      cols,
      rows,
      values,
      min,
      max,
      source: cleanText(source.source, "relieve Terrarium", 80),
    };
  }

  function parseOsmXml(text) {
    const documentNode = new DOMParser().parseFromString(text, "application/xml");
    if (documentNode.querySelector("parsererror"))
      throw new Error("La API de OpenStreetMap devolvió XML inválido.");
    const childrenOf = (element, name) =>
        Array.from(element.children || []).filter(
          (child) => child.localName === name || child.tagName === name,
        ),
      tagsOf = (element) => {
        const tags = {};
        for (const tag of childrenOf(element, "tag"))
          tags[tag.getAttribute("k")] = tag.getAttribute("v") || "";
        return tags;
      },
      elements = [];
    for (const node of documentNode.querySelectorAll("osm > node"))
      elements.push({
        type: "node",
        id: Number(node.getAttribute("id")),
        lat: Number(node.getAttribute("lat")),
        lon: Number(node.getAttribute("lon")),
        tags: tagsOf(node),
      });
    for (const way of documentNode.querySelectorAll("osm > way"))
      elements.push({
        type: "way",
        id: Number(way.getAttribute("id")),
        nodes: childrenOf(way, "nd").map((node) => Number(node.getAttribute("ref"))),
        tags: tagsOf(way),
      });
    for (const relation of documentNode.querySelectorAll("osm > relation"))
      elements.push({
        type: "relation",
        id: Number(relation.getAttribute("id")),
        members: childrenOf(relation, "member").map((member) => ({
          type: member.getAttribute("type"),
          ref: Number(member.getAttribute("ref")),
          role: member.getAttribute("role") || "",
        })),
        tags: tagsOf(relation),
      });
    return { elements };
  }

  async function request(url, options) {
    const controller = new AbortController(),
      timer = window.setTimeout(() => controller.abort(), GEO.REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(
        url,
        Object.assign({}, options || {}, { signal: controller.signal }),
      );
      if (!response.ok) throw new Error("El servicio respondió " + response.status + ".");
      return response;
    } catch (error) {
      if (error && error.name === "AbortError") throw new Error("La descarga tardó demasiado.");
      throw error;
    } finally {
      window.clearTimeout(timer);
    }
  }

  class ZoneMapCache {
    constructor() {
      this.memory = new Map();
      this.db = null;
    }

    async _open() {
      if (this.db) return this.db;
      if (!window.indexedDB) return null;
      this.db = await new Promise((resolve) => {
        let settled = false;
        const done = (value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        try {
          const req = indexedDB.open(GEO.CACHE_DB, 1);
          req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains(GEO.CACHE_STORE))
              req.result.createObjectStore(GEO.CACHE_STORE, { keyPath: "id" });
          };
          req.onsuccess = () => done(req.result);
          req.onerror = () => done(null);
          req.onblocked = () => done(null);
        } catch {
          done(null);
        }
      });
      return this.db;
    }

    async get(id) {
      if (!id) return null;
      if (this.memory.has(id)) return this.memory.get(id);
      const db = await this._open();
      if (!db) return null;
      return new Promise((resolve) => {
        try {
          const req = db
            .transaction(GEO.CACHE_STORE, "readonly")
            .objectStore(GEO.CACHE_STORE)
            .get(id);
          req.onsuccess = () => {
            const value = req.result || null;
            if (value) this.memory.set(id, value);
            resolve(value);
          };
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    }

    async put(pack) {
      this.memory.set(pack.id, pack);
      const db = await this._open();
      if (!db) return false;
      return new Promise((resolve) => {
        try {
          const req = db
            .transaction(GEO.CACHE_STORE, "readwrite")
            .objectStore(GEO.CACHE_STORE)
            .put(pack);
          req.onsuccess = () => resolve(true);
          req.onerror = () => resolve(false);
        } catch {
          resolve(false);
        }
      });
    }
  }

  class ZoneGeoService {
    constructor() {
      const endpoints = window.ZS_GEO_ENDPOINTS || {};
      this.nominatimUrl = endpoints.nominatim || GEO.NOMINATIM_URL;
      this.overpassUrl = endpoints.overpass || GEO.OVERPASS_URL;
      this.osmMapUrl = endpoints.osmMap || GEO.OSM_MAP_URL;
      this.tileUrl = endpoints.tiles || GEO.TILE_URL;
      this.terrainUrl = endpoints.terrain || GEO.TERRAIN_URL;
      this.preferOsmMap = location.protocol === "file:" && !endpoints.overpass;
    }

    async search(text) {
      const query = cleanText(text, "", 120);
      if (query.length < 2) throw new Error("Escribe al menos dos caracteres.");
      const url =
        this.nominatimUrl +
        "?format=jsonv2&limit=6&addressdetails=1&q=" +
        encodeURIComponent(query);
      const response = await request(url, {
          headers: { Accept: "application/json", "Accept-Language": "es" },
        }),
        rows = await response.json();
      if (!Array.isArray(rows)) return [];
      return rows.map((row) => ({
        lat: finite(row.lat, 0),
        lon: finite(row.lon, 0),
        name: cleanText(row.display_name, "Ubicación", 160),
        type: cleanText(row.type, "lugar", 40),
        category: cleanText(row.category || row.class, "", 40),
        bounds:
          Array.isArray(row.boundingbox) && row.boundingbox.length === 4
            ? {
                south: ZS.clamp(finite(row.boundingbox[0], row.lat), -85, 85),
                north: ZS.clamp(finite(row.boundingbox[1], row.lat), -85, 85),
                west: ZS.clamp(finite(row.boundingbox[2], row.lon), -180, 180),
                east: ZS.clamp(finite(row.boundingbox[3], row.lon), -180, 180),
              }
            : null,
      }));
    }

    async download(selection, sizeId, withElevation, onProgress) {
      const preset = sizePreset(sizeId),
        bbox = mapBounds(selection.lat, selection.lon, preset),
        cells = Math.max(1, preset.cells),
        groups = Math.ceil(cells / 2),
        elements = new Map();
      for (let gy = 0; gy < groups; gy++)
        for (let gx = 0; gx < groups; gx++) {
          const west = bbox.west + ((bbox.east - bbox.west) * gx) / groups,
            east = bbox.west + ((bbox.east - bbox.west) * (gx + 1)) / groups,
            south = bbox.south + ((bbox.north - bbox.south) * gy) / groups,
            north = bbox.south + ((bbox.north - bbox.south) * (gy + 1)) / groups,
            box = [south, west, north, east].join(","),
            query = this._overpassQuery(box),
            index = gy * groups + gx + 1,
            total = groups * groups;
          onProgress("Descargando sector cartográfico " + index + " de " + total + "…");
          const rawSector = await this._sector({ south, west, north, east }, query, (text) =>
              onProgress(text + " (sector " + index + " de " + total + ")"),
            ),
            rows = Array.isArray(rawSector.elements) ? rawSector.elements : [];
          for (let i = 0; i < rows.length; i++)
            elements.set(rows[i].type + "/" + rows[i].id, rows[i]);
        }
      const raw = { elements: Array.from(elements.values()) };
      onProgress("Convirtiendo la cartografía al mundo de papel…");
      const pack = normalizeOverpass(raw, selection, sizeId);
      if (withElevation) {
        onProgress("Calculando el relieve…");
        try {
          pack.elevation = await this._elevation(pack);
        } catch {
          pack.elevation = null;
        }
      }
      return pack;
    }

    async _sector(bounds, query, onFallback) {
      if (!this.preferOsmMap)
        try {
          const response = await request(this.overpassUrl, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
            body: "data=" + encodeURIComponent(query),
          });
          return await response.json();
        } catch {}
      onFallback("Usando la API OSM directa compatible con este origen");
      return this._osmSector(bounds, 0);
    }

    async _osmSector(bounds, depth) {
      const box = [bounds.west, bounds.south, bounds.east, bounds.north].join(","),
        url = this.osmMapUrl + "?bbox=" + encodeURIComponent(box);
      try {
        const response = await request(url);
        return parseOsmXml(await response.text());
      } catch (error) {
        if (depth >= 2) throw error;
        const midLon = (bounds.west + bounds.east) / 2,
          midLat = (bounds.south + bounds.north) / 2,
          boxes = [
            { west: bounds.west, south: bounds.south, east: midLon, north: midLat },
            { west: midLon, south: bounds.south, east: bounds.east, north: midLat },
            { west: bounds.west, south: midLat, east: midLon, north: bounds.north },
            { west: midLon, south: midLat, east: bounds.east, north: bounds.north },
          ],
          merged = new Map();
        for (let i = 0; i < boxes.length; i++) {
          const sector = await this._osmSector(boxes[i], depth + 1);
          for (let j = 0; j < sector.elements.length; j++) {
            const item = sector.elements[j];
            merged.set(item.type + "/" + item.id, item);
          }
        }
        return { elements: Array.from(merged.values()) };
      }
    }

    _overpassQuery(box) {
      return (
        "[out:json][timeout:60];(" +
        'nwr["building"](' +
        box +
        ");" +
        'way["highway"](' +
        box +
        ");" +
        'nwr["natural"="water"](' +
        box +
        ");" +
        'nwr["water"](' +
        box +
        ");" +
        'way["waterway"="riverbank"](' +
        box +
        ");" +
        'nwr["landuse"](' +
        box +
        ");" +
        'nwr["leisure"="park"](' +
        box +
        ");" +
        'nwr["amenity"](' +
        box +
        ");" +
        'nwr["shop"](' +
        box +
        "););out body;>;out skel qt;"
      );
    }

    async _elevation(pack) {
      if (!this.terrainUrl || !window.createImageBitmap) return null;
      const count = GEO.ELEVATION_SAMPLES,
        zoom = GEO.TERRAIN_ZOOM,
        tiles = new Map(),
        samples = [];
      for (let y = 0; y < count; y++)
        for (let x = 0; x < count; x++) {
          const lon = pack.bbox.west + ((pack.bbox.east - pack.bbox.west) * x) / (count - 1),
            lat = pack.bbox.north - ((pack.bbox.north - pack.bbox.south) * y) / (count - 1),
            n = 2 ** zoom,
            txf = ((lon + 180) / 360) * n,
            latRad = (lat * Math.PI) / 180,
            tyf = (1 - Math.asinh(Math.tan(latRad)) / Math.PI) * 0.5 * n,
            tx = Math.floor(txf),
            ty = Math.floor(tyf),
            key = tx + ":" + ty;
          samples.push({ key, px: Math.floor((txf - tx) * 256), py: Math.floor((tyf - ty) * 256) });
          tiles.set(key, { tx, ty });
        }
      for (const [key, tile] of tiles) {
        const response = await request(
            this.terrainUrl + "/" + zoom + "/" + tile.tx + "/" + tile.ty + ".png",
          ),
          bitmap = await createImageBitmap(await response.blob()),
          canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 256;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(bitmap, 0, 0);
        tiles.set(key, context.getImageData(0, 0, 256, 256).data);
        bitmap.close();
      }
      const values = [],
        rounded = [];
      let min = Infinity,
        max = -Infinity;
      for (let i = 0; i < samples.length; i++) {
        const sample = samples[i],
          data = tiles.get(sample.key),
          index = (sample.py * 256 + sample.px) * 4,
          height = data[index] * 256 + data[index + 1] + data[index + 2] / 256 - 32768;
        min = Math.min(min, height);
        max = Math.max(max, height);
        rounded.push(Math.round(height * 10) / 10);
      }
      values.push(...rounded);
      return { cols: count, rows: count, values, min, max, source: "Mapzen Terrain Tiles" };
    }
  }

  class ZoneMapSetup {
    constructor(geo, message) {
      this.geo = geo;
      this.message = message || "";
      this.place = null;
      this.selection = null;
      this.sizeId = "standard";
      this.root = null;
      this.status = null;
      this.results = null;
      this.start = null;
      this.load = null;
      this.pack = null;
      this.canvas = null;
      this.elevation = null;
      this.tileLayer = null;
      this.tileNodes = new Map();
      this.viewLat = 0;
      this.viewLon = 0;
      this.viewZoom = 12;
      this.drag = null;
      this.tilesEnabled = location.protocol !== "file:" || Boolean(window.ZS_GEO_ENDPOINTS?.tiles);
    }

    open() {
      return new Promise((resolve) => {
        const root = document.createElement("section");
        root.className = "zone-map-setup";
        root.setAttribute("role", "dialog");
        root.setAttribute("aria-modal", "true");
        root.setAttribute("aria-labelledby", "zone-map-setup-title");
        root.innerHTML =
          '<div class="zone-map-sheet"><header><small>NUEVA CAMPAÑA</small><h1 id="zone-map-setup-title">Elige tu zona</h1><p>Busca un lugar real, carga su cartografía y comprueba los sectores jugables antes de comenzar.</p></header>' +
          (this.message
            ? '<p class="zone-map-error">' + cleanText(this.message, "", 180) + "</p>"
            : "") +
          '<div class="zone-map-columns"><section class="zone-map-controls"><h2>1 · Lugar</h2><form class="zone-place-search"><label for="zone-place-query">Ciudad, barrio o dirección</label><div><input id="zone-place-query" type="search" autocomplete="off" placeholder="Ej. Medellín, Laureles"/><button type="submit">Buscar</button></div></form><div class="zone-place-results" aria-live="polite"><p>La búsqueda solo se ejecuta al pulsar Buscar.</p></div><button class="zone-procedural-start" type="button">Usar mapa procedural</button></section>' +
          '<section class="zone-map-stage"><div class="zone-map-stage-head"><div><h2>2 · Zona de inicio</h2><p>Arrastra para recorrer la ciudad. La retícula central será el área que se simulará completa.</p></div><div class="zone-size-options" role="radiogroup" aria-label="Tamaño inicial"><button type="button" data-zone-size="compact"><b>1×1</b><span>compacta</span><small>0,6 km</small></button><button type="button" data-zone-size="standard" class="on"><b>3×3</b><span>estándar</span><small>1,8 km</small></button><button type="button" data-zone-size="large"><b>5×5</b><span>grande</span><small>3 km</small></button></div></div><label class="zone-elevation-option"><input type="checkbox" checked/> relieve y curvas de nivel</label><div class="zone-map-preview"><div class="zone-map-tile-layer" aria-hidden="true"></div><canvas width="760" height="520" aria-label="Mapa contextual y zona seleccionada"></canvas><div class="zone-map-zoom"><button type="button" data-map-zoom="1" aria-label="Acercar mapa">+</button><button type="button" data-map-zoom="-1" aria-label="Alejar mapa">−</button><button type="button" data-map-fit>Ver ciudad</button><button type="button" data-map-zone>Ver zona</button></div><div class="zone-map-preview-legend" hidden><span><i class="buildings"></i><b data-preview-buildings>0</b> edificios</span><span><i class="roads"></i><b data-preview-roads>0</b> vías</span><span><i class="water"></i> agua</span></div><strong class="zone-grid-label">3 × 3 sectores jugables</strong><small class="zone-map-gesture">arrastrar · rueda para zoom</small><a class="zone-preview-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a><p>Selecciona un resultado para ver la ciudad completa.</p></div></section></div>' +
          '<footer><label class="zone-import-map">Importar MapPack<input type="file" accept="application/json,.json"/></label><p class="zone-map-status" aria-live="polite">El mapa procedural funciona completamente sin conexión.</p><div class="zone-map-footer-actions"><button class="zone-map-load" type="button" disabled>Preparar zona</button><button class="zone-osm-start" type="button" disabled>Comenzar en esta zona</button></div></footer></div>';
        document.body.appendChild(root);
        this.root = root;
        this.status = root.querySelector(".zone-map-status");
        this.results = root.querySelector(".zone-place-results");
        this.start = root.querySelector(".zone-osm-start");
        this.load = root.querySelector(".zone-map-load");
        this.canvas = root.querySelector(".zone-map-preview canvas");
        this.tileLayer = root.querySelector(".zone-map-tile-layer");
        const form = root.querySelector(".zone-place-search"),
          input = root.querySelector("#zone-place-query"),
          elevation = root.querySelector(".zone-elevation-option input");
        this.elevation = elevation;
        this._bindContextMap();
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          this._busy(true, "Buscando lugares…");
          try {
            this._showResults(await this.geo.service.search(input.value));
            this._busy(false, "Selecciona el centro exacto de la zona.");
          } catch (error) {
            this._busy(false, error.message || "No fue posible buscar ese lugar.");
          }
        });
        for (const button of root.querySelectorAll("[data-zone-size]"))
          button.addEventListener("click", () => {
            if (this.sizeId === button.dataset.zoneSize) return;
            this.sizeId = button.dataset.zoneSize;
            for (const item of root.querySelectorAll("[data-zone-size]"))
              item.classList.toggle("on", item === button);
            this._invalidate(
              "El tamaño cambió. Carga de nuevo la cartografía para ver la retícula completa.",
            );
            this._preview();
          });
        elevation.addEventListener("change", () => {
          if (!this.pack) return;
          this._invalidate("La opción de relieve cambió. Actualiza el mapa antes de comenzar.");
          this._preview();
        });
        root.querySelector(".zone-procedural-start").addEventListener("click", () => {
          this._finish(resolve, { source: "procedural", size: this.sizeId });
        });
        this.load.addEventListener("click", () => this._loadMap());
        this.start.addEventListener("click", () => {
          if (!this.pack || !this.pack.buildings.length) return;
          this._finish(resolve, { source: "osm", size: this.pack.size, pack: this.pack });
        });
        root.querySelector(".zone-import-map input").addEventListener("change", async (event) => {
          const file = event.target.files && event.target.files[0];
          if (!file) return;
          this._busy(true, "Leyendo MapPack…");
          try {
            const pack = normalizePack(JSON.parse(await file.text()));
            this.sizeId = pack.size;
            this.selection = { lat: pack.center.lat, lon: pack.center.lon, name: pack.name };
            this.place = {
              lat: pack.center.lat,
              lon: pack.center.lon,
              name: pack.name,
              bounds: pack.bbox,
            };
            this.viewLat = pack.center.lat;
            this.viewLon = pack.center.lon;
            this.viewZoom = this._zoneZoom();
            this.pack = pack;
            for (const item of root.querySelectorAll("[data-zone-size]"))
              item.classList.toggle("on", item.dataset.zoneSize === pack.size);
            this._preview();
            this._busy(
              false,
              "MapPack cargado: " +
                pack.buildings.length +
                " edificios en " +
                this._gridText() +
                ".",
            );
          } catch (error) {
            this._busy(false, (error && error.message) || "No fue posible importar el archivo.");
          }
        });
        this._preview();
        input.focus();
      });
    }

    _busy(busy, text) {
      this.status.textContent = text;
      for (const control of this.root.querySelectorAll("button,input")) control.disabled = busy;
      if (!busy) this._syncControls();
      this.root.classList.toggle("busy", busy);
    }

    _syncControls() {
      this.load.disabled = !this.selection;
      this.start.disabled = !this.pack || !this.pack.buildings.length;
      this.load.textContent = this.pack ? "Actualizar zona" : "Preparar zona";
      this.elevation.disabled = false;
    }

    _invalidate(message) {
      this.pack = null;
      this.status.textContent = message;
      this._syncControls();
    }

    async _loadMap() {
      if (!this.selection) return;
      this._busy(true, "Descargando la cartografía de los sectores…");
      try {
        this.pack = await this.geo.service.download(
          this.selection,
          this.sizeId,
          this.elevation.checked,
          (text) => this._busy(true, text),
        );
        this._preview();
        this._busy(
          false,
          this.pack.buildings.length
            ? this.pack.buildings.length +
                " edificios y " +
                this.pack.roads.length +
                " vías · revisa la zona y confirma para comenzar."
            : "La cartografía está cargada, pero este centro no contiene edificios. Prueba otro resultado cercano.",
        );
      } catch (error) {
        this.pack = null;
        this._preview();
        this._busy(false, (error && error.message) || "No fue posible preparar el mapa.");
      }
    }

    _bindContextMap() {
      const canvas = this.canvas;
      canvas.addEventListener("pointerdown", (event) => {
        if (!this.selection || this.root.classList.contains("busy")) return;
        const center = this._geoPixel(this.viewLat, this.viewLon, this.viewZoom);
        this.drag = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          centerX: center.x,
          centerY: center.y,
          moved: false,
        };
        canvas.setPointerCapture(event.pointerId);
        canvas.parentElement.classList.add("dragging");
      });
      canvas.addEventListener("pointermove", (event) => {
        const drag = this.drag;
        if (!drag || drag.id !== event.pointerId) return;
        const dx = event.clientX - drag.x,
          dy = event.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        const center = this._pixelGeo(drag.centerX - dx, drag.centerY - dy, this.viewZoom);
        this.viewLat = center.lat;
        this.viewLon = center.lon;
        this._setZoneCenter();
        if (this.pack) this.pack = null;
        this._preview();
        this._syncControls();
      });
      const endDrag = (event) => {
        if (!this.drag || this.drag.id !== event.pointerId) return;
        const moved = this.drag.moved;
        this.drag = null;
        canvas.parentElement.classList.remove("dragging");
        if (moved)
          this.status.textContent =
            "Centro movido a " +
            this.viewLat.toFixed(4) +
            ", " +
            this.viewLon.toFixed(4) +
            " · prepara la zona para validarla.";
      };
      canvas.addEventListener("pointerup", endDrag);
      canvas.addEventListener("pointercancel", endDrag);
      canvas.addEventListener(
        "wheel",
        (event) => {
          if (!this.selection) return;
          event.preventDefault();
          this._changeZoom(event.deltaY < 0 ? 1 : -1);
        },
        { passive: false },
      );
      for (const button of this.root.querySelectorAll("[data-map-zoom]"))
        button.addEventListener("click", () => this._changeZoom(Number(button.dataset.mapZoom)));
      this.root.querySelector("[data-map-fit]").addEventListener("click", () => {
        if (!this.place) return;
        this._fitPlace();
        this._setZoneCenter();
        if (this.pack) this.pack = null;
        this._preview();
        this._syncControls();
        this.status.textContent =
          "Vista general restaurada. Acerca y arrastra para elegir la zona de inicio.";
      });
      this.root.querySelector("[data-map-zone]").addEventListener("click", () => {
        if (!this.selection) return;
        this.viewZoom = this._zoneZoom();
        this._preview();
        this.status.textContent =
          "Vista cercana de la zona. Pulsa Ver ciudad para recuperar el contexto completo.";
      });
    }

    _changeZoom(delta) {
      if (!this.selection) return;
      this.viewZoom = ZS.clamp(this.viewZoom + delta, 8, 17);
      this._preview();
    }

    _fitPlace() {
      const bounds = this.place && this.place.bounds,
        width = Math.max(320, this.canvas.clientWidth || this.canvas.width),
        height = Math.max(260, this.canvas.clientHeight || this.canvas.height);
      if (!bounds || bounds.east <= bounds.west || bounds.north <= bounds.south) {
        this.viewLat = this.place ? this.place.lat : 0;
        this.viewLon = this.place ? this.place.lon : 0;
        this.viewZoom = 12;
        return;
      }
      const northWest = this._geoPixel(bounds.north, bounds.west, 0),
        southEast = this._geoPixel(bounds.south, bounds.east, 0),
        spanX = Math.max(1e-7, Math.abs(southEast.x - northWest.x)),
        spanY = Math.max(1e-7, Math.abs(southEast.y - northWest.y)),
        zoom = Math.floor(Math.log2(Math.min((width * 0.82) / spanX, (height * 0.76) / spanY))),
        center = this._pixelGeo(
          (northWest.x + southEast.x) / 2,
          (northWest.y + southEast.y) / 2,
          0,
        );
      this.viewLat = center.lat;
      this.viewLon = center.lon;
      // Administrative boundaries can include a large rural municipality. A
      // city-level floor keeps the playable grid legible while retaining the
      // full urban context around it.
      this.viewZoom = ZS.clamp(zoom, 12, 16);
      this._setZoneCenter();
    }

    _zoneZoom() {
      const cells = Math.max(1, sizePreset(this.sizeId).cells),
        meters = cells * MAP.SECTOR_METERS,
        target = Math.max(
          180,
          Math.min(this.canvas.clientWidth || 760, this.canvas.clientHeight || 520) * 0.58,
        ),
        wantedMpp = meters / target,
        zoom = Math.round(
          Math.log2(
            (156543.03392 * Math.cos((this.viewLat * Math.PI) / 180)) / Math.max(0.1, wantedMpp),
          ),
        );
      return ZS.clamp(zoom, 8, 17);
    }

    _setZoneCenter() {
      if (!this.selection) return;
      this.selection.lat = this.viewLat;
      this.selection.lon = this.viewLon;
    }

    _geoPixel(lat, lon, zoom) {
      const size = 256 * 2 ** zoom,
        safeLat = ZS.clamp(lat, -85.0511, 85.0511),
        radians = (safeLat * Math.PI) / 180;
      return {
        x: ((lon + 180) / 360) * size,
        y: (1 - Math.asinh(Math.tan(radians)) / Math.PI) * 0.5 * size,
      };
    }

    _pixelGeo(x, y, zoom) {
      const size = 256 * 2 ** zoom,
        normalizedY = 1 - (2 * y) / size;
      return {
        lat: ZS.clamp((Math.atan(Math.sinh(Math.PI * normalizedY)) * 180) / Math.PI, -85, 85),
        lon: (((((x / size) * 360) % 360) + 360) % 360) - 180,
      };
    }

    _selectionBox(width, height) {
      const cells = Math.max(1, sizePreset(this.sizeId).cells),
        meters = cells * MAP.SECTOR_METERS,
        metersPerPixel =
          (156543.03392 * Math.cos((this.viewLat * Math.PI) / 180)) / 2 ** this.viewZoom,
        side = meters / Math.max(0.1, metersPerPixel);
      return { x: width / 2 - side / 2, y: height / 2 - side / 2, side };
    }

    _renderTiles(width, height) {
      const enabled = this.tilesEnabled && this.selection && this.geo.service.tileUrl;
      this.tileLayer.hidden = !enabled;
      this.root.querySelector(".zone-preview-attribution").hidden = !enabled;
      this.root.querySelector(".zone-map-gesture").hidden = !enabled;
      if (!enabled) {
        this.tileLayer.replaceChildren();
        this.tileNodes.clear();
        return;
      }
      const zoom = Math.round(this.viewZoom),
        center = this._geoPixel(this.viewLat, this.viewLon, zoom),
        n = 2 ** zoom,
        leftWorld = center.x - width / 2,
        topWorld = center.y - height / 2,
        x0 = Math.floor(leftWorld / 256),
        y0 = Math.max(0, Math.floor(topWorld / 256)),
        x1 = Math.floor((leftWorld + width - 1) / 256),
        y1 = Math.min(n - 1, Math.floor((topWorld + height - 1) / 256)),
        wanted = new Set();
      for (let ty = y0; ty <= y1; ty++)
        for (let tx = x0; tx <= x1; tx++) {
          const wrappedX = ((tx % n) + n) % n,
            key = zoom + ":" + wrappedX + ":" + ty;
          wanted.add(key);
          let image = this.tileNodes.get(key);
          if (!image) {
            image = document.createElement("img");
            image.alt = "";
            image.draggable = false;
            image.decoding = "async";
            image.src = this.geo.service.tileUrl
              .replace("{z}", zoom)
              .replace("{x}", wrappedX)
              .replace("{y}", ty);
            this.tileNodes.set(key, image);
            this.tileLayer.appendChild(image);
          }
          image.style.left = tx * 256 - leftWorld + "px";
          image.style.top = ty * 256 - topWorld + "px";
        }
      for (const [key, image] of this.tileNodes)
        if (!wanted.has(key)) {
          image.remove();
          this.tileNodes.delete(key);
        }
    }

    _showResults(rows) {
      this.results.replaceChildren();
      if (!rows.length) {
        const empty = document.createElement("p");
        empty.textContent = "No se encontraron lugares. Prueba una búsqueda más amplia.";
        this.results.appendChild(empty);
        return;
      }
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i],
          button = document.createElement("button");
        button.type = "button";
        button.innerHTML = "<b></b><small></small>";
        button.querySelector("b").textContent = row.name;
        button.querySelector("small").textContent =
          row.type + " · " + row.lat.toFixed(4) + ", " + row.lon.toFixed(4);
        button.addEventListener("click", () => {
          this.place = row;
          this.selection = { lat: row.lat, lon: row.lon, name: row.name };
          this._fitPlace();
          for (const item of this.results.querySelectorAll("button"))
            item.classList.toggle("on", item === button);
          this._invalidate(
            "Ciudad localizada. Arrastra el mapa para elegir el centro y pulsa Preparar zona.",
          );
          this._preview();
        });
        this.results.appendChild(button);
      }
    }

    _preview() {
      const canvas = this.canvas,
        width = Math.max(320, Math.round(canvas.clientWidth || canvas.width)),
        height = Math.max(260, Math.round(canvas.clientHeight || canvas.height)),
        preset = sizePreset(this.sizeId),
        cells = Math.max(1, preset.cells),
        contextual = Boolean(this.tilesEnabled && this.selection && this.geo.service.tileUrl);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const context = canvas.getContext("2d"),
        fallbackSide = Math.min(height - 64, width - 72),
        fallbackBox = { x: (width - fallbackSide) / 2, y: 24, side: fallbackSide },
        box = contextual ? this._selectionBox(width, height) : fallbackBox;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, width, height);
      this._renderTiles(width, height);
      if (!contextual) {
        context.fillStyle = "#f3edde";
        context.fillRect(0, 0, width, height);
      }
      if (this.pack) this._drawMap(context, box, contextual);
      else if (!contextual) {
        context.fillStyle = "rgba(112,148,72,.055)";
        context.fillRect(box.x, box.y, box.side, box.side);
        context.fillStyle = "rgba(61,52,43,.42)";
        context.font = '600 15px "Segoe Script", "Bradley Hand", cursive';
        context.textAlign = "center";
        context.fillText(
          this.selection ? "Cartografía pendiente" : "Busca y elige un lugar real",
          width / 2,
          box.y + box.side / 2 - 7,
        );
        context.font = "11px system-ui, sans-serif";
        context.fillText(
          this.selection ? "Pulsa Preparar zona" : "Aquí aparecerán edificios, vías y agua",
          width / 2,
          box.y + box.side / 2 + 14,
        );
      }
      if (contextual) this._shadeOutsideSelection(context, box, width, height);
      if (this.selection || !contextual) this._drawSectorGrid(context, box, cells);
      const label = this.root.querySelector(".zone-map-preview p");
      label.textContent = this.pack
        ? this.pack.name + " · " + this.pack.buildings.length + " edificios · " + this._gridText()
        : this.selection
          ? this.selection.name + " · vista de ciudad · zoom " + this.viewZoom
          : this._gridText() + " · selecciona un lugar real";
      const legend = this.root.querySelector(".zone-map-preview-legend");
      legend.hidden = !this.pack;
      if (this.pack) {
        legend.querySelector("[data-preview-buildings]").textContent = this.pack.buildings.length;
        legend.querySelector("[data-preview-roads]").textContent = this.pack.roads.length;
      }
      this.root.querySelector(".zone-grid-label").textContent = this._gridText();
      const preview = this.root.querySelector(".zone-map-preview");
      preview.classList.toggle("has-context", contextual);
      preview.classList.toggle("has-map", Boolean(this.pack));
      this.root.querySelector(".zone-map-zoom").hidden = !this.selection;
      canvas.dataset.preview = this.pack ? "map" : this.selection ? "context" : "empty";
      canvas.dataset.cells = String(cells);
      canvas.dataset.buildings = this.pack ? String(this.pack.buildings.length) : "0";
      canvas.dataset.zoom = String(this.viewZoom);
      canvas.dataset.selectionPx = box.side.toFixed(1);
      canvas.dataset.center = this.selection
        ? this.selection.lat.toFixed(6) + "," + this.selection.lon.toFixed(6)
        : "";
    }

    _shadeOutsideSelection(context, box, width, height) {
      const x0 = ZS.clamp(box.x, 0, width),
        y0 = ZS.clamp(box.y, 0, height),
        x1 = ZS.clamp(box.x + box.side, 0, width),
        y1 = ZS.clamp(box.y + box.side, 0, height);
      context.save();
      context.fillStyle = "rgba(42,50,43,.34)";
      context.fillRect(0, 0, width, y0);
      context.fillRect(0, y1, width, height - y1);
      context.fillRect(0, y0, x0, Math.max(0, y1 - y0));
      context.fillRect(x1, y0, width - x1, Math.max(0, y1 - y0));
      context.restore();
    }

    _drawMap(context, box, contextual) {
      const pack = this.pack,
        scale = box.side / pack.width,
        fillPoly = (points) => {
          if (!points || points.length < 3) return;
          context.beginPath();
          context.moveTo(points[0].x, points[0].y);
          for (let i = 1; i < points.length; i++) context.lineTo(points[i].x, points[i].y);
          context.closePath();
          context.fill();
        };
      context.save();
      context.beginPath();
      context.rect(box.x, box.y, box.side, box.side);
      context.clip();
      context.translate(box.x, box.y);
      context.scale(scale, scale);
      context.fillStyle = contextual ? "rgba(233,227,211,.34)" : "#e9e3d3";
      context.fillRect(0, 0, pack.width, pack.height);
      const elevation = pack.elevation;
      if (elevation && elevation.max > elevation.min) {
        const cellW = pack.width / Math.max(1, elevation.cols - 1),
          cellH = pack.height / Math.max(1, elevation.rows - 1),
          range = elevation.max - elevation.min;
        for (let y = 0; y < elevation.rows; y++)
          for (let x = 0; x < elevation.cols; x++) {
            const value = elevation.values[y * elevation.cols + x],
              ratio = (value - elevation.min) / range;
            context.fillStyle =
              ratio > 0.65
                ? "rgba(137,116,78,.12)"
                : ratio < 0.3
                  ? "rgba(112,148,72,.1)"
                  : "rgba(170,150,105,.07)";
            context.fillRect(x * cellW - cellW / 2, y * cellH - cellH / 2, cellW, cellH);
          }
      }
      for (let i = 0; i < pack.land.length; i++) {
        const feature = pack.land[i],
          tags = feature.tags || {};
        context.fillStyle =
          tags.landuse === "industrial"
            ? "rgba(131,112,85,.14)"
            : tags.landuse === "forest"
              ? "rgba(74,112,62,.2)"
              : "rgba(99,135,73,.13)";
        fillPoly(feature.points);
      }
      for (let i = 0; i < pack.waters.length; i++) {
        const feature = pack.waters[i];
        context.fillStyle = "rgba(78,126,153,.48)";
        fillPoly(feature.points);
        context.strokeStyle = "rgba(55,94,121,.72)";
        context.lineWidth = 1.1 / scale;
        ZS.wpoly(context, feature.points, 1721 + i * 11, 0.45 / scale, true);
        context.stroke();
      }
      const roadStep = Math.max(1, Math.ceil(pack.roads.length / 2800));
      context.strokeStyle = "rgba(99,87,66,.52)";
      context.lineCap = "round";
      for (let i = 0; i < pack.roads.length; i += roadStep) {
        const road = pack.roads[i],
          points = road.points;
        context.lineWidth = Math.max(0.65 / scale, road.width * 0.42);
        for (let j = 1; j < points.length; j++)
          ZS.wline(
            context,
            points[j - 1].x,
            points[j - 1].y,
            points[j].x,
            points[j].y,
            road.seed + j * 7,
            0.38 / scale,
          );
      }
      context.fillStyle = "rgba(196,178,143,.72)";
      context.strokeStyle = "rgba(61,52,43,.72)";
      context.lineWidth = 0.72 / scale;
      for (let i = 0; i < pack.buildings.length; i++) {
        const building = pack.buildings[i];
        fillPoly(building.points);
        ZS.wpoly(context, building.points, 3101 + i * 5, 0.32 / scale, true);
        context.stroke();
      }
      context.restore();
    }

    _drawSectorGrid(context, box, cells) {
      const cell = box.side / cells,
        center = (cells - 1) / 2;
      context.save();
      for (let y = 0; y < cells; y++)
        for (let x = 0; x < cells; x++) {
          context.fillStyle =
            x === center && y === center ? "rgba(150,62,48,.12)" : "rgba(246,241,227,.035)";
          context.fillRect(box.x + x * cell, box.y + y * cell, cell, cell);
        }
      context.setLineDash([7, 5]);
      context.strokeStyle = "rgba(54,49,40,.76)";
      context.lineWidth = 1.25;
      for (let i = 1; i < cells; i++) {
        ZS.wline(
          context,
          box.x + i * cell,
          box.y,
          box.x + i * cell,
          box.y + box.side,
          770 + i,
          0.35,
        );
        ZS.wline(
          context,
          box.x,
          box.y + i * cell,
          box.x + box.side,
          box.y + i * cell,
          810 + i,
          0.35,
        );
      }
      context.setLineDash([]);
      context.strokeStyle = "rgba(150,62,48,.9)";
      context.lineWidth = 2.2;
      ZS.sketchRect(context, box.x, box.y, box.side, box.side, 930 + cells);
      if (cell >= 28) {
        context.font = "700 " + Math.max(8, Math.min(12, cell * 0.09)) + "px system-ui, sans-serif";
        context.textAlign = "left";
        context.textBaseline = "top";
        context.fillStyle = "rgba(61,52,43,.7)";
        for (let y = 0; y < cells; y++)
          for (let x = 0; x < cells; x++)
            context.fillText(
              String.fromCharCode(65 + x) + (y + 1),
              box.x + x * cell + 6,
              box.y + y * cell + 5,
            );
      }
      const cx = box.x + box.side / 2,
        cy = box.y + box.side / 2;
      context.strokeStyle = "rgba(150,62,48,.92)";
      context.lineWidth = 1.8;
      ZS.wline(context, cx - 8, cy, cx + 8, cy, 971, 0.35);
      ZS.wline(context, cx, cy - 8, cx, cy + 8, 977, 0.35);
      if (box.side >= 90) {
        context.fillStyle = "rgba(61,52,43,.78)";
        context.font = "800 9px system-ui, sans-serif";
        context.textAlign = "right";
        context.fillText("N ↑", box.x + box.side - 7, box.y + 7);
      }
      context.restore();
    }

    _gridText() {
      const cells = Math.max(1, sizePreset(this.sizeId).cells);
      return cells + " × " + cells + " sectores jugables";
    }

    _finish(resolve, result) {
      this.root.remove();
      resolve(result);
    }
  }

  class ZoneGeo {
    constructor(state, params) {
      this.state = state;
      this.params = params || new URLSearchParams();
      this.cache = new ZoneMapCache();
      this.service = new ZoneGeoService();
      this.pack = null;
      this.source = "procedural";
      this.size = "classic";
      this.options = { w: 3200, h: 2400 };
    }

    async prepare() {
      if (window.ZS_TEST_MAP_PACK) {
        this.pack = normalizePack(window.ZS_TEST_MAP_PACK);
        this._apply("osm", this.pack.size, this.pack);
        return;
      }
      const forcedClassic =
        this.params.get("fresh") === "1" ||
        this.params.get("record") === "1" ||
        this.params.get("procedural") === "1";
      if (forcedClassic) {
        const requested = this.params.get("size"),
          size = MAP.SIZE_PRESETS[requested] ? requested : "classic";
        this._apply("procedural", size, null, false);
        return;
      }
      const world = this.state.data.world || {};
      if (this.state.hasSave && world.configured) {
        if (world.source === "osm" && world.mapPackId) {
          const cached = await this.cache.get(world.mapPackId);
          if (cached) {
            try {
              this.pack = normalizePack(cached);
              this._apply("osm", this.pack.size, this.pack, false);
              return;
            } catch {}
          }
          await this._select(
            "No encontramos el mapa guardado. Impórtalo o vuelve a descargar la zona.",
          );
          return;
        }
        this._apply(
          "procedural",
          MAP.SIZE_PRESETS[world.size] ? world.size : "classic",
          null,
          false,
        );
        return;
      }
      await this._select("");
    }

    async _select(message) {
      const result = await new ZoneMapSetup(this, message).open();
      this._apply(result.source, result.size, result.pack || null, true);
      if (this.pack) await this.cache.put(this.pack);
      this.state.save();
    }

    _apply(source, sizeId, pack, persist) {
      const preset = sizePreset(sizeId);
      this.source = source;
      this.size = preset.id;
      this.pack = pack || null;
      this.options.w = pack ? pack.width : preset.w;
      this.options.h = pack ? pack.height : preset.h;
      if (persist !== false)
        this.state.setMapMeta({
          configured: true,
          source,
          size: preset.id,
          mapPackId: pack ? pack.id : null,
          mapHash: pack ? pack.hash : null,
          name: pack ? pack.name : "Distrito procedural",
          center: pack ? pack.center : null,
          projection: pack ? "local-equirectangular" : null,
          dataTimestamp: pack ? pack.fetchedAt : null,
          elevationSource: pack && pack.elevation ? pack.elevation.source : null,
        });
    }

    worldOptions() {
      return { w: this.options.w, h: this.options.h };
    }

    exportPack() {
      if (!this.pack) return false;
      const blob = new Blob([JSON.stringify(this.pack)], { type: "application/json" }),
        url = URL.createObjectURL(blob),
        anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = this.pack.id.replace(/[^a-z0-9_-]+/gi, "-") + ".zone-map.json";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    }
  }

  ZS.ZoneGeo = ZoneGeo;
  ZS.ZoneMapCache = ZoneMapCache;
  ZS.ZoneMapPack = Object.freeze({
    normalize: normalizePack,
    fromOverpass: normalizeOverpass,
    fromOsmXml: parseOsmXml,
    regions: makeRegions,
  });
})();
