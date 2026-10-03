// Stadium around the arena: stepped stands, instanced animated crowd, roof
// canopy with floodlights, LED ad ribbon and two jumbotrons.
import * as THREE from 'three';
import { S } from './convert.js';
import { makeGlowTexture } from './arena-view.js';

// Rounded rectangle path in uu (physics xy), counter-clockwise.
function roundedRect(hx, hy, rc, n) {
  const pts = [];
  const straightX = 2 * (hx - rc), straightY = 2 * (hy - rc), arc = Math.PI * rc / 2;
  const total = 2 * straightX + 2 * straightY + 4 * arc;
  for (let i = 0; i < n; i++) {
    let s = (i / n) * total;
    let x, y, nx, ny;
    const seg = [straightY, arc, straightX, arc, straightY, arc, straightX, arc];
    let k = 0;
    while (s > seg[k]) { s -= seg[k]; k++; }
    const corner = (cx, cy, a0) => { const a = a0 + s / rc; nx = Math.cos(a); ny = Math.sin(a); x = cx + nx * rc; y = cy + ny * rc; };
    switch (k) {
      case 0: x = hx; y = -(hy - rc) + s; nx = 1; ny = 0; break;
      case 1: corner(hx - rc, hy - rc, 0); break;
      case 2: x = (hx - rc) - s; y = hy; nx = 0; ny = 1; break;
      case 3: corner(-(hx - rc), hy - rc, Math.PI / 2); break;
      case 4: x = -hx; y = (hy - rc) - s; nx = -1; ny = 0; break;
      case 5: corner(-(hx - rc), -(hy - rc), Math.PI); break;
      case 6: x = -(hx - rc) + s; y = -hy; nx = 0; ny = -1; break;
      default: corner(hx - rc, -(hy - rc), Math.PI * 1.5); break;
    }
    pts.push({ x, y, nx, ny, s: (i / n) * total });
  }
  return { pts, total };
}

const SEAT_BLUE = new THREE.Color(0x1d4fb8), SEAT_ORANGE = new THREE.Color(0xd2601a), SEAT_GREY = new THREE.Color(0x3a3f4a);

