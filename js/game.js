'use strict';
(() => {
// =====================================================================
//  BALL RUSH — 속도와 도파민 (구 MOCHI RUSH. 세이브 키·디버그 객체 이름은 호환을 위해 유지)
// =====================================================================
const $ = id => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = Math.max(320, window.innerWidth); H = Math.max(240, window.innerHeight);
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
}
window.addEventListener('resize', resize);
resize();

// ---------- utils ----------
const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick = a => a[Math.floor(Math.random() * a.length)];
const smooth = t => t * t * (3 - 2 * t);
function hash(i) {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function fmtComma(n) { return Math.floor(n).toLocaleString('en-US'); }
// 1억 2345만 처럼 한국식 단위
function fmtKR(n) {
  n = Math.floor(n);
  if (n < 10000) return fmtComma(n);
  const units = [['경', 1e16], ['조', 1e12], ['억', 1e8], ['만', 1e4]];
  const out = [];
  let rest = n;
  for (const [u, v] of units) {
    if (rest >= v) {
      const q = Math.floor(rest / v);
      rest -= q * v;
      out.push(q.toLocaleString('en-US') + u);
      if (out.length >= 2) break;
    } else if (out.length) break;
  }
  return out.join(' ');
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + dx * t - px, cy = ay + dy * t - py;
  return Math.sqrt(cx * cx + cy * cy);
}

// ---------- tuning ----------
const STEP = 10;          // 지형 점 간격(px)
const G = 2300;           // 중력
const R = 26;             // 공 반지름
const THRUST = 1300;      // 꾹 눌렀을 때 가속
const DRAG = 0.00034;     // 공기저항 (속도^2)
const ROLL = 140;         // 손 뗐을 때 구름 마찰
const KMH = 0.12;         // px/s → km/h 표시 배율
const MAX_SPEED = 5600;
const PX_PER_M = 30;
const START_X = 200;
const JUMP_VY = 1750;
const PERFECT_WIN = 0.2;  // 떼고 나서 이 시간 안에 착지하면 PERFECT
const GREAT_WIN = 0.42;
const MIN_AIR = 0.32;     // 이 이상 떠 있어야 착지 판정
const COIN_SPACING = 1.7;  // 자석으로 거의 다 먹으니 맵 코인 간격을 넓혀 경제 유지
const MAGNET_R = 170;     // 평소 코인 자석 반경
const MAGNET_GOLD = 260;   // GOLD RUSH 중
const MAGNET_FEVER = 380;  // FEVER 중
const AIR_PTS = 15000;    // 체공 점수 기본값 (x 체공시간^1.7 x 배율)
const SPEED_MILESTONES = [200, 250, 300, 350, 400, 450, 500, 600];
const F_NUM = "'Bungee','Arial Black',sans-serif";
const F_KR = "'Black Han Sans','Malgun Gothic',sans-serif";

// =====================================================================
//  Terrain: x 간격이 일정한 높이맵 (y는 아래로 +)
// =====================================================================
class Terrain {
  constructor() { this.ys = []; this.offset = 0; this._c = { d: 0, nx: 0, ny: -1 }; }
  get endX() { return (this.offset + this.ys.length - 1) * STEP; }
  push(y) { this.ys.push(y); }
  heightAt(x) {
    const ys = this.ys, n = ys.length;
    const f = x / STEP - this.offset;
    if (f <= 0) return ys[0];
    if (f >= n - 1) return ys[n - 1];
    const i = f | 0, t = f - i;
    return ys[i] + (ys[i + 1] - ys[i]) * t;
  }
  slopeAt(x) {
    const ys = this.ys, n = ys.length;
    let i = Math.floor(x / STEP) - this.offset;
    if (i < 0) i = 0; if (i > n - 2) i = n - 2;
    return (ys[i + 1] - ys[i]) / STEP;
  }
  // 원 중심에서 가장 가까운 지형 위의 점까지 거리와 법선
  closest(px, py, r) {
    const ys = this.ys, lo = this.offset, hi = lo + ys.length - 1;
    let i0 = Math.floor((px - r) / STEP) - 1, i1 = Math.ceil((px + r) / STEP) + 1;
    if (i0 < lo) i0 = lo; if (i1 > hi) i1 = hi;
    let bd = 1e18, bx = px, by = py + 1e9;
    for (let i = i0; i < i1; i++) {
      const ax = i * STEP, ay = ys[i - lo], dx = STEP, dy = ys[i + 1 - lo] - ay;
      let t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = ax + dx * t, cy = ay + dy * t;
      const d = (px - cx) * (px - cx) + (py - cy) * (py - cy);
      if (d < bd) { bd = d; bx = cx; by = cy; }
    }
    const c = this._c, d = Math.sqrt(bd);
    c.d = d;
    if (d > 1e-6) { c.nx = (px - bx) / d; c.ny = (py - by) / d; } else { c.nx = 0; c.ny = -1; }
    return c;
  }
  trim(minX) {
    const k = Math.floor(minX / STEP) - this.offset;
    if (k > 3000) { this.ys.splice(0, k); this.offset += k; }
  }
}

// =====================================================================
//  Track generator: 도파민 지형 조각들을 무한히 이어 붙인다
// =====================================================================
class TrackGen {
  constructor(w) {
    this.w = w; this.T = w.terrain; this.y = 0; this.s = 0; this.last = '';
    this.T.offset = -300; // 출발점 왼쪽에도 땅이 보이도록
    for (let i = 0; i <= 300; i++) this.T.push(0);
  }
  get x() { return this.T.endX; }
  diff() { return clamp((this.x - START_X) / 120000, 0, 1); }
  gy(x) { return this.T.heightAt(x); }

  // 기울기를 부드럽게 to 까지 바꾸며 len 만큼 진행
  seg(len, to) {
    const n = Math.max(1, Math.round(len / STEP)), s0 = this.s;
    for (let k = 1; k <= n; k++) { const s = s0 + (to - s0) * smooth(k / n); this.y += s * STEP; this.T.push(this.y); }
    this.s = to;
  }
  hold(len) {
    const n = Math.max(1, Math.round(len / STEP));
    for (let k = 0; k < n; k++) { this.y += this.s * STEP; this.T.push(this.y); }
  }
  drop(d, ns) { this.y += d; this.T.push(this.y); this.s = ns; }
  ensure(x) { let g = 0; while (this.x < x && g++ < 60) this.next(); }

  start() {
    this.hold(700);
    this.seg(400, 0.3);
    const a = this.x; this.hold(1500);
    this.coinWave(a + 100, this.x - 100, 12, 70);
    this.seg(400, 0.04); this.hold(200);
    this.kicker(0, false);
  }

  next() {
    const d = this.diff();
    const table = [
      ['kicker', 4], ['mega', 1.4 + d * 2], ['rollers', 3], ['downhill', 2.4], ['valley', 2],
      ['stairs', 1.6], ['bigdrop', 1.2], ['jumppad', 2], ['gauntlet', 0.9 + d * 3], ['lowgrav', 1.3], ['speedway', 1.2],
    ];
    let tot = 0;
    for (const [n, w] of table) if (n !== this.last) tot += w;
    let r = Math.random() * tot, name = 'kicker';
    for (const [n, w] of table) { if (n === this.last) continue; r -= w; if (r <= 0) { name = n; break; } }
    this.last = name;
    if (name === 'mega') this.kicker(d, true); else this[name](d);
  }

  // ---- objects ----
  coin(x, y, big = false) { this.w.coins.push({ x, y, big, taken: false, t: 0, ph: Math.random() * TAU }); }
  coinLine(x1, x2, n, off = 55) {
    n = Math.max(2, Math.round(n / COIN_SPACING));
    for (let i = 0; i < n; i++) { const x = lerp(x1, x2, n === 1 ? 0.5 : i / (n - 1)); this.coin(x, this.gy(x) - R - off); }
  }
  coinWave(x1, x2, n, amp) {
    n = Math.max(3, Math.round(n / COIN_SPACING));
    for (let i = 0; i < n; i++) {
      const x = lerp(x1, x2, i / (n - 1));
      this.coin(x, this.gy(x) - R - 45 - Math.abs(Math.sin(i / n * TAU * 1.5)) * amp);
    }
  }
  enemy(x, kind = 'ground') {
    const size = rand(46, 56);
    let y = this.gy(x) - size * 0.42;
    if (kind === 'float') y -= rand(30, 70);
    this.w.enemies.push({
      x, y, baseY: y, size, kind, alive: true, ph: rand(0, TAU), dead: 0, rot: 0,
      bob: kind === 'float' ? rand(16, 30) : 0,
      spin: kind === 'spin' ? rand(2.5, 4.5) * (Math.random() < 0.5 ? -1 : 1) : 0,
    });
  }
  pad(x1, x2, type) { this.w.pads.push({ x1, x2, type, used: false }); }
  ring(x, y) { this.w.rings.push({ x, y, h: 90, taken: false, t: 0 }); }
  traj(x, y, vx, vy, gs, cb) {
    const h = 1 / 60;
    let t = 0, i = 0;
    while (t < 4.5) {
      const sp = Math.hypot(vx, vy);
      vx -= vx * sp * DRAG * 0.45 * h;
      vy += (G * gs - vy * sp * DRAG * 0.45) * h;
      x += vx * h; y += vy * h; t += h; i++;
      if (y + R >= this.T.heightAt(x)) return;
      cb(x, y, t, i);
    }
  }
  // 발사 궤적을 따라 코인/링 배치
  arcObjects(x, y, v, ang, gs, opt) {
    let apex = null;
    const pts = [];
    this.traj(x, y, Math.cos(ang) * v, -Math.sin(ang) * v, gs, (px, py) => {
      pts.push([px, py]);
      if (!apex || py < apex[1]) apex = [px, py];
    });
    const every = Math.round((opt.every || 5) * COIN_SPACING);
    for (let i = every; i < pts.length - 2; i += every) this.coin(pts[i][0], pts[i][1]);
    if (apex && opt.ring) this.ring(apex[0], apex[1]);
    return { apex, pts };
  }

  // ---- features ----
  kicker(d, big) {
    const rise = big ? rand(450, 560) : rand(250, 340);
    const sl = big ? -rand(1.0, 1.2) : -rand(0.62, 0.85);
    this.seg(220, 0);
    const a = this.x; this.hold(rand(280, 460));
    if (Math.random() < 0.55) this.pad(a + 60, a + 210, 'speed'); else this.coinLine(a + 40, this.x - 30, 5);
    this.seg(rise, sl); this.hold(30);
    const lx = this.x, ly = this.y;
    this.drop(big ? rand(350, 600) : rand(100, 220), 0.5);
    this.seg(160, 0.55); this.hold(big ? 3800 : 2700);
    const landEnd = this.x;
    this.seg(700, 0.06);
    const r = this.arcObjects(lx, ly - R - 2, big ? 2200 : 1750, Math.atan(-sl), 1, { ring: Math.random() < 0.6, every: 5 });
    if (big && r.apex && Math.random() < 0.6) this.coin(r.apex[0], r.apex[1] - 140, true);
    if (d > 0.05 && Math.random() < 0.3 + d * 0.4) this.enemy(landEnd - rand(100, 600), Math.random() < 0.3 ? 'float' : 'ground');
  }
  rollers(d) {
    this.seg(200, 0.05);
    const n = randi(3, 6), amp = rand(55, 140), P = rand(480, 720), tilt = 0.06;
    const x0 = this.x, y0 = this.y, N = Math.round(n * P / STEP);
    for (let i = 1; i <= N; i++) { const u = i * STEP; this.T.push(y0 - amp * (1 - Math.cos(TAU * u / P)) / 2 + tilt * u); }
    this.y = this.T.ys[this.T.ys.length - 1]; this.s = tilt;
    for (let j = 0; j < n; j++) {
      const cx = x0 + P * (j + 0.5);
      this.coin(cx, this.gy(cx) - R - 75);
      if (Math.random() < 0.25) { this.coin(cx - 70, this.gy(cx - 70) - R - 60); this.coin(cx + 70, this.gy(cx + 70) - R - 60); }
    }
    if (d > 0.2 && Math.random() < 0.45) this.enemy(x0 + P * randi(1, n - 1));
    this.seg(200, 0.05);
  }
  downhill(d) {
    const s = rand(0.3, 0.55);
    this.seg(380, s);
    const a = this.x, L = rand(1300, 2300);
    this.hold(L);
    if (Math.random() < 0.6) this.pad(a + 100, a + 260, 'speed');
    this.coinWave(a + 350, a + L - 100, randi(8, 14), rand(40, 110));
    const ne = d < 0.1 ? (Math.random() < 0.5 ? 1 : 0) : randi(1, 1 + Math.floor(d * 3));
    for (let i = 0; i < ne; i++) {
      const k = Math.random();
      this.enemy(a + L * rand(0.45, 0.95), k < 0.3 ? 'float' : k < 0.55 ? 'spin' : 'ground');
    }
    this.seg(450, 0.04);
  }
  valley(d) {
    this.seg(260, 0.05); this.hold(150);
    this.seg(420, rand(0.75, 0.95));
    const vb = this.x; this.hold(rand(200, 380));
    this.seg(rand(480, 620), -rand(1.0, 1.3)); this.hold(30);
    const lx = this.x, ly = this.y, sl = this.s;
    this.drop(rand(250, 450), 0.5); this.seg(160, 0.55); this.hold(4000);
    const le = this.x; this.seg(700, 0.05);
    this.coinLine(vb - 200, vb + 150, 5, 40);
    const r = this.arcObjects(lx, ly - R - 2, 2300, Math.atan(-sl), 1, { ring: true, every: 5 });
    if (r.apex && Math.random() < 0.5) this.coin(r.apex[0], r.apex[1] - 130, true);
    if (d > 0.1 && Math.random() < 0.5) this.enemy(le - rand(200, 800));
  }
  stairs(d) {
    this.seg(220, 0.08);
    const n = randi(3, 5);
    for (let i = 0; i < n; i++) {
      this.hold(rand(140, 220));
      this.seg(160, -rand(0.45, 0.65)); this.hold(20);
      const lx = this.x, ly = this.y, sl = this.s;
      this.drop(rand(140, 240), 0.35); this.seg(120, 0.4); this.hold(rand(750, 950)); this.seg(160, 0.08);
      this.arcObjects(lx, ly - R - 2, 1700, Math.atan(-sl), 1, { every: 6 });
      if (d > 0.25 && Math.random() < 0.25) this.enemy(this.x - rand(80, 200));
    }
  }
  bigdrop(d) {
    this.seg(240, 0); this.hold(260);
    const lx = this.x, ly = this.y;
    this.drop(rand(650, 1000), 0.62); this.seg(140, 0.62); this.hold(3600);
    const le = this.x; this.seg(700, 0.05);
    this.coinLine(lx - 200, lx - 20, 3);
    this.arcObjects(lx, ly - R - 2, 1700, 0, 1, { every: 4 });
    if (d > 0.1 && Math.random() < 0.5) this.enemy(le - rand(100, 600));
  }
  jumppad(d) {
    this.seg(220, 0);
    const a = this.x; this.hold(320);
    this.pad(a + 110, a + 230, 'jump');
    this.hold(1900); this.seg(300, 0.35); this.hold(1300); this.seg(400, 0.04);
    this.arcObjects(a + 170, this.gy(a + 170) - R - 2, Math.hypot(1300, JUMP_VY), Math.atan2(JUMP_VY, 1300), 1, { ring: true, every: 4 });
    if (d > 0.2 && Math.random() < 0.4) this.enemy(this.x - rand(300, 700));
  }
  gauntlet(d) {
    this.seg(320, 0.22);
    const a = this.x;
    this.pad(a + 40, a + 200, 'speed');
    const L = rand(1700, 2400); this.hold(L); this.seg(450, 0.04);
    const n = 2 + Math.floor(d * 4 + Math.random() * 1.5);
    for (let i = 0; i < n; i++) {
      const x = a + 450 + (L - 500) * (i + 0.5) / n + rand(-60, 60);
      const k = Math.random();
      this.enemy(x, k < 0.25 ? 'spin' : k < 0.5 ? 'float' : 'ground');
    }
    this.coinLine(a + 300, a + L - 100, randi(10, 16), 95);
  }
  lowgrav(d) {
    this.seg(220, 0);
    const a = this.x; this.hold(330);
    this.pad(a + 80, a + 240, 'lowgrav');
    this.hold(150);
    this.seg(380, -0.85); this.hold(30);
    const lx = this.x, ly = this.y;
    this.drop(rand(200, 320), 0.45); this.seg(150, 0.48); this.hold(5200); this.seg(700, 0.05);
    this.arcObjects(lx, ly - R - 2, 1700, Math.atan(0.85), 0.42, { ring: true, every: 6 });
  }
  speedway(d) {
    this.seg(260, 0.12);
    const a = this.x; this.hold(2200);
    for (let i = 0; i < 3; i++) { const x = a + 150 + i * 650; this.pad(x, x + 150, 'speed'); }
    this.coinWave(a + 100, a + 2100, 16, 60);
    this.seg(300, 0.02);
    if (d > 0.15) this.enemy(a + 2000);
  }
}

// =====================================================================
//  Jelly: 쫀득한 공의 외곽선 (스프링 연결 정점들)
// =====================================================================
class Jelly {
  constructor(n = 24) {
    this.n = n;
    this.r = new Float32Array(n).fill(1);
    this.v = new Float32Array(n);
    this.cs = new Float32Array(n); this.sn = new Float32Array(n);
    for (let i = 0; i < n; i++) { const a = i / n * TAU; this.cs[i] = Math.cos(a); this.sn[i] = Math.sin(a); }
  }
  update(dt, velAng, stretch, press, nx, ny, charge) {
    if (dt <= 0) return;
    const n = this.n, sub = 2, h = dt / sub;
    const vc = Math.cos(velAng), vs = Math.sin(velAng);
    for (let s = 0; s < sub; s++) {
      for (let i = 0; i < n; i++) {
        const c = this.cs[i], sn = this.sn[i];
        const along = c * vc + sn * vs;                 // cos(a - velAng)
        let tgt = 1 + stretch * (2 * along * along - 1) - stretch * 0.3;
        if (press) { const d = c * nx + sn * ny; tgt += press * (0.08 * (1 - d * d) - 0.1 * d * d); }
        tgt *= 1 - 0.13 * charge;
        const lap = this.r[(i + n - 1) % n] + this.r[(i + 1) % n] - 2 * this.r[i];
        this.v[i] += (420 * (tgt - this.r[i]) - 10 * this.v[i] + 260 * lap) * h;
      }
      for (let i = 0; i < n; i++) this.r[i] = clamp(this.r[i] + this.v[i] * h, 0.5, 1.7);
    }
  }
  impulse(nx, ny, amt) {
    for (let i = 0; i < this.n; i++) {
      const d = this.cs[i] * nx + this.sn[i] * ny;
      this.v[i] += amt * ((1 - d * d) * 0.9 - d * d * 1.4);
    }
  }
  poke(amt) { for (let i = 0; i < this.n; i++) this.v[i] += (Math.random() - 0.5) * amt; }
}

// 원기둥 주위 공기 흐름(포텐셜 유동) 유선 — 공기를 가르는 연출용
const STREAMS = (() => {
  const out = [];
  for (const c of [0.16, 0.42, 0.78, 1.25, 1.85]) {
    const pts = [];
    let y0 = 0;
    for (let x = 3.4; x >= -5.5; x -= 0.12) {
      let lo = 0.0001, hi = c + 3;
      for (let k = 0; k < 32; k++) {
        const m = (lo + hi) / 2;
        if (m - m / (x * x + m * m) - c > 0) hi = m; else lo = m;
      }
      let y = (lo + hi) / 2;
      if (x >= 0) y0 = y; else y = lerp(y, y0, clamp(-x / 2, 0, 1) * 0.75); // 뒤쪽은 와류처럼 퍼진 채로
      pts.push(x, y);
    }
    out.push(pts);
  }
  return out;
})();

const STARS = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random() * 0.65, s: rand(0.6, 2.2), tw: rand(0, TAU) }));
const LINES = Array.from({ length: 70 }, () => ({ x: rand(-1.5, 1.5), y: rand(-1, 1), len: rand(0.08, 0.35), w: rand(1, 3.2), sp: rand(0.6, 1.5), hue: rand(0, 360) }));

