// Solmar Heat — player: on-foot character Rico Vega.
// Simple built-from-boxes figure, WASD movement relative to camera yaw,
// sprint, punch (Q/F), shooting (mouse click) via a subscribe hook that the
// effects module (part C) can listen to, health and the WASTED state.

import * as THREE from 'three';
import { CITY, TUNING, PLAYER_HEALTH } from './config.js';
import { state, damagePlayer, healPlayer } from './state.js';

const PUNCH_RANGE = 2.2;
const PUNCH_DAMAGE = 25;
const PUNCH_COOLDOWN = 0.45;
const SHOT_COOLDOWN = 0.22;
const SHOT_RANGE = 90;

function clampToCity(v) {
  v.x = Math.max(-CITY.halfSize, Math.min(CITY.halfSize, v.x));
  v.z = Math.max(-CITY.halfSize, Math.min(CITY.halfSize, v.z));
  return v;
}

// Circle-vs-box push-out against city building colliders.
export function collideCircle(pos, radius, colliders) {
  if (!colliders) return;
  for (const c of colliders) {
    const nx = Math.max(c.x - c.halfX, Math.min(pos.x, c.x + c.halfX));
    const nz = Math.max(c.z - c.halfZ, Math.min(pos.z, c.z + c.halfZ));
    const dx = pos.x - nx;
    const dz = pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius && d2 > 0.0001) {
      const d = Math.sqrt(d2);
      pos.x = nx + (dx / d) * radius;
      pos.z = nz + (dz / d) * radius;
    } else if (d2 <= 0.0001) {
      pos.x += radius;
    }
  }
}

function buildFigure() {
  const g = new THREE.Group();
  g.name = 'rico-vega';
  const skin = new THREE.MeshStandardMaterial({ color: 0xc98d5f, roughness: 0.8 });
  const jacket = new THREE.MeshStandardMaterial({ color: 0x1e6f5c, roughness: 0.7 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.9 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 0.9 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.78, 0.36), jacket);
  torso.position.y = 1.12;
  torso.castShadow = true;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.34), skin);
  head.position.y = 1.72;
  head.castShadow = true;
  g.add(head);
  const hairTop = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.36), hair);
  hairTop.position.y = 1.92;
  g.add(hairTop);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.72, 0.26), pants);
  legL.position.set(-0.17, 0.36, 0);
  legL.castShadow = true;
  g.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.17;
  g.add(legR);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.62, 0.2), jacket);
  armL.position.set(-0.42, 1.14, 0);
  armL.castShadow = true;
  g.add(armL);
  const armR = armL.clone();
  armR.position.x = 0.42;
  g.add(armR);
  g.userData.legs = [legL, legR];
  g.userData.arms = [armL, armR];
  return g;
}

export class Player {
  constructor(scene, startPos) {
    this.mesh = buildFigure();
    this.mesh.position.copy(startPos || new THREE.Vector3(0, 0, 0));
    scene.add(this.mesh);
    this.scene = scene;
    this.position = this.mesh.position;
    this.heading = 0;            // facing angle, radians
    this.speed = 0;
    this.onFoot = true;
    this.vehicle = null;
    this.wasted = false;
    this.punchTimer = 0;
    this.shotTimer = 0;
    this.walkPhase = 0;
    this.health = state.health;
    this._shootListeners = [];
    this._punchListeners = [];
  }

  // Effects (part C) subscribes: onShoot(({from, dir, hitPoint}) => ...)
  onShoot(fn) { this._shootListeners.push(fn); return () => { this._shootListeners = this._shootListeners.filter((f) => f !== fn); }; }
  onPunch(fn) { this._punchListeners.push(fn); return () => { this._punchListeners = this._punchListeners.filter((f) => f !== fn); }; }

