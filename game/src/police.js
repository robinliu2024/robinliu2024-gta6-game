// police.js — the Solmar Bay Police Department: the wanted level, how police
// spawn and chase, and how the player gets busted or loses the heat.
// Wanted rises with crimes and decays when no cop can see the player; at
// 3+ stars the SBPD sends more cars, and they ram harder.
import { CITY_HALF, clamp, dist2D, mulberry32 } from './config.js';
import { driveCar, removeCar, spawnPoliceCar } from './vehicles.js';

const COP_SIGHT = 55;      // a cop car this close can see the player
const DECAY_PER_SECOND = 0.05;

function wantedTargetCount(wanted) {
  return wanted <= 0 ? 0 : wanted <= 1 ? 1 : wanted <= 2 ? 2 : wanted <= 3 ? 3 : 4;
}

export function updatePolice(G, dt) {
  const p = G.player;
  // Keep the right number of interceptors on the street for the wanted level.
  const want = wantedTargetCount(p.wanted);
  if (G.policeCars.length < want) {
    if (G.spawnTimer === undefined) G.spawnTimer = 0;
    G.spawnTimer -= dt;
    if (G.spawnTimer <= 0) {
      spawnPoliceCar(G);
      G.spawnTimer = 2.5;
    }
  } else if (G.policeCars.length > want) {
    // Extra cars peel off and despawn once they are far away.
    const far = G.policeCars.find((c) => dist2D(c.x, c.z, p.x, p.z) > 160);
    if (far) removeCar(G, far);
  }

  // Wanted decays only while no cop is close enough to see the player.
  let seen = false;
  for (const cop of G.policeCars) {
    if (dist2D(cop.x, cop.z, p.x, p.z) < COP_SIGHT) { seen = true; break; }
  }
  if (!seen && p.wanted > 0) {
    p.wantedHeat -= DECAY_PER_SECOND * dt;
    if (p.wantedHeat <= 0) {
      p.wanted -= 1;
      p.wantedHeat = 1;
      G.stats.copsDodged += 1;
      G.toast = p.wanted === 0 ? 'You lost the cops.' : `Wanted level down to ${p.wanted}★`;
      G.toastTimer = 2.5;
      G.audio.coin();
    }
  } else if (seen) {
    p.wantedHeat = 1;
  }

  // Chase: each interceptor steers at the player and rams. On foot, a cop car
  // that parks on top of the player starts the bust.
  for (const cop of [...G.policeCars]) {
    const d = dist2D(cop.x, cop.z, p.x, p.z);
    const wantHeading = Math.atan2(p.x - cop.x, p.z - cop.z);
    let dh = wantHeading - cop.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    const steer = clamp(dh * 1.6, -1, 1);
    const aggression = 0.75 + p.wanted * 0.08;
    const forward = d > 6 ? 1 : 0.4;
    driveCar(G, cop, { forward: forward * aggression, steer, brake: false }, dt);
    // Flash the light bar.
    const flash = Math.sin(G.time * 9) > 0;
    if (cop.mesh.userData.lightRed) cop.mesh.userData.lightRed.visible = flash;
    if (cop.mesh.userData.lightBlue) cop.mesh.userData.lightBlue.visible = !flash;

    if (!p.inCar && d < 3.2) {
      // Busted: the SBPD has you cornered on foot.
      p.bustedMeter += dt * (p.wanted >= 3 ? 1.4 : 0.8);
      if (p.bustedMeter > 0.2) {
        G.toast = 'The SBPD is cuffing you…';
        G.toastTimer = 1;
      }
      if (p.bustedMeter >= 2.2) {
        p.dead = true;
        G.endReason = 'busted';
        G.screen = 'over';
        G.audio.busted();
      }
    } else {
      p.bustedMeter = Math.max(0, p.bustedMeter - dt * 0.5);
    }
    // A ram at speed hurts the player's car and the player.
    if (p.inCar && d < 3.6 && Math.abs(cop.speed) > 8) {
      G.hurtPlayer(2);
      G.audio.crash();
      cop.speed *= 0.4;
    }
    // Cop cars that fall far behind respawn closer so the chase never dies.
    if (d > 220) {
      cop.x = clamp(p.x + (G.rng() < 0.5 ? -1 : 1) * 60, -CITY_HALF, CITY_HALF);
      cop.z = clamp(p.z + (G.rng() < 0.5 ? -1 : 1) * 60, -CITY_HALF, CITY_HALF);
      cop.speed = 10;
    }
  }
}
