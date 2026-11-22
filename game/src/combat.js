// Solmar Heat — combat: weapon system (pistol / shotgun / rifle / SMG).
// Four tiers with distinct feel (damage, fire rate, spread, range), mag +
// reserve ammo, reloads, weapon switching (1/2/3/4 + mouse wheel), and a
// generic ray-vs-target hit test so any shootable thing (police cars,
// pedestrians, vehicles, future gang members in missions) can take damage
// through the same interface: a target needs `position`, `aimHeight`,
// `radius`, and a `takeDamage(amount)` returning 'down' | 'hit' | null
// (vehicles return 'destroyed' instead of 'down' — see vehicles.js).
// Attachments (v3, shop-bought, per weapon): extended magazine (+50% mag)
// and tactical scope (tighter spread). They persist on state.weapons
// (see ensureWeaponState / saveShape / applySave in state.js).

// Cover-shootout bonus (v3, Builder 4): firing from behind cover —
// crouched next to a wall, car or roadblock — halves the weapon spread.
// COVER_DAMAGE_MULT is applied in player.takeDamage: shots that reach a
// player in cover hurt 40% less.
export const COVER_SPREAD_MULT = 0.5;
export const COVER_DAMAGE_MULT = 0.6;

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
  // v3 tier 4 (Builder 3): fast full-auto SMG — medium damage, high fire
  // rate, best at near-to-mid range. Bought at Solmar Arms for $3200.
  smg: {
    id: 'smg', name: 'SMG', slot: 4,
    damage: 16, fireInterval: 0.07, spread: 0.03, range: 55,
    pellets: 1, magSize: 32, reserveAmmo: 96, reloadTime: 1.4,
    auto: true, shake: 0.14,
  },
};

export const WEAPON_ORDER = ['pistol', 'shotgun', 'rifle', 'smg'];

// Attachments: bought in the shop for the currently selected weapon.
// mag: +50% magazine capacity. scope: spread x0.6 (tighter, more accurate).
export const ATTACHMENT_DEFS = {
  mag: { id: 'mag', name: 'Extended Magazine', price: 900, desc: '+50% magazine capacity' },
  scope: { id: 'scope', name: 'Tactical Scope', price: 1200, desc: 'Tighter spread, better accuracy' },
};
export const MAG_CAPACITY_MULT = 1.5;
export const SCOPE_SPREAD_MULT = 0.6;

export function ensureAttachments() {
  const w = ensureWeaponState();
  if (!w.attachments || typeof w.attachments !== 'object') {
    w.attachments = { mag: {}, scope: {} };
  }
  if (!w.attachments.mag || typeof w.attachments.mag !== 'object') w.attachments.mag = {};
  if (!w.attachments.scope || typeof w.attachments.scope !== 'object') w.attachments.scope = {};
  return w.attachments;
}

export function hasAttachment(kind, id) {
  if (!ATTACHMENT_DEFS[kind]) return false;
  return !!ensureAttachments()[kind][id];
}

export function ownAttachment(kind, id) {
  if (!ATTACHMENT_DEFS[kind] || !WEAPONS[id]) return false;
  ensureAttachments()[kind][id] = true;
  return true;
}

// Effective stats with attachments applied (mag size / spread).
export function effectiveMagSize(id) {
  const w = WEAPONS[id];
  if (!w) return 0;
  return hasAttachment('mag', id) ? Math.round(w.magSize * MAG_CAPACITY_MULT) : w.magSize;
}

export function effectiveSpread(id) {
  const w = WEAPONS[id];
  if (!w) return 0;
  return hasAttachment('scope', id) ? w.spread * SCOPE_SPREAD_MULT : w.spread;
}

// Ammo lives on the shared state object so HUD / saves can read it; the
// Combat instance is the only writer. Ownership (shop.js, v3): the pistol
// is Rico's from the start; shotgun / rifle / SMG are bought at Solmar Arms.
// A state without an `owned` block (pre-v3 save) keeps the first three
// weapons; the SMG is new in v3, so it stays locked even on old saves.
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
    // No ownership record: a pre-v3 save — grandfather the first three.
    state.weapons.owned = { pistol: true, shotgun: true, rifle: true, smg: false };
  } else {
    for (const id of WEAPON_ORDER) {
      if (typeof state.weapons.owned[id] !== 'boolean') state.weapons.owned[id] = id === 'pistol';
    }
  }
  // Attachments block, inlined here (ensureAttachments() calls this fn,
  // so calling it back would recurse).
  if (!state.weapons.attachments || typeof state.weapons.attachments !== 'object') {
    state.weapons.attachments = { mag: {}, scope: {} };
  }
  if (!state.weapons.attachments.mag || typeof state.weapons.attachments.mag !== 'object') {
    state.weapons.attachments.mag = {};
  }
  if (!state.weapons.attachments.scope || typeof state.weapons.attachments.scope !== 'object') {
    state.weapons.attachments.scope = {};
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
    // v3 cover bonus (Builder 4): set by the player when crouched behind
    // cover; halves the effective spread of the next shots. Crew gunners
    // never set this — it only ever applies to Rico's own Combat instance.
    this.coverBonus = false;
    this._tmp = new THREE.Vector3();
    this._tmpDir = new THREE.Vector3();
  }

  get currentId() { return ensureWeaponState().current; }
  get current() { return WEAPONS[this.currentId]; }

  // Effective stats with attachments applied (see combat.js top).
  magSizeFor(id) { return effectiveMagSize(id || this.currentId); }
  spreadFor(id) { return effectiveSpread(id || this.currentId); }
  hasAttachment(kind, id) { return hasAttachment(kind, id || this.currentId); }

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
    if (this.reloading || a.mag >= effectiveMagSize(w.id) || a.reserve <= 0) return false;
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
        const need = effectiveMagSize(w.id) - a.mag;
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
      // Cover bonus: crouched behind cover, the shot groups half as wide.
      const spread = effectiveSpread(w.id) * (this.coverBonus ? COVER_SPREAD_MULT : 1);
      const sx = (rng() * 2 - 1) * spread;
      const sy = (rng() * 2 - 1) * spread;
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
