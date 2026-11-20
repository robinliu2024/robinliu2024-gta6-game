// vehicles.js — cars: how they look, how they drive, and how traffic behaves.
// Arcade physics on purpose: accelerate, steer, brake, handbrake drift, and
// simple circle-vs-building and car-vs-car collisions. No physics library.
import * as THREE from 'three';
import {
  CAR_MODELS, CITY_HALF, GRID, POLICE_MODEL, clamp, dist2D, mulberry32, pick, roadCoord,
} from './config.js';

const CAR_LENGTH = 4.4;
const CAR_WIDTH = 2.0;

export function makeCarMesh(model, police) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: model.color });
  const body = new THREE.Mesh(new THREE.BoxGeometry(CAR_WIDTH, 0.75, CAR_LENGTH), bodyMat);
  body.position.y = 0.55;
  body.castShadow = true;
  g.add(body);
  const cabinMat = new THREE.MeshLambertMaterial({ color: police ? 0x9fc4e8 : 0x1c2733 });
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(CAR_WIDTH - 0.35, 0.65, CAR_LENGTH * 0.45), cabinMat);
  cabin.position.set(0, 1.2, -0.2);
  cabin.castShadow = true;
  g.add(cabin);
  // Headlights + taillights.
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
  for (const x of [-0.7, 0.7]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.1), lightMat);
    hl.position.set(x, 0.55, CAR_LENGTH / 2 + 0.02);
    g.add(hl);
  }
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
  for (const x of [-0.7, 0.7]) {
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.1), tailMat);
    tl.position.set(x, 0.55, -CAR_LENGTH / 2 - 0.02);
    g.add(tl);
  }
  if (police) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.22, 0.5), new THREE.MeshLambertMaterial({ color: 0x111111 }));
    bar.position.set(0, 1.62, -0.2);
    g.add(bar);
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.4), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    red.position.set(-0.32, 1.76, -0.2);
    g.add(red);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.4), new THREE.MeshBasicMaterial({ color: 0x2050ff }));
    blue.position.set(0.32, 1.76, -0.2);
    g.add(blue);
    g.userData.lightRed = red;
    g.userData.lightBlue = blue;
  }
  // Wheels.
  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 12);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x141414 });
  g.userData.wheels = [];
  for (const [x, z] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.38, z);
    g.add(w);
    g.userData.wheels.push(w);
  }
  return g;
}

export function createCar(G, model, x, z, heading, opts = {}) {
  const mesh = makeCarMesh(model, !!opts.police);
  mesh.position.set(x, 0, z);
  mesh.rotation.y = heading;
  G.scene.add(mesh);
  const car = {
    model, mesh, x, z, heading,
    speed: 0, steer: 0, health: 100,
    police: !!opts.police,
    parked: !!opts.parked,
    traffic: !!opts.traffic,
    mission: opts.mission || null,   // mission id this car belongs to
    driver: opts.driver || null,     // 'player' | 'traffic' | 'police' | null
    route: null, routeTarget: null,  // traffic waypoints
    stuck: 0,
    skidTimer: 0,
  };
  return car;
}

function collideBuildings(G, car) {
  const r = 1.6;
  for (const b of G.colliders) {
    const nx = clamp(car.x, b.minX, b.maxX);
    const nz = clamp(car.z, b.minZ, b.maxZ);
    const dx = car.x - nx;
    const dz = car.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      const d = Math.sqrt(d2) || 0.01;
      car.x = nx + (dx / d) * r;
      car.z = nz + (dz / d) * r;
      if (Math.abs(car.speed) > 6) {
        car.speed *= -0.25;
        if (car.driver === 'player') {
          G.audio.crash();
          damagePlayer(G, 4);
        }
      } else {
        car.speed *= 0.5;
      }
    }
  }
}

export function damagePlayer(G, amount) {
  const p = G.player;
  if (p.dead || G.screen !== 'play') return;
  p.health = Math.max(0, p.health - amount);
  G.hurtFlash = 1;
  if (p.health <= 0) {
    p.dead = true;
    G.endReason = 'wasted';
    G.screen = 'over';
    G.audio.busted();
  }
}

