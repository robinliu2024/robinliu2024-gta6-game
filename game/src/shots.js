// Solmar Heat — deterministic shot-mode setups, read by main.js.
// ?shot=start  title screen over the city
// ?shot=drive  player driving at speed on a Downtown road
// ?shot=chase  wanted 3, SBPD interceptors on the player's bumper
// ?shot=mission  on foot near the mission beacon, objective visible
// ?shot=heli  wanted 4 helicopter chase (cover shot): low tracking camera
// ?shot=combat  on foot Downtown, rifle out, interceptors closing in
// ?shot=crew  v3 crew in action: Vic + Lena recruited, gunner firing on cops
// ?shot=territory  v3 turf: Downtown captured, gold ring + HUD turf panel
// ?shot=shop  v3 shop: Rico at the Downtown Arms kiosk, shop panel open
// &seed= seeds the RNG, &lq=1 lowers quality. Each setup places the game in
// a readable, good-looking state with no user input required.

import { DISTRICTS } from './config.js';
import { state, setWanted } from './state.js';

export const SHOT_NAMES = ['start', 'drive', 'chase', 'mission', 'heli', 'combat', 'race', 'garage', 'crew', 'territory', 'shop'];

function putPlayerInCar(ctx, x, z, heading, speed) {
  const { player, vehicles } = ctx;
  const car = vehicles.starterCar
    || vehicles.vehicles.find((v) => v.isPlayerCar)
    || vehicles.nearestTo(player.position, 500);
  if (!car) return null;
  car.position.set(x, 0, z);
  car.heading = heading;
  car.mesh.rotation.y = heading;
  car.speed = speed;
  car.parked = false;
  if (player.onFoot) car.enter(player);
  player.position.copy(car.position);
  player.heading = heading;
  return car;
}

function putPlayerOnFoot(ctx, x, z, heading) {
  const { player } = ctx;
  if (player.vehicle) player.vehicle.exit(player);
  player.position.set(x, 0, z);
  player.heading = heading;
  player.mesh.rotation.y = heading;
  player.mesh.visible = true;
  player.onFoot = true;
  return player;
}

// Let the police chase run a few simulated seconds so the interceptors
// close from their spawn distance onto the player's bumper.
function warmUpChase(ctx, seconds) {
  const { police, player } = ctx;
  if (!police) return;
  const steps = Math.max(1, Math.round(seconds / 0.25));
  for (let i = 0; i < steps; i++) police.update(0.25, player, i * 0.25);
}

