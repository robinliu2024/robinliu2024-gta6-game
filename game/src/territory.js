// Solmar Heat — territory: three turf zones (Harbor / Downtown / Suburbs).
// Capture a zone by finishing M10 (Downtown, via the missions.js hook) or by
// taking down 3 police officers inside an unowned zone. Owned zones pay
// $400 each per game day (one day = 240 s, matching the day/night cycle),
// slow the police response inside the zone (wanted cools faster, busts take
// longer — the same modifier channel police.js already reads for the crew
// driver), and calm the locals (pedestrians stop fleeing gunfire there).
// Ownership + cop-down progress live in state.territory so saves carry them.
// Pure logic here is DOM-free so the harness can import it in Node; the
// ground rings are built only when a scene is passed in.

import * as THREE from 'three';
import { CITY, DISTRICTS } from './config.js';
import { state, addMoney, addRep } from './state.js';
import { collideCircle } from './player.js';

export const TERRITORY_DAY_SECONDS = 240; // one game day, matches city.js DAY_LENGTH
export const INCOME_PER_ZONE_PER_DAY = 400;
export const COP_DOWNS_TO_CAPTURE = 3;
// Police response inside owned turf: wanted decays 40% faster, busts take
// 40% longer. Multiplied with the crew-driver modifiers in main.js.
export const OWNED_DECAY_MULT = 0.6;
export const OWNED_BUST_HOLD_MULT = 1.4;
// --- Territory defense (v4, B6) -------------------------------------------
// A captured district occasionally gets attacked by a rival crew: three
// armed rivals spawn at the zone centre, a HUD alert goes out, and Rico
// has DEFENSE_DURATION seconds to drop them all. Hold the zone and it
// keeps paying its daily income plus a small defense bonus; lose it
// (timer out, or Rico wasted / busted mid-fight) and the zone — and its
// income — goes back to the rivals. Attacks brew on a timer only while
// Rico owns at least one zone, and only after a grace period, so a fresh
// capture is never instantly attacked.
export const DEFENSE_ATTACKERS = 3;
export const DEFENSE_DURATION = 120; // seconds to clear the attackers
export const DEFENSE_WIN_BONUS = 200;
export const DEFENSE_WIN_REP = 10;
export const DEFENSE_MIN_DELAY = 75;  // earliest first attack after owning turf
export const DEFENSE_MAX_DELAY = 135; // latest first attack
export const DEFENSE_COOLDOWN = 60;   // quiet time after a defense resolves
const RIVAL_SPEED = 6.2;
const RIVAL_SHOOT_RANGE = 30;
const RIVAL_SHOOT_MIN_RANGE = 4;
const RIVAL_SHOOT_INTERVAL = 1.4;
const RIVAL_DAMAGE = 6;
const RIVAL_HIT_CHANCE = 0.5;

// A rival crew member on foot: crimson shirt, pistol in hand. Reuses the
// foot-cop movement + shooting pattern (chase the player, shoot from
// mid-range with tracers) but never busts — rivals fight, they don't
// arrest. Same combat interface as police / pedestrians: `position`,
// `aimHeight`, `radius`, `takeDamage(amount)` returning 'down' | 'hit'.
function buildRivalMesh() {
  const g = new THREE.Group();
  g.name = 'rival-crew';
  const crimson = new THREE.MeshStandardMaterial({ color: 0x8a1a1a, roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc98d5f, roughness: 0.8 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x141a22, roughness: 0.9 });
  const bandana = new THREE.MeshStandardMaterial({ color: 0x3a0a0a, roughness: 0.7 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.72, 0.34), crimson);
  torso.position.y = 1.06;
  torso.castShadow = true;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.32), skin);
  head.position.y = 1.62;
  g.add(head);
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.36), bandana);
  band.position.y = 1.84;
  g.add(band);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.64, 0.24), pants);
  legL.position.set(-0.16, 0.32, 0);
  g.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.16;
  g.add(legR);
  const gun = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.1, 0.34),
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5, metalness: 0.6 }),
  );
  gun.position.set(0.42, 0.95, 0.2);
  g.add(gun);
  g.userData.legs = [legL, legR];
  return g;
}

