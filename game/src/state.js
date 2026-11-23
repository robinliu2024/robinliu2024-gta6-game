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
    // Crew (crew.js, v3): recruited member ids + per-member health.
    // Persisted in the save; meshes are rebuilt by CrewManager.
    crew: { recruited: [], health: {} },
    // Territory (territory.js, v3): owned zone ids + cop downs per zone
    // toward a free capture + total turf income earned. Persisted.
    // defense (v4): null, or the live attack snapshot { zoneId,
    // attackersLeft, timeLeft } — a save made mid-fight restores it.
    territory: {
      owned: [], copDowns: { harbor: 0, downtown: 0, suburbs: 0 }, totalEarned: 0,
      defense: null,
    },
    // Bulletproof vest (shop.js, v3): bought once, -25% damage taken.
    // Persisted in the save.
    vest: false,
    // Weapon system (combat.js): current weapon + mag/reserve ammo per tier
    // + which weapons are owned (pistol is Rico's; shotgun / rifle / SMG
    // are bought at Solmar Arms) + shop-bought attachments per weapon
    // (mag: +50% mag, scope: tighter spread). Persisted since v3 — older
    // saves without an `owned` block keep the first three (see applySave).
    weapons: {
      current: 'pistol',
      owned: { pistol: true, shotgun: false, rifle: false, smg: false },
      ammo: {
        pistol: { mag: 12, reserve: 48 },
        shotgun: { mag: 6, reserve: 24 },
        rifle: { mag: 30, reserve: 90 },
        smg: { mag: 32, reserve: 96 },
      },
      attachments: { mag: {}, scope: {} },
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
  // Armor plating (garage.js) absorbs 10% of damage per level, up to 30%;
  // a bought bulletproof vest (shop.js) absorbs a further 25%.
  const armor = (state.garage && state.garage.armor) || 0;
  const vest = state.vest ? 0.25 : 0;
  state.health = Math.max(0, state.health - amount * (1 - 0.10 * armor) * (1 - vest));
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
    crew: {
      recruited: [...((state.crew && state.crew.recruited) || [])],
      health: { ...((state.crew && state.crew.health) || {}) },
    },
    // Territory (territory.js, v3): older saves own nothing.
    // defense (v4): older saves were never attacked — null.
    territory: {
      owned: [...((state.territory && state.territory.owned) || [])],
      copDowns: { harbor: 0, downtown: 0, suburbs: 0, ...((state.territory && state.territory.copDowns) || {}) },
      totalEarned: (state.territory && state.territory.totalEarned) || 0,
      defense: (() => {
        const d = state.territory && state.territory.defense;
        if (!d || typeof d !== 'object' || !d.zoneId) return null;
        return {
          zoneId: d.zoneId,
          attackersLeft: typeof d.attackersLeft === 'number' ? d.attackersLeft : 0,
          timeLeft: typeof d.timeLeft === 'number' ? Math.max(0, Math.ceil(d.timeLeft)) : 0,
        };
      })(),
    },
    vest: !!state.vest,
    // Weapons (combat.js / shop.js, v3): current + ammo + ownership +
    // attachments (extended mag / scope, per weapon).
    weapons: {
      current: (state.weapons && state.weapons.current) || 'pistol',
      owned: { ...((state.weapons && state.weapons.owned) || {}) },
      ammo: JSON.parse(JSON.stringify((state.weapons && state.weapons.ammo) || {})),
      attachments: JSON.parse(JSON.stringify(
        (state.weapons && state.weapons.attachments) || { mag: {}, scope: {} },
      )),
    },
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
  // Older saves have no crew block; default to nobody recruited.
  state.crew = {
    recruited: Array.isArray(data.crew && data.crew.recruited) ? [...data.crew.recruited] : [],
    health: { ...((data.crew && data.crew.health) || {}) },
  };
  // Older saves have no territory block; default to nothing owned.
  // Older saves also have no defense snapshot — null, never attacked.
  const savedDefense = (data.territory && data.territory.defense) || null;
  state.territory = {
    owned: Array.isArray(data.territory && data.territory.owned) ? [...data.territory.owned] : [],
    copDowns: {
      harbor: 0, downtown: 0, suburbs: 0,
      ...((data.territory && data.territory.copDowns) || {}),
    },
    totalEarned: (data.territory && data.territory.totalEarned) || 0,
    defense: (savedDefense && typeof savedDefense === 'object' && savedDefense.zoneId)
      ? {
        zoneId: savedDefense.zoneId,
        attackersLeft: typeof savedDefense.attackersLeft === 'number' ? savedDefense.attackersLeft : 0,
        timeLeft: typeof savedDefense.timeLeft === 'number' ? Math.max(0, savedDefense.timeLeft) : 0,
      }
      : null,
  };
  // Older saves have no vest; default to unprotected.
  state.vest = !!data.vest;
  // Older saves have no weapons block (pre-v3 saves were runtime-only);
  // those runs keep the first three weapons (the SMG is new in v3, so it
  // stays locked). New saves restore ownership + attachments.
  const savedWeapons = data.weapons || {};
  const owned = savedWeapons.owned;
  const savedAttachments = savedWeapons.attachments || {};
  state.weapons = {
    current: savedWeapons.current || 'pistol',
    owned: owned
      ? { pistol: true, shotgun: false, rifle: false, smg: false, ...owned }
      : { pistol: true, shotgun: true, rifle: true, smg: false },
    ammo: {
      pistol: { mag: 12, reserve: 48 },
      shotgun: { mag: 6, reserve: 24 },
      rifle: { mag: 30, reserve: 90 },
      smg: { mag: 32, reserve: 96 },
      ...(savedWeapons.ammo || {}),
    },
    attachments: {
      mag: { ...(savedAttachments.mag || {}) },
      scope: { ...(savedAttachments.scope || {}) },
    },
  };
  return true;
}

export function hasSave() {
  return loadSave() !== null;
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* storage unavailable */ }
}
