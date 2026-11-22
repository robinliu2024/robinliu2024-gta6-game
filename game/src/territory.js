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
import { DISTRICTS } from './config.js';
import { state, addMoney } from './state.js';

export const TERRITORY_DAY_SECONDS = 240; // one game day, matches city.js DAY_LENGTH
export const INCOME_PER_ZONE_PER_DAY = 400;
export const COP_DOWNS_TO_CAPTURE = 3;
// Police response inside owned turf: wanted decays 40% faster, busts take
// 40% longer. Multiplied with the crew-driver modifiers in main.js.
export const OWNED_DECAY_MULT = 0.6;
export const OWNED_BUST_HOLD_MULT = 1.4;

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
  return { owned: [], copDowns: { harbor: 0, downtown: 0, suburbs: 0 }, totalEarned: 0 };
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
  return state.territory;
}

export class TerritoryManager {
  constructor(scene) {
    this.scene = scene || null;
    this.onCapture = null; // fn(zoneDef) — main.js toasts + stings
    this.onIncome = null;  // fn(amount, ownedCount) — main.js toasts
    this._dayTimer = 0;
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
  update(dt) {
    if (this.ownedCount === 0) return;
    this._dayTimer += dt;
    if (this._dayTimer >= TERRITORY_DAY_SECONDS) {
      this._dayTimer -= TERRITORY_DAY_SECONDS;
      this.collectDailyIncome();
    }
  }
}

export default TerritoryManager;