export class RivalAttacker {
  constructor(scene, pos, colliders) {
    this.scene = scene;
    this.colliders = colliders || [];
    this.mesh = buildRivalMesh();
    this.mesh.position.copy(pos);
    scene.add(this.mesh);
    this.position = this.mesh.position;
    this.heading = 0;
    this.speed = RIVAL_SPEED;
    this.walkPhase = Math.random() * 6;
    this.health = 100;
    this.maxHealth = 100;
    this.aimHeight = 1.1;
    this.radius = 0.6;
    this.fireTimer = 0.8 + Math.random() * 0.8;
    this.down = false;
    this.alive = true;
  }

  // Returns 'down' when this shot neutralizes the rival, 'hit' when it
  // only wounds, null when already down.
  takeDamage(amount) {
    if (this.down) return null;
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.down = true;
      this.alive = false;
      this.mesh.rotation.z = Math.PI / 2;
      this.mesh.position.y = 0.3;
      return 'down';
    }
    return 'hit';
  }

  // Chase the player on foot and shoot from mid-range. `effects`
  // (tracers / muzzle flash) is optional — without it the rival still
  // shoots, just without tracers.
  update(dt, player, effects) {
    if (this.down || !player || player.wasted) return;
    const to = player.position.clone().sub(this.position);
    to.y = 0;
    const dist = to.length();
    if (dist > RIVAL_SHOOT_MIN_RANGE && dist < RIVAL_SHOOT_RANGE) {
      this.fireTimer -= dt;
      if (this.fireTimer <= 0) {
        this.fireTimer = RIVAL_SHOOT_INTERVAL * (0.85 + Math.random() * 0.3);
        const from = this.position.clone();
        from.y += 1.4;
        const aim = player.position.clone();
        aim.y += player.crouching ? 0.9 : 1.3;
        if (effects && typeof effects.spawnTracer === 'function') {
          effects.spawnTracer(from, aim);
          if (typeof effects.spawnMuzzle === 'function') {
            const dir = aim.clone().sub(from).normalize();
            effects.spawnMuzzle(from, dir);
          }
        }
        if (Math.random() < RIVAL_HIT_CHANCE && typeof player.takeDamage === 'function') {
          player.takeDamage(RIVAL_DAMAGE);
        }
      }
    }
    if (dist >= 2) {
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

  dispose() {
    this.scene.remove(this.mesh);
    this.alive = false;
  }
}

// Zone centres anchor on the districts in config.js: Harbor covers the
// Harbor/Marina west coast, Downtown covers Downtown + the Marlin Club,
// Suburbs covers the Boardwalk and the east-side Safehouse blocks.
// Each zone lists its district anchors (centre + radius from DISTRICTS);
// a point inside an anchor belongs to that zone, anything else falls to
// the nearest zone centre — so every point on the map belongs to a zone.
export const TERRITORY_ZONES = [
  {
    id: 'harbor', name: 'Harbor', x: -220, z: 0, r: 170,
    anchors: [DISTRICTS.harbor, DISTRICTS.marina],
  },
  {
    id: 'downtown', name: 'Downtown', x: 40, z: 20, r: 150,
    anchors: [DISTRICTS.downtown, DISTRICTS.marlinClub],
  },
  {
    id: 'suburbs', name: 'Suburbs', x: 190, z: 90, r: 170,
    anchors: [DISTRICTS.boardwalk, DISTRICTS.safehouse],
  },
];

export function zoneDef(id) {
  return TERRITORY_ZONES.find((z) => z.id === id) || null;
}

// Anchor first (a point on the Boardwalk is Suburbs, even though the
// Harbor zone centre is closer), nearest centre as the fallback.
export function zoneAt(x, z) {
  for (const zone of TERRITORY_ZONES) {
    for (const a of zone.anchors) {
      const dx = x - a.x;
      const dz = z - a.z;
      if (dx * dx + dz * dz <= a.r * a.r) return zone.id;
    }
  }
  let best = TERRITORY_ZONES[0];
  let bestD = Infinity;
  for (const zone of TERRITORY_ZONES) {
    const d = (zone.x - x) * (zone.x - x) + (zone.z - z) * (zone.z - z);
    if (d < bestD) { bestD = d; best = zone; }
  }
  return best.id;
}

export function defaultTerritory() {
  return {
    owned: [], copDowns: { harbor: 0, downtown: 0, suburbs: 0 }, totalEarned: 0,
    // Defense snapshot (v4): null, or { zoneId, attackersLeft, timeLeft }
    // while an attack is running. Restored by TerritoryManager.update().
    defense: null,
  };
}

export function ensureTerritoryState() {
  if (!state.territory || typeof state.territory !== 'object') state.territory = defaultTerritory();
  if (!state.territory.copDowns || typeof state.territory.copDowns !== 'object'
    || Array.isArray(state.territory.copDowns)) {
    state.territory.copDowns = { harbor: 0, downtown: 0, suburbs: 0 };
  }
  if (!Array.isArray(state.territory.owned)) state.territory.owned = [];
  if (typeof state.territory.totalEarned !== 'number') state.territory.totalEarned = 0;
  for (const z of TERRITORY_ZONES) {
    if (typeof state.territory.copDowns[z.id] !== 'number') state.territory.copDowns[z.id] = 0;
  }
  // Defense (v4): a live attack is snapshotted here so a save made
  // mid-fight restores the fight on load. Older saves have no field.
  if (state.territory.defense !== null && typeof state.territory.defense !== 'object') {
    state.territory.defense = null;
  }
  if (!('defense' in state.territory)) state.territory.defense = null;
  return state.territory;
}

export class TerritoryManager {
  constructor(scene, opts = {}) {
    this.scene = scene || null;
    this.colliders = opts.colliders || [];
    // Effects module for rival tracers / muzzle flashes; set by main.js
    // after effects exist (null is fine — rivals still shoot, just
    // without tracers). Same pattern as police.effects.
    this.effects = null;
    this.onCapture = null; // fn(zoneDef) — main.js toasts + stings
    this.onIncome = null;  // fn(amount, ownedCount) — main.js toasts
    this.onDefenseStart = null; // fn(zoneDef) — main.js alerts
    this.onDefenseWon = null;   // fn(zoneDef, bonus) — main.js toasts + saves
    this.onDefenseLost = null;  // fn(zoneDef, reason) — main.js toasts + saves
    // Live defense: { zoneId, attackers: RivalAttacker[], timeLeft }.
    // The persisted snapshot lives in state.territory.defense.
    this.defense = null;
    this._dayTimer = 0;
    this._attackTimer = 0;
    this._nextAttackIn = DEFENSE_MIN_DELAY + Math.random() * (DEFENSE_MAX_DELAY - DEFENSE_MIN_DELAY);
    this._rings = new Map();
    ensureTerritoryState();
    if (this.scene) this._buildRings();
  }

  _buildRings() {
    for (const zone of TERRITORY_ZONES) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(zone.r - 3, zone.r, 48),
        new THREE.MeshBasicMaterial({
          color: this.isOwned(zone.id) ? 0xffd23f : 0x8899aa,
          transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(zone.x, 0.25, zone.z);
      ring.name = `territory-${zone.id}`;
      this.scene.add(ring);
      this._rings.set(zone.id, ring);
    }
  }

  _refreshRing(id) {
    const ring = this._rings.get(id);
    if (!ring) return;
    ring.material.color.set(this.isOwned(id) ? 0xffd23f : 0x8899aa);
    ring.material.opacity = this.isOwned(id) ? 0.4 : 0.22;
  }

  get owned() {
    return [...ensureTerritoryState().owned];
  }

  get ownedCount() {
    return ensureTerritoryState().owned.length;
  }

  isOwned(id) {
    return ensureTerritoryState().owned.includes(id);
  }

  isOwnedAt(x, z) {
    return this.isOwned(zoneAt(x, z));
  }

  copDownsIn(id) {
    return ensureTerritoryState().copDowns[id] || 0;
  }

  // Capture a zone. Returns true on a fresh capture, false if the id is
  // unknown or the zone is already owned.
  capture(id) {
    const def = zoneDef(id);
    if (!def) return false;
    const t = ensureTerritoryState();
    if (t.owned.includes(id)) return false;
    t.owned.push(id);
    t.copDowns[id] = 0;
    this._refreshRing(id);
    if (this.onCapture) this.onCapture(def);
    return true;
  }

  // Record a police officer taken down at a position. Three downs inside
  // one unowned zone capture it. Returns the captured zone def, or null.
  recordCopDown(x, z) {
    const id = zoneAt(x, z);
    const t = ensureTerritoryState();
    if (t.owned.includes(id)) return null;
    t.copDowns[id] = (t.copDowns[id] || 0) + 1;
    if (t.copDowns[id] >= COP_DOWNS_TO_CAPTURE) {
      this.capture(id);
      return zoneDef(id);
    }
    return null;
  }

  // Police modifiers for a position: owned turf softens the response.
  // Multiplied with the crew-driver modifiers by main.js before being
  // handed to police.js (same channel, no police.js changes needed).
  policeModifiers(x, z) {
    if (this.isOwnedAt(x, z)) {
      return { bustHoldMult: OWNED_BUST_HOLD_MULT, decayMult: OWNED_DECAY_MULT };
    }
    return { bustHoldMult: 1, decayMult: 1 };
  }

  // Pay one day's turf income for every owned zone. Called by update()
  // on the day timer; exposed so tests can force a payout.
  collectDailyIncome() {
    const t = ensureTerritoryState();
    const amount = t.owned.length * INCOME_PER_ZONE_PER_DAY;
    if (amount <= 0) return 0;
    addMoney(amount);
    t.totalEarned += amount;
    if (this.onIncome) this.onIncome(amount, t.owned.length);
    return amount;
  }

  // Per-frame: advance the day timer and pay out when a game day passes.
  // Also runs the defense event: restores a saved fight, brews the next
  // attack on a timer, and resolves a live one (win / timeout).
  update(dt, player) {
    const t = ensureTerritoryState();
    // A save made mid-attack restores the fight on load.
    if (!this.defense && t.defense) this._restoreDefense();
    if (this.ownedCount === 0) return;
    this._dayTimer += dt;
    if (this._dayTimer >= TERRITORY_DAY_SECONDS) {
      this._dayTimer -= TERRITORY_DAY_SECONDS;
      this.collectDailyIncome();
    }
    if (this.defense) {
      const d = this.defense;
      d.timeLeft -= dt;
      for (const a of d.attackers) a.update(dt, player, this.effects);
      const alive = d.attackers.filter((a) => !a.down).length;
      // Keep the save snapshot in step with the live fight.
      t.defense = { zoneId: d.zoneId, attackersLeft: alive, timeLeft: Math.max(0, Math.ceil(d.timeLeft)) };
      if (alive === 0) { this._resolveDefenseWon(); return; }
      if (d.timeLeft <= 0) { this._resolveDefenseLost('timeout'); return; }
    } else {
      // No attack running: the next one brews on a timer, then hits a
      // random owned zone.
      this._attackTimer += dt;
      if (this._attackTimer >= this._nextAttackIn) {
        this._attackTimer = 0;
        this._nextAttackIn = DEFENSE_MIN_DELAY + Math.random() * (DEFENSE_MAX_DELAY - DEFENSE_MIN_DELAY);
        const owned = [...t.owned];
        const pick = owned[Math.floor(Math.random() * owned.length)];
        this.triggerDefense(pick);
      }
    }
  }

  // --- Territory defense (v4, B6) ---

  defenseActive() {
    return !!this.defense;
  }

  // Live attackers still up — fed to the combat target provider by main.js
  // so Rico can shoot them through the same ray-test as cops and peds.
  defenseTargets() {
    if (!this.defense) return [];
    return this.defense.attackers.filter((a) => !a.down);
  }

  isDefenseAttacker(target) {
    return !!this.defense && this.defense.attackers.includes(target);
  }

  // Start an attack on an owned zone. Returns true on a fresh attack,
  // false when the zone is unknown / unowned / already under attack.
  triggerDefense(zoneId) {
    const def = zoneDef(zoneId);
    if (!def || !this.isOwned(zoneId) || this.defense) return false;
    const attackers = [];
    for (let i = 0; i < DEFENSE_ATTACKERS; i++) {
      const angle = (i / DEFENSE_ATTACKERS) * Math.PI * 2;
      const pos = new THREE.Vector3(def.x + Math.cos(angle) * 12, 0, def.z + Math.sin(angle) * 12);
      attackers.push(new RivalAttacker(this.scene, pos, this.colliders));
    }
    this.defense = { zoneId, attackers, timeLeft: DEFENSE_DURATION };
    ensureTerritoryState().defense = {
      zoneId, attackersLeft: DEFENSE_ATTACKERS, timeLeft: DEFENSE_DURATION,
    };
    if (this.onDefenseStart) this.onDefenseStart(def);
    return true;
  }

  // Rebuild a live fight from the save snapshot (see update()).
  _restoreDefense() {
    const t = ensureTerritoryState();
    const snap = t.defense;
    if (!snap || !snap.zoneId) { t.defense = null; return; }
    const def = zoneDef(snap.zoneId);
    if (!def || !this.isOwned(snap.zoneId)) { t.defense = null; return; }
    const count = Math.max(1, Math.min(DEFENSE_ATTACKERS, snap.attackersLeft || DEFENSE_ATTACKERS));
    const attackers = [];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const pos = new THREE.Vector3(def.x + Math.cos(angle) * 12, 0, def.z + Math.sin(angle) * 12);
      attackers.push(new RivalAttacker(this.scene, pos, this.colliders));
    }
    this.defense = {
      zoneId: snap.zoneId, attackers,
      timeLeft: Math.max(1, snap.timeLeft || DEFENSE_DURATION),
    };
    // No onDefenseStart on restore — the alert already fired before the save.
  }

  _resolveDefenseWon() {
    const def = zoneDef(this.defense.zoneId);
    for (const a of this.defense.attackers) a.dispose();
    this.defense = null;
    ensureTerritoryState().defense = null;
    addMoney(DEFENSE_WIN_BONUS);
    addRep(DEFENSE_WIN_REP);
    this._attackTimer = 0;
    this._nextAttackIn = DEFENSE_COOLDOWN + Math.random() * 60;
    if (this.onDefenseWon) this.onDefenseWon(def, DEFENSE_WIN_BONUS);
  }

  _resolveDefenseLost(reason) {
    const def = zoneDef(this.defense.zoneId);
    for (const a of this.defense.attackers) a.dispose();
    this.defense = null;
    ensureTerritoryState().defense = null;
    const t = ensureTerritoryState();
    const i = t.owned.indexOf(def.id);
    if (i !== -1) t.owned.splice(i, 1);
    t.copDowns[def.id] = 0;
    this._refreshRing(def.id);
    this._attackTimer = 0;
    this._nextAttackIn = DEFENSE_COOLDOWN + Math.random() * 60;
    if (this.onDefenseLost) this.onDefenseLost(def, reason);
  }

  // Called by main.js when Rico is wasted / busted mid-defense: the
  // fight is lost with him.
  onPlayerDown() {
    if (this.defense) this._resolveDefenseLost('wasted');
  }
}

export default TerritoryManager;
