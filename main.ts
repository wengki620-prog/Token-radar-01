// Entri token-radar-01 (Node 22, pustaka standar saja).
//
// Program membaca snapshot tersegel dari /input/snapshot.json (atau --input
// <berkas|direktori>), menilai setiap protokol pre-token yang lolos saring dengan
// model di lib/model.ts, menulis board berperingkat ke /output/board.json, menulis
// data dasbor ke /output/data.js, menyalin dashboard/ dan screenshots/ milik repo
// ini ke /output, dan terakhir menulis /output/dossier.json, ringkasan yang dibaca
// juri, dengan pustaka make.fun yang tervendor.
//
// Dasbornya halaman statis, tanpa framework dan tanpa jaringan: dashboard/index.html,
// dashboard/app.css dan dashboard/app.js membaca /output/data.js yang ditulis
// program ini dari board yang sama. Board, data, dan dossier selalu berasal dari
// satu kali jalan yang sama, sehingga ketiganya tidak mungkin berbeda.
//
// Di luar kontainer grader, MAKEFUN_OUTPUT_DIR menggantikan /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** Batas-batas gate (reference/gate.json): batas teks membentuk byte, sisanya menolak. */
const TEXT_MAX_BYTES = 65_536;
const DOSSIER_MAX_BYTES = 1_572_864;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <nilai> dari argumen, atau fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`radar token: tidak ada snapshot di ${inputFile}: beri --input <snapshot.json|direktori> atau pasang /input yang tersegel\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`radar token: model menulis board yang ditolak gate: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Salin berkas reguler satu direktori ke `to`, lewati nama yang diawali titik. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dash = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`radar token: screenshots/ memuat ${shots.length} gambar: serahkan 3, yaitu board, tampilan detail, dan tampilan terfilter\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`radar token: screenshots/${name}: nama hanya huruf, angka, dan . _ -, 1 sampai 128 karakter\n`);
    process.exit(1);
  }
}

// Dossier ditulis terakhir: scorer membangunnya ulang dari /output ini dan membandingkan byte-nya.
const dossier = buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS });
if (dossier.length > DOSSIER_MAX_BYTES) {
  process.stderr.write(`radar token: dossier ${dossier.length} byte, melewati batas gate ${DOSSIER_MAX_BYTES}: kecilkan screenshot atau sumber dasbor\n`);
  process.exit(1);
}
writeFileSync(join(out, 'dossier.json'), dossier);

process.stdout.write(
  `radar token: ${snapshot.protocols.length} protokol, ${snapshot.watchlist.length} di watchlist, ${board.length} baris dinilai (${radar.early_size} dini, ${radar.live_size} live disisihkan)\n` +
    `radar token: menulis ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dash.length} berkas), ${join(out, 'screenshots')} (${shots.length} gambar) dan ${join(out, 'dossier.json')} (${dossier.length} byte)\n`,
);
