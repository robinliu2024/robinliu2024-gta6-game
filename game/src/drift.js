// Solmar Heat — driving fun pack (v4, Builder 3): handbrake drift scoring,
// nitro boost with a refillable meter, and stunt ramps with air-time
// bonuses. This module owns the fun; the car physics it leans on lives in
// vehicles.js (drift slide, nitro multipliers, ramp launch, airborne), the
// particles in effects.js, and the popups / meter in hud.js. Nothing here
// touches debt, missions, saves or existing handling: a car that never
// drifts, boosts or jumps drives exactly like before.

import * as THREE from 'three';
import { drivingKeys } from './player.js';

// Nitro: 100-point meter, ~3 s of boost per full tank, refills in ~7 s.
export const NITRO_MAX = 100;
export const NITRO_DRAIN_PER_SEC = 32;
export const NITRO_REFILL_PER_SEC = 14;
export const NITRO_TOP_SPEED_MULT = 1.35;
export const NITRO_ACCEL_MULT = 1.6;
// FOV stretch while boosting (base FOV is 62 in main.js).
export const BASE_FOV = 62;
export const NITRO_FOV = 71;
// Drift: 2 points per m/s per second (30 m/s for 2 s banks ~120). A drift
// only banks once it is worth showing; shorter slides just end quietly.
export const DRIFT_POINTS_PER_SEC = 2.0;
export const DRIFT_MIN_BANK = 25;
// Air time: only jumps over 0.4 s pay out, at 120 points per second.
export const AIR_MIN_SECONDS = 0.4;
export const AIR_POINTS_PER_SEC = 120;
// Ramps only fire above this speed, so parking on one does nothing.
export const RAMP_MIN_SPEED = 12;
// Ramp trigger window: |side| < 2.6 m of the centre line, car centre on
// the slope, travelling within ~45° of the ramp facing. The along window
// is deliberately wide (7 m): at low frame rates one physics step moves
// up to ~2 m (42 m/s at the 0.05 s dt clamp, more with nitro), so a
// narrow window can be stepped clean over between frames.
export const RAMP_SIDE_HALF = 2.6;
export const RAMP_ALONG_MIN = -4.5;
export const RAMP_ALONG_MAX = 2.5;
export const RAMP_DOT_MIN = 0.7;

// Five ramps, one per district, each sitting on a road centre line (roads
// run on multiples of 64) and facing along its road, so a car driving the
// road hits the lip square-on. The Downtown North ramp sits on the x=64
// road the ?shot=drive setup uses, so it is the smoke-test ramp.
export const RAMP_DEFS = [
  { x: 64, z: -32, heading: Math.PI, name: 'Downtown North' },
  { x: 0, z: 128, heading: Math.PI / 2, name: 'Downtown East' },
  { x: -64, z: -64, heading: 0, name: 'Harbor South' },
  { x: 192, z: 0, heading: -Math.PI / 2, name: 'Uptown West' },
  { x: -192, z: 192, heading: Math.PI, name: 'Boardwalk North' },
];

// Pure trigger test, so the Node harness can check it without a scene:
// is the car (px, pz, heading, speed) crossing this ramp's lip?
export function checkRampLaunch(ramps, px, pz, heading, speed) {
  if (!ramps || !ramps.length || speed < RAMP_MIN_SPEED) return null;
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  for (const r of ramps) {
    const dx = px - r.x;
    const dz = pz - r.z;
    const along = dx * r.sinH + dz * r.cosH;
    const side = dx * r.cosH - dz * r.sinH;
    if (Math.abs(side) > RAMP_SIDE_HALF) continue;
    if (along < RAMP_ALONG_MIN || along > RAMP_ALONG_MAX) continue;
    if (fx * r.sinH + fz * r.cosH < RAMP_DOT_MIN) continue;
    return r;
  }
  return null;
}

// One ramp mesh: an orange slope with yellow chevrons on a dark base
// plate, rotated to face along its road. The slope is 9 m long at ~18°,
// so the lip stands ~2.9 m tall.
export function buildRampMesh(def) {
  const g = new THREE.Group();
  g.name = `solmar-ramp-${def.name.replace(/\s+/g, '-').toLowerCase()}`;
  const slopeMat = new THREE.MeshStandardMaterial({ color: 0xe8641c, roughness: 0.7 });
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.6 });
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.9 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(5, 0.18, 10), baseMat);
  base.position.y = 0.09;
  base.receiveShadow = true;
  g.add(base);
  const slope = new THREE.Group();
  slope.position.set(0, 1.45, 0);
  slope.rotation.x = -0.32;
  const slab = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.35, 9), slopeMat);
  slab.castShadow = true;
  slab.receiveShadow = true;
  slope.add(slab);
  for (const sx of [-1.6, 1.6]) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.06, 8.6), stripeMat);
    stripe.position.set(sx, 0.21, 0);
    slope.add(stripe);
  }
  g.add(slope);
  g.position.set(def.x, 0, def.z);
  g.rotation.y = def.heading;
  return g;
}

