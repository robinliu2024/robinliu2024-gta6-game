// Solmar Heat — garage upgrades + REP tiers (v2, Builder D).
// Spend mission money on the player's car: top speed, acceleration, armor
// plating and paint. REP tiers (earned from missions, race wins and
// near-miss driving) unlock garage discounts and special paints. Story
// missions are never gated behind REP. Pure logic here is DOM-free so the
// harness can import it in Node; createGarageUI builds the panel.

import { state, addMoney, addRep } from './state.js';

export const REP_TIERS = [
  { min: 0, name: 'Nobody', discount: 0 },
  { min: 50, name: 'Hustler', discount: 0.10 },
  { min: 150, name: 'Street King', discount: 0.20 },
  { min: 300, name: 'Legend', discount: 0.30 },
];

export function repTier(rep) {
  let tier = REP_TIERS[0];
  for (const t of REP_TIERS) if (rep >= t.min) tier = t;
  return tier;
}

// REP earned outside missions: street-race win bonus + near-miss driving.
// Mission REP itself is already awarded by completeMission in state.js.
export const RACE_WIN_BONUS_REP = 20;
export const NEAR_MISS_REP = 2;

export const UPGRADE_TRACKS = {
  speed: { name: 'Top Speed', desc: '+12% top speed / level', prices: [800, 1600, 3200], maxLevel: 3 },
  accel: { name: 'Acceleration', desc: '+15% acceleration / level', prices: [600, 1200, 2400], maxLevel: 3 },
  armor: { name: 'Armor Plating', desc: '-10% damage taken / level', prices: [700, 1400, 2800], maxLevel: 3 },
};

export const PAINTS = [
  { id: 'teal', name: 'Harbor Teal', color: 0x1e6f5c, price: 0, minRep: 0 },
  { id: 'red', name: 'Marla Red', color: 0xc23b2e, price: 500, minRep: 0 },
  { id: 'purple', name: 'Boardwalk Purple', color: 0x8a5fc2, price: 800, minRep: 0 },
  { id: 'gold', name: 'Street Gold', color: 0xe8b93c, price: 1500, minRep: 150 },
  { id: 'chrome', name: 'Legend Chrome', color: 0xd8d8d8, price: 2500, minRep: 300 },
];

export function defaultGarage() {
  return { speed: 0, accel: 0, armor: 0, paint: 'teal' };
}

export function ensureGarage() {
  if (!state.garage || typeof state.garage !== 'object') state.garage = defaultGarage();
  for (const [k, v] of Object.entries(defaultGarage())) {
    if (state.garage[k] === undefined) state.garage[k] = v;
  }
  return state.garage;
}

export function paintById(id) {
  return PAINTS.find((p) => p.id === id) || PAINTS[0];
}

// Price after the current REP-tier discount (rounded to whole dollars).
export function discountedPrice(base) {
  const tier = repTier(state.rep);
  return Math.max(0, Math.round(base * (1 - tier.discount)));
}

// Stat multipliers applied to the player's car in vehicles.js drive().
export function speedMultiplier() {
  ensureGarage();
  return 1 + 0.12 * state.garage.speed;
}

export function accelMultiplier() {
  ensureGarage();
  return 1 + 0.15 * state.garage.accel;
}

// Fraction of incoming damage absorbed by armor plating (0..0.3).
export function armorReduction() {
  ensureGarage();
  return 0.10 * state.garage.armor;
}

// Buy the next level of a track. Returns { ok, reason?, price?, level? }.
export function buyUpgrade(track) {
  ensureGarage();
  const def = UPGRADE_TRACKS[track];
  if (!def) return { ok: false, reason: 'unknown' };
  const level = state.garage[track];
  if (level >= def.maxLevel) return { ok: false, reason: 'max', level };
  const price = discountedPrice(def.prices[level]);
  if (state.money < price) return { ok: false, reason: 'funds', price, level };
  addMoney(-price);
  state.garage[track] = level + 1;
  return { ok: true, price, level: state.garage[track] };
}

// Buy a paint job for the player's car. Returns { ok, reason?, price? }.
export function buyPaint(id) {
  ensureGarage();
  const paint = paintById(id);
  if (state.garage.paint === paint.id) return { ok: false, reason: 'owned' };
  if (state.rep < paint.minRep) return { ok: false, reason: 'locked', minRep: paint.minRep };
  const price = discountedPrice(paint.price);
  if (state.money < price) return { ok: false, reason: 'funds', price };
  addMoney(-price);
  state.garage.paint = paint.id;
  return { ok: true, price };
}

// Apply the saved paint colour to a vehicle (the player's starter car).
export function applyPaintTo(vehicle) {
  if (!vehicle || typeof vehicle.setPaint !== 'function') return false;
  ensureGarage();
  return vehicle.setPaint(paintById(state.garage.paint).color);
}

// Award REP from a non-mission source (race win / near miss). Returns new REP.
export function awardRep(amount) {
  return addRep(amount);
}

// --- Garage UI: a small DOM panel, opened with G. --------------------------
// Kept in this module (not hud.js) so the panel owns its own buttons and
// re-render. No pointer-lock while open; main.js freezes the world.

