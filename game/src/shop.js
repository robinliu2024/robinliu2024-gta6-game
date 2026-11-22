// Solmar Heat — shops + safehouses (v3, Builder 2).
// Two Solmar Arms shops (Downtown + Harbor): ammo for all four weapons,
// the weapons themselves (pistol comes with Rico; shotgun / rifle / SMG are
// bought here), weapon attachments (extended mag + scope, for the weapon
// Rico currently has equipped), and a bulletproof vest
// (-25% damage taken, persisted on state.vest). Prices use the garage's
// REP-tier discount so the economy stays consistent. Two safehouses
// (Harbor + Downtown): E saves the game, T fast-travels between them, and
// G opens the garage as usual. Pure logic here is DOM-free so the harness
// can import it in Node; panels + map markers are built only when a
// document / scene exists.

import * as THREE from 'three';
import { state, addMoney, saveGame } from './state.js';
import { WEAPONS, ATTACHMENT_DEFS, ensureWeaponState, ownWeapon, ownAttachment, hasAttachment } from './combat.js';
import { discountedPrice } from './garage.js';

export const SHOP_RADIUS = 12;      // press B within this many metres
export const SAFEHOUSE_RADIUS = 10; // press E / T within this many metres
export const VEST_PRICE = 1500;
export const VEST_REDUCTION = 0.25; // damage taken x0.75 (see state.damagePlayer)

export const SHOP_SPOTS = [
  { id: 'downtown', name: 'Downtown Arms', x: 64, z: 32 },
  { id: 'harbor', name: 'Harbor Arms', x: -208, z: 216 },
];

export const SAFEHOUSES = [
  { id: 'harbor', name: 'Harbor Safehouse', x: -248, z: 168 },
  { id: 'downtown', name: 'Downtown Safehouse', x: 24, z: 48 },
];

// Ammo packs: one pack per weapon, sized to roughly a full reserve top-up.
export const AMMO_ITEMS = [
  { id: 'pistol', name: 'Pistol rounds', pack: 24, price: 50 },
  { id: 'shotgun', name: 'Shotgun shells', pack: 12, price: 80 },
  { id: 'rifle', name: 'Rifle rounds', pack: 30, price: 120 },
  { id: 'smg', name: 'SMG rounds', pack: 32, price: 100 },
];

export const WEAPON_ITEMS = [
  { id: 'pistol', name: 'Pistol', price: 0 },
  { id: 'shotgun', name: 'Shotgun', price: 1200 },
  { id: 'rifle', name: 'Rifle', price: 2500 },
  { id: 'smg', name: 'SMG', price: 3200 },
];

// Attachments are bought for the weapon Rico currently has equipped
// (see buyAttachment); each weapon can hold one mag and one scope.
export const ATTACHMENT_ITEMS = [
  { id: 'mag', name: 'Extended Magazine', price: ATTACHMENT_DEFS.mag.price },
  { id: 'scope', name: 'Tactical Scope', price: ATTACHMENT_DEFS.scope.price },
];

export function shopSpotById(id) {
  return SHOP_SPOTS.find((s) => s.id === id) || null;
}

export function safehouseById(id) {
  return SAFEHOUSES.find((s) => s.id === id) || null;
}

