// hud.js — the 2D overlay: health, money, rep, wanted stars, mission objective,
// speedometer, toasts, banners, and the circular minimap drawn on a canvas.
// The minimap is a top-down view: roads, the player arrow, cars, police, peds
// and the gold mission marker, all in Solmar Bay colours.
import { CITY_HALF, GRID, PITCH, ROAD, blockCoord, roadCoord } from './config.js';

export function createHud(G) {
  const $ = (id) => document.getElementById(id);
  const els = {
    hud: $('hud'), healthBar: $('health-bar'), healthText: $('health-text'),
    moneyText: $('money-text'), repText: $('rep-text'), missionName: $('mission-name'),
    wanted: $('wanted'), objectiveText: $('objective-text'),
    speedo: $('speedo'), speedText: $('speed-text'),
    minimap: $('minimap'), crosshair: $('crosshair'),
    toast: $('toast'), interact: $('interact'), vignette: $('vignette'),
    banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
  };
  const mm = els.minimap.getContext('2d');
  let lastHealth = -1;
  let lastMoney = -1;
  let lastWanted = -1;

  function drawMinimap() {
    const S = 200;
    const scale = S / (CITY_HALF * 2 + 60);
    const toPx = (v) => (v + CITY_HALF + 30) * scale;
    mm.clearRect(0, 0, S, S);
    mm.fillStyle = '#0d1b2a';
    mm.fillRect(0, 0, S, S);
    // Beach + ocean at the south edge.
    mm.fillStyle = '#e8d8a0';
    mm.fillRect(0, toPx(CITY_HALF), S, 8);
    mm.fillStyle = '#1e6f9e';
    mm.fillRect(0, toPx(CITY_HALF) + 8, S, S - toPx(CITY_HALF) - 8);
    // Blocks and roads.
    mm.fillStyle = '#2c3a4a';
    for (let i = 0; i < GRID; i += 1) {
      for (let j = 0; j < GRID; j += 1) {
        mm.fillRect(toPx(blockCoord(i) - 23), toPx(blockCoord(j) - 23), 46 * scale, 46 * scale);
      }
    }
    mm.fillStyle = '#5a6a7a';
    for (let i = 0; i <= GRID; i += 1) {
      mm.fillRect(toPx(roadCoord(i) - ROAD / 2), 0, ROAD * scale, S);
      mm.fillRect(0, toPx(roadCoord(i) - ROAD / 2), S, ROAD * scale);
    }
    const dot = (x, z, color, r) => {
      mm.fillStyle = color;
      mm.beginPath();
      mm.arc(toPx(x), toPx(z), r, 0, Math.PI * 2);
      mm.fill();
    };
    // Mission marker: pulsing gold ring.
    if (G.missionTarget) {
      const pulse = 5 + Math.sin(G.time * 5) * 2;
      mm.strokeStyle = '#ffb400';
      mm.lineWidth = 2;
      mm.beginPath();
      mm.arc(toPx(G.missionTarget.x), toPx(G.missionTarget.z), pulse, 0, Math.PI * 2);
      mm.stroke();
      dot(G.missionTarget.x, G.missionTarget.z, '#ffb400', 3);
    }
    // Traffic (grey), police (blue/red), rivals (red).
    for (const car of G.cars) dot(car.x, car.z, '#9aa7b5', 2);
    for (const cop of G.policeCars) dot(cop.x, cop.z, Math.sin(G.time * 9) > 0 ? '#ff2020' : '#2050ff', 3);
    for (const ped of G.rivals) dot(ped.x, ped.z, '#ff4040', 2.5);
    // Player arrow, pointing where Rico faces: canvas x = world x, canvas y = world z.
    const px = toPx(G.player.x);
    const pz = toPx(G.player.z);
    mm.save();
    mm.translate(px, pz);
    mm.rotate(Math.PI - G.player.heading);
    mm.fillStyle = '#ffffff';
    mm.beginPath();
    mm.moveTo(0, -7); mm.lineTo(5, 6); mm.lineTo(0, 3); mm.lineTo(-5, 6); mm.closePath();
    mm.fill();
    mm.restore();
    // North marker.
    mm.fillStyle = 'rgba(255,255,255,0.8)';
    mm.font = 'bold 11px Arial';
    mm.textAlign = 'center';
    mm.fillText('N', S / 2, 12);
  }

  return {
    showHud(on) { els.hud.classList.toggle('hidden', !on); },
    showCarHint(on) { els.speedo.classList.toggle('hidden', !on); },
    showInteract(on, name) {
      els.interact.classList.toggle('hidden', !on);
      if (on) els.interact.innerHTML = `Press <b>E</b> to enter the ${name}`;
    },
    setObjective(text) { els.objectiveText.textContent = text; },
    setMissionName(text) { els.missionName.textContent = text; },
    showToast(text) {
      G.toast = text;
      G.toastTimer = 3;
    },
    showBanner(title, sub) {
      els.bannerTitle.textContent = title;
      els.bannerSub.textContent = sub;
      els.banner.classList.remove('hidden');
      setTimeout(() => els.banner.classList.add('hidden'), 3500);
    },
    /** Refresh the HUD numbers and the minimap; cheap enough to run every frame. */
    update() {
      const p = G.player;
      if (p.health !== lastHealth) {
        lastHealth = p.health;
        els.healthBar.style.width = `${Math.max(0, p.health)}%`;
        els.healthText.textContent = String(Math.round(p.health));
        els.healthBar.style.background = p.health > 50
          ? 'linear-gradient(90deg,#37d67a,#7be495)'
          : p.health > 25 ? 'linear-gradient(90deg,#e8b400,#ffd76a)' : 'linear-gradient(90deg,#d63a2f,#ff7a6a)';
      }
      if (p.money !== lastMoney) {
        lastMoney = p.money;
        els.moneyText.textContent = String(Math.round(p.money));
        els.repText.textContent = String(p.rep);
      }
      if (p.wanted !== lastWanted) {
        lastWanted = p.wanted;
        const stars = els.wanted.querySelectorAll('.star');
        stars.forEach((s, i) => {
          s.classList.toggle('on', i < p.wanted);
          s.classList.toggle('hot', i < p.wanted && p.wanted >= 3);
        });
      }
      els.speedText.textContent = String(Math.round(p.speed || 0));
      els.crosshair.classList.toggle('hidden', !!p.inCar);
      els.vignette.classList.toggle('hurt', G.hurtFlash > 0.3);
      // Toasts show while their timer runs; the banner while its timer runs.
      if (G.toastTimer > 0 && G.toast) {
        els.toast.textContent = G.toast;
        els.toast.classList.add('show');
      } else {
        els.toast.classList.remove('show');
      }
      if (G.banner) {
        els.bannerTitle.textContent = G.banner.title;
        els.bannerSub.textContent = G.banner.sub;
        els.banner.classList.remove('hidden');
      } else {
        els.banner.classList.add('hidden');
      }
      drawMinimap();
    },
  };
}
