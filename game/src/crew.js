// Solmar Heat — crew: recruitable gang members (v3, Builder 1).
// Two members, REP-gated: Vic Torres (driver, Hustler 50+) and Lena Cruz
// (gunner, Street King 150+). Press K to open the recruit panel; the
// manager also exposes tryRecruit(id) so tests and the console can drive
// it. Members follow Rico on foot, ride along in his car, and the gunner
// fights cops during missions — her shots go through combat.js'
// damageTarget, the same damage interface the player's weapons use.
// The driver makes police busts take longer and wanted heat cool faster
// (police.js reads the modifiers main.js hands it each frame). Crew state
// lives in state.crew so saves carry it. Original characters; nothing
// here comes from any other game.

import * as THREE from 'three';
import { state } from './state.js';
import { damageTarget } from './combat.js';
import { collideCircle } from './player.js';

export const CREW_DEFS = [
  {
    id: 'vic', name: 'Vic Torres', skill: 'driver', skillName: 'Driver',
    minRep: 50, tierName: 'Hustler',
    desc: 'Wheelman — cops take longer to lock you down, and heat cools off faster.',
    color: 0xc27a2e, jacket: 0x8a5a2b,
  },
  {
    id: 'lena', name: 'Lena Cruz', skill: 'gunner', skillName: 'Gunner',
    minRep: 150, tierName: 'Street King',
    desc: 'Shooter — follows you into missions and puts rounds into the nearest cop.',
    color: 0x2e6fc2, jacket: 0x2b4a6b,
  },
];

export const CREW_MAX_HEALTH = 100;
export const DRIVER_BUST_MULT = 1.6;  // bust hold takes 60% longer
export const DRIVER_DECAY_MULT = 0.6; // wanted decay interval ~40% shorter
export const GUNNER_RANGE = 60;
export const GUNNER_DAMAGE = 26;      // one rifle round, via damageTarget
export const GUNNER_FIRE_INTERVAL = 0.8;
export const GUNNER_HIT_CHANCE = 0.65;
export const FOLLOW_SPEED = 11;       // a touch faster than Rico's run
export const REVIVE_SECONDS = 20;

export function crewDef(id) {
  return CREW_DEFS.find((d) => d.id === id) || null;
}

export function ensureCrewState() {
  if (!state.crew || typeof state.crew !== 'object') state.crew = { recruited: [], health: {} };
  if (!Array.isArray(state.crew.recruited)) state.crew.recruited = [];
  if (!state.crew.health || typeof state.crew.health !== 'object') state.crew.health = {};
  return state.crew;
}

// Simple box figure in the crew colours, cap included so the crew reads
// at a glance next to ordinary pedestrians.
function buildMemberMesh(def) {
  const g = new THREE.Group();
  g.name = `crew-${def.id}`;
  const jacket = new THREE.MeshStandardMaterial({ color: def.jacket, roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc98d5f, roughness: 0.8 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.9 });
  const capMat = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.7 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.72, 0.34), jacket);
  torso.position.y = 1.06;
  torso.castShadow = true;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.32), skin);
  head.position.y = 1.62;
  g.add(head);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.36), capMat);
  cap.position.y = 1.84;
  g.add(cap);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.64, 0.24), pants);
  legL.position.set(-0.16, 0.32, 0);
  g.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.16;
  g.add(legR);
  g.userData.legs = [legL, legR];
  return g;
}

class CrewMember {
  constructor(scene, def, spawnPos, colliders) {
    this.def = def;
    this.mesh = buildMemberMesh(def);
    this.mesh.position.copy(spawnPos);
    scene.add(this.mesh);
    this.scene = scene;
    this.position = this.mesh.position;
    this.heading = 0;
    this.health = CREW_MAX_HEALTH;
    this.maxHealth = CREW_MAX_HEALTH;
    this.down = false;
    this.reviveTimer = 0;
    this.fireTimer = 0;
    this.walkPhase = Math.random() * 6;
    this.colliders = colliders || [];
    this.riding = false;
    // Combat interface (combat.js): ray tests aim at this height / radius.
    this.aimHeight = 1.1;
    this.radius = 0.6;
  }

  get alive() { return !this.down; }

