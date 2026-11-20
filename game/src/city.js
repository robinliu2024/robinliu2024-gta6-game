// Solmar Heat — city: builds the fictional Solmar Bay in three.js.
// Ground plane, road grid with markings, box buildings with canvas-generated
// window textures (no image files), streetlights, ocean + beach on the west
// side, drifting clouds, sun directional light with shadows, day lighting.

import * as THREE from 'three';
import { CITY, DISTRICTS, SPAWNS, makeRng } from './config.js';

// Road centre lines: grid every CITY.blockSize across the playable area.
export function roadLines() {
  const lines = [];
  for (let c = -CITY.halfSize; c <= CITY.halfSize; c += CITY.blockSize) {
    lines.push(c);
  }
  return lines;
}

export function nearestRoadPoint(x, z) {
  const lines = roadLines();
  const snap = (v) => lines.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
  return { x: snap(x), z: snap(z) };
}

export function spawnPoint(name) {
  const p = SPAWNS[name] || SPAWNS.player;
  return new THREE.Vector3(p.x, 0, p.z);
}

export function districtAt(x, z) {
  let best = null; let bestD = Infinity;
  for (const key of Object.keys(DISTRICTS)) {
    const d = DISTRICTS[key];
    const dist = Math.hypot(x - d.x, z - d.z);
    if (dist < bestD) { bestD = dist; best = d; }
  }
  return bestD <= (best ? best.r + 60 : 0) ? best : DISTRICTS.downtown;
}

