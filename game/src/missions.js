// Solmar Heat — missions: runs the twelve story missions from config.js.
// Objective kinds: goto / pickup / steal / collect / escape. A beacon marks
// the current target; steps advance on radius checks. Rewards pay money,
// reputation and debt. Dialogue from Marla Voss and Danny "Fins" Cole.

import * as THREE from 'three';
import { MISSIONS, DISTRICTS, SPAWNS, missionById } from './config.js';
import {
  state, currentMission, currentObjective, advanceObjective,
  completeMission, setWanted, addMoney, addRep,
} from './state.js';
import { spawnPoint, DOCK_RUN_START, DOCK_RUN_TARGET, BOAT_SPAWNS } from './city.js';

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
  m5_done: ['Marla Voss: "Bad news. That ledger says your forty was sold — interest, fees, and a new owner who doesn\'t take payments."', 'Danny "Fins" Cole: "The new owner runs the Bayfront Bank. And the street race. And, uh... most of Solmar."'],
  m6_start: ['Marla Voss: "The new owner runs an underground street race. Win it and he knocks four grand off your tab."', 'Danny "Fins" Cole: "Four checkpoints, two minutes, whole city watching. Don\'t scratch the paint — it\'s his paint."'],
  m6_done: ['Marla Voss: "You beat his drivers on his own streets. Four grand off. He\'s not laughing now."'],
  m7_start: ['Marla Voss: "The man who bought your debt owns the Bayfront Bank. Rob his vault — take back what\'s yours."', 'Danny "Fins" Cole: "Bank\'s Downtown. Vault cash, then vanish. The alarm will bring everybody."'],
  m7_pickup: ['Danny "Fins" Cole: "You\'ve got three stars! Lose them, then get to the Safehouse!"'],
  m7_done: ['Marla Voss: "Six grand of his own money, back off your tab. The bank\'s owner is furious — good."'],
  m8_start: ['Marla Voss: "The bank job put every cop in Solmar on you. I\'ve got a helicopter at the Marina helipad — go."', 'Danny "Fins" Cole: "Grab the bag at the helipad, shake the tail, and don\'t look back."'],
  m8_pickup: ['Danny "Fins" Cole: "Four stars! The whole SBPD is coming — lose them!"'],
  m8_done: ['Marla Voss: "You flew out from under them. Five grand off. One job left, Rico — then we end this."'],
  m9_start: ['Marla Voss: "Last job. For real this time. Take the payoff from the Safehouse to the Club and we settle forty thousand — for good."', 'Danny "Fins" Cole: "His crew tipped the cops. Expect company. Finish this, Rico."'],
  m9_pickup: ['Danny "Fins" Cole: "Two stars on you already — lose them and get to the Club!"'],
  m9_done: ['Marla Voss: "Forty thousand. Paid in full. The debt is dead, Rico — and so is anyone who tries to sell it again."', 'Danny "Fins" Cole: "Debt free. Solmar Bay is yours now — first round\'s on me."'],
  m10_start: ['Marla Voss: "Debt\'s dead, Rico. Now the city is the prize — Downtown first."', 'Danny "Fins" Cole: "A rival crew holds Downtown. Take their stash, take their shops, and don\'t get caught."'],
  m10_pickup: ['Danny "Fins" Cole: "Stash grabbed — two stars! Lose them and Downtown is yours!"'],
  m10_done: ['Marla Voss: "Downtown flies your flag now. The rest of Solmar just noticed."'],
  m11_start: ['Marla Voss: "The SBPD armory Downtown. Enough hardware to arm a small army — go take it."', 'Danny "Fins" Cole: "Grab the arsenal and run. Three stars, minimum. Bring it to the Safehouse."'],
  m11_pickup: ['Danny "Fins" Cole: "Three stars! Lose the tail, then stash the guns!"'],
  m11_done: ['Marla Voss: "An army\'s worth of hardware, sitting in your Safehouse. The SBPD is furious — good."'],
  m12_start: ['Marla Voss: "Last move, Rico. The Marina docks, the Downtown blocks — then walk into the Club as the one who runs this bay."', 'Danny "Fins" Cole: "Debt\'s paid. No more bosses, no more tabs. This one\'s for the crown."'],
  m12_done: ['Marla Voss: "That\'s it. The docks, the blocks, the Club — Solmar Bay is yours, Rico. The debt is dead, and now you run the town."', 'Danny "Fins" Cole: "From forty grand in the hole to king of the Bay. First round\'s on the house — your house."'],
  fail: ['Marla Voss: "You blew it. Get back out there — the debt doesn\'t wait."'],
  fail_timeout: ['Marla Voss: "Too slow, Rico. The clock doesn\'t forgive — run it again."'],
};