  // Same return contract as police / pedestrian takeDamage ('down'|'hit'|null).
  takeDamage(amount) {
    if (this.down) return null;
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.down = true;
      this.reviveTimer = REVIVE_SECONDS;
      this.mesh.rotation.z = Math.PI / 2;
      this.mesh.position.y = 0.3;
      return 'down';
    }
    return 'hit';
  }

  _revive() {
    this.down = false;
    this.health = Math.ceil(this.maxHealth / 2);
    this.mesh.rotation.z = 0;
    this.mesh.position.y = 0;
  }

  // Nearest living cop within gunner range, or null.
  _nearestCop(cops) {
    let best = null;
    let bestD = GUNNER_RANGE;
    for (const cop of cops || []) {
      if (!cop || cop.down || !cop.position) continue;
      const d = cop.position.distanceTo(this.position);
      if (d < bestD) { bestD = d; best = cop; }
    }
    return best;
  }

  // Gunner combat: one aimed shot per interval at the nearest cop while a
  // mission is running or the crew is wanted. Damage goes through
  // combat.js' damageTarget; tracers go through the effects module.
  _gunnerFire(dt, world) {
    if (this.def.skill !== 'gunner' || this.down) return;
    const missionsActive = !!(world.missions && world.missions.active);
    if (!missionsActive && state.wanted <= 0) return;
    this.fireTimer -= dt;
    if (this.fireTimer > 0) return;
    this.fireTimer = GUNNER_FIRE_INTERVAL;
    const cops = world.police ? world.police.cops : [];
    const cop = this._nearestCop(cops);
    if (!cop) return;
    const from = this.position.clone();
    from.y += 1.5;
    const to = cop.position.clone();
    to.y += cop.aimHeight ?? 1.0;
    if (world.effects && typeof world.effects.spawnTracer === 'function') {
      world.effects.spawnTracer(from, to);
      if (typeof world.effects.spawnMuzzle === 'function') {
        const dir = to.clone().sub(from).normalize();
        world.effects.spawnMuzzle(from, dir);
      }
    }
    if (Math.random() < GUNNER_HIT_CHANCE) {
      const result = damageTarget(cop, GUNNER_DAMAGE);
      if (result === 'down') state.kills += 1;
    }
  }

  update(dt, player, world, followOffset) {
    if (!player) return;
    // Downed members get back up on their own after a while.
    if (this.down) {
      this.reviveTimer -= dt;
      if (this.reviveTimer <= 0) this._revive();
      return;
    }
    // Riding: hidden inside the player's car; reappear beside it on exit.
    if (player.vehicle) {
      this.riding = true;
      this.mesh.visible = false;
      this.position.copy(player.vehicle.position);
      this.mesh.position.y = 0;
      return;
    }
    this.riding = false;
    this.mesh.visible = true;
    // Follow: trail the player at a per-member offset behind their heading.
    const px = player.position.x;
    const pz = player.position.z;
    const behind = player.heading ?? 0;
    const ox = followOffset.x;
    const oz = followOffset.z;
    // Rotate the offset by the player's heading so members trail behind.
    const sin = Math.sin(behind);
    const cos = Math.cos(behind);
    const tx = px + ox * cos - oz * sin;
    const tz = pz + ox * sin + oz * cos;
    const dx = tx - this.position.x;
    const dz = tz - this.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 1.2) {
      const step = Math.min(dist, FOLLOW_SPEED * dt);
      const nx = dx / dist;
      const nz = dz / dist;
      this.position.x += nx * step;
      this.position.z += nz * step;
      this.heading = Math.atan2(nx, nz);
      this.mesh.rotation.y = this.heading;
      this.walkPhase += dt * FOLLOW_SPEED * 1.6;
      const swing = Math.sin(this.walkPhase) * 0.5;
      this.mesh.userData.legs[0].rotation.x = swing;
      this.mesh.userData.legs[1].rotation.x = -swing;
      collideCircle(this.position, 0.5, this.colliders);
    } else {
      this.mesh.userData.legs[0].rotation.x *= 0.8;
      this.mesh.userData.legs[1].rotation.x *= 0.8;
    }
    this._gunnerFire(dt, world);
  }
}

