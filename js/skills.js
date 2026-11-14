// 스킬 목록. 새 스킬은 이 배열에 객체 하나를 추가하면 상점/로드아웃/E키에 자동으로 연결된다.
//
// 스킬 객체 형식:
//   id, name, kr, icon, color, price(구매가, 0이면 기본 보유), desc
//   upgrades: { key: { label, max, cost:[_, Lv1→2, Lv2→3, ...] } }
//   stats(lv)        → 레벨에 따른 수치 (반드시 duration, cooldown 포함)
//   statText(lv)     → 상점에 표시할 요약
//   activate(g, s)   → 발동 순간 1회
//   update(g, s, dt) → 지속시간 동안 매 프레임
//   end(g, s)        → 종료 시 (선택)
//   passive(g, s, dt)→ 판 내내 매 프레임 (선택, 성장형 스킬용)
//   badge(s)         → HUD에 띄울 상태 문구 (선택)
//   badgeHue         → 배지 색상 hue (선택, 기본 350 = 빨강)
//   onSmash(g, s, e) → 적 격파 시 호출, 점수 배율을 반환 (선택, e.sky = 하늘길 위 적)
//
// g 는 game.js 의 스킬 API (addSpeed, addThrust, setInvincible, setNoDrag, skyway, fx ...)
const SKILLS = [
  {
    id: 'nitro',
    name: 'NITRO BURST',
    kr: '급가속',
    icon: '🚀',
    color: '#ff2bd6',
    price: 0,
    desc: '폭발적인 급가속! 발동 중에는 속도와 상관없이 모든 적을 뚫고 지나간다.',
    upgrades: {
      power: { label: '출력', max: 5, cost: [0, 60, 160, 380, 800] },
      cooldown: { label: '쿨타임', max: 5, cost: [0, 50, 140, 320, 700] },
    },
    stats(lv) {
      const P = lv.power || 1, C = lv.cooldown || 1;
      return {
        duration: 0.9 + 0.15 * (P - 1),
        impulse: 750 + 140 * (P - 1),
        accel: 4400 + 700 * (P - 1),
        cooldown: Math.max(3.5, 9 - 1.25 * (C - 1)),
      };
    },
    statText(lv) {
      const s = this.stats(lv);
      return `가속 +${Math.round(s.impulse * 0.12)}km/h · 지속 ${s.duration.toFixed(2)}초 · 쿨타임 ${s.cooldown.toFixed(1)}초`;
    },
    activate(g, s) {
      g.addSpeed(s.impulse);
      g.fx.nitroStart();
    },
    update(g, s, dt) {
      g.addThrust(s.accel);
      g.setInvincible();
      g.setNoDrag();
      g.fx.nitroTick(dt);
    },
  },

  {
    id: 'goldrush',
    name: 'GOLD RUSH',
    kr: '황금 질주',
    icon: '💰',
    color: '#ffc21a',
    price: 250,
    desc: '7초 동안 세상이 황금빛으로! 앞길에 진짜 코인이 비처럼 쏟아지고(자석 범위 확대), 코인도 계속 들어온다. 속도도 살짝 오른다.',
    upgrades: {
      income: { label: '수익', max: 5, cost: [0, 120, 300, 600, 1200] },
      cooldown: { label: '쿨타임', max: 5, cost: [0, 100, 250, 500, 1000] },
    },
    stats(lv) {
      const I = lv.income || 1, C = lv.cooldown || 1;
      return {
        duration: 7,
        coinsPerSec: 1.5 + 0.5 * (I - 1),   // 자동 지급: 1회 약 10 ~ 24코인
        dropsPerSec: 4 + 1 * (I - 1),       // 맵에 떨어지는 코인: 1회 약 28 ~ 56개
        impulse: 260,
        accel: 650,
        cooldown: 26 - 3 * (C - 1),
      };
    },
    statText(lv) {
      const s = this.stats(lv);
      return `7초간 자동 코인 ${Math.round(s.coinsPerSec * s.duration)}개 + 맵에 코인 ${Math.round(s.dropsPerSec * s.duration)}개 · 쿨타임 ${s.cooldown}초`;
    },
    activate(g, s) {
      s.acc = 0;
      s.dropAcc = 0;
      g.addSpeed(s.impulse);
      g.fx.goldStart();
    },
    update(g, s, dt) {
      g.addThrust(s.accel);
      g.setGold();
      s.acc += s.coinsPerSec * dt;
      while (s.acc >= 1) { s.acc -= 1; g.giveCoins(1); }
      s.dropAcc += s.dropsPerSec * dt;
      while (s.dropAcc >= 1) { s.dropAcc -= 1; g.dropCoin(); }
      g.fx.goldTick(dt);
    },
  },

  {
    id: 'overdrive',
    name: 'OVERDRIVE',
    kr: '폭주',
    icon: '🔥',
    color: '#ff3b5c',
    price: 400,
    desc: '쓸 때마다 폭주 스택 +1 (이번 판 동안 유지). 스택이 쌓일수록 기본 속도가 점점 더 빨라지지만, 적을 박살 낼 수 있는 최소 속도도 함께 치솟는다. 모 아니면 도!',
    upgrades: {
      amp: { label: '증폭', max: 5, cost: [0, 150, 350, 700, 1400] },
      cooldown: { label: '쿨타임', max: 5, cost: [0, 120, 300, 600, 1200] },
    },
    stats(lv) {
      const A = lv.amp || 1, C = lv.cooldown || 1;
      return { duration: 0.6, cooldown: 8 - 0.75 * (C - 1), amp: 1 + 0.15 * (A - 1), stacks: 0 };
    },
    // n 스택일 때의 효과. 스택이 오를수록 한 칸당 상승폭도 커진다 (제곱항)
    effect(n, s) {
      const thrust = 1 + (0.12 * n + 0.02 * n * n) * s.amp;
      const drag = 1 / (1 + 0.1 * n * s.amp);
      const limitKm = Math.round(8 * n + 2 * n * n);
      const speedPct = Math.round((Math.sqrt(thrust / drag) - 1) * 100);
      return { thrust, drag, limitKm, speedPct };
    },
    statText(lv) {
      const s = this.stats(lv), e1 = this.effect(1, s), e5 = this.effect(5, s);
      return `1스택: 속도 +${e1.speedPct}% · 기준 +${e1.limitKm}km/h → 5스택: 속도 +${e5.speedPct}% · 기준 +${e5.limitKm}km/h · 쿨타임 ${s.cooldown}초`;
    },
    activate(g, s) {
      s.stacks++;
      const e = this.effect(s.stacks, s);
      g.mods.thrust = e.thrust;
      g.mods.drag = e.drag;
      g.mods.limitKm = e.limitKm;
      g.mods.orbs = s.stacks;
      g.addSpeed(150 + 40 * s.stacks);
      g.fx.overdrive(s.stacks, e);
    },
    update() {},
    passive(g, s, dt) { if (s.stacks) g.fx.overdriveTick(s.stacks, dt); },
    badge(s) { return s.stacks ? `🔥 OVERDRIVE x${s.stacks}` : null; },
  },

  {
    id: 'skyway',
    name: 'SKYWAY',
    kr: '하늘길',
    icon: '🌈',
    color: '#4fe8ff',
    price: 600,
    desc: '높이 튕겨 올라 완전 수평의 하늘길을 달린다! 길 위엔 적이 쫙 깔려 있고, 끊김 없이 부술수록 콤보 점수가 폭발한다. 속도 버프와 부스터 발판이 있지만 LIMIT 미만으로 부딪히면 끝. 끝에선 떨어지며 PERFECT 착지를 노려라.',
    upgrades: {
      length: { label: '길이', max: 5, cost: [0, 180, 420, 850, 1700] },
      cooldown: { label: '쿨타임', max: 5, cost: [0, 150, 360, 720, 1450] },
    },
    stats(lv) {
      const L = lv.length || 1, C = lv.cooldown || 1;
      return {
        duration: 6 + 0.75 * (L - 1),        // 6 ~ 9초
        cooldown: 22 - 2.5 * (C - 1),        // 22 ~ 12초
        gap: 230 - 10 * (L - 1),             // 적 간격(px): 길이 강화 시 더 촘촘
        padEvery: 1300,                      // 부스터 발판 간격(px)
        padBoost: 500,                       // 부스터 발판 1개당 가속 (일반 발판 800)
        accel: 900,                          // 하늘길 위 추진력 버프
        comboStep: 0.5,                      // 연속 격파 1마리당 +0.5배
        comboMax: 10,                        // 콤보 배율 상한
        comboWindow: 1.2,                    // 이 시간 안에 다음 적을 부숴야 콤보 유지
      };
    },
    statText(lv) {
      const s = this.stats(lv);
      return `지속 ${+s.duration.toFixed(2)}초 · 적 간격 ${s.gap}px · 콤보 최대 x${s.comboMax} · 쿨타임 ${+s.cooldown.toFixed(1)}초`;
    },
    activate(g, s) {
      s.combo = 0; s.comboT = 0; s.best = 0;
      g.skyway.open(s);
      g.fx.skywayStart(s);
    },
    update(g, s, dt) {
      if (g.skyway.riding) g.addThrust(s.accel);
      if (s.combo && (s.comboT -= dt) <= 0) s.combo = 0;
      g.fx.skywayTick(dt);
    },
    end(g, s) {
      g.skyway.close();
      g.fx.skyCombo(s.best);
      s.combo = 0; s.best = 0;
    },
    // 하늘길 위 적 격파 → 콤보 배율 반환
    onSmash(g, s, e) {
      if (!e.sky) return 1;
      s.combo++; s.comboT = s.comboWindow;
      s.best = Math.max(s.best, s.combo);
      return Math.min(s.comboMax, 1 + s.comboStep * (s.combo - 1));
    },
    badgeHue: 190,
    badge(s) { return s.combo > 1 ? `🌈 SKY COMBO x${s.combo}` : null; },
  },
];

function skillDef(id) {
  return SKILLS.find(s => s.id === id && !s.placeholder) || null;
}
