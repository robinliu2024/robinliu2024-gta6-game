// save.js — localStorage saves: money, rep, debt paid, mission progress, health
// and where Rico was standing. A save is written after every mission and from
// the pause menu; Continue on the title screen picks it back up.
import { MISSIONS, START_HEALTH } from './config.js';

const SAVE_KEY = 'solmar-heat.save.v1';

export function saveGame(G) {
  try {
    const p = G.player;
    const data = {
      version: 1,
      money: Math.round(p.money),
      rep: p.rep,
      debtPaid: G.debtPaid,
      missionIndex: G.missionIndex,
      health: Math.round(p.health),
      x: Math.round(p.x),
      z: Math.round(p.z),
      storyDone: G.storyDone,
      stats: G.stats,
      savedAt: Date.now(),
    };
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false; // Storage off (private window): the session still plays fine.
  }
}

export function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.version !== 1) return null;
    return data;
  } catch {
    return null;
  }
}

export function applySave(G, data) {
  const p = G.player;
  p.money = data.money;
  p.rep = data.rep;
  G.debtPaid = data.debtPaid;
  G.missionIndex = Math.min(data.missionIndex, MISSIONS.length - 1);
  p.health = data.health || START_HEALTH;
  p.x = data.x;
  p.z = data.z;
  G.storyDone = !!data.storyDone;
  if (data.stats) G.stats = data.stats;
}

export function describeSave(data) {
  if (!data) return '';
  const m = MISSIONS[data.missionIndex];
  const when = new Date(data.savedAt).toLocaleDateString();
  return `$${data.money} · ${m ? m.name : 'Story done'} · ${when}`;
}

export function clearSave() {
  try { window.localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}