function money(n) {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

export function createGarageUI(deps = {}) {
  const getStarterCar = deps.getStarterCar || (() => null);
  const onBuy = deps.onBuy || (() => {});
  let panel = null;
  let open = false;

  function build() {
    panel = document.createElement('div');
    panel.id = 'garage-panel';
    panel.style.cssText = [
      'position:fixed', 'left:50%', 'top:50%', 'transform:translate(-50%,-50%)',
      'width:340px', 'max-width:92vw', 'z-index:60',
      'background:rgba(12,18,24,0.96)', 'border:1px solid #ffd23f', 'border-radius:10px',
      'color:#eee', 'font-family:inherit', 'padding:16px 18px',
      'box-shadow:0 8px 40px rgba(0,0,0,0.6)', 'display:none',
    ].join(';');
    document.body.appendChild(panel);
    panel.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-buy]');
      if (!btn) return;
      const [kind, id] = btn.dataset.buy.split(':');
      let res;
      if (kind === 'track') res = buyUpgrade(id);
      else if (kind === 'paint') {
        res = buyPaint(id);
        if (res.ok) applyPaintTo(getStarterCar());
      }
      if (res && res.ok) onBuy();
      render(res);
    });
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close (G)';
    closeBtn.style.cssText = [
      'margin-top:12px', 'width:100%', 'padding:8px', 'font-size:15px',
      'font-weight:700', 'background:#ffd23f', 'color:#111',
      'border:none', 'border-radius:6px', 'cursor:pointer',
    ].join(';');
    closeBtn.addEventListener('click', () => close());
    panel.appendChild(closeBtn);
    // The close button is appended after render() fills the body rows, so
    // keep a marker: render() inserts before it.
    panel._closeBtn = closeBtn;
  }

  function render(lastRes) {
    if (!panel) build();
    ensureGarage();
    const tier = repTier(state.rep);
    const nextTier = REP_TIERS.find((t) => t.min > state.rep);
    let html = `<div style="font-size:19px;font-weight:800;color:#ffd23f;">Solmar Garage</div>`
      + `<div style="margin:4px 0 10px;font-size:13px;color:#bbb;">${money(state.money)} &nbsp;·&nbsp; REP ${state.rep} — ${tier.name}`
      + (tier.discount > 0 ? ` &nbsp;·&nbsp; ${Math.round(tier.discount * 100)}% garage discount` : '')
      + (nextTier ? ` &nbsp;·&nbsp; ${nextTier.min - state.rep} REP to ${nextTier.name}` : ' &nbsp;·&nbsp; top tier')
      + `</div>`;
    if (lastRes && !lastRes.ok) {
      const why = lastRes.reason === 'funds' ? `Not enough cash — need ${money(lastRes.price)}.`
        : lastRes.reason === 'max' ? 'Already maxed out.'
        : lastRes.reason === 'locked' ? `Needs ${lastRes.minRep} REP — keep racing and driving.`
        : lastRes.reason === 'owned' ? 'Already painted that colour.'
        : 'Cannot buy that.';
      html += `<div style="color:#ff7d7d;font-size:13px;margin-bottom:8px;">${why}</div>`;
    } else if (lastRes && lastRes.ok) {
      html += `<div style="color:#7dff8a;font-size:13px;margin-bottom:8px;">Installed — ${money(lastRes.price)}.</div>`;
    }
    for (const [id, def] of Object.entries(UPGRADE_TRACKS)) {
      const level = state.garage[id];
      const maxed = level >= def.maxLevel;
      const price = maxed ? null : discountedPrice(def.prices[level]);
      const pips = '●'.repeat(level) + '○'.repeat(def.maxLevel - level);
      html += `<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-top:1px solid rgba(255,255,255,0.12);">`
        + `<div style="flex:1;"><div style="font-weight:700;">${def.name} <span style="color:#ffd23f;">${pips}</span></div>`
        + `<div style="font-size:12px;color:#bbb;">${def.desc}</div></div>`
        + (maxed
          ? `<span style="color:#7dff8a;font-size:13px;font-weight:700;">MAX</span>`
          : `<button data-buy="track:${id}" style="padding:6px 12px;font-weight:700;background:#ffd23f;color:#111;border:none;border-radius:5px;cursor:pointer;">${money(price)}</button>`)
        + `</div>`;
    }
    html += `<div style="margin-top:10px;font-weight:700;">Paint</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">`;
    for (const p of PAINTS) {
      const owned = state.garage.paint === p.id;
      const locked = state.rep < p.minRep;
      const hex = `#${p.color.toString(16).padStart(6, '0')}`;
      const price = discountedPrice(p.price);
      html += `<button data-buy="paint:${p.id}" ${owned || locked ? 'disabled' : ''} style="padding:6px 8px;border-radius:5px;cursor:${owned || locked ? 'default' : 'pointer'};border:2px solid ${owned ? '#ffd23f' : 'rgba(255,255,255,0.25)'};background:${hex};color:#fff;text-shadow:0 1px 3px #000;font-size:12px;font-weight:700;opacity:${locked ? 0.45 : 1};">${p.name}${owned ? ' ✓' : locked ? ` (${p.minRep} REP)` : ` · ${money(price)}`}</button>`;
    }
    html += `</div><div style="font-size:12px;color:#bbb;margin-top:10px;">Upgrades apply to your car. Press G to close.</div>`;
    // Rebuild body rows, keeping the close button at the bottom.
    const closeBtn = panel._closeBtn;
    panel.innerHTML = html;
    panel.appendChild(closeBtn);
  }

  function openPanel() {
    if (!panel) build();
    open = true;
    render();
    panel.style.display = 'block';
    try { document.exitPointerLock?.(); } catch { /* no pointer lock */ }
  }

  function close() {
    open = false;
    if (panel) panel.style.display = 'none';
  }

  return {
    open: openPanel,
    close,
    toggle: () => (open ? close() : openPanel()),
    render,
    get isOpen() { return open; },
  };
}

export default { repTier, buyUpgrade, buyPaint, speedMultiplier, accelMultiplier, armorReduction, applyPaintTo, awardRep, createGarageUI };
