// Solmar Heat — combat: weapon system (pistol / shotgun / rifle).
// Three tiers with distinct feel (damage, fire rate, spread, range), mag +
// reserve ammo, reloads, weapon switching (1/2/3 + mouse wheel), and a
// generic ray-vs-target hit test so any shootable thing (police cars,
// pedestrians, future gang members in missions) can take damage through the
// same interface: a target needs `position`, `aimHeight`, `radius`, and a
// `takeDamage(amount)` returning 'down' | 'hit' | null.

import * as THREE from 'three';
import { state } from './state.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'Pistol', slot: 1,
    damage: 34, fireInterval: 0.28, spread: 0.012, range: 70,
    pellets: 1, magSize: 12, reserveAmmo: 48, reloadTime: 1.0,
    auto: false, shake: 0.12,
  },
  shotgun: {
    id: 'shotgun', name: 'Shotgun', slot: 2,
    damage: 14, fireInterval: 0.85, spread: 0.085, range: 32,
    pellets: 8, magSize: 6, reserveAmmo: 24, reloadTime: 1.7,
    auto: false, shake: 0.35,
  },
  rifle: {
    id: 'rifle', name: 'Rifle', slot: 3,
    damage: 26, fireInterval: 0.11, spread: 0.022, range: 110,
    pellets: 1, magSize: 30, reserveAmmo: 90, reloadTime: 1.9,
    auto: true, shake: 0.18,
  },
};

export const WEAPON_ORDER = ['pistol', 'shotgun', 'rifle'];

// Ammo lives on the shared state object so HUD / saves can read it; the
// Combat instance is the only writer. Ownership (shop.js, v3): the pistol
// is Rico's from the start; shotgun / rifle are bought at Solmar Arms.
// A state without an `owned` block (pre-v3 save) keeps all three weapons.
export function ensureWeaponState() {
  if (!state.weapons) {
    state.weapons = { current: 'pistol', owned: {}, ammo: {} };
  }
  if (!state.weapons.ammo) state.weapons.ammo = {};
  for (const id of WEAPON_ORDER) {
    const def = WEAPONS[id];
    const a = state.weapons.ammo[id];
    if (!a || typeof a.mag !== 'number' || typeof a.reserve !== 'number') {
      state.weapons.ammo[id] = { mag: def.magSize, reserve: def.reserveAmmo };
    }
  }
  if (!state.weapons.owned || typeof state.weapons.owned !== 'object') {
    // No ownership record: a pre-v3 save — grandfather all three.
    state.weapons.owned = { pistol: true, shotgun: true, rifle: true };
  } else {
    for (const id of WEAPON_ORDER) {
      if (typeof state.weapons.owned[id] !== 'boolean') state.weapons.owned[id] = id === 'pistol';
    }
  }
  if (!WEAPONS[state.weapons.current]) state.weapons.current = 'pistol';
  return state.weapons;
}

// Mark a weapon as owned (shop purchase, or the combat shot setup).
export function ownWeapon(id) {
  if (!WEAPONS[id]) return false;
  ensureWeaponState().owned[id] = true;
  return true;
}

export function isOwned(id) {
  return !!ensureWeaponState().owned[id];
}

function targetCenter(target, out) {
  out.copy(target.position);
  out.y += target.aimHeight ?? 1.0;
  return out;
}

// Ray vs sphere: nearest hit of one pellet ray against one target, or null.
function rayHitTarget(origin, dir, target, range, tmp) {
  if (!target || !target.position) return null;
  const c = targetCenter(target, tmp);
  const r = target.radius ?? 1.0;
  const ox = c.x - origin.x;
  const oy = c.y - origin.y;
  const oz = c.z - origin.z;
  const t = ox * dir.x + oy * dir.y + oz * dir.z;
  if (t < 0 || t > range) return null;
  const cx = origin.x + dir.x * t;
  const cy = origin.y + dir.y * t;
  const cz = origin.z + dir.z * t;
  const d2 = (cx - c.x) ** 2 + (cy - c.y) ** 2 + (cz - c.z) ** 2;
  if (d2 > r * r) return null;
  return { target, dist: t, point: new THREE.Vector3(cx, cy, cz) };
}

// Apply damage through the target's own hook, or knockDown() as a fallback.
export function damageTarget(target, amount) {
  if (!target) return null;
  if (typeof target.takeDamage === 'function') return target.takeDamage(amount);
  if (typeof target.knockDown === 'function') {
    return target.knockDown() ? 'down' : null;
  }
  return 'hit';
}

