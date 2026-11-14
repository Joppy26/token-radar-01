// Token Radar — entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot, ranks the pre-token protocols by the radar-2
// model, and writes the entry's outputs:
//
//   <out>/board.json      the ranked board (rows)
//   <out>/data.js         the dashboard's data, beside the page
//   <out>/dashboard/      the dashboard page (copied from this repository)
//   <out>/screenshots/    the three dashboard screenshots (copied)
//   <out>/dossier.json    the dossier buildDossier writes from them
//
// Invocation (from the repository root):
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
//
// Without --input it reads /input/snapshot.json; without
// MAKEFUN_OUTPUT_DIR it writes /output. The run is deterministic: no wall
// clock, no unseeded randomness, so two runs write identical bytes.

import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import { buildBoard, type Snapshot } from './lib/model.ts';

function parseArgs(argv: string[]): { input: string } {
  let input = '/input/snapshot.json';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input' && i + 1 < argv.length) input = argv[i + 1]!;
  }
  return { input };
}

function main(): void {
  const { input } = parseArgs(process.argv.slice(2));
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';
  const repoRoot = dirname(fileURLToPath(import.meta.url));

  const snapshot = JSON.parse(readFileSync(input, 'utf8')) as Snapshot;
  const board = buildBoard(snapshot);

  mkdirSync(outDir, { recursive: true });
  mkdirSync(join(outDir, 'dashboard'), { recursive: true });
  mkdirSync(join(outDir, 'screenshots'), { recursive: true });

  // The ranked board.
  writeFileSync(join(outDir, 'board.json'), JSON.stringify({ rows: board.rows }, null, 2) + '\n', 'utf8');

  // The dashboard's data, beside the page (the page loads ../data.js).
  const data = {
    meta: {
      model: 'radar-2',
      asOf: board.asOf,
      floorUsd: board.floorUsd,
      rows: board.rows.length,
      watchlist: board.watchlistCount,
      belowFloor: board.belowFloorCount,
      excludedAboveFloor: board.excludedAboveFloor,
      liveComps: board.liveCount,
      globalMedian: board.globalMedian,
    },
    multiples: board.multiples,
    globalMedian: board.globalMedian,
    watchlist: snapshot.watchlist,
    rows: board.rows,
    live: board.liveRows,
  };
  writeFileSync(join(outDir, 'data.js'), `window.TOKEN_RADAR = ${JSON.stringify(data)};\n`, 'utf8');

  // The dashboard page and the screenshots, copied as they are.
  cpSync(join(repoRoot, 'dashboard'), join(outDir, 'dashboard'), { recursive: true });
  cpSync(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });

  // The dossier: byte for byte what buildDossier writes from them.
  writeFileSync(join(outDir, 'dossier.json'), buildDossier(outDir, { text_max_bytes: 65536 }));

  console.log(
    `${board.rows.length} rows, ${board.watchlistCount} on the watchlist, ` +
      `${board.liveRows.length} live comps, ${board.multiples.length} direct multiples`,
  );
}

main();
