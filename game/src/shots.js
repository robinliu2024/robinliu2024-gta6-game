// shots.js — deterministic screenshot scenes behind ?shot=start|drive|chase|mission.
// Each scene stages the real game (same world, same rules, fixed seed), then an
// autopilot plays it forward for a few seconds so the frame is what a real
// player would see: the city, the HUD, the minimap, the mission objective.
// When the scene has settled, window.__shotReady is set for the screenshot tool.
import { GRID, MISSIONS, dist2D, roadCoord } from './config.js';
import { spawnPoliceCar } from './vehicles.js';

const SETTLE_SECONDS = 4;

function nearestRoadCoord(v) {
  let best = roadCoord(0);
  for (let i = 1; i <= GRID; i += 1) {
    const r = roadCoord(i);
    if (Math.abs(r - v) < Math.abs(best - v)) best = r;
  }
  return best;
}

/**
 * Road-following route: from the car's current road, drive to the intersection
 * nearest the target, then along that road to the target's intersection.
 * Returns the waypoint the car should steer at now.
 */
function roadWaypoint(car, tx, tz) {
  const onVertical = Math.abs(car.x - nearestRoadCoord(car.x)) < Math.abs(car.z - nearestRoadCoord(car.z));
  if (onVertical) {
    const vx = nearestRoadCoord(car.x);
    const tzRoad = nearestRoadCoord(tz);
    if (Math.abs(car.z - tzRoad) > 6) return { x: vx, z: tzRoad };
    return { x: nearestRoadCoord(tx), z: tzRoad };
  }
  const hz = nearestRoadCoord(car.z);
  const txRoad = nearestRoadCoord(tx);
  if (Math.abs(car.x - txRoad) > 6) return { x: txRoad, z: hz };
  return { x: txRoad, z: nearestRoadCoord(tz) };
}

/** Steer a car toward a point: W always on, A/D by the heading error. */
function steerToward(G, car, tx, tz) {
  const input = G.input;
  const wantHeading = Math.atan2(tx - car.x, tz - car.z);
  let dh = wantHeading - car.heading;
  while (dh > Math.PI) dh -= Math.PI * 2;
  while (dh < -Math.PI) dh += Math.PI * 2;
  // Heading grows when the car turns toward +x; from the driver's seat that
  // is a left turn, so a positive error means steer left (A), not right.
  input.inject('KeyW', true);
  input.inject('KeyA', dh > 0.1);
  input.inject('KeyD', dh < -0.1);
}

export function stageShot(G, name) {
  const shot = { name, elapsed: 0, ready: false, settle: name === 'chase' ? 3 : SETTLE_SECONDS };
  G.shotMode = name;
  if (name === 'start') {
    // Title screen over a slow orbit of the city; the world idles behind it.
    G.screen = 'title';
    G.cameraRig.yaw = 0.6;
    G.cameraRig.pitch = 0.5;
    G.cameraRig.distance = 120;
    return shot;
  }
  // Every other scene plays for real, HUD on.
  G.screen = 'play';
  if (name === 'drive') {
    // Rico in the yellow Sunrunner, cruising up Marlin Ave with traffic.
    G.missions.startMission(0);
    const car = G.missionStarterCar;
    G.player.x = car.x; G.player.z = car.z;
    G.playerMesh.visible = false;
    car.driver = 'player';
    car.parked = false;
    G.player.inCar = car;
    car.speed = 18;
    G.hud.showCarHint(true);
    G.hud.setObjective('Cruise Solmar Bay — free roam');
  } else if (name === 'chase') {
    // Three-star wanted level, two interceptors on Rico's tail, sirens wailing.
    G.missions.startMission(0);
    const car = G.missionStarterCar;
    car.driver = 'player';
    car.parked = false;
    G.player.inCar = car;
    car.heading = Math.PI;
    car.speed = 26;
    car.x = 30; car.z = 60;
    G.player.x = car.x; G.player.z = car.z;
    G.playerMesh.visible = false;
    G.player.wanted = 3;
    G.player.wantedHeat = 1;
    G.hud.showCarHint(true);
    spawnPoliceCar(G);
    spawnPoliceCar(G);
    // Stage the interceptors right on Rico's tail so the chase reads in frame.
    G.policeCars.forEach((cop, i) => {
      const back = 14 + i * 12;
      cop.x = car.x - Math.sin(car.heading) * back;
      cop.z = car.z - Math.cos(car.heading) * back;
      cop.heading = car.heading;
      cop.speed = 24;
    });
    G.toast = '';
    G.toastTimer = 0;
    G.hud.setObjective('Lose the SBPD — wanted 3★');
  } else if (name === 'mission') {
    // On foot on the Boardwalk, mission 3 active, the gold beacon ahead.
    G.missions.startMission(2);
    G.player.x = -90; G.player.z = 150;
    G.player.heading = Math.PI / 2;
    G.playerMesh.position.set(G.player.x, 0, G.player.z);
    G.hud.setObjective('Grab the package on the Boardwalk');
  }
  return shot;
}

/** Autopilot: steer the player's car along the roads toward a point, or walk toward the beacon. */
export function shotAutopilot(G, dt) {
  const p = G.player;
  const input = G.input;
  if (G.shotMode === 'drive' || G.shotMode === 'chase') {
    const car = p.inCar;
    if (!car) return;
    // Drive the road grid toward a point across town, never through blocks.
    const tx = G.shotMode === 'chase' ? 90 : 90;
    const tz = G.shotMode === 'chase' ? -60 : -90;
    const wp = roadWaypoint(car, tx, tz);
    steerToward(G, car, wp.x, wp.z);
  } else if (G.shotMode === 'mission') {
    // Walk toward the beacon: point the camera so "forward" is the beacon.
    const t = G.missionTarget;
    if (!t) return;
    const dx = t.x - p.x;
    const dz = t.z - p.z;
    G.cameraRig.yaw = Math.atan2(-dx, -dz);
    input.inject('KeyW', true);
  }
}

/** Advance the shot clock; returns true once the scene is ready to capture. */
export function updateShot(G, shot, dt) {
  shot.elapsed += dt;
  const settle = shot.settle || SETTLE_SECONDS;
  if (G.shotMode === 'start') {
    // Slow cinematic orbit while the title screen is up.
    G.cameraRig.yaw += dt * 0.05;
    G.cameraRig.distance = 120;
    G.cameraRig.pitch = 0.42;
    if (shot.elapsed > 2) shot.ready = true;
  } else if (shot.elapsed > settle) {
    shot.ready = true;
  }
  if (shot.ready && !window.__shotReady) window.__shotReady = true;
  return shot.ready;
}

export function shotNames() {
  return MISSIONS.map((m) => m.name);
}
