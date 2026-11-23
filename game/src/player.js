// Solmar Heat — player: on-foot character Rico Vega.
// Simple built-from-boxes figure, WASD movement relative to camera yaw,
// sprint, punch (Q/F), shooting (mouse click) via a subscribe hook that the
// effects module (part C) can listen to, health and the WASTED state.

import * as THREE from 'three';
import { CITY, TUNING, PLAYER_HEALTH } from './config.js';
import { state, damagePlayer, healPlayer } from './state.js';
import { Combat, COVER_DAMAGE_MULT } from './combat.js';

const PUNCH_RANGE = 2.2;
const PUNCH_DAMAGE = 25;
const PUNCH_COOLDOWN = 0.45;
// Cover shootouts (v3, Builder 4): crouched within this distance of a
// wall / car / roadblock edge, Rico counts as "in cover" — tighter shots
// (see combat.js COVER_SPREAD_MULT) and 40% less incoming damage.
export const COVER_CHECK_RANGE = 2.0;
const CROUCH_SPEED_MULT = 0.55;
const CROUCH_SCALE_Y = 0.72;

// Is `pos` close enough to something solid to hide behind? Uses the
// existing box colliders (buildings, roadblocks) plus live vehicles
// (parked / traffic cars, wrecked ones do not count — a burning wreck is
// no cover). Pure function so the harness can test it without a scene.
export function isNearCover(pos, colliders, vehicles) {
  for (const c of colliders || []) {
    const nx = Math.max(c.x - c.halfX, Math.min(pos.x, c.x + c.halfX));
    const nz = Math.max(c.z - c.halfZ, Math.min(pos.z, c.z + c.halfZ));
    const dx = pos.x - nx;
    const dz = pos.z - nz;
    if (dx * dx + dz * dz <= COVER_CHECK_RANGE * COVER_CHECK_RANGE) return true;
  }
  for (const v of vehicles || []) {
    if (!v || v.wrecked || !v.position) continue;
    const r = (v.stats && v.stats.radius) || v.radius || 1.6;
    const dx = pos.x - v.position.x;
    const dz = pos.z - v.position.z;
    if (dx * dx + dz * dz <= (r + 1.2) * (r + 1.2)) return true;
  }
  return false;
}

function clampToCity(v) {
  // v4: the west edge opens onto the docks — Rico can walk out to the pier
  // (x -420) to board a boat; the other three sides stay at +/-320.
  v.x = Math.max(-420, Math.min(CITY.halfSize, v.x));
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
    this.walkPhase = 0;
    // v3 cover shootouts (Builder 4): C on foot toggles the crouch.
    // inCover is recomputed every frame in update(): crouched AND next to
    // something solid. Standing up or stepping away clears it again.
    this.crouching = false;
    this.inCover = false;
    this.health = state.health;
    this.combat = new Combat();   // weapon system: pistol / shotgun / rifle / SMG
    this._targetProvider = null;  // fn() -> shootable targets, set by main.js
    this._shootListeners = [];
    this._punchListeners = [];
  }

  // main.js supplies the live target list (cops, pedestrians, gang members).
  setTargetProvider(fn) { this._targetProvider = fn; }

  selectWeapon(id) { return this.combat.select(id); }
  cycleWeapon(dir) { return this.combat.cycle(dir); }
  reloadWeapon() { return this.combat.startReload(); }

  // Crouch / stand (C on foot — the radio owns C while driving). Crouching
  // alone is just a low stance; the cover bonuses only apply while
  // crouched next to something solid (see update()).
  toggleCrouch() {
    if (!this.onFoot || this.wasted) return false;
    this.crouching = !this.crouching;
    this.mesh.scale.y = this.crouching ? CROUCH_SCALE_Y : 1;
    if (!this.crouching) {
      this.inCover = false;
      this.combat.coverBonus = false;
    }
    return this.crouching;
  }

  setCrouch(on) {
    if (!!on !== this.crouching) return this.toggleCrouch();
    return this.crouching;
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

  // Fire the current weapon. Returns the combat result object when a shot
  // went off (truthy), or false when it could not fire (cooldown, empty,
  // reloading, in a car, wasted). Empty mag returns { fired:false, empty:true }
  // so the caller can play a dry-fire click.
  shoot(camera) {
    if (!this.onFoot || this.wasted) return false;
    const from = this.position.clone().add(new THREE.Vector3(0, this.crouching ? 1.1 : 1.5, 0));
    const dir = new THREE.Vector3();
    if (camera) camera.getWorldDirection(dir);
    else dir.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    const targets = this._targetProvider ? this._targetProvider() : [];
    const res = this.combat.fire(from, dir, targets);
    if (!res.fired) return res;
    const evt = {
      from, dir, to: res.endPoint, range: res.weapon.range,
      weapon: res.weapon.id, hits: res.hits,
    };
    if (this._shootListeners.length) {
      for (const fn of this._shootListeners) { try { fn(evt); } catch { /* listener error must not break shooting */ } }
    } else {
      this._fallbackTracer(from, res.endPoint);
    }
    return res;
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
    // In cover, incoming damage is reduced 40% (after the crouch check —
    // standing in the open never gets the reduction, even next to a wall).
    const taken = this.inCover ? amount * COVER_DAMAGE_MULT : amount;
    const left = damagePlayer(taken);
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
    this.crouching = false;
    this.inCover = false;
    this.combat.coverBonus = false;
    this.mesh.scale.y = 1;
    this.mesh.rotation.z = 0;
    this.mesh.position.copy(startPos);
    this.mesh.position.y = 0;
    this.heading = 0;
  }

  update(dt, inp, cameraYaw, colliders, coverVehicles) {
    this.combat.update(dt); // reload / fire cooldown keep ticking in a car too
    // Getting in a car stands Rico back up: cover only ever applies on foot.
    if (!this.onFoot && this.crouching) {
      this.crouching = false;
      this.inCover = false;
      this.combat.coverBonus = false;
      this.mesh.scale.y = 1;
    }
    if (this.wasted || !this.onFoot) return;
    this.punchTimer = Math.max(0, this.punchTimer - dt);
    const axes = inp.axes();
    const sprint = inp.sprinting && !this.crouching;
    const speed = (sprint ? TUNING.runSpeed : TUNING.walkSpeed)
      * (this.crouching ? CROUCH_SPEED_MULT : 1);
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
    // Cover check: crouched AND next to a wall, a car or a roadblock.
    // Standing up or stepping away from the solid object clears it, and
    // the spread / damage bonuses go away with it.
    this.inCover = this.crouching && isNearCover(this.position, colliders, coverVehicles);
    this.combat.coverBonus = this.inCover;
    // Keep the shared state pointer in sync for HUD / missions / police.
    state.player = { position: this.position, heading: this.heading, onFoot: this.onFoot, vehicle: this.vehicle, crouching: this.crouching, inCover: this.inCover };
  }
}

export default Player;
