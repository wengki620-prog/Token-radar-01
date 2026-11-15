// Model radar token: satu snapshot semesta protokol masuk, satu board berperingkat keluar.
//
// Board memuat setiap slug watchlist (lantai, bukan langit-langit) ditambah protokol
// pre-token lain yang lolos aturan saring. Sebuah protokol disebut pre-token bila
// catatannya tidak membawa token (tanpa market cap, tanpa id CoinGecko, tanpa simbol).
// Protokol yang tokennya sudah diperdagangkan disisihkan dan ditampilkan terpisah
// dengan nilai pasarnya sendiri, tidak pernah dicampur ke dalam board berperingkat.
//
// Nilai tersirat (implied value) hanya mengikuti angka-angka snapshot itu sendiri:
//
//   kelipatan  = median mcap/TVL protokol live se-kategori (bila pembanding >= 5),
//                kalau tidak median global; dijepit ke [0,05 .. 1,50]
//   tumbuh     = clamp(change_7d, -60, 120) persen
//   pengaliTumbuh   = 1 + (tumbuh / 100) x bobotTumbuh
//   pengaliMatang   = 0,6 + min(umur_hari, 1095) / 1095 x 0,4
//   tersirat   = max(1, round(tvl_usd x kelipatan x pengaliTumbuh x pengaliMatang))
//
// Umur yang tidak diketahui memakai median umur protokol yang tanggalnya tercatat.
// Tidak ada nama protokol yang diperlakukan istimewa: satu fungsi yang sama menilai
// setiap baris, dan kelipatan kategori dihitung dari data live di snapshot yang sama,
// bukan dari daftar yang ditulis tangan.

/** Satu entri protokol snapshot: tepat sepuluh kolom bawaan berkas tersegel. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** Seluruh dokumen snapshot. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Konstanta model, seperti yang dinyatakan dasbor dan bisa diubah di kotak pasir. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  multiple_min: number;
  multiple_max: number;
  min_comparables: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  multiple_min: 0.05,
  multiple_max: 1.5,
  min_comparables: 5,
};

/** Label versi model: dasbor menyebutnya dan board mencatatnya. */
export const MODEL_VERSION = 'radar-komparabel-1';

/** Satu langkah farm: tindakan, biayanya, dan lamanya. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** Satu baris board.json: baris board berperingkat. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    multiple: number;
    multiple_basis: 'kategori' | 'global';
    comparables: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** Bentuk ringkas satu baris untuk data.js, lengkap dengan rencana farm-nya. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  multiple: number;
  multiple_basis: 'kategori' | 'global';
  comparables: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  farm_steps: string[];
}

/** Satu protokol live: tokennya sudah diperdagangkan, jadi dasbor memakai nilai pasar. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  symbol: string | null;
}

/** Satu baris tabel pembanding: median mcap/TVL kategori dari protokol live. */
export interface ComparableRow {
  category: string;
  n: number;
  median: number;
  used: boolean;
}

/** Semua yang dibutuhkan dasbor: board, set live, pembanding, dan modelnya. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  median_age_days: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  set_aside_size: number;
  set_aside_reasons: Record<string, number>;
  global_multiple: number;
  multiples: ComparableRow[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Alasan snapshot bukan yang bisa dinilai model ini. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** Angka berhingga, kalau tidak `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Median: salinan terurut, elemen tengahnya (indeks bawah dari n/2). */
export function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** Hitungan hari penuh dari `from` ke `to`, dijepit di nol; null bila tanggal tidak ada/rusak. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Aturan penanda versi DefiLlama: nama yang berakhiran rilis adalah varian protokol lain. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Kategori yang catatannya adalah produk token yang sudah diperdagangkan. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Nama yang diawali nama bursa: produk bursa atas aset yang sudah diperdagangkan. */
const EXCHANGE_START = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Nama yang membawa kata utuh wrapped/staked/staking, huruf apa pun. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Apakah protokol tidak tercatat membawa token sama sekali. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Apakah protokol boleh masuk board berperingkat: pre-token dan bukan produk turunan. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !EXCLUDED_CATEGORIES.has(p.category ?? '') && !VERSIONED.test(p.name) && !WRAPPED_WORD.test(p.name) && !EXCHANGE_START.test(p.name);
}