// =====================================================================
//  State
// =====================================================================
let mode = 'menu'; // demo | play | pause | dead
let world, gen, p, jelly, st, cam, skill;
let time = 0, shake = 0, flashA = 0, flashCol = '#fff', slowT = 0, slowScale = 1, hitstop = 0;
let zoomKick = 0, scorePunch = 0, multPunch = 0, boostVis = 0, perfectFlash = 0, boomCd = 0;
let parts = [], waves = [], pops = [], banners = [], trail = [], dust = [];
let pred = null, deathT = 0, goShown = false, cleanT = 0, saveT = 0, lineAng = 0, lastCamX = 0;
const bgOff = [0, 0, 0, 0, 0];
let bgRefY = 0;
const frameFlags = { invincible: false, noDrag: false, thrust: 0, gold: false };
let goldVis = 0, coinPunch = 0, coinRain = [], flyCoins = [], odPunch = 0;
const GOLD = () => goldVis > 0.5;
let cheatNoCd = false; // 치트: 스킬 쿨타임 0 (` + 1 토글)
const holdPointers = new Set();
let keyHold = false;
const input = { get down() { return holdPointers.size > 0 || keyHold; } };

function baseZoom() { return Math.min(H / 820, W / 1350); }
function speed() { return Math.hypot(p.vx, p.vy); }
// 이번 판 동안 유지되는 보정치 (성장형 스킬 등)
const mods = { thrust: 1, drag: 1, limitKm: 0, orbs: 0 };
function limitKm() { return st.breakKm + mods.limitKm; }
// 폭주 스택별 불꽃 트레일: 1~6 붉은 불꽃(점점 커짐) → 7~9 파란 불꽃 → 10~ 검은 불꽃
function flameStyle(n) {
  if (n <= 0) return null;
  if (n <= 6) return { tier: 0, scale: 0.55 + 0.13 * n, power: 0.35 + 0.1 * n, add: true, cols: ['#ffe2a0', '#ff6a2b', '#c4142e'] };
  if (n <= 9) { const k = n - 6; return { tier: 1, scale: 1.35 + 0.18 * k, power: 0.9 + 0.1 * k, add: true, cols: ['#f0fcff', '#3dc8ff', '#1640ff'] }; }
  const k = Math.min(n - 9, 6);
  return { tier: 2, scale: 1.9 + 0.12 * k, power: 1, add: false, cols: ['#000000', '#140320', '#6a0fa0'] };
}
function breakSpeed() { return limitKm() / KMH; }
function sfx(name, ...a) { if (mode === 'play') Sfx[name](...a); }

function newRun(demo) {
  world = { terrain: new Terrain(), coins: [], enemies: [], pads: [], rings: [], sky: null };
  gen = new TrackGen(world);
  gen.start();
  gen.ensure(START_X + 9000);
  const y = world.terrain.heightAt(START_X) - R;
  p = {
    x: START_X, y, vx: 250, vy: 0, grounded: true, airTime: 0, nx: 0, ny: -1, tx: 1, ty: 0,
    rot: 0, spin: 0, charge: 0, airHeld: false, releaseT: -1, lowGravT: 0, noSnapT: 0,
    alive: true, breaker: false, wasBreaker: false, eyeHappy: 0, blinkT: 2, holding: false, hue: Save.data.look.ball,
  };
  jelly = new Jelly(24);
  st = {
    score: 0, disp: 0, mult: 1, streak: 0, perfects: 0, kills: 0, coins: 0, maxSpeed: 0, dist: 0,
    feverT: 0, maxMult: 1, coinChain: 0, coinChainT: 0, milestone: 0, distMark: 1000, breakKm: 100, airPts: 0, danger: false,
  };
  cam = { x: p.x + 300, y: p.y, zoom: baseZoom(), lead: 300, rot: 0 };
  lastCamX = cam.x; bgRefY = cam.y;
  parts = []; waves = []; pops = []; banners = []; trail = []; dust = [];
  coinRain = []; flyCoins = []; goldVis = 0; frameFlags.gold = false;
  Object.assign(mods, { thrust: 1, drag: 1, limitKm: 0, orbs: 0 });
  shake = 0; flashA = 0; slowT = 0; hitstop = 0; zoomKick = 0; boostVis = 0; perfectFlash = 0;
  pred = null; deathT = 0; goShown = false;
  const def = skillDef(Save.data.equipped);
  skill = def ? { def, stats: def.stats(Save.level(def.id)), cd: 0, active: 0 } : null;
  mode = demo ? 'demo' : 'play';
  holdPointers.clear(); keyHold = false;
  updateSkillButton();
}

// =====================================================================
//  Skill API (skills.js 에서 사용)
// =====================================================================
function forwardDir() {
  if (p.grounded) return { x: p.tx, y: p.ty };
  const a = clamp(Math.atan2(p.vy, Math.max(p.vx, 1)), -0.6, 0.6);
  return { x: Math.cos(a), y: Math.sin(a) };
}
const skillApi = {
  get player() { return p; },
  addSpeed(v) { const f = forwardDir(); p.vx += f.x * v; p.vy += f.y * v; },
  addThrust(a) { frameFlags.thrust += a; },
  setInvincible() { frameFlags.invincible = true; },
  setNoDrag() { frameFlags.noDrag = true; },
  setGold() { frameFlags.gold = true; },
  get mods() { return mods; },
  // 하늘길 (SKYWAY)
  skyway: {
    open(s) { skyOpen(s); },
    close() { skyClose(); },
    get riding() { return !!world.sky && world.sky.phase === 'ride'; },
  },
  // 앞쪽 하늘에서 진짜 코인을 떨어뜨린다 (공이 곧 지나갈 자리 근처)
  dropCoin() {
    const x = p.x + Math.max(300, p.vx) * rand(0.35, 1.0) + rand(-120, 220);
    const gy = world.terrain.heightAt(x);
    world.coins.push({
      x, y: Math.min(gy, p.y) - rand(450, 750), big: false, taken: false, t: 0, ph: Math.random() * TAU,
      fall: true, vy: rand(100, 300), ty: gy - R - rand(15, 110),
    });
  },
  // 스킬로 코인 지급 (한 번에 1개씩 — 화폐 가치 보호)
  giveCoins(n) {
    st.coins += n;
    if (mode === 'play') Save.addCoins(n);
    addScore(1500 * n * st.mult);
    const s = worldToScreen(p.x, p.y);
    flyCoins.push({ x0: s.x, y0: s.y - 20, t: 0, dur: rand(0.45, 0.65), side: rand(-1, 1) });
    st.coinChain++; st.coinChainT = 0.8;
    sfx('coin', st.coinChain);
  },
  fx: {
    overdrive(n, e) {
      odPunch = 1;
      wave(p.x, p.y, '#ff3b5c', 1300 + n * 120, 12 + n);
      wave(p.x, p.y, '#b02bff', 900, 8);
      if (mode === 'play') banner(`OVERDRIVE x${n}`, `속도 +${e.speedPct}% · 격파 기준 ${limitKm()} km/h`, '#ff3b5c');
      flash('#ff1a4a', 0.3 + Math.min(0.3, n * 0.03));
      shake += 10 + n * 2; zoomKick = -0.08;
      hitstop = 0.05;
      sfx('overdrive', n);
      burst(p.x, p.y, 30 + n * 6, { min: 300, max: 900 + n * 80, cols: ['#ff3b5c', '#b02bff', '#ffb02b', '#fff'], type: 'spark', life: 0.7 });
      if (mode === 'play' && limitKm() > 400) pop('⚠ 이제 멈추면 끝장!', '#ff3b5c', 30, true);
      if (mode === 'play' && n === 7) { banner('BLUE FLAME!!', '푸른 불꽃 각성', '#3dc8ff'); wave(p.x, p.y, '#3dc8ff', 1800, 18); flash('#3dc8ff', 0.4); }
      if (mode === 'play' && n === 10) { banner('BLACK FLAME!!', '칠흑의 불꽃', '#b02bff'); wave(p.x, p.y, '#6a0fa0', 2000, 22); flash('#000000', 0.55); shake += 10; }
    },
    overdriveTick(n, dt) {
      if (!p.alive) return;
      const fl = flameStyle(n);
      const rate = 6 + fl.power * 18 + fl.tier * 10;
      let cnt = Math.floor(dt * rate + Math.random());
      while (cnt-- > 0) {
        const a = rand(0, TAU);
        spawn({
          x: p.x + Math.cos(a) * R * 0.8, y: p.y + Math.sin(a) * R * 0.8,
          vx: -p.vx * 0.3 + rand(-50, 50), vy: -rand(100, 260) * fl.scale,
          life: rand(0.25, 0.5) + fl.tier * 0.1, size: rand(5, 9) * fl.scale,
          col: pick(fl.cols), type: fl.add ? 'flame' : 'bflame', drag: 3,
        });
      }
    },
    goldStart() {
      wave(p.x, p.y, '#ffd84a', 1500, 16);
      wave(p.x, p.y, '#ffffff', 900, 8);
      if (mode === 'play') banner('GOLD RUSH!!', '황금 질주 · 7초', '#ffc21a');
      flash('#ffd84a', 0.4);
      shake += 10; zoomKick = -0.06;
      sfx('goldStart');
      for (let i = 0; i < 40; i++) coinRain.push(newRainCoin(true));
      burst(p.x, p.y, 40, { min: 200, max: 900, cols: ['#ffd84a', '#fff6b0', '#ffb300'], type: 'star', size: 9, life: 0.9 });
    },
    goldTick(dt) {
      if (coinRain.length < 160 && Math.random() < dt * 30) coinRain.push(newRainCoin(false));
      if (Math.random() < dt * 25) spawn({ x: p.x + rand(-R, R), y: p.y + rand(-R, R), vx: -p.vx * 0.2 + rand(-60, 60), vy: rand(-120, 40), life: rand(0.4, 0.8), size: rand(4, 8), col: pick(['#ffd84a', '#fff6b0']), type: 'star', drag: 2 });
    },
    skywayStart(s) {
      wave(p.x, p.y, '#7ff0ff', 1500, 14);
      wave(p.x, p.y, '#c9a8ff', 950, 8);
      if (mode === 'play') banner('SKYWAY!!', `하늘길 개방 · ${+s.duration.toFixed(2)}초`, '#7ff0ff');
      flash('#9ff6ff', 0.35);
      shake += 10; zoomKick = -0.08;
      sfx('skyStart');
      jelly.impulse(0, -1, 7);
      burst(p.x, p.y + R, 36, { angle: Math.PI / 2, spread: 0.9, min: 250, max: 900, cols: ['#7ff0ff', '#ffffff', '#c9a8ff'], type: 'spark', life: 0.6 });
    },
    skywayLand() {
      const y = p.y + R;
      wave(p.x, y, '#bff8ff', 1300, 12);
      wave(p.x, y, '#ffffff', 800, 6);
      if (mode === 'play') pop('SKY RIDE!', '#bff8ff', 40);
      shake += 9; flash('#bff8ff', 0.18);
      sfx('skyLand');
      burst(p.x, y, 30, { angle: -Math.PI / 2, spread: 1.5, min: 200, max: 700, cols: ['#bff8ff', '#ffffff', '#7ff0ff'], type: 'star', size: 8, life: 0.7 });
    },
    skywayTick() {
      if (!world.sky || world.sky.phase !== 'ride' || !p.alive) return;
      if (Math.random() < 0.6) spawn({
        x: p.x - rand(0, R), y: p.y + R - 2, vx: -p.vx * rand(0.1, 0.3), vy: rand(-140, -20),
        life: rand(0.3, 0.6), size: rand(3, 7), col: pick(['#bff8ff', '#7ff0ff', '#ffffff', '#c9a8ff']), type: 'star', drag: 2,
      });
    },
    // 하늘길 종료 시 콤보 정산
    skyCombo(n) {
      sfx('skyEnd');
      if (n < 2) return;
      const pts = 12000 * n * (1 + n * 0.1) * st.mult;
      addScore(pts);
      if (mode === 'play') banner(`SKY COMBO ${n}!`, '+' + fmtKR(pts), '#7ff0ff');
      wave(p.x, p.y, '#7ff0ff', 1600, 14);
      flash('#7ff0ff', 0.25); shake += 8;
      sfx('skyCombo', n);
    },
    nitroStart() {
      boostVis = 1;
      wave(p.x, p.y, '#ff2bd6', 1400, 14);
      wave(p.x, p.y, '#2bf0ff', 900, 8);
      if (mode === 'play') banner('NITRO!!', '급가속', '#ff2bd6');
      flash('#ff2bd6', 0.35);
      shake += 16; zoomKick = -0.14;
      sfx('boost');
      const f = forwardDir();
      burst(p.x, p.y, 40, { angle: Math.atan2(-f.y, -f.x), spread: 0.9, min: 300, max: 1100, cols: ['#ff2bd6', '#ffcf2b', '#2bf0ff', '#fff'], type: 'spark', life: 0.6 });
    },
    nitroTick() {
      boostVis = Math.max(boostVis, 0.75);
      const f = forwardDir();
      for (let i = 0; i < 4; i++) {
        spawn({
          x: p.x - f.x * R * 0.8 + rand(-8, 8), y: p.y - f.y * R * 0.8 + rand(-8, 8),
          vx: p.vx * 0.3 - f.x * rand(300, 800) + rand(-80, 80), vy: p.vy * 0.3 - f.y * rand(300, 800) + rand(-80, 80),
          life: rand(0.2, 0.45), size: rand(10, 22), col: pick(['#ff2bd6', '#ff7a2b', '#ffcf2b', '#fff']), type: 'flame', drag: 3,
        });
      }
    },
  },
};

// =====================================================================
//  Skyway: SKYWAY 스킬의 완전 수평 공중 트랙
//  phase: rise(튕겨 오르는 중) → ride(트랙에 붙어 달림) → fall(끝에서 낙하)
// =====================================================================
const SKY_CLEAR = 350;      // 구간 내 가장 높은 지형보다 이만큼 위
const SKY_MIN_GAP = 160;    // 연장할 때 지형이 이보다 가까워지면 더 늘리지 않음
const SKY_MAX_RISE = 1500;  // 한 번에 올라가는 최대 높이
const SKY_RISE_T = 0.6;     // 튕겨 올라 착지까지 걸리는 시간

