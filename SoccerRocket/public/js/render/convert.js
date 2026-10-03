// Physics (uu, z-up, right-handed) <-> three.js (metres, y-up) conversion.
// three = (x, z, -y) * S
export const S = 0.01;

export function posToThree(v, out) { return out.set(v.x * S, v.z * S, -v.y * S); }
export function xyzToThree(x, y, z, out) { return out.set(x * S, z * S, -y * S); }
export function quatToThree(q, out) { return out.set(q.x, q.z, -q.y, q.w); }
export function dirToThree(v, out) { return out.set(v.x, v.z, -v.y); }
