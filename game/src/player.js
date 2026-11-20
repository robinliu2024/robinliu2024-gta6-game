// player.js — Rico Vega on foot and behind the wheel: movement, the third-person
// camera, stealing and driving cars, shooting and punching. The camera is a
// chase camera: mouse orbits it, and it pulls in close when a wall is behind.
import * as THREE from 'three';
import { CITY_HALF, clamp, dist2D, angleLerp } from './config.js';
import { ACTION_ENTER, ACTION_PUNCH, ACTION_SHOOT } from './input.js';
import { addWanted, driveCar } from './vehicles.js';
import { knockDownPed, scarePeds } from './pedestrians.js';

const WALK_SPEED = 6;
const RUN_SPEED = 10.5;

export function makePlayerMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.36, 1.05, 10),
    new THREE.MeshLambertMaterial({ color: 0x2f6fd6 }),
  );
  body.position.y = 0.98;
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.27, 12, 10),
    new THREE.MeshLambertMaterial({ color: 0xc98e6b }),
  );
  head.position.y = 1.72;
  head.castShadow = true;
  g.add(head);
  // A white tee stripe and a cap, so Rico reads at a glance.
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.16, 0.1), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  stripe.position.set(0, 1.15, 0.32);
  g.add(stripe);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.29, 0.1, 12), new THREE.MeshLambertMaterial({ color: 0xe8b400 }));
  cap.position.y = 1.94;
  g.add(cap);
  const legMat = new THREE.MeshLambertMaterial({ color: 0x2a2f36 });
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.52, 0.17), legMat);
  legL.position.set(-0.14, 0.26, 0);
  g.add(legL);
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.52, 0.17), legMat);
  legR.position.set(0.14, 0.26, 0);
  g.add(legR);
  const armMat = new THREE.MeshLambertMaterial({ color: 0x2f6fd6 });
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.62, 0.15), armMat);
  armR.position.set(0.42, 1.05, 0.28);
  armR.rotation.x = -1.2; // pistol arm, held forward
  g.add(armR);
  g.userData.legL = legL;
  g.userData.legR = legR;
  return g;
}

/** The camera rig: yaw/pitch orbit, distance pulls in near walls. */
export function createCameraRig(camera) {
  return {
    camera,
    yaw: Math.PI, pitch: 0.32, distance: 9,
    update(G, dt) {
      const p = G.player;
      const target = p.inCar ? p.inCar : null;
      const tx = target ? target.x : p.x;
      const tz = target ? target.z : p.z;
      const ty = target ? 1.6 : 1.7;
      // Mouse-look: drag or pointer-lock deltas orbit the camera.
      const mouse = G.input.takeMouse();
      this.yaw -= mouse.dx * 0.004;
      this.pitch = clamp(this.pitch + mouse.dy * 0.003, -0.15, 0.9);
      const wantDist = target ? 12 : 8;
      this.distance += (wantDist - this.distance) * Math.min(1, dt * 4);
      // In a car the camera trails the car's heading; on foot it orbits freely.
      if (target) this.yaw = angleLerp(this.yaw, target.heading + Math.PI, Math.min(1, dt * 2.2));
      const cx = tx + Math.sin(this.yaw) * Math.cos(this.pitch) * this.distance;
      const cz = tz + Math.cos(this.yaw) * Math.cos(this.pitch) * this.distance;
      const cy = ty + Math.sin(this.pitch) * this.distance;
      camera.position.set(cx, cy, cz);
      camera.lookAt(tx, ty, tz);
      return { yaw: this.yaw };
    },
  };
}

function collidePlayerBuildings(G, p) {
  const r = 0.55;
  for (const b of G.colliders) {
    const nx = clamp(p.x, b.minX, b.maxX);
    const nz = clamp(p.z, b.minZ, b.maxZ);
    const dx = p.x - nx;
    const dz = p.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      const d = Math.sqrt(d2) || 0.01;
      p.x = nx + (dx / d) * r;
      p.z = nz + (dz / d) * r;
    }
  }
}

