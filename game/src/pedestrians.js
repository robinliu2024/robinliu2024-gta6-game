// pedestrians.js — the people of Solmar Bay: walkers on the sidewalks, a few who
// flee from gunfire, and the armed Tidewater crew who fight back in mission 4.
// Pedestrians are simple capsule people; they keep to sidewalks and cross roads.
import * as THREE from 'three';
import { CITY_HALF, GRID, clamp, dist2D, mulberry32, roadCoord } from './config.js';

const SKINS = [0xc98e6b, 0x8a5a3b, 0xe8b88a, 0x6b4a2f, 0xd9a077];
const SHIRTS = [0xe8e8e8, 0x3a7bd6, 0xd63a2f, 0x37b06a, 0xe8b400, 0x8a5fb0, 0x222222];

function makePersonMesh(shirt, skin) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.34, 1.0, 8),
    new THREE.MeshLambertMaterial({ color: shirt }),
  );
  body.position.y = 0.95;
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 10, 8),
    new THREE.MeshLambertMaterial({ color: skin }),
  );
  head.position.y = 1.68;
  head.castShadow = true;
  g.add(head);
  const legMat = new THREE.MeshLambertMaterial({ color: 0x2a2f36 });
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.16), legMat);
  legL.position.set(-0.13, 0.25, 0);
  g.add(legL);
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.16), legMat);
  legR.position.set(0.13, 0.25, 0);
  g.add(legR);
  g.userData.legL = legL;
  g.userData.legR = legR;
  return g;
}

export function createPed(G, x, z, hostile) {
  const rng = G.rng;
  const mesh = makePersonMesh(
    hostile ? 0x7a1f1f : SHIRTS[Math.floor(rng() * SHIRTS.length)],
    SKINS[Math.floor(rng() * SKINS.length)],
  );
  mesh.position.set(x, 0, z);
  G.scene.add(mesh);
  const ped = {
    mesh, x, z, heading: rng() * Math.PI * 2,
    speed: 1.2 + rng() * 1.2,
    target: null,
    hostile: !!hostile,
    health: hostile ? 3 : 1,
    down: false,
    fleeTimer: 0,
    shootTimer: 1 + rng(),
    walkPhase: rng() * 6,
    scared: false,
  };
  if (hostile) G.rivals.push(ped);
  else G.peds.push(ped);
  return ped;
}

export function spawnPedestrians(G, count) {
  const rng = mulberry32(G.seed * 57 + 11);
  for (let i = 0; i < count; i += 1) {
    // Walkers stand on sidewalks: just off a road, inside a block edge.
    const road = roadCoord(Math.floor(rng() * (GRID + 1)));
    const along = (rng() - 0.5) * 2 * (CITY_HALF - 10);
    const horizontal = rng() < 0.5;
    const x = horizontal ? along : road + (rng() < 0.5 ? 9.5 : -9.5);
    const z = horizontal ? road + (rng() < 0.5 ? 9.5 : -9.5) : along;
    createPed(G, x, z, false);
  }
}

function pickSidewalkTarget(G, ped) {
  const rng = G.rng;
  const road = roadCoord(Math.floor(rng() * (GRID + 1)));
  const along = clamp(ped.z + (rng() - 0.5) * 120, -CITY_HALF, CITY_HALF);
  return { x: road + (rng() < 0.5 ? 9.5 : -9.5), z: along };
}

export function scarePeds(G, x, z, radius) {
  for (const ped of G.peds) {
    if (ped.down) continue;
    if (dist2D(ped.x, ped.z, x, z) < radius) {
      ped.scared = true;
      ped.fleeTimer = 4 + G.rng() * 3;
    }
  }
}

