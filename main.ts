// TANDAN — Depot Tactics: entrypoint for the make.fun threejs-fps program (Node 22).
//
// The game itself is the static site in game/ (ES modules, three.js vendored under
// game/vendor/three, wired up by the import map in game/index.html). This program's
// whole job is the hand-in: copy game/ and screenshots/ into the output directory
// and write dossier.json there with the vendored make.fun library, so the judge
// reads exactly the files that ship.
//
// Run it the way the grader does:  node main.ts          (writes to /output)
// Locally:  MAKEFUN_OUTPUT_DIR=out node main.ts           (writes to ./out)

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The dossier limits below are the scorer's own caps (kit reference/gate.json):
// source text is summarised up to 163,840 bytes, at most 4 screenshots of at most
// 256 KiB each, and game/ may hold at most 993 entries totalling 48 MiB.
const DOSSIER_LIMITS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
};

mkdirSync(outDir, { recursive: true });
cpSync(join(root, 'game'), join(outDir, 'game'), { recursive: true });

mkdirSync(join(outDir, 'screenshots'), { recursive: true });
const shotsDir = join(root, 'screenshots');
if (existsSync(shotsDir)) {
  cpSync(shotsDir, join(outDir, 'screenshots'), { recursive: true });
}

writeFileSync(join(outDir, 'dossier.json'), buildDossier(outDir, DOSSIER_LIMITS));
