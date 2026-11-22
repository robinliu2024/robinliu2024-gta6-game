// Solmar Heat — SBPD police: wanted level 0-5, interceptors, chase and bust.
// Cops spawn when wanted >= 1, chase the player on foot or in a car, ram and
// try to box the car in. On foot, a cop touching the player for ~1.5s busts
// them. Wanted decays after time out of sight; crimes raise it.

import * as THREE from 'three';
import { CITY, TUNING, MAX_WANTED, makeRng } from './config.js';
import { state, setWanted, damagePlayer } from './state.js';
import { spawnPoint } from './city.js';
import { collideCircle } from './player.js';

const BUST_HOLD_SECONDS = 1.5;
const BUST_RANGE = 2.4;
const RAM_RANGE = 2.6;
const SIGHT_RANGE = 120;

function buildCopCarMesh() {
  const g = new THREE.Group();
  g.name = 'sbpd-interceptor';
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1c2f4a, roughness: 0.35, metalness: 0.4 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x18242e, roughness: 0.15, metalness: 0.6 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.62, 4.6), bodyMat);
  body.position.y = 0.55;
  body.castShadow = true;
  g.add(body);
  const door = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.3, 1.6), whiteMat);
  door.position.set(0, 0.62, 0.2);
  g.add(door);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 2.2), glassMat);
  cabin.position.set(0, 1.08, 0.1);
  cabin.castShadow = true;
  g.add(cabin);
  const barMat = new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.5 });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.14, 0.3), barMat);
  bar.position.set(0, 1.42, 0.1);
  g.add(bar);
  const red = new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff2222, emissiveIntensity: 1.6 });
  const blue = new THREE.MeshStandardMaterial({ color: 0x2244ff, emissive: 0x2244ff, emissiveIntensity: 1.6 });
  const r = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.3), red);
  r.position.set(-0.28, 1.56, 0.1);
  g.add(r);
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.3), blue);
  b.position.set(0.28, 1.56, 0.1);
  g.add(b);
  g.userData.lights = [r, b];
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 12);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
  for (const [x, z] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.36, z);
    g.add(w);
  }
  return g;
}

export function raiseWanted(amount) {
  return setWanted(state.wanted + amount);
}

export function clearWanted() {
  return setWanted(0);
}

export class PoliceCar {
  constructor(scene, pos) {
    this.mesh = buildCopCarMesh();
    this.mesh.position.copy(pos);
    scene.add(this.mesh);
    this.scene = scene;
    this.position = this.mesh.position;
    this.heading = 0;
    this.speed = 0;
    this.bustTimer = 0;
    this.alive = true;
    // Combat: cops can be shot. 100 HP — pistol 3 hits, shotgun ~1 close
    // blast, rifle 4 hits. A downed cop stops chasing and stops busting.
    this.health = 100;
    this.maxHealth = 100;
    this.down = false;
    this.aimHeight = 1.0;  // ray-test centre height (combat.js)
    this.radius = 1.8;     // ray-test sphere radius (the car is a big target)
  }

  // Returns 'down' when this shot neutralizes the cop, 'hit' when it only
  // wounds, null when already down.
  takeDamage(amount) {
    if (this.down) return null;
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.down = true;
      this.speed = 0;
      this.bustTimer = 0;
      // Slump: lights off, car lists to one side.
      const [r, b] = this.mesh.userData.lights || [];
      if (r) r.material.emissiveIntensity = 0.1;
      if (b) b.material.emissiveIntensity = 0.1;
      this.mesh.rotation.z = 0.12;
      return 'down';
    }
    return 'hit';
  }

  update(dt, targetPos, targetOnFoot, colliders, time) {
    if (this.down) return this.position.distanceTo(targetPos);
    const to = targetPos.clone().sub(this.position);
    to.y = 0;
    const dist = to.length();
    const want = Math.atan2(to.x, to.z);
    let dh = want - this.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    // Box-in behaviour: if very close and target is in a car, slow and push.
    const boxingIn = !targetOnFoot && dist < 9;
    const targetSpeed = boxingIn ? 6 : Math.min(TUNING.policeMaxSpeed, 20 + state.wanted * 3);
    this.heading += Math.max(-2.2 * dt, Math.min(2.2 * dt, dh));
    this.speed += ((targetSpeed - this.speed) * Math.min(1, dt * 1.2));
    this.position.x += Math.sin(this.heading) * this.speed * dt;
    this.position.z += Math.cos(this.heading) * this.speed * dt;
    this.position.x = Math.max(-CITY.halfSize, Math.min(CITY.halfSize, this.position.x));
    this.position.z = Math.max(-CITY.halfSize, Math.min(CITY.halfSize, this.position.z));
    collideCircle(this.position, 1.6, colliders);
    this.mesh.rotation.y = this.heading;
    // Flash the light bar.
    const phase = Math.floor(time * 6) % 2 === 0;
    const [r, b] = this.mesh.userData.lights;
    r.material.emissiveIntensity = phase ? 2.2 : 0.2;
    b.material.emissiveIntensity = phase ? 0.2 : 2.2;
    return dist;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.alive = false;
  }
}