export class Combat {
  constructor() {
    ensureWeaponState();
    this.cooldown = 0;      // seconds until the next shot may fire
    this.reloading = false;
    this.reloadTimer = 0;
    this._tmp = new THREE.Vector3();
    this._tmpDir = new THREE.Vector3();
  }

  get currentId() { return ensureWeaponState().current; }
  get current() { return WEAPONS[this.currentId]; }

  ammo(id) {
    const a = ensureWeaponState().ammo[id || this.currentId];
    return { mag: a.mag, reserve: a.reserve };
  }

  get mag() { return this.ammo().mag; }
  get reserve() { return this.ammo().reserve; }
  get isEmpty() { return this.mag <= 0; }

  // Mark a weapon as owned (shop purchase, or the combat shot setup).
  ownWeapon(id) {
    return ownWeapon(id);
  }

  owns(id) {
    return isOwned(id);
  }

  select(id) {
    if (!WEAPONS[id] || id === this.currentId) return false;
    if (!ensureWeaponState().owned[id]) return false; // not bought yet
    this.cancelReload();
    ensureWeaponState().current = id;
    this.cooldown = Math.max(this.cooldown, 0.15); // brief swap delay
    return true;
  }

  cycle(dir = 1) {
    // Skip weapons the player has not bought yet; never get stuck on one.
    for (let step = 1; step <= WEAPON_ORDER.length; step++) {
      const i = WEAPON_ORDER.indexOf(this.currentId);
      const next = WEAPON_ORDER[(i + dir * step + WEAPON_ORDER.length) % WEAPON_ORDER.length];
      if (this.select(next)) return true;
    }
    return false;
  }

  startReload() {
    const w = this.current;
    const a = ensureWeaponState().ammo[w.id];
    if (this.reloading || a.mag >= w.magSize || a.reserve <= 0) return false;
    this.reloading = true;
    this.reloadTimer = w.reloadTime;
    return true;
  }

  cancelReload() {
    this.reloading = false;
    this.reloadTimer = 0;
  }

  update(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.reloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        this.reloading = false;
        const w = this.current;
        const a = ensureWeaponState().ammo[w.id];
        const need = w.magSize - a.mag;
        const moved = Math.min(need, a.reserve);
        a.mag += moved;
        a.reserve -= moved;
      }
    }
  }

  // Fire one trigger pull from `origin` along `dir` at `targets`.
  // Returns { fired, empty, reloading, hits, endPoint, weapon }.
  // `rng` is injectable so tests can fix the spread.
  fire(origin, dir, targets, rng = Math.random) {
    const w = this.current;
    if (this.reloading) return { fired: false, empty: false, reloading: true, hits: [], weapon: w };
    if (this.cooldown > 0) return { fired: false, empty: false, reloading: false, hits: [], weapon: w };
    const a = ensureWeaponState().ammo[w.id];
    if (a.mag <= 0) return { fired: false, empty: true, reloading: false, hits: [], weapon: w };

    a.mag -= 1;
    this.cooldown = w.fireInterval;
    const hits = [];
    let endPoint = null;
    let bestDist = Infinity;
    for (let p = 0; p < w.pellets; p++) {
      // Spread: perturb the direction in the plane perpendicular to it.
      const d = this._tmpDir.copy(dir).normalize();
      // Build a stable perpendicular basis.
      const up = Math.abs(d.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const right = new THREE.Vector3().crossVectors(d, up).normalize();
      const up2 = new THREE.Vector3().crossVectors(right, d).normalize();
      const sx = (rng() * 2 - 1) * w.spread;
      const sy = (rng() * 2 - 1) * w.spread;
      const ray = d.clone()
        .addScaledVector(right, sx)
        .addScaledVector(up2, sy)
        .normalize();
      let best = null;
      for (const t of targets || []) {
        const hit = rayHitTarget(origin, ray, t, w.range, this._tmp);
        if (hit && (!best || hit.dist < best.dist)) best = hit;
      }
      if (best) {
        const result = damageTarget(best.target, w.damage);
        hits.push({ target: best.target, damage: w.damage, point: best.point, result });
        if (best.dist < bestDist) { bestDist = best.dist; endPoint = best.point; }
      }
    }
    if (!endPoint) {
      endPoint = origin.clone().add(dir.clone().multiplyScalar(w.range));
    }
    return { fired: true, empty: false, reloading: false, hits, endPoint, weapon: w };
  }

  // Ammo pickup: add `amount` to the reserve of `id` (default current).
  giveAmmo(id, amount) {
    const wid = WEAPONS[id] ? id : this.currentId;
    ensureWeaponState().ammo[wid].reserve += Math.max(0, amount);
    return this.ammo(wid);
  }
}

export default Combat;