function nearestCar(G, maxDist) {
  let best = null;
  let bestD = maxDist;
  for (const car of G.cars) {
    const d = dist2D(G.player.x, G.player.z, car.x, car.z);
    if (d < bestD) { bestD = d; best = car; }
  }
  return best;
}

function enterCar(G, car) {
  const p = G.player;
  car.driver = 'player';
  car.parked = false;
  car.traffic = false;
  p.inCar = car;
  p.speed = 0;
  G.playerMesh.visible = false;
  G.audio.ui();
  if (car.mission) {
    G.missions.onEnterMissionCar(car);
  } else if (!car.stolenBefore) {
    // Taking a car that is not yours is grand theft auto, and the SBPD notices.
    car.stolenBefore = true;
    G.stats.carsStolen += 1;
    addWanted(G, 1, 'grand theft auto');
    G.toast = `Stole a ${car.model.name}!`;
    G.toastTimer = 2.5;
  }
  G.hud.showCarHint(true);
}

export function exitCar(G) {
  const p = G.player;
  const car = p.inCar;
  if (!car) return;
  car.driver = null;
  car.speed *= 0.3;
  p.inCar = null;
  // Step out to the driver's side.
  p.x = car.x + Math.cos(car.heading) * 2.2;
  p.z = car.z - Math.sin(car.heading) * 2.2;
  p.heading = car.heading;
  G.playerMesh.visible = true;
  G.audio.ui();
  G.hud.showCarHint(false);
}

function shoot(G) {
  const p = G.player;
  if (p.shootCooldown > 0 || p.inCar) return;
  p.shootCooldown = 0.28;
  G.stats.shotsFired += 1;
  G.audio.shoot();
  const cam = G.camera;
  const dir = new THREE.Vector3();
  cam.getWorldDirection(dir);
  // Aim from the camera through the crosshair: ray vs peds, rivals, cars, police.
  const origin = cam.position.clone();
  let bestD = 120;
  let hitPed = null;
  let hitCar = null;
  for (const ped of [...G.peds, ...G.rivals]) {
    if (ped.down) continue;
    const to = new THREE.Vector3(ped.x - origin.x, 1.2 - origin.y, ped.z - origin.z);
    const along = to.dot(dir);
    if (along < 0 || along > bestD) continue;
    const perp = to.clone().addScaledVector(dir, -along).length();
    if (perp < 1.1) { bestD = along; hitPed = ped; hitCar = null; }
  }
  for (const car of [...G.cars, ...G.policeCars]) {
    const to = new THREE.Vector3(car.x - origin.x, 1 - origin.y, car.z - origin.z);
    const along = to.dot(dir);
    if (along < 0 || along > bestD) continue;
    const perp = to.clone().addScaledVector(dir, -along).length();
    if (perp < 2.2) { bestD = along; hitCar = car; hitPed = null; }
  }
  const end = origin.clone().addScaledVector(dir, bestD);
  G.effects.tracer(origin, end);
  G.effects.muzzle(p.x, 1.4, p.z);
  if (hitPed) {
    G.effects.blood(hitPed.x, hitPed.z);
    knockDownPed(G, hitPed);
    if (hitPed.hostile) G.audio.coin();
    else addWanted(G, 1, 'shooting in public');
    scarePeds(G, p.x, p.z, 50);
  } else if (hitCar) {
    hitCar.health -= 34;
    G.effects.sparks(hitCar.x, hitCar.z);
    if (hitCar.police) addWanted(G, 1, 'shooting at the SBPD');
    if (hitCar.health <= 0) {
      G.effects.explosion(hitCar.x, hitCar.z);
      G.audio.crash();
      if (hitCar.police) addWanted(G, 1, 'destroyed a police car');
      const { removeCar } = G.vehicleApi;
      removeCar(G, hitCar);
    }
  }
}

