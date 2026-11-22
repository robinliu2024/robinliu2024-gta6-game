// Solmar Heat — config: constants, seeded RNG, city layout, mission definitions.
// Original fictional city Solmar Bay. Nothing here comes from any other game.

export const GAME_TITLE = 'Solmar Heat';
export const SAVE_KEY = 'solmar-heat-save-v1';
export const STARTING_DEBT = 40000;
export const STARTING_MONEY = 250;
export const STARTING_REP = 0;
export const MAX_WANTED = 5;
export const PLAYER_HEALTH = 100;

// World dimensions (metres, three.js units).
export const CITY = {
  halfSize: 320,          // playable ground extends +/-320 on x and z
  blockSize: 64,          // city block pitch
  roadWidth: 14,
  roadHalf: 7,
  beachX: -320,           // ocean starts west of x = -320
  oceanWidth: 260,
  buildingMaxHeight: 90,
};

// Districts: name -> centre + radius, used for HUD location text and spawns.
export const DISTRICTS = {
  harbor:    { name: 'Harbor',    x: -240, z:  200, r: 90 },
  boardwalk: { name: 'Boardwalk', x: -280, z: -40,  r: 80 },
  downtown:  { name: 'Downtown',  x:   40, z:   20, r: 130 },
  marlinClub:{ name: 'Marlin Club', x: 120, z: -160, r: 55 },
  safehouse: { name: 'Safehouse', x:  240, z:  220, r: 55 },
  marina:    { name: 'Marina',    x: -160, z: -220, r: 70 },
};

// Key spawn points (on roads, y is filled in by the caller).
export const SPAWNS = {
  player:      { x: -224, z: 192 },   // Harbor, near the docks
  marlinClub:  { x:  112, z: -144 },
  safehouse:   { x:  224, z:  208 },
  boardwalk:   { x: -272, z:  -32 },
  downtown:    { x:   32, z:   16 },
  policeDepot: { x:   96, z:   96 },
};

