// Solmar Heat — HUD: health, money, rep, debt, wanted stars, mission
// objective (with the 5-second dialogue hold), speedometer, district label
// and a circular canvas minimap (roads, player arrow, police, mission target).
// Pure DOM + canvas 2D; it reads the shared state object every frame.

import { CITY, MAX_WANTED } from './config.js';
import { state, currentMission, currentObjective } from './state.js';
import { roadLines, districtAt } from './city.js';

const WORLD = CITY.halfSize; // world x/z run -320..320

function money(n) {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

export function createHud(deps = {}) {
  const getPlayer = deps.getPlayer || (() => null);
  const getPolice = deps.getPolice || (() => null);
  const getMissions = deps.getMissions || (() => null);
  // Dialogue hold: main.js owns the timer; we only ask whether a line is
  // still live and what it says, and never overwrite it while it is live.
  const getDialogue = deps.getDialogue || (() => ({ text: '', active: false }));

  const el = (id) => document.getElementById(id);
  const refs = {
    money: el('hud-money'),
    debt: el('hud-debt'),
    rep: el('hud-rep'),
    stars: el('hud-stars'),
    healthFill: el('hud-health-fill'),
    healthBar: el('hud-health'),
    objective: el('hud-objective'),
    district: el('hud-district'),
    mission: el('hud-mission'),
    hud: el('hud'),
    minimap: el('minimap'),
  };

  // Speedometer, created once (no matching element exists in index.html).
  let speedEl = el('hud-speed');
  if (!speedEl && refs.hud) {
    speedEl = document.createElement('div');
    speedEl.id = 'hud-speed';
    speedEl.style.cssText = [
      'position:absolute', 'right:18px', 'bottom:208px',
      'font-size:26px', 'font-weight:800', 'color:#fff',
      'text-shadow:0 1px 6px rgba(0,0,0,0.9)', 'text-align:right',
    ].join(';');
    refs.hud.appendChild(speedEl);
  }
  refs.speed = speedEl;

  // Weapon bar + ammo readout (combat, part B v2), created once.
  let weaponEl = el('hud-weapons');
  if (!weaponEl && refs.hud) {
    weaponEl = document.createElement('div');
    weaponEl.id = 'hud-weapons';
    weaponEl.style.cssText = [
      'position:absolute', 'left:18px', 'bottom:18px',
      'display:flex', 'gap:8px', 'align-items:flex-end',
      'font-family:inherit', 'pointer-events:none',
    ].join(';');
    refs.hud.appendChild(weaponEl);
  }
  refs.weapons = weaponEl;

  // Crosshair, shown only while on foot with the pointer locked.
  let crossEl = el('hud-crosshair');
  if (!crossEl && refs.hud) {
    crossEl = document.createElement('div');
    crossEl.id = 'hud-crosshair';
    crossEl.style.cssText = [
      'position:absolute', 'left:50%', 'top:50%',
      'width:22px', 'height:22px', 'margin:-11px 0 0 -11px',
      'pointer-events:none', 'display:none',
    ].join(';');
    crossEl.innerHTML = [
      '<div style="position:absolute;left:10px;top:0;width:2px;height:7px;background:#fff;box-shadow:0 0 3px #000;"></div>',
      '<div style="position:absolute;left:10px;bottom:0;width:2px;height:7px;background:#fff;box-shadow:0 0 3px #000;"></div>',
      '<div style="position:absolute;top:10px;left:0;width:7px;height:2px;background:#fff;box-shadow:0 0 3px #000;"></div>',
      '<div style="position:absolute;top:10px;right:0;width:7px;height:2px;background:#fff;box-shadow:0 0 3px #000;"></div>',
      '<div style="position:absolute;left:10px;top:10px;width:2px;height:2px;background:#ffd23f;"></div>',
    ].join('');
    refs.hud.appendChild(crossEl);
  }
  refs.crosshair = crossEl;

  // Minimap canvas, drawn over the round #minimap div.
  let mapCanvas = el('minimap-canvas');
  if (!mapCanvas && refs.minimap) {
    mapCanvas = document.createElement('canvas');
    mapCanvas.id = 'minimap-canvas';
    mapCanvas.width = 140;
    mapCanvas.height = 140;
    mapCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border-radius:50%;';
    refs.minimap.appendChild(mapCanvas);
    const dot = el('minimap-player');
    if (dot) dot.style.display = 'none'; // the canvas draws the arrow now
  }
  const mapCtx = mapCanvas ? mapCanvas.getContext('2d') : null;

  const mapX = (x) => ((x + WORLD) / (WORLD * 2)) * 140;
  const mapY = (z) => ((z + WORLD) / (WORLD * 2)) * 140;

  function drawMinimap() {
    if (!mapCtx) return;
    const ctx = mapCtx;
    const S = 140;
    ctx.clearRect(0, 0, S, S);
    // Round clip so the square canvas stays inside the round frame.
    ctx.save();
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    ctx.clip();
    // Sea on the west edge, land elsewhere.
    ctx.fillStyle = '#16242f';
    ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = '#2e4a5e';
    ctx.fillRect(mapX(-WORLD), 0, S - mapX(-WORLD), S);
    ctx.fillStyle = '#1d3a4d';
    ctx.fillRect(0, 0, mapX(-WORLD + 36), S);
    // Road grid, north up (world -z is up on the map).
    ctx.strokeStyle = 'rgba(232,232,232,0.55)';
    ctx.lineWidth = 2;
    for (const line of roadLines()) {
      ctx.beginPath(); ctx.moveTo(mapX(line), 0); ctx.lineTo(mapX(line), S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, mapY(line)); ctx.lineTo(S, mapY(line)); ctx.stroke();
    }
    const missions = getMissions();
    if (missions && missions.beacon && missions.beacon.visible) {
      const b = missions.beacon.position;
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      ctx.arc(mapX(b.x), mapY(b.z), 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    const police = getPolice();
    if (police && police.cops) {
      ctx.fillStyle = '#ff4d4d';
      for (const cop of police.cops) {
        ctx.beginPath();
        ctx.arc(mapX(cop.position.x), mapY(cop.position.z), 3, 0, Math.PI * 2);
        ctx.fill();
      }
      // Helicopter overhead (cyan ring) and roadblock (orange squares).
      if (police.heli) {
        ctx.strokeStyle = '#4dd8ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(mapX(police.heli.position.x), mapY(police.heli.position.z), 5, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (police.roadblock) {
        ctx.fillStyle = '#ff9a1a';
        for (const { collider } of police.roadblock.entries) {
          ctx.fillRect(mapX(collider.x) - 3, mapY(collider.z) - 3, 6, 6);
        }
      }
    }
    const player = getPlayer();
    if (player) {
      const px = mapX(player.position.x);
      const py = mapY(player.position.z);
      const heading = player.vehicle ? player.vehicle.heading : player.heading;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(Math.PI - heading); // north up: heading 0 (+z) points down
      ctx.fillStyle = '#ffd23f';
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(5, 6);
      ctx.lineTo(-5, 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  let lastObjective = '';
  function update(dt, elapsed) {
    void dt;
    void elapsed;
    if (refs.money) refs.money.textContent = money(state.money);
    if (refs.debt) refs.debt.textContent = `Debt ${money(state.debt)}`;
    if (refs.rep) refs.rep.textContent = `REP ${state.rep}`;
    if (refs.stars) {
      const w = Math.max(0, Math.min(MAX_WANTED, state.wanted));
      refs.stars.textContent = '★'.repeat(w) + '☆'.repeat(MAX_WANTED - w);
      refs.stars.classList.toggle('hot', w > 0);
    }
    if (refs.healthFill) {
      const pct = Math.max(0, Math.min(100, state.health));
      refs.healthFill.style.width = `${pct}%`;
      refs.healthFill.style.background = pct > 50
        ? 'linear-gradient(90deg,#37d67a,#7dff8a)'
        : pct > 25
          ? 'linear-gradient(90deg,#d6a437,#ffd23f)'
          : 'linear-gradient(90deg,#d63737,#ff7d7d)';
    }
    const mission = currentMission();
    if (refs.mission) {
      refs.mission.textContent = mission
        ? `${mission.id.toUpperCase()} · ${mission.name}`
        : (state.won ? 'DEBT FREE' : 'FREE ROAM');
    }
    if (refs.objective) {
      const dlg = getDialogue();
      if (dlg && dlg.active && dlg.text) {
        refs.objective.textContent = dlg.text;
        lastObjective = dlg.text;
      } else {
        const obj = currentObjective();
        const text = state.gameOver
          ? 'Rico is down. The debt is still waiting.'
          : obj ? obj.text : 'Explore Solmar Bay. Pay off your debt.';
        if (text !== lastObjective) {
          refs.objective.textContent = text;
          lastObjective = text;
        }
      }
    }
    const player = getPlayer();
    if (refs.district && player) {
      refs.district.textContent = districtAt(player.position.x, player.position.z).name;
    }
    if (refs.speed) {
      const mph = player && player.vehicle ? Math.round(player.vehicle.speedMph) : 0;
      refs.speed.textContent = player && !player.onFoot ? `${mph} MPH` : '';
    }
    // Weapon slots + ammo (combat): three slots, active one highlighted.
    if (refs.weapons && player && player.combat) {
      const c = player.combat;
      const order = ['pistol', 'shotgun', 'rifle'];
      const labels = { pistol: '1 PISTOL', shotgun: '2 SHOTGUN', rifle: '3 RIFLE' };
      const names = { pistol: 'Pistol', shotgun: 'Shotgun', rifle: 'Rifle' };
      let html = '';
      for (const id of order) {
        const a = c.ammo(id);
        const active = c.currentId === id;
        html += `<div style="padding:4px 8px;border-radius:4px;background:${active ? 'rgba(255,210,63,0.9)' : 'rgba(0,0,0,0.55)'};color:${active ? '#111' : '#ddd'};font-size:12px;font-weight:${active ? 800 : 600};text-shadow:none;">${labels[id]} <span style="opacity:${active ? 1 : 0.75}">${a.mag}/${a.reserve}</span></div>`;
      }
      const status = c.reloading
        ? 'RELOADING…'
        : c.isEmpty
          ? (c.reserve > 0 ? 'EMPTY — PRESS R' : 'NO AMMO')
          : `${names[c.currentId].toUpperCase()} ${c.mag}/${c.reserve}`;
      html += `<div style="padding:4px 8px;border-radius:4px;background:rgba(0,0,0,0.55);color:${c.isEmpty ? '#ff7d7d' : '#fff'};font-size:14px;font-weight:800;">${status}</div>`;
      if (refs.weapons.innerHTML !== html) refs.weapons.innerHTML = html;
      refs.weapons.style.display = player.onFoot ? 'flex' : 'none';
    }
    // Crosshair: on foot, started, not game over.
    if (refs.crosshair) {
      const show = !!player && player.onFoot && state.started && !state.gameOver && !state.paused;
      refs.crosshair.style.display = show ? 'block' : 'none';
    }
    drawMinimap();
  }

  return { update, drawMinimap, refs };
}

export default createHud;
