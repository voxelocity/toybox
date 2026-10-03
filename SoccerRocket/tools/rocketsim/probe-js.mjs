// Dumps the contact points SoccerRocket generates during one tick of an oracle
// scenario (counterpart of a RocketSim build with a contact-added hook).
//
//   PROBE_TICK=92 node tools/rocketsim/probe-js.mjs tools/rocketsim/scenarios/34_ball_wall_2000.json
//
// Prints every point when it is added (after the contact callback and the
// internal-edge correction) and the final manifolds handed to the solver.
import fs from 'node:fs';
import { runScenarioJS, PHYSICS_DIR } from './run-js.mjs';

const { World } = await import(PHYSICS_DIR + 'world.js');
const tick = +(process.env.PROBE_TICK || 1);
const sc = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const kinds = { 1: 'ball-world', 2: 'car-world', 3: 'ball-car', 4: 'car-car' };
const f = (v, p = 4) => v.toFixed(p);

// Wrap World.step / the narrowphase add to print during the probed tick.
const origStep = World.prototype.step;
World.prototype.step = function (dt) {
  const probing = this.tick + 1 === tick;
  if (probing) {
    console.log(`---- tick ${tick}`);
    const np = this.np, origAdd = np._add;
    np._add = function (m, ...args) {
      const pt = origAdd.call(this, m, ...args);
      if (pt) console.log(`ADD ${kinds[m.kind]} tri=${pt.tri} n=(${f(pt.nx, 5)} ${f(pt.ny, 5)} ${f(pt.nz, 5)}) pA=(${f(pt.ax)} ${f(pt.ay)} ${f(pt.az)}) pB=(${f(pt.bx)} ${f(pt.by)} ${f(pt.bz)}) d=${f(pt.dist)} mu=${f(pt.friction, 3)} e=${f(pt.restitution, 3)} special=${pt.special ? 1 : 0}`);
      return pt;
    };
    const ev = origStep.call(this, dt);
    np._add = origAdd;
    for (let i = 0; i < np.nManifolds; i++) {
      const m = np.manifolds[i];
      console.log(`MANIFOLD ${i} ${kinds[m.kind]} n=${m.n}`);
      for (let k = 0; k < m.n; k++) {
        const pt = m.pts[k];
        console.log(`  pt n=(${f(pt.nx, 5)} ${f(pt.ny, 5)} ${f(pt.nz, 5)}) pA=(${f(pt.ax)} ${f(pt.ay)} ${f(pt.az)}) pB=(${f(pt.bx)} ${f(pt.by)} ${f(pt.bz)}) d=${f(pt.dist)}`);
      }
    }
    return ev;
  }
  return origStep.call(this, dt);
};
sc.ticks = Math.min(sc.ticks ?? 120, tick);
runScenarioJS(sc);