export function nearestSpot(spots, x, z, maxDist) {
  let best = null;
  let bestD = maxDist;
  for (const s of spots) {
    const d = Math.hypot(s.x - x, s.z - z);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

export function isOwnedWeapon(id) {
  return !!ensureWeaponState().owned[id];
}

// --- Purchases. Every buy returns { ok, reason?, price? }. -------------
export function buyAmmo(id) {
  const item = AMMO_ITEMS.find((a) => a.id === id);
  if (!item) return { ok: false, reason: 'unknown' };
  const price = discountedPrice(item.price);
  if (state.money < price) return { ok: false, reason: 'funds', price };
  addMoney(-price);
  ensureWeaponState().ammo[id].reserve += item.pack;
  return { ok: true, price, pack: item.pack };
}

export function buyWeapon(id) {
  const item = WEAPON_ITEMS.find((w) => w.id === id);
  if (!item) return { ok: false, reason: 'unknown' };
  if (isOwnedWeapon(id)) return { ok: false, reason: 'owned' };
  const price = discountedPrice(item.price);
  if (state.money < price) return { ok: false, reason: 'funds', price };
  addMoney(-price);
  ownWeapon(id);
  return { ok: true, price };
}

export function buyVest() {
  if (state.vest) return { ok: false, reason: 'owned' };
  const price = discountedPrice(VEST_PRICE);
  if (state.money < price) return { ok: false, reason: 'funds', price };
  addMoney(-price);
  state.vest = true;
  return { ok: true, price };
}

// Buy an attachment for the currently equipped weapon. Returns
// { ok, reason?, price?, weapon? } like the other buy functions.
export function buyAttachment(kind) {
  const def = ATTACHMENT_DEFS[kind];
  if (!def) return { ok: false, reason: 'unknown' };
  const wid = ensureWeaponState().current;
  if (hasAttachment(kind, wid)) return { ok: false, reason: 'owned' };
  const price = discountedPrice(def.price);
  if (state.money < price) return { ok: false, reason: 'funds', price };
  addMoney(-price);
  ownAttachment(kind, wid);
  return { ok: true, price, weapon: wid };
}

// --- Map markers (scene only; skipped in the Node harness). -------------
function shopMarker(spot) {
  const g = new THREE.Group();
  g.name = `shop-${spot.id}`;
  const kiosk = new THREE.Mesh(
    new THREE.BoxGeometry(4, 3.2, 3),
    new THREE.MeshStandardMaterial({ color: 0x8a6a1a, roughness: 0.8 }),
  );
  kiosk.position.y = 1.6;
  kiosk.castShadow = true;
  g.add(kiosk);
  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(4.4, 0.9, 0.4),
    new THREE.MeshStandardMaterial({ color: 0xffb020, emissive: 0xffb020, emissiveIntensity: 1.2 }),
  );
  sign.position.y = 3.6;
  g.add(sign);
  g.position.set(spot.x, 0, spot.z);
  return g;
}

function safehouseMarker(spot) {
  const g = new THREE.Group();
  g.name = `safehouse-${spot.id}`;
  const house = new THREE.Mesh(
    new THREE.BoxGeometry(5, 3, 4),
    new THREE.MeshStandardMaterial({ color: 0x2e5c3a, roughness: 0.85 }),
  );
  house.position.y = 1.5;
  house.castShadow = true;
  g.add(house);
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(5.6, 0.5, 4.6),
    new THREE.MeshStandardMaterial({ color: 0x7dff5e, emissive: 0x7dff5e, emissiveIntensity: 0.7 }),
  );
  roof.position.y = 3.2;
  g.add(roof);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(5, 5.6, 32),
    new THREE.MeshBasicMaterial({
      color: 0x7dff5e, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.25;
  g.add(ring);
  g.position.set(spot.x, 0, spot.z);
  return g;
}

function money(n) {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

// --- Shop manager: proximity + buy panel (B). ---------------------------
export class ShopManager {
  constructor(scene) {
    this.scene = scene || null;
    this.onBuy = null; // fn() — main.js click sound
    this._panel = null;
    this._panelOpen = false;
    if (this.scene) {
      for (const spot of SHOP_SPOTS) this.scene.add(shopMarker(spot));
    }
  }

  nearestShop(x, z) {
    return nearestSpot(SHOP_SPOTS, x, z, SHOP_RADIUS);
  }

  isNearShop(x, z) {
    return !!this.nearestShop(x, z);
  }

  isPanelOpen() { return this._panelOpen; }

  openPanel() {
    if (typeof document === 'undefined') return false;
    if (!this._panel) this._buildPanel();
    this._renderPanel();
    this._panel.style.display = 'block';
    this._panelOpen = true;
    try { document.exitPointerLock?.(); } catch { /* no pointer lock */ }
    return true;
  }

  closePanel() {
    if (this._panel) this._panel.style.display = 'none';
    this._panelOpen = false;
  }

  togglePanel() {
    if (this._panelOpen) this.closePanel();
    else this.openPanel();
  }

  _buildPanel() {
    const panel = document.createElement('div');
    panel.id = 'shop-panel';
    panel.style.cssText = [
      'position:fixed', 'left:50%', 'top:50%', 'transform:translate(-50%,-50%)',
      'width:360px', 'max-width:92vw', 'z-index:60',
      'background:rgba(12,18,24,0.96)', 'border:1px solid #ffb020', 'border-radius:10px',
      'color:#eee', 'font-family:inherit', 'padding:16px 18px',
      'box-shadow:0 8px 40px rgba(0,0,0,0.6)', 'display:none',
      'max-height:86vh', 'overflow-y:auto',
    ].join(';');
    document.body.appendChild(panel);
    panel.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('[data-buy]') : null;
      if (btn) {
        const [kind, id] = btn.getAttribute('data-buy').split(':');
        let res = null;
        if (kind === 'ammo') res = buyAmmo(id);
        else if (kind === 'weapon') res = buyWeapon(id);
        else if (kind === 'vest') res = buyVest();
        else if (kind === 'attachment') res = buyAttachment(id);
        if (res && res.ok && this.onBuy) this.onBuy();
        this._renderPanel(res);
        return;
      }
      if (e.target && e.target.closest && e.target.closest('[data-close]')) this.closePanel();
    });
    this._panel = panel;
  }

  _renderPanel(lastRes) {
    if (!this._panel) return;
    const weapons = ensureWeaponState();
    let html = `<div style="font-size:19px;font-weight:800;color:#ffb020;">Solmar Arms &amp; Ammo</div>`
      + `<div style="margin:4px 0 10px;font-size:13px;color:#bbb;">${money(state.money)} &nbsp;·&nbsp; REP ${state.rep} — prices include your REP discount</div>`;
    if (lastRes && !lastRes.ok) {
      const why = lastRes.reason === 'funds' ? `Not enough cash — need ${money(lastRes.price)}.`
        : lastRes.reason === 'owned' ? 'You already own that.'
        : 'Cannot buy that.';
      html += `<div style="color:#ff7d7d;font-size:13px;margin-bottom:8px;">${why}</div>`;
    } else if (lastRes && lastRes.ok) {
      html += `<div style="color:#7dff8a;font-size:13px;margin-bottom:8px;">Bought — ${money(lastRes.price)}.</div>`;
    }
    html += `<div style="font-weight:700;margin-top:4px;">Ammo</div>`;
    for (const item of AMMO_ITEMS) {
      const price = discountedPrice(item.price);
      const reserve = weapons.ammo[item.id] ? weapons.ammo[item.id].reserve : 0;
      html += `<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-top:1px solid rgba(255,255,255,0.12);">`
        + `<div style="flex:1;"><div style="font-weight:700;">${item.name} <span style="color:#bbb;font-weight:400;">+${item.pack} rounds</span></div>`
        + `<div style="font-size:12px;color:#bbb;">In reserve: ${reserve}</div></div>`
        + `<button data-buy="ammo:${item.id}" style="padding:6px 12px;font-weight:700;background:#ffb020;color:#111;border:none;border-radius:5px;cursor:pointer;">${money(price)}</button></div>`;
    }
    html += `<div style="font-weight:700;margin-top:10px;">Weapons</div>`;
    for (const item of WEAPON_ITEMS) {
      const owned = isOwnedWeapon(item.id);
      const price = discountedPrice(item.price);
      const def = WEAPONS[item.id];
      html += `<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-top:1px solid rgba(255,255,255,0.12);">`
        + `<div style="flex:1;"><div style="font-weight:700;">${item.name}</div>`
        + `<div style="font-size:12px;color:#bbb;">${def ? `Damage ${def.damage} · mag ${def.magSize}` : ''}</div></div>`
        + (owned
          ? `<span style="color:#7dff8a;font-size:13px;font-weight:700;">OWNED</span>`
          : `<button data-buy="weapon:${item.id}" style="padding:6px 12px;font-weight:700;background:#ffb020;color:#111;border:none;border-radius:5px;cursor:pointer;">${money(price)}</button>`)
        + `</div>`;
    }
    html += `<div style="font-weight:700;margin-top:10px;">Attachments — for your ${WEAPONS[weapons.current] ? WEAPONS[weapons.current].name : 'weapon'}</div>`;
    for (const item of ATTACHMENT_ITEMS) {
      const owned = hasAttachment(item.id, weapons.current);
      const price = discountedPrice(item.price);
      const def = ATTACHMENT_DEFS[item.id];
      html += `<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-top:1px solid rgba(255,255,255,0.12);">`
        + `<div style="flex:1;"><div style="font-weight:700;">${item.name}</div>`
        + `<div style="font-size:12px;color:#bbb;">${def ? def.desc : ''}</div></div>`
        + (owned
          ? `<span style="color:#7dff8a;font-size:13px;font-weight:700;">FITTED</span>`
          : `<button data-buy="attachment:${item.id}" style="padding:6px 12px;font-weight:700;background:#ffb020;color:#111;border:none;border-radius:5px;cursor:pointer;">${money(price)}</button>`)
        + `</div>`;
    }
    html += `<div style="font-weight:700;margin-top:10px;">Protection</div>`
      + `<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-top:1px solid rgba(255,255,255,0.12);">`
      + `<div style="flex:1;"><div style="font-weight:700;">Bulletproof Vest</div>`
      + `<div style="font-size:12px;color:#bbb;">Take ${Math.round(VEST_REDUCTION * 100)}% less damage, for good</div></div>`
      + (state.vest
        ? `<span style="color:#7dff8a;font-size:13px;font-weight:700;">WORN</span>`
        : `<button data-buy="vest:vest" style="padding:6px 12px;font-weight:700;background:#ffb020;color:#111;border:none;border-radius:5px;cursor:pointer;">${money(discountedPrice(VEST_PRICE))}</button>`)
      + `</div><div style="font-size:12px;color:#bbb;margin-top:10px;">Press B to close. Ammo and weapons are yours to keep.</div>`;
    this._panel.innerHTML = html
      + `<button data-close style="margin-top:12px;width:100%;padding:8px;font-size:15px;font-weight:700;background:#ffb020;color:#111;border:none;border-radius:6px;cursor:pointer;">Close (B)</button>`;
  }
}

// --- Safehouse manager: save (E) + fast travel (T). ----------------------
export class SafehouseManager {
  constructor(scene, deps = {}) {
    this.scene = scene || null;
    this.getPlayer = deps.getPlayer || (() => null);
    this.onSave = null;   // fn(ok) — main.js toasts
    this.onTravel = null; // fn(spot) — main.js toasts
    if (this.scene) {
      for (const spot of SAFEHOUSES) this.scene.add(safehouseMarker(spot));
    }
  }

  nearestSafehouse(x, z) {
    return nearestSpot(SAFEHOUSES, x, z, SAFEHOUSE_RADIUS);
  }

  isNearSafehouse(x, z) {
    return !!this.nearestSafehouse(x, z);
  }

  // Save the game at a safehouse. Returns true when a save was written.
  saveHere() {
    const ok = saveGame();
    if (this.onSave) this.onSave(ok);
    return ok;
  }

  // Fast-travel from one safehouse to the other. The player rides along in
  // their car when driving. Returns the destination spot, or null when the
  // player is not at a safehouse.
  travel(x, z) {
    const from = this.nearestSafehouse(x, z);
    if (!from) return null;
    const to = SAFEHOUSES.find((s) => s.id !== from.id);
    if (!to) return null;
    const player = this.getPlayer();
    if (player && player.position) {
      player.position.set(to.x, 0, to.z);
      if (typeof player.heading === 'number') player.heading = 0;
      if (player.mesh) {
        player.mesh.position.set(to.x, 0, to.z);
        player.mesh.rotation.y = 0;
      }
      if (player.vehicle && player.vehicle.position) {
        player.vehicle.position.set(to.x + 3, 0, to.z + 3);
        if (typeof player.vehicle.heading === 'number') player.vehicle.heading = 0;
        if (player.vehicle.mesh) {
          player.vehicle.mesh.position.set(to.x + 3, 0, to.z + 3);
          player.vehicle.mesh.rotation.y = 0;
        }
      }
    }
    if (this.onTravel) this.onTravel(to);
    return to;
  }
}

export default ShopManager;