function makeCrowdAtlas() {
  const W = 1024, H = 256, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.clearRect(0, 0, W, H);
  // channels: R = shirt, G = skin, B = dark (hair, trousers, phone)
  const shirt = (v) => `rgb(${v},0,0)`, skin = (v) => `rgb(0,${v},0)`, dark = (v) => `rgb(0,0,${v})`;
  const person = (cx, base, pose, seed) => {
    const sh = 0.9 + ((seed * 7) % 5) * 0.02;
    const hh = 92 * sh;
    // torso
    g.fillStyle = shirt(230);
    roundRect(g, cx - 21, base - hh, 42, hh - 6, 12); g.fill();
    g.fillStyle = shirt(170);
    roundRect(g, cx - 21, base - hh * 0.55, 42, hh * 0.5, 8); g.fill();
    // arms
    g.lineCap = 'round'; g.lineWidth = 12;
    const arm = (sx, up, out) => {
      g.strokeStyle = shirt(200);
      g.beginPath(); g.moveTo(cx + sx * 18, base - hh + 10);
      const ex = cx + sx * (18 + out), ey = up ? base - hh - 40 : base - hh + 46;
      g.lineTo(ex, ey); g.stroke();
      g.fillStyle = skin(220); g.beginPath(); g.arc(ex, ey + (up ? -4 : 4), 7, 0, Math.PI * 2); g.fill();
    };
    if (pose === 0) { arm(-1, false, 4); arm(1, false, 4); }
    else if (pose === 1) { arm(-1, false, 2); arm(1, false, 14); g.fillStyle = dark(255); g.fillRect(cx + 24, base - hh + 40, 9, 14); }
    else if (pose === 2) { arm(-1, true, 14); arm(1, false, 6); }
    else if (pose === 3) { arm(-1, false, -4); arm(1, false, -4); }
    else if (pose === 4) { arm(-1, true, 18); arm(1, true, 18); }
    else if (pose === 5) { arm(-1, true, 6); arm(1, true, 26); }
    else if (pose === 6) { arm(-1, true, 26); arm(1, true, 6); }
    else { arm(-1, true, 12); arm(1, true, 12); }
    // neck + head
    g.fillStyle = skin(200); g.fillRect(cx - 6, base - hh - 12, 12, 14);
    g.fillStyle = skin(235); g.beginPath(); g.ellipse(cx, base - hh - 26, 15, 18, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = dark(140 + (seed % 3) * 50);
    g.beginPath(); g.ellipse(cx, base - hh - 36, 16, 10, 0, Math.PI, Math.PI * 2); g.fill();
    if (seed % 4 === 0) { g.fillStyle = shirt(255); g.fillRect(cx - 17, base - hh - 46, 34, 9); } // cap
  };
  for (let f = 0; f < 8; f++) {
    const ox = f * 128;
    const pose = f;
    person(ox + 36, 236, pose, f * 3 + 1);
    person(ox + 94, 244, (pose + 2) % 4 + (pose >= 4 ? 4 : 0), f * 5 + 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

export class Stadium {
  constructor(scene, quality) {
    this.q = quality;
    this.group = new THREE.Group();
    this.group.name = 'stadium';
    scene.add(this.group);
    this.excite = 0;
    this.time = 0;
    this.crowdUniforms = {
      uTime: { value: 0 }, uExcite: { value: 0 }, uCam: { value: new THREE.Vector3() },
      uAtlas: { value: null }, uLight: { value: 0.85 },
      uTeamBlue: { value: new THREE.Color(0.12, 0.38, 1.0) }, uTeamOrange: { value: new THREE.Color(1.0, 0.45, 0.08) },
      uCheerTeam: { value: -1 },
    };
    this._buildGround();
    this._buildStands();
    this._buildRoof();
    this._buildAds();
    this._buildScreens();
  }

  _buildGround() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.9, metalness: 0.1 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.03;
    ground.receiveShadow = this.q.shadowSize > 0;
    this.group.add(ground);
  }

  _buildStands() {
    const lowerRows = 40, upperRows = 32;
    const N = this.q.stadiumDetail >= 2 ? 256 : 160;
    const base = roundedRect(4800, 6800, 2300, N);
    const pos = [], col = [], idx = [];
    const crowd = [];
    const tmp = new THREE.Color();
    const addRowStrip = (o0, o1, z0, z1, color, horiz) => {
      const start = pos.length / 3;
      for (let i = 0; i <= N; i++) {
        const p = base.pts[i % N];
        const section = Math.floor(p.s / 1400);
        const aisle = (p.s % 1400) < 70;
        tmp.copy(color);
        if (aisle) tmp.multiplyScalar(0.35);
        else if (horiz) tmp.multiplyScalar(0.85 + 0.15 * ((section * 7) % 3) / 2);
        for (const [o, z] of [[o0, z0], [o1, z1]]) {
          pos.push((p.x + p.nx * o) * S, z * S, -(p.y + p.ny * o) * S);
          col.push(tmp.r, tmp.g, tmp.b);
        }
      }
      for (let i = 0; i < N; i++) {
        const a = start + i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    };
    const seatColor = (p) => {
      const t = Math.abs(p.y) < 1800 ? SEAT_GREY : (p.y < 0 ? SEAT_BLUE : SEAT_ORANGE);
      return t;
    };
    const bowl = (rows, o0, z0, depth, rise, crowdStart) => {
      for (let r = 0; r < rows; r++) {
        const o = o0 + r * depth, z = z0 + r * rise;
        // tread: per-vertex colour by section, done per point via a second pass
        const start = pos.length / 3;
        for (let i = 0; i <= N; i++) {
          const p = base.pts[i % N];
          const aisle = (p.s % 1400) < 80;
          tmp.copy(seatColor(p)).multiplyScalar(aisle ? 0.3 : 0.75 + 0.1 * (r % 2));
          for (const oo of [o, o + depth]) {
            pos.push((p.x + p.nx * oo) * S, z * S, -(p.y + p.ny * oo) * S);
            col.push(tmp.r, tmp.g, tmp.b);
          }
          if (!aisle && r >= crowdStart && i < N && (i % 1 === 0)) {
            // crowd clusters along this tread
            const p2 = base.pts[(i + 1) % N];
            const segLen = Math.hypot(p2.x - p.x, p2.y - p.y) * (1 + o / 6000);
            const count = Math.max(1, Math.round(segLen / 120));
            for (let k = 0; k < count; k++) {
              const t = k / count;
              const px = p.x + (p2.x - p.x) * t, py = p.y + (p2.y - p.y) * t;
              const nx = p.nx + (p2.nx - p.nx) * t, ny = p.ny + (p2.ny - p.ny) * t;
              const oc = o + depth * 0.55;
              crowd.push([px + nx * oc, py + ny * oc, z, Math.abs(py) < 1800 ? 2 : (py < 0 ? 0 : 1)]);
            }
          }
        }
        for (let i = 0; i < N; i++) { const a = start + i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
        // riser
        const rs = pos.length / 3;
        for (let i = 0; i <= N; i++) {
          const p = base.pts[i % N];
          for (const zz of [z, z + rise]) {
            pos.push((p.x + p.nx * (o + depth)) * S, zz * S, -(p.y + p.ny * (o + depth)) * S);
            col.push(0.07, 0.075, 0.09);
          }
        }
        for (let i = 0; i < N; i++) { const a = rs + i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      }
    };
    bowl(lowerRows, 0, -120, 95, 56, 1);
    // concourse band with facade
    const cz = -120 + lowerRows * 56, co = lowerRows * 95;
    addRowStrip(co, co + 420, cz, cz, new THREE.Color(0x15181e), true);
    addRowStrip(co + 420, co + 420, cz, cz + 380, new THREE.Color(0x0d0f13), false);
    bowl(upperRows, co + 420, cz + 380, 100, 66, 0);
    this.standTop = { o: co + 420 + upperRows * 100, z: cz + 380 + upperRows * 66 };
    // back wall
    addRowStrip(this.standTop.o, this.standTop.o, this.standTop.z, this.standTop.z + 900, new THREE.Color(0x111318), false);
    this.concourse = { o: co, z: cz };

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.1 });
    const stands = new THREE.Mesh(g, mat);
    stands.receiveShadow = this.q.shadowSize > 0;
    this.group.add(stands);
    this.base = base;

    // crowd
    const density = this.q.crowd;
    if (density > 0) this._buildCrowd(crowd, density);
  }

  _buildCrowd(list, density) {
    const rnd = mulberry(99);
    const kept = list.filter(() => rnd() < 0.92 * density);
    const n = kept.length;
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.translate(0, 0.5, 0);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.getAttribute('position'));
    g.setAttribute('uv', quad.getAttribute('uv'));
    const aPos = new Float32Array(n * 3), aRnd = new Float32Array(n * 4), aTeam = new Float32Array(n);
    kept.forEach(([x, y, z, team], i) => {
      aPos[i * 3] = x * S; aPos[i * 3 + 1] = z * S; aPos[i * 3 + 2] = -y * S;
      aRnd[i * 4] = rnd() * 6.283; aRnd[i * 4 + 1] = Math.floor(rnd() * 4); aRnd[i * 4 + 2] = rnd(); aRnd[i * 4 + 3] = rnd();
      aTeam[i] = team === 2 ? (rnd() < 0.5 ? 0 : 1) : (rnd() < 0.85 ? team : 1 - team);
    });
    g.setAttribute('aPos', new THREE.InstancedBufferAttribute(aPos, 3));
    g.setAttribute('aRnd', new THREE.InstancedBufferAttribute(aRnd, 4));
    g.setAttribute('aTeam', new THREE.InstancedBufferAttribute(aTeam, 1));
    g.instanceCount = n;
    this.crowdUniforms.uAtlas.value = makeCrowdAtlas();
    const mat = new THREE.ShaderMaterial({
      uniforms: this.crowdUniforms,
      vertexShader: /* glsl */`
        attribute vec3 aPos; attribute vec4 aRnd; attribute float aTeam;
        uniform float uTime, uExcite, uCheerTeam; uniform vec3 uCam;
        varying vec2 vUv; varying vec4 vRnd; varying float vTeam; varying float vFrame;
        void main(){
          vRnd = aRnd; vTeam = aTeam;
          float ex = uExcite * (uCheerTeam < 0.0 || abs(uCheerTeam - aTeam) < 0.5 ? 1.0 : 0.25);
          float idle = 0.012 * sin(uTime * (1.2 + aRnd.z) + aRnd.x);
          float hop = ex * max(0.0, sin(uTime * (7.0 + aRnd.w * 3.0) + aRnd.x)) * (0.22 + 0.2 * aRnd.z);
          float cheer = step(0.35, ex) * step(0.0, sin(uTime * 3.0 + aRnd.x * 3.0));
          vFrame = aRnd.y + cheer * 4.0;
          vec3 toCam = uCam - aPos; toCam.y = 0.0;
          vec3 fwd = normalize(toCam + vec3(1e-4));
          vec3 right = vec3(fwd.z, 0.0, -fwd.x);
          vec3 p = aPos + right * (position.x * 1.25) + vec3(0.0, position.y * 1.32 + idle + hop - 0.18, 0.0);
          vUv = uv;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uAtlas; uniform vec3 uTeamBlue, uTeamOrange; uniform float uLight;
        varying vec2 vUv; varying vec4 vRnd; varying float vTeam; varying float vFrame;
        void main(){
          vec2 uv = vec2((vFrame + vUv.x) / 8.0, vUv.y);
          vec4 m = texture2D(uAtlas, uv);
          float a = max(max(m.r, m.g), m.b);
          if (a < 0.35) discard;
          vec3 team = vTeam < 0.5 ? uTeamBlue : uTeamOrange;
          vec3 shirt = mix(team, vec3(0.92), step(0.78, vRnd.z) * 0.8);
          shirt = mix(shirt, vec3(0.05), step(0.93, vRnd.z));
          vec3 skin = mix(vec3(0.95, 0.72, 0.56), vec3(0.36, 0.22, 0.14), vRnd.w);
          vec3 col = shirt * m.r + skin * m.g * 0.85 + vec3(0.06, 0.05, 0.05) * m.b;
          col /= max(a, 1e-3);
          gl_FragColor = vec4(col * uLight * (0.7 + 0.3 * vUv.y), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.crowd = mesh;
  }

  _buildRoof() {
    const top = this.standTop;
    const N = 96;
    const outer = roundedRect(4800, 6800, 2300, N);
    const pos = [], idx = [];
    const zRoof = top.z + 900;
    const inner = this.concourse.o + 400;
    for (let i = 0; i <= N; i++) {
      const p = outer.pts[i % N];
      for (const [o, z] of [[inner, zRoof - 120], [top.o + 200, zRoof + 120]]) pos.push((p.x + p.nx * o) * S, z * S, -(p.y + p.ny * o) * S);
    }
    for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const roof = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.6, metalness: 0.6, side: THREE.DoubleSide }));
    roof.castShadow = this.q.shadowSize >= 2048;
    this.group.add(roof);

    // light strip along the roof's inner edge + floodlight banks
    const strip = [], sIdx = [];
    for (let i = 0; i <= N; i++) {
      const p = outer.pts[i % N];
      for (const dz of [-150, -110]) strip.push((p.x + p.nx * inner) * S, (zRoof + dz) * S, -(p.y + p.ny * inner) * S);
    }
    for (let i = 0; i < N; i++) { const a = i * 2; sIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(strip, 3));
    sg.setIndex(sIdx);
    this.group.add(new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.7, 2.0), side: THREE.DoubleSide, toneMapped: false })));

    const glowMat = new THREE.SpriteMaterial({ map: makeGlowTexture(), color: 0xfff4e0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 });
    const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3, 2.8), toneMapped: false });
    const lampGeo = new THREE.BoxGeometry(3.2, 0.5, 1.2);
    for (let i = 0; i < N; i += 4) {
      const p = outer.pts[i];
      const x = (p.x + p.nx * (inner + 60)) * S, y = (zRoof - 170) * S, z = -(p.y + p.ny * (inner + 60)) * S;
      const lamp = new THREE.Mesh(lampGeo, lampMat);
      lamp.position.set(x, y, z);
      lamp.lookAt(0, 0, 0);
      this.group.add(lamp);
      if (this.q.flares) {
        const s = new THREE.Sprite(glowMat);
        s.position.set(x, y, z);
        s.scale.set(9, 9, 1);
        this.group.add(s);
      }
    }
  }

  _buildAds() {
    const c = document.createElement('canvas');
    c.width = 2048; c.height = 64;
    const g = c.getContext('2d');
    const words = ['SOCCER ROCKET', 'SUPERSONIC', 'BOOST UP', 'AERIAL ACE', 'TURBO TURF', 'KICKOFF', 'DEMO DERBY', 'GOAL RUSH'];
    const colors = ['#2f7dff', '#ff7a1a', '#ffffff', '#ffd23f'];
    let x = 0, i = 0;
    while (x < c.width) {
      const bg = i % 2 ? '#0b0e14' : '#10141c';
      g.fillStyle = bg; g.fillRect(x, 0, 256, 64);
      g.font = 'bold 34px Arial, sans-serif'; g.textBaseline = 'middle';
      g.fillStyle = colors[i % colors.length];
      g.fillText(words[i % words.length], x + 14, 33);
      x += 256; i++;
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    this.adTex = tex;
    const N = 160, path = roundedRect(4800, 6800, 2300, N);
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const p = path.pts[i % N], s = i === N ? path.total : p.s;
      for (const [z, v] of [[-120, 0], [-10, 1]]) {
        pos.push((p.x - p.nx * 10) * S, z * S, -(p.y - p.ny * 10) * S);
        uv.push(s / 4000, v);
      }
    }
    for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, color: new THREE.Color(1.6, 1.6, 1.6) });
    this.group.add(new THREE.Mesh(geo, mat));
  }

  _buildScreens() {
    this.screens = [];
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 440;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.screenCanvas = c; this.screenTex = tex;
    const top = this.standTop;
    for (const sy of [-1, 1]) {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(38, 17, 1.2), new THREE.MeshStandardMaterial({ color: 0x15171c, metalness: 0.7, roughness: 0.4 }));
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(36, 15.5), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, color: new THREE.Color(1.4, 1.4, 1.4) }));
      const y = sy * (6800 + top.o * 0.55), z = top.z + 600;
      frame.position.set(0, z * S, -y * S);
      screen.position.set(0, z * S, -(y - sy * 70) * S);
      frame.lookAt(0, z * S * 0.4, 0); screen.lookAt(0, z * S * 0.4, 0);
      this.group.add(frame, screen);
      this.screens.push(screen);
    }
    this.drawScreen({ score: [0, 0], time: '5:00', message: 'SOCCER ROCKET' });
  }

  drawScreen(info) {
    const c = this.screenCanvas, g = c.getContext('2d');
    const W = c.width, H = c.height;
    const grad = g.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, '#0a2b78'); grad.addColorStop(0.5, '#0b0e16'); grad.addColorStop(1, '#7a3205');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.05)';
    for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 150px Arial, sans-serif';
    g.fillStyle = '#5aa0ff'; g.fillText(String(info.score[0]), W * 0.17, H * 0.45);
    g.fillStyle = '#ffa04a'; g.fillText(String(info.score[1]), W * 0.83, H * 0.45);
    g.fillStyle = '#ffffff'; g.font = 'bold 110px Arial, sans-serif';
    g.fillText(info.time, W * 0.5, H * 0.42);
    g.font = 'bold 52px Arial, sans-serif';
    g.fillStyle = info.messageColor || '#ffe27a';
    g.fillText(info.message || '', W * 0.5, H * 0.82);
    this.screenTex.needsUpdate = true;
  }

  update(dt, camPos) {
    this.time += dt;
    this.excite = Math.max(0, this.excite - dt * 0.12);
    this.crowdUniforms.uTime.value = this.time;
    this.crowdUniforms.uExcite.value = Math.min(1, this.excite);
    this.crowdUniforms.uCam.value.copy(camPos);
    if (this.adTex) this.adTex.offset.x = (this.time * 0.05) % 1;
  }

  cheer(amount, team = -1) {
    this.excite = Math.max(this.excite, amount);
    this.crowdUniforms.uCheerTeam.value = team;
  }
}

function mulberry(seed) {
  let a = seed;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