function beaconMesh(color = 0xffd23f) {
  const g = new THREE.Group();
  g.name = 'mission-beacon';
  const cyl = new THREE.Mesh(
    new THREE.CylinderGeometry(BEACON_RADIUS, BEACON_RADIUS, 60, 24, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
  );
  cyl.position.y = 30;
  g.add(cyl);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(BEACON_RADIUS - 1.2, BEACON_RADIUS, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
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
    this._missionTime = 0;   // seconds since the current mission started (race clock)
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
    this._missionTime = 0;
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
    this.say(reason === 'timeout' ? DIALOGUE.fail_timeout : DIALOGUE.fail);
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
      // v3: M10 hands Downtown to the territory system — when it exists.
      // The optional chain keeps the game running until that system lands.
      if (mission.id === 'm10') {
        try { this.world.territory?.capture('downtown'); } catch { /* territory is optional */ }
      }
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
    // Timed missions (m6 street race): the clock runs out, the run fails.
    if (mission.timeLimit) {
      this._missionTime += dt;
      if (this._missionTime > mission.timeLimit) {
        this.failMission('timeout');
        return;
      }
    }
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

export { MISSIONS, DIALOGUE };

// --- Dock delivery (v4) --------------------------------------------------
// A repeatable timed boat run, separate from the twelve story missions:
// it never touches debt math, the mission list, or the save format.
// Pick up the crate at the docks (E at the cyan ring), board a boat, and
// deliver to the buoy out in the bay before the clock runs out.
// Reward: $600 + 25 REP. Repeatable — start it again at the docks.
export const DOCK_RUN_REWARD = 600;
export const DOCK_RUN_REP = 25;
export const DOCK_RUN_TIME = 90;

export class DockDelivery {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world || {}; // { player }
    // Cyan beacon so it reads as different from the story-mission beacon.
    this.beacon = beaconMesh(0x35d0ff);
    this.beacon.visible = false;
    scene.add(this.beacon);
    this.active = false;
    this.phase = null; // 'board' | 'deliver'
    this.timeLeft = 0;
    this._time = 0;
    this.onDialogue = null;  // fn(line) — main.js shows it in the HUD
    this.onComplete = null;  // fn() — main.js toasts + saves
    this.onFail = null;      // fn(reason)
  }

  say(lines) {
    if (!lines) return;
    for (const line of lines) {
      if (this.onDialogue) this.onDialogue(line);
      else if (typeof console !== 'undefined') console.log('[Solmar Heat]', line);
    }
  }

  // True when the player is standing at the crate by the pier root.
  isNearStart(x, z) {
    return Math.hypot(x - DOCK_RUN_START.x, z - DOCK_RUN_START.z) < 6;
  }

  start() {
    if (this.active) return false;
    this.active = true;
    this.phase = 'board';
    this.timeLeft = DOCK_RUN_TIME;
    // Phase 1 beacon sits over the moored boats.
    this.beacon.position.set(BOAT_SPAWNS[0].x, 0, BOAT_SPAWNS[0].z);
    this.beacon.visible = true;
    this.say(['Danny "Fins" Cole: "Dock run! The crate goes to the buoy out in the bay — ninety seconds, Rico."']);
    return true;
  }

  _complete() {
    this.active = false;
    this.phase = null;
    this.beacon.visible = false;
    addMoney(DOCK_RUN_REWARD);
    addRep(DOCK_RUN_REP);
    this.say(['Danny "Fins" Cole: "Crate delivered! Six hundred bucks, clean and dry."']);
    if (this.onComplete) this.onComplete();
  }

  _fail(reason) {
    this.active = false;
    this.phase = null;
    this.beacon.visible = false;
    this.say(['Danny "Fins" Cole: "Too slow — the buyer sailed without you. Run it again at the docks."']);
    if (this.onFail) this.onFail(reason);
  }

  update(dt) {
    this._time += dt;
    if (this.beacon.visible) {
      this.beacon.userData.ring.rotation.z += dt * 0.5;
      const s = 1 + Math.sin(this._time * 2.5) * 0.05;
      this.beacon.scale.set(s, 1, s);
    }
    if (!this.active || state.gameOver) return;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this._fail('timeout');
      return;
    }
    const p = this.world.player;
    if (!p) return;
    if (this.phase === 'board') {
      // Step completes when Rico is driving a boat.
      if (p.vehicle && p.vehicle.isBoat) {
        this.phase = 'deliver';
        this.beacon.position.set(DOCK_RUN_TARGET.x, 0, DOCK_RUN_TARGET.z);
        this.say(['Danny "Fins" Cole: "You\'re on the water — now hit the buoy marker!"']);
      }
    } else if (this.phase === 'deliver') {
      const v = p.vehicle;
      if (!v || !v.isBoat) return; // off the boat: the clock keeps running
      const d = Math.hypot(v.position.x - DOCK_RUN_TARGET.x, v.position.z - DOCK_RUN_TARGET.z);
      if (d < BEACON_RADIUS) this._complete();
    }
  }
}

export default MissionRunner;