export function applyShotSetup(name, ctx) {
  const { player, vehicles, police, missions, camera } = ctx;
  const setup = { name, started: false, autoDrive: false, camYaw: Math.PI, camPitch: 0.32 };
  if (!SHOT_NAMES.includes(name)) return setup;

  if (name === 'start') {
    // Title screen over the city: leave the game unstarted, frame Downtown
    // and the harbor from a high wide angle.
    state.started = false;
    if (camera) {
      camera.position.set(150, 85, 290);
      camera.lookAt(0, 8, 0);
    }
    return setup;
  }

  // Every other shot plays the game: hide the start screen, show the HUD.
  state.started = true;
  setup.started = true;
  if (typeof document !== 'undefined') {
    document.getElementById('hud')?.classList.remove('hidden-until-start');
  }
  if (ctx.hideStartScreen) ctx.hideStartScreen();

  if (name === 'drive') {
    // Downtown road x=64, heading north (-z), already rolling at ~45 mph.
    putPlayerInCar(ctx, 64, 110, Math.PI, 20);
    setup.autoDrive = true;
    setup.camYaw = 0;
    setup.camPitch = 0.3;
    if (missions) missions.startMission('m1');
    return setup;
  }

  if (name === 'chase') {
    // Same road, faster, wanted 3 — interceptors close in during warm-up.
    putPlayerInCar(ctx, 64, 110, Math.PI, 24);
    setWanted(3);
    setup.autoDrive = true;
    setup.camYaw = 0;
    setup.camPitch = 0.3;
    if (missions) missions.startMission('m3');
    // Keep the m3 beacon out of the chase frame: the shot is about the tail.
    if (missions) missions.beacon.visible = false;
    warmUpChase(ctx, 3);
    // Re-assert the wanted level and speed after the warm-up (ramming slows).
    setWanted(3);
    if (player.vehicle) player.vehicle.speed = 24;
    return setup;
  }

  if (name === 'heli') {
    // Four-star helicopter chase (cover shot): the heli spawns at wanted 4
    // and the roadblock at wanted 3, so warm up until both close in.
    putPlayerInCar(ctx, 64, 110, Math.PI, 24);
    setWanted(4);
    setup.autoDrive = true;
    setup.camYaw = 0;
    setup.camPitch = 0.3;
    if (missions) missions.startMission('m8');
    // Keep the m8 beacon out of the frame: this shot is about the tail.
    if (missions) missions.beacon.visible = false;
    warmUpChase(ctx, 6);
    // Re-assert the wanted level and speed after the warm-up (ramming slows).
    setWanted(4);
    if (player.vehicle) player.vehicle.speed = 24;
    // The heli hovers at 58 m: a follow camera can never frame both it and
    // the car, so this shot owns the camera — a low angle with a wider FOV
    // that tracks the midpoint between car and heli every frame.
    if (camera) {
      camera.fov = 85;
      camera.updateProjectionMatrix();
    }
    setup.cameraFn = (cam) => {
      const p = player.vehicle ? player.vehicle.position : player.position;
      const h = police.heli ? police.heli.position : { x: p.x + 12, y: 58, z: p.z + 8 };
      cam.position.set(p.x + 9, 4, p.z + 34);
      cam.lookAt((p.x + h.x) / 2 - 2, 18, (p.z + h.z) / 2);
    };
    return setup;
  }

  if (name === 'combat') {
    // On foot at the x=64 / z=64 intersection, rifle out, two stars:
    // interceptors close in along open roads while the weapon bar, stars
    // and M7 objective all read in the HUD.
    putPlayerOnFoot(ctx, 64, 64, Math.PI);
    if (player.combat && player.combat.ownWeapon) player.combat.ownWeapon('rifle');
    if (player.selectWeapon) player.selectWeapon('rifle');
    setWanted(2);
    if (missions) missions.startMission('m7');
    warmUpChase(ctx, 4);
    // Face the nearest cop so the threat reads in the frame, camera behind.
    const cops = police ? police.cops.filter((c) => !c.down) : [];
    let best = null;
    let bestD = Infinity;
    for (const cop of cops) {
      const d = Math.hypot(cop.position.x - player.position.x, cop.position.z - player.position.z);
      if (d < bestD) { bestD = d; best = cop; }
    }
    if (best) {
      const dx = best.position.x - player.position.x;
      const dz = best.position.z - player.position.z;
      player.heading = Math.atan2(dx, dz);
      player.mesh.rotation.y = player.heading;
      setup.camYaw = Math.atan2(-dx, -dz);
    } else {
      setup.camYaw = 0;
    }
    setup.camPitch = 0.3;
    return setup;
  }

  if (name === 'race') {
    // M6 street race: rolling north on the x=64 Downtown road toward the
    // checkpoint beacon, race clock running, HUD shows M6 + checkpoint 1/4.
    putPlayerInCar(ctx, 64, 150, Math.PI, 20);
    setup.autoDrive = true;
    setup.camYaw = 0;
    setup.camPitch = 0.3;
    if (missions) missions.startMission('m6');
    return setup;
  }

  if (name === 'crew') {
    // v3 crew in action: Vic (driver) + Lena (gunner) recruited, rifle out,
    // two stars, M7 running so Lena opens fire on the closing interceptors.
    // Recruit after placing Rico so the members spawn beside him, then warm
    // the chase up and freeze the fight at a readable range: parked cars,
    // the nearest foot cop held ~14 m out so it shoots instead of busting.
    putPlayerOnFoot(ctx, 64, 64, Math.PI);
    state.rep = 200;
    if (ctx.crew) {
      ctx.crew.tryRecruit('vic');
      ctx.crew.tryRecruit('lena');
    }
    if (player.combat && player.combat.ownWeapon) player.combat.ownWeapon('rifle');
    if (player.selectWeapon) player.selectWeapon('rifle');
    setWanted(2);
    if (missions) missions.startMission('m7');
    warmUpChase(ctx, 4);
    // Freeze the fight at a readable range — and stage the threat in frame:
    // the nearest interceptor is parked ~20 m ahead of Rico (Lena's gunner
    // fire needs a cop in range), the nearest foot cop held ~14 m out so
    // it shoots instead of busting. Without this the warmed-up cops end up
    // behind buildings and the shot reads as three people on an empty road.
    if (police) {
      for (const c of police.cops) c.parked = true;
      for (const fc of police.footCops) fc.speed = 0;
      const cars = police.cops.filter((c) => !c.down);
      let best = null;
      let bestD = Infinity;
      for (const cop of cars) {
        const d = Math.hypot(cop.position.x - player.position.x, cop.position.z - player.position.z);
        if (d < bestD) { bestD = d; best = cop; }
      }
      if (best) {
        const dx = best.position.x - player.position.x;
        const dz = best.position.z - player.position.z;
        const len = Math.hypot(dx, dz) || 1;
        const nx = dx / len;
        const nz = dz / len;
        best.position.set(player.position.x + nx * 20, 0, player.position.z + nz * 20);
        if (best.mesh) best.mesh.position.copy(best.position);
        const foot = police.footCops[0];
        if (foot) {
          foot.position.set(player.position.x + nx * 14, 0, player.position.z + nz * 14);
          if (foot.mesh) foot.mesh.position.copy(foot.position);
        }
        player.heading = Math.atan2(nx, nz);
        player.mesh.rotation.y = player.heading;
        setup.camYaw = Math.atan2(-nx, -nz);
      } else {
        setup.camYaw = 0;
      }
    } else {
      setup.camYaw = 0;
    }
    setup.camPitch = 0.3;
    return setup;
  }

  if (name === 'territory') {
    // v3 turf: Downtown captured — the gold ring on the ground, the HUD
    // turf panel showing OWNED +$400/day, M10 in the objective bar. The
    // Downtown ring (centre 40,20 r=150) crosses the x=64 road at z=168,
    // so Rico's car sits right on the gold line, camera high behind.
    if (ctx.territory) ctx.territory.capture('downtown');
    putPlayerInCar(ctx, 64, 168, Math.PI, 0);
    if (missions) missions.startMission('m10');
    setup.cameraFn = (cam) => {
      const p = player.vehicle ? player.vehicle.position : player.position;
      cam.position.set(p.x - 2, 12, p.z + 26);
      cam.lookAt(p.x + 2, 1, p.z - 40);
    };
    return setup;
  }

  if (name === 'shop') {
    // v3 shop: Rico on foot at the Downtown Arms kiosk (64,32), the Solmar
    // Arms panel open. The world freezes while the shop is open, so the
    // camera is posed here and stays put (like the garage shot); the kiosk
    // sits right of the centred panel so it stays visible beside it.
    putPlayerOnFoot(ctx, 64, 40, Math.PI);
    if (missions) missions.startMission('m1');
    if (camera) {
      camera.position.set(46, 6, 60);
      camera.lookAt(86, 1.5, 22);
    }
    if (ctx.openShop) ctx.openShop();
    return setup;
  }

  if (name === 'garage') {
    // Garage menu over the live game: car parked on a Downtown road, M1
    // running, HUD visible around the centered panel. The world is frozen
    // while the garage is open, so the camera is posed here and stays put.
    putPlayerInCar(ctx, 64, 110, Math.PI, 0);
    if (missions) missions.startMission('m1');
    if (camera) {
      camera.position.set(24, 22, 178);
      camera.lookAt(30, 2, 100);
    }
    if (ctx.openGarage) ctx.openGarage();
    return setup;
  }

  // mission: on foot a short walk from the Harbor beacon, facing it, so
  // the yellow beacon cylinder and ring read clearly in the frame.
  const harbor = DISTRICTS.harbor;
  putPlayerOnFoot(ctx, harbor.x + 20, harbor.z - 14, Math.atan2(-20, 14));
  if (missions) missions.startMission('m1');
  setup.camYaw = 2.2;
  setup.camPitch = 0.3;
  return setup;
}

export function shotSetupForQuery(query) {
  const params = new URLSearchParams(query || '');
  return params.get('shot') || null;
}

export default applyShotSetup;
