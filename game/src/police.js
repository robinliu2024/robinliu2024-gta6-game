// Solmar Heat — SBPD police: wanted level 0-5, interceptors, chase and bust.
// Cops spawn when wanted >= 1, chase the player on foot or in a car, ram and
// try to box the car in. On foot, a cop touching the player for ~1.5s busts
// them. Wanted decays after time out of sight; crimes raise it.

import * as THREE from 'three';
import { CITY, TUNING, MAX_WANTED, makeRng } from './config.js';
import { state, setWanted, damagePlayer } from './state.js';
import { spawnPoint, nearestRoadPoint } from './city.js';
import { collideCircle } from './player.js';

const BUST_HOLD_SECONDS = 1.5;
const BUST_RANGE = 2.4;
const RAM_RANGE = 2.6;
const SIGHT_RANGE = 120;
// Air unit: spawns at wanted 4-5, leaves below 4. It never shoots — it
// keeps the player "seen" (wanted cannot decay while it is overhead) and
// its spotlight tracks the player. No instant damage, so escapes stay
// possible: drop to 3 stars and the chopper peels off.
const HELI_WANTED = 4;
const HELI_ALTITUDE = 58;
// Roadblocks: spawn at wanted 3+, despawn below 3. One block at a time,
// parked ahead of the player on the nearest road, with a drivable gap in
// the middle so it slows an escape without trapping the player.
const ROADBLOCK_WANTED = 3;
const ROADBLOCK_AHEAD = 48;

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

// Police helicopter: flying mesh with a spinning rotor and a visible
// searchlight cone that tracks the player. It hovers high above the player
// and follows with a lag. It never damages the player directly; its job is
// to keep the player "seen" (see PoliceManager.update) so wanted cannot
// decay while it is overhead, and to keep ground units coming.
export class PoliceHeli {
  constructor(scene, targetPos) {
    this.scene = scene;
    this.mesh = new THREE.Group();
    this.mesh.name = 'sbpd-helicopter';
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1c2f4a, roughness: 0.4, metalness: 0.4 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x18242e, roughness: 0.15, metalness: 0.6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.7, 5.2), bodyMat);
    body.position.y = 0;
    body.castShadow = true;
    this.mesh.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.0, 2.0), glassMat);
    cabin.position.set(0, 0.2, 1.8);
    this.mesh.add(cabin);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.64, 0.4, 3.4), whiteMat);
    stripe.position.set(0, -0.3, 0.4);
    this.mesh.add(stripe);
    const boom = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 4.6), bodyMat);
    boom.position.set(0, 0.3, -4.4);
    this.mesh.add(boom);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.6, 1.2), whiteMat);
    fin.position.set(0, 0.9, -6.4);
    this.mesh.add(fin);
    // Main rotor (spins) + tail rotor.
    this.rotor = new THREE.Group();
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 });
    for (const a of [0, Math.PI / 2]) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(11, 0.08, 0.5), bladeMat);
      blade.rotation.y = a;
      this.rotor.add(blade);
    }
    this.rotor.position.y = 1.15;
    this.mesh.add(this.rotor);
    const tailRotor = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.0, 0.4), bladeMat);
    tailRotor.position.set(-0.45, 0.9, -6.2);
    this.mesh.add(tailRotor);
    this.tailRotor = tailRotor;
    // Red beacon light.
    const beaconMat = new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff2222, emissiveIntensity: 1.6 });
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), beaconMat);
    beacon.position.set(0, 1.0, 0);
    this.mesh.add(beacon);
    this.beaconMat = beaconMat;
    // Searchlight cone: apex at the heli, base on the ground at the player.
    // Unit height, scaled to the heli-to-player distance each frame.
    const coneMat = new THREE.MeshBasicMaterial({
      color: 0xfff2b0, transparent: true, opacity: 0.16,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.spot = new THREE.Mesh(new THREE.ConeGeometry(7, 1, 20, 1, true), coneMat);
    this.mesh.add(this.spot);
    // Skids.
    const skidMat = new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.6, metalness: 0.6 });
    for (const x of [-1.1, 1.1]) {
      const skid = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 4.4), skidMat);
      skid.position.set(x, -1.15, 0);
      this.mesh.add(skid);
    }
    // Fly in from off to one side so it does not pop in overhead.
    this.mesh.position.set(targetPos.x + 70, HELI_ALTITUDE, targetPos.z - 70);
    this.position = this.mesh.position;
    scene.add(this.mesh);
    this.alive = true;
    this._up = new THREE.Vector3(0, 1, 0);
    this._toHeli = new THREE.Vector3();
    this._mid = new THREE.Vector3();
    this._ground = new THREE.Vector3();
  }

  update(dt, targetPos, time) {
    // Hover above the player, offset to the side so the cone reads at an
    // angle; close in smoothly rather than teleporting.
    const hoverX = targetPos.x + 12;
    const hoverZ = targetPos.z + 8;
    const k = 1 - Math.exp(-dt * 1.4);
    this.position.x += (hoverX - this.position.x) * k;
    this.position.z += (hoverZ - this.position.z) * k;
    this.position.y += (HELI_ALTITUDE - this.position.y) * Math.min(1, dt * 1.4);
    this.position.y += Math.sin(time * 0.9) * dt * 0.6; // gentle bob
    // Face the direction of travel.
    const dx = hoverX - this.position.x;
    const dz = hoverZ - this.position.z;
    if (Math.abs(dx) + Math.abs(dz) > 0.5) {
      this.mesh.rotation.y = Math.atan2(dx, dz);
    }
    this.rotor.rotation.y += dt * 22;
    this.tailRotor.rotation.x += dt * 30;
    this.beaconMat.emissiveIntensity = Math.floor(time * 3) % 2 === 0 ? 2.2 : 0.2;
    // Searchlight: apex at the heli, base on the ground under the player.
    this._ground.set(targetPos.x, 0, targetPos.z);
    this._toHeli.copy(this.position).sub(this._ground);
    const dist = Math.max(1, this._toHeli.length());
    this._mid.copy(this.position).add(this._ground).multiplyScalar(0.5);
    // The cone is a child of the heli mesh, so work in local space.
    const localMid = this._mid.clone().sub(this.position);
    this.spot.position.copy(localMid);
    this.spot.scale.set(1, dist, 1);
    this._toHeli.normalize();
    this.spot.quaternion.setFromUnitVectors(this._up, this._toHeli);
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.alive = false;
  }
}

