// Solmar Heat — pedestrians: ordinary people walking the sidewalks.
// They stroll along road lines, avoid buildings, and flee from gunfire,
// nearby police chases, or a speeding car. Counts stay modest for perf.

import * as THREE from 'three';
import { CITY, makeRng } from './config.js';
import { roadLines, nearestRoadPoint } from './city.js';
import { collideCircle } from './player.js';

const SHIRTS = [0xd95f4b, 0x4b8ad9, 0x7bc24b, 0xe0a83c, 0x9b6bc2, 0xeeeeee, 0x3c3c3c];
const SKINS = [0xc98d5f, 0x8a5a3b, 0xe8b88a, 0x6b4226];

function buildPedMesh(rng) {
  const g = new THREE.Group();
  const shirt = new THREE.MeshStandardMaterial({ color: SHIRTS[Math.floor(rng() * SHIRTS.length)], roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: SKINS[Math.floor(rng() * SKINS.length)], roughness: 0.8 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.9 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.32), shirt);
  torso.position.y = 1.05;
  torso.castShadow = true;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.3), skin);
  head.position.y = 1.6;
  g.add(head);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.62, 0.22), pants);
  legL.position.set(-0.15, 0.31, 0);
  g.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.15;
  g.add(legR);
  g.userData.legs = [legL, legR];
  return g;
}

export class Pedestrian {
  constructor(scene, rng, colliders) {
    this.mesh = buildPedMesh(rng);
    this.colliders = colliders || [];
    const lines = roadLines();
    const line = lines[Math.floor(rng() * lines.length)];
    const along = -CITY.halfSize + rng() * CITY.halfSize * 2;
    const horizontal = rng() < 0.5;
    // Stand on the sidewalk edge, just off the road centre line.
    const x = horizontal ? along : line + CITY.roadHalf + 1.5;
    const z = horizontal ? line + CITY.roadHalf + 1.5 : along;
    this.mesh.position.set(x, 0, z);
    scene.add(this.mesh);
    this.position = this.mesh.position;
    this.heading = rng() * Math.PI * 2;
    this.walkSpeed = 1.2 + rng() * 1.2;
    this.speed = this.walkSpeed;
    this.state = 'walk'; // walk | flee | down
    this.fleeTimer = 0;
    this.target = null;
    this.walkPhase = rng() * 6;
    this.alive = true;
    // Combat: 100 HP, same target interface as police (combat.js).
    this.health = 100;
    this.maxHealth = 100;
    this.aimHeight = 1.1;
    this.radius = 0.6;
    this.scene = scene;
    this._pickTarget(rng);
  }

  // Returns 'down' when this shot neutralizes the ped, 'hit' when it only
  // wounds, null when already down.
  takeDamage(amount) {
    if (!this.alive) return null;
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.knockDown();
      return 'down';
    }
    return 'hit';
  }

  _pickTarget(rng) {
    const p = nearestRoadPoint(this.position.x + (rng() - 0.5) * 120, this.position.z + (rng() - 0.5) * 120);
    this.target = new THREE.Vector3(p.x, 0, p.z);
  }

  fleeFrom(from, seconds = 4) {
    if (!this.alive) return;
    this.state = 'flee';
    this.fleeTimer = Math.max(this.fleeTimer, seconds);
    const away = this.position.clone().sub(from);
    away.y = 0;
    if (away.lengthSq() < 0.01) away.set(1, 0, 0);
    away.normalize();
    this.target = this.position.clone().add(away.multiplyScalar(60));
  }

  // Knocked down (hit by a car / punched hard). Returns true if it was a kill.
  knockDown() {
    if (!this.alive) return false;
    this.alive = false;
    this.state = 'down';
    this.mesh.rotation.z = Math.PI / 2;
    this.mesh.position.y = 0.3;
    return true;
  }

  update(dt, rng) {
    if (!this.alive) return;
    if (this.state === 'flee') {
      this.fleeTimer -= dt;
      this.speed = this.walkSpeed * 3.2;
      if (this.fleeTimer <= 0) this.state = 'walk';
    } else {
      this.speed = this.walkSpeed;
    }
    const to = this.target.clone().sub(this.position);
    to.y = 0;
    if (to.length() < 3) {
      this._pickTarget(rng || Math.random);
      return;
    }
    const want = Math.atan2(to.x, to.z);
    let dh = want - this.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    this.heading += Math.max(-2.4 * dt, Math.min(2.4 * dt, dh));
    this.position.x += Math.sin(this.heading) * this.speed * dt;
    this.position.z += Math.cos(this.heading) * this.speed * dt;
    this.position.x = Math.max(-CITY.halfSize, Math.min(CITY.halfSize, this.position.x));
    this.position.z = Math.max(-CITY.halfSize, Math.min(CITY.halfSize, this.position.z));
    collideCircle(this.position, 0.45, this.colliders);
    this.mesh.rotation.y = this.heading;
    this.walkPhase += dt * this.speed * 2.4;
    const swing = Math.sin(this.walkPhase) * 0.45;
    this.mesh.userData.legs[0].rotation.x = swing;
    this.mesh.userData.legs[1].rotation.x = -swing;
  }
}

export class PedestrianManager {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.rng = makeRng(opts.seed ?? 1);
    this.colliders = opts.colliders || [];
    this.peds = [];
    // v3: territory calm — fn(pos) => true when the ped stands on turf
    // Rico owns. Set by main.js; null means everywhere is nervous.
    this.calmAt = null;
    const count = opts.lowQuality ? 10 : 18;
    for (let i = 0; i < count; i++) this.peds.push(new Pedestrian(scene, this.rng, this.colliders));
  }

  // Everyone nearby runs from a point (gunfire, crash, police chase) —
  // except on turf Rico owns, where the locals stand their ground.
  scareAll(from, radius = 40) {
    for (const p of this.peds) {
      if (!p.alive) continue;
      if (p.position.distanceTo(from) < radius) {
        if (this.calmAt && this.calmAt(p.position)) continue;
        p.fleeFrom(from, 4);
      }
    }
  }

  // Punch / shot helpers for the player: nearest living ped within range.
  nearestTo(pos, maxDist) {
    let best = null;
    let bestD = maxDist;
    for (const p of this.peds) {
      if (!p.alive) continue;
      const d = p.position.distanceTo(pos);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  update(dt) {
    for (const p of this.peds) p.update(dt, this.rng);
  }
}

export default PedestrianManager;
