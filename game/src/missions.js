// Solmar Heat — missions: runs the five story missions from config.js.
// Objective kinds: goto / pickup / steal / collect / escape. A beacon marks
// the current target; steps advance on radius checks. Rewards pay money,
// reputation and debt. Dialogue from Marla Voss and Danny "Fins" Cole.

import * as THREE from 'three';
import { MISSIONS, DISTRICTS, SPAWNS, missionById } from './config.js';
import {
  state, currentMission, currentObjective, advanceObjective,
  completeMission, setWanted,
} from './state.js';
import { spawnPoint } from './city.js';

const BEACON_RADIUS = 14;
const DIALOGUE = {
  m1_start: ['Marla Voss: "Rico. You owe me forty thousand. First fare pays a little of it back."', 'Danny "Fins" Cole: "Client\'s waiting at the Harbor. Drive smooth — he hates bumps."'],
  m1_done: ['Marla Voss: "Clean run. Eight hundred off your tab. Don\'t get comfortable."'],
  m2_start: ['Marla Voss: "A rival crew left a gold coupe Downtown. Take it. Quietly."', 'Danny "Fins" Cole: "Gold coupe, Downtown. If the alarm goes off, run."'],
  m2_done: ['Danny "Fins" Cole: "Sweet ride. Marla\'s already got a buyer."'],
  m3_start: ['Marla Voss: "Package on the Boardwalk. Cops will be on you the second you grab it."'],
  m3_pickup: ['Danny "Fins" Cole: "You\'ve got two stars! Lose them, then get to the Safehouse!"'],
  m3_done: ['Marla Voss: "You shook the whole SBPD. Impressive, Rico."'],
  m4_start: ['Marla Voss: "Three Downtown shops owe me protection money. Collect it all."'],
  m4_done: ['Danny "Fins" Cole: "Five grand. The shops won\'t forget your face — good."'],
  m5_start: ['Marla Voss: "Last job. The ledger from the Marina warehouse. Bring it to the Club and we\'re square."'],
  m5_done: ['Marla Voss: "Debt\'s clear, Rico. Forty thousand, gone. Solmar Bay is yours now."'],
  fail: ['Marla Voss: "You blew it. Get back out there — the debt doesn\'t wait."'],
};

function beaconMesh() {
  const g = new THREE.Group();
  g.name = 'mission-beacon';
  const cyl = new THREE.Mesh(
    new THREE.CylinderGeometry(BEACON_RADIUS, BEACON_RADIUS, 60, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
  );
  cyl.position.y = 30;
  g.add(cyl);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(BEACON_RADIUS - 1.2, BEACON_RADIUS, 32),
    new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.15;
  g.add(ring);
  g.userData.ring = ring;
  return g;
}

export class MissionRunner {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world || {}; // { player, vehicles, police, audio }
    this.beacon = beaconMesh();
    this.beacon.visible = false;
    scene.add(this.beacon);
    this.active = false;
    this.missionCar = null;
    this.onDialogue = null;  // fn(line) — main.js shows it in the HUD
    this.onComplete = null;  // fn(mission)
    this.onFail = null;      // fn(mission)
    this._time = 0;
  }

  say(lines) {
    if (!lines) return;
    for (const line of lines) {
      if (this.onDialogue) this.onDialogue(line);
      else if (typeof console !== 'undefined') console.log('[Solmar Heat]', line);
    }
  }

  targetPosition(objective) {
    if (!objective) return null;
    const key = objective.at;
    if (DISTRICTS[key]) return new THREE.Vector3(DISTRICTS[key].x, 0, DISTRICTS[key].z);
    if (SPAWNS[key]) return spawnPoint(key);
    return spawnPoint('downtown');
  }

  startMission(id) {
    const mission = missionById(id || state.missionId);
    if (!mission) return false;
    state.missionId = mission.id;
    state.missionObjectiveIndex = 0;
    this.active = true;
    this.missionCar = null;
    if (mission.id === 'm2' && this.world.vehicles) {
      const d = DISTRICTS.downtown;
      this.missionCar = this.world.vehicles.spawnMissionCar('coupe', d.x + 24, d.z + 18, Math.PI / 2);
    }
    this.say(DIALOGUE[`${mission.id}_start`]);
    this._updateBeacon();
    return true;
  }

  // Call when the player is busted or wasted mid-mission.
  failMission(reason) {
    const mission = currentMission();
    if (!mission || !this.active) return;
    this.active = false;
    this.beacon.visible = false;
    state.failedMissions += 1;
    state.missionObjectiveIndex = 0;
    this.say(DIALOGUE.fail);
    if (this.onFail) this.onFail(mission, reason);
  }

  _completeStep() {
    const mission = currentMission();
    if (!mission) return;
    const obj = currentObjective();
    if (obj && obj.kind === 'pickup' && mission.wantedOnPickup) {
      setWanted(mission.wantedOnPickup);
      this.say(DIALOGUE[`${mission.id}_pickup`]);
    }
    const nextId = advanceObjective();
    if (nextId === null || (typeof nextId === 'string' && nextId !== mission.id)) {
      // Mission finished: advanceObjective already applied the rewards.
      this.active = false;
      this.beacon.visible = false;
      this.say(DIALOGUE[`${mission.id}_done`]);
      if (this.onComplete) this.onComplete(mission);
      // Auto-start the next mission so the story keeps flowing.
      const next = missionById(state.missionId);
      if (next) this.startMission(next.id);
    } else {
      this._updateBeacon();
    }
  }

  _updateBeacon() {
    const obj = currentObjective();
    if (!obj || !this.active) { this.beacon.visible = false; return; }
    const pos = this.targetPosition(obj);
    if (!pos) { this.beacon.visible = false; return; }
    this.beacon.position.set(pos.x, 0, pos.z);
    this.beacon.visible = true;
  }

  _playerPos() {
    const p = this.world.player;
    if (!p) return null;
    return p.position;
  }

  update(dt) {
    this._time += dt;
    if (this.beacon.visible) {
      this.beacon.userData.ring.rotation.z += dt * 0.5;
      const s = 1 + Math.sin(this._time * 2.5) * 0.05;
      this.beacon.scale.set(s, 1, s);
    }
    if (!this.active || state.gameOver) return;
    const mission = currentMission();
    const obj = currentObjective();
    const pos = this._playerPos();
    if (!mission || !obj || !pos) return;
    const target = this.targetPosition(obj);
    if (!target) return;
    const dist = Math.hypot(pos.x - target.x, pos.z - target.z);
    switch (obj.kind) {
      case 'goto':
      case 'pickup':
      case 'collect':
        if (dist < BEACON_RADIUS) this._completeStep();
        break;
      case 'steal': {
        // Step completes when the player is driving the mission coupe.
        const car = this.world.player && this.world.player.vehicle;
        if (car && car.isMissionCar) this._completeStep();
        break;
      }
      case 'escape':
        // Lose the tail: wanted must be back to zero.
        if (state.wanted === 0) this._completeStep();
        break;
      default:
        if (dist < BEACON_RADIUS) this._completeStep();
    }
  }
}

export { MISSIONS };
export default MissionRunner;