  // Simple tracer fallback if no effects module is listening: a fading line.
  _fallbackTracer(from, to) {
    const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9 }));
    this.scene.add(line);
    const born = performance.now();
    const tick = () => {
      const age = performance.now() - born;
      if (age > 90) { this.scene.remove(line); geo.dispose(); line.material.dispose(); return; }
      line.material.opacity = 0.9 * (1 - age / 90);
      requestAnimationFrame(tick);
    };
    tick();
  }

  shoot(camera) {
    if (!this.onFoot || this.wasted || this.shotTimer > 0) return false;
    this.shotTimer = SHOT_COOLDOWN;
    const from = this.position.clone().add(new THREE.Vector3(0, 1.5, 0));
    const dir = new THREE.Vector3();
    if (camera) camera.getWorldDirection(dir);
    else dir.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    const to = from.clone().add(dir.clone().multiplyScalar(SHOT_RANGE));
    const evt = { from, dir, to, range: SHOT_RANGE };
    if (this._shootListeners.length) {
      for (const fn of this._shootListeners) { try { fn(evt); } catch { /* listener error must not break shooting */ } }
    } else {
      this._fallbackTracer(from, to);
    }
    return true;
  }

  punch(targets) {
    if (!this.onFoot || this.wasted || this.punchTimer > 0) return false;
    this.punchTimer = PUNCH_COOLDOWN;
    const forward = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    let hit = null;
    for (const t of targets || []) {
      if (!t || !t.position) continue;
      const d = t.position.clone().sub(this.position);
      d.y = 0;
      if (d.length() < PUNCH_RANGE && d.normalize().dot(forward) > 0.3) { hit = t; break; }
    }
    const evt = { hit, damage: PUNCH_DAMAGE };
    for (const fn of this._punchListeners) { try { fn(evt); } catch { /* ignore */ } }
    return hit;
  }

  takeDamage(amount) {
    if (this.wasted) return 0;
    const left = damagePlayer(amount);
    this.health = left;
    if (left <= 0) {
      this.wasted = true;
      state.gameOver = true;
      this.mesh.rotation.z = Math.PI / 2; // fall over
      this.mesh.position.y = 0.4;
    }
    return left;
  }

  heal(amount) {
    this.health = healPlayer(amount);
    return this.health;
  }

  respawn(startPos) {
    this.health = PLAYER_HEALTH;
    state.health = PLAYER_HEALTH;
    state.gameOver = false;
    this.wasted = false;
    this.mesh.rotation.z = 0;
    this.mesh.position.copy(startPos);
    this.mesh.position.y = 0;
    this.heading = 0;
  }

  update(dt, inp, cameraYaw, colliders) {
    if (this.wasted || !this.onFoot) return;
    this.punchTimer = Math.max(0, this.punchTimer - dt);
    this.shotTimer = Math.max(0, this.shotTimer - dt);
    const axes = inp.axes();
    const sprint = inp.sprinting;
    const speed = sprint ? TUNING.runSpeed : TUNING.walkSpeed;
    // Camera-relative movement: forward is where the camera looks.
    const sin = Math.sin(cameraYaw);
    const cos = Math.cos(cameraYaw);
    const mx = (-sin * axes.y + cos * axes.x);
    const mz = (-cos * axes.y - sin * axes.x);
    const len = Math.hypot(mx, mz);
    if (len > 0.01) {
      const nx = mx / len;
      const nz = mz / len;
      this.position.x += nx * speed * dt;
      this.position.z += nz * speed * dt;
      this.speed = speed;
      this.heading = Math.atan2(nx, nz);
      this.walkPhase += dt * speed * 1.6;
      const swing = Math.sin(this.walkPhase) * 0.5;
      this.mesh.userData.legs[0].rotation.x = swing;
      this.mesh.userData.legs[1].rotation.x = -swing;
      this.mesh.userData.arms[0].rotation.x = -swing * 0.7;
      this.mesh.userData.arms[1].rotation.x = swing * 0.7;
    } else {
      this.speed = 0;
      this.mesh.userData.legs[0].rotation.x *= 0.8;
      this.mesh.userData.legs[1].rotation.x *= 0.8;
      this.mesh.userData.arms[0].rotation.x *= 0.8;
      this.mesh.userData.arms[1].rotation.x *= 0.8;
    }
    this.mesh.rotation.y = this.heading;
    clampToCity(this.position);
    collideCircle(this.position, 0.5, colliders);
    // Keep the shared state pointer in sync for HUD / missions / police.
    state.player = { position: this.position, heading: this.heading, onFoot: this.onFoot, vehicle: this.vehicle };
  }
}

export default Player;
