// Solmar Heat — vehicles: parked and traffic cars, arcade driving physics.
// Enter/exit with E, handbrake drift with Space, steal raises wanted by 1
// the first time a given car is taken. Speed is reported in mph on state.

import * as THREE from 'three';
import { CITY, TUNING, makeRng } from './config.js';
import { state, setWanted } from './state.js';
import { speedMultiplier, accelMultiplier, applyPaintTo } from './garage.js';
import { roadLines, nearestRoadPoint } from './city.js';
import { collideCircle } from './player.js';

const MS_TO_MPH = 2.23694;
const CAR_COLORS = [0xc23b2e, 0x2e6fc2, 0xe8b93c, 0x3aa655, 0x8a5fc2, 0xd8d8d8, 0x222831, 0xe07a3a];

function buildCarMesh(color, kind) {
  const g = new THREE.Group();
  g.name = 'solmar-car';
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.4 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x18242e, roughness: 0.15, metalness: 0.6 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.62, kind === 'coupe' ? 4.1 : 4.6), bodyMat);
  body.position.y = 0.55;
  body.castShadow = true;
  g.add(body);
  g.userData.bodyMat = bodyMat; // garage paint recolors this material
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, kind === 'coupe' ? 1.9 : 2.3), glassMat);
  cabin.position.set(0, 1.08, kind === 'coupe' ? -0.25 : 0.1);
  cabin.castShadow = true;
  g.add(cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 12);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
  for (const [x, z] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.36, z);
    g.add(w);
  }
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff2b0, emissive: 0xffe9a0, emissiveIntensity: 0.7 });
  for (const x of [-0.6, 0.6]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.08), lightMat);
    lamp.position.set(x, 0.62, 2.32);
    g.add(lamp);
  }
  return g;
}

export class Vehicle {
  constructor(scene, opts = {}) {
    this.kind = opts.kind || 'sedan';
    this.mesh = buildCarMesh(opts.color ?? 0xc23b2e, this.kind);
    this.mesh.position.set(opts.x || 0, 0, opts.z || 0);
    this.mesh.rotation.y = opts.heading || 0;
    scene.add(this.mesh);
    this.scene = scene;
    this.position = this.mesh.position;
    this.heading = opts.heading || 0;
    this.speed = 0;              // m/s, signed (reverse is negative)
    this.steer = 0;
    this.parked = opts.parked !== false;
    this.isPlayerCar = !!opts.isPlayerCar;
    this.stolen = false;         // wanted already raised for this car
    this.isMissionCar = !!opts.isMissionCar;
    this.id = opts.id || `car-${Math.random().toString(36).slice(2, 8)}`;
    this.driver = null;          // 'player' | 'traffic' | null
    this.traffic = !!opts.traffic;
    this.trafficTarget = null;
    this.trafficSpeed = 8 + Math.random() * 4;
  }

  get speedMph() { return Math.abs(this.speed) * MS_TO_MPH; }

  // Garage paint: recolor the body material (keeps the mesh otherwise).
  setPaint(color) {
    const mat = this.mesh.userData.bodyMat;
    if (!mat) return false;
    if (mat.color && typeof mat.color === 'object' && typeof mat.color.setHex === 'function') {
      mat.color.setHex(color);
    } else {
      mat.color = color;
    }
    return true;
  }

  enter(player) {
    this.driver = 'player';
    this.parked = false;
    player.onFoot = false;
    player.vehicle = this;
    player.mesh.visible = false;
    if (!this.isPlayerCar && !this.stolen) {
      this.stolen = true;
      state.carsStolen += 1;
      setWanted(state.wanted + 1);
    }
    state.car = this;
  }

  exit(player) {
    this.driver = null;
    this.parked = true;
    player.onFoot = true;
    player.vehicle = null;
    player.mesh.visible = true;
    // Step out to the driver's side.
    const side = new THREE.Vector3(Math.cos(this.heading), 0, -Math.sin(this.heading));
    player.position.copy(this.position).add(side.multiplyScalar(1.8));
    player.position.y = 0;
    player.heading = this.heading;
    player.mesh.rotation.y = this.heading;
    if (state.car === this) state.car = null;
  }

  // Arcade driving: accel/brake/steer from input axes, handbrake drift.
  // Garage upgrades (speed/accel tracks) apply only to the player's car.
  drive(dt, inp, colliders) {
    const axes = inp.axes();
    const handbrake = !!inp.held.handbrake;
    const tuned = this.driver === 'player';
    const accelMul = tuned ? accelMultiplier() : 1;
    const topMul = tuned ? speedMultiplier() : 1;
    const accel = axes.y > 0 ? TUNING.carAccel * accelMul : 0;
    const braking = axes.y < 0;
    if (accel) this.speed += accel * dt;
    if (braking) {
      if (this.speed > 0.5) this.speed -= TUNING.carBrake * dt;
      else this.speed -= TUNING.carAccel * accelMul * 0.45 * dt; // reverse
    }
    if (!accel && !braking) this.speed *= Math.max(0, 1 - 0.9 * dt); // coast drag
    if (handbrake) this.speed *= Math.max(0, 1 - 2.2 * dt);
    this.speed = Math.max(-12, Math.min(TUNING.carMaxSpeed * topMul, this.speed));
    const steerInput = axes.x;
    const steerTarget = steerInput * TUNING.carTurn * (handbrake ? 1.5 : 1);
    this.steer += (steerTarget - this.steer) * Math.min(1, dt * 8);
    const turnRate = this.steer * Math.min(1, Math.abs(this.speed) / 8) * Math.sign(this.speed || 1);
    this.heading += turnRate * dt * (handbrake ? 1.25 : 1);
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    this.position.x += fx * this.speed * dt;
    this.position.z += fz * this.speed * dt;
    this.position.x = Math.max(-CITY.halfSize, Math.min(CITY.halfSize, this.position.x));
    this.position.z = Math.max(-CITY.halfSize, Math.min(CITY.halfSize, this.position.z));
    collideCircle(this.position, 1.6, colliders);
    this.mesh.rotation.y = this.heading;
    state.speedMph = this.speedMph;
    state.distanceDriven += Math.abs(this.speed) * dt;
  }