// Seeded RNG (mulberry32) so a ?seed= run is reproducible.
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < String(str).length; i++) {
    h ^= String(str).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Mission definitions. Nine story missions; debt is paid down by rewards.
export const MISSIONS = [
  {
    id: 'm1', name: 'First Fare', giver: 'Marla Voss',
    brief: 'A client is waiting at the Harbor. Drive him to the Marlin Club. No scratches, no cops.',
    objectives: [
      { id: 'pickup', text: 'Pick up the client at the Harbor', kind: 'goto', at: 'harbor' },
      { id: 'dropoff', text: 'Drop the client at the Marlin Club', kind: 'goto', at: 'marlinClub' },
    ],
    reward: 800, rep: 10, debtPaid: 800,
  },
  {
    id: 'm2', name: 'Hot Wheels', giver: 'Marla Voss',
    brief: 'A rival crew left a tuned coupe parked Downtown. Take it — quietly — and bring it to the Safehouse.',
    objectives: [
      { id: 'steal', text: 'Steal the coupe Downtown', kind: 'steal', at: 'downtown' },
      { id: 'deliver', text: 'Deliver the coupe to the Safehouse', kind: 'goto', at: 'safehouse' },
    ],
    reward: 1500, rep: 15, debtPaid: 1500,
  },
  {
    id: 'm3', name: 'The Getaway', giver: 'Marla Voss',
    brief: 'Grab the package on the Boardwalk, shake the two-star police tail, then reach the Safehouse.',
    objectives: [
      { id: 'package', text: 'Grab the package on the Boardwalk', kind: 'pickup', at: 'boardwalk' },
      { id: 'escape', text: 'Lose the police (drop to 0 stars)', kind: 'escape', at: 'boardwalk' },
      { id: 'safehouse', text: 'Reach the Safehouse', kind: 'goto', at: 'safehouse' },
    ],
    reward: 3000, rep: 25, debtPaid: 3000,
    wantedOnPickup: 2,
  },
  {
    id: 'm4', name: 'Payback Run', giver: 'Marla Voss',
    brief: 'Collect protection money from three Downtown shops, then bring it to the Marlin Club.',
    objectives: [
      { id: 'collect1', text: 'Collect from the Downtown shops (1/3)', kind: 'collect', at: 'downtown' },
      { id: 'collect2', text: 'Collect from the Downtown shops (2/3)', kind: 'collect', at: 'downtown' },
      { id: 'collect3', text: 'Collect from the Downtown shops (3/3)', kind: 'collect', at: 'downtown' },
      { id: 'deliver', text: 'Bring the money to the Marlin Club', kind: 'goto', at: 'marlinClub' },
    ],
    reward: 5000, rep: 30, debtPaid: 5000,
  },
  {
    id: 'm5', name: 'The Ledger', giver: 'Marla Voss',
    brief: 'One last run: take the ledger from the Marina warehouse to the Marlin Club and settle the $40,000 debt for good. Or so Marla says.',
    objectives: [
      { id: 'ledger', text: 'Take the ledger from the Marina', kind: 'pickup', at: 'marina' },
      { id: 'deliver', text: 'Deliver the ledger to the Marlin Club', kind: 'goto', at: 'marlinClub' },
    ],
    reward: 10000, rep: 50, debtPaid: 10000,
  },
  {
    id: 'm6', name: 'Solmar Grand Prix', giver: 'Marla Voss',
    brief: 'The debt\'s new owner runs Solmar\'s underground street race. Win it — four checkpoints, two minutes — and he knocks $4,000 off your tab.',
    objectives: [
      { id: 'cp1', text: 'Race checkpoint 1/4 — Downtown', kind: 'goto', at: 'downtown' },
      { id: 'cp2', text: 'Race checkpoint 2/4 — Boardwalk', kind: 'goto', at: 'boardwalk' },
      { id: 'cp3', text: 'Race checkpoint 3/4 — Marina', kind: 'goto', at: 'marina' },
      { id: 'cp4', text: 'Race checkpoint 4/4 — Marlin Club finish', kind: 'goto', at: 'marlinClub' },
    ],
    reward: 4000, rep: 40, debtPaid: 4000,
    timeLimit: 120,
  },
  {
    id: 'm7', name: 'The Vault Job', giver: 'Marla Voss',
    brief: 'The man who bought your debt owns the Bayfront Bank Downtown. Rob his vault, shake the three-star police tail, and bring the cash to the Safehouse.',
    objectives: [
      { id: 'bank', text: 'Get to the Bayfront Bank Downtown', kind: 'goto', at: 'downtown' },
      { id: 'vault', text: 'Crack the vault and grab the cash', kind: 'pickup', at: 'downtown' },
      { id: 'escape', text: 'Lose the police (drop to 0 stars)', kind: 'escape', at: 'downtown' },
      { id: 'safehouse', text: 'Bring the cash to the Safehouse', kind: 'goto', at: 'safehouse' },
    ],
    reward: 6000, rep: 50, debtPaid: 6000,
    wantedOnPickup: 3,
  },
  {
    id: 'm8', name: 'Chopper Out', giver: 'Marla Voss',
    brief: 'The bank job put every cop in Solmar on you. Marla has a helicopter waiting at the Marina helipad — grab the getaway bag, lose the tail, and vanish.',
    objectives: [
      { id: 'helipad', text: 'Grab the getaway bag at the Marina helipad', kind: 'pickup', at: 'marina' },
      { id: 'escape', text: 'Lose the police (drop to 0 stars)', kind: 'escape', at: 'marina' },
      { id: 'safehouse', text: 'Reach the Safehouse', kind: 'goto', at: 'safehouse' },
    ],
    reward: 5000, rep: 60, debtPaid: 5000,
    wantedOnPickup: 4,
  },
  {
    id: 'm9', name: 'Settle Up', giver: 'Marla Voss',
    brief: 'Last job, for real this time: take the payoff cash from the Safehouse to the Marlin Club and settle the $40,000 debt for good.',
    objectives: [
      { id: 'cash', text: 'Grab the payoff cash at the Safehouse', kind: 'pickup', at: 'safehouse' },
      { id: 'escape', text: 'Lose the police (drop to 0 stars)', kind: 'escape', at: 'safehouse' },
      { id: 'deliver', text: 'Deliver the payoff to the Marlin Club', kind: 'goto', at: 'marlinClub' },
    ],
    reward: 10000, rep: 100, debtPaid: 4700,
    wantedOnPickup: 2,
  },
];

export function missionById(id) {
  return MISSIONS.find((m) => m.id === id) || null;
}
export function nextMissionId(completedIds) {
  const done = new Set(completedIds || []);
  const next = MISSIONS.find((m) => !done.has(m.id));
  return next ? next.id : null;
}

// Movement / driving tuning placeholders the gameplay parts will use.
export const TUNING = {
  walkSpeed: 6,
  runSpeed: 10,
  carAccel: 22,
  carBrake: 34,
  carMaxSpeed: 42,
  carTurn: 1.9,
  policeMaxSpeed: 38,
  wantedDecaySeconds: 12,
};