export function updatePed(G, ped, dt) {
  if (ped.down) return;
  const p = G.player;
  if (ped.hostile) {
    // Armed rival: walk toward the player and shoot when in range.
    const d = dist2D(ped.x, ped.z, p.x, p.z);
    const wantHeading = Math.atan2(p.x - ped.x, p.z - ped.z);
    ped.heading += clamp(wantHeading - ped.heading, -2.4 * dt, 2.4 * dt);
    if (d > 9) {
      ped.x += Math.sin(ped.heading) * 2.6 * dt;
      ped.z += Math.cos(ped.heading) * 2.6 * dt;
    } else {
      ped.shootTimer -= dt;
      if (ped.shootTimer <= 0) {
        ped.shootTimer = 1.1 + G.rng() * 0.8;
        G.effects.muzzle(ped.x, 1.5, ped.z);
        G.audio.shoot();
        if (G.rng() < 0.4) {
          // A rival bullet finds its mark.
          const dmg = p.inCar ? 2 : 6;
          G.effects.blood(p.x, p.z);
          // Damage the player through the shared helper in player.js (wired via G).
          if (G.hurtPlayer) G.hurtPlayer(dmg);
        }
      }
    }
  } else if (ped.scared || ped.fleeTimer > 0) {
    // Flee away from the player.
    ped.fleeTimer -= dt;
    const away = Math.atan2(ped.x - p.x, ped.z - p.z);
    ped.heading += clamp(away - ped.heading, -3 * dt, 3 * dt);
    ped.x += Math.sin(ped.heading) * 3.4 * dt;
    ped.z += Math.cos(ped.heading) * 3.4 * dt;
    if (ped.fleeTimer <= 0) ped.scared = false;
  } else {
    if (!ped.target || dist2D(ped.x, ped.z, ped.target.x, ped.target.z) < 3) {
      ped.target = pickSidewalkTarget(G, ped);
    }
    const wantHeading = Math.atan2(ped.target.x - ped.x, ped.target.z - ped.z);
    ped.heading += clamp(wantHeading - ped.heading, -2 * dt, 2 * dt);
    ped.x += Math.sin(ped.heading) * ped.speed * dt;
    ped.z += Math.cos(ped.heading) * ped.speed * dt;
  }
  // Keep inside the city and out of buildings.
  ped.x = clamp(ped.x, -CITY_HALF - 6, CITY_HALF + 6);
  ped.z = clamp(ped.z, -CITY_HALF - 6, CITY_HALF + 20);
  for (const b of G.colliders) {
    if (ped.x > b.minX - 0.4 && ped.x < b.maxX + 0.4 && ped.z > b.minZ - 0.4 && ped.z < b.maxZ + 0.4) {
      // Simple push-out along the shortest axis.
      const dxl = ped.x - (b.minX - 0.4);
      const dxr = (b.maxX + 0.4) - ped.x;
      const dzl = ped.z - (b.minZ - 0.4);
      const dzr = (b.maxZ + 0.4) - ped.z;
      const m = Math.min(dxl, dxr, dzl, dzr);
      if (m === dxl) ped.x = b.minX - 0.4;
      else if (m === dxr) ped.x = b.maxX + 0.4;
      else if (m === dzl) ped.z = b.minZ - 0.4;
      else ped.z = b.maxZ + 0.4;
      ped.target = null;
    }
  }
  ped.walkPhase += dt * (ped.hostile ? 7 : 5);
  ped.mesh.position.set(ped.x, 0, ped.z);
  ped.mesh.rotation.y = ped.heading;
  const swing = Math.sin(ped.walkPhase) * 0.5;
  ped.mesh.userData.legL.rotation.x = swing;
  ped.mesh.userData.legR.rotation.x = -swing;
}

/** Knock a pedestrian down (punch, bullet or car). Returns true if it went down. */
export function knockDownPed(G, ped) {
  if (ped.down) return false;
  ped.health -= 1;
  if (ped.health > 0) return false;
  ped.down = true;
  ped.mesh.rotation.x = -Math.PI / 2;
  ped.mesh.position.y = 0.35;
  G.effects.blood(ped.x, ped.z);
  G.stats.pedsDown += 1;
  if (ped.hostile) {
    const i = G.rivals.indexOf(ped);
    if (i >= 0) G.rivals.splice(i, 1);
    G.missionCombatKill();
  } else {
    // Hitting a civilian is a crime the SBPD notices.
    const { addWanted } = G.vehicleApi;
    addWanted(G, 1, 'assault on a pedestrian');
    scarePeds(G, ped.x, ped.z, 40);
  }
  return true;
}
