// Web Audio 합성 효과음 (외부 파일 없음)
const Sfx = (() => {
  let ctx = null, master = null, out = null, windG = null, windF = null, noiseBuf = null;
  let muted = false;
  const VOL = 0.55;

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : VOL;
    master.connect(ctx.destination);
    out = ctx.createDynamicsCompressor();
    out.connect(master);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // 속도에 따라 커지는 바람 소리
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    windF = ctx.createBiquadFilter(); windF.type = 'bandpass'; windF.frequency.value = 300; windF.Q.value = 0.7;
    windG = ctx.createGain(); windG.gain.value = 0;
    src.connect(windF); windF.connect(windG); windG.connect(out);
    src.start();
  }

  function tone(f, dur, type = 'sine', vol = 0.2, f2 = null, delay = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function noise(dur, vol = 0.3, freq = 1000, type = 'lowpass', freq2 = null, delay = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t);
    if (freq2) f.frequency.exponentialRampToValueAtTime(freq2, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(out);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  return {
    init,
    get muted() { return muted; },
    setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : VOL; },
    wind(s) {
      if (!ctx) return;
      const t = ctx.currentTime;
      windF.frequency.setTargetAtTime(220 + s * 2400, t, 0.08);
      windG.gain.setTargetAtTime(Math.min(0.34, s * s * 0.26), t, 0.08);
    },
    silenceWind() { if (ctx) windG.gain.setTargetAtTime(0, ctx.currentTime, 0.1); },
    coin(chain) {
      const f = 880 * Math.pow(2, (chain % 15) / 12);
      tone(f, 0.08, 'square', 0.05);
      tone(f * 1.5, 0.12, 'sine', 0.06, null, 0.035);
    },
    overdrive(n) {
      const f = 110 * Math.pow(2, Math.min(n, 12) / 12);
      tone(f, 0.6, 'sawtooth', 0.16, f * 4);
      tone(f * 1.5, 0.5, 'square', 0.06, f * 6, 0.05);
      noise(0.6, 0.35, 200, 'lowpass', 3000);
      tone(45, 0.5, 'sine', 0.35, 30);
    },
    goldStart() {
      [0, 4, 7, 11, 12, 16, 19, 24].forEach((s, i) => tone(784 * Math.pow(2, s / 12), 0.22, 'triangle', 0.08, null, i * 0.04));
      noise(0.8, 0.18, 6000, 'highpass');
      tone(98, 0.5, 'sine', 0.25, 60);
    },
    // SKYWAY: 솟구치는 아르페지오 + 바람
    skyStart() {
      [0, 5, 9, 12, 17, 21, 24].forEach((s, i) => tone(523 * Math.pow(2, s / 12), 0.2, 'triangle', 0.08, null, i * 0.035));
      noise(0.6, 0.3, 400, 'bandpass', 4000);
      tone(160, 0.5, 'sine', 0.2, 640);
    },
    // 유리 발판에 착지: 맑은 종소리 + 쿵
    skyLand() {
      [0, 7, 12, 19].forEach((s, i) => tone(1046 * Math.pow(2, s / 12), 0.35, 'sine', 0.07, null, i * 0.02));
      tone(80, 0.25, 'sine', 0.3, 45);
      noise(0.12, 0.2, 3000, 'highpass');
    },
    // 하늘길이 끊기며 부서짐
    skyEnd() {
      noise(0.5, 0.22, 6000, 'highpass', 1500);
      [12, 7, 3, 0].forEach((s, i) => tone(1318 * Math.pow(2, s / 12), 0.12, 'triangle', 0.05, null, i * 0.05));
    },
    skyCombo(n) {
      const base = 659 * Math.pow(2, Math.min(n, 24) / 24);
      [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => tone(base * Math.pow(2, s / 12), 0.22, 'square', 0.06, null, i * 0.04));
      tone(98, 0.4, 'sine', 0.3, 50);
    },
    gem() { [0, 4, 7, 12].forEach((s, i) => tone(1046 * Math.pow(2, s / 12), 0.12, 'square', 0.05, null, i * 0.03)); },
    perfect(streak) {
      const base = 523 * Math.pow(2, Math.min(streak, 9) / 12);
      [0, 4, 7, 12, 16].forEach((s, i) => tone(base * Math.pow(2, s / 12), 0.3, 'triangle', 0.13, null, i * 0.045));
      noise(0.45, 0.22, 2500, 'highpass');
      tone(70, 0.3, 'sine', 0.35, 40);
    },
    great() { [0, 7].forEach((s, i) => tone(660 * Math.pow(2, s / 12), 0.18, 'triangle', 0.1, null, i * 0.05)); },
    land(a) { noise(0.14, Math.min(0.35, a), 280); tone(95, 0.16, 'sine', Math.min(0.3, a), 45); },
    smash() { noise(0.35, 0.5, 2200, 'lowpass', 200); tone(180, 0.28, 'sawtooth', 0.16, 40); tone(1400, 0.1, 'square', 0.05, 600); },
    boost() { noise(0.9, 0.38, 300, 'bandpass', 5000); tone(110, 0.75, 'sawtooth', 0.13, 880); tone(55, 0.5, 'sine', 0.3, 30); },
    pad(type) {
      if (type === 'jump') { tone(200, 0.35, 'square', 0.1, 1200); }
      else if (type === 'speed') { noise(0.4, 0.3, 500, 'bandpass', 4000); tone(300, 0.3, 'sawtooth', 0.08, 1200); }
      else { tone(500, 0.6, 'sine', 0.12, 150); tone(750, 0.6, 'sine', 0.08, 220, 0.05); }
    },
    ring() { tone(1200, 0.16, 'sine', 0.12, 2000); tone(1800, 0.2, 'triangle', 0.06, null, 0.05); },
    fever() { [0, 3, 7, 10, 12, 15, 19, 24].forEach((s, i) => tone(392 * Math.pow(2, s / 12), 0.16, 'square', 0.07, null, i * 0.05)); },
    milestone() { [0, 7, 12].forEach((s, i) => tone(784 * Math.pow(2, s / 12), 0.2, 'triangle', 0.1, null, i * 0.06)); },
    boom() { noise(0.5, 0.35, 900, 'lowpass', 120); tone(60, 0.4, 'sine', 0.3, 30); },
    death() { tone(420, 0.9, 'sawtooth', 0.18, 40); noise(0.7, 0.45, 900, 'lowpass', 90); },
    ui() { tone(700, 0.06, 'square', 0.05); tone(1050, 0.08, 'square', 0.04, null, 0.04); },
    deny() { tone(180, 0.15, 'square', 0.07, 120); },
  };
})();