function punch(G) {
  const p = G.player;
  if (p.punchCooldown > 0 || p.inCar) return;
  p.punchCooldown = 0.5;
  G.audio.punch();
  for (const ped of [...G.peds, ...G.rivals]) {
    if (ped.down) continue;
    if (dist2D(p.x, p.z, ped.x, ped.z) < 2.2) {
      knockDownPed(G, ped);
      return;
    }
  }
  // A swing at a car door dents it and draws attention.
  const car = nearestCar(G, 2.6);
  if (car) {
    car.health -= 8;
    G.effects.sparks(car.x, car.z);
    if (car.health <= 0) {
      G.effects.explosion(car.x, car.z);
      G.vehicleApi.removeCar(G, car);
    }
  }
}

/** One fixed step of the player: on foot, or driving. Returns nothing; writes G. */
export function updatePlayer(G, dt) {
  const p = G.player;
  const input = G.input;
  const move = input.move();
  p.shootCooldown = Math.max(0, p.shootCooldown - dt);
  p.punchCooldown = Math.max(0, p.punchCooldown - dt);

  if (p.inCar) {
    const car = p.inCar;
    // Driving is relative to the camera: W is "away from camera".
    const speed = driveCar(G, car, { forward: move.forward, steer: -move.strafe, brake: move.brake }, dt);
    p.speed = speed * 2.24; // mph-ish for the HUD
    p.x = car.x; p.z = car.z; p.heading = car.heading;
    G.audio.setEngine(Math.abs(car.speed) / car.model.top, true);
    // Running over a pedestrian at speed is a crime.
    for (const ped of [...G.peds, ...G.rivals]) {
      if (ped.down) continue;
      if (dist2D(car.x, car.z, ped.x, ped.z) < 2.0 && Math.abs(car.speed) > 4) {
        knockDownPed(G, ped);
      }
    }
    return;
  }

  G.audio.setEngine(0, false);
  // On foot: move relative to the camera yaw.
  const yaw = G.cameraRig.yaw;
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  // Camera looks from behind toward -sin/-cos, so "forward" is (-sin, -cos).
  let mx = -sin * move.forward + cos * move.strafe;
  let mz = -cos * move.forward - sin * move.strafe;
  const len = Math.hypot(mx, mz);
  if (len > 0) { mx /= len; mz /= len; }
  const speed = move.sprint ? RUN_SPEED : WALK_SPEED;
  p.x += mx * speed * dt;
  p.z += mz * speed * dt;
  p.speed = len * speed;
  if (len > 0) {
    const wantHeading = Math.atan2(mx, mz);
    p.heading = angleLerp(p.heading, wantHeading, Math.min(1, dt * 12));
  }
  p.x = clamp(p.x, -CITY_HALF - 8, CITY_HALF + 8);
  p.z = clamp(p.z, -CITY_HALF - 8, CITY_HALF + 24);
  collidePlayerBuildings(G, p);

  // Walk animation + mesh pose.
  const mesh = G.playerMesh;
  mesh.position.set(p.x, 0, p.z);
  mesh.rotation.y = p.heading;
  const phase = G.time * (move.sprint ? 13 : 9);
  const swing = len > 0 ? Math.sin(phase) * 0.55 : 0;
  mesh.userData.legL.rotation.x = swing;
  mesh.userData.legR.rotation.x = -swing;

  // Interact prompt for the nearest car.
  const car = nearestCar(G, 3.4);
  G.nearCar = car;
  G.hud.showInteract(!!car, car ? car.model.name : '');
}

export function handlePlayerActions(G, actions) {
  const p = G.player;
  if (actions & ACTION_ENTER) { // E: get in or out of a car
    if (p.inCar) exitCar(G);
    else if (G.nearCar) enterCar(G, G.nearCar);
  }
  if (actions & ACTION_PUNCH) punch(G); // Q: punch
  if (actions & ACTION_SHOOT) shoot(G); // click: shoot
  if (G.input.mouseDown() && !p.inCar && p.shootCooldown <= 0 && G.screen === 'play') {
    shoot(G);
  }
}