// Canvas texture for a building facade: lit windows on a coloured wall.
function makeFacadeTexture(baseColor, rng, litRatio) {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, 128, 256);
  // Slight vertical shading so faces read as solid volumes.
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(255,255,255,0.14)');
  grad.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 256);
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 5; col++) {
      const lit = rng() < litRatio;
      ctx.fillStyle = lit ? '#ffd98a' : '#1d2b3a';
      ctx.fillRect(12 + col * 23, 14 + row * 24, 14, 15);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeRoadTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#2e3138';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#f5c542';
  ctx.fillRect(61, 8, 6, 44);
  ctx.fillRect(61, 76, 6, 44);
  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(4, 0, 3, 128);
  ctx.fillRect(121, 0, 3, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const PALETTE = ['#8a6f5c', '#5c7a8a', '#7a5c6e', '#6e7a5c', '#9a8a6a', '#5c6e8a', '#a06a4a', '#4a6e6a'];

export function buildCity(scene, options = {}) {
  const seed = options.seed ?? 1;
  const lowQuality = !!options.lowQuality;
  const rng = makeRng(seed);
  const group = new THREE.Group();
  group.name = 'solmar-city';
  const colliders = [];   // {x, z, halfX, halfZ} boxes gameplay parts use for collision
  const buildings = [];
  const clouds = [];

  // --- Lighting: warm day sun + soft sky fill. ---
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
  sun.position.set(180, 260, 120);
  sun.castShadow = true;
  sun.shadow.mapSize.set(lowQuality ? 1024 : 2048, lowQuality ? 1024 : 2048);
  sun.shadow.camera.left = -380; sun.shadow.camera.right = 380;
  sun.shadow.camera.top = 380; sun.shadow.camera.bottom = -380;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 900;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x8a7a5c, 0.9);
  scene.add(hemi);
  scene.background = new THREE.Color(0x87b5e0);
  scene.fog = new THREE.Fog(0x9fc3e8, 420, 1100);

  // --- Ground: grass/concrete base, plus a sand beach strip on the west. ---
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY.halfSize * 2 + CITY.oceanWidth + 80, CITY.halfSize * 2 + 80),
    new THREE.MeshStandardMaterial({ color: 0x7d9b6a, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(-CITY.oceanWidth / 2 + 40, 0, 0);
  ground.receiveShadow = true;
  group.add(ground);

  const beach = new THREE.Mesh(
    new THREE.PlaneGeometry(36, CITY.halfSize * 2 + 80),
    new THREE.MeshStandardMaterial({ color: 0xe0c98f, roughness: 1 }),
  );
  beach.rotation.x = -Math.PI / 2;
  beach.position.set(-CITY.halfSize - 18, 0.05, 0);
  beach.receiveShadow = true;
  group.add(beach);

  // --- Ocean: animated plane west of the beach. ---
  const oceanMat = new THREE.MeshStandardMaterial({
    color: 0x1e6f9e, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.94,
  });
  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY.oceanWidth, CITY.halfSize * 2 + 400, 24, 24),
    oceanMat,
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(-CITY.halfSize - 36 - CITY.oceanWidth / 2, -0.4, 0);
  ocean.name = 'ocean';
  group.add(ocean);

  // --- Roads: dark strips along every grid line + dashed centre texture. ---
  const roadTex = makeRoadTexture();
  const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.95 });
  const lines = roadLines();
  for (const c of lines) {
    // North-south road.
    const ns = new THREE.Mesh(new THREE.PlaneGeometry(CITY.roadWidth, CITY.halfSize * 2), roadMat.clone());
    ns.material.map = roadTex.clone();
    ns.material.map.needsUpdate = true;
    ns.material.map.repeat.set(1, (CITY.halfSize * 2) / 16);
    ns.rotation.x = -Math.PI / 2;
    ns.position.set(c, 0.08, 0);
    ns.receiveShadow = true;
    group.add(ns);
    // East-west road.
    const ew = new THREE.Mesh(new THREE.PlaneGeometry(CITY.halfSize * 2, CITY.roadWidth), roadMat.clone());
    ew.material.map = roadTex.clone();
    ew.material.map.needsUpdate = true;
    ew.material.map.repeat.set((CITY.halfSize * 2) / 16, 1);
    ew.rotation.x = -Math.PI / 2;
    ew.position.set(0, 0.08, c);
    ew.receiveShadow = true;
    group.add(ew);
  }

  // --- Buildings: one or two boxes per block, skipping road lines and
  // the Marlin Club / Safehouse plots, which get landmark meshes instead. ---
  const landmarkPlots = [
    { x: DISTRICTS.marlinClub.x, z: DISTRICTS.marlinClub.z },
    { x: DISTRICTS.safehouse.x, z: DISTRICTS.safehouse.z },
  ];
  const isLandmarkPlot = (x, z) => landmarkPlots.some((p) => Math.hypot(x - p.x, z - p.z) < 48);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  for (let gx = -CITY.halfSize + CITY.blockSize / 2; gx < CITY.halfSize; gx += CITY.blockSize) {
    for (let gz = -CITY.halfSize + CITY.blockSize / 2; gz < CITY.halfSize; gz += CITY.blockSize) {
      if (gx < -CITY.halfSize + 40) continue; // keep the beach clear
      if (isLandmarkPlot(gx, gz)) continue;
      if (rng() < 0.18) continue; // empty lots / parking
      const w = 22 + rng() * 18;
      const d = 22 + rng() * 18;
      const downtownBoost = Math.hypot(gx, gz) < 140 ? 1.8 : 1;
      const h = (14 + rng() * 30) * downtownBoost;
      const color = PALETTE[Math.floor(rng() * PALETTE.length)];
      const tex = makeFacadeTexture(color, rng, 0.35);
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
      const b = new THREE.Mesh(boxGeo, mat);
      b.scale.set(w, h, d);
      b.position.set(gx + (rng() - 0.5) * 8, h / 2, gz + (rng() - 0.5) * 8);
      b.castShadow = true; b.receiveShadow = true;
      group.add(b);
      buildings.push(b);
      colliders.push({ x: b.position.x, z: b.position.z, halfX: w / 2 + 1, halfZ: d / 2 + 1 });
      // Rooftop box on taller towers.
      if (h > 40 && rng() < 0.5) {
        const roof = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 1 }));
        roof.scale.set(w * 0.35, 4, d * 0.35);
        roof.position.set(b.position.x, h + 2, b.position.z);
        roof.castShadow = true;
        group.add(roof);
      }
    }
  }

  // --- Landmarks: Marlin Club (neon-trimmed low block) and Safehouse. ---
  function landmark(x, z, color, trim, label) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
    base.scale.set(40, 16, 28);
    base.position.y = 8;
    base.castShadow = true; base.receiveShadow = true;
    g.add(base);
    const trimMesh = new THREE.Mesh(
      new THREE.BoxGeometry(41, 1.2, 29),
      new THREE.MeshStandardMaterial({ color: trim, emissive: trim, emissiveIntensity: 1.4 }),
    );
    trimMesh.position.y = 16.4;
    g.add(trimMesh);
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(20, 3, 1),
      new THREE.MeshStandardMaterial({ color: 0x111111, emissive: trim, emissiveIntensity: 0.9 }),
    );
    sign.position.set(0, 13, 14.6);
    g.add(sign);
    g.position.set(x, 0, z);
    g.name = label;
    group.add(g);
    colliders.push({ x, z, halfX: 21, halfZ: 15 });
    return g;
  }
  landmark(DISTRICTS.marlinClub.x, DISTRICTS.marlinClub.z, 0x2a1e3a, 0xff2e88, 'marlin-club');
  landmark(DISTRICTS.safehouse.x, DISTRICTS.safehouse.z, 0x3a3a2a, 0x7dff5e, 'safehouse');

  // --- Streetlights along roads (every other block corner). ---
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.6, metalness: 0.6 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffe9a0, emissiveIntensity: 1.2 });
  const poleGeo = new THREE.CylinderGeometry(0.18, 0.24, 7, 6);
  const lampGeo = new THREE.SphereGeometry(0.5, 8, 6);
  const lightCount = lowQuality ? 24 : 48;
  for (let i = 0; i < lightCount; i++) {
    const line = lines[Math.floor(rng() * lines.length)];
    const along = -CITY.halfSize + rng() * CITY.halfSize * 2;
    const horizontal = rng() < 0.5;
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(horizontal ? line + CITY.roadHalf + 1 : along, 3.5, horizontal ? along : line + CITY.roadHalf + 1);
    pole.castShadow = true;
    group.add(pole);
    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.copy(pole.position).y = 7.1;
    group.add(lamp);
  }

  // --- Clouds: flat white blobs drifting above the city. ---
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.85 });
  const cloudGeo = new THREE.SphereGeometry(1, 10, 8);
  const cloudCount = lowQuality ? 6 : 12;
  for (let i = 0; i < cloudCount; i++) {
    const cloud = new THREE.Group();
    const puffs = 3 + Math.floor(rng() * 3);
    for (let j = 0; j < puffs; j++) {
      const puff = new THREE.Mesh(cloudGeo, cloudMat);
      const s = 10 + rng() * 16;
      puff.scale.set(s, s * 0.45, s * 0.7);
      puff.position.set((rng() - 0.5) * 36, (rng() - 0.5) * 4, (rng() - 0.5) * 18);
      cloud.add(puff);
    }
    cloud.position.set(-300 + rng() * 640, 110 + rng() * 50, -300 + rng() * 640);
    cloud.userData.speed = 1.5 + rng() * 2;
    group.add(cloud);
    clouds.push(cloud);
  }

  // Boardwalk pier: wooden planks jutting into the ocean.
  const pier = new THREE.Mesh(
    new THREE.BoxGeometry(90, 1.2, 10),
    new THREE.MeshStandardMaterial({ color: 0x8a6a44, roughness: 1 }),
  );
  pier.position.set(-CITY.halfSize - 50, 0.8, DISTRICTS.boardwalk.z);
  pier.castShadow = true; pier.receiveShadow = true;
  group.add(pier);

  scene.add(group);
  return { group, sun, ocean, clouds, colliders, buildings };
}

// Per-frame city animation: clouds drift, ocean gently bobs.
export function updateCity(city, delta, time) {
  if (!city) return;
  for (const cloud of city.clouds) {
    cloud.position.x += cloud.userData.speed * delta;
    if (cloud.position.x > 380) cloud.position.x = -380;
  }
  if (city.ocean) {
    city.ocean.position.y = -0.4 + Math.sin(time * 0.6) * 0.12;
  }
}