/** Alasan protokol pre-token disisihkan dari board, atau null bila boleh masuk board. */
export function setAsideReason(p: SnapshotProtocol): string | null {
  if (!isPreToken(p)) return 'token sudah diperdagangkan';
  if (EXCLUDED_CATEGORIES.has(p.category ?? '')) return `kategori ${p.category} (produk token yang sudah diperdagangkan)`;
  if (VERSIONED.test(p.name)) return 'nama berakhiran penanda versi';
  if (WRAPPED_WORD.test(p.name)) return 'nama membawa kata wrapped/staked/staking';
  if (EXCHANGE_START.test(p.name)) return 'nama diawali nama bursa';
  return null;
}

/** Kelipatan kategori dari protokol live: median mcap/TVL per kategori plus median global. */
export function categoryMultiples(snapshot: Snapshot): { global: number; byCategory: Map<string, { n: number; median: number }> } {
  const live = snapshot.protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.tvl_usd > 0);
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of live) {
    const ratio = (p.mcap_usd as number) / p.tvl_usd;
    all.push(ratio);
    const key = p.category ?? '(tanpa kategori)';
    const list = byCategory.get(key) ?? [];
    list.push(ratio);
    byCategory.set(key, list);
  }
  const out = new Map<string, { n: number; median: number }>();
  for (const [key, list] of byCategory) out.set(key, { n: list.length, median: medianOf(list) });
  return { global: medianOf(all), byCategory: out };
}

/** Kelipatan yang dipakai satu protokol, dijepit ke rentang model. */
export function multipleFor(
  category: string | null,
  multiples: { global: number; byCategory: Map<string, { n: number; median: number }> },
  model: ModelConstants,
): { multiple: number; basis: 'kategori' | 'global'; comparables: number } {
  const entry = multiples.byCategory.get(category ?? '(tanpa kategori)');
  const basis: 'kategori' | 'global' = entry !== undefined && entry.n >= model.min_comparables ? 'kategori' : 'global';
  const raw = basis === 'kategori' ? (entry as { n: number; median: number }).median : multiples.global;
  const comparables = basis === 'kategori' ? (entry as { n: number; median: number }).n : 0;
  return { multiple: Math.min(model.multiple_max, Math.max(model.multiple_min, raw)), basis, comparables };
}

/** Tiga pengali dan nilai tersirat satu protokol di bawah `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  multiples: { global: number; byCategory: Map<string, { n: number; median: number }> },
  model: ModelConstants,
  medianAge: number,
): { implied: number; multiple: number; basis: 'kategori' | 'global'; comparables: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? medianAge;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const { multiple, basis, comparables } = multipleFor(protocol.category, multiples, model);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult));
  return { implied, multiple, basis, comparables, growthPct, growthMult, maturityMult, age };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Langkah sebagai satu string: tindakan, lalu biaya dan waktunya, dalam 20..600 karakter. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Biaya: ${step.cost}. Waktu: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Tahan posisi dan periksa halaman resmi protokol.`;
  return s;
}

/** Chain pertama yang disebut protokol, atau frasa netral. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'chain utamanya';
}

/** Perkiraan gas satu transaksi di sebuah chain, dari nama chain-nya. */
function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 'sekitar $10 untuk gas';
  if (['arbitrum', 'optimism', 'base', 'polygon', 'zksync era', 'linea', 'scroll', 'blast', 'mantle', 'mode', 'starknet', 'fraxtal', 'ink', 'unichain', 'world chain', 'abstract', 'soneium', 'l2'].some((k) => c.includes(k))) return 'sekitar $1 untuk gas';
  if (['solana', 'sui', 'aptos', 'near', 'tron', 'binance', 'avalanche', 'fantom', 'celo', 'gnosis', 'hyperliquid l1', 'monad', 'sei', 'injective', 'osmosis'].some((k) => c.includes(k))) return 'di bawah $1 untuk gas';
  return 'sekitar $3 untuk gas';
}

/** Besaran modal satu posisi farm, dari TVL protokol itu sendiri. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** Lama menahan posisi, dari umur protokol: yang muda diberi jendela kualifikasi lebih panjang. */
function holdDaysFor(age: number | null, medianAge: number): number {
  const a = age ?? medianAge;
  if (a < 180) return 60;
  if (a < 365) return 45;
  return 30;
}

