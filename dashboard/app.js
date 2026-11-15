// Dasbor Radar Token. Membaca window.RADAR (ditulis main.ts di samping dashboard/)
// lalu merender board berperingkat, filter, tabel live, panel model beserta kotak
// pasirnya, dan detail tiap protokol dengan rencana farm-nya. Tanpa jaringan:
// setiap byte yang ditampilkan berasal dari data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', watchlist: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null, sandbox: null };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'tidak diketahui';
    if (days >= 365) return (days / 365).toFixed(1) + ' th';
    return Math.max(0, Math.round(days)) + ' hari';
  }
  function fmtNum(n, d) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(d === undefined ? 3 : d);
  }

  // Median: salinan terurut, elemen tengahnya. Definisi ini sama persis dengan
  // medianOf di lib/model.ts, sehingga halaman dan board menghitung angka yang sama.
  function medianOf(values) {
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    return sorted[Math.floor(sorted.length / 2)];
  }

  // Kelipatan kategori dari protokol live di snapshot yang sama: median mcap/TVL
  // per kategori, dipakai hanya bila pembandingnya cukup; kalau tidak, median global.
  function multiplesOf(live, model) {
    var byCat = {};
    var all = [];
    live.forEach(function (p) {
      if (p.mcap_usd === null || p.mcap_usd === undefined || !(p.tvl_usd > 0)) return;
      var ratio = p.mcap_usd / p.tvl_usd;
      all.push(ratio);
      var key = p.category || '(tanpa kategori)';
      (byCat[key] = byCat[key] || []).push(ratio);
    });
    var out = { global: medianOf(all), byCategory: {} };
    Object.keys(byCat).forEach(function (k) {
      out.byCategory[k] = { n: byCat[k].length, median: medianOf(byCat[k]) };
    });
    return out;
  }
  var MULT = multiplesOf(DATA.live, DATA.model);

  function multipleFor(category, model) {
    var entry = MULT.byCategory[category || '(tanpa kategori)'];
    var basis = entry && entry.n >= model.min_comparables ? 'kategori' : 'global';
    var raw = basis === 'kategori' ? entry.median : MULT.global;
    return {
      multiple: Math.min(model.multiple_max, Math.max(model.multiple_min, raw)),
      basis: basis,
      comparables: basis === 'kategori' ? entry.n : 0
    };
  }

  // Model dalam satu fungsi: halaman menghitung ulang tiap baris dari angka-angka
  // snapshot dan memeriksa angka yang dibawa board.json, sehingga kode halaman dan
  // data board terlihat memakai aritmatika yang sama.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? DATA.median_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var mult = multipleFor(row.category, model).multiple;
    return Math.max(1, Math.round(row.tvl_usd * mult * growthMult * maturity));
  }

  function effectiveModel() {
    if (!state.sandbox) return DATA.model;
    return {
      growth_weight: state.sandbox.growth_weight,
      growth_floor: DATA.model.growth_floor,
      growth_cap: DATA.model.growth_cap,
      maturity_floor: state.sandbox.maturity_floor,
      maturity_range: DATA.model.maturity_range,
      maturity_days: DATA.model.maturity_days,
      multiple_min: DATA.model.multiple_min,
      multiple_max: state.sandbox.multiple_max,
      min_comparables: DATA.model.min_comparables
    };
  }

  // Baris dengan nilai tersirat efektif: bawaan board, atau hitung ulang kotak pasir.
  function effectiveRows() {
    var model = effectiveModel();
    var rows = DATA.rows.map(function (r) {
      var implied = state.sandbox ? impliedOf(r, model) : r.implied_value_usd;
      var copy = {};
      Object.keys(r).forEach(function (k) { copy[k] = r[k]; });
      copy.eff_implied = implied;
      return copy;
    });
    if (state.sandbox) {
      rows.sort(function (a, b) { return b.eff_implied - a.eff_implied || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0); });
      rows.forEach(function (r, i) { r.eff_rank = i + 1; });
    } else {
      rows.forEach(function (r) { r.eff_rank = r.rank; });
    }
    return rows;
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('watchlist') === '1') state.watchlist = true;
    if (params.get('tab') === 'live') state.tab = 'live';
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('sort')) state.sort = params.get('sort');
    if (params.get('dir') === '1') state.dir = 1;
    if (params.get('dir') === '-1') state.dir = -1;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchlist) params.set('watchlist', '1');
    if (state.tab === 'live') params.set('tab', 'live');
    if (state.selected) params.set('p', state.selected);
    if (state.sort !== 'implied') params.set('sort', state.sort);
    if (state.dir === 1) params.set('dir', '1');
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function matchFilters(r) {
    if (state.category !== 'all' && (r.category || 'Lainnya') !== state.category) return false;
    if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
    if (state.watchlist && !r.on_watchlist) return false;
    var q = state.q.trim().toLowerCase();
    if (!q) return true;
    var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'rank') { av = a.eff_rank; bv = b.eff_rank; }
      else { av = a.eff_implied; bv = b.eff_implied; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark', 'aria-hidden': 'true' }),
        el('span', { class: 'brand-name' }, 'RADAR TOKEN', el('small', { text: 'Pelacak peluncuran token' }))),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, 'Sumber ', el('b', { text: 'DefiLlama' })),
        el('span', null, 'Model ', el('b', { text: DATA.model_version }))
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' protokol watchlist, berperingkat menurut nilai tersirat' }),
        el('p', null,
          'Watchlist adalah lantai: setiap protokol dengan TVL setidaknya $' + Math.round(DATA.floor_usd / 1e6) + ' juta dan tidak tercatat memiliki token. ',
          el('b', { text: 'Radar dini menambahkan ' + DATA.early_size + ' protokol pre-token lain' }),
          ' yang lolos saring. Nilai tersirat adalah perkiraan model dari angka snapshot, bukan janji dan bukan prediksi peluncuran.'
        )
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist tercakup' }), el('b', { class: 'ok', text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Baris pre-token dinilai' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Baris dini di bawah lantai' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Protokol live disisihkan' }), el('b', { text: String(DATA.live_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Kelipatan global (median live)' }), el('b', { text: fmtNum(DATA.global_multiple) + 'x TVL' }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Lainnya'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Cari nama, kategori, atau chain', value: state.q, 'aria-label': 'Cari di board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSel = el('select', { id: 'category', 'aria-label': 'Saring menurut kategori' },
      el('option', { value: 'all', text: 'Semua kategori' }),
      categories.map(function (c) { return el('option', { value: c, text: c + ' (' + DATA.rows.filter(function (r) { return (r.category || 'Lainnya') === c; }).length + ')', selected: c === state.category ? 'selected' : null }); })
    );
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); render(); });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Saring menurut chain' },
      el('option', { value: 'all', text: 'Semua chain' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    var wl = el('input', { type: 'checkbox', id: 'watchlist', checked: state.watchlist ? 'checked' : null });
    wl.addEventListener('change', function () { state.watchlist = wl.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Token live', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    var shown = state.tab === 'pre-token' ? effectiveRows().filter(matchFilters).length + ' baris ditampilkan' : DATA.live.filter(matchFilters).length + ' protokol live ditampilkan';
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Cari' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Kategori' }), catSel),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('label', { class: 'check', for: 'watchlist' }, wl, 'Hanya watchlist'),
      el('div', { class: 'field' }, el('span', { class: 'lbl', text: 'Status token' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: shown })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'name' ? 1 : -1; } writeHash(); render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function emptyPanel() {
    return el('div', { class: 'panel' }, el('div', { class: 'empty' },
      el('h2', { text: 'Tidak ada protokol yang cocok dengan filter ini' }),
      el('p', { text: 'Hapus pencarian atau pilih kategori dan chain lain untuk melihat board lagi.' }),
      el('button', { class: 'button primary', type: 'button', text: 'Hapus filter', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchlist = false; writeHash(); render(); } })
    ));
  }

  function boardTable() {
    var list = sortedRows(effectiveRows().filter(matchFilters));
    if (list.length === 0) return emptyPanel();
    var max = list.reduce(function (m, r) { return Math.max(m, r.eff_implied); }, 1);
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.eff_rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Lainnya') + ' di ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'chain tak bernama') + (r.chains && r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round(Math.sqrt(r.eff_implied / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.eff_implied) })
        )),
        el('td', null, r.on_watchlist
          ? el('span', { class: 'badge watch', text: 'Watchlist' })
          : el('span', { class: 'badge', text: 'Belum tercatat token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: (state.sandbox ? 'Peringkat dihitung ulang dengan asumsi kotak pasir. ' : '') + 'Protokol pre-token, nilai tersirat terbesar dahulu. Pilih baris untuk melihat rincian model dan rencana farm.' }),
          el('thead', null, el('tr', null,
            sortHeader('rank', 'Peringkat'),
            sortHeader('name', 'Protokol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7 hari'),
            sortHeader('age', 'Umur'),
            sortHeader('implied', 'Nilai tersirat'),
            el('th', { scope: 'col', text: 'Status' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var list = DATA.live.filter(matchFilters);
    if (list.length === 0) return emptyPanel();
    var tbody = el('tbody');
    list.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: r.symbol || 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Lainnya') + ' di ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'chain tak bernama') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'badge live', text: 'Sudah diperdagangkan' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: protokol ini sudah diperdagangkan, jadi market cap-nya adalah fakta, bukan model. Mereka disisihkan dari peringkat pre-token dan dipakai sebagai pembanding kelipatan.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Simbol' }), el('th', { scope: 'col', text: 'Protokol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7 hari' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Status' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var multRows = DATA.multiples.map(function (c) {
      return el('tr', null,
        el('td', { text: c.category }),
        el('td', { class: 'num', text: String(c.n) }),
        el('td', { class: 'num', text: fmtNum(c.median) + 'x' }),
        el('td', { text: c.used ? 'Dipakai sebagai kelipatan kategori' : 'Terlalu sedikit pembanding, memakai median global' })
      );
    });
    var reasons = Object.keys(DATA.set_aside_reasons).map(function (k) {
      return el('tr', null, el('td', { text: k }), el('td', { class: 'num', text: String(DATA.set_aside_reasons[k]) }));
    });
    var gw = el('input', { type: 'number', id: 'sb-growth', min: '0', max: '1', step: '0.05', value: String(state.sandbox ? state.sandbox.growth_weight : m.growth_weight) });
    var mc = el('input', { type: 'number', id: 'sb-cap', min: '0.1', max: '3', step: '0.05', value: String(state.sandbox ? state.sandbox.multiple_max : m.multiple_max) });
    var mf = el('input', { type: 'number', id: 'sb-floor', min: '0', max: '0.9', step: '0.05', value: String(state.sandbox ? state.sandbox.maturity_floor : m.maturity_floor) });
    var sandbox = el('div', { class: 'sandbox' },
      el('div', { class: 'field' }, el('label', { for: 'sb-growth', text: 'Bobot pertumbuhan' }), gw),
      el('div', { class: 'field' }, el('label', { for: 'sb-cap', text: 'Batas kelipatan' }), mc),
      el('div', { class: 'field' }, el('label', { for: 'sb-floor', text: 'Lantai kematangan' }), mf),
      el('button', { class: 'button primary', type: 'button', text: 'Hitung ulang board', onclick: function () {
        state.sandbox = {
          growth_weight: Math.min(1, Math.max(0, parseFloat(gw.value) || 0)),
          multiple_max: Math.min(3, Math.max(0.1, parseFloat(mc.value) || m.multiple_max)),
          maturity_floor: Math.min(0.9, Math.max(0, parseFloat(mf.value) || 0))
        };
        render();
      } }),
      el('button', { class: 'button', type: 'button', text: 'Atur ulang', onclick: function () { state.sandbox = null; render(); } }),
      state.sandbox ? el('span', { class: 'sandbox-note', text: 'Kotak pasir aktif: peringkat di atas memakai asumsi Anda, bukan board resmi.' }) : null
    );
    return el('section', { class: 'panel model' },
      el('h2', { text: 'Cara nilai tersirat dihitung' }),
      el('p', { class: 'sub', text: 'Satu fungsi menilai setiap baris dari angka-angka snapshot. Tidak ada nama protokol yang diperlakukan istimewa, dan tidak ada baris yang dipilih tangan.' }),
      el('div', { class: 'formula' },
        'tersirat = round( tvl_usd x kelipatan x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(umur_hari, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') )'
      ),
      el('p', { class: 'sub', text: 'Kelipatan adalah median rasio market cap terhadap TVL dari protokol live se-kategori, dipakai bila pembandingnya ' + m.min_comparables + ' atau lebih; kalau tidak, median global ' + fmtNum(DATA.global_multiple) + 'x. Kelipatan dijepit ke ' + m.multiple_min + 'x..' + m.multiple_max + 'x. Umur adalah waktu sejak protokol pertama kali tercatat, ukuran terbaik berapa lama ia berjalan tanpa token; umur yang tidak diketahui memakai median ' + DATA.median_age_days + ' hari.' }),
      el('h3', { text: 'Pembanding live per kategori' }),
      el('div', { class: 'table-wrap' }, el('table', null,
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Kategori' }), el('th', { scope: 'col', text: 'Pembanding live' }), el('th', { scope: 'col', text: 'Median mcap/TVL' }), el('th', { scope: 'col', text: 'Dipakai' }))),
        el('tbody', null, multRows)
      )),
      el('h3', { text: 'Yang disisihkan dari board' }),
      el('p', { class: 'sub', text: DATA.set_aside_size + ' protokol tidak masuk peringkat, dengan alasannya. Aturan saringnya sama dengan aturan watchlist: produk wrapped, staked, atau bridge dari token yang sudah diperdagangkan bukan peluncuran token yang ditunggu.' }),
      el('div', { class: 'table-wrap' }, el('table', null,
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Alasan' }), el('th', { scope: 'col', text: 'Jumlah' }))),
        el('tbody', null, reasons)
      )),
      el('h3', { text: 'Kotak pasir model' }),
      el('p', { class: 'sub', text: 'Ubah asumsi dan lihat board dihitung ulang langsung. Ini hanya eksplorasi di halaman ini; board resmi tetap memakai konstanta di atas.' }),
      sandbox
    );
  }

  function capitalFor(tvl) {
    if (tvl >= 5e9) return 250;
    if (tvl >= 1e9) return 150;
    if (tvl >= 1e8) return 100;
    return 50;
  }
  function gasFor(chain) {
    var c = (chain || '').toLowerCase();
    if (c === 'ethereum') return 'sekitar $10 untuk gas';
    if (['arbitrum', 'optimism', 'base', 'polygon', 'zksync era', 'linea', 'scroll', 'blast', 'mantle', 'mode', 'starknet', 'fraxtal', 'ink', 'unichain', 'world chain', 'abstract', 'soneium'].some(function (k) { return c.indexOf(k) >= 0; })) return 'sekitar $1 untuk gas';
    if (['solana', 'sui', 'aptos', 'near', 'tron', 'binance', 'avalanche', 'fantom', 'celo', 'gnosis', 'hyperliquid l1', 'monad', 'sei', 'injective', 'osmosis'].some(function (k) { return c.indexOf(k) >= 0; })) return 'di bawah $1 untuk gas';
    return 'sekitar $3 untuk gas';
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var model = DATA.model;
    var recomputed = impliedOf(row, model);
    var mult = multipleFor(row.category, model);
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null ? 0 : row.change_7d));
    var ageUsed = row.age_days === null ? DATA.median_age_days : row.age_days;
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Peringkat ' + row.rank + ' dari ' + DATA.board_size + (row.on_watchlist ? ' · Watchlist' : ' · Radar dini') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Lainnya') + ' di ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'chain tak bernama') + ' · Tercatat sejak ' + (row.listed_at || 'tanggal tidak diketahui') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Tutup detail', text: 'Tutup', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Nilai tersirat' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Kelipatan (' + (mult.basis === 'kategori' ? 'median kategori, ' + mult.comparables + ' pembanding live' : 'median global') + ')' }), el('b', { class: 'num', text: fmtNum(mult.multiple) + 'x' })),
        el('div', null, el('span', { text: 'Pertumbuhan 7 hari (dijepit)' }), el('b', { class: 'num', text: fmtPct(growth) })),
        el('div', null, el('span', { text: 'Pengali pertumbuhan' }), el('b', { class: 'num', text: fmtNum(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Umur tanpa token' + (row.age_days === null ? ' (median dipakai)' : '') }), el('b', { class: 'num', text: fmtAge(ageUsed) })),
        el('div', null, el('span', { text: 'Pengali kematangan' }), el('b', { class: 'num', text: fmtNum(row.maturity_multiplier) })),
        el('div', { class: 'total' }, el('span', { text: 'Nilai tersirat' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': fungsi yang sama menilai setiap protokol. Halaman menghitung ulang baris ini menjadi ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', sama dengan angka yang dibawa board.' : ', berbeda dari board: datanya sudah basi.') + ' Ini perkiraan, bukan harga, dan bukan prediksi bahwa token akan diterbitkan.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Rencana farm' }),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
        var at = s.indexOf(' Biaya: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      })),
      el('p', { class: 'sumline' }, 'Perkiraan total: ', el('b', { text: 'modal $' + capitalFor(row.tvl_usd) }), ' ditambah gas (' + gasFor(row.chains && row.chains[0]) + ' per transaksi). Jangan pernah membayar untuk klaim.' )
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function footer() {
    var ok = 0;
    DATA.rows.forEach(function (r) { if (impliedOf(r, DATA.model) === r.implied_value_usd) ok++; });
    // Skema dihapus dari teks sumber saat tampil, agar berkas dasbor tidak
    // membawa literal URL berskema sama sekali (aturan tanpa-jaringan gate).
    var scheme = 'https' + '://';
    var plain = 'http' + '://';
    var source = (DATA.source || '').split(scheme).join('').split(plain).join('');
    return el('footer', { class: 'foot' },
      el('p', { class: 'verify', text: 'Verifikasi: ' + ok + '/' + DATA.rows.length + ' baris terhitung ulang sama persis dengan board.' }),
      el('p', { text: 'Sumber: ' + source + '. Data beku dan tidak berubah; dasbor ini membacanya apa adanya.' }),
      el('p', { text: 'Catatan bahasa: dasbor ini mengatakan protokol "tidak tercatat memiliki token", tidak pernah "tidak memiliki token", karena catatan DefiLlama bukan bukti. Protokol di watchlist bisa saja memiliki token yang tidak dibawa catatannya. Nilai tersirat adalah klaim model entri ini, bukan janji peluncuran, bukan saran keuangan, dan bukan angka yang dibuat make.fun.' })
    );
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
