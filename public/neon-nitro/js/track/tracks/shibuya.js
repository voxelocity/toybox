// Shibuya Scramble — neon downtown street circuit.
import { cityDressing } from '../scenery/city.js';

export default {
  id: 'shibuya',
  name: 'Shibuya Scramble',
  jp: '渋谷スクランブル',
  blurb: 'Neon canyons, the world\'s busiest crossing and a dive under the rail yard.',
  laps: 3,
  width: 20,
  music: 'citypop',
  seed: 88,
  points: [
    [60, 0, 0, 20], [120, 0], [170, 0],
    [208, 10], [226, 42],
    [230, 95], [232, 150, 0, 24],
    [232, 195, 0, 34], [232, 235, 0, 34],
    [236, 272, 0, 22], [258, 302, 0, 20],
    [305, 316], [385, 318], [440, 320],
    [480, 334, 0, 19], [494, 366], [478, 396], [438, 406],
    [380, 402], [320, 398], [268, 412],
    [226, 440], [178, 452], [122, 450],
    [80, 432], [56, 400, -3], [44, 352, -7],
    [42, 300, -7], [46, 252, -3], [58, 208, 0],
    [56, 164], [28, 134], [30, 98], [8, 66],
    [-14, 38], [-10, 12], [12, 0],
  ],
  theme: {
    light: '#c3c8ff', shadow: '#4b3d82', sky: '#2c2258', ground: '#140c22', rim: '#ff3fa4', fog: '#1d1238',
    skyTop: '#05030f', skyHorizon: '#7a2474', lightDir: [-0.45, 0.8, -0.35], fogNear: 90, fogFar: 560, rimStrength: 0.6, windowLit: 0.42,
    road: '#2c2b42', roadEdge: '#25243a', line: '#ecebff', sidewalk: '#6c6690', curb: '#c4bee0', rail: '#e9e6f4', barrier: '#cfcbe0',
    groundColor: '#1c1730', stars: 0.5, moonDir: [0.5, 0.42, -0.75], cloud: '#3c1848', centerLine: true,
    tunnel: '#4d4868', tunnelLight: '#ffb65c', tunnelStripe: '#ff2d6f', deck: '#3d3856',
  },
  edges: [
    { from: 0, to: 1, both: { kind: 'sidewalk', width: 4.5 } },
    { from: 0.19, to: 0.27, both: { kind: 'open', width: 9, surface: 'pave', lift: 0.02 } },
    { from: 0.735, to: 0.87, both: { kind: 'barrier', width: 2.2, height: 1.1 } },
  ],
  tunnels: [[0.765, 0.84]],
  scenery(track, chunks, rng) {
    cityDressing(track, chunks, rng, {
      hMin: 12, hMax: 70, intersections: [0.07, 0.585, 0.955], footbridges: [0.14, 0.64],
      gaps: [[0.72, 0.88]], trees: 'round', landmark: [260, -420, 210],
    });
  },
};
