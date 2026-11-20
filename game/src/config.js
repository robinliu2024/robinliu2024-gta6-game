// config.js — every constant, name and mission definition for Solmar Heat.
// The city is fictional: Solmar Bay, a sun-soaked coastal town. All names, people
// and places are original and belong to this game only.

export const GAME_TITLE = 'Solmar Heat';
export const CITY_NAME = 'Solmar Bay';

// Deterministic RNG (mulberry32) so ?shot= scenes and replays are stable.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function dist2D(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return Math.sqrt(dx * dx + dz * dz); }
export function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// ---- City layout: a grid of blocks with roads between them ----
export const BLOCK = 46;        // block size (metres)
export const ROAD = 14;         // road width
export const GRID = 7;          // blocks per side (7x7 blocks)
export const PITCH = BLOCK + ROAD;
export const CITY_HALF = (GRID * PITCH + ROAD) / 2; // half-extent of the road grid
export function roadCoord(i) { return -CITY_HALF + ROAD / 2 + i * PITCH; } // centre of road i (0..GRID)
export function blockCoord(i) { return -CITY_HALF + ROAD + BLOCK / 2 + i * PITCH; } // centre of block i

export const STREET_NAMES = [
  'Marlin Ave', 'Palm Court', 'Coral Row', 'Sunset Blvd', 'Harbor St',
  'Flamingo Way', 'Tidewater Ln', 'Coconut Dr',
];
export const DISTRICTS = [
  { name: 'Old Harbor', x: -2, z: 2 }, { name: 'Marlin Quarter', x: 1, z: -1 },
  { name: 'Palm Heights', x: 2, z: 1 }, { name: 'The Boardwalk', x: 0, z: 3 },
  { name: 'Coconut Flats', x: -1, z: -2 },
];

// ---- Vehicles ----
export const CAR_MODELS = [
  { name: 'Sunrunner', color: 0xe8b400, top: 34, accel: 16 },
  { name: 'Coral GT', color: 0xd63a2f, top: 40, accel: 19 },
  { name: 'Bay Cruiser', color: 0x2f6fd6, top: 30, accel: 13 },
  { name: 'Palm Taxi', color: 0xf2c200, top: 32, accel: 15, taxi: true },
  { name: 'Harbor Van', color: 0x8a8f96, top: 26, accel: 11 },
  { name: 'Flamingo Coupe', color: 0xe86aa8, top: 38, accel: 18 },
];
export const POLICE_MODEL = { name: 'SBPD Interceptor', color: 0x1c2733, top: 42, accel: 22 };

// ---- Player / economy ----
export const START_MONEY = 250;
export const START_HEALTH = 100;
export const DEBT_TOTAL = 40000;
export const WANTED_MAX = 5;

// ---- Missions: a story thread about Rico Vega paying off his debt ----
export const MISSIONS = [
  {
    id: 'm1-first-fare',
    name: 'First Fare',
    giver: 'Marla Voss',
    intro: 'Marla Voss: "Rico. You owe me forty grand. Drive my client from the harbor to the Marlin Club and maybe I forget the interest."',
    reward: 800, rep: 10,
    steps: [
      { type: 'enterCar', text: 'Get in the yellow Sunrunner by the harbor' },
      { type: 'goto', x: 90, z: -90, radius: 9, text: 'Pick up the client at Palm Court' },
      { type: 'goto', x: -90, z: 90, radius: 10, text: 'Drop the client at the Marlin Club' },
    ],
  },
  {
    id: 'm2-hot-wheels',
    name: 'Hot Wheels',
    giver: 'Marla Voss',
    intro: 'Marla Voss: "A Coral GT is parked outside the Flamingo Hotel. Bring it to my garage on Harbor St. Cops will notice — drive like you mean it."',
    reward: 1500, rep: 15,
    steps: [
      { type: 'stealCar', model: 'Coral GT', x: 30, z: 105, text: 'Steal the red Coral GT by the Flamingo Hotel' },
      { type: 'goto', x: -120, z: -30, radius: 10, text: 'Deliver the Coral GT to the garage on Harbor St', inCar: true },
    ],
  },
  {
    id: 'm3-getaway',
    name: 'The Getaway',
    giver: 'Danny "Fins" Cole',
    intro: 'Danny: "The SBPD staked out my drop. Grab the package at the boardwalk, then shake a two-star tail and bring it to the safehouse."',
    reward: 2200, rep: 20,
    steps: [
      { type: 'goto', x: 0, z: 150, radius: 8, text: 'Grab the package on the Boardwalk' },
      { type: 'loseWanted', stars: 2, text: 'Lose the police — get your wanted level to zero' },
      { type: 'goto', x: 150, z: 150, radius: 10, text: 'Deliver the package to the safehouse' },
    ],
  },
  {
    id: 'm4-payback',
    name: 'Payback Run',
    giver: 'Marla Voss',
    intro: 'Marla Voss: "The Tidewater crew skimmed my cut. Take their stash car from Coconut Flats and bring it home. They will shoot back."',
    reward: 3500, rep: 25,
    steps: [
      { type: 'goto', x: -90, z: -120, radius: 10, text: 'Reach the stash car in Coconut Flats' },
      { type: 'combat', count: 3, text: 'Deal with the Tidewater crew (3 rivals)' },
      { type: 'goto', x: 150, z: -150, radius: 10, text: 'Drive the stash car to the Marlin Club garage', inCar: true },
    ],
  },
  {
    id: 'm5-debt-free',
    name: 'Debt Free',
    giver: 'Marla Voss',
    intro: 'Marla Voss: "Last job, Rico. A courier van full of club cash is crossing town. Take it, lose the heat, and your debt is history."',
    reward: 6000, rep: 30,
    steps: [
      { type: 'stealCar', model: 'Harbor Van', x: 90, z: 30, text: 'Hijack the courier van on Sunset Blvd' },
      { type: 'loseWanted', stars: 3, text: 'Lose the three-star police chase' },
      { type: 'goto', x: -90, z: 90, radius: 10, text: 'Bring the van to the Marlin Club', inCar: true },
    ],
  },
];

export const FREE_ROAM_TEXT = 'Free roam — steal a car, explore Solmar Bay, cause trouble.';
export const HIDEOUT = { x: 150, z: 150 };
export const SPAWN = { x: 30, z: 120, heading: Math.PI };