function skyOpen(o) {
  const T = world.terrain, x0 = p.x;
  const want = x0 + (Math.max(speed(), 1500) + 1000) * o.duration + 1500;
  gen.ensure(want + 400);
  let top = Math.min(T.heightAt(x0), p.y + R), x2 = x0 + 600;
  for (let x = x0; x <= want; x += STEP) {
    const t = Math.min(top, T.heightAt(x));
    if (x > x0 + 3000 && p.y - (t - SKY_CLEAR) > SKY_MAX_RISE) break;
    top = t; x2 = x;
  }
  const y = Math.min(top - SKY_CLEAR, p.y - 250);
  // 이전 하늘길 잔해 정리
  world.enemies = world.enemies.filter(e => !e.sky);
  const landX = x0 + Math.max(p.vx, 600) * SKY_RISE_T;
  world.sky = {
    x1: x0 + 80, x2, y, phase: 'rise', t: 0, y0: p.y, born: time, closing: false, blocked: false,
    crumble: x0 + 80, alpha: 0, pads: [], gap: o.gap, padEvery: o.padEvery, padBoost: o.padBoost, filled: landX + 450, nextPad: landX + 250, fade: 0,
  };
  skyFill(world.sky);
}
// 하늘길 위에 적과 부스터 발판을 깐다 (filled ~ x2-300)
function skyFill(sk) {
  const end = sk.x2 - 300;
  while (sk.filled < end) {
    const x = sk.filled;
    if (x >= sk.nextPad) {
      sk.pads.push({ x1: x, x2: x + 170, used: false });
      sk.nextPad = x + sk.padEvery * rand(0.85, 1.15);
      sk.filled = x + 170 + sk.gap * 0.6;
      continue;
    }
    const size = rand(46, 56), r = Math.random();
    const kind = r < 0.7 ? 'ground' : r < 0.9 ? 'spin' : 'float';
    let ey = sk.y - size * 0.42;
    if (kind === 'float') ey -= rand(30, 60);
    world.enemies.push({
      x, y: ey, baseY: ey, size, kind, alive: true, ph: rand(0, TAU), dead: 0, rot: 0, sky: true,
      bob: kind === 'float' ? rand(12, 22) : 0,
      spin: kind === 'spin' ? rand(2.5, 4.5) * (Math.random() < 0.5 ? -1 : 1) : 0,
    });
    sk.filled = x + sk.gap * rand(0.85, 1.15);
  }
}
// 스킬 종료: 지금 위치 조금 앞에서 트랙을 끊는다 → 끝에서 낙하
function skyClose() {
  const sk = world.sky;
  if (!sk || sk.closing) return;
  sk.closing = true;
  const cut = p.x + Math.max(250, p.vx * 0.2);
  // 남은 적은 모두 사라진다 (콤보는 이미 정산됨)
  for (const e of world.enemies) if (e.sky && e.alive && e.x > p.x) { e.alive = false; e.dead = 0; }
  if (cut < sk.x2) {
    sk.x2 = cut;
    sk.pads = sk.pads.filter(pd => pd.x1 < cut - 40);
    for (const pd of sk.pads) pd.x2 = Math.min(pd.x2, cut);
  }
  if (mode === 'play' && sk.phase === 'ride') pop('하늘길 끝! 착지 준비', '#bff8ff', 28, true);
}
function updateSkyway(dt) {
  const sk = world.sky;
  if (!sk) return;
  sk.alpha = Math.min(1, sk.alpha + dt * 4);
  // 계속 달리는 중이면 앞으로 연장 (지형과 겹치면 중단)
  if (!sk.closing && !sk.blocked && sk.phase !== 'fall' && p.x > sk.x2 - 5000) {
    const T = world.terrain, to = sk.x2 + 4000;
    gen.ensure(to + 400);
    let x = sk.x2;
    while (x < to) { if (T.heightAt(x + STEP) < sk.y + SKY_MIN_GAP) { sk.blocked = true; break; } x += STEP; }
    sk.x2 = x;
    skyFill(sk);
  }
  // 지나간 자리는 부서진다
  const cr = p.x - 650;
  if (cr > sk.crumble) {
    for (let x = sk.crumble; x < cr; x += 70) {
      if (x < sk.x1 || x > sk.x2) continue;
      spawn({ x: x + rand(0, 60), y: sk.y + rand(0, 16), vx: rand(-60, 60), vy: rand(0, 160), life: rand(0.6, 1.1), size: rand(8, 16), col: pick(['#bff8ff', '#7ff0ff', '#ffffff', '#c9a8ff']), type: 'shard', g: 1500, drag: 0.4 });
    }
    sk.crumble = cr;
  }
  if (sk.phase === 'ride') {
    for (const pd of sk.pads) {
      if (pd.used || p.x < pd.x1 - R || p.x > pd.x2 + R) continue;
      pd.used = true;
      applyPad({ type: 'speed' }, sk.padBoost);
    }
  }
  if (sk.phase === 'fall' || sk.crumble > sk.x2) {
    sk.fade += dt;
    if (sk.fade > 2.5 || sk.crumble > sk.x2 + 200) { world.sky = null; world.enemies = world.enemies.filter(e => !e.sky || !e.alive); }
  }
}
// substep 에서 호출. true 를 돌려주면 지형 충돌을 건너뛴다
function skySubstep(h) {
  const sk = world.sky;
  if (!sk) return false;
  if (sk.phase === 'rise') {
    sk.t += h;
    const u = Math.min(1, sk.t / SKY_RISE_T), yL = sk.y - R, H0 = Math.max(1, sk.y0 - yL);
    const o = Math.max(0.12, 80 / H0), k = 0.7;
    const f = u < k ? (1 + o) * (1 - (1 - u / k) ** 2) : 1 + o - o * ((u - k) / (1 - k)) ** 2;
    const ny = sk.y0 + (yL - sk.y0) * f;
    p.vx = Math.max(p.vx, 600);
    p.x += p.vx * h;
    p.vy = (ny - p.y) / h; p.y = ny;
    p.grounded = false; p.airTime = 0; p.spin = 14;
    if (u >= 1) {
      const impact = Math.max(0, p.vy);
      sk.phase = 'ride';
      p.y = yL; p.vy = 0;
      p.grounded = true; p.nx = 0; p.ny = -1; p.tx = 1; p.ty = 0;
      resetAir();
      jelly.impulse(0, -1, Math.min(7, impact / 220 + 3));
      skillApi.fx.skywayLand();
    }
    return true;
  }
  if (sk.phase === 'ride') {
    if (p.x > sk.x2 + R * 0.3) {
      sk.phase = 'fall';
      p.grounded = false; p.airTime = 0.01; p.noSnapT = 0.25;
      return false;
    }
    if (sk.closing) p.vx = Math.max(p.vx, 350); // 멈춰서 갇히지 않게
    p.y = sk.y - R; p.vy = 0;
    p.grounded = true; p.nx = 0; p.ny = -1; p.tx = 1; p.ty = 0; p.airTime = 0;
    return true;
  }
  return false;
}

function useSkill() {
  if (!skill || !p || !p.alive) return;
  if (mode !== 'play' && mode !== 'demo') return;
  if (skill.cd > 0) { sfx('deny'); return; }
  skill.active = skill.stats.duration;
  skill.cd = cheatNoCd ? 0 : skill.stats.cooldown + skill.stats.duration;
  skill.def.activate(skillApi, skill.stats);
}
function updateSkill(dt) {
  if (!skill) return;
  skill.cd = Math.max(0, skill.cd - dt);
  if (skill.active > 0) {
    skill.def.update(skillApi, skill.stats, dt);
  }
  if (skill.def.passive) skill.def.passive(skillApi, skill.stats, dt);
  if (skill.active > 0) {
    skill.active -= dt;
    if (skill.active <= 0 && skill.def.end) skill.def.end(skillApi, skill.stats);
  }
}

// =====================================================================
//  Simulation
// =====================================================================
function aiHold() {
  if (p.grounded || p.airTime < 0.1) return true;
  if (!pred) return true;
  return pred.t > 0.1;
}

function step(dt) {
  frameFlags.invincible = false; frameFlags.noDrag = false; frameFlags.thrust = 0; frameFlags.gold = false;
  const demo = mode === 'demo';
  const holding = demo ? aiHold() : input.down;
  p.holding = holding;
  if (demo && skill && skill.cd <= 0 && p.grounded && Math.random() < 0.004) useSkill();
  updateSkill(dt);
  if (st.feverT > 0) { st.feverT -= dt; if (st.feverT <= 0) { st.feverT = 0; if (!demo) pop('FEVER END', '#ffffff', 26, true); } }
  if (p.lowGravT > 0) p.lowGravT -= dt;
  if (p.noSnapT > 0) p.noSnapT -= dt;
  if (p.eyeHappy > 0) p.eyeHappy -= dt;
  if (boomCd > 0) boomCd -= dt;
  st.coinChainT -= dt; if (st.coinChainT <= 0) st.coinChain = 0;

  const x0 = p.x, y0 = p.y;
  const n = clamp(Math.ceil(speed() * dt / (R * 0.35)), 2, 16);
  const h = dt / n;
  for (let i = 0; i < n; i++) substep(h, holding);

  const sp = speed();
  if (p.grounded) p.spin = (p.vx * p.tx + p.vy * p.ty) / R;
  else if (holding && p.airTime > 0.08) p.spin += 30 * dt;
  p.rot += p.spin * dt;

  // 거리 점수: 속도가 빠를수록 기하급수적으로
  const dx = p.x - x0;
  if (dx > 0) addScore(dx * 1.5 * st.mult * Math.pow(Math.max(sp, 300) / 1000, 1.5));
  st.dist = Math.max(st.dist, (p.x - START_X) / PX_PER_M);
  st.maxSpeed = Math.max(st.maxSpeed, sp);
  st.airPts = p.grounded ? 0 : AIR_PTS * Math.pow(p.airTime, 1.7) * st.mult;

  // 격파 기준 속도 (거리에 따라 상승)
  const km = Math.min(280, 100 + Math.floor(st.dist / 300) * 10);
  if (km > st.breakKm) { st.breakKm = km; if (!demo) pop(`LIMIT ▲ ${km} km/h`, '#ff6a3d', 30, true); }
  p.wasBreaker = p.breaker;
  p.breaker = demo || frameFlags.invincible || st.feverT > 0 || sp >= breakSpeed();
  if (p.breaker && !p.wasBreaker && sp >= breakSpeed() && boomCd <= 0 && !demo) sonicBoom();

  if (!demo) {
    const kmh = sp * KMH;
    if (st.milestone < SPEED_MILESTONES.length && kmh >= SPEED_MILESTONES[st.milestone]) {
      while (st.milestone + 1 < SPEED_MILESTONES.length && kmh >= SPEED_MILESTONES[st.milestone + 1]) st.milestone++;
      banner(`${SPEED_MILESTONES[st.milestone]} km/h!!`, 'SPEED RECORD', '#2bf0ff');
      st.milestone++; sfx('milestone'); wave(p.x, p.y, '#2bf0ff', 1600, 10);
    }
    if (st.dist >= st.distMark) { pop(`${fmtComma(st.distMark)} m`, '#b6ff2b', 34, true); st.distMark += 1000; }
  }

  // 적 움직임
  for (const e of world.enemies) {
    if (!e.alive || Math.abs(e.x - p.x) > 3000) continue;
    if (e.bob) e.y = e.baseY + Math.sin(time * 2.4 + e.ph) * e.bob;
    e.rot += e.spin * dt;
  }
  st.danger = false;
  if (!p.breaker) for (const e of world.enemies) if (e.alive && e.x > p.x && e.x < p.x + 1800) { st.danger = true; break; }

  collideObjects(x0, y0, dt);
  if (!p.alive) return;
  checkPads();
  updateSkyway(dt);

  pred = (!p.grounded && p.airTime > 0.05 && !(world.sky && world.sky.phase === 'rise')) ? predictLanding() : null;

  gen.ensure(p.x + 9000);
  cleanT -= dt; if (cleanT <= 0) { cleanT = 0.5; cleanup(); }

  trail.push(p.x, p.y);
  if (trail.length > 60) trail.splice(0, 2);

  // 바닥 불꽃
  if (p.grounded && sp > 1100 && Math.random() < (sp - 1100) / 1400) {
    const cx = p.x - p.nx * R, cy = p.y - p.ny * R;
    for (let i = 0; i < 2; i++) spawn({
      x: cx, y: cy, vx: -p.vx * rand(0.1, 0.45) + rand(-60, 60), vy: -p.vy * 0.2 - rand(100, 380),
      life: rand(0.2, 0.45), size: rand(2, 4), col: pick(['#ffcf2b', '#ff7a2b', '#fff']), type: 'spark', g: 1600, drag: 1,
    });
  }
  if (p.lowGravT > 0 && Math.random() < 0.5) spawn({ x: p.x + rand(-40, 40), y: p.y + rand(-40, 40), vx: rand(-30, 30), vy: -rand(40, 120), life: 0.8, size: rand(3, 7), col: '#b6ff2b', type: 'dot', drag: 0.5 });
  if (mode === 'play') Sfx.wind(clamp(sp / 3200, 0, 1.3));
}

function substep(h, holding) {
  const T = world.terrain;
  if (world.sky && world.sky.phase === 'rise') { skySubstep(h); return; }
  let g = G * (p.lowGravT > 0 ? 0.42 : 1);
  // 공중에서 꾹 = 빨리 내려꽂기 + 차지
  if (!p.grounded && p.airTime > 0.08) {
    if (holding) { g *= 1.3; p.airHeld = true; p.charge = Math.min(1.5, p.charge + h); p.releaseT = -1; }
    else if (p.airHeld) { if (p.releaseT < 0) p.releaseT = 0; p.releaseT += h; }
  }
  let ax = 0, ay = g;
  const sp = Math.hypot(p.vx, p.vy);
  if (p.grounded) {
    const gT = g * p.ty;
    if (holding) {
      let th = THRUST * mods.thrust * (st.feverT > 0 ? 1.35 : 1);
      th += Math.max(0, -gT) * 0.85; // 오르막 보조
      ax += p.tx * th; ay += p.ty * th;
    } else if (sp > 5) { ax -= p.vx / sp * ROLL; ay -= p.vy / sp * ROLL; }
    ax -= p.nx * 600; ay -= p.ny * 600; // 접지력
  }
  if (frameFlags.thrust) { const f = forwardDir(); ax += f.x * frameFlags.thrust; ay += f.y * frameFlags.thrust; }
  if (!frameFlags.noDrag) { const k = DRAG * mods.drag * (p.grounded ? 1 : 0.45); ax -= p.vx * sp * k; ay -= p.vy * sp * k; }
  p.vx += ax * h; p.vy += ay * h;
  const s2 = Math.hypot(p.vx, p.vy);
  if (s2 > MAX_SPEED) { p.vx *= MAX_SPEED / s2; p.vy *= MAX_SPEED / s2; }
  p.x += p.vx * h; p.y += p.vy * h;
  if (skySubstep(h)) return; // 하늘길 위에서는 트랙에 붙어 달린다

  // 지형 충돌
  const hgt = T.heightAt(p.x);
  let hit = false, nx = 0, ny = -1;
  if (p.y > hgt) {
    const s = T.slopeAt(p.x), L = Math.hypot(1, s);
    nx = s / L; ny = -1 / L;
    const push = (p.y - hgt) / L + R;
    p.x += nx * push; p.y += ny * push; hit = true;
  } else {
    const c = T.closest(p.x, p.y, R + 4);
    const snap = p.grounded && p.noSnapT <= 0 ? 3.5 : 0;
    if (c.d < R + snap) {
      nx = c.nx; ny = c.ny;
      const push = R - c.d;
      p.x += nx * push; p.y += ny * push; hit = true;
    }
  }
  if (hit) {
    const vn = p.vx * nx + p.vy * ny;
    const wasAir = !p.grounded, airT = p.airTime;
    if (vn < 0) {
      const before = Math.hypot(p.vx, p.vy);
      p.vx -= vn * nx; p.vy -= vn * ny;
      if (wasAir && airT > 0.1) onLanding(-vn, nx, ny, airT, holding);
      else {
        // 지형 꺾임에서 속도 보존 (스피드감 유지)
        const after = Math.hypot(p.vx, p.vy);
        if (after > 1) { const k = (after + (before - after) * 0.96) / after; p.vx *= k; p.vy *= k; }
      }
    }
    if (ny < -0.35) { p.grounded = true; p.nx = nx; p.ny = ny; p.tx = -ny; p.ty = nx; p.airTime = 0; }
    else { p.grounded = false; p.airTime += h; }
  } else { p.grounded = false; p.airTime += h; }
}

function resetAir() { p.airHeld = false; p.charge = 0; p.releaseT = -1; }

function onLanding(impact, nx, ny, airT, holding) {
  jelly.impulse(nx, ny, Math.min(7, impact / 220));
  if (airT < MIN_AIR) { resetAir(); return; }
  const demo = mode === 'demo';
  const tx = -ny, ty = nx;
  if (p.vx * tx + p.vy * ty > 0) { const add = impact * 0.22; p.vx += tx * add; p.vy += ty * add; }
  let q = 'normal';
  if (p.airHeld) {
    if (holding) q = 'late';
    else if (p.releaseT >= 0 && p.releaseT <= PERFECT_WIN) q = 'perfect';
    else if (p.releaseT >= 0 && p.releaseT <= GREAT_WIN) q = 'great';
    else q = 'early';
  }
  const base = AIR_PTS * Math.pow(airT, 1.7) * st.mult;
  const cx = p.x - nx * R, cy = p.y - ny * R;
  burst(cx, cy, 16, { angle: Math.atan2(ny, nx), spread: 1.4, min: 150, max: 500, cols: ['#fff', '#ffe9ff'], type: 'dot', size: 6, g: 900 });

  if (q === 'perfect') {
    st.streak++; st.perfects++;
    const boost = 380 + p.charge * 420 + Math.min(st.streak, 8) * 45;
    p.vx += tx * boost; p.vy += ty * boost;
    const pts = base * 3 * (1 + p.charge * 0.6);
    st.mult += 1 + 0.5 * Math.min(st.streak, 10);
    addScore(pts);
    if (!demo) { banner('PERFECT!!', (st.streak > 1 ? `${st.streak} STREAK · ` : '') + '+' + fmtKR(pts), null); multPunch = 1; }
    fxPerfect(cx, cy);
    sfx('perfect', st.streak);
    p.eyeHappy = 0.8;
    if (st.streak >= 3) startFever();
  } else if (q === 'great') {
    st.streak = 0;
    p.vx += tx * 190; p.vy += ty * 190;
    const pts = base * 1.6;
    st.mult += 0.5; addScore(pts);
    if (!demo) pop('GREAT! +' + fmtKR(pts), '#2bffb4', 40);
    wave(cx, cy, '#2bffb4', 900, 10);
    burst(cx, cy, 24, { min: 200, max: 700, cols: ['#2bffb4', '#fff', '#2bf0ff'], type: 'spark' });
    shake += 6; sfx('great'); multPunch = 0.6;
  } else {
    st.streak = 0;
    addScore(base); st.mult += 0.1;
    if (!demo) pop((q === 'late' ? 'LATE.. ' : q === 'early' ? 'EARLY.. ' : 'AIR ') + '+' + fmtKR(base), q === 'normal' ? '#ffffff' : '#bbb', 28);
    shake += Math.min(10, impact / 350);
    sfx('land', 0.25);
  }
  st.maxMult = Math.max(st.maxMult, st.mult);
  resetAir();
}

