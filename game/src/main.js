// main.js — bootstrap and the one game loop for Solmar Heat.
// Builds the world, wires every system together, and runs the screens:
// title → play → paused → game over. Fixed 1/60 s steps keep the simulation
// steady whatever the display's refresh rate.
import * as THREE from 'three';
import { SPAWN, mulberry32 } from './config.js';
import { SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE, createGameState, resetRunState } from './state.js';
import { createAudio } from './audio.js';
import { ACTION_ENTER, ACTION_MUTE, ACTION_PAUSE, ACTION_PUNCH, ACTION_SHOOT, createInput } from './input.js';
import { buildCity } from './city.js';
import { addWanted, createCar, damagePlayer, removeCar, spawnParkedCars, spawnTraffic, updateTraffic } from './vehicles.js';
import { spawnPedestrians, updatePed } from './pedestrians.js';
import { createCameraRig, handlePlayerActions, makePlayerMesh, updatePlayer } from './player.js';
import { updatePolice } from './police.js';
import { createMissions } from './missions.js';
import { createHud } from './hud.js';
import { createEffects } from './effects.js';
import { applySave, clearSave, describeSave, loadSave, saveGame } from './save.js';
import { stageShot, shotAutopilot, updateShot } from './shots.js';

const STEP = 1 / 60;
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');
const lowQuality = params.get('lq') === '1';
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 1;

const G = createGameState();
G.seed = seed;
G.rng = mulberry32(seed);
resetRunState(G, seed);

// ---- Renderer / scene ----
// ?lq=1 renders lighter (no antialiasing, smaller shadow map) so software
// renderers can keep up; the game itself is unchanged.
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowQuality });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowQuality ? 1 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
if (lowQuality) renderer.shadowMap.autoUpdate = true;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 900);
G.scene = scene;
G.camera = camera;
G.renderer = renderer;
G.lowQuality = lowQuality;
G.audio = createAudio();
G.input = createInput(canvas);
G.cameraRig = createCameraRig(camera);
G.hud = createHud(G);
G.effects = createEffects(G);
G.missions = createMissions(G);
G.hurtPlayer = (dmg) => damagePlayer(G, dmg);
G.missionCombatKill = () => G.missions.onRivalDown();
G.vehicleApi = { addWanted, removeCar };
G.saveGame = () => saveGame(G);

// The world itself.
buildCity(G);
spawnTraffic(G, 14);
spawnParkedCars(G);
spawnPedestrians(G, 26);

// Rico.
const playerMesh = makePlayerMesh();
playerMesh.position.set(G.player.x, 0, G.player.z);
playerMesh.rotation.y = G.player.heading;
scene.add(playerMesh);
G.playerMesh = playerMesh;

// ---- Screens (DOM) ----
const $ = (id) => document.getElementById(id);
const startScreen = $('start-screen');
const pauseScreen = $('pause-screen');
const endScreen = $('end-screen');

function showScreen(name) {
  startScreen.classList.toggle('hidden', name !== 'title');
  pauseScreen.classList.toggle('hidden', name !== 'paused');
  endScreen.classList.toggle('hidden', name !== 'over');
  G.hud.showHud(name === 'play');
  if (name === 'play') G.audio.unlock();
}

function startNewGame() {
  resetRunState(G, seed);
  G.player.x = SPAWN.x; G.player.z = SPAWN.z; G.player.heading = SPAWN.heading;
  playerMesh.position.set(G.player.x, 0, G.player.z);
  playerMesh.rotation.y = G.player.heading;
  playerMesh.visible = true;
  G.screen = SCREEN_PLAY;
  showScreen('play');
  G.missions.beginStory();
  G.hud.setObjective('Get in the yellow Sunrunner by the harbor');
  G.hud.showToast('Welcome back to Solmar Bay, Rico.');
}

function continueGame() {
  const data = loadSave();
  if (!data) { startNewGame(); return; }
  resetRunState(G, seed);
  applySave(G, data);
  playerMesh.position.set(G.player.x, 0, G.player.z);
  playerMesh.visible = true;
  G.screen = SCREEN_PLAY;
  showScreen('play');
  G.missions.beginStory();
  G.hud.showToast(`Welcome back — ${describeSave(data)}`);
}

function endGame() {
  G.screen = SCREEN_OVER;
  showScreen('over');
  const p = G.player;
  $('end-title').textContent = G.endReason === 'busted' ? 'BUSTED' : 'WASTED';
  $('end-text').textContent = G.endReason === 'busted'
    ? `The SBPD hauled Rico in. He kept $${Math.round(p.money)} and ${p.rep} rep — Marla Voss is not pleased.`
    : `Rico went down in Solmar Bay. He kept $${Math.round(p.money)} and ${p.rep} rep.`;
  G.audio.setEngine(0, false);
  G.audio.setSiren(false, 0);
}

function pauseGame() {
  if (G.screen !== SCREEN_PLAY) return;
  G.screen = SCREEN_PAUSED;
  showScreen('paused');
  const p = G.player;
  $('pause-stats').innerHTML =
    `Cash $${Math.round(p.money)} · Rep ${p.rep} · Debt paid $${G.debtPaid} / $40,000<br>` +
    `Missions done: ${G.stats.missionsDone} · Cars stolen: ${G.stats.carsStolen} · Shots fired: ${G.stats.shotsFired}`;
  G.audio.setEngine(0, false);
  G.audio.setSiren(false, 0);
}

function resumeGame() {
  if (G.screen !== SCREEN_PAUSED) return;
  G.screen = SCREEN_PLAY;
  showScreen('play');
}