export class PoliceManager {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.rng = makeRng((opts.seed ?? 1) + 77);
    this.colliders = opts.colliders || [];
    this.cops = [];
    this.decayTimer = 0;
    this.busted = false;
    this.onBusted = null;   // callback assigned by main.js
    this.onCrime = null;    // callback(wanted) for HUD sting / audio
    this.lastSeenTimer = 0;
  }

  wantedCount() { return Math.min(state.wanted, MAX_WANTED); }

  _spawnOne(targetPos) {
    const depot = spawnPoint('policeDepot');
    const angle = this.rng() * Math.PI * 2;
    const dist = 55 + this.rng() * 35;
    const pos = new THREE.Vector3(
      Math.max(-CITY.halfSize, Math.min(CITY.halfSize, targetPos.x + Math.cos(angle) * dist)),
      0,
      Math.max(-CITY.halfSize, Math.min(CITY.halfSize, targetPos.z + Math.sin(angle) * dist)),
    );
    if (this.cops.length === 0) pos.copy(depot);
    const cop = new PoliceCar(this.scene, pos);
    this.cops.push(cop);
    return cop;
  }

  _syncCount(targetPos) {
    const want = this.wantedCount();
    while (this.cops.length < want) this._spawnOne(targetPos);
    while (this.cops.length > want) {
      const cop = this.cops.pop();
      if (cop) cop.dispose();
    }
  }

  commitCrime(amount) {
    const before = state.wanted;
    raiseWanted(amount);
    if (state.wanted !== before && this.onCrime) this.onCrime(state.wanted);
  }

  update(dt, player, time) {
    if (!player || player.wasted) return;
    const targetPos = player.position;
    this._syncCount(targetPos);
    const inCar = !player.onFoot;
    const dists = [];
    for (const cop of this.cops) {
      const dist = cop.update(dt, targetPos, player.onFoot, this.colliders, time);
      if (cop.down) continue; // downed cops stop chasing, ramming and busting
      dists.push(dist);
      // Ram: a cop hitting the player's car slows it and hurts the player a little.
      if (inCar && dist < RAM_RANGE) {
        const car = player.vehicle;
        if (car) car.speed *= Math.max(0, 1 - 1.6 * dt);
        damagePlayer(2 * dt);
      }
      // Bust: on foot, a cop in range holds the player down.
      if (!inCar && dist < BUST_RANGE) {
        cop.bustTimer += dt;
        if (cop.bustTimer >= BUST_HOLD_SECONDS && !this.busted) {
          this.busted = true;
          state.gameOver = true;
          if (this.onBusted) this.onBusted();
        }
      } else {
        cop.bustTimer = Math.max(0, cop.bustTimer - dt * 2);
      }
    }
    // Wanted decay: only when no cop can see the player.
    const nearest = dists.length ? Math.min(...dists) : Infinity;
    const seen = state.wanted > 0 && nearest < SIGHT_RANGE;
    if (seen) {
      this.lastSeenTimer = 0;
      this.decayTimer = 0;
    } else if (state.wanted > 0) {
      this.lastSeenTimer += dt;
      this.decayTimer += dt;
      if (this.decayTimer >= TUNING.wantedDecaySeconds) {
        this.decayTimer = 0;
        setWanted(state.wanted - 1);
      }
    }
  }

  reset() {
    for (const cop of this.cops) cop.dispose();
    this.cops = [];
    this.busted = false;
    this.decayTimer = 0;
    this.lastSeenTimer = 0;
  }
}

export default PoliceManager;