function startFever() {
  if (st.feverT <= 0) {
    if (mode === 'play') banner('FEVER!!', '점수 x2 · 무적 돌파 · 코인 자석', null);
    sfx('fever');
    st.feverT = 7;
  } else st.feverT = Math.min(14, st.feverT + 2.5);
}

function addScore(n) {
  if (mode !== 'play') return;
  const v = n * (st.feverT > 0 ? 2 : 1);
  st.score += v;
  if (v > 2e4 && v > st.score * 0.04) scorePunch = Math.min(1, scorePunch + 0.35);
}

function sonicBoom() {
  boomCd = 1.5;
  wave(p.x, p.y, '#ffffff', 1500, 8);
  wave(p.x, p.y, '#ffb02b', 1000, 12);
  pop('BREAK MODE!', '#ffb02b', 30);
  shake += 7; zoomKick = Math.min(zoomKick, -0.05);
  sfx('boom');
}

function predictLanding() {
  const T = world.terrain;
  let x = p.x, y = p.y, vx = p.vx, vy = p.vy;
  const g = G * (p.lowGravT > 0 ? 0.42 : 1), h = 1 / 60;
  for (let t = 0; t < 4; t += h) {
    const sp = Math.hypot(vx, vy);
    vx -= vx * sp * DRAG * mods.drag * 0.45 * h;
    vy += (g - vy * sp * DRAG * mods.drag * 0.45) * h;
    x += vx * h; y += vy * h;
    if (y + R * 0.95 >= T.heightAt(x)) return { t, x, y };
  }
  return null;
}

function collideObjects(ax, ay, dt) {
  const bx = p.x, by = p.y;
  const minX = Math.min(ax, bx) - 200, maxX = Math.max(ax, bx) + 200;
  const fever = st.feverT > 0;
  // 자석: 반경 안에 들어온 코인은 공을 쫓아온다 (공보다 빠르게)
  const magR = fever ? MAGNET_FEVER : GOLD() ? MAGNET_GOLD : MAGNET_R;
  const chase = (speed() + 1600) * dt;
  for (const c of world.coins) {
    if (c.taken) { c.t += dt; continue; }
    if (c.fall) {
      c.vy += 900 * dt; c.y += c.vy * dt;
      if (c.y >= c.ty) { c.y = c.ty; c.fall = false; }
    }
    if (c.x < minX - 400 || c.x > maxX + 400) continue;
    const dx = p.x - c.x, dy = p.y - c.y, d = Math.hypot(dx, dy);
    if (!c.mag && d < magR) c.mag = true;
    if (c.mag) {
      c.fall = false;
      if (d <= chase + R) { takeCoin(c); continue; }
      c.x += dx / d * chase; c.y += dy / d * chase;
    }
    if (segDist(c.x, c.y, ax, ay, bx, by) < R + (c.big ? 28 : 22)) takeCoin(c);
  }
  for (const e of world.enemies) {
    if (!e.alive) { e.dead += dt; continue; }
    if (e.x < minX || e.x > maxX) continue;
    if (segDist(e.x, e.y, ax, ay, bx, by) < R + e.size * 0.36) {
      if (p.breaker) smash(e); else { die(e); return; }
    }
  }
  for (const r of world.rings) {
    if (r.taken) { r.t += dt; continue; }
    if (ax < r.x && bx >= r.x) {
      const t = (r.x - ax) / (bx - ax), y = ay + (by - ay) * t;
      if (Math.abs(y - r.y) < r.h * 0.85) takeRing(r);
    }
  }
}

function takeCoin(c) {
  c.taken = true; c.t = 0;
  const v = c.big ? 10 : 1;
  st.coins += v;
  if (mode === 'play') Save.addCoins(v);
  st.coinChain++; st.coinChainT = 0.8;
  addScore(1500 * v * st.mult);
  st.mult += 0.02 * v;
  burst(c.x, c.y, c.big ? 18 : 6, { min: 80, max: c.big ? 500 : 260, cols: c.big ? ['#2bf0ff', '#fff', '#b98bff'] : ['#ffd84a', '#fff6b0'], type: 'star', size: c.big ? 9 : 6, life: 0.5 });
  if (c.big) { sfx('gem'); if (mode === 'play') pop('+10 GEM', '#2bf0ff', 30); } else sfx('coin', st.coinChain);
}

function takeRing(r) {
  r.taken = true; r.t = 0;
  const s = speed() || 1;
  p.vx += p.vx / s * 280; p.vy += p.vy / s * 280;
  const pts = 20000 * st.mult;
  addScore(pts); st.mult += 0.3;
  if (mode === 'play') pop('RING! +' + fmtKR(pts), '#ffcf2b', 32);
  wave(r.x, r.y, '#ffcf2b', 900, 10);
  burst(r.x, r.y, 20, { min: 200, max: 700, type: 'star', size: 7 });
  sfx('ring');
}

function smash(e) {
  e.alive = false; e.dead = 0;
  st.kills++;
  // 스킬의 격파 훅 (예: SKYWAY 연속 격파 콤보) → 점수 배율
  const bonus = skill && skill.def.onSmash ? skill.def.onSmash(skillApi, skill.stats, e) || 1 : 1;
  const pts = 30000 * st.mult * bonus;
  addScore(pts); st.mult += e.sky ? 0.08 : 0.25; // 하늘길 적은 수가 많아 배율 상승을 낮춤
  if (mode === 'play') pop((bonus > 1 ? `SMASH x${+bonus.toFixed(1)}! +` : 'SMASH! +') + fmtKR(pts), bonus > 1 ? '#7ff0ff' : '#ff4060', 36);
  for (let i = 0; i < 16; i++) {
    const a = rand(0, TAU), s = rand(300, 1100);
    spawn({ x: e.x, y: e.y, vx: Math.cos(a) * s + p.vx * 0.5, vy: Math.sin(a) * s + p.vy * 0.3 - 200, life: rand(0.5, 1.1), size: rand(8, 18), col: pick(['#ff2440', '#ff6a7a', '#a0001c', '#fff']), type: 'shard', g: 1800, drag: 0.6 });
  }
  burst(e.x, e.y, 26, { min: 200, max: 900, cols: ['#ffcf2b', '#ff7a2b', '#fff'], type: 'spark' });
  wave(e.x, e.y, '#ff4060', 1200, 14);
  // 하늘길 위 적은 촘촘하게 연달아 부수므로 히트스톱/흔들림을 가볍게
  if (e.sky) { hitstop = Math.max(hitstop, 0.02); shake += 5; flash('#ff3355', 0.1); }
  else { hitstop = 0.055; shake += 13; flash('#ff3355', 0.22); }
  jelly.poke(5);
  sfx('smash');
}

function die() {
  if (!p.alive) return;
  p.alive = false;
  mode = 'dead'; deathT = 0; goShown = false;
  holdPointers.clear(); keyHold = false;
  for (let i = 0; i < 46; i++) {
    const a = rand(0, TAU), s = rand(150, 900);
    spawn({ x: p.x, y: p.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 250, life: rand(0.7, 1.6), size: rand(6, 16), col: pick([`hsl(${p.hue},95%,62%)`, `hsl(${p.hue},100%,78%)`, `hsl(${p.hue},100%,90%)`, '#fff']), type: 'shard', g: 1600, drag: 1 }); // 공 파편 (구체 색)
  }
  burst(p.x, p.y, 30, { min: 200, max: 1100, cols: ['#fff', '#ff2440', '#ffcf2b'], type: 'spark' });
  wave(p.x, p.y, '#ff2440', 1600, 18);
  wave(p.x, p.y, '#ffffff', 900, 8);
  shake = 30; flash('#ff1a3a', 0.6);
  banner('CRASH!', `${Math.round(speed() * KMH)} km/h < ${limitKm()} km/h`, '#ff2b55');
  Sfx.death(); Sfx.silenceWind();
  commitRun();
}

function commitRun() {
  st.newBest = st.score > Save.data.best;
  if (st.newBest) Save.data.best = Math.floor(st.score);
  Save.save();
}

function checkPads() {
  for (const pd of world.pads) {
    if (pd.used || p.x < pd.x1 - R || p.x > pd.x2 + R) continue;
    if (world.terrain.heightAt(p.x) - (p.y + R) > 16) continue;
    pd.used = true;
    applyPad(pd);
  }
}
function applyPad(pd, power = 800) {
  const f = forwardDir(), play = mode === 'play';
  if (pd.type === 'speed') {
    p.vx += f.x * power; p.vy += f.y * power;
    if (play) pop('BOOST!', '#2bf0ff', 42);
    boostVis = Math.max(boostVis, 0.8); shake += 6; zoomKick = Math.min(zoomKick, -0.07);
    wave(p.x, p.y, '#2bf0ff', 1300, 10);
    burst(p.x, p.y + R, 26, { angle: Math.PI, spread: 0.6, min: 300, max: 1000, cols: ['#2bf0ff', '#fff', '#2b6bff'], type: 'spark' });
  } else if (pd.type === 'jump') {
    p.vx = Math.max(p.vx, 1150); p.vy = -JUMP_VY;
    p.grounded = false; p.noSnapT = 0.25; p.y -= 6; p.airTime = 0.01;
    if (play) pop('JUMP!', '#ff2bd6', 46);
    jelly.impulse(0, -1, 6);
    wave(p.x, p.y + R, '#ff2bd6', 1100, 12);
    burst(p.x, p.y + R, 30, { angle: -Math.PI / 2, spread: 0.7, min: 300, max: 1000, cols: ['#ff2bd6', '#fff', '#ffcf2b'], type: 'spark' });
    shake += 8;
  } else {
    p.lowGravT = 5.5;
    if (play) pop('LOW GRAVITY', '#b6ff2b', 36);
    wave(p.x, p.y, '#b6ff2b', 900, 12);
    burst(p.x, p.y, 30, { min: 60, max: 260, cols: ['#b6ff2b', '#fff'], type: 'dot', size: 7, life: 1.2, drag: 1 });
  }
  sfx('pad', pd.type);
}

function cleanup() {
  const left = cam.x - viewHalfW() - 1500;
  world.coins = world.coins.filter(c => c.x > left && !(c.taken && c.t > 0.5));
  world.enemies = world.enemies.filter(e => e.x > left && (e.alive || e.dead < 1));
  world.pads = world.pads.filter(pd => pd.x2 > left);
  world.rings = world.rings.filter(r => r.x > left && !(r.taken && r.t > 0.7));
  world.terrain.trim(left - 500);
}

// =====================================================================
//  FX
// =====================================================================
function spawn(o) { if (parts.length > 1400) return; o.max = o.life; o.g = o.g || 0; o.drag = o.drag == null ? 2 : o.drag; o.rot = rand(0, TAU); o.vr = rand(-12, 12); parts.push(o); }
function burst(x, y, n, o) {
  for (let i = 0; i < n; i++) {
    const a = o.angle != null ? o.angle + rand(-o.spread, o.spread) : rand(0, TAU);
    const s = rand(o.min || 100, o.max || 600);
    spawn({
      x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.25, o.life || 0.8), size: rand(2, o.size || 6),
      col: o.cols ? pick(o.cols) : `hsl(${rand(0, 360)},100%,62%)`, type: o.type || 'dot', g: o.g || 0, drag: o.drag,
    });
  }
}
function wave(x, y, col, vr = 1000, w = 10) { waves.push({ x, y, r: R, vr, life: 0.45, max: 0.45, col, w }); }
function flash(col, a) { flashCol = col; flashA = Math.max(flashA, a); }
// 골드 러시: 화면 위에서 쏟아지는 동전 (연출용, 화면 좌표)
function newRainCoin(initial) {
  return { x: rand(0, W), y: initial ? rand(-H * 0.8, -20) : -30, vx: rand(-60, 60), vy: rand(150, 450), rot: rand(0, TAU), vr: rand(4, 10), s: rand(0.6, 1.4) };
}
function hudCoinPos() {
  const fs = clamp(W * 0.05, 28, 58);
  return { x: 28, y: W < 640 ? 14 + fs + fs * 2.6 + 40 : 34 };
}
function drawCoinIcon(x, y, r, sx = 1) {
  ctx.save(); ctx.translate(x, y); ctx.scale(sx, 1);
  ctx.fillStyle = '#b8860b'; ctx.beginPath(); ctx.arc(0, r * 0.15, r, 0, TAU); ctx.fill();
  ctx.fillStyle = '#ffd84a'; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
  ctx.fillStyle = '#fff6b0'; ctx.beginPath(); ctx.arc(0, 0, r * 0.55, 0, TAU); ctx.fill();
  ctx.restore();
}
function drawGoldLayer() {
  if (goldVis > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255,170,30,${0.1 * goldVis})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  ctx.save();
  for (const c of coinRain) {
    ctx.globalAlpha = 0.9;
    drawCoinIcon(c.x, c.y, 11 * c.s, Math.max(0.15, Math.abs(Math.cos(c.rot))));
  }
  ctx.globalAlpha = 1;
  const hp = hudCoinPos();
  for (const c of flyCoins) {
    const k = smooth(c.t / c.dur);
    const x = lerp(c.x0, hp.x, k) + Math.sin(k * Math.PI) * 80 * c.side;
    const y = lerp(c.y0, hp.y, k) - Math.sin(k * Math.PI) * 60;
    drawCoinIcon(x, y, 12 * (1 - k * 0.3));
  }
  ctx.restore();
}
function pop(text, col, size = 32, top = false) {
  let x = W / 2, y = H * 0.27;
  if (!top && p) { const s = worldToScreen(p.x, p.y); x = clamp(s.x, 120, W - 120); y = clamp(s.y - 70, H * 0.3, H * 0.8); }
  pops.push({ text, col, size, x, y, life: 1.1, max: 1.1 });
  if (pops.length > 8) pops.shift();
}
function banner(text, sub, col) {
  banners.unshift({ text, sub, col, life: 1.5, max: 1.5 });
  if (banners.length > 2) banners.pop();
  if (banners[1]) banners[1].life = Math.min(banners[1].life, 0.4);
}
function fxPerfect(cx, cy) {
  wave(cx, cy, '#ffffff', 1800, 16);
  wave(cx, cy, '#ff2bd6', 1300, 12);
  wave(cx, cy, '#2bf0ff', 900, 10);
  burst(cx, cy, 60, { min: 300, max: 1500, type: 'spark', life: 0.7 });
  burst(cx, cy, 20, { min: 100, max: 600, type: 'star', size: 10, life: 0.9 });
  flash('#ffffff', 0.45);
  shake += 12;
  slowT = 0.14; slowScale = 0.3;
  zoomKick = 0.1;
  perfectFlash = 1; boostVis = Math.max(boostVis, 0.9);
}

function updateFX(fxDt, rdt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const q = parts[i];
    q.life -= fxDt;
    if (q.life <= 0) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
    const k = Math.exp(-q.drag * fxDt);
    q.vx *= k; q.vy = q.vy * k + q.g * fxDt;
    q.x += q.vx * fxDt; q.y += q.vy * fxDt; q.rot += q.vr * fxDt;
  }
  for (let i = waves.length - 1; i >= 0; i--) {
    const w = waves[i]; w.life -= fxDt; w.r += w.vr * fxDt; w.vr *= Math.exp(-3 * fxDt);
    if (w.life <= 0) waves.splice(i, 1);
  }
  for (let i = pops.length - 1; i >= 0; i--) { const q = pops[i]; q.life -= rdt; q.y -= 50 * rdt; if (q.life <= 0) pops.splice(i, 1); }
  for (let i = banners.length - 1; i >= 0; i--) { banners[i].life -= rdt; if (banners[i].life <= 0) banners.splice(i, 1); }
  shake = Math.min(40, Math.max(0, shake - rdt * (shake * 7 + 3)));
  flashA = Math.max(0, flashA - rdt * 2.4);
  zoomKick *= Math.exp(-rdt * 5);
  scorePunch = Math.max(0, scorePunch - rdt * 2.5);
  multPunch = Math.max(0, multPunch - rdt * 2.5);
  boostVis = Math.max(0, boostVis - rdt * 1.4);
  perfectFlash = Math.max(0, perfectFlash - rdt * 2.2);
  coinPunch = Math.max(0, coinPunch - rdt * 4);
  odPunch = Math.max(0, odPunch - rdt * 1.5);
  goldVis = clamp(goldVis + ((frameFlags.gold && mode !== 'dead') ? rdt * 4 : -rdt * 2), 0, 1);
  for (let i = coinRain.length - 1; i >= 0; i--) {
    const c = coinRain[i];
    c.vy += 500 * fxDt; c.y += c.vy * fxDt; c.x += c.vx * fxDt; c.rot += c.vr * fxDt;
    if (c.y > H + 40) coinRain.splice(i, 1);
  }
  for (let i = flyCoins.length - 1; i >= 0; i--) {
    const c = flyCoins[i];
    c.t += rdt;
    if (c.t >= c.dur) { flyCoins.splice(i, 1); coinPunch = 1; }
  }

  if (p) {
    const sp = speed();
    const va = Math.atan2(p.vy, p.vx);
    const stretch = Math.min(0.3, sp / 8500) + boostVis * 0.06;
    const charge = (!p.grounded && p.airHeld && p.holding) ? clamp(p.charge / 1.1, 0, 1) : 0;
    jelly.update(fxDt, va, stretch, p.grounded && p.holding ? 1 : 0, p.nx, p.ny, charge);
    if (sp > 1500) jelly.poke((sp - 1500) / 3000 * 0.8);
    if (charge > 0.5) jelly.poke(charge * 0.6);
    p.blinkT -= rdt; if (p.blinkT < -0.12) p.blinkT = rand(1.5, 4);
    updateDust(fxDt, sp);
    // 스크린 스피드라인
    const sn = clamp((sp - 500) / 2500, 0, 1.4) + boostVis * 0.6;
    for (const l of LINES) {
      l.x -= fxDt * (0.4 + sn * 4.2) * l.sp;
      if (l.x < -1.6) { l.x = 1.5 + rand(0, 0.4); l.y = rand(-1, 1); l.len = rand(0.08, 0.35); l.hue = rand(0, 360); }
    }
    const ta = Math.atan2(p.vy, Math.max(p.vx, 50));
    lineAng += (ta - lineAng) * Math.min(1, rdt * 6);
  }
}