// ---- Buttons ----
$('btn-new').addEventListener('click', () => { G.audio.unlock(); G.audio.ui(); startNewGame(); });
$('btn-continue').addEventListener('click', () => { G.audio.unlock(); G.audio.ui(); continueGame(); });
$('btn-how').addEventListener('click', () => { $('howto').classList.toggle('hidden'); G.audio.ui(); });
$('btn-resume').addEventListener('click', resumeGame);
$('btn-restart-mission').addEventListener('click', () => {
  G.audio.ui();
  G.missions.startMission(G.missionIndex);
  resumeGame();
});
$('btn-save').addEventListener('click', () => {
  G.audio.ui();
  if (saveGame(G)) G.hud.showToast('Game saved.');
  else G.hud.showToast('Could not save (storage is off).');
});
$('btn-quit').addEventListener('click', () => { G.audio.ui(); G.screen = SCREEN_TITLE; showScreen('title'); refreshTitle(); });
$('btn-retry').addEventListener('click', () => { G.audio.ui(); startNewGame(); });
$('btn-end-quit').addEventListener('click', () => { G.audio.ui(); G.screen = SCREEN_TITLE; showScreen('title'); refreshTitle(); });

function refreshTitle() {
  const data = loadSave();
  const btn = $('btn-continue');
  if (data) {
    btn.classList.remove('hidden');
    $('continue-label').textContent = describeSave(data);
  } else {
    btn.classList.add('hidden');
  }
}

// ---- One fixed step ----
let shot = null;

function step(dt) {
  G.time += dt;
  const actions = G.input.takeActions();
  if (actions & ACTION_PAUSE) {
    if (G.screen === SCREEN_PLAY) pauseGame();
    else if (G.screen === SCREEN_PAUSED) resumeGame();
  }
  if (actions & ACTION_MUTE) {
    G.audio.setMuted(!G.audio.isMuted());
    G.hud.showToast(G.audio.isMuted() ? 'Sound off' : 'Sound on');
  }
  if (G.screen === SCREEN_TITLE) {
    // The city idles behind the title: traffic drives, clouds drift.
    for (const car of G.cars) {
      if (car.traffic) updateTraffic(G, car, dt);
    }
    G.cameraRig.yaw += dt * 0.03;
    G.cameraRig.distance = 130;
    G.cameraRig.pitch = 0.45;
    const camTarget = { x: 0, z: 20 };
    G.camera.position.set(
      camTarget.x + Math.sin(G.cameraRig.yaw) * 130,
      70,
      camTarget.z + Math.cos(G.cameraRig.yaw) * 130,
    );
    G.camera.lookAt(0, 4, 20);
    updateAmbience(dt);
    G.effects.update(dt);
    if (shot) updateShot(G, shot, dt);
    return;
  }
  if (G.screen !== SCREEN_PLAY) {
    // The game can end outside a step (fatal damage from an evaluated call,
    // a rival's bullet between frames): show the end screen on the transition.
    if (G.screen === SCREEN_OVER) endGame();
    G.effects.update(dt);
    return;
  }

  if (shot) shotAutopilot(G, dt);
  handlePlayerActions(G, actions);
  updatePlayer(G, dt);
  for (const car of [...G.cars]) {
    if (car.traffic && car.driver !== 'player') updateTraffic(G, car, dt);
  }
  for (const ped of [...G.peds, ...G.rivals]) updatePed(G, ped, dt);
  updatePolice(G, dt);
  G.missions.update(dt);
  updateAmbience(dt);
  G.effects.update(dt);
  G.cameraRig.update(G, dt);

  // Timers: toast (the HUD shows it while the timer runs), banner, hurt flash.
  if (G.toastTimer > 0) G.toastTimer -= dt;
  if (G.banner) {
    G.banner.timer -= dt;
    if (G.banner.timer <= 0) G.banner = null;
  }
  G.hurtFlash = Math.max(0, G.hurtFlash - dt * 2.2);
  if (G.beacon.visible) {
    const s = 1 + Math.sin(G.time * 4) * 0.12;
    G.beacon.scale.set(s, 1, s);
  }
  if (shot) updateShot(G, shot, dt);
  if (G.screen === SCREEN_OVER) endGame();
}

function updateAmbience(dt) {
  // Clouds drift; the ocean shimmers; the sun stays late-afternoon warm.
  for (const cloud of G.clouds) {
    cloud.position.x += dt * 1.2;
    if (cloud.position.x > 260) cloud.position.x = -260;
  }
  if (G.ocean) G.ocean.material.color.setHSL(0.55, 0.65, 0.32 + Math.sin(G.time * 0.4) * 0.02);
  G.audio.setSiren(G.player.wanted > 0 && G.screen === SCREEN_PLAY, G.time);
}

// ---- Frame loop ----
let last = performance.now();
let accumulator = 0;
function frame(now) {
  requestAnimationFrame(frame);
  accumulator += Math.min((now - last) / 1000, MAX_FRAME);
  last = now;
  let guard = 0;
  while (accumulator >= STEP && guard < 20) {
    step(STEP);
    accumulator -= STEP;
    guard += 1;
  }
  if (guard >= 20) accumulator = 0;
  // The HUD (and its minimap) refresh once per rendered frame, not per step.
  if (G.screen === SCREEN_PLAY) G.hud.update();
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && G.screen === SCREEN_PLAY && !shot) pauseGame();
});

// Debug / playtest hook: the CDP driver reads window.__game to verify state.
window.__game = G;

refreshTitle();
document.getElementById('loading').remove();
if (shotName) {
  shot = stageShot(G, shotName);
  showScreen(shotName === 'start' ? 'title' : 'play');
  if (shotName === 'start') refreshTitle();
} else {
  showScreen('title');
}
requestAnimationFrame(frame);
