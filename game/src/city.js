// city.js — builds Solmar Bay: the road grid, buildings, palms, lamps, beach and
// ocean, the sun and sky. Everything is procedural (canvas textures, boxes,
// cylinders): no external art, and every building registers a collider so cars
// and the player cannot drive through it.
import * as THREE from 'three';
import { BLOCK, CITY_HALF, GRID, PITCH, ROAD, blockCoord, mulberry32, pick, roadCoord } from './config.js';

const BUILDING_COLORS = [0xd8c9a8, 0xc9d6dd, 0xe8b48a, 0xb8c4b0, 0xd9a0a0, 0xa8b8d8, 0xe0d0b8, 0x9fb8a8];
const ROOF_COLORS = [0x8a6f4d, 0x6f7f8a, 0xa85f4d, 0x5d7a5d];

function makeGroundTexture(rng) {
  const S = 1024;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const c = cv.getContext('2d');
  const worldToPx = S / (CITY_HALF * 2 + 60);
  const toPx = (v) => (v + CITY_HALF + 30) * worldToPx;
  // Base: dry grass / sand lots.
  c.fillStyle = '#b8a06a'; c.fillRect(0, 0, S, S);
  // Blocks: pale pavement with a little noise.
  for (let i = 0; i < GRID; i += 1) {
    for (let j = 0; j < GRID; j += 1) {
      const x = toPx(blockCoord(i) - BLOCK / 2);
      const z = toPx(blockCoord(j) - BLOCK / 2);
      const w = BLOCK * worldToPx;
      c.fillStyle = rng() < 0.18 ? '#7fae72' : '#c9b489'; // some blocks are parks
      c.fillRect(x, z, w, w);
      c.strokeStyle = 'rgba(0,0,0,0.12)';
      c.strokeRect(x, z, w, w);
    }
  }
  // Roads: asphalt with centre dashes and crosswalks.
  c.fillStyle = '#3a3f46';
  for (let i = 0; i <= GRID; i += 1) {
    const p = roadCoord(i);
    c.fillRect(toPx(p - ROAD / 2), 0, ROAD * worldToPx, S);
    c.fillRect(0, toPx(p - ROAD / 2), S, ROAD * worldToPx);
  }
  c.fillStyle = '#e8d44d';
  for (let i = 0; i <= GRID; i += 1) {
    const p = roadCoord(i);
    for (let d = -CITY_HALF; d < CITY_HALF; d += 12) {
      c.fillRect(toPx(p) - 1, toPx(d), 2, 5 * worldToPx);
      c.fillRect(toPx(d), toPx(p) - 1, 5 * worldToPx, 2);
    }
  }
  // Beach strip along the south edge (+z) and the boardwalk.
  c.fillStyle = '#e8d8a0';
  c.fillRect(0, toPx(CITY_HALF), S, 26 * worldToPx);
  c.fillStyle = '#8a6f4d';
  c.fillRect(0, toPx(CITY_HALF), S, 4 * worldToPx);
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeFacadeTexture(baseColor, rng) {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 256;
  const c = cv.getContext('2d');
  c.fillStyle = baseColor;
  c.fillRect(0, 0, 128, 256);
  // Window grid, some lit.
  for (let y = 14; y < 244; y += 28) {
    for (let x = 12; x < 116; x += 26) {
      const lit = rng() < 0.25;
      c.fillStyle = lit ? '#ffe9a8' : '#2a3542';
      c.fillRect(x, y, 16, 18);
      c.fillStyle = 'rgba(255,255,255,0.25)';
      c.fillRect(x, y, 16, 3);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeSignTexture(text, bg, fg) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 128;
  const c = cv.getContext('2d');
  c.fillStyle = bg; c.fillRect(0, 0, 512, 128);
  c.fillStyle = fg;
  c.font = 'bold 64px Arial, sans-serif';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(text, 256, 68);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makePalm(rng) {
  const g = new THREE.Group();
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a6f4d });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, 4.6, 6), trunkMat);
  trunk.position.y = 2.3;
  trunk.rotation.z = (rng() - 0.5) * 0.16;
  g.add(trunk);
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x3f9e4d });
  for (let i = 0; i < 6; i += 1) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.5, 3.4, 4), leafMat);
    const a = (i / 6) * Math.PI * 2;
    leaf.position.set(Math.cos(a) * 1.1, 4.9, Math.sin(a) * 1.1);
    leaf.rotation.z = Math.cos(a) * 1.1;
    leaf.rotation.x = -Math.sin(a) * 1.1;
    leaf.scale.set(1, 1, 0.25);
    g.add(leaf);
  }
  const nut = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshLambertMaterial({ color: 0x6b4a2a }));
  nut.position.y = 4.5;
  g.add(nut);
  return g;
}