function collideCars(G, car) {
  const all = [...G.cars, ...G.policeCars];
  for (const other of all) {
    if (other === car) continue;
    const d = dist2D(car.x, car.z, other.x, other.z);
    if (d < 3.4 && d > 0.01) {
      const push = (3.4 - d) / 2;
      const nx = (car.x - other.x) / d;
      const nz = (car.z - other.z) / d;
      car.x += nx * push; car.z += nz * push;
      other.x -= nx * push; other.z -= nz * push;
      const rel = Math.abs(car.speed - other.speed);
      if (rel > 8) {
        car.speed *= 0.6; other.speed *= 0.6;
        if (car.driver === 'player' || other.driver === 'player') {
          G.audio.crash();
          damagePlayer(G, 3);
          addWanted(G, 0.15, 'traffic collision');
        }
      }
    }
  }
}

/** Drive one car forward one step from player input (forward -1..1, steer -1..1). */
export function driveCar(G, car, input, dt) {
  const model = car.model;
  const maxSpeed = model.top;
  const accel = model.accel;
  const braking = input.brake;
  if (input.forward > 0) car.speed += accel * dt * input.forward;
  else if (input.forward < 0) car.speed -= accel * 0.8 * dt;
  else car.speed *= Math.pow(0.4, dt); // rolling drag
  if (braking) {
    car.speed *= Math.pow(0.05, dt);
    if (Math.abs(car.speed) > 12 && car.driver === 'player') {
      G.effects.skid(car.x, car.z, car.heading);
      if (car.skidTimer <= 0) { G.audio.skid(); car.skidTimer = 0.4; }
    }
  }
  car.skidTimer = Math.max(0, car.skidTimer - dt);
  car.speed = clamp(car.speed, -maxSpeed * 0.45, maxSpeed);
  // Steering only bites while moving; handbrake lets the tail step out.
  const steerTarget = input.steer * (braking ? 1.5 : 1);
  car.steer = clamp(car.steer + (steerTarget - car.steer) * Math.min(1, dt * 8), -1, 1);
  const turnRate = car.steer * 1.9 * clamp(Math.abs(car.speed) / 12, 0, 1) * (car.speed < 0 ? -1 : 1);
  car.heading += turnRate * dt;
  car.x += Math.sin(car.heading) * car.speed * dt;
  car.z += Math.cos(car.heading) * car.speed * dt;
  // Stay in the world (the beach stops cars, the ocean is out of bounds).
  car.x = clamp(car.x, -CITY_HALF - 10, CITY_HALF + 10);
  car.z = clamp(car.z, -CITY_HALF - 10, CITY_HALF + 22);
  collideBuildings(G, car);
  collideCars(G, car);
  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = car.heading;
  for (const w of car.mesh.userData.wheels) w.rotation.x += car.speed * dt * 2.2;
  return Math.abs(car.speed);
}

/** Traffic: follow the road grid, turn at intersections, stop for the car ahead. */
export function updateTraffic(G, car, dt) {
  if (car.parked) return;
  if (!car.routeTarget) {
    // Pick a neighbouring intersection on the same road.
    const roadXs = [];
    for (let i = 0; i <= GRID; i += 1) roadXs.push(roadCoord(i));
    let nearest = roadXs[0];
    for (const rx of roadXs) if (Math.abs(rx - car.x) < Math.abs(nearest - car.x)) nearest = rx;
    const dir = G.rng() < 0.5 ? 1 : -1;
    car.routeTarget = { x: nearest, z: clamp(car.z + dir * 60, -CITY_HALF, CITY_HALF) };
    car.heading = Math.atan2(car.routeTarget.x - car.x, car.routeTarget.z - car.z);
  }
  const target = car.routeTarget;
  const d = dist2D(car.x, car.z, target.x, target.z);
  if (d < 4) {
    // At the intersection: turn onto a crossing road or keep going.
    const turn = G.rng();
    if (turn < 0.4) {
      const roadZs = [];
      for (let i = 0; i <= GRID; i += 1) roadZs.push(roadCoord(i));
      let nearest = roadZs[0];
      for (const rz of roadZs) if (Math.abs(rz - car.z) < Math.abs(nearest - car.z)) nearest = rz;
      const dir = G.rng() < 0.5 ? 1 : -1;
      car.routeTarget = { x: clamp(car.x + dir * 60, -CITY_HALF, CITY_HALF), z: nearest };
    } else {
      const dir = Math.abs(car.heading) < Math.PI / 2 ? 1 : -1;
      car.routeTarget = { x: car.x, z: clamp(car.z + dir * 60, -CITY_HALF, CITY_HALF) };
    }
    car.heading = Math.atan2(car.routeTarget.x - car.x, car.routeTarget.z - car.z);
    return;
  }
  // Slow down if another car is right ahead.
  let blocked = false;
  for (const other of [...G.cars, ...G.policeCars]) {
    if (other === car) continue;
    const dx = other.x - car.x;
    const dz = other.z - car.z;
    const ahead = dx * Math.sin(car.heading) + dz * Math.cos(car.heading);
    const side = Math.abs(dx * Math.cos(car.heading) - dz * Math.sin(car.heading));
    if (ahead > 0 && ahead < 9 && side < 2.5) { blocked = true; break; }
  }
  const want = blocked ? 0 : car.model.top * 0.45;
  car.speed += clamp(want - car.speed, -14 * dt, 8 * dt);
  car.heading += clamp(Math.atan2(target.x - car.x, target.z - car.z) - car.heading, -1.6 * dt, 1.6 * dt);
  car.x += Math.sin(car.heading) * car.speed * dt;
  car.z += Math.cos(car.heading) * car.speed * dt;
  collideBuildings(G, car);
  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = car.heading;
  for (const w of car.mesh.userData.wheels) w.rotation.x += car.speed * dt * 2.2;
}

