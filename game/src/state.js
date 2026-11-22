// Solmar Heat — game state: money, reputation, debt, wanted level, health,
// mission progress, and the localStorage save/continue shape.

import {
  STARTING_DEBT, STARTING_MONEY, STARTING_REP, PLAYER_HEALTH,
  MAX_WANTED, SAVE_KEY, MISSIONS,
} from './config.js';

export function createInitialState() {
  return {
    money: STARTING_MONEY,
    rep: STARTING_REP,
    debt: STARTING_DEBT,
    wanted: 0,
    health: PLAYER_HEALTH,
    maxHealth: PLAYER_HEALTH,
    missionId: MISSIONS[0].id,
    missionObjectiveIndex: 0,
    completedMissions: [],
    failedMissions: 0,
    kills: 0,
    carsStolen: 0,
    distanceDriven: 0,
    playSeconds: 0,
    // Garage upgrades (garage.js): levels 0..3 per track + paint id.
    // Persisted in the save; runtime-only refs below are never saved.
    garage: { speed: 0, accel: 0, armor: 0, paint: 'teal' },
    // Weapon system (combat.js): current weapon + mag/reserve ammo per tier.
    // Runtime-only, not saved — a fresh run starts with a full loadout.
    weapons: {
      current: 'pistol',
      ammo: {
        pistol: { mag: 12, reserve: 48 },
        shotgun: { mag: 6, reserve: 24 },
        rifle: { mag: 30, reserve: 90 },
      },
    },
    // Runtime-only refs (never saved): filled in by main.js / gameplay parts.
    player: null,   // { position, heading, onFoot, vehicle }
    car: null,      // currently driven vehicle, if any
    paused: false,
    gameOver: false,
    won: false,
    started: false,
    muted: false,
    lowQuality: false,
    seed: 1,
    shot: null,
  };
}

// The single mutable game state. Parts B/C mutate fields on this object.
export const state = createInitialState();

export function resetState() {
  const fresh = createInitialState();
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, fresh);
}

export function addMoney(amount) {
  state.money = Math.max(0, state.money + amount);
  return state.money;
}

export function payDebt(amount) {
  const paid = Math.min(amount, state.debt);
  state.debt = Math.max(0, state.debt - paid);
  if (state.debt === 0) state.won = true;
  return paid;
}

export function addRep(amount) {
  state.rep = Math.max(0, state.rep + amount);
  return state.rep;
}

export function setWanted(level) {
  state.wanted = Math.max(0, Math.min(MAX_WANTED, Math.round(level)));
  return state.wanted;
}

export function damagePlayer(amount) {
  // Armor plating (garage.js) absorbs 10% of damage per level, up to 30%.
  const armor = (state.garage && state.garage.armor) || 0;
  state.health = Math.max(0, state.health - amount * (1 - 0.10 * armor));
  if (state.health === 0) state.gameOver = true;
  return state.health;
}

export function healPlayer(amount) {
  state.health = Math.min(state.maxHealth, state.health + amount);
  return state.health;
}

export function completeMission(mission) {
  if (!state.completedMissions.includes(mission.id)) {
    state.completedMissions.push(mission.id);
  }
  addMoney(mission.reward);
  addRep(mission.rep);
  payDebt(mission.debtPaid);
  state.missionObjectiveIndex = 0;
  const next = MISSIONS.find((m) => !state.completedMissions.includes(m.id));
  state.missionId = next ? next.id : null;
  return state.missionId;
}

export function currentMission() {
  if (!state.missionId) return null;
  return MISSIONS.find((m) => m.id === state.missionId) || null;
}

export function currentObjective() {
  const mission = currentMission();
  if (!mission) return null;
  return mission.objectives[state.missionObjectiveIndex] || null;
}

export function advanceObjective() {
  const mission = currentMission();
  if (!mission) return null;
  state.missionObjectiveIndex += 1;
  if (state.missionObjectiveIndex >= mission.objectives.length) {
    return completeMission(mission);
  }
  return mission.id;
}

// --- Save / load (localStorage). Only plain data is persisted. ---
export function saveShape() {
  return {
    version: 1,
    money: state.money,
    rep: state.rep,
    debt: state.debt,
    wanted: 0,
    health: state.health,
    missionId: state.missionId,
    missionObjectiveIndex: state.missionObjectiveIndex,
    completedMissions: [...state.completedMissions],
    kills: state.kills,
    carsStolen: state.carsStolen,
    garage: { ...(state.garage || { speed: 0, accel: 0, armor: 0, paint: 'teal' }) },
    distanceDriven: Math.round(state.distanceDriven),
    playSeconds: Math.round(state.playSeconds),
    savedAt: Date.now(),
  };
}

export function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(saveShape()));
    return true;
  } catch {
    return false;
  }
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.version !== 1) return null;
    return data;
  } catch {
    return null;
  }
}

export function applySave(data) {
  if (!data) return false;
  resetState();
  state.money = data.money ?? STARTING_MONEY;
  state.rep = data.rep ?? STARTING_REP;
  state.debt = data.debt ?? STARTING_DEBT;
  state.health = data.health ?? PLAYER_HEALTH;
  state.missionId = data.missionId ?? MISSIONS[0].id;
  state.missionObjectiveIndex = data.missionObjectiveIndex ?? 0;
  state.completedMissions = Array.isArray(data.completedMissions) ? data.completedMissions : [];
  state.kills = data.kills ?? 0;
  state.carsStolen = data.carsStolen ?? 0;
  state.distanceDriven = data.distanceDriven ?? 0;
  state.playSeconds = data.playSeconds ?? 0;
  // Older saves have no garage block; merge over defaults.
  state.garage = {
    speed: 0, accel: 0, armor: 0, paint: 'teal',
    ...(data.garage || {}),
  };
  return true;
}

export function hasSave() {
  return loadSave() !== null;
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* storage unavailable */ }
}
