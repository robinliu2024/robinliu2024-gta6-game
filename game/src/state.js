// state.js — the one shared game state every system reads and writes.
// No rendering here: just the facts of the world, so systems stay decoupled.
import { START_HEALTH, START_MONEY, SPAWN } from './config.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';

export function createGameState() {
  return {
    screen: SCREEN_TITLE,
    time: 0,               // seconds since the run started
    dayTime: 0.42,         // 0..1 across the day; 0.42 = late afternoon sun
    seed: 1,
    rng: null,

    // Player
    player: {
      x: SPAWN.x, z: SPAWN.z, heading: SPAWN.heading,
      vx: 0, vz: 0, health: START_HEALTH, money: START_MONEY, rep: 0,
      inCar: null,          // the car object the player is driving, or null
      armed: true, ammo: Infinity, shootCooldown: 0, punchCooldown: 0,
      wanted: 0, wantedHeat: 1, // heat 0..1: time left before a star drops
      crimeHeat: 0,        // fractional crimes banked toward the next star
      bustedMeter: 0, dead: false,
      speed: 0,
    },

    // World population
    cars: [],        // traffic + parked + mission cars (not police)
    policeCars: [],  // active SBPD interceptors
    peds: [],        // pedestrians (and armed rivals, flagged hostile)
    rivals: [],      // armed crew members spawned by combat steps

    // Missions & progression
    missionIndex: 0,       // index into MISSIONS; MISSIONS.length = story done
    missionStep: 0,
    missionActive: false,
    missionTarget: null,   // {x, z, radius} marker for the current step
    missionCar: null,      // the specific car a steal step wants
    combatLeft: 0,
    rivalsSpawned: false,  // the combat step's rivals are on the street
    debtPaid: 0,
    storyDone: false,
    stats: { carsStolen: 0, shotsFired: 0, pedsDown: 0, copsDodged: 0, missionsDone: 0 },

    // Feedback
    toast: '',
    toastTimer: 0,
    banner: null,          // {title, sub, timer}
    endReason: '',         // 'busted' | 'wasted'
    hurtFlash: 0,

    // Engine hooks (filled in by main.js)
    scene: null,
    camera: null,
    renderer: null,
    audio: null,
    input: null,
    effects: null,
    minimap: null,
    colliders: [],         // {minX, maxX, minZ, maxZ} building footprints
    beacon: null,          // THREE mesh for the mission marker
    shotMode: null,        // null, or 'start' | 'drive' | 'chase' | 'mission'
  };
}

export function resetRunState(G, seed) {
  G.time = 0;
  G.missionIndex = 0;
  G.missionStep = 0;
  G.missionActive = false;
  G.missionTarget = null;
  G.missionCar = null;
  G.combatLeft = 0;
  G.rivalsSpawned = false;
  G.debtPaid = 0;
  G.storyDone = false;
  G.stats = { carsStolen: 0, shotsFired: 0, pedsDown: 0, copsDodged: 0, missionsDone: 0 };
  G.endReason = '';
  G.seed = seed;
  const p = G.player;
  p.x = SPAWN.x; p.z = SPAWN.z; p.heading = SPAWN.heading;
  p.vx = 0; p.vz = 0; p.health = START_HEALTH; p.money = START_MONEY; p.rep = 0;
  p.inCar = null; p.wanted = 0; p.wantedHeat = 1; p.crimeHeat = 0; p.bustedMeter = 0; p.dead = false;
  p.shootCooldown = 0; p.punchCooldown = 0; p.speed = 0;
}