  // Simple traffic behaviour: cruise along the nearest road line.
  updateTraffic(dt, colliders) {
    if (!this.trafficTarget) {
      const p = nearestRoadPoint(this.position.x, this.position.z);
      this.trafficTarget = new THREE.Vector3(p.x, 0, p.z);
    }
    const to = this.trafficTarget.clone().sub(this.position);
    to.y = 0;
    if (to.length() < 6) {
      // Pick a new point further along a random road line.
      const lines = roadLines();
      const line = lines[Math.floor(Math.random() * lines.length)];
      const along = -CITY.halfSize + Math.random() * CITY.halfSize * 2;
      const horizontal = Math.random() < 0.5;
      this.trafficTarget.set(horizontal ? along : line, 0, horizontal ? line : along);
      return;
    }
    const want = Math.atan2(to.x, to.z);
    let dh = want - this.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    this.heading += Math.max(-1.2 * dt, Math.min(1.2 * dt, dh));
    this.speed += ((this.trafficSpeed - this.speed) * Math.min(1, dt));
    this.position.x += Math.sin(this.heading) * this.speed * dt;
    this.position.z += Math.cos(this.heading) * this.speed * dt;
    collideCircle(this.position, 1.6, colliders);
    this.mesh.rotation.y = this.heading;
  }
}

export class VehicleManager {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.vehicles = [];
    this.rng = makeRng(opts.seed ?? 1);
    this.lowQuality = !!opts.lowQuality;
    this.colliders = opts.colliders || [];
    this._spawnParked();
    this._spawnTraffic();
  }

  _spawnParked() {
    const lines = roadLines();
    const count = this.lowQuality ? 8 : 14;
    for (let i = 0; i < count; i++) {
      const line = lines[Math.floor(this.rng() * lines.length)];
      const along = -CITY.halfSize + 40 + this.rng() * (CITY.halfSize * 2 - 80);
      const horizontal = this.rng() < 0.5;
      const x = horizontal ? along : line + 5.2;
      const z = horizontal ? line + 5.2 : along;
      const v = new Vehicle(this.scene, {
        x, z, heading: horizontal ? Math.PI / 2 : 0,
        color: CAR_COLORS[Math.floor(this.rng() * CAR_COLORS.length)],
        parked: true, id: `parked-${i}`,
      });
      this.vehicles.push(v);
    }
    // Player's starter car near the Harbor spawn.
    const starter = new Vehicle(this.scene, {
      x: -218, z: 186, heading: Math.PI / 2, color: 0x1e6f5c,
      parked: true, isPlayerCar: true, id: 'starter',
    });
    this.vehicles.push(starter);
    this.starterCar = starter;
    applyPaintTo(starter); // re-apply the saved paint (default teal on a new game)
  }

  _spawnTraffic() {
    const count = this.lowQuality ? 3 : 6;
    for (let i = 0; i < count; i++) {
      const lines = roadLines();
      const line = lines[Math.floor(this.rng() * lines.length)];
      const along = -CITY.halfSize + this.rng() * CITY.halfSize * 2;
      const horizontal = this.rng() < 0.5;
      const v = new Vehicle(this.scene, {
        x: horizontal ? along : line, z: horizontal ? line : along,
        heading: horizontal ? Math.PI / 2 : 0,
        color: CAR_COLORS[Math.floor(this.rng() * CAR_COLORS.length)],
        parked: false, traffic: true, id: `traffic-${i}`,
      });
      this.vehicles.push(v);
    }
  }

  // Special mission car (e.g. the m2 coupe Downtown). Returns the vehicle.
  spawnMissionCar(kind, x, z, heading = 0) {
    const v = new Vehicle(this.scene, {
      x, z, heading, kind, color: 0xe8b93c,
      parked: true, isMissionCar: true, id: `mission-${kind}`,
    });
    this.vehicles.push(v);
    return v;
  }

  nearestTo(pos, maxDist = 5) {
    let best = null;
    let bestD = maxDist;
    for (const v of this.vehicles) {
      const d = Math.hypot(v.position.x - pos.x, v.position.z - pos.z);
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }

  update(dt, inp, player) {
    for (const v of this.vehicles) {
      if (v.driver === 'player') v.drive(dt, inp, this.colliders);
      else if (v.traffic) v.updateTraffic(dt, this.colliders);
    }
    // Keep the shared speed readout honest when on foot.
    if (player && player.onFoot) state.speedMph = 0;
  }
}

export default VehicleManager;
