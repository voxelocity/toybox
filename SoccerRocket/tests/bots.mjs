// Bot sanity: simulate bot-only matches headlessly and report what happens.
// Run: node tests/bots.mjs [mode] [difficulty] [minutes]
import { Match } from '../public/js/game/match.js';
import { DT } from '../public/js/physics/constants.js';

const mode = +(process.argv[2] || 3), diff = process.argv[3] || 'pro', minutes = +(process.argv[4] || 2);
const m = new Match({ mode, minutes, difficulty: diff, humanTeam: -1, seed: 42 });
let ticks = 0, touches = 0, goals = 0, demos = 0, replays = 0, kickoffTicks = 0, maxKickoff = 0, stuck = 0;
const t0 = performance.now();
const lastPos = m.world.cars.map((c) => c.pos.clone());
while (m.state !== 'ended' && ticks < 120 * 60 * (minutes + 3)) {
  m.tick(DT);
  ticks++;
  for (const e of m.events) {
    if (e.type === 'ballHit') touches++;
    if (e.type === 'goalScored') goals++;
    if (e.type === 'demo') demos++;
    if (e.type === 'replay') { replays++; m.afterReplay(); }
  }
  m.events.length = 0;
  if (m.kickoffActive && m.state === 'play') { kickoffTicks++; maxKickoff = Math.max(maxKickoff, kickoffTicks); } else kickoffTicks = 0;
  if (ticks % 240 === 0) m.world.cars.forEach((c, i) => { if (!c.isDemoed && c.pos.distTo(lastPos[i]) < 30 && m.state === 'play') stuck++; lastPos[i].copy(c.pos); });
}
const secs = ticks / 120;
console.log(`${mode}v${mode} ${diff}: ${secs.toFixed(0)}s sim in ${((performance.now() - t0) / 1000).toFixed(1)}s | score ${m.score.join('-')} | touches ${touches} goals ${goals} demos ${demos} | longest kickoff ${(maxKickoff / 120).toFixed(1)}s | stuck samples ${stuck} | state ${m.state}`);
for (const p of m.players) console.log(`  ${p.team ? 'O' : 'B'} ${p.name.padEnd(10)} score ${String(p.stats.score).padStart(4)}  g${p.stats.goals} a${p.stats.assists} sv${p.stats.saves} sh${p.stats.shots} touches ${p.stats.touches}`);
