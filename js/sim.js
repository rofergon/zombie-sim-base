/* Simulation orchestration: the game's clock. Ticks the scenario pack
   (ZS.scenario) — it owns the population, the round structure, and what a
   tap does; this file only keeps time and calls the core agent engine. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});
  const MAX_STEP = 0.05;

  const Sim = {
    agents: [],
    wave: 1,
    waveTimer: 0,
    scaledTime: null,

    init(world, vw, vh) {
      this.agents = [];
      ZS.scenario.init(this.agents, world, vw, vh, this.wave);
    },

    counts() {
      return ZS.scenario.counts(this.agents);
    },

    update(dt, t, world, vw, vh) {
      if (ZS.scenario.paused) return; // the results card is up: the world waits
      if (!ZS.scenario.usesTimeScale) {
        this._step(dt, t, world, vw, vh);
        return;
      }
      const scale = Math.max(0, Number(ZS.scenario.timeScale) || 0);
      if (scale <= 0) return;
      if (this.scaledTime === null) this.scaledTime = t;
      let remaining = dt * scale;
      while (remaining > 0) {
        const step = Math.min(MAX_STEP, remaining);
        this.scaledTime += step;
        this._step(step, this.scaledTime, world, vw, vh);
        remaining -= step;
      }
    },

    _step(dt, t, world, vw, vh) {
      if (this.agents.length) {
        if (ZS.scenario.left(this.agents) === 0) {
          // the scenario's players are all gone: a new round after a beat;
          // the scenario may extend the beat (beatT) or dismiss it early
          // (skipBeat — tapping the dawn report card)
          this.waveTimer += dt;
          const beat = ZS.scenario.beatT || 3;
          if (this.waveTimer > beat || ZS.scenario.skipBeat) {
            this.wave++;
            this.waveTimer = 0;
            ZS.scenario.skipBeat = false;
            this.init(world, vw, vh);
            return;
          }
        } else {
          ZS.scenario.maintain(this.agents, dt, world, vw, vh);
        }
        ZS.updateAgents(this.agents, dt, t, world, this.wave);
      } else if (ZS.scenario.tickEmpty) {
        // scenario clocks that run with zero agents (the Hold's day counter)
        ZS.scenario.maintain(this.agents, dt, world, vw, vh);
      }
    },

    // tap/click: the scenario decides what a fresh seed does (e = pointer event)
    tap(world, wx, wy, e) {
      ZS.scenario.tap(this.agents, world, wx, wy, e);
    },
  };

  ZS.Sim = Sim;
})();