// A roadblock parked across a road ahead of the player: two cop cars angled
// across the lanes plus striped barriers at the flanks. Each car/barrier
// registers its own box collider in the shared colliders array, so the
// player, traffic and cops all collide with it. The middle gap (~4.4 m)
// stays open — a car can thread through slowly, and on foot the player can
// slip past — so the block slows an escape instead of trapping the player.
export class Roadblock {
  constructor(scene, colliders, x, z, acrossX) {
    this.scene = scene;
    this.colliders = colliders;
    this.group = new THREE.Group();
    this.group.name = 'sbpd-roadblock';
    this.group.position.set(x, 0, z);
    this.acrossX = acrossX; // true: road runs N-S, block spans the x axis
    this.entries = []; // {mesh, collider} so dispose() removes both
    const mkCar = (ox, oz, heading) => {
      const mesh = buildCopCarMesh();
      mesh.position.set(ox, 0, oz);
      mesh.rotation.y = heading;
      this.group.add(mesh);
      const halfX = acrossX ? 1.7 : 2.6;
      const halfZ = acrossX ? 2.6 : 1.7;
      const collider = { x: x + ox, z: z + oz, halfX, halfZ };
      this.colliders.push(collider);
      this.entries.push({ mesh, collider });
    };
    if (acrossX) {
      mkCar(-3.8, 0.6, 0.45);
      mkCar(3.8, -0.6, -0.45);
    } else {
      mkCar(0.6, -3.8, Math.PI / 2 + 0.45);
      mkCar(-0.6, 3.8, Math.PI / 2 - 0.45);
    }
    // Striped barriers at the flanks (visual + small colliders).
    const barrierMat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.7 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 });
    const mkBarrier = (ox, oz) => {
      const b = new THREE.Group();
      const board = new THREE.Mesh(new THREE.BoxGeometry(acrossX ? 2.4 : 0.5, 0.9, acrossX ? 0.5 : 2.4), barrierMat);
      board.position.y = 0.75;
      b.add(board);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(acrossX ? 2.44 : 0.54, 0.25, acrossX ? 0.54 : 2.44), stripeMat);
      stripe.position.y = 0.75;
      b.add(stripe);
      for (const s of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.75, 0.18), barrierMat);
        leg.position.set(acrossX ? s * 1.0 : 0, 0.37, acrossX ? 0 : s * 1.0);
        b.add(leg);
      }
      b.position.set(ox, 0, oz);
      this.group.add(b);
      const collider = {
        x: x + ox, z: z + oz,
        halfX: acrossX ? 1.3 : 0.4, halfZ: acrossX ? 0.4 : 1.3,
      };
      this.colliders.push(collider);
      this.entries.push({ mesh: b, collider });
    };
    if (acrossX) {
      mkBarrier(-6.2, -1.2);
      mkBarrier(6.2, 1.2);
    } else {
      mkBarrier(-1.2, -6.2);
      mkBarrier(1.2, 6.2);
    }
    scene.add(this.group);
    this.position = this.group.position;
    this.alive = true;
  }

  update(time) {
    // Flash the parked cars' light bars so the block reads as police.
    const phase = Math.floor(time * 6) % 2 === 0;
    for (const { mesh } of this.entries) {
      const lights = mesh.userData && mesh.userData.lights;
      if (!lights) continue;
      const [r, b] = lights;
      r.material.emissiveIntensity = phase ? 2.2 : 0.2;
      b.material.emissiveIntensity = phase ? 0.2 : 2.2;
    }
  }

  dispose() {
    for (const { collider } of this.entries) {
      const i = this.colliders.indexOf(collider);
      if (i !== -1) this.colliders.splice(i, 1);
    }
    this.entries = [];
    this.scene.remove(this.group);
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
    this.heli = null;       // PoliceHeli while wanted >= 4
    this.roadblock = null;  // Roadblock while wanted >= 3
    this.roadblockTimer = 0;
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

  // Helicopter: present at wanted 4-5, gone below 4 (so dropping to 3 stars
  // peels it off and lets wanted decay again). M8's pickup sets wanted 4,
  // which is what triggers it there.
  _syncHeli(targetPos) {
    if (state.wanted >= HELI_WANTED && !this.heli) {
      this.heli = new PoliceHeli(this.scene, targetPos);
    } else if (state.wanted < HELI_WANTED && this.heli) {
      this.heli.dispose();
      this.heli = null;
    }
  }

  // Pick a roadblock spot ahead of the player: 48 m along their heading,
  // snapped onto the nearer road line so the block sits on a real road.
  _blockSpot(targetPos, heading) {
    const ax = targetPos.x + Math.sin(heading) * ROADBLOCK_AHEAD;
    const az = targetPos.z + Math.cos(heading) * ROADBLOCK_AHEAD;
    const snap = nearestRoadPoint(ax, az);
    const acrossX = Math.abs(snap.x - ax) <= Math.abs(snap.z - az);
    if (acrossX) {
      return { x: snap.x, z: Math.max(-CITY.halfSize, Math.min(CITY.halfSize, az)), acrossX: true };
    }
    return { x: Math.max(-CITY.halfSize, Math.min(CITY.halfSize, ax)), z: snap.z, acrossX: false };
  }

  // Roadblocks: one at a time at wanted 3+, despawned below 3. The block
  // repositions ahead of the player when they outrun it or slip past it,
  // at most every 6 s so it never teleports around mid-chase.
  _syncRoadblock(targetPos, heading, dt) {
    if (state.wanted < ROADBLOCK_WANTED) {
      if (this.roadblock) {
        this.roadblock.dispose();
        this.roadblock = null;
      }
      this.roadblockTimer = 0;
      return;
    }
    this.roadblockTimer += dt;
    if (!this.roadblock) {
      const spot = this._blockSpot(targetPos, heading);
      this.roadblock = new Roadblock(this.scene, this.colliders, spot.x, spot.z, spot.acrossX);
      this.roadblockTimer = 0;
      return;
    }
    const dx = this.roadblock.position.x - targetPos.x;
    const dz = this.roadblock.position.z - targetPos.z;
    const dist = Math.hypot(dx, dz);
    // Behind the player: dot of (block - player) with the heading.
    const behind = dx * Math.sin(heading) + dz * Math.cos(heading);
    if (this.roadblockTimer >= 6 && (dist > 120 || behind < -25)) {
      const spot = this._blockSpot(targetPos, heading);
      this.roadblock.dispose();
      this.roadblock = new Roadblock(this.scene, this.colliders, spot.x, spot.z, spot.acrossX);
      this.roadblockTimer = 0;
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
    const heading = player.vehicle ? player.vehicle.heading : player.heading;
    this._syncCount(targetPos);
    this._syncHeli(targetPos);
    this._syncRoadblock(targetPos, heading, dt);
    if (this.heli) this.heli.update(dt, targetPos, time);
    if (this.roadblock) this.roadblock.update(time);
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
    // Wanted decay: only when no cop can see the player. The helicopter
    // keeps the player seen while it is overhead, so wanted cannot decay
    // at 4-5 stars — drop to 3 stars and the chopper leaves, and decay
    // resumes. (A downed cop does not count: it is skipped above.)
    const nearest = dists.length ? Math.min(...dists) : Infinity;
    const seen = state.wanted > 0 && (nearest < SIGHT_RANGE || !!this.heli);
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
    if (this.heli) { this.heli.dispose(); this.heli = null; }
    if (this.roadblock) { this.roadblock.dispose(); this.roadblock = null; }
    this.roadblockTimer = 0;
    this.busted = false;
    this.decayTimer = 0;
    this.lastSeenTimer = 0;
  }
}

export default PoliceManager;