function updateDust(dt, sp) {
  const vb = viewBounds();
  while (dust.length < 130) dust.push(newDust(vb, true));
  const ux = sp > 1 ? p.vx / sp : 1, uy = sp > 1 ? p.vy / sp : 0;
  const RR = R * 4.5;
  for (const d of dust) {
    const k = Math.exp(-dt * 2.2);
    d.vx *= k; d.vy *= k;
    d.x += d.vx * dt; d.y += d.vy * dt;
    if (p.alive && sp > 400) {
      const rx = d.x - p.x, ry = d.y - p.y, dist = Math.hypot(rx, ry);
      if (dist < RR) {
        const along = rx * ux + ry * uy;
        let px = rx - along * ux, py = ry - along * uy;
        const pl = Math.hypot(px, py) || 1;
        const f = (1 - dist / RR) * sp * 4 * dt;
        d.vx += px / pl * f + ux * f * 0.4; d.vy += py / pl * f + uy * f * 0.4;
        d.hit = 1;
      }
    }
    d.hit = Math.max(0, d.hit - dt * 1.5);
    if (d.x < vb.l - 300 || d.y < vb.t - 500 || d.y > vb.b + 500 || d.x > vb.r + 2200) Object.assign(d, newDust(vb, false));
  }
}
function newDust(vb, initial) {
  return { x: initial ? rand(vb.l, vb.r) : rand(vb.r, vb.r + 1400), y: rand(vb.t - 100, vb.b + 100), vx: 0, vy: 0, s: rand(0.6, 1.6), hit: 0, hue: Math.random() < 0.5 ? -1 : rand(0, 360) };
}

// =====================================================================
//  Camera
// =====================================================================
function effZoom() { return cam.zoom * (1 + zoomKick); }
function viewHalfW() { return (W / 2) / effZoom() * 1.12 + 80; }
function viewBounds() {
  const z = effZoom(), hw = (W / 2) / z, hh = (H / 2) / z;
  const c = Math.abs(Math.cos(cam.rot)), s = Math.abs(Math.sin(cam.rot));
  const ew = hw * c + hh * s, eh = hw * s + hh * c;
  return { l: cam.x - ew - 60, r: cam.x + ew + 60, t: cam.y - eh - 60, b: cam.y + eh + 60 };
}
function worldToScreen(x, y) {
  const z = effZoom(), dx = (x - cam.x) * z, dy = (y - cam.y) * z;
  const c = Math.cos(cam.rot), s = Math.sin(cam.rot);
  return { x: W / 2 + dx * c - dy * s, y: H / 2 + dx * s + dy * c };
}
function updateCamera(dt) {
  if (!p) return;
  const sp = speed();
  const skyOut = world.sky && world.sky.phase !== 'fall' ? 0.86 : 1; // 하늘길 위에서는 살짝 줌아웃
  const zt = baseZoom() * lerp(1.1, 0.66, clamp((sp - 250) / 3000, 0, 1)) * skyOut;
  cam.zoom += (zt - cam.zoom) * Math.min(1, dt * 2.2);
  const z = cam.zoom;
  const leadT = (p.alive ? clamp(p.vx * 0.3, -150, 700) : 0) + (W / z) * 0.1;
  cam.lead += (leadT - cam.lead) * Math.min(1, dt * 2.5);
  cam.x = p.x + cam.lead;
  const ty = p.y - (H / z) * 0.06 + (p.alive ? clamp(p.vy * 0.14, -200, 260) : 0);
  cam.y += (ty - cam.y) * Math.min(1, dt * 5);
  const lim = (H / z) * 0.36;
  if (p.y - cam.y > lim) cam.y = p.y - lim;
  if (cam.y - p.y > lim) cam.y = p.y + lim;
  const rt = p.alive ? clamp(Math.atan2(p.vy, Math.max(200, p.vx)) * 0.1, -0.09, 0.09) : 0;
  cam.rot += (rt - cam.rot) * Math.min(1, dt * 3);
  bgRefY += (cam.y - bgRefY) * Math.min(1, dt * 0.6);
  const dx = cam.x - lastCamX; lastCamX = cam.x;
  const f = [0.05, 0.12, 0.25, 0.42, 0.7];
  for (let i = 0; i < 5; i++) bgOff[i] += dx * z * f[i];
}

// =====================================================================
//  Render
// =====================================================================
function render(rdt) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (!p) return;
  const sp = speed();
  // 배경 핵심 색(꾸미기)을 중심으로 천천히 ±20 흔들린다. 하늘·산·트랙 색이 모두 이 hue 에서 나온다
  const hue = (Save.data.look.sky + Math.sin(time * 0.05 + st.dist * 0.0004) * 20 + (st.feverT > 0 ? Math.sin(time * 3) * 20 : 0) + 360) % 360;
  drawSky(hue);
  drawParallax(hue);

  const z = effZoom();
  const shx = (Math.random() - 0.5) * shake, shy = (Math.random() - 0.5) * shake;
  ctx.save();
  ctx.translate(W / 2 + shx, H / 2 + shy);
  ctx.rotate(cam.rot);
  ctx.scale(z, z);
  ctx.translate(-cam.x, -cam.y);
  const vb = viewBounds();
  drawDust(sp, z);
  drawTerrain(vb, hue);
  drawPads(vb);
  drawSigns(vb);
  drawSkyway(vb);
  drawRings(vb);
  drawCoins(vb);
  drawEnemies(vb);
  if (p.alive) { drawTrail(sp); drawWind(sp); drawCue(); drawBall(sp); }
  drawParticles();
  drawWaves();
  ctx.restore();

  drawSpeedLines(sp);
  drawFocusLines();
  drawOverlays(sp);
  drawGoldLayer();
  if (mode !== 'demo' && mode !== 'menu') drawHUD(sp, rdt);
  drawPops();
  drawBanners();
}

function drawSky(hue) {
  // 파스텔 하늘: 라벤더 → 핑크 → 피치 (hue 가 천천히 돌며 색감이 바뀐다)
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, `hsl(${hue},70%,80%)`);
  g.addColorStop(0.55, `hsl(${(hue + 30) % 360},80%,86%)`);
  g.addColorStop(1, `hsl(${(hue + 60) % 360},90%,90%)`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // 반짝이 (파스텔 위라 흰 별 + 은은하게)
  ctx.fillStyle = '#fff';
  for (const s of STARS) {
    const x = ((s.x * W - bgOff[0] * 0.3) % W + W) % W;
    ctx.globalAlpha = 0.3 + 0.6 * Math.abs(Math.sin(time * 2 + s.tw));
    ctx.fillRect(x, s.y * H, s.s + 0.6, s.s + 0.6);
  }
  ctx.globalAlpha = 1;
  // 줄무늬 해 (신스웨이브 → 파스텔)
  const sr = Math.min(W, H) * 0.2, sx = W * 0.72, sy = H * 0.38 - (cam.y - bgRefY) * 0.02;
  const sg = ctx.createLinearGradient(0, sy - sr, 0, sy + sr);
  sg.addColorStop(0, '#fff6a8'); sg.addColorStop(0.5, '#ffb38a'); sg.addColorStop(1, `hsl(${(hue + 320) % 360},90%,76%)`);
  ctx.save();
  ctx.beginPath();
  ctx.rect(sx - sr, sy - sr, sr * 2, sr * 1.0);
  for (let yy = sy; yy < sy + sr; yy += 22) {
    const hgt = 22 - ((yy - sy) / sr) * 14;
    ctx.rect(sx - sr, yy + (22 - hgt), sr * 2, hgt);
  }
  ctx.clip();
  ctx.fillStyle = sg;
  ctx.beginPath(); ctx.arc(sx, sy, sr, 0, TAU); ctx.fill();
  ctx.restore();
  ctx.globalCompositeOperation = 'lighter';
  const glow = ctx.createRadialGradient(sx, sy, sr * 0.6, sx, sy, sr * 2.2);
  glow.addColorStop(0, 'rgba(255,170,210,0.22)'); glow.addColorStop(1, 'rgba(255,170,210,0)');
  ctx.fillStyle = glow; ctx.fillRect(sx - sr * 2.2, sy - sr * 2.2, sr * 4.4, sr * 4.4);
  ctx.globalCompositeOperation = 'source-over';
}

