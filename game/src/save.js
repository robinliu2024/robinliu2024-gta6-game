// Solmar Heat — save wrapper: a thin layer over state.js save/load.
// Autosave timer, named save slots, Continue flow (load, then start the
// saved mission), and New Game reset. No save format of its own.

import { SAVE_KEY } from './config.js';
import {
  state, saveGame, loadSave, applySave, clearSave, resetState, hasSave,
} from './state.js';

export const AUTOSAVE_SECONDS = 15;

function slotKey(slot) {
  return slot && slot !== 'main' ? `${SAVE_KEY}:${slot}` : SAVE_KEY;
}

export function saveToSlot(slot) {
  try {
    const ok = saveGame();
    if (!ok || !slot || slot === 'main') return ok;
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) localStorage.setItem(slotKey(slot), raw);
    return true;
  } catch {
    return false;
  }
}

export function loadFromSlot(slot) {
  try {
    const raw = localStorage.getItem(slotKey(slot));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.version !== 1) return null;
    return data;
  } catch {
    return null;
  }
}

export function listSlots() {
  const slots = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(`${SAVE_KEY}:`)) slots.push(key.slice(SAVE_KEY.length + 1));
    }
  } catch { /* storage unavailable */ }
  return slots;
}

export function createSaveManager(deps = {}) {
  const getMissions = deps.getMissions || (() => null);
  let timer = 0;
  let lastSavedAt = 0;

  function saveNow(slot) {
    const ok = saveToSlot(slot);
    if (ok) lastSavedAt = Date.now();
    return ok;
  }

  // Call every frame with dt while playing; autosaves on a timer.
  function autosave(dt, playing) {
    if (!playing) return false;
    timer += dt;
    if (timer >= AUTOSAVE_SECONDS) {
      timer = 0;
      return saveNow();
    }
    return false;
  }

  // Continue flow: load the save, then start whichever mission it was on.
  function continueGame() {
    const save = loadSave();
    if (!save) return false;
    if (!applySave(save)) return false;
    const missions = getMissions();
    if (missions && state.missionId) missions.startMission(state.missionId);
    return true;
  }

  // New Game: wipe the save and the runtime state, start mission m1.
  function newGame() {
    clearSave();
    resetState();
    state.started = false;
    const missions = getMissions();
    if (missions) missions.startMission('m1');
    timer = 0;
    return true;
  }

  function wipe() {
    clearSave();
    timer = 0;
  }

  return {
    saveNow, autosave, continueGame, newGame, wipe,
    get lastSavedAt() { return lastSavedAt; },
    hasSave: () => hasSave(),
  };
}

export { saveGame, loadSave, applySave, clearSave, resetState, hasSave };
export default createSaveManager;
