// Solmar Heat — bootstrap: renderer, scene, camera, game loop.
// Part A builds the world + bootstrap only. Later parts will replace the
// free/orbit camera with a follow camera and wire in player, vehicles,
// police, missions and HUD by editing this file.

import * as THREE from 'three';
import { GAME_TITLE, hashSeed } from './config.js';
import { state, currentObjective, applySave, loadSave, saveGame, addRep } from './state.js';
import { buildCity, updateCity, spawnPoint, districtAt } from './city.js';
import { input } from './input.js';
import { Player } from './player.js';
import { VehicleManager } from './vehicles.js';
import { PedestrianManager } from './pedestrians.js';
import { PoliceManager } from './police.js';
import { MissionRunner } from './missions.js';
import { audio } from './audio.js';
import { createHud } from './hud.js';
import { Effects } from './effects.js';
import { createSaveManager } from './save.js';
import { createGarageUI, applyPaintTo, RACE_WIN_BONUS_REP, NEAR_MISS_REP } from './garage.js';
import { CrewManager } from './crew.js';
import { applyShotSetup } from './shots.js';

// --- URL query parsing: ?shot=, &seed=, &lq=1. Stored for part 3 shot mode. ---
const params = new URLSearchParams(window.location.search);
const shotParam = params.get('shot');
const seedParam = params.get('seed');
const lqParam = params.get('lq');
state.seed = seedParam ? (hashSeed(seedParam) % 2147483647) || 1 : 1;
state.lowQuality = lqParam === '1' || lqParam === 'true';
state.shot = shotParam || null;

// --- Renderer / scene / camera. ---
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: !state.lowQuality,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, state.lowQuality ? 1 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(-200, 40, 220);

// Follow camera (third-person, mouse-look orbit around the player / car).
let camYaw = Math.PI;   // start looking north from behind the player
let camPitch = 0.32;
let camDist = 9;

const city = buildCity(scene, { seed: state.seed, lowQuality: state.lowQuality });

// --- Gameplay systems (part B). ---
const start = spawnPoint('player');
const player = new Player(scene, start);
const vehicles = new VehicleManager(scene, { seed: state.seed, lowQuality: state.lowQuality, colliders: city.colliders });
const pedestrians = new PedestrianManager(scene, { seed: state.seed, lowQuality: state.lowQuality, colliders: city.colliders });
const police = new PoliceManager(scene, { seed: state.seed, colliders: city.colliders });
const world = { player, vehicles, police, audio };
const missions = new MissionRunner(scene, world);
world.missions = missions;

// v3: crew system — recruits follow Rico, the gunner fights in missions,
// the driver softens police pressure (see police.crewModifiers below).
const crew = new CrewManager(scene, world);
world.crew = crew;
crew.onRecruit = (def) => {
  audio.sting();
  hud.toast(`${def.name} joined your crew — ${def.skillName}!`, 3500);
};

// Part C systems: HUD, particles/skids/tracers/shake, save manager.
const effects = new Effects(scene, { lowQuality: state.lowQuality });
effects.subscribeToPlayer(player);
world.effects = effects; // v3: crew gunner tracers go through effects
// Combat targets: live cops (downed ones stop being targets) + living peds.
// Mission gang members, when they exist, join this list the same way.
player.setTargetProvider(() => [
  ...police.cops.filter((c) => !c.down),
  ...pedestrians.peds.filter((p) => p.alive),
]);
const saveManager = createSaveManager({ getMissions: () => missions });

// Dialogue lines surface through the objective bar (HUD wiring lands in part C).
// updateHud shows a fresh line for 5s before returning to the objective text.
let dialogueText = '';
let dialogueAt = -99;
missions.onDialogue = (line) => {
  dialogueText = line;
  dialogueAt = elapsed;
};
// v2: mission REP is already awarded by completeMission; show the gain and
// the street-race (m6) win bonus. Never gates the m1->m9 auto-advance.
missions.onComplete = (mission) => {
  let msg = `+${mission.rep} REP — ${mission.name} complete`;
  if (mission.id === 'm6') {
    addRep(RACE_WIN_BONUS_REP);
    msg += ` · Race win bonus +${RACE_WIN_BONUS_REP} REP`;
  }
  audio.sting();
  saveGame();
  hud.toast(msg, 3500);
};
missions.onFail = () => { audio.fail(); };
police.onBusted = () => { missions.failMission('busted'); audio.fail(); };
police.onCrime = () => { audio.click(); };

// --- HUD (part C): health, money, rep, debt, stars, objective with the
// 5-second dialogue hold, speedometer, district label, canvas minimap. ---
const hud = createHud({
  getPlayer: () => player,
  getPolice: () => police,
  getMissions: () => missions,
  getCrew: () => crew,
  getDialogue: () => ({ text: dialogueText, active: elapsed - dialogueAt < 5 }),
});
function updateHud() {
  hud.update(0, elapsed);
}