export function buildCity(G) {
  const rng = mulberry32(G.seed * 7919 + 13);
  const scene = G.scene;
  scene.background = new THREE.Color(0x87b5e0);
  scene.fog = new THREE.Fog(0x9ec3e8, 180, 520);

  // Sun + sky light: late-afternoon, warm.
  const sun = new THREE.DirectionalLight(0xffe0b0, 2.6);
  sun.position.set(120, 160, 60);
  sun.castShadow = true;
  const shadowSize = G.lowQuality ? 1024 : 2048;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.camera.left = -220; sun.shadow.camera.right = 220;
  sun.shadow.camera.top = 220; sun.shadow.camera.bottom = -220;
  sun.shadow.camera.far = 500;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  G.sun = sun;
  scene.add(new THREE.HemisphereLight(0xbfd9ff, 0x8a7a5a, 1.1));

  // Ground.
  const groundSize = CITY_HALF * 2 + 60;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(groundSize, groundSize + 90),
    new THREE.MeshLambertMaterial({ map: makeGroundTexture(rng) }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.z = 45;
  ground.receiveShadow = true;
  scene.add(ground);

  // Ocean south of the beach.
  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 260),
    new THREE.MeshLambertMaterial({ color: 0x1e6f9e, transparent: true, opacity: 0.92 }),
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(0, 0.05, CITY_HALF + 30 + 130 + 45); // just above the ground plane so the water shows
  scene.add(ocean);
  G.ocean = ocean;

  // Buildings, one or two per block; a few blocks stay open as parks / lots.
  const facadeCache = new Map();
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const roofGeo = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < GRID; i += 1) {
    for (let j = 0; j < GRID; j += 1) {
      const cx = blockCoord(i);
      const cz = blockCoord(j);
      const roll = rng();
      if (roll < 0.14) continue; // park / empty lot
      const color = pick(rng, BUILDING_COLORS);
      const key = color.toString(16);
      if (!facadeCache.has(key)) {
        facadeCache.set(key, makeFacadeTexture(`#${color.toString(16).padStart(6, '0')}`, rng));
      }
      const mat = new THREE.MeshLambertMaterial({ map: facadeCache.get(key) });
      const roofMat = new THREE.MeshLambertMaterial({ color: pick(rng, ROOF_COLORS) });
      const count = roll < 0.55 ? 1 : 2;
      for (let k = 0; k < count; k += 1) {
        const w = 16 + rng() * 16;
        const d = 16 + rng() * 16;
        const h = 9 + rng() * rng() * 34;
        const ox = count === 1 ? 0 : (k === 0 ? -BLOCK / 4.6 : BLOCK / 4.6);
        const oz = count === 1 ? 0 : (k === 0 ? -BLOCK / 4.6 : BLOCK / 4.6);
        const b = new THREE.Mesh(boxGeo, mat);
        b.scale.set(w, h, d);
        b.position.set(cx + ox, h / 2, cz + oz);
        b.castShadow = true;
        b.receiveShadow = true;
        scene.add(b);
        const roof = new THREE.Mesh(roofGeo, roofMat);
        roof.scale.set(w + 0.6, 0.8, d + 0.6);
        roof.position.set(cx + ox, h + 0.4, cz + oz);
        scene.add(roof);
        G.colliders.push({
          minX: cx + ox - w / 2, maxX: cx + ox + w / 2,
          minZ: cz + oz - d / 2, maxZ: cz + oz + d / 2,
        });
      }
    }
  }

  // Landmark signs: Marlin Club, Flamingo Hotel, garage, safehouse.
  const signs = [
    { text: 'MARLIN CLUB', x: -105, z: 75, bg: '#1c2733', fg: '#ffb400' },
    { text: 'FLAMINGO HOTEL', x: 30, z: 105, bg: '#a83a6b', fg: '#ffe9f2' },
    { text: 'GARAGE', x: -120, z: -30, bg: '#333a44', fg: '#7dff9a' },
    { text: 'SAFEHOUSE', x: 135, z: 135, bg: '#274d2f', fg: '#d8ffd8' },
  ];
  for (const s of signs) {
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(26, 6.5),
      new THREE.MeshBasicMaterial({ map: makeSignTexture(s.text, s.bg, s.fg) }),
    );
    sign.position.set(s.x, 12, s.z);
    sign.rotation.y = Math.PI / 4;
    scene.add(sign);
  }

  // Palm trees along the roads and the beach; lamps at intersections.
  const palmSpots = [];
  for (let i = 0; i <= GRID; i += 1) {
    for (let j = 0; j <= GRID; j += 1) {
      if (rng() < 0.5) palmSpots.push([roadCoord(i) + ROAD / 2 + 2.5, roadCoord(j) + ROAD / 2 + 2.5]);
    }
  }
  for (let x = -CITY_HALF; x <= CITY_HALF; x += 18) palmSpots.push([x, CITY_HALF + 8]);
  for (const [x, z] of palmSpots) {
    const palm = makePalm(rng);
    palm.position.set(x, 0, z);
    palm.rotation.y = rng() * Math.PI * 2;
    scene.add(palm);
  }
  const lampMat = new THREE.MeshLambertMaterial({ color: 0x2a2f36 });
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
  for (let i = 0; i <= GRID; i += 1) {
    for (let j = 0; j <= GRID; j += 1) {
      if ((i + j) % 2) continue;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 6, 6), lampMat);
      pole.position.set(roadCoord(i) - ROAD / 2 - 1, 3, roadCoord(j) - ROAD / 2 - 1);
      scene.add(pole);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), bulbMat);
      bulb.position.set(roadCoord(i) - ROAD / 2 - 1, 6.2, roadCoord(j) - ROAD / 2 - 1);
      scene.add(bulb);
    }
  }

  // Clouds: flat white blobs drifting slowly.
  G.clouds = [];
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  for (let i = 0; i < 10; i += 1) {
    const cloud = new THREE.Group();
    for (let k = 0; k < 3; k += 1) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(6 + rng() * 7, 8, 6), cloudMat);
      puff.position.set(k * 8 - 8 + rng() * 4, rng() * 2, rng() * 4);
      puff.scale.y = 0.45;
      cloud.add(puff);
    }
    cloud.position.set((rng() - 0.5) * 480, 90 + rng() * 40, (rng() - 0.5) * 480);
    scene.add(cloud);
    G.clouds.push(cloud);
  }

  // Mission beacon: a glowing pillar the player drives toward.
  const beacon = new THREE.Group();
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2, 2.2, 60, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffb400, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
  );
  pillar.position.y = 30;
  beacon.add(pillar);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(3, 5, 32),
    new THREE.MeshBasicMaterial({ color: 0xffb400, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.3;
  beacon.add(ring);
  beacon.visible = false;
  scene.add(beacon);
  G.beacon = beacon;
}
