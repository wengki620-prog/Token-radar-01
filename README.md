# Radar Token

Entri untuk **token-radar-01** ("Build the best token launch radar"): board
peringkat protokol pre-token menurut nilai tersirat, lengkap dengan rencana
farm tiap protokol dan dasbor yang bisa disaring, diurutkan, dan dijelajahi
per protokol.

## Cara menjalankan

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Program membaca snapshot tersegel (cuplikan DefiLlama per 2026-11-14, 758
protokol), lalu menulis ke direktori output:

- `board.json` — 198 baris berperingkat, masing-masing dengan nilai tersirat
  dan rencana farm.
- `data.js` — data yang sama untuk dasbor, ditambah seluruh protokol live
  sebagai pembanding.
- `dashboard/` — halaman statis: `index.html`, `app.css`, `app.js`.
- `screenshots/` — 3 tangkapan layar render asli dasbor ini.
- `dossier.json` — ringkasan yang dibaca juri, dibangun dengan pustaka kit
  yang tervendor (`vendor/makefun-board.ts`).

Jalankan dua kali: byte keluarannya identik.

## Model nilai tersirat

Satu fungsi menilai setiap baris dari angka-angka snapshot, tanpa daftar nama
yang ditulis tangan:

```
tersirat = round( TVL × kelipatan × pengali pertumbuhan × pengali kematangan )
```

- **Kelipatan** — median rasio market cap terhadap TVL dari protokol live
  se-kategori, dipakai bila pembandingnya 5 atau lebih; kalau tidak, median
  global. Dijepit ke 0,05×–1,5×.
- **Pengali pertumbuhan** — `1 + clamp(change_7d, −60, 120) / 100 × 0,5`.
- **Pengali kematangan** — `0,6 + min(umur_hari, 1095) / 1095 × 0,4`; umur
  adalah waktu sejak protokol pertama kali tercatat, dan umur yang tidak
  diketahui memakai median 677 hari.

Board memuat 198 protokol: seluruh 40 watchlist (TVL ≥ $50 juta, tidak
tercatat memiliki token) ditambah 158 protokol pre-token lain yang lolos
saring yang sama. 144 protokol pre-token disisihkan karena tergolong bridge,
liquid staking/restaking, produk wrapped/staked, CEX, atau nama berversi —
alasan tiap saringan dicantumkan di dasbor. Dasbor tidak pernah mengatakan
protokol "tidak memiliki token"; yang dikatakan adalah "tidak tercatat
memiliki token", karena catatan snapshot bukan bukti.

Rencana farm tiap baris diturunkan dari kategori, chain, TVL, dan umur
protokol: 6 langkah, 7 bila protokol berjalan di lebih dari satu chain,
masing-masing dengan perkiraan biaya dan waktu.

## Struktur

```
main.ts                  program utama (Node 22, pustaka standar saja)
lib/model.ts             model, saring, rencana farm, validasi board
vendor/makefun-board.ts  pustaka kit, tidak diubah
dashboard/               halaman statis, tanpa jaringan
screenshots/             3 tangkapan layar render asli (1440×900)
```

## Catatan

Nilai tersirat adalah perkiraan model entri ini, bukan harga, bukan prediksi
peluncuran, dan bukan saran keuangan. Entri ini murni dasbor: tidak membeli
atau menyediakan likuiditas token apa pun.

Lisensi: MIT. Lihat `LICENSE`.