function ridge(x, seed) {
  return Math.sin(x * 0.0021 + seed) * 0.5 + Math.sin(x * 0.0053 + seed * 2.3) * 0.3 + Math.sin(x * 0.013 + seed * 4.1) * 0.2;
}
function drawParallax(hue) {
  const vOff = (cam.y - bgRefY) * effZoom();
  // 파스텔 산: 먼 산일수록 옅게
  const layers = [
    { i: 0, base: 0.58, amp: 0.2, seed: 1.3, l: 82, hs: 20 },
    { i: 1, base: 0.67, amp: 0.16, seed: 4.1, l: 76, hs: 70 },
    { i: 2, base: 0.77, amp: 0.12, seed: 7.7, l: 70, hs: 130 },
  ];
  for (const L of layers) {
    const f = [0.05, 0.12, 0.25][L.i];
    const yo = -vOff * f * 0.7;
    ctx.beginPath(); ctx.moveTo(0, H);
    for (let sx = 0; sx <= W + 24; sx += 24) ctx.lineTo(sx, H * L.base + ridge(sx + bgOff[L.i], L.seed) * H * L.amp + yo);
    ctx.lineTo(W, H); ctx.closePath();
    ctx.fillStyle = `hsl(${(hue + L.hs * 0.3) % 360},55%,${L.l}%)`;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2; ctx.stroke();
  }
  // 떠다니는 도형들
  ctx.lineWidth = 3;
  for (const [li, cell, alpha, scale] of [[3, 300, 0.3, 1], [4, 480, 0.15, 1.9]]) {
    const off = bgOff[li], yo = -vOff * (li === 3 ? 0.42 : 0.7);
    const i0 = Math.floor(off / cell) - 1, i1 = Math.floor((off + W) / cell) + 1;
    for (let i = i0; i <= i1; i++) {
      const r1 = hash(i * 7 + li), r2 = hash(i * 13 + 5), r3 = hash(i * 17 + 9), r4 = hash(i * 23 + 3);
      const x = i * cell - off + r1 * cell * 0.7, y = H * (0.08 + r2 * 0.6) + yo;
      const s = (12 + r3 * 34) * scale, rot = time * (r4 - 0.5) * 3 + r1 * 6;
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
      ctx.strokeStyle = `hsla(${(hue + (r1 < 0.5 ? -30 : 40) + 360) % 360},80%,98%,${alpha * 2})`;
      ctx.beginPath();
      const k = Math.floor(r4 * 4);
      if (k === 0) { ctx.moveTo(0, -s); ctx.lineTo(s * 0.87, s * 0.5); ctx.lineTo(-s * 0.87, s * 0.5); ctx.closePath(); }
      else if (k === 1) ctx.arc(0, 0, s * 0.8, 0, TAU);
      else if (k === 2) ctx.rect(-s * 0.7, -s * 0.7, s * 1.4, s * 1.4);
      else { ctx.moveTo(-s, 0); ctx.lineTo(s, 0); ctx.moveTo(0, -s); ctx.lineTo(0, s); }
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawDust(sp, z) {
  const a = clamp((sp - 250) / 1400, 0.12, 0.85);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  const k = 0.035;
  for (const d of dust) {
    let ex = (p.vx - d.vx) * k, ey = (p.vy - d.vy) * k;
    const l = Math.hypot(ex, ey);
    if (l > 300) { ex *= 300 / l; ey *= 300 / l; }
    ctx.strokeStyle = GOLD() ? `rgba(255,214,90,${a * (0.5 + d.hit * 0.5)})` : `rgba(255,255,255,${a * (0.5 + d.hit * 0.5)})`;
    ctx.lineWidth = (1.6 + d.s + d.hit * 2) / z;
    ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + ex + 0.5, d.y + ey); ctx.stroke();
  }
  ctx.restore();
}

function drawTerrain(vb, hue) {
  const T = world.terrain, ys = T.ys, lo = T.offset;
  const i0 = Math.max(lo, Math.floor(vb.l / STEP) - 1), i1 = Math.min(lo + ys.length - 1, Math.ceil(vb.r / STEP) + 1);
  if (i1 <= i0) return;
  const surf = new Path2D();
  let minY = 1e9, maxY = -1e9;
  surf.moveTo(i0 * STEP, ys[i0 - lo]);
  for (let i = i0 + 1; i <= i1; i++) { const y = ys[i - lo]; surf.lineTo(i * STEP, y); if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const bottom = Math.max(vb.b, maxY) + 600;
  const gold = GOLD();
  const gh = (hue + 275) % 360; // 트랙 hue: 하늘(라벤더) 보다 85도 앞 → 민트~아쿠아
  const fill = new Path2D(surf);
  fill.lineTo(i1 * STEP, bottom); fill.lineTo(i0 * STEP, bottom); fill.closePath();

  const gr = ctx.createLinearGradient(vb.l, 0, vb.r, 0);
  for (let k = 0; k <= 6; k++) {
    const x = vb.l + (vb.r - vb.l) * k / 6;
    gr.addColorStop(k / 6, gold
      ? `hsl(${42 + Math.sin(x * 0.003 + time * 3) * 6},90%,${46 + Math.sin(x * 0.004) * 8}%)`
      : `hsl(${(gh + Math.sin(x * 0.0015) * 20 + 360) % 360},55%,${72 + Math.sin(x * 0.0021) * 4}%)`); // 파스텔 민트~아쿠아 트랙
  }
  ctx.fillStyle = gr; ctx.fill(fill);

  ctx.save();
  ctx.clip(fill);
  // 사선 줄무늬 (월드에 붙어서 지나감 → 속도 기준점)
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  const sw = 180, k0 = Math.floor((vb.l - 600) / sw), k1 = Math.ceil(vb.r / sw);
  ctx.beginPath();
  for (let k = k0; k <= k1; k += 2) {
    const x = k * sw;
    ctx.moveTo(x, minY - 60); ctx.lineTo(x + 80, minY - 60); ctx.lineTo(x + 80 - 600, bottom); ctx.lineTo(x - 600, bottom); ctx.closePath();
  }
  ctx.fill();
  // 내부 띠
  ctx.lineJoin = 'round';
  ctx.translate(0, 34);
  ctx.strokeStyle = gold ? 'rgba(255,246,176,0.45)' : `hsla(${gh},70%,90%,0.6)`; ctx.lineWidth = 20; ctx.stroke(surf);
  ctx.translate(0, 44);
  ctx.strokeStyle = gold ? 'rgba(150,90,0,0.45)' : `hsla(${gh},45%,55%,0.3)`; ctx.lineWidth = 12; ctx.stroke(surf);
  ctx.restore();

  const dg = ctx.createLinearGradient(0, cam.y - 200, 0, vb.b + 300);
  dg.addColorStop(0, 'rgba(90,40,130,0)'); dg.addColorStop(1, 'rgba(90,40,130,0.25)');
  ctx.fillStyle = dg; ctx.fill(fill);

  // 표면 네온
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = gold ? 'rgba(255,200,40,0.45)' : `hsla(${gh},80%,70%,0.25)`; ctx.lineWidth = gold ? 44 : 30; ctx.stroke(surf);
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = gold ? '#ffd84a' : `hsl(${gh},60%,48%)`; ctx.lineWidth = 9; ctx.stroke(surf);
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.stroke(surf);

  // 지면 기둥 (휙휙 지나가는 기준점)
  const ps = 240, p0 = Math.floor(vb.l / ps), p1 = Math.ceil(vb.r / ps);
  for (let k = p0; k <= p1; k++) {
    const x = k * ps;
    if (Math.abs(T.slopeAt(x)) > 1.5) continue;
    const y = T.heightAt(x);
    const c = gold ? (k % 2 ? '#fff6b0' : '#ffb300') : k % 2 ? '#ffffff' : '#ffd84a';
    ctx.strokeStyle = c; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(x, y - 2); ctx.lineTo(x, y - 40); ctx.stroke();
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(x, y - 44, 7, 0, TAU); ctx.fill();
  }
}

function drawPads(vb) {
  const T = world.terrain;
  for (const pd of world.pads) {
    if (pd.x2 < vb.l || pd.x1 > vb.r) continue;
    const col = pd.type === 'speed' ? '#2bf0ff' : pd.type === 'jump' ? '#ff2bd6' : '#b6ff2b';
    const a = pd.used ? 0.4 : 1;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let x = pd.x1; x <= pd.x2; x += STEP) { const y = T.heightAt(x) - 4; x === pd.x1 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = col; ctx.globalAlpha = a * 0.35; ctx.lineWidth = 40; ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = a; ctx.lineWidth = 14; ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();
    // 화살표
    ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = 6;
    const shift = (time * (pd.type === 'speed' ? 260 : 120)) % 40;
    for (let x = pd.x1 + shift; x < pd.x2; x += 40) {
      const y = T.heightAt(x), ang = Math.atan(T.slopeAt(x));
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      ctx.beginPath();
      if (pd.type === 'speed') { ctx.moveTo(-8, -30); ctx.lineTo(6, -20); ctx.lineTo(-8, -10); }
      else if (pd.type === 'jump') { const b = (x - pd.x1 - shift) / 40 % 2 ? 0 : 6; ctx.moveTo(-10, -14 - b); ctx.lineTo(0, -28 - b); ctx.lineTo(10, -14 - b); }
      else { ctx.arc(0, -22 - Math.sin(time * 4 + x) * 6, 6, 0, TAU); }
      ctx.stroke();
      ctx.restore();
    }
    const cx = (pd.x1 + pd.x2) / 2, cy = T.heightAt(cx) - 70 + Math.sin(time * 6) * 6;
    ctx.font = `26px ${F_NUM}`; ctx.textAlign = 'center';
    ctx.lineWidth = 6; ctx.strokeStyle = '#1a0630';
    const label = pd.type === 'speed' ? 'BOOST' : pd.type === 'jump' ? 'JUMP' : 'LOW-G';
    ctx.strokeText(label, cx, cy); ctx.fillStyle = col; ctx.fillText(label, cx, cy);
    ctx.restore();
  }
}

// 하늘길: 반투명 네온 유리 발판 (앞으로 쭉 펼쳐지고, 지나간 뒤로는 부서진다)
function drawSkyway(vb) {
  const sk = world.sky;
  if (!sk) return;
  const grow = sk.x1 + (time - sk.born) * 14000; // 발동 직후 앞으로 쭉 펼쳐지는 연출
  const xa = Math.max(sk.x1, sk.crumble, vb.l - 50), xb = Math.min(sk.x2, grow, vb.r + 50);
  if (xb <= xa) return;
  const y = sk.y, th = 20;
  const a = sk.alpha * (1 - clamp(sk.fade / 2.5, 0, 1));
  ctx.save();
  ctx.globalAlpha = a;
  // 판 본체 (반투명)
  const gr = ctx.createLinearGradient(xa, 0, xb, 0);
  for (let k = 0; k <= 4; k++) {
    const x = lerp(xa, xb, k / 4);
    gr.addColorStop(k / 4, `hsla(${185 + Math.sin(x * 0.0018 + time * 2) * 30},100%,75%,0.22)`);
  }
  ctx.fillStyle = gr; ctx.fillRect(xa, y, xb - xa, th);
  // 아래로 비치는 빛
  const lg = ctx.createLinearGradient(0, y + th, 0, y + th + 160);
  lg.addColorStop(0, 'rgba(127,240,255,0.16)'); lg.addColorStop(1, 'rgba(127,240,255,0)');
  ctx.fillStyle = lg; ctx.fillRect(xa, y + th, xb - xa, 160);
  // 유리 격자 (월드 고정 → 속도감)
  ctx.strokeStyle = 'rgba(220,252,255,0.45)'; ctx.lineWidth = 3;
  ctx.beginPath();
  for (let x = Math.ceil(xa / 120) * 120; x < xb; x += 120) { ctx.moveTo(x, y + 2); ctx.lineTo(x - 14, y + th); }
  ctx.stroke();
  // 윗면 네온
  ctx.lineCap = 'round';
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = 'rgba(127,240,255,0.35)'; ctx.lineWidth = 34;
  ctx.beginPath(); ctx.moveTo(xa, y); ctx.lineTo(xb, y); ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = '#7ff0ff'; ctx.lineWidth = 8; ctx.stroke();
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.stroke();
  ctx.strokeStyle = 'rgba(201,168,255,0.7)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(xa, y + th); ctx.lineTo(xb, y + th); ctx.stroke();
  // 끝 표시 (끊긴 지점)
  if (xb >= sk.x2 - 1 && sk.x2 < vb.r + 50) {
    const pulse = 0.6 + 0.4 * Math.sin(time * 12);
    ctx.fillStyle = `rgba(255,255,255,${pulse})`;
    ctx.fillRect(sk.x2 - 6, y - 4, 6, th + 8);
  }
  // 부스터 발판
  for (const pd of sk.pads) {
    if (pd.x2 < xa || pd.x1 > xb) continue;
    const x1 = Math.max(pd.x1, xa), x2 = Math.min(pd.x2, xb), pa = pd.used ? 0.4 : 1;
    ctx.globalAlpha = a * pa;
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = '#2bf0ff'; ctx.globalAlpha = a * pa * 0.35; ctx.lineWidth = 40;
    ctx.beginPath(); ctx.moveTo(x1, y - 4); ctx.lineTo(x2, y - 4); ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = a * pa; ctx.lineWidth = 14; ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();
    ctx.strokeStyle = '#2bf0ff'; ctx.lineWidth = 6;
    const shift = (time * 260) % 40;
    ctx.beginPath();
    for (let x = x1 + shift; x < x2; x += 40) { ctx.moveTo(x - 8, y - 30); ctx.lineTo(x + 6, y - 20); ctx.lineTo(x - 8, y - 10); }
    ctx.stroke();
    if (!pd.used) {
      ctx.font = `26px ${F_NUM}`; ctx.textAlign = 'center';
      const cx = (pd.x1 + pd.x2) / 2, cy = y - 70 + Math.sin(time * 6) * 6;
      ctx.lineWidth = 6; ctx.strokeStyle = '#1a0630'; ctx.strokeText('BOOST', cx, cy);
      ctx.fillStyle = '#2bf0ff'; ctx.fillText('BOOST', cx, cy);
    }
  }
  ctx.restore();
}

function drawSigns(vb) {
  const T = world.terrain, every = 100 * PX_PER_M;
  const k0 = Math.max(1, Math.floor((vb.l - START_X) / every)), k1 = Math.ceil((vb.r - START_X) / every);
  ctx.font = `22px ${F_NUM}`; ctx.textAlign = 'center';
  for (let k = k0; k <= k1; k++) {
    const x = START_X + k * every, y = T.heightAt(x);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 130); ctx.stroke();
    ctx.fillStyle = '#ff4fa8';
    ctx.beginPath(); ctx.moveTo(x, y - 130); ctx.lineTo(x + 90, y - 112); ctx.lineTo(x, y - 94); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.lineWidth = 5; ctx.strokeStyle = '#1a0630';
    ctx.strokeText(`${k * 100}m`, x + 6, y - 146); ctx.fillText(`${k * 100}m`, x + 6, y - 146);
  }
}

function drawRings(vb) {
  for (const r of world.rings) {
    if (r.x < vb.l - 100 || r.x > vb.r + 100) continue;
    const k = r.taken ? r.t / 0.7 : 0;
    if (k >= 1) continue;
    const s = 1 + k * 1.5, a = 1 - k;
    ctx.save(); ctx.translate(r.x, r.y); ctx.scale(s, s);
    ctx.globalAlpha = a;
    const g = ctx.createLinearGradient(0, -r.h, 0, r.h);
    g.addColorStop(0, '#ffcf2b'); g.addColorStop(0.5, '#ff8a3d'); g.addColorStop(1, '#ffcf2b');
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = g; ctx.lineWidth = 26; ctx.globalAlpha = a * 0.3;
    ctx.beginPath(); ctx.ellipse(0, 0, 26, r.h, 0, 0, TAU); ctx.stroke();
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = a;
    ctx.lineWidth = 10; ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.restore();
  }
}

function drawCoins(vb) {
  for (const c of world.coins) {
    if (c.x < vb.l - 40 || c.x > vb.r + 40 || c.y < vb.t - 40 || c.y > vb.b + 40) continue;
    if (c.taken) {
      const k = c.t / 0.35; if (k >= 1) continue;
      ctx.strokeStyle = c.big ? `rgba(43,240,255,${1 - k})` : `rgba(255,216,74,${1 - k})`;
      ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(c.x, c.y, 14 + k * 40, 0, TAU); ctx.stroke();
      continue;
    }
    const s = Math.max(0.15, Math.abs(Math.cos(time * 4 + c.ph)));
    const by = Math.sin(time * 3 + c.ph) * 4;
    ctx.save(); ctx.translate(c.x, c.y + by);
    if (c.big) {
      ctx.rotate(time * 2);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(43,240,255,0.25)'; ctx.beginPath(); ctx.arc(0, 0, 36, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#2bf0ff'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, -24); ctx.lineTo(18, 0); ctx.lineTo(0, 24); ctx.lineTo(-18, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#b98bff'; ctx.beginPath(); ctx.moveTo(0, -24); ctx.lineTo(18, 0); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
    } else {
      ctx.scale(s, 1);
      ctx.fillStyle = '#b8860b'; ctx.beginPath(); ctx.arc(0, 2, 14, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffd84a'; ctx.beginPath(); ctx.arc(0, 0, 14, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff6b0'; ctx.beginPath(); ctx.arc(0, 0, 8, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffb300'; ctx.fillRect(-2, -6, 4, 12);
    }
    ctx.restore();
  }
}

function drawEnemies(vb) {
  const danger = !p.breaker && mode === 'play';
  for (const e of world.enemies) {
    if (e.x < vb.l - 80 || e.x > vb.r + 80) continue;
    if (!e.alive) {
      if (e.dead < 0.25) {
        ctx.fillStyle = `rgba(255,255,255,${1 - e.dead / 0.25})`;
        ctx.beginPath(); ctx.arc(e.x, e.y, e.size * (1 + e.dead * 6), 0, TAU); ctx.fill();
      }
      continue;
    }
    const s = e.size;
    const near = e.x > p.x - 100 && e.x < p.x + 2000;
    ctx.save();
    let jx = 0;
    if (p.breaker && near && p.alive) jx = Math.sin(time * 60 + e.ph) * 2.5; // 겁먹고 덜덜
    ctx.translate(e.x + jx, e.y);
    if (danger && near) {
      ctx.globalCompositeOperation = 'lighter';
      const pr = s * 1.5 * (1 + 0.2 * Math.sin(time * 14));
      const g = ctx.createRadialGradient(0, 0, s * 0.3, 0, 0, pr);
      g.addColorStop(0, 'rgba(255,30,60,0.55)'); g.addColorStop(1, 'rgba(255,30,60,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, pr, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.rotate(e.rot);
    const g = ctx.createLinearGradient(0, -s * 0.6, 0, s * 0.45);
    g.addColorStop(0, '#ff6070'); g.addColorStop(1, '#a0001c');
    ctx.beginPath(); ctx.moveTo(0, -s * 0.62); ctx.lineTo(s * 0.56, s * 0.42); ctx.lineTo(-s * 0.56, s * 0.42); ctx.closePath();
    ctx.fillStyle = g; ctx.fill();
    ctx.lineJoin = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = '#2a0008'; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,200,210,0.7)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-s * 0.08, -s * 0.42); ctx.lineTo(-s * 0.36, s * 0.22); ctx.stroke();
    // 화난 눈
    const lx = clamp((p.x - e.x) / 400, -1, 1) * s * 0.05, ly = clamp((p.y - e.y) / 400, -1, 1) * s * 0.05;
    for (const ex of [-0.17, 0.17]) {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.ellipse(ex * s, s * 0.1, s * 0.11, s * 0.13, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#1a0008';
      ctx.beginPath(); ctx.arc(ex * s + lx, s * 0.12 + ly, s * 0.06, 0, TAU); ctx.fill();
    }
    ctx.strokeStyle = '#1a0008'; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-s * 0.3, -s * 0.06); ctx.lineTo(-s * 0.06, s * 0.02); ctx.moveTo(s * 0.3, -s * 0.06); ctx.lineTo(s * 0.06, s * 0.02); ctx.stroke();
    ctx.restore();
    if (danger && near) {
      const by = e.y - s * 1.1 + Math.sin(time * 10) * 6;
      ctx.font = `${36}px ${F_NUM}`; ctx.textAlign = 'center';
      ctx.lineWidth = 7; ctx.strokeStyle = '#1a0008'; ctx.strokeText('!', e.x, by);
      ctx.fillStyle = Math.sin(time * 20) > 0 ? '#ffde2b' : '#ff2b55'; ctx.fillText('!', e.x, by);
    }
  }
}

function drawTrail(sp) {
  const n = trail.length / 2;
  if (n < 2) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  const a = clamp((sp - 200) / 1400, 0.15, 1) * (st.feverT > 0 ? 1.3 : 1);
  const fl = flameStyle(mods.orbs);
  if (fl) drawFlameTrail(n, fl);
  else for (let i = 1; i < n; i++) {
    const k = i / n;
    ctx.strokeStyle = `hsla(${(p.hue + 360 + k * 30) % 360},100%,65%,${Math.min(1, k * 0.5 * a)})`;
    ctx.lineWidth = R * 1.8 * k;
    ctx.beginPath(); ctx.moveTo(trail[(i - 1) * 2], trail[(i - 1) * 2 + 1]); ctx.lineTo(trail[i * 2], trail[i * 2 + 1]); ctx.stroke();
  }
  // 잔상 (색수차)
  if (sp > breakSpeed() * 0.9 || boostVis > 0.2) {
    const cols = ['rgba(43,240,255,0.22)', 'rgba(255,43,214,0.2)', 'rgba(255,207,43,0.16)'];
    [5, 10, 16].forEach((j, idx) => {
      if (j >= n) return;
      const i = n - 1 - j;
      ctx.fillStyle = cols[idx];
      ctx.beginPath(); ctx.arc(trail[i * 2], trail[i * 2 + 1], R * 0.95, 0, TAU); ctx.fill();
    });
  }
  ctx.restore();
}

function drawFlameTrail(n, fl) {
  ctx.save();
  ctx.globalCompositeOperation = fl.add ? 'lighter' : 'source-over';
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // 바깥 불꽃 → 중간 → 심지 순서로 겹쳐 그림. 끝으로 갈수록 가늘어지고 일렁인다
  const layers = [[2, 1.0, 0.45], [1, 0.62, 0.6], [0, 0.3, 0.85]];
  for (const [ci, wMul, aMul] of layers) {
    ctx.strokeStyle = fl.cols[ci];
    for (let i = 1; i < n; i++) {
      const k = i / n;
      const flick = 0.8 + 0.35 * Math.sin(time * 34 + i * 1.7 + ci) * Math.sin(time * 21 + i * 0.6);
      ctx.globalAlpha = Math.min(1, k * k * aMul * fl.power * (fl.add ? 1 : 1.1));
      ctx.lineWidth = R * 2.1 * fl.scale * wMul * k * flick;
      const x0 = trail[(i - 1) * 2], y0 = trail[(i - 1) * 2 + 1], x1 = trail[i * 2], y1 = trail[i * 2 + 1];
      const wob = (1 - k) * R * 0.5 * fl.scale * Math.sin(time * 25 + i);
      ctx.beginPath(); ctx.moveTo(x0, y0 - wob); ctx.lineTo(x1, y1 - wob * 0.6); ctx.stroke();
    }
  }
  // 검은 불꽃은 보랏빛 테두리 광을 덧입혀 배경에서 드러나게
  if (!fl.add) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = '#7a1ac0';
    for (let i = 1; i < n; i += 2) {
      const k = i / n;
      ctx.globalAlpha = k * 0.18;
      ctx.lineWidth = R * 2.6 * fl.scale * k;
      ctx.beginPath(); ctx.moveTo(trail[(i - 1) * 2], trail[(i - 1) * 2 + 1]); ctx.lineTo(trail[i * 2], trail[i * 2 + 1]); ctx.stroke();
    }
  }
  ctx.restore();
}

function drawWind(sp) {
  const a = clamp((sp - 600) / 1500, 0, 1);
  if (a <= 0.01) return;
  const ang = Math.atan2(p.vy, p.vx);
  ctx.save();
  ctx.translate(p.x, p.y); ctx.rotate(ang);
  const S = R * 1.15;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.setLineDash([24, 30]);
  ctx.lineDashOffset = -((time * sp * 0.4) % 54);
  STREAMS.forEach((pts, i) => {
    ctx.strokeStyle = GOLD() ? `rgba(255,225,130,${a * (0.62 - i * 0.09)})` : `rgba(220,245,255,${a * (0.62 - i * 0.09)})`;
    ctx.lineWidth = 2.8 - i * 0.35;
    for (const sg of [1, -1]) {
      ctx.beginPath();
      for (let k = 0; k < pts.length; k += 2) {
        const x = pts[k] * S, y = pts[k + 1] * S * sg;
        k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
  ctx.setLineDash([]);
  // 충격파 (bow shock)
  const b = clamp((sp - breakSpeed() * 1.15) / 1400, 0, 1) + boostVis * 0.6;
  if (b > 0.02) {
    for (let k = 0; k < 3; k++) {
      ctx.strokeStyle = `rgba(190,240,255,${Math.min(1, b) * (0.75 - k * 0.2)})`;
      ctx.lineWidth = 6 - k * 1.5;
      ctx.beginPath();
      const fx = R * (1.28 + k * 0.32 + Math.random() * 0.05), cv = R * (2.3 + k * 0.9);
      for (let y = -2.6 * R; y <= 2.6 * R; y += 4) { const x = fx - y * y / cv; y === -2.6 * R ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
      ctx.stroke();
    }
    const g = ctx.createRadialGradient(R * 0.9, 0, 0, R * 0.9, 0, R * 1.5);
    g.addColorStop(0, `rgba(255,255,255,${0.35 * Math.min(1, b)})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(R * 0.9, 0, R * 1.5, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

function drawCue() {
  if (mode !== 'play' || !pred || !p.airHeld || !p.holding || p.airTime < 0.12) return;
  const t = pred.t;
  const col = t <= PERFECT_WIN ? '#3dff7a' : t <= GREAT_WIN ? '#ffe14a' : 'rgba(255,255,255,0.85)';
  ctx.save();
  // 착지 지점
  const gy = world.terrain.heightAt(pred.x);
  ctx.strokeStyle = col; ctx.lineWidth = 5; ctx.lineCap = 'round';
  const m = 18 + Math.sin(time * 18) * 4;
  ctx.beginPath(); ctx.moveTo(pred.x - m, gy - m); ctx.lineTo(pred.x + m, gy + m); ctx.moveTo(pred.x + m, gy - m); ctx.lineTo(pred.x - m, gy + m); ctx.stroke();
  // 타이밍 링: 줄어들다가 공에 닿는 순간 = 떼기!
  ctx.setLineDash([10, 10]); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath(); ctx.arc(p.x, p.y, R * 1.35, 0, TAU); ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineWidth = t <= PERFECT_WIN ? 9 : 5; ctx.strokeStyle = col;
  ctx.beginPath(); ctx.arc(p.x, p.y, R * 1.35 + Math.min(t, 1.4) * 170, 0, TAU); ctx.stroke();
  if (t <= PERFECT_WIN) {
    ctx.font = `40px ${F_NUM}`; ctx.textAlign = 'center';
    ctx.lineWidth = 8; ctx.strokeStyle = '#06260f';
    ctx.strokeText('NOW!', p.x, p.y - R * 2.8); ctx.fillStyle = '#3dff7a'; ctx.fillText('NOW!', p.x, p.y - R * 2.8);
  }
  ctx.restore();
}

function drawBall(sp) {
  const T = world.terrain, n = jelly.n;
  const pts = new Array(n * 2);
  for (let i = 0; i < n; i++) {
    const rr = R * jelly.r[i];
    const x = p.x + jelly.cs[i] * rr;
    let y = p.y + jelly.sn[i] * rr;
    if (p.grounded) { const gh = T.heightAt(x) - 1; if (y > gh) y = gh; }
    pts[i * 2] = x; pts[i * 2 + 1] = y;
  }
  const path = new Path2D();
  const mx = (pts[(n - 1) * 2] + pts[0]) / 2, my = (pts[(n - 1) * 2 + 1] + pts[1]) / 2;
  path.moveTo(mx, my);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    path.quadraticCurveTo(pts[i * 2], pts[i * 2 + 1], (pts[i * 2] + pts[j * 2]) / 2, (pts[i * 2 + 1] + pts[j * 2 + 1]) / 2);
  }
  const fever = st.feverT > 0;
  // 몸통 색은 항상 꾸미기에서 고른 구체 색. BREAK/FEVER/GOLD 상태는 오라·테두리 색으로만 알린다
  const turn = (a, b, k) => a + ((((b - a) % 360) + 540) % 360 - 180) * k;
  p.hue = turn(p.hue, Save.data.look.ball, 0.15);
  const hue = (p.hue + 360) % 360;
  const stateHue = GOLD() ? 46 : fever ? 45 + Math.sin(time * 6) * 15 : p.breaker ? 22 : null;
  if (p.auraHue == null) p.auraHue = hue;
  p.auraHue = turn(p.auraHue, stateHue == null ? hue : stateHue, 0.15);
  const auraHue = (p.auraHue + 360) % 360;

  ctx.save();
  // 오라 (상태 색)
  ctx.globalCompositeOperation = 'lighter';
  const ar = R * (2.1 + boostVis * 0.8 + (p.breaker ? 0.4 : 0));
  const ag = ctx.createRadialGradient(p.x, p.y, R * 0.6, p.x, p.y, ar);
  ag.addColorStop(0, `hsla(${auraHue},100%,60%,${p.breaker ? 0.55 : 0.3})`); ag.addColorStop(1, `hsla(${auraHue},100%,60%,0)`);
  ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(p.x, p.y, ar, 0, TAU); ctx.fill();
  // 상태 테두리: BREAK/FEVER/GOLD 중엔 공 바깥에 상태 색 링이 맥동한다
  if (stateHue != null) {
    ctx.strokeStyle = `hsla(${auraHue},100%,62%,${0.75 + 0.25 * Math.sin(time * 14)})`;
    ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(p.x, p.y, R * 1.32, 0, TAU); ctx.stroke();
  }
  // 색수차 (부스트)
  if (boostVis > 0.15) {
    const o = 7 * boostVis;
    ctx.save(); ctx.translate(-o, 0); ctx.fillStyle = 'rgba(43,240,255,0.5)'; ctx.fill(path); ctx.restore();
    ctx.save(); ctx.translate(o, 0); ctx.fillStyle = 'rgba(255,43,214,0.5)'; ctx.fill(path); ctx.restore();
  }
  ctx.globalCompositeOperation = 'source-over';

  // 몸통 (광택 그라데이션) — 얼굴 없는 그냥 공
  const bg = ctx.createRadialGradient(p.x - R * 0.35, p.y - R * 0.45, R * 0.08, p.x, p.y, R * 1.35);
  bg.addColorStop(0, '#ffffff');
  bg.addColorStop(0.18, `hsl(${hue},100%,86%)`);
  bg.addColorStop(0.6, `hsl(${hue},95%,62%)`);
  bg.addColorStop(1, `hsl(${(hue + 20) % 360},90%,34%)`);
  ctx.fillStyle = bg; ctx.fill(path);

  // 굴러가는 무늬
  ctx.save();
  ctx.clip(path);
  ctx.fillStyle = `hsla(${(hue + 30) % 360},100%,40%,0.28)`;
  for (let k = 0; k < 3; k++) {
    const a = p.rot + k * TAU / 3;
    ctx.beginPath(); ctx.arc(p.x + Math.cos(a) * R * 0.62, p.y + Math.sin(a) * R * 0.62, R * 0.2, 0, TAU); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = R * 0.18;
  ctx.beginPath(); ctx.arc(p.x, p.y, R * 0.62, p.rot + 0.5, p.rot + 1.6); ctx.stroke();
  ctx.restore();

  // 하이라이트
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath(); ctx.ellipse(p.x - R * 0.38, p.y - R * 0.48, R * 0.24, R * 0.14, -0.6, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath(); ctx.arc(p.x - R * 0.08, p.y - R * 0.66, R * 0.06, 0, TAU); ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = `hsla(${(hue + 10) % 360},80%,22%,0.85)`; ctx.stroke(path);
  // 폭주 스택 구슬 (스택 수만큼 공 주위를 돈다)
  if (mods.orbs > 0) {
    const n = Math.min(mods.orbs, 12), orR = R * (1.55 + odPunch * 0.6);
    const fl = flameStyle(mods.orbs);
    for (let i = 0; i < n; i++) {
      const a = time * (3 + n * 0.3) + i * TAU / n;
      const ox = p.x + Math.cos(a) * orR, oy = p.y + Math.sin(a) * orR * 0.8;
      if (fl.add) {
        ctx.globalCompositeOperation = 'lighter';
        const og = ctx.createRadialGradient(ox, oy, 0, ox, oy, 11);
        og.addColorStop(0, '#ffffff'); og.addColorStop(0.35, fl.cols[1]); og.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = og; ctx.beginPath(); ctx.arc(ox, oy, 11, 0, TAU); ctx.fill();
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#000'; ctx.strokeStyle = '#9a3ae0'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(ox, oy, 7, 0, TAU); ctx.fill(); ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
}

function drawParticles() {
  ctx.save();
  for (const q of parts) {
    if (q.type !== 'shard' && q.type !== 'goo' && q.type !== 'bflame') continue;
    const k = q.life / q.max;
    ctx.globalAlpha = Math.min(1, k * 1.5);
    ctx.fillStyle = q.col;
    if (q.type === 'bflame') {
      ctx.globalAlpha = k * 0.85;
      ctx.beginPath(); ctx.arc(q.x, q.y, q.size * (0.4 + (1 - k) * 0.9), 0, TAU); ctx.fill();
    } else if (q.type === 'shard') {
      ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot);
      ctx.beginPath(); ctx.moveTo(0, -q.size); ctx.lineTo(q.size * 0.8, q.size * 0.6); ctx.lineTo(-q.size * 0.8, q.size * 0.6); ctx.closePath(); ctx.fill();
      ctx.restore();
    } else { ctx.beginPath(); ctx.arc(q.x, q.y, q.size * (0.5 + 0.5 * k), 0, TAU); ctx.fill(); }
  }
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const q of parts) {
    const k = q.life / q.max;
    if (q.type === 'spark') {
      ctx.globalAlpha = k; ctx.strokeStyle = q.col; ctx.lineWidth = q.size * (0.4 + k);
      ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - q.vx * 0.035, q.y - q.vy * 0.035); ctx.stroke();
    } else if (q.type === 'dot') {
      ctx.globalAlpha = k; ctx.fillStyle = q.col;
      ctx.beginPath(); ctx.arc(q.x, q.y, q.size * k, 0, TAU); ctx.fill();
    } else if (q.type === 'flame') {
      ctx.globalAlpha = k * 0.8; ctx.fillStyle = q.col;
      ctx.beginPath(); ctx.arc(q.x, q.y, q.size * (0.4 + (1 - k) * 0.9), 0, TAU); ctx.fill();
    } else if (q.type === 'star') {
      ctx.globalAlpha = k; ctx.fillStyle = q.col;
      ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot);
      const s = q.size * (0.5 + k);
      ctx.beginPath();
      for (let i = 0; i < 8; i++) { const r = i % 2 ? s * 0.35 : s; const a = i * Math.PI / 4; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      ctx.closePath(); ctx.fill(); ctx.restore();
    }
  }
  ctx.restore();
}

function drawWaves() {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const w of waves) {
    const k = w.life / w.max;
    ctx.globalAlpha = k; ctx.strokeStyle = w.col; ctx.lineWidth = w.w * k + 1;
    ctx.beginPath(); ctx.arc(w.x, w.y, w.r, 0, TAU); ctx.stroke();
  }
  ctx.restore();
}

function drawSpeedLines(sp) {
  const s = clamp((sp - 700) / 2200, 0, 1) + boostVis * 0.5 + (st.feverT > 0 ? 0.2 : 0);
  if (s <= 0.02) return;
  const D = Math.hypot(W, H) / 2;
  ctx.save();
  ctx.translate(W / 2, H / 2); ctx.rotate(lineAng);
  ctx.globalCompositeOperation = 'lighter';
  for (const l of LINES) {
    if (Math.abs(l.y) < 0.2) continue;
    const a = Math.min(0.75, s * (0.25 + Math.abs(l.y) * 0.6));
    ctx.fillStyle = GOLD() ? `rgba(255,214,90,${a * 0.9})` : `rgba(255,255,255,${a * 0.85})`;
    const len = l.len * D * (0.6 + s * 1.4);
    ctx.fillRect(l.x * D, l.y * D, len, l.w);
  }
  ctx.restore();
}

function drawFocusLines() {
  const s = Math.max(boostVis * 0.9, perfectFlash, st.feverT > 0 ? 0.35 : 0);
  if (s <= 0.03) return;
  const cx = W / 2, cy = H / 2, D = Math.hypot(W, H) / 2;
  ctx.save();
  ctx.fillStyle = `rgba(255,255,255,${0.5 * Math.min(1, s)})`;
  ctx.beginPath();
  for (let i = 0; i < 46; i++) {
    const a = Math.random() * TAU, w = rand(0.004, 0.014), r0 = D * rand(0.5, 0.78);
    ctx.moveTo(cx + Math.cos(a - w) * D * 1.1, cy + Math.sin(a - w) * D * 1.1);
    ctx.lineTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a + w) * D * 1.1, cy + Math.sin(a + w) * D * 1.1);
  }
  ctx.fill();
  ctx.restore();
}

function drawOverlays(sp) {
  const v = clamp((sp - 800) / 2600, 0, 1);
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * (0.45 - v * 0.15), W / 2, H / 2, Math.hypot(W, H) * 0.6);
  let edge = `rgba(70,20,110,${0.12 + v * 0.28})`; // 파스텔 배경이라 가장자리는 옅은 보라로만
  if (st.danger && mode === 'play') edge = `rgba(255,20,50,${0.35 + 0.25 * Math.sin(time * 12)})`;
  else if (GOLD()) edge = 'rgba(255,180,20,0.45)';
  else if (p.lowGravT > 0) edge = 'rgba(120,255,60,0.35)';
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, edge);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  if (st.feverT > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 16;
    ctx.strokeStyle = `rgba(255,190,60,${0.3 + 0.15 * Math.sin(time * 8)})`;
    ctx.strokeRect(0, 0, W, H);
    ctx.restore();
  }
  if (flashA > 0) { ctx.globalAlpha = flashA; ctx.fillStyle = flashCol; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
}

function outlined(text, x, y, fill, lw, stroke = '#1a0630') {
  ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.strokeText(text, x, y);
  ctx.fillStyle = fill; ctx.fillText(text, x, y);
}

function drawHUD(sp, rdt) {
  st.disp += (st.score - st.disp) * Math.min(1, rdt * 9);
  if (st.score - st.disp < 2) st.disp = st.score;
  const fs = clamp(W * 0.05, 28, 58);
  const narrow = W < 640;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';

  // 점수
  const sz = fs * (1 + scorePunch * 0.5);
  ctx.font = `${sz}px ${F_NUM}`;
  const txt = fmtComma(st.disp);
  const gw = Math.max(200, ctx.measureText(txt).width);
  const gr = ctx.createLinearGradient(W / 2 - gw / 2, 0, W / 2 + gw / 2, 0);
  gr.addColorStop(0, '#ffe36a'); gr.addColorStop(0.5, '#ffffff'); gr.addColorStop(1, '#ffe36a');
  const sy = 14 + fs;
  outlined(txt, W / 2, sy, gr, sz * 0.2);
  let y = sy;
  if (st.disp >= 1e4) {
    y += fs * 0.6;
    ctx.font = `${fs * 0.48}px ${F_KR}`;
    outlined(fmtKR(st.disp) + '점', W / 2, y, '#ffd84a', 6);
  }
  // 배율
  y += fs * 0.75;
  const ms = fs * 0.62 * (1 + multPunch * 0.5);
  ctx.font = `${ms}px ${F_NUM}`;
  outlined('x' + (st.mult < 100 ? st.mult.toFixed(1) : fmtComma(st.mult)), W / 2, y, `hsl(${310 + Math.sin(time * 8) * 20},100%,68%)`, ms * 0.22);
  // 피버 / 스트릭
  y += 16;
  if (st.feverT > 0) {
    const bw = Math.min(320, W * 0.55), bx = W / 2 - bw / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(bx - 3, y - 3, bw + 6, 18);
    const fg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    fg.addColorStop(0, '#ff8a3d'); fg.addColorStop(1, '#ffe36a');
    ctx.fillStyle = fg; ctx.fillRect(bx, y, bw * clamp(st.feverT / 7, 0, 1), 12);
    ctx.font = `${15}px ${F_NUM}`; outlined('FEVER x2', W / 2, y + 34, '#fff', 4);
  } else if (st.streak > 0) {
    ctx.font = `${16}px ${F_NUM}`;
    outlined(`PERFECT ${'★'.repeat(st.streak)}${'☆'.repeat(Math.max(0, 3 - st.streak))}`, W / 2, y + 14, '#ffe14a', 4);
  }

  // 코인 & 거리
  ctx.textAlign = 'left';
  const cy0 = hudCoinPos().y;
  drawCoinIcon(28, cy0, 13 * (1 + coinPunch * 0.35));
  ctx.font = `${22 * (1 + coinPunch * 0.25)}px ${F_NUM}`; ctx.textBaseline = 'middle';
  outlined(fmtComma(st.coins), 48, cy0 + 1, coinPunch > 0.3 ? '#ffffff' : '#ffd84a', 5);
  ctx.font = `15px ${F_NUM}`;
  outlined(`${fmtComma(st.dist)} m`, 16, cy0 + 30, '#ffffff', 4);
  ctx.textAlign = 'right';
  ctx.font = `13px ${F_NUM}`;
  outlined(`BEST ${fmtKR(Math.max(Save.data.best, st.score))}`, W - 16, 78, '#cbbcff', 4);
  if (p.lowGravT > 0) { ctx.font = `16px ${F_NUM}`; outlined(`LOW-G ${p.lowGravT.toFixed(1)}s`, W - 16, 104, '#b6ff2b', 4); }
  ctx.textBaseline = 'alphabetic';

  // 공중 점수
  if (mode === 'play' && !p.grounded && p.airTime > MIN_AIR) {
    const s = worldToScreen(p.x, p.y);
    ctx.textAlign = 'center';
    ctx.font = `${18 + Math.min(14, p.airTime * 6)}px ${F_NUM}`;
    const ay = clamp(s.y - 90 * effZoom() - 30, 150, H - 40);
    outlined(`AIR ${p.airTime.toFixed(1)}s`, clamp(s.x, 100, W - 100), ay, '#ffffff', 5);
    ctx.font = `16px ${F_KR}`;
    outlined('+' + fmtKR(st.airPts), clamp(s.x, 100, W - 100), ay + 22, '#ffd84a', 4);
  }

  // 속도 위험 경고
  if (st.danger && mode === 'play' && Math.sin(time * 14) > -0.3) {
    ctx.textAlign = 'center';
    ctx.font = `${clamp(W * 0.045, 22, 40)}px ${F_KR}`;
    outlined(`⚠ 너무 느려! ${limitKm()} km/h 이상으로 박살내!`, W / 2, H * 0.8, '#ff3b5c', 7);
  }

  drawGauge(sp);
  ctx.restore();
}

function drawGauge(sp) {
  const r = clamp(Math.min(W, H) * 0.1, 52, 84);
  const cx = 18 + r, cy = H - 22 - r * 0.6;
  const kmh = sp * KMH, MAXK = 500;
  const a0 = Math.PI * 0.8, a1 = Math.PI * 2.2, fr = clamp(kmh / MAXK, 0, 1);
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.lineWidth = r * 0.22; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, r, a0, a0 + (a1 - a0) * fr);
  ctx.strokeStyle = p.breaker ? `hsl(${(time * 500) % 360},100%,60%)` : `hsl(${200 - fr * 200},100%,60%)`;
  ctx.lineWidth = r * 0.16; ctx.stroke();
  const ta = a0 + (a1 - a0) * clamp(limitKm() / MAXK, 0, 1);
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(ta) * r * 0.74, cy + Math.sin(ta) * r * 0.74);
  ctx.lineTo(cx + Math.cos(ta) * r * 1.26, cy + Math.sin(ta) * r * 1.26);
  ctx.strokeStyle = '#ff2b55'; ctx.lineWidth = 5; ctx.stroke();
  ctx.textAlign = 'center';
  ctx.font = `${r * 0.5}px ${F_NUM}`;
  outlined(String(Math.round(kmh)), cx, cy + r * 0.14, '#ffffff', 6);
  ctx.font = `${r * 0.18}px ${F_NUM}`;
  outlined('km/h', cx, cy + r * 0.42, '#cbbcff', 4);
  ctx.font = `${r * 0.22}px ${F_NUM}`;
  if (p.breaker) outlined('BREAK MODE', cx + 10, cy - r - 16, `hsl(${(time * 500) % 360},100%,62%)`, 5);
  else outlined(`LIMIT ${limitKm()}`, cx + 10, cy - r - 16, '#ff4060', 5);
  // 스킬 상태 배지 (성장형 스킬 스택 등)
  const badge = skill && skill.def.badge ? skill.def.badge(skill.stats) : null;
  if (badge) {
    ctx.textAlign = 'right';
    ctx.font = `${18 * (1 + odPunch * 0.4)}px ${F_NUM}`;
    const bh = skill.def.badgeHue != null ? skill.def.badgeHue : 350;
    outlined(badge, W - 18, H - 132, `hsl(${bh + Math.sin(time * 10) * 10},100%,${62 + odPunch * 20}%)`, 5);
    if (mods.limitKm) { ctx.font = `13px ${F_KR}`; outlined(`기준 +${mods.limitKm} km/h`, W - 18, H - 154 - odPunch * 4, '#ffb3c0', 4); }
  }
  if (cheatNoCd) { ctx.textAlign = 'right'; ctx.font = `13px ${F_KR}`; outlined('CHEAT · 쿨타임 0', W - 18, H - 112, '#b6ff2b', 4); }
}

function drawPops() {
  ctx.save();
  ctx.textAlign = 'center'; ctx.lineJoin = 'round';
  for (const q of pops) {
    const t = 1 - q.life / q.max;
    const sc = t < 0.12 ? 0.5 + (t / 0.12) * 0.7 : 1.2 - Math.min(0.2, (t - 0.12) * 1.2);
    ctx.globalAlpha = Math.min(1, q.life / 0.3);
    ctx.font = `${q.size * sc}px ${/[가-힣]/.test(q.text) ? F_KR : F_NUM}`;
    const hw = ctx.measureText(q.text).width / 2 + 12;
    outlined(q.text, clamp(q.x, hw, Math.max(hw, W - hw)), q.y, q.col, q.size * sc * 0.2);
  }
  ctx.restore();
}

function drawBanners() {
  ctx.save();
  ctx.textAlign = 'center'; ctx.lineJoin = 'round';
  const fs = clamp(W * 0.085, 40, 100);
  banners.forEach((b, idx) => {
    const t = 1 - b.life / b.max;
    let sc;
    if (t < 0.12) { const u = t / 0.12; sc = 0.3 + u * 1.1 - Math.sin(u * Math.PI) * 0.0; sc = Math.min(1.4, 0.3 + u * 1.1); }
    else sc = 1.4 - Math.min(0.4, (t - 0.12) * 3);
    if (idx > 0) sc *= 0.6;
    const y = H * 0.4 - idx * fs * 0.85;
    ctx.globalAlpha = Math.min(1, b.life / 0.35) * (idx > 0 ? 0.7 : 1);
    ctx.save();
    ctx.translate(W / 2, y);
    ctx.rotate(Math.sin(time * 18) * 0.03 - 0.06);
    ctx.font = `${fs * sc}px ${F_NUM}`;
    let fill = b.col;
    if (!fill) {
      const w = ctx.measureText(b.text).width;
      fill = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
      fill.addColorStop(0, '#ffe36a'); fill.addColorStop(0.5, '#ffffff'); fill.addColorStop(1, '#ffb02b');
    }
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowOffsetY = 6;
    outlined(b.text, 0, 0, fill, fs * sc * 0.16);
    ctx.shadowColor = 'transparent';
    if (b.sub && idx === 0) {
      ctx.font = `${fs * 0.3}px ${F_KR}`;
      outlined(b.sub, 0, fs * 0.48, '#ffffff', 6);
    }
    ctx.restore();
  });
  ctx.restore();
}

// =====================================================================
//  UI / screens
// =====================================================================
const SCREENS = ['menu', 'shop', 'custom', 'pause', 'gameover'];
function show(id) { for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id); }

// ---------- 꾸미기: 구체 색 / 배경 핵심 색 (hue 값으로 저장, 무료) ----------
const LOOK_DEFAULT = { ball: 322, sky: 250 };
const BALL_PRESETS = [322, 0, 25, 50, 95, 150, 185, 215, 270];
const SKY_PRESETS = [250, 200, 165, 120, 50, 20, 335, 290];
function renderCustom() {
  const L = Save.data.look;
  // 미리보기 (게임 렌더와 같은 공식: drawSky / drawTerrain / drawBall)
  const gh = (L.sky + 275) % 360;
  $('customPreview').style.background = `linear-gradient(hsl(${L.sky},70%,80%), hsl(${(L.sky + 30) % 360},80%,86%) 55%, hsl(${(L.sky + 60) % 360},90%,90%))`;
  document.querySelector('.pv-ground').style.background = `hsl(${gh},55%,72%)`;
  $('pvBall').style.background = `radial-gradient(circle at 32% 28%, #fff, hsl(${L.ball},100%,86%) 18%, hsl(${L.ball},95%,62%) 60%, hsl(${(L.ball + 20) % 360},90%,34%))`;
  $('ballHue').value = L.ball; $('skyHue').value = L.sky;
  const sw = (box, list, key, col) => {
    box.innerHTML = '';
    for (const h of list) {
      const b = document.createElement('button');
      b.className = 'swatch' + (h === L[key] ? ' on' : '');
      b.style.background = col(h);
      b.setAttribute('aria-label', `hue ${h}`);
      b.onclick = () => { setLook(key, h); Sfx.ui(); };
      box.appendChild(b);
    }
  };
  sw($('ballSwatches'), BALL_PRESETS, 'ball', h => `radial-gradient(circle at 35% 30%, #fff, hsl(${h},95%,62%) 55%, hsl(${(h + 20) % 360},90%,34%))`);
  sw($('skySwatches'), SKY_PRESETS, 'sky', h => `linear-gradient(hsl(${h},70%,80%), hsl(${(h + 60) % 360},90%,90%))`);
}
function setLook(key, h) {
  Save.data.look[key] = ((Math.round(h) % 360) + 360) % 360;
  if (key === 'ball' && p) p.hue = Save.data.look.ball; // 메뉴 뒤 데모 공에 바로 반영
  Save.save();
  renderCustom();
}

function refreshMenu() {
  $('menuBest').textContent = fmtKR(Save.data.best);
  $('menuCoins').textContent = fmtComma(Save.data.coins);
  const def = skillDef(Save.data.equipped);
  $('menuSkill').textContent = def ? `${def.icon} ${def.name}` : '없음';
  $('btnMute').textContent = Save.data.muted ? '🔇 소리 꺼짐' : '🔊 소리 켜짐';
}

function updateSkillButton() {
  const btn = $('skillBtn');
  if (!skill) { btn.classList.add('hidden'); return; }
  btn.classList.remove('hidden');
  $('skillIcon').textContent = skill.def.icon;
  btn.style.background = `radial-gradient(circle at 35% 30%, #ffffffaa, ${skill.def.color} 55%, #200030)`;
}

let lastReady = null;
function tickSkillButton() {
  if (!skill) return;
  const total = skill.stats.cooldown + skill.stats.duration;
  $('skillCd').style.setProperty('--cd', (skill.cd / total).toFixed(3));
  const ready = skill.cd <= 0 && mode === 'play';
  if (ready !== lastReady) { $('skillBtn').classList.toggle('ready', ready); lastReady = ready; }
}

function renderShop() {
  $('shopCoins').textContent = fmtComma(Save.data.coins);
  const list = $('shopList');
  list.innerHTML = '';
  for (const def of SKILLS) {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.setProperty('--c', def.color || '#888');
    if (def.placeholder) {
      card.classList.add('locked');
      card.innerHTML = `<div class="card-icon">${def.icon}</div><div class="card-body"><div class="card-title">${def.name}<small>${def.kr}</small></div><div class="card-desc">새로운 스킬이 곧 추가됩니다.</div><div class="card-stats">COMING SOON</div></div>`;
      list.appendChild(card);
      continue;
    }
    const owned = !!Save.data.owned[def.id];
    const equipped = Save.data.equipped === def.id;
    const lv = Save.level(def.id);
    if (equipped) card.classList.add('equipped');
    let html = `<div class="card-icon">${def.icon}</div><div class="card-body">
      <div class="card-title">${def.name}<small>${def.kr}</small></div>
      <div class="card-desc">${def.desc}</div>
      <div class="card-stats">${def.statText(lv)}</div>`;
    if (owned && def.upgrades) {
      for (const [key, u] of Object.entries(def.upgrades)) {
        const cur = lv[key] || 1, isMax = cur >= u.max, cost = isMax ? 0 : u.cost[cur];
        let pips = '';
        for (let i = 1; i <= u.max; i++) pips += `<i class="${i <= cur ? 'on' : ''}"></i>`;
        html += `<div class="upg"><span class="lbl">${u.label}</span><span class="pips">${pips}</span>
          <button data-up="${key}" ${isMax || Save.data.coins < cost ? 'disabled' : ''}>${isMax ? 'MAX' : '강화 🪙 ' + fmtComma(cost)}</button></div>`;
      }
    }
    const actionText = !owned ? `구매 🪙 ${fmtComma(def.price)}` : equipped ? '장착됨 ✓ (E)' : '장착하기';
    html += `<button class="card-action" ${equipped ? 'disabled' : ''}>${actionText}</button></div>`;
    card.innerHTML = html;
    card.querySelectorAll('[data-up]').forEach(b => {
      b.onclick = () => {
        const key = b.dataset.up, cur = lv[key] || 1, cost = def.upgrades[key].cost[cur];
        if (Save.spend(cost)) { lv[key] = cur + 1; Save.save(); Sfx.ui(); renderShop(); } else Sfx.deny();
      };
    });
    card.querySelector('.card-action').onclick = () => {
      if (!owned) {
        if (!Save.spend(def.price)) { Sfx.deny(); return; }
        Save.data.owned[def.id] = true;
      }
      Save.data.equipped = def.id;
      Save.save(); Sfx.ui(); renderShop();
    };
    list.appendChild(card);
  }
}

function startGame() {
  show(null);
  newRun(false);
  $('hud').classList.remove('hidden');
}
function goMenu() {
  newRun(true);
  $('hud').classList.add('hidden');
  refreshMenu();
  show('menu');
  Sfx.silenceWind();
}
function pauseGame() {
  if (mode !== 'play') return;
  mode = 'pause';
  holdPointers.clear(); keyHold = false;
  Sfx.silenceWind();
  Save.save();
  show('pause');
}
function resumeGame() {
  if (mode !== 'pause') return;
  show(null);
  mode = 'play';
}
function showGameOver() {
  goShown = true;
  $('hud').classList.add('hidden');
  $('overScore').textContent = fmtComma(st.score);
  $('overKr').textContent = st.score >= 1e4 ? fmtKR(st.score) + '점' : '';
  $('newBest').classList.toggle('hidden', !st.newBest);
  $('overDist').textContent = fmtComma(st.dist) + 'm';
  $('overSpeed').textContent = Math.round(st.maxSpeed * KMH) + 'km/h';
  $('overPerfect').textContent = st.perfects;
  $('overKills').textContent = st.kills;
  $('overMult').textContent = 'x' + (st.maxMult < 100 ? st.maxMult.toFixed(1) : fmtComma(st.maxMult));
  $('overCoins').textContent = '🪙 +' + st.coins;
  $('overBest').textContent = fmtKR(Save.data.best);
  show('gameover');
}

$('btnPlay').onclick = () => { Sfx.init(); Sfx.ui(); startGame(); };
$('btnSkills').onclick = () => { Sfx.init(); Sfx.ui(); renderShop(); show('shop'); };
$('btnShopBack').onclick = () => { Sfx.ui(); refreshMenu(); show('menu'); };
$('btnCustom').onclick = () => { Sfx.init(); Sfx.ui(); renderCustom(); show('custom'); };
$('btnCustomBack').onclick = () => { Sfx.ui(); show('menu'); };
$('btnCustomReset').onclick = () => { Sfx.ui(); setLook('ball', LOOK_DEFAULT.ball); setLook('sky', LOOK_DEFAULT.sky); };
$('ballHue').oninput = e => setLook('ball', +e.target.value);
$('skyHue').oninput = e => setLook('sky', +e.target.value);
$('btnRetry').onclick = () => { Sfx.init(); Sfx.ui(); startGame(); };
$('btnMenu').onclick = () => { Sfx.ui(); goMenu(); };
$('btnResume').onclick = () => { Sfx.ui(); resumeGame(); };
$('btnQuit').onclick = () => { Sfx.ui(); commitRun(); goMenu(); };
$('btnMute').onclick = () => {
  Sfx.init();
  Save.data.muted = !Save.data.muted;
  Sfx.setMuted(Save.data.muted);
  Save.save(); refreshMenu();
};
$('pauseBtn').addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); pauseGame(); });
$('skillBtn').addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); Sfx.init(); useSkill(); });

// ---------- input ----------
canvas.addEventListener('pointerdown', e => {
  e.preventDefault();
  Sfx.init();
  if (mode === 'play') holdPointers.add(e.pointerId);
});
const release = e => holdPointers.delete(e.pointerId);
window.addEventListener('pointerup', release);
window.addEventListener('pointercancel', release);
window.addEventListener('blur', () => { holdPointers.clear(); keyHold = false; cheatKeys.clear(); });
canvas.addEventListener('contextmenu', e => e.preventDefault());
// 치트: ` + 1 동시 입력 → 스킬 쿨타임 0 토글 (어느 키를 먼저 눌러도 됨, 저장 안 됨)
const cheatKeys = new Set();
function toggleNoCooldown() {
  cheatNoCd = !cheatNoCd;
  if (cheatNoCd && skill) skill.cd = 0;
  Sfx.init(); Sfx.ui();
  if (p) pop(cheatNoCd ? 'CHEAT · 쿨타임 0 ON' : 'CHEAT · 쿨타임 OFF', cheatNoCd ? '#b6ff2b' : '#ffffff', 28, true);
}
window.addEventListener('keydown', e => {
  if (e.code === 'Backquote' || e.code === 'Digit1') {
    if (!e.repeat) {
      cheatKeys.add(e.code);
      if (cheatKeys.has('Backquote') && cheatKeys.has('Digit1')) toggleNoCooldown();
    }
    return;
  }
  if (e.code === 'Space') {
    e.preventDefault();
    if (mode === 'play') keyHold = true;
    else if (!$('menu').classList.contains('hidden') || !$('gameover').classList.contains('hidden')) { if (!e.repeat) { Sfx.init(); startGame(); } }
  } else if (e.code === 'KeyE') {
    if (!e.repeat) useSkill();
  } else if (e.code === 'Escape' || e.code === 'KeyP') {
    if (mode === 'play') pauseGame(); else if (mode === 'pause') resumeGame();
  } else if (e.code === 'Enter') {
    if (!$('menu').classList.contains('hidden') || !$('gameover').classList.contains('hidden')) { Sfx.init(); startGame(); }
  }
});
window.addEventListener('keyup', e => { if (e.code === 'Space') keyHold = false; cheatKeys.delete(e.code); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (mode === 'play') pauseGame(); Save.save(); }
});
window.addEventListener('beforeunload', () => Save.save());

// =====================================================================
//  Main loop
// =====================================================================
function tick(rdt) {
  time += rdt;
  let dt = rdt;
  if (mode === 'pause') dt = 0;
  if (hitstop > 0) { hitstop -= rdt; dt = 0; }
  if (slowT > 0) { slowT -= rdt; dt *= slowScale; }
  if ((mode === 'play' || mode === 'demo') && dt > 0) step(dt);
  const fxDt = mode === 'dead' ? rdt * 0.4 : dt;
  updateFX(fxDt, mode === 'pause' ? 0 : rdt);
  if (mode !== 'pause') updateCamera(rdt);
  if (mode === 'dead') { deathT += rdt; if (deathT > 1.4 && !goShown) showGameOver(); }
  saveT -= rdt;
  if (Save.dirty && saveT <= 0) { Save.save(); saveT = 1; }
  tickSkillButton();
}

let last = performance.now();
function frame(now) {
  let rdt = (now - last) / 1000;
  last = now;
  if (!(rdt > 0)) rdt = 0;
  if (rdt > 0.05) rdt = 0.05;
  tick(rdt);
  render(rdt);
  requestAnimationFrame(frame);
}

Save.load();
Sfx.setMuted(Save.data.muted);
goMenu();
requestAnimationFrame(frame);

// 디버그/확장용
window.MochiRush = {
  get state() { return { mode, p, st, skill, pred, world }; },
  useSkill,
  hold(v) { keyHold = v; },
  sim(sec, fn) { for (let i = 0; i < sec * 60; i++) { if (fn) fn(); tick(1 / 60); } render(1 / 60); },
};
})();