export function spawnTraffic(G, count) {
  const rng = mulberry32(G.seed * 331 + 7);
  for (let i = 0; i < count; i += 1) {
    const model = pick(rng, CAR_MODELS);
    const road = roadCoord(Math.floor(rng() * (GRID + 1)));
    const along = (rng() - 0.5) * 2 * CITY_HALF;
    const horizontal = rng() < 0.5;
    const x = horizontal ? along : road;
    const z = horizontal ? road : along;
    const heading = horizontal ? (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : (rng() < 0.5 ? 0 : Math.PI);
    const car = createCar(G, model, x, z, heading, { traffic: true });
    car.speed = 6 + rng() * 6;
    G.cars.push(car);
  }
}

export function spawnParkedCars(G) {
  const rng = mulberry32(G.seed * 101 + 3);
  const spots = [];
  for (let i = 0; i < 14; i += 1) {
    const road = roadCoord(Math.floor(rng() * (GRID + 1)));
    const along = (rng() - 0.5) * 2 * (CITY_HALF - 20);
    const horizontal = rng() < 0.5;
    spots.push(horizontal ? [along, road + 5.2] : [road + 5.2, along]);
  }
  for (const [x, z] of spots) {
    const model = pick(rng, CAR_MODELS);
    const heading = (Math.abs(x) > Math.abs(z) ? Math.PI / 2 : 0) + (rng() < 0.5 ? 0 : Math.PI);
    const car = createCar(G, model, x, z, heading, { parked: true });
    G.cars.push(car);
  }
  // Mission 1's Sunrunner, parked on Marlin Ave by the harbor for the player.
  const starter = createCar(G, CAR_MODELS[0], 30, 110, Math.PI, { parked: true, mission: 'm1-first-fare' });
  G.cars.push(starter);
  G.missionStarterCar = starter;
}

/** Spawn a police interceptor on the nearest road, chasing the player. */
export function spawnPoliceCar(G) {
  const p = G.player;
  const road = roadCoord(Math.floor(G.rng() * (GRID + 1)));
  const x = clamp(p.x + (G.rng() < 0.5 ? -1 : 1) * (50 + G.rng() * 30), -CITY_HALF, CITY_HALF);
  const z = clamp(p.z + (G.rng() < 0.5 ? -1 : 1) * (50 + G.rng() * 30), -CITY_HALF, CITY_HALF);
  const car = createCar(G, POLICE_MODEL, x, z, 0, { police: true, driver: 'police' });
  G.policeCars.push(car);
  return car;
}

export function addWanted(G, stars, why) {
  // Small crimes bank toward the next star; a whole star arrives at once and
  // starts with a full decay clock, so it never vanishes the moment it lands.
  const p = G.player;
  const before = p.wanted;
  p.crimeHeat += stars;
  const gain = Math.floor(p.crimeHeat);
  if (gain > 0) {
    p.crimeHeat -= gain;
    p.wanted = clamp(p.wanted + gain, 0, 5);
    p.wantedHeat = 1;
  }
  if (p.wanted > before) {
    G.toast = `Wanted level ${p.wanted}★ — ${why || 'the SBPD is on you'}`;
    G.toastTimer = 3;
  }
}

export function removeCar(G, car) {
  G.scene.remove(car.mesh);
  const list = car.police ? G.policeCars : G.cars;
  const i = list.indexOf(car);
  if (i >= 0) list.splice(i, 1);
}