export class CrewManager {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world || {};
    this.members = [];
    this.onRecruit = null;  // fn(def) — main.js toasts + stings
    this._panel = null;
    this._panelOpen = false;
    // Restore recruited members from the save.
    const saved = ensureCrewState();
    for (const id of saved.recruited) this._spawn(id);
  }

  get recruited() { return this.members.map((m) => m.def.id); }
  isRecruited(id) { return this.members.some((m) => m.def.id === id); }
  member(id) { return this.members.find((m) => m.def.id === id) || null; }

  canRecruit(id) {
    const def = crewDef(id);
    if (!def) return { ok: false, reason: 'unknown' };
    if (this.isRecruited(id)) return { ok: false, reason: 'already' };
    if (state.rep < def.minRep) return { ok: false, reason: 'rep', need: def.minRep };
    return { ok: true, def };
  }

  // Recruit one member. Returns { ok, def } or { ok:false, reason, need? }.
  tryRecruit(id) {
    const check = this.canRecruit(id);
    if (!check.ok) return check;
    const def = check.def;
    const saved = ensureCrewState();
    saved.recruited.push(id);
    saved.health[id] = CREW_MAX_HEALTH;
    this._spawn(id);
    if (this.onRecruit) this.onRecruit(def);
    return { ok: true, def };
  }

  _spawn(id) {
    const def = crewDef(id);
    if (!def) return null;
    const p = this.world.player;
    const spawn = p
      ? p.position.clone().add(new THREE.Vector3(2 + this.members.length * 2, 0, 2))
      : new THREE.Vector3(0, 0, 0);
    const m = new CrewMember(this.scene, def, spawn, this.world.colliders);
    const savedHealth = ensureCrewState().health[id];
    if (typeof savedHealth === 'number') {
      m.health = Math.max(0, Math.min(CREW_MAX_HEALTH, savedHealth));
      if (m.health <= 0) m._revive(); // never restore a member flat on the ground
    }
    this.members.push(m);
    return m;
  }

  // Driver skill, read by police.js via main.js each frame.
  policeModifiers() {
    const driver = this.member('vic');
    if (!driver || driver.down) return { bustHoldMult: 1, decayMult: 1 };
    return { bustHoldMult: DRIVER_BUST_MULT, decayMult: DRIVER_DECAY_MULT };
  }

  get driverActive() {
    const driver = this.member('vic');
    return !!driver && !driver.down;
  }

  get gunnerActive() {
    const gunner = this.member('lena');
    return !!gunner && !gunner.down;
  }

  update(dt) {
    const player = this.world.player;
    // Per-member follow offsets: Vic trails left, Lena trails right.
    const offsets = [{ x: -1.6, z: -2.6 }, { x: 1.6, z: -2.6 }];
    for (let i = 0; i < this.members.length; i++) {
      const m = this.members[i];
      m.update(dt, player, this.world, offsets[i % offsets.length]);
      // Persist health so a save mid-fight restores the crew as they were.
      ensureCrewState().health[m.def.id] = Math.round(m.health);
    }
  }

  // --- Recruit panel (K). DOM-only; a no-op without a document (Node). ---
  isPanelOpen() { return this._panelOpen; }

  openPanel() {
    if (typeof document === 'undefined') return false;
    if (!this._panel) this._buildPanel();
    this._renderPanel();
    this._panel.style.display = 'block';
    this._panelOpen = true;
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
    panel.id = 'crew-panel';
    panel.style.cssText = [
      'position:fixed', 'left:50%', 'top:50%', 'transform:translate(-50%,-50%)',
      'width:360px', 'max-width:92vw', 'z-index:60',
      'background:rgba(12,18,24,0.96)', 'border:1px solid #ffd23f', 'border-radius:10px',
      'color:#eee', 'font-family:inherit', 'padding:16px 18px',
      'box-shadow:0 8px 40px rgba(0,0,0,0.6)', 'display:none',
    ].join(';');
    document.body.appendChild(panel);
    panel.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('[data-recruit]') : null;
      if (btn) {
        this.tryRecruit(btn.getAttribute('data-recruit'));
        this._renderPanel();
        return;
      }
      if (e.target && e.target.closest && e.target.closest('[data-close]')) this.closePanel();
    });
    this._panel = panel;
  }

  _renderPanel() {
    if (!this._panel) return;
    const rows = CREW_DEFS.map((def) => {
      const recruited = this.isRecruited(def.id);
      const locked = !recruited && state.rep < def.minRep;
      const status = recruited
        ? '<span style="color:#7dff8a;font-weight:700;">IN YOUR CREW</span>'
        : locked
          ? `<span style="color:#ff9a7d;">Needs ${def.minRep} REP (${def.tierName}) — you have ${state.rep}</span>`
          : '<span style="color:#ffd23f;font-weight:700;">Available — recruit now</span>';
      const btn = recruited
        ? ''
        : `<button data-recruit="${def.id}" ${locked ? 'disabled' : ''} style="margin-top:8px;padding:7px 14px;border:0;border-radius:6px;background:${locked ? '#555' : '#ffd23f'};color:${locked ? '#bbb' : '#111'};font-weight:800;cursor:${locked ? 'not-allowed' : 'pointer'};">Recruit — ${def.minRep} REP</button>`;
      return `<div style="border:1px solid rgba(255,210,63,0.35);border-radius:8px;padding:10px 12px;margin-bottom:10px;">
        <div style="font-size:16px;font-weight:800;">${def.name} <span style="color:#ffd23f;">· ${def.skillName}</span></div>
        <div style="font-size:13px;color:#ccc;margin-top:2px;">${def.desc}</div>
        <div style="font-size:13px;margin-top:6px;">${status}</div>
        ${btn}
      </div>`;
    }).join('');
    this._panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <h2 style="margin:0;font-size:18px;">Crew — Solmar Bay</h2>
        <button data-close style="background:none;border:0;color:#eee;font-size:18px;cursor:pointer;">✕</button>
      </div>
      <p style="margin:0 0 12px;font-size:13px;color:#aaa;">Your REP: ${state.rep}. Press K to close.</p>
      ${rows}`;
  }
}

export default CrewManager;