export class DrivingFun {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.getPlayer = opts.getPlayer || (() => null);
    this.getVehicles = opts.getVehicles || (() => null);
    this.effects = opts.effects || null;
    this.hud = opts.hud || null;
    this.camera = opts.camera || null;
    this.input = opts.input || null;
    this.nitro = NITRO_MAX;
    this.nitroActive = false;
    this.driftPoints = 0;
    this.driftTime = 0;
    this.lastDriftScore = 0;
    this.lastAirScore = 0;
    this.totalDriftBanked = 0;
    this.totalAirBanked = 0;
    this._smokeTimer = 0;
    this._flameTimer = 0;
    this._seenLandings = 0;
    this._fov = BASE_FOV;
    // Build the ramps and hand them to the vehicle manager, which passes
    // them to every car (Vehicle.drive does the launch test).
    this.ramps = RAMP_DEFS.map((d) => ({
      ...d,
      sinH: Math.sin(d.heading),
      cosH: Math.cos(d.heading),
      mesh: buildRampMesh(d),
    }));
    for (const r of this.ramps) scene.add(r.mesh);
    const vm = this.getVehicles();
    if (vm && typeof vm.setRamps === 'function') vm.setRamps(this.ramps);
  }

  // Bank the open drift (when it is worth showing) and hide the live
  // readout. bank=false drops the points silently (e.g. stepping out
  // mid-drift): unbanked points never pay out.
  _endDrift(bank) {
    if (this.driftPoints >= DRIFT_MIN_BANK && bank) {
      const pts = Math.round(this.driftPoints);
      this.lastDriftScore = pts;
      this.totalDriftBanked += pts;
      if (this.hud && this.hud.scorePopup) this.hud.scorePopup(`DRIFT +${pts}`);
    }
    if (this.driftPoints > 0 && this.hud && this.hud.hideDrift) this.hud.hideDrift();
    this.driftPoints = 0;
    this.driftTime = 0;
  }

  _relaxFov(dt) {
    if (!this.camera) return;
    this._fov += (BASE_FOV - this._fov) * Math.min(1, dt * 5);
    if (Math.abs(this.camera.fov - this._fov) > 0.05) {
      this.camera.fov = this._fov;
      this.camera.updateProjectionMatrix();
    }
  }

  update(dt) {
    const player = this.getPlayer();
    // Boats are player.vehicle too (v4, Builder 4) but have no drift /
    // nitro / jump state — they take the off-car path below.
    const car = player && !player.onFoot && player.vehicle && !player.vehicle.isBoat
      ? player.vehicle : null;
    if (!car || car.wrecked) {
      // Off the car: the meter refills, the FOV relaxes, any open drift
      // is dropped unbanked.
      this.nitro = Math.min(NITRO_MAX, this.nitro + NITRO_REFILL_PER_SEC * dt);
      this.nitroActive = false;
      this._endDrift(false);
      this._relaxFov(dt);
      if (this.hud && this.hud.setNitro) this.hud.setNitro(this.nitro / NITRO_MAX, false);
      return;
    }
    const keys = drivingKeys(this.input);
    // --- Nitro: Shift while rolling forward, while the meter lasts. ---
    const wantNitro = keys.nitro && car.speed > 2 && this.nitro > 0;
    if (wantNitro) {
      this.nitro = Math.max(0, this.nitro - NITRO_DRAIN_PER_SEC * dt);
      this.nitroActive = this.nitro > 0;
    } else {
      this.nitroActive = false;
      this.nitro = Math.min(NITRO_MAX, this.nitro + NITRO_REFILL_PER_SEC * dt);
    }
    car.nitroActive = this.nitroActive;
    // FOV stretch while boosting, easing back when it ends.
    if (this.camera) {
      const target = this.nitroActive ? NITRO_FOV : BASE_FOV;
      this._fov += (target - this._fov) * Math.min(1, dt * 5);
      if (Math.abs(this.camera.fov - this._fov) > 0.05) {
        this.camera.fov = this._fov;
        this.camera.updateProjectionMatrix();
      }
    }
    // Exhaust flames while boosting: one jet per tailpipe, so the boost
    // reads from the chase camera instead of hiding behind the bumper.
    this._flameTimer -= dt;
    if (this.nitroActive && this.effects && this._flameTimer <= 0) {
      this._flameTimer = 0.05;
      const fx = Math.sin(car.heading);
      const fz = Math.cos(car.heading);
      const rx = Math.cos(car.heading);
      const rz = -Math.sin(car.heading);
      for (const s of [-0.55, 0.55]) {
        this.effects.spawnNitroFlame({
          x: car.position.x - fx * 2.3 + rx * s,
          y: 0.55,
          z: car.position.z - fz * 2.3 + rz * s,
        }, car.heading);
      }
    }
    if (this.hud && this.hud.setNitro) this.hud.setNitro(this.nitro / NITRO_MAX, this.nitroActive);
    // --- Drift scoring: points while sliding, banked on straightening. ---
    if (car.drifting) {
      this.driftPoints += Math.abs(car.speed) * DRIFT_POINTS_PER_SEC * dt;
      this.driftTime += dt;
      this._smokeTimer -= dt;
      if (this.effects && this._smokeTimer <= 0) {
        this._smokeTimer = 0.06;
        const fx = Math.sin(car.heading);
        const fz = Math.cos(car.heading);
        const rx = Math.cos(car.heading);
        const rz = -Math.sin(car.heading);
        for (const s of [-0.95, 0.95]) {
          this.effects.spawnDriftSmoke({
            x: car.position.x - fx * 1.5 + rx * s,
            y: 0.3,
            z: car.position.z - fz * 1.5 + rz * s,
          });
        }
      }
      if (this.hud && this.hud.showDrift) this.hud.showDrift(Math.round(this.driftPoints));
    } else {
      this._endDrift(true);
    }
    // --- Air-time bonus: the car counts its own landings, so this read
    // does not depend on update ordering with VehicleManager. ---
    if (car.landings > this._seenLandings) {
      this._seenLandings = car.landings;
      const air = car.lastAirTime || 0;
      if (air >= AIR_MIN_SECONDS) {
        const pts = Math.round(air * AIR_POINTS_PER_SEC);
        this.lastAirScore = pts;
        this.totalAirBanked += pts;
        if (this.hud && this.hud.scorePopup) this.hud.scorePopup(`AIR TIME +${pts}`);
      }
    }
  }
}

export default DrivingFun;