// --- Garage (v2): G opens the panel; the world freezes while it is open
// (but the HUD keeps updating). Esc closes the garage before pausing.
const garageUI = createGarageUI({
  getStarterCar: () => vehicles.starterCar,
  onBuy: () => audio.click(),
});
let garageOpen = false;
function openGarage() {
  garageOpen = true;
  garageUI.open();
}
function closeGarage() {
  garageOpen = false;
  garageUI.close();
}

// --- Menus: start screen / pause / game over (wired minimally for part A). ---
const startScreen = document.getElementById('start-screen');
const pauseScreen = document.getElementById('pause-screen');
const gameoverScreen = document.getElementById('gameover-screen');
const startTitle = document.getElementById('start-title');
if (startTitle) startTitle.textContent = GAME_TITLE;

function show(el, on) { if (el) el.classList.toggle('hidden', !on); }

function beginPlay() {
  audio.init();
  audio.resume();
  state.started = true;
  show(startScreen, false);
  input.requestPointerLock();
}

document.getElementById('btn-start')?.addEventListener('click', () => {
  saveManager.newGame();
  applyPaintTo(vehicles.starterCar);
  beginPlay();
  audio.click();
});
document.getElementById('btn-continue')?.addEventListener('click', () => {
  const ok = saveManager.continueGame();
  if (ok) applyPaintTo(vehicles.starterCar);
  beginPlay();
  audio.click();
  if (!ok) missions.startMission('m1');
});
document.getElementById('btn-resume')?.addEventListener('click', () => {
  state.paused = false;
  show(pauseScreen, false);
});
for (const id of ['btn-restart', 'btn-again']) {
  document.getElementById(id)?.addEventListener('click', () => {
    window.location.reload();
  });
}

function togglePause() {
  if (!state.started || state.gameOver) return;
  if (garageOpen) { closeGarage(); return; }
  state.paused = !state.paused;
  show(pauseScreen, state.paused);
  audio.click();
}
input.onPause = togglePause;

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Game loop. ---
const clock = new THREE.Clock();
let elapsed = 0;
let saveTimer = 0;
let lastShotCrimeAt = -10;
let lastNearMissAt = -10; // v2: near-miss REP cooldown (seconds)
let gameOverShown = false;

// --- Shot mode (part C): ?shot=start|drive|chase|mission places the game
// in a readable state with no user input; drive/chase auto-accelerate.
// Runs after `elapsed` exists: mission dialogue stamps it. ---
let shotSetup = null;
if (state.shot) {
  shotSetup = applyShotSetup(state.shot, {
    player, vehicles, police, missions, camera,
    hideStartScreen: () => show(startScreen, false),
    openGarage: () => openGarage(),
  });
  if (shotSetup) {
    camYaw = shotSetup.camYaw;
    camPitch = shotSetup.camPitch;
    if (shotSetup.started) show(startScreen, false);
  }
}

