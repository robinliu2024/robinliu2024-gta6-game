// Solmar Heat — make.fun entry packager for gta6-01 (Node 22, stdlib only).
// My own words: this script is the hand-in step. It takes the finished game
// folder and the screenshots beside this file, copies both into the output
// directory (/output, or $MAKEFUN_OUTPUT_DIR when set), and then asks the
// vendored make.fun helper to write dossier.json there — the summary the
// judges read. The game itself is plain static files: index.html plus ES
// modules, three.js vendored locally, no network at runtime.
// Run it with screenshots in place:  node main.ts
// (or: MAKEFUN_OUTPUT_DIR=out node main.ts)

import { cpSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

const dossierPath = join(out, 'dossier.json');
writeFileSync(
  dossierPath,
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);

console.log(`solmar-heat: dossier written to ${dossierPath} (${statSync(dossierPath).size} bytes)`);
