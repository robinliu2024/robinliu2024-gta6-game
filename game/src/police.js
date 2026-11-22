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

const SWAT_WANTED = 5; // SWAT van rolls at 5 stars only
const PIT_WANTED = 4;  // PIT intercept unit joins at 4 stars
const PIT_RANGE = 3.2; // metres from the player's rear bumper to strike
const PIT_COOLDOWN = 3; // seconds between PIT strikes from one unit

function buildCopCarMesh(opts = {}) {
  const g = new THREE.Group();
  g.name = 'sbpd-interceptor';
  const bodyMat = new THREE.MeshStandardMaterial({ color: opts.bodyColor ?? 0x1c2f4a, roughness: 0.35, metalness: 0.4 });
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

// SWAT van (5 stars): a big black armored van — taller, longer and wider
// than an interceptor, white side stripe, roof light bar. Reads as heavy
// at a glance; it also is heavy (250 HP, harder ram).
function buildSwatVanMesh() {
  const g = new THREE.Group();
  g.name = 'sbpd-swat-van';
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x11161c, roughness: 0.4, metalness: 0.5 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x18242e, roughness: 0.15, metalness: 0.6 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1.7, 5.8), bodyMat);
  body.position.y = 1.15;
  body.castShadow = true;
  g.add(body);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.54, 0.5, 4.6), whiteMat);
  stripe.position.set(0, 1.0, 0.2);
  g.add(stripe);
  const shield = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 0.3), glassMat);
  shield.position.set(0, 1.5, 2.85);
  g.add(shield);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.7, 1.2), glassMat);
  cab.position.set(0, 1.9, 2.2);
  g.add(cab);
  // Roof light bar + front ram bar.
  const barMat = new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.5 });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.16, 0.35), barMat);
  bar.position.set(0, 2.1, 2.2);
  g.add(bar);
  const red = new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff2222, emissiveIntensity: 1.6 });
  const blue = new THREE.MeshStandardMaterial({ color: 0x2244ff, emissive: 0x2244ff, emissiveIntensity: 1.6 });
  const r = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.35), red);
  r.position.set(-0.34, 2.26, 2.2);
  g.add(r);
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.35), blue);
  b.position.set(0.34, 2.26, 2.2);
  g.add(b);
  const ram = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.5, 0.3), barMat);
  ram.position.set(0, 0.75, 3.0);
  g.add(ram);
  g.userData.lights = [r, b];
  const wheelGeo = new THREE.CylinderGeometry(0.44, 0.44, 0.32, 12);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
  for (const [x, z] of [[-1.15, 1.8], [1.15, 1.8], [-1.15, -1.8], [1.15, -1.8]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.44, z);
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
  // Variants (v3): 'cop' is the standard interceptor; 'swat' is the 5-star
  // armored van (250 HP, bigger, harder ram, slightly slower); 'pit' is the
  // 4-star PIT intercept unit (dark body, 120 HP, faster, never boxes in —
  // it aims for the player's rear quarter instead).
  constructor(scene, pos, opts = {}) {
    this.variant = opts.variant || 'cop';
    this.isSwat = this.variant === 'swat';
    this.isPit = this.variant === 'pit';
    this.mesh = this.isSwat
      ? buildSwatVanMesh()
      : buildCopCarMesh(this.isPit ? { bodyColor: 0x0e1a26 } : {});
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
    // The SWAT van is armored (250 HP); the PIT unit is a little tougher
    // than a standard interceptor (120 HP).
    this.health = this.isSwat ? 250 : this.isPit ? 120 : 100;
    this.maxHealth = this.health;
    this.down = false;
    this.aimHeight = this.isSwat ? 1.3 : 1.0; // ray-test centre height (combat.js)
    this.radius = this.isSwat ? 2.2 : 1.8;    // ray-test sphere radius
    // Chase tuning per variant: SWAT is heavy (slower, rams twice as hard),
    // the PIT unit is quick and never slows to box the player in.
    this.topSpeedMult = this.isSwat ? 0.85 : this.isPit ? 1.15 : 1;
    this.ramMult = this.isSwat ? 2.0 : 1;
    this.aggressive = this.isPit;
    this.pitCooldown = 0; // seconds until this unit may PIT again
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
    this.pitCooldown = Math.max(0, this.pitCooldown - dt);
    const to = targetPos.clone().sub(this.position);
    to.y = 0;
    const dist = to.length();
    const want = Math.atan2(to.x, to.z);
    let dh = want - this.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    // Box-in behaviour: if very close and target is in a car, slow and push.
    // Aggressive (PIT) units never box in — they keep their speed to strike.
    const boxingIn = !this.aggressive && !targetOnFoot && dist < 9;
    const targetSpeed = boxingIn ? 6 : Math.min(TUNING.policeMaxSpeed, 20 + state.wanted * 3) * this.topSpeedMult;
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
// The gap is covered by a spike strip (v3): a player car driving over it
// shreds its tires (see checkSpikeStrip + vehicles.applySpikeDamage).
// The strip has no collider and never hurts police cars — only the player's
// vehicle is checked against it.
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
    // Spike strip across the drivable gap: a low dark strip with steel
    // teeth. It sits in the middle of the gap so threading the block costs
    // tires — the gap is still passable, just not for free.
    const stripLen = 4.4;
    const strip = new THREE.Group();
    strip.name = 'sbpd-spike-strip';
    const stripBase = new THREE.Mesh(
      new THREE.BoxGeometry(acrossX ? stripLen : 0.9, 0.08, acrossX ? 0.9 : stripLen),
      new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.6, metalness: 0.7 }),
    );
    stripBase.position.y = 0.06;
    strip.add(stripBase);
    const toothGeo = new THREE.ConeGeometry(0.09, 0.34, 4);
    const toothMat = new THREE.MeshStandardMaterial({ color: 0xb8c0c8, roughness: 0.3, metalness: 0.9 });
    const teeth = Math.floor(stripLen / 0.55);
    for (let i = 0; i < teeth; i++) {
      const t = new THREE.Mesh(toothGeo, toothMat);
      const along = -stripLen / 2 + 0.3 + i * 0.55;
      t.position.set(acrossX ? along : 0, 0.2, acrossX ? 0 : along);
      strip.add(t);
    }
    this.group.add(strip);
    // World-space footprint of the strip (no collider — cars drive over it).
    this.spike = {
      x, z,
      halfX: acrossX ? stripLen / 2 : 0.45,
      halfZ: acrossX ? 0.45 : stripLen / 2,
      lastHitBy: new Map(), // vehicle id -> elapsed time of last shred
    };
    scene.add(this.group);
    this.position = this.group.position;
    this.alive = true;
  }

  // Spike-strip check, called by the manager for the player's vehicle only
  // (police cars are never checked, so they are never hurt by it). A hit
  // shreds the vehicle's tires (see vehicles.applySpikeDamage) and returns
  // true. One hit per vehicle per 3 s so a slow crawl over the strip does
  // not stack the damage instantly.
  checkSpikeStrip(vehicle, time) {
    if (!vehicle || !this.spike || vehicle.wrecked) return false;
    const s = this.spike;
    const dx = Math.abs(vehicle.position.x - s.x);
    const dz = Math.abs(vehicle.position.z - s.z);
    const r = (vehicle.stats && vehicle.stats.radius) || 1.6;
    if (dx > s.halfX + r * 0.6 || dz > s.halfZ + r * 0.6) return false;
    const last = s.lastHitBy.get(vehicle.id) ?? -99;
    if (time - last < 3) return false;
    s.lastHitBy.set(vehicle.id, time);
    vehicle.applySpikeDamage();
    return true;
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
    this.swat = null;       // v3: SWAT van while wanted >= 5
    this.pit = null;        // v3: PIT intercept unit while wanted >= 4
    // v3: driver-skill modifiers from the crew system, set by main.js each
    // frame ({ bustHoldMult, decayMult }); null means no crew bonus.
    this.crewModifiers = null;
  }

  wantedCount() { return Math.min(state.wanted, MAX_WANTED); }

  // Every shootable police unit that is still up: interceptors + the SWAT
  // van + the PIT unit. main.js feeds this to the combat target provider.
  shootables() {
    const out = this.cops.filter((c) => !c.down);
    if (this.swat && !this.swat.down) out.push(this.swat);
    if (this.pit && !this.pit.down) out.push(this.pit);
    return out;
  }

  _spawnOne(targetPos, variant = 'cop') {
    const depot = spawnPoint('policeDepot');
    const angle = this.rng() * Math.PI * 2;
    const dist = 55 + this.rng() * 35;
    const pos = new THREE.Vector3(
      Math.max(-CITY.halfSize, Math.min(CITY.halfSize, targetPos.x + Math.cos(angle) * dist)),
      0,
      Math.max(-CITY.halfSize, Math.min(CITY.halfSize, targetPos.z + Math.sin(angle) * dist)),
    );
    if (this.cops.length === 0 && variant === 'cop') pos.copy(depot);
    const cop = new PoliceCar(this.scene, pos, { variant });
    if (variant === 'cop') this.cops.push(cop);
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

  // SWAT van: one armored van at 5 stars, gone below 5. It is a separate
  // unit from the interceptor count — at 5 stars the player faces 5 cops
  // plus the van.
  _syncSwat(targetPos) {
    if (state.wanted >= SWAT_WANTED && !this.swat) {
      this.swat = this._spawnOne(targetPos, 'swat');
    } else if (state.wanted < SWAT_WANTED && this.swat) {
      this.swat.dispose();
      this.swat = null;
    }
  }

  // PIT intercept unit: one at 4-5 stars, gone below 4. It does not bust
  // the player — its job is to hit the player's rear quarter and spin the
  // car out (see _pitStrike below).
  _syncPit(targetPos) {
    if (state.wanted >= PIT_WANTED && !this.pit) {
      this.pit = this._spawnOne(targetPos, 'pit');
    } else if (state.wanted < PIT_WANTED && this.pit) {
      this.pit.dispose();
      this.pit = null;
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

  // Aim point for the PIT unit: the player's rear quarter — 4.5 m behind
  // the car and 2.2 m to whichever side the unit is already on, so it
  // swings in from the flank instead of queuing up dead astern.
  _pitAimPoint(player) {
    const car = player.vehicle;
    if (!car) return player.position.clone();
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    const rx = this.pit.position.x - car.position.x;
    const rz = this.pit.position.z - car.position.z;
    const side = (rx * fz - rz * fx) >= 0 ? 1 : -1;
    return new THREE.Vector3(
      car.position.x - fx * 4.5 + fz * 2.2 * side,
      0,
      car.position.z - fz * 4.5 - fx * 2.2 * side,
    );
  }

  // A PIT strike lands when the unit reaches the player's rear bumper: the
  // player's car loses 70% of its speed and is spun ~50° toward the
  // striking side, and the unit sheds speed too. One strike per unit per
  // PIT_COOLDOWN seconds, so a single unit cannot stun-lock the player.
  // Returns true when a strike landed.
  _pitStrike(car) {
    const pit = this.pit;
    if (!pit || pit.pitCooldown > 0) return false;
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    const rearX = car.position.x - fx * 2.3;
    const rearZ = car.position.z - fz * 2.3;
    const dist = Math.hypot(pit.position.x - rearX, pit.position.z - rearZ);
    if (dist > PIT_RANGE) return false;
    const dx = pit.position.x - car.position.x;
    const dz = pit.position.z - car.position.z;
    const side = (dx * fz - dz * fx) >= 0 ? 1 : -1;
    car.speed *= 0.3;
    car.heading += side * 0.85;
    if (car.mesh) car.mesh.rotation.y = car.heading;
    pit.speed *= 0.4;
    pit.pitCooldown = PIT_COOLDOWN;
    damagePlayer(6);
    return true;
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
    this._syncSwat(targetPos);
    this._syncPit(targetPos);
    this._syncRoadblock(targetPos, heading, dt);
    if (this.heli) this.heli.update(dt, targetPos, time);
    if (this.roadblock) {
      this.roadblock.update(time);
      // Spike strips only ever hurt the player's vehicle (see Roadblock).
      if (player.vehicle) this.roadblock.checkSpikeStrip(player.vehicle, time);
    }
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
      // v3: a recruited driver in the crew makes the hold take longer.
      if (!inCar && dist < BUST_RANGE) {
        cop.bustTimer += dt;
        const hold = BUST_HOLD_SECONDS * (this.crewModifiers?.bustHoldMult ?? 1);
        if (cop.bustTimer >= hold && !this.busted) {
          this.busted = true;
          state.gameOver = true;
          if (this.onBusted) this.onBusted();
        }
      } else {
        cop.bustTimer = Math.max(0, cop.bustTimer - dt * 2);
      }
    }
    // SWAT van: chases like an interceptor but rams twice as hard (ramMult).
    // It never busts — busting stays with the on-foot cops.
    if (this.swat && !this.swat.down) {
      const dist = this.swat.update(dt, targetPos, player.onFoot, this.colliders, time);
      dists.push(dist);
      if (inCar && dist < RAM_RANGE) {
        const car = player.vehicle;
        if (car) car.speed *= Math.max(0, 1 - 1.6 * this.swat.ramMult * dt);
        damagePlayer(2 * this.swat.ramMult * dt);
      }
    }
    // PIT unit: aims at the player's rear quarter and strikes when it
    // reaches the rear bumper — the car is spun out, not just slowed.
    if (this.pit && !this.pit.down) {
      const pitAim = this._pitAimPoint(player);
      const dist = this.pit.update(dt, pitAim, false, this.colliders, time);
      dists.push(dist);
      if (inCar && player.vehicle) this._pitStrike(player.vehicle);
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
      // v3: a recruited driver in the crew cools the heat off faster.
      const decaySeconds = TUNING.wantedDecaySeconds * (this.crewModifiers?.decayMult ?? 1);
      if (this.decayTimer >= decaySeconds) {
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
    if (this.swat) { this.swat.dispose(); this.swat = null; }
    if (this.pit) { this.pit.dispose(); this.pit = null; }
    this.roadblockTimer = 0;
    this.busted = false;
    this.decayTimer = 0;
    this.lastSeenTimer = 0;
  }
}

export default PoliceManager;