/** Aksi utama per kategori, dengan kata-kata yang bisa diikuti petani. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('uncollateralized')) return `Setor $${capital} USDC ke ${name} di ${chain}, lalu pinjam sedikit terhadapnya dan biarkan posisi tetap terbuka.`;
  if (c.includes('dex') || c.includes('liquidity manager')) return `Sediakan $${capital} likuiditas ke pool utama ${name} di ${chain} dan biarkan posisi tetap terbuka.`;
  if (c.includes('yield') || c.includes('leveraged farm') || c.includes('farm')) return `Setor $${capital} ke vault ${name} di ${chain} dan tahan bagiannya.`;
  if (c.includes('bridge')) return `Jembatani $${capital} USDC ke ${chain} lewat ${name}, lalu pakai dana hasil jembatan itu di aplikasinya.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} aset staking chain itu lewat ${name} di ${chain} dan simpan tanda terimanya.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options') || c.includes('synthetics')) return `Setor $${capital} USDC sebagai margin di ${name} di ${chain} dan buka satu posisi lindung kecil.`;
  if (c.includes('prediction')) return `Danai $${capital} dan pasang satu posisi pasar di ${name} di ${chain}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Setor $${capital} ke vault kurasi ${name} di ${chain} dan tahan bagiannya.`;
  if (c.includes('stable')) return `Cetak atau setor $${capital} aset stabil lewat ${name} di ${chain} dan tahan posisinya.`;
  if (c.includes('rwa')) return `Cetak $${capital} aset hasil ${name} di ${chain} dan tahan asetnya.`;
  if (c.includes('insurance')) return `Beli perlindungan $${capital} dari ${name} di ${chain} dan simpan polisnya.`;
  if (c.includes('chain') && !c.includes('bridge')) return `Jembatani $${capital} ke jaringan ${name} dan pakai aplikasi utamanya di ${chain}.`;
  if (c.includes('launchpad')) return `Ikut alokasi ${name} dengan $${capital} di ${chain} dan selesaikan tugas kualifikasinya.`;
  if (c.includes('index')) return `Beli $${capital} token indeks ${name} di ${chain} dan tahan posisinya.`;
  if (c.includes('governance')) return `Kunci $${capital} dan ikut satu pemungutan suara di ${name} di ${chain}.`;
  if (c.includes('privacy')) return `Setor $${capital} ke pool privat ${name} di ${chain} dan simpan catatan penarikannya.`;
  if (c.includes('btc') || c.includes('bitcoin')) return `Cetak $${capital} aset yang dipatok BTC lewat ${name} di ${chain} dan tahan atau sediakan likuiditasnya.`;
  if (c.includes('payment') || c.includes('card')) return `Aktifkan pembayaran ${name} dengan $${capital} di ${chain} dan lakukan satu transaksi nyata.`;
  if (c.includes('otc') || c.includes('marketplace')) return `Lakukan satu perdagangan $${capital} di ${name} di ${chain} dan simpan buktinya.`;
  return `Setor $${capital} USDC ke ${name} di ${chain} dan biarkan posisi tetap terbuka.`;
}

/**
 * Rencana farm satu protokol: enam langkah, tujuh bila multi-chain. Setiap langkah
 * diturunkan dari catatan protokol itu sendiri (kategori, chain, TVL, umur), tidak
 * pernah dari daftar nama yang ditulis tangan.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, medianAge: number): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age, medianAge);
  const gas = gasFor(chain);
  const steps: FarmStep[] = [
    {
      text: 'Pakai dompet baru yang hanya berisi dana yang memang diniatkan untuk farming, dan simpan seed phrase-nya secara offline.',
      cost: gas,
      time: '5 menit',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} modal dan ${gas}`,
      time: '15 menit untuk menyiapkan',
    },
  ];
  if (p.chains.length >= 2) {
    const second = p.chains[1]!;
    steps.push({
      text: `Ulangi posisi yang sama di ${second} dengan setengah modal, supaya aktivitas tercatat di dua chain.`,
      cost: `$${Math.round(capital / 2)} modal dan ${gasFor(second)}`,
      time: '10 menit',
    });
  }
  steps.push(
    {
      text: 'Lakukan satu aksi kualifikasi setiap minggu, misalnya setor, pinjam, swap, atau memilih.',
      cost: 'gas mingguan sesuai chain',
      time: '10 menit per minggu',
    },
    {
      text: `Tahan posisi setidaknya ${hold} hari supaya aktivitas tercatat di lebih dari satu snapshot.`,
      cost: `modal $${capital} tetap berada di posisi`,
      time: `${hold} hari`,
    },
    {
      text: 'Sebelum menarik dana, buka halaman poin atau hadiah resmi protokol dan klaim hanya dari tautan yang ia terbitkan.',
      cost: 'memeriksa tidak berbiaya, dan jangan pernah membayar untuk klaim',
      time: '10 menit',
    },
    {
      text: 'Catat dompet, tanggal, dan setiap transaksi dalam log farm agar posisi bisa diulang atau ditutup dengan rapi.',
      cost: 'tidak berbiaya selain lognya',
      time: '5 menit',
    },
  );
  return steps;
}

/** Protokol per slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** Protokol yang masuk board, terkuat dahulu, dengan peringkat 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const multiples = categoryMultiples(snapshot);
  const knownAges = snapshot.protocols.map((p) => ageDays(snapshot.as_of, p.listed_at)).filter((a): a is number => a !== null);
  const medianAge = medianOf(knownAges);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // Watchlist adalah lantai: setiap slug masuk, bahkan bila catatannya tidak ada
  // (tidak mungkin, tetapi cakupan adalah baris gate dan tidak pernah dipertaruhkan).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // Radar dini: protokol pre-token lain yang lolos saring, berapa pun TVL-nya.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const watchlist = new Set(snapshot.watchlist);
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, multiples, model, medianAge);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    on_watchlist: watchlist.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      multiple: round4(s.multiple),
      multiple_basis: s.basis,
      comparables: s.comparables,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age, medianAge).map(stepText),
  }));
}

/** Protokol live, diurutkan market cap terbesar dahulu. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      symbol: p.symbol,
    }));
}

/** Bentuk ringkas satu baris board untuk data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    on_watchlist: row.on_watchlist,
    implied_value_usd: row.implied_value_usd,
    multiple: row.model.multiple,
    multiple_basis: row.model.multiple_basis,
    comparables: row.model.comparables,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Semua yang dirender dasbor, dari snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const multiples = categoryMultiples(snapshot);
  const knownAges = snapshot.protocols.map((p) => ageDays(snapshot.as_of, p.listed_at)).filter((a): a is number => a !== null);
  const medianAge = medianOf(knownAges);
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlist.has(r.slug)).length;
  const setAsideReasons: Record<string, number> = {};
  let setAside = 0;
  for (const p of snapshot.protocols) {
    const reason = setAsideReason(p);
    if (reason !== null) {
      setAside++;
      const key = reason.startsWith('kategori ') ? 'kategori produk turunan' : reason;
      setAsideReasons[key] = (setAsideReasons[key] ?? 0) + 1;
    }
  }
  const multiplesTable: ComparableRow[] = [...multiples.byCategory.entries()]
    .map(([category, v]) => ({ category, n: v.n, median: round4(v.median), used: v.n >= model.min_comparables }))
    .sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    median_age_days: medianAge,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    set_aside_size: setAside,
    set_aside_reasons: setAsideReasons,
    global_multiple: round4(multiples.global),
    multiples: multiplesTable,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** Snapshot dari teks berkas, ditolak bila bentuknya bukan yang bisa dinilai model. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json bukan JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json bukan objek JSON');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json tidak punya tanggal as_of');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json tidak punya source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json tidak punya floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json tidak punya array protocols');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json tidak punya watchlist slug');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`protokol ${i} di snapshot.json bukan objek`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`protokol ${i} di snapshot.json tidak punya slug, nama, atau TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Alasan board bukan yang diterima gate, atau null: cakupan, peringkat, urutan, langkah farm. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board memuat ${board.length} baris, di luar 100..4000`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const r of board) {
    if (!known.has(r.slug)) return `slug ${r.slug} tidak ada di snapshot`;
    if (seen.has(r.slug)) return `slug ${r.slug} muncul dua kali`;
    seen.add(r.slug);
  }
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) return `board kehilangan ${missing.length} slug watchlist: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `peringkat ${i + 1} tertulis ${ranks[i]}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `baris peringkat ${i + 1} nilainya melebihi peringkat ${i}`;
  if (board.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) {
    return `semua ${board.length} baris berbagi nilai tersirat yang sama: board yang tidak memeringkat apa pun`;
  }
  for (const r of board) {
    if (typeof r.name !== 'string' || r.name.length === 0) return `${r.slug} tidak punya nama`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `${r.slug} punya nilai tersirat ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} punya ${r.farm_steps.length} langkah farm`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} punya langkah farm sepanjang ${t.length} karakter`;
    }
  }
  return null;
}

/** data.js yang ringkas: seluruh dataset dasbor sebagai satu skrip, tanpa fetch dan tanpa jaringan. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
