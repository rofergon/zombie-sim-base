/* IFZ-style territorial resource collection. The map supplies the assets:
   existing trees become finite wood nodes and abandoned buildings expose
   their exterior metal salvage without creating a second loot inventory. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});
  const CFG = ZS.ZoneConfig;
  const R = CFG.RESOURCE;

  const ACTIVE = CFG.JOB_STATE.ACTIVE;
  const PAPER = "rgba(246,241,227,0.94)";
  const RESOURCE_INK = "rgba(55,104,116,0.92)";
  const RESOURCE_WASH = "rgba(79,151,166,0.2)";
  const RESOURCE_WASH_STRONG = "rgba(79,151,166,0.34)";

  class ZoneGathering {
    constructor(state, map) {
      this.state = state;
      this.map = map;
      this.world = null;
      this.nav = null;
      this.tasks = null;
      this.onChanged = null;
      this.previewResource = null;
      this.previewNodes = [];
      this.previewBounds = { x0: 0, y0: 0, x1: 0, y1: 0 };
    }

    prepare(world, nav) {
      this.world = world;
      this.nav = nav;
      const harvested = this.state.zone.harvestedTrees;
      for (let i = 0; i < world.trees.length; i++) {
        const tree = world.trees[i];
        tree.zoneGatherId = i;
        tree.hidden = harvested.includes(i);
      }
    }

    connect(tasks, onChanged) {
      this.tasks = tasks;
      this.onChanged = onChanged;
      tasks.connectGathering(this);
    }

    label(resource) {
      return resource === R.WOOD ? "madera" : resource === R.METAL ? "metal" : "recurso";
    }

    setPreview(resource, bounds) {
      this.previewResource = resource;
      this._copyBounds(this.previewBounds, bounds);
      this.nodesInArea(resource, bounds, this.previewNodes);
      return this.previewNodes.length;
    }

    clearPreview() {
      this.previewResource = null;
      this.previewNodes.length = 0;
    }

    create(resource, bounds) {
      if (!this.tasks || (resource !== R.WOOD && resource !== R.METAL)) return null;
      const nodes = [];
      this.nodesInArea(resource, bounds, nodes);
      if (!nodes.length) return null;
      let total = 0;
      if (resource === R.WOOD) total = nodes.length * CFG.GATHER.WOOD_PER_TREE;
      else
        for (let i = 0; i < nodes.length; i++) {
          const record = this.map.at(nodes[i]);
          if (record) total += record.salvage[R.METAL];
        }
      const job = this.tasks.postGather(resource, bounds, nodes, total);
      this.clearPreview();
      if (job && this.onChanged) this.onChanged();
      return job;
    }

    nodesInArea(resource, bounds, out) {
      out.length = 0;
      if (!bounds || (resource !== R.WOOD && resource !== R.METAL)) return out;
      const limit = CFG.GATHER.MAX_NODES_PER_AREA;
      if (resource === R.WOOD) {
        const trees = this.world ? this.world.trees : [];
        for (let i = 0; i < trees.length && out.length < limit; i++) {
          const tree = trees[i];
          if (
            tree.hidden ||
            tree.x < bounds.x0 ||
            tree.x > bounds.x1 ||
            tree.y < bounds.y0 ||
            tree.y > bounds.y1 ||
            !this.nav.isWalkable(tree.x, tree.y, false) ||
            this._claimed(resource, i)
          )
            continue;
          out.push(i);
        }
        return out;
      }
      for (let i = 0; i < this.map.records.length && out.length < limit; i++) {
        const record = this.map.records[i],
          shape = record.shape;
        if (
          record === this.map.hq ||
          record.use !== CFG.BUILDING_USE.ABANDONED ||
          record.demolished ||
          record.demolitionT ||
          record.salvage[R.METAL] <= 0 ||
          !this.map.reachable(record) ||
          shape.x + shape.w < bounds.x0 ||
          shape.x > bounds.x1 ||
          shape.y + shape.h < bounds.y0 ||
          shape.y > bounds.y1 ||
          this._claimed(resource, record.id)
        )
          continue;
        out.push(record.id);
      }
      return out;
    }

    available(job) {
      if (!job || job.type !== CFG.JOB.GATHER || !Array.isArray(job.nodeIds)) return 0;
      let total = 0;
      if (job.resource === R.WOOD) {
        for (let i = 0; i < job.nodeIds.length; i++) {
          const tree = this._tree(job.nodeIds[i]);
          if (tree && !tree.hidden) total += CFG.GATHER.WOOD_PER_TREE;
        }
      } else if (job.resource === R.METAL)
        for (let i = 0; i < job.nodeIds.length; i++) {
          const record = this.map.at(job.nodeIds[i]);
          if (this._validMetal(record)) total += record.salvage[R.METAL];
        }
      return total;
    }

    target(job, worker) {
      if (!job || !job.nodeIds || !job.nodeIds.length) return null;
      if (worker && this._nodeAvailable(job, worker.gatherNodeId))
        return this._nodePoint(job.resource, worker.gatherNodeId);
      const start = worker ? worker.cid % job.nodeIds.length : 0;
      for (let offset = 0; offset < job.nodeIds.length; offset++) {
        const id = job.nodeIds[(start + offset) % job.nodeIds.length];
        if (!this._nodeAvailable(job, id)) continue;
        if (worker) worker.gatherNodeId = id;
        return this._nodePoint(job.resource, id);
      }
      return null;
    }

    collect(job, worker, room) {
      if (!job || room <= 0 || !worker) return 0;
      const id = worker.gatherNodeId;
      if (!this._nodeAvailable(job, id)) return 0;
      let amount = 0;
      if (job.resource === R.WOOD) {
        const tree = this._tree(id);
        amount = Math.min(room, CFG.GATHER.WOOD_PER_TREE);
        tree.hidden = true;
        if (!this.state.zone.harvestedTrees.includes(id)) this.state.zone.harvestedTrees.push(id);
      } else if (job.resource === R.METAL) {
        const record = this.map.at(id);
        amount = Math.min(room, CFG.GATHER.METAL_PER_TRIP, record.salvage[R.METAL]);
        record.salvage[R.METAL] -= amount;
      }
      worker.carry[job.resource] += amount;
      worker.gatherNodeId = null;
      job.progress += amount;
      if (amount && this.onChanged) this.onChanged();
      return amount;
    }

    restoreCargo(job, worker) {
      if (!job || !worker || job.type !== CFG.JOB.GATHER) return false;
      const amount = worker.carry[job.resource] || 0;
      if (!amount) return false;
      this.state.stock[job.resource] += amount;
      worker.carry[job.resource] = 0;
      return true;
    }

    reachable(job) {
      return Boolean(job && this.map.hq && this.available(job) > 0);
    }

    isBuildingClaimed(id) {
      return this._claimed(R.METAL, id);
    }

    atPoint(x, y, zoom) {
      const radius = 19 / Math.max(0.35, zoom || 1),
        jobs = this.state.zone.jobs;
      for (let i = jobs.length - 1; i >= 0; i--) {
        const job = jobs[i];
        if (job.type !== CFG.JOB.GATHER || job.state !== ACTIVE || !job.bounds) continue;
        const cx = (job.bounds.x0 + job.bounds.x1) / 2,
          cy = (job.bounds.y0 + job.bounds.y1) / 2;
        if (Math.hypot(x - cx, y - cy) <= radius) return job;
      }
      return null;
    }

    availableOnMap(resource) {
      let total = 0;
      if (resource === R.WOOD) {
        const trees = this.world ? this.world.trees : [];
        for (let i = 0; i < trees.length; i++)
          if (!trees[i].hidden && !this._claimed(resource, i)) total += CFG.GATHER.WOOD_PER_TREE;
      } else if (resource === R.METAL)
        for (let i = 0; i < this.map.records.length; i++) {
          const record = this.map.records[i];
          if (this._validMetal(record) && !this._claimed(resource, record.id))
            total += record.salvage[R.METAL];
        }
      return total;
    }

    model() {
      const areas = [],
        jobs = this.state.zone.jobs;
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        if (job.type !== CFG.JOB.GATHER || job.state !== ACTIVE || !job.bounds) continue;
        areas.push({
          id: job.id,
          resource: job.resource,
          total: job.total,
          remaining: this.available(job),
          capacity: job.capacity,
          assigned: job.assigned.length,
          priority: job.priority,
          nodes: job.nodeIds.length,
          x: (job.bounds.x0 + job.bounds.x1) / 2,
          y: (job.bounds.y0 + job.bounds.y1) / 2,
        });
      }
      return {
        wood: this.availableOnMap(R.WOOD),
        metal: this.availableOnMap(R.METAL),
        areas,
      };
    }

    drawGround(c) {
      const harvested = this.state.zone.harvestedTrees;
      c.save();
      c.strokeStyle = "rgba(93,72,48,0.52)";
      c.fillStyle = "rgba(157,118,70,0.16)";
      c.lineWidth = 1;
      for (let i = 0; i < harvested.length; i++) {
        const tree = this._tree(harvested[i]);
        if (!tree) continue;
        ZS.wcirc(c, tree.x, tree.y - 1, 3.7, tree.seed + 1201, 0.5);
        c.fill();
        ZS.wline(c, tree.x - 3, tree.y - 3, tree.x + 3, tree.y + 1, tree.seed + 1203, 0.4);
      }
      c.restore();
    }

    drawOverlay(c, selectedJobId, zoom) {
      const jobs = this.state.zone.jobs;
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        if (job.type !== CFG.JOB.GATHER || job.state !== ACTIVE) continue;
        this._drawNodes(c, job.resource, job.nodeIds, job.id === selectedJobId, zoom);
        this._drawMarker(c, job, job.id === selectedJobId, zoom);
      }
      if (this.previewResource !== null)
        this._drawNodes(c, this.previewResource, this.previewNodes, true, zoom);
    }

    _drawNodes(c, resource, ids, strong, zoom) {
      if (!ids || !ids.length) return;
      c.save();
      c.strokeStyle = RESOURCE_INK;
      c.fillStyle = strong ? RESOURCE_WASH_STRONG : RESOURCE_WASH;
      c.lineWidth = Math.max(1.2, 1.4 / Math.max(0.35, zoom));
      if (resource === R.WOOD)
        for (let i = 0; i < ids.length; i++) {
          const tree = this._tree(ids[i]);
          if (!tree || tree.hidden) continue;
          ZS.wcirc(c, tree.x, tree.y - tree.r * 0.72, tree.r + 4, tree.seed + 1301, 1.1);
          c.fill();
        }
      else
        for (let i = 0; i < ids.length; i++) {
          const record = this.map.at(ids[i]);
          if (!this._validMetal(record)) continue;
          const shape = record.shape,
            points = shape.halo || shape.footprint;
          if (points) {
            ZS.wpoly(c, points, shape.seed + 1301, 0.9, true);
            c.fill();
            c.stroke();
          } else {
            c.fillRect(shape.x - 4, shape.y - 4, shape.w + 8, shape.h + 8);
            ZS.sketchRect(c, shape.x - 4, shape.y - 4, shape.w + 8, shape.h + 8);
          }
        }
      c.restore();
    }

    _drawMarker(c, job, selected, zoom) {
      const cx = (job.bounds.x0 + job.bounds.x1) / 2,
        cy = (job.bounds.y0 + job.bounds.y1) / 2,
        radius = Math.max(11, 12 / Math.max(0.45, zoom));
      c.save();
      c.strokeStyle = RESOURCE_INK;
      c.fillStyle = PAPER;
      c.lineWidth = Math.max(1.6, (selected ? 2.4 : 1.7) / Math.max(0.45, zoom));
      ZS.wcirc(c, cx, cy, radius, job.id * 37 + 1401, 1.1);
      c.fill();
      c.fillStyle = "rgba(48,77,82,0.95)";
      c.font = "bold " + Math.max(8, 9 / Math.max(0.65, zoom)) + 'px "Segoe Script", cursive';
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(job.resource === R.WOOD ? "M" : "Fe", cx, cy - 1);
      c.fillStyle = PAPER;
      c.strokeStyle = RESOURCE_INK;
      ZS.wcirc(c, cx + radius * 0.72, cy - radius * 0.72, radius * 0.43, job.id * 37 + 1409, 0.6);
      c.fill();
      c.fillStyle = "rgba(48,77,82,0.95)";
      c.font = "bold " + Math.max(6, 7 / Math.max(0.65, zoom)) + "px sans-serif";
      c.fillText(String(job.assigned.length), cx + radius * 0.72, cy - radius * 0.72);
      c.restore();
    }

    _claimed(resource, id) {
      const jobs = this.state.zone.jobs;
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        if (
          job.type === CFG.JOB.GATHER &&
          job.state === ACTIVE &&
          job.resource === resource &&
          job.nodeIds.includes(id)
        )
          return true;
      }
      return false;
    }

    _nodeAvailable(job, id) {
      if (!Number.isInteger(id)) return false;
      if (job.resource === R.WOOD) {
        const tree = this._tree(id);
        return Boolean(tree && !tree.hidden);
      }
      return this._validMetal(this.map.at(id));
    }

    _nodePoint(resource, id) {
      if (resource === R.WOOD) return this._tree(id);
      const record = this.map.at(id),
        door = record && record.shape && record.shape.door;
      return door ? door.front : record;
    }

    _tree(id) {
      return this.world && Number.isInteger(id) ? this.world.trees[id] || null : null;
    }

    _validMetal(record) {
      return Boolean(
        record &&
        record !== this.map.hq &&
        record.use === CFG.BUILDING_USE.ABANDONED &&
        !record.demolished &&
        !record.demolitionT &&
        record.salvage[R.METAL] > 0 &&
        this.map.reachable(record),
      );
    }

    _copyBounds(out, source) {
      out.x0 = source.x0;
      out.y0 = source.y0;
      out.x1 = source.x1;
      out.y1 = source.y1;
    }
  }

  ZS.ZoneGathering = ZoneGathering;
})();