function updateFollowCamera(dt) {
  const { dx, dy } = input.consumeMouseDelta();
  camYaw -= dx * 0.0032;
  camPitch = Math.max(0.05, Math.min(1.1, camPitch + dy * 0.0022));
  const focus = player.onFoot ? player.position : (player.vehicle ? player.vehicle.position : player.position);
  const targetDist = player.onFoot ? 9 : 11.5;
  camDist += (targetDist - camDist) * Math.min(1, dt * 4);
  const cx = focus.x + Math.sin(camYaw) * Math.cos(camPitch) * camDist;
  const cy = focus.y + 1.6 + Math.sin(camPitch) * camDist;
  const cz = focus.z + Math.cos(camYaw) * Math.cos(camPitch) * camDist;
  const shake = effects.shakeOffset(dt);
  camera.position.set(cx + shake.x, cy + shake.y, cz);
  camera.lookAt(focus.x, focus.y + 1.6, focus.z);
}

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);
  elapsed += delta;
  if (!state.paused) {
    state.playSeconds += delta;
    updateCity(city, delta, elapsed);
    // v2: day/night cycle drives the vehicles' headlights (lamps, beams,
    // and the driven car's spotlight) — updateCity advanced the cycle above.
    vehicles.setNight(city.dayNight ? city.dayNight.nightFactor : 0);
    effects.update(delta);
    // Garage toggle (G) — v2: handled outside the garageOpen gate so G
    // closes the panel too. Opening freezes the world (see the gate below).
    if (state.started && !state.gameOver && input.wasPressed('garage')) {
      if (garageOpen) closeGarage(); else openGarage();
      audio.click();
    }
    if (state.started && !state.gameOver && !garageOpen) {
      // Shot mode: drive / chase auto-accelerate so the shot reads at speed.
      if (shotSetup && shotSetup.autoDrive) input.held.up = true;
      // Radio (C) — v2: cycle the synth stations while playing.
      if (input.wasPressed('radio')) {
        const name = audio.cycleRadio();
        hud.toast(name ? `RADIO · ${name}` : 'RADIO OFF');
      }
      // Crew panel (K) — v3: recruit Vic / Lena when REP allows.
      if (input.wasPressed('crew')) {
        crew.togglePanel();
        audio.click();
      }
      // Enter / exit car.
      if (input.wasPressed('enter')) {
        if (player.onFoot) {
          const car = vehicles.nearestTo(player.position, 5);
          if (car) { car.enter(player); audio.click(); }
        } else if (player.vehicle) {
          player.vehicle.exit(player);
          audio.click();
        }
      }
      // Punch.
      if (input.wasPressed('punch') && player.onFoot) {
        const hit = player.punch(pedestrians.peds);
        audio.punch();
        if (hit) {
          if (hit.knockDown()) {
            state.kills += 1;
            police.commitCrime(2);
            pedestrians.scareAll(player.position, 40);
          }
        }
      }
      // Weapon keys: 1/2/3 switch, mouse wheel cycles, R reloads.
      if (input.wasPressed('weapon1') && player.selectWeapon('pistol')) audio.click();
      if (input.wasPressed('weapon2') && player.selectWeapon('shotgun')) audio.click();
      if (input.wasPressed('weapon3') && player.selectWeapon('rifle')) audio.click();
      const wheel = input.consumeWheel();
      if (wheel !== 0 && player.onFoot && player.cycleWeapon(wheel > 0 ? 1 : -1)) audio.click();
      if (input.wasPressed('reload') && player.onFoot && player.reloadWeapon()) audio.reload();
      // Shoot (mouse click; first click captures the pointer instead).
      // Semi-auto weapons fire on click; the rifle fires while held.
      if (input.mouseClicked && !input.pointerLocked) input.requestPointerLock();
      const wantFire = player.onFoot && input.pointerLocked
        && (player.combat.current.auto ? input.mouseDown : input.mouseClicked);
      if (wantFire) {
        const res = player.shoot(camera);
        if (res && res.fired) {
          audio.gunshot(res.weapon.id);
          effects.shake(res.weapon.shake);
          pedestrians.scareAll(player.position, 45);
          if (elapsed - lastShotCrimeAt > 5) {
            lastShotCrimeAt = elapsed;
            police.commitCrime(1);
          }
          for (const hit of res.hits) {
            if (hit.result === 'down') {
              state.kills += 1;
              police.commitCrime(2);
              pedestrians.scareAll(player.position, 40);
            }
          }
        } else if (res && res.empty) {
          audio.dryFire();
        }
      }
      player.update(delta, input, camYaw, city.colliders);
      vehicles.update(delta, input, player);
      // v2: near-miss driving — pass a traffic car close at speed for +REP.
      if (player.vehicle && player.vehicle.speedMph > 25 && elapsed - lastNearMissAt > 5) {
        for (const v of vehicles.vehicles) {
          if (!v.traffic) continue;
          const d = Math.hypot(v.position.x - player.vehicle.position.x, v.position.z - player.vehicle.position.z);
          if (d < 4.5) {
            lastNearMissAt = elapsed;
            addRep(NEAR_MISS_REP);
            hud.toast(`+${NEAR_MISS_REP} REP — Near miss!`);
            break;
          }
        }
      }
      // Handbrake at speed leaves skid marks behind the player's car.
      if (player.vehicle && input.held.handbrake && Math.abs(player.vehicle.speed) > 6) {
        const car = player.vehicle;
        const bx = car.position.x - Math.sin(car.heading) * 1.6;
        const bz = car.position.z - Math.cos(car.heading) * 1.6;
        effects.addSkid({ x: bx, z: bz }, car.heading);
      }
      pedestrians.update(delta);
      police.crewModifiers = crew.policeModifiers(); // v3: driver softens busts + decay
      police.update(delta, player, elapsed);
      crew.update(delta);
      missions.update(delta);
      audio.engine(player.onFoot ? 0 : (player.vehicle ? player.vehicle.speedMph : 0));
      audio.siren(state.wanted > 0 && police.cops.length > 0);
      audio.heli(!!police.heli);
      // Shot mode: a setup may own the camera (the heli shot's low
      // tracking angle); otherwise the normal follow camera runs.
      if (shotSetup && shotSetup.cameraFn) shotSetup.cameraFn(camera);
      else updateFollowCamera(delta);
      // Autosave every 15s while playing (save manager, part C).
      saveManager.autosave(delta, true);
      void saveTimer;
    } else if (state.gameOver && !gameOverShown) {
      gameOverShown = true;
      audio.engineOff();
      audio.stopRadio();
      audio.siren(false);
      audio.heli(false);
      if (player.wasted) missions.failMission('wasted');
      show(gameoverScreen, true);
    }
    updateHud();
  }
  input.endFrame();
  renderer.render(scene, camera);
}
animate();

// Debug / shot-mode handle for later parts.
window.__game = {
  title: GAME_TITLE,
  state,
  scene,
  camera,
  renderer,
  city,
  player,
  combat: player.combat,
  vehicles,
  pedestrians,
  police,
  missions,
  crew,
  input,
  audio,
  hud,
  garage: garageUI,
  effects,
  saveManager,
  shotSetup,
  shot: state.shot,
  seed: state.seed,
  lowQuality: state.lowQuality,
  version: 'part-c',
};
