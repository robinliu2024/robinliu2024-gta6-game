// missions.js — the story thread: five jobs for Marla Voss and Danny Cole that
// pay Rico's $40,000 debt down. Each mission is a list of steps; a step is a
// place to reach, a car to steal, a wanted level to lose, or rivals to beat.
// Completing a mission pays cash and rep, saves the game, and starts the next.
import { CAR_MODELS, MISSIONS, dist2D } from './config.js';
import { addWanted, createCar } from './vehicles.js';
import { createPed } from './pedestrians.js';

function currentMission(G) {
  return MISSIONS[G.missionIndex] || null;
}
function currentStep(G) {
  const m = currentMission(G);
  return m ? m.steps[G.missionStep] : null;
}

export function createMissions(G) {
  function setTarget(x, z, radius) {
    G.missionTarget = { x, z, radius };
    G.beacon.visible = true;
    G.beacon.position.set(x, 0, z);
  }
  function clearTarget() {
    G.missionTarget = null;
    G.beacon.visible = false;
  }

  function showStep() {
    const step = currentStep(G);
    if (!step) return;
    G.hud.setObjective(step.text);
    if (step.type === 'goto') setTarget(step.x, step.z, step.radius);
    else if (step.type === 'stealCar' || step.type === 'combat') clearTarget();
    else if (step.type === 'loseWanted') {
      // The chase starts now: the step's stars arrive the moment it begins,
      // so the player cannot finish it by standing still at zero stars.
      clearTarget();
      addWanted(G, step.stars, 'the SBPD is on you');
    } else if (step.type === 'enterCar') clearTarget();
  }

  function startMission(index) {
    G.missionIndex = index;
    G.missionStep = 0;
    G.missionActive = true;
    G.rivalsSpawned = false;
    G.combatLeft = 0;
    const m = currentMission(G);
    if (!m) { G.missionActive = false; return; }
    G.hud.setMissionName(`${m.name} — ${m.giver}`);
    G.toast = m.intro;
    G.toastTimer = 6;
    G.audio.missionStart();
    // Stage the mission's special car, if it needs one.
    if (m.id === 'm2-hot-wheels') {
      const car = createCar(G, CAR_MODELS[1], 30, 105, Math.PI / 2, { parked: true, mission: 'm2-hot-wheels' });
      G.cars.push(car);
      G.missionCar = car;
    } else if (m.id === 'm5-debt-free') {
      // The courier van waits on Sunset Blvd; hijacking it is the job.
      const car = createCar(G, CAR_MODELS[4], 90, 30, 0, { parked: true, mission: 'm5-debt-free' });
      G.cars.push(car);
      G.missionCar = car;
    } else if (m.id === 'm4-payback') {
      const car = createCar(G, CAR_MODELS[1], -90, -120, Math.PI, { parked: true, mission: 'm4-payback' });
      G.cars.push(car);
      G.missionCar = car;
    }
    showStep();
  }

  function completeStep() {
    G.missionStep += 1;
    const m = currentMission(G);
    if (G.missionStep >= m.steps.length) {
      completeMission();
      return;
    }
    G.audio.ui();
    showStep();
  }

  function completeMission() {
    const m = currentMission(G);
    const p = G.player;
    p.money += m.reward;
    p.rep += m.rep;
    G.debtPaid += m.reward;
    G.stats.missionsDone += 1;
    G.missionActive = false;
    clearTarget();
    G.audio.missionDone();
    G.banner = { title: 'MISSION PASSED', sub: `${m.name}  ·  +$${m.reward}  ·  +${m.rep} REP`, timer: 3.5 };
    G.hud.setMissionName('Free Roam');
    G.hud.setObjective('Free roam — a new job will come in soon.');
    G.saveGame();
    if (G.missionIndex + 1 >= MISSIONS.length) {
      G.storyDone = true;
      G.banner = { title: 'DEBT FREE!', sub: 'Rico paid off Marla Voss. Solmar Bay is his now — keep playing in free roam.', timer: 6 };
      G.hud.setObjective('Free roam — the city is yours, Rico.');
    } else {
      setTimeout(() => { if (G.screen === 'play') startMission(G.missionIndex + 1); }, 4500);
    }
  }

  function spawnRivals(G2) {
    // Three Tidewater crew members guarding the stash car, on the street.
    const spots = [[-96, -116], [-84, -124], [-96, -126]];
    for (const [x, z] of spots) createPed(G2, x, z, true);
    G2.combatLeft = 3;
    G2.toast = 'Tidewater crew — they are armed!';
    G2.toastTimer = 3;
  }

  return {
    startMission,
    completeStep,
    /** The player entered a car: does it finish an enterCar / stealCar step? */
    onEnterMissionCar(car) {
      const step = currentStep(G);
      if (!step) return;
      if (step.type === 'enterCar' && car.mission === 'm1-first-fare') completeStep();
      else if (step.type === 'stealCar' && G.missionCar === car) {
        addWanted(G, 2, 'stole the target car');
        completeStep();
      }
    },
    /** A rival was knocked down during a combat step. */
    onRivalDown() {
      if (G.combatLeft > 0) G.combatLeft -= 1;
      const step = currentStep(G);
      if (step && step.type === 'combat' && G.combatLeft <= 0) completeStep();
    },
    /** Advance the active mission one step; called every frame. */
    update(dt) {
      if (!G.missionActive) return;
      const step = currentStep(G);
      if (!step) return;
      const p = G.player;
      if (step.type === 'goto') {
        if (dist2D(p.x, p.z, step.x, step.z) < step.radius) {
          if (step.inCar && !p.inCar) {
            G.hud.setObjective(`${step.text} (you need a car)`);
            return;
          }
          G.effects.ring(step.x, step.z);
          G.audio.coin();
          completeStep();
        }
      } else if (step.type === 'enterCar') {
        // Waiting for the player to get in the starter car; nothing to poll.
      } else if (step.type === 'stealCar') {
        // Waiting for the player to take the marked car; handled on entry.
      } else if (step.type === 'loseWanted') {
        if (p.wanted === 0) completeStep();
        else G.hud.setObjective(`${step.text} — wanted ${p.wanted}★`);
      } else if (step.type === 'combat') {
        if (G.combatLeft === 0 && G.rivals.length === 0 && !G.rivalsSpawned) {
          G.rivalsSpawned = true;
          spawnRivals(G);
        }
      }
    },
    /** Start the story (or resume it) when a new game begins. */
    beginStory() {
      startMission(G.missionIndex);
    },
    currentMission,
    currentStep,
  };
}
