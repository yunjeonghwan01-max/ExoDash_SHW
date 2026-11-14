// 로컬 저장 (코인, 최고점수, 보유/장착 스킬, 스킬 레벨)
const Save = (() => {
  const KEY = 'mochiRush.save.v1';

  function defaults() {
    return {
      coins: 0,
      totalCoins: 0,
      best: 0,
      owned: { nitro: true },
      equipped: 'nitro',
      levels: { nitro: { power: 1, cooldown: 1 } },
      muted: false,
      look: { ball: 322, sky: 250 }, // 꾸미기: 구체 색 hue, 배경 핵심 색 hue
    };
  }

  const api = {
    data: defaults(),
    dirty: false,

    load() {
      try {
        const raw = localStorage.getItem(KEY);
        const d = raw ? JSON.parse(raw) : {};
        const def = defaults();
        this.data = Object.assign(def, d);
        this.data.owned = Object.assign(def.owned, d.owned || {});
        this.data.levels = Object.assign(defaults().levels, d.levels || {});
        this.data.look = Object.assign(defaults().look, d.look || {});
      } catch (e) {
        this.data = defaults();
      }
      return this.data;
    },

    save() {
      this.dirty = false;
      try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* storage blocked */ }
    },

    addCoins(n) {
      this.data.coins += n;
      this.data.totalCoins += n;
      this.dirty = true;
    },

    spend(n) {
      if (this.data.coins < n) return false;
      this.data.coins -= n;
      this.save();
      return true;
    },

    level(skillId) {
      if (!this.data.levels[skillId]) this.data.levels[skillId] = {};
      return this.data.levels[skillId];
    },
  };
  return api;
})();
