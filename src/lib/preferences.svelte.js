const DEFAULTS = { autoCompleteDone: true, timedPlanning: false, askDeadline: false, boardSort: 'recent' };

export function createPreferences(user) {
  const key = `deckv2:preferences:${user?.uid ?? user?.id ?? user}`;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(key) || '{}') ?? {}; } catch { /* Defaults when storage is unavailable. */ }
  const state = $state({ ...DEFAULTS });
  for (const name of Object.keys(DEFAULTS)) {
    if (typeof saved[name] === typeof DEFAULTS[name]) state[name] = saved[name];
  }
  function set(name, value) {
    if (!(name in DEFAULTS) || typeof value !== typeof DEFAULTS[name]) return;
    state[name] = value;
    try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* Session options remain usable. */ }
  }
  return { state, set };
}
