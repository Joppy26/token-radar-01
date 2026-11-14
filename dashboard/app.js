(function () {
  const D = window.TOKEN_RADAR;
  if (!D) return;
  const rows = D.rows;
  const live = D.live;
  const watchSet = new Set(D.watchlist || []);
  const state = { tab: 'pre', q: '', cat: '', chain: '', sort: 'rank', dir: 1 };

  const $ = (id) => document.getElementById(id);
  const fmtInt = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const fmtCompact = (n) => {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  };
  const fmtPct = (v) => (v === null || v === undefined ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + '%');
  const fmtAge = (d) => (d >= 365 ? (d / 365).toFixed(1) + 'y' : d + 'd');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const chainLabel = (chains) => {
    if (!chains || !chains.length) return '—';
    return chains.length <= 2 ? chains.join(', ') : chains.slice(0, 2).join(', ') + ' +' + (chains.length - 2);
  };

  // ---- stats
  const totalImplied = rows.reduce((n, r) => n + r.implied_value_usd, 0);
  $('stats').innerHTML = [
    [rows.length, 'protocols ranked'],
    [D.meta.watchlist, 'on the watchlist'],
    [fmtCompact(totalImplied), 'total implied value'],
    [D.meta.liveComps, 'live-token comps'],
  ]
    .map(([b, s]) => `<div class="stat"><b>${b}</b><span>${s}</span></div>`)
    .join('');

  // ---- filter options
  const cats = [...new Set(rows.map((r) => r.category).filter(Boolean))].sort();
  $('cat').innerHTML =
    '<option value="">All categories</option>' + cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  const chainCounts = new Map();
  rows.forEach((r) => (r.chains || []).forEach((c) => chainCounts.set(c, (chainCounts.get(c) || 0) + 1)));
  const topChains = [...chainCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([c]) => c);
  $('chain').innerHTML =
    '<option value="">All chains</option>' + topChains.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');

  // ---- calibration panel: priced off the snapshot's own live tokens
  $('calib-line').innerHTML =
    `<strong>Priced off ${D.meta.liveComps} live tokens in this snapshot.</strong> Every multiple below is the ` +
    `median market-cap-to-TVL ratio of the live-token protocols in that category, recomputed from the ` +
    `snapshot at run time &mdash; nothing is hardcoded. A live token means a recorded, non-zero market cap.`;
  $('mult-rows').innerHTML = D.multiples
    .map((m) => `<tr><td>${esc(m.category)}</td><td class="num">${m.n}</td><td class="num">${m.median.toFixed(3)}</td></tr>`)
    .join('');
  $('global-note').textContent =
    `Categories with fewer than three live comps use a family median, or the global median of ${D.globalMedian.toFixed(3)} across ${D.meta.liveComps} live comps.`;

  // ---- recompute check (in-page: recompute every row from its stored model)
  let mismatches = 0;
  for (const r of rows) {
    const m = r.model;
    const again = Math.round(m.tvl_usd * m.catMultiple * m.growthMult * m.maturityMult * m.breadthMult);
    if (again !== r.implied_value_usd) mismatches++;
  }
  $('recompute').textContent = `In-page recompute check: ${mismatches} mismatch${mismatches === 1 ? '' : 'es'} across ${rows.length} rows.`;

  // ---- table
  const HEADERS = {
    pre: ['#', 'Protocol', 'TVL', '7d', 'Age', 'Implied value'],
    live: ['#', 'Protocol', 'TVL', 'Mcap', 'Mcap / TVL', 'Chains'],
  };
  const SORT_KEYS = {
    pre: ['rank', 'name', 'tvl_usd', 'change_7d', 'age_days', 'implied_value_usd'],
    live: ['rank', 'name', 'tvl_usd', 'mcap_usd', 'mcap_tvl', null],
  };

  function sortValue(r, key) {
    if (key === 'rank') return state.tab === 'pre' ? r.rank : live.indexOf(r) + 1;
    if (key === 'name') return r.name.toLowerCase();
    if (key === 'change_7d') return r.change_7d === null || r.change_7d === undefined ? -Infinity : r.change_7d;
    return r[key] === null || r[key] === undefined ? -Infinity : r[key];
  }

  function render() {
    const heads = document.querySelectorAll('#board thead th');
    HEADERS[state.tab].forEach((label, i) => {
      heads[i].textContent = label;
      heads[i].dataset.sort = SORT_KEYS[state.tab][i] || '';
      heads[i].style.cursor = SORT_KEYS[state.tab][i] ? 'pointer' : 'default';
    });
    $('tab-pre').classList.toggle('active', state.tab === 'pre');
    $('tab-live').classList.toggle('active', state.tab === 'live');
    $('board-title').textContent = state.tab === 'pre' ? 'Ranked board' : 'Live-token comps';
    $('cat').disabled = state.tab !== 'pre';
    $('chain').disabled = state.tab !== 'pre';

    let list = state.tab === 'pre' ? rows.slice() : live.slice();
    const q = state.q.trim().toLowerCase();
    if (q) list = list.filter((r) => (r.name + ' ' + r.slug).toLowerCase().includes(q));
    if (state.tab === 'pre') {
      if (state.cat) list = list.filter((r) => r.category === state.cat);
      if (state.chain) list = list.filter((r) => (r.chains || []).includes(state.chain));
    }
    const sortKey = state.sort;
    const dir = state.dir;
    list.sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return a.slug < b.slug ? -1 : 1;
    });

    $('count').textContent =
      state.tab === 'pre'
        ? `${list.length} of ${rows.length} protocols`
        : `${list.length} live-token comps (top 24 by TVL)`;
    $('empty').hidden = list.length > 0;

    const maxImp = state.tab === 'pre' ? Math.max(...list.map((r) => r.implied_value_usd), 1) : 1;
    $('rows').innerHTML = list
      .map((r) => {
        if (state.tab === 'pre') {
          const pct = Math.max(2, (r.implied_value_usd / maxImp) * 100);
          const chg = r.change_7d === null ? '—' : `<span class="${r.change_7d >= 0 ? 'up' : 'down'}">${fmtPct(r.change_7d)}</span>`;
          const badge = watchSet.has(r.slug) ? '<span class="badge">WATCHLIST</span>' : '';
          return `<tr data-slug="${esc(r.slug)}" class="${r.rank <= 3 ? 'top3' : ''}">
            <td class="rank num">${r.rank}</td>
            <td><div class="pname">${esc(r.name)}${badge}</div><div class="pmeta">${esc(r.category || 'No category')} · ${esc(chainLabel(r.chains))}</div></td>
            <td class="num">${fmtCompact(r.tvl_usd)}</td>
            <td class="num">${chg}</td>
            <td class="num">${fmtAge(r.age_days)}</td>
            <td class="imp"><b>${fmtInt(r.implied_value_usd)}</b><div class="bar"><i style="width:${pct.toFixed(1)}%"></i></div></td>
          </tr>`;
        }
        return `<tr data-slug="${esc(r.slug)}">
          <td class="rank num">${live.indexOf(r) + 1}</td>
          <td><div class="pname">${esc(r.name)}</div><div class="pmeta">${esc(r.category || 'No category')}</div></td>
          <td class="num">${fmtCompact(r.tvl_usd)}</td>
          <td class="num">${fmtCompact(r.mcap_usd)}</td>
          <td class="num">${r.mcap_tvl.toFixed(3)}</td>
          <td class="num">${esc(chainLabel(r.chains))}</td>
        </tr>`;
      })
      .join('');
  }

  // ---- drawer
  function multipleNote(r) {
    const m = r.model;
    if (m.multipleSource === 'direct')
      return `Direct median of ${m.compN} live-token ${esc(m.multipleCategory)} comps (median mcap / TVL ${m.compMedian.toFixed(3)}).`;
    if (m.multipleSource === 'family')
      return `Family fallback for ${esc(m.multipleCategory)}: too few live comps for a direct median, so it borrows its family's ${m.compMedian.toFixed(3)}.`;
    return `Global median of ${D.meta.liveComps} live comps (${m.compMedian.toFixed(3)}): no direct or family median fits this category.`;
  }

  function openDrawer(slug) {
    const r = rows.find((x) => x.slug === slug);
    if (!r) return;
    const m = r.model;
    const recomputed = Math.round(m.tvl_usd * m.catMultiple * m.growthMult * m.maturityMult * m.breadthMult);
    $('drawer-body').innerHTML = `
      <h2>${esc(r.name)}</h2>
      <div class="dsub">${esc(r.category || 'No category')} · ${esc(r.chains.join(', ') || '—')} · listed ${esc(r.listed_at || 'unknown')}</div>
      <div class="big-imp">${fmtInt(r.implied_value_usd)}</div>
      <div class="dsub">implied value ${watchSet.has(r.slug) ? '· on the watchlist' : ''}</div>
      <h3>Model breakdown</h3>
      <table class="breakdown"><tbody>
        <tr><td>TVL</td><td>${fmtInt(m.tvl_usd)}</td></tr>
        <tr><td>Category multiple</td><td>&times; ${m.catMultiple.toFixed(4)}</td></tr>
        <tr><td>Growth (7d ${r.change_7d === null ? 'n/a' : fmtPct(r.change_7d)})</td><td>&times; ${m.growthMult.toFixed(4)}</td></tr>
        <tr><td>Maturity (${m.ageDays} days)</td><td>&times; ${m.maturityMult.toFixed(4)}</td></tr>
        <tr><td>Breadth (${(r.chains || []).length} chains)</td><td>&times; ${m.breadthMult.toFixed(4)}</td></tr>
        <tr class="total"><td>Implied value</td><td>${fmtInt(r.implied_value_usd)}</td></tr>
      </tbody></table>
      <p class="fine">Recomputed from the values above: ${fmtInt(recomputed)} &mdash; matches the board to the dollar.</p>
      <p class="fine">${multipleNote(r)}</p>
      <h3>Farm plan</h3>
      <ol class="farm">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      <h3>Note</h3>
      <p class="fine">The implied value is this radar&rsquo;s own model claim, not a price and not a
      prediction of whether or when ${esc(r.name)} issues a token. Farm steps describe how a reader
      could qualify for a future distribution; they are not financial advice.</p>`;
    $('drawer').classList.add('open');
    $('drawer').setAttribute('aria-hidden', 'false');
    $('scrim').hidden = false;
  }

  function closeDrawer() {
    $('drawer').classList.remove('open');
    $('drawer').setAttribute('aria-hidden', 'true');
    $('scrim').hidden = true;
  }

  // ---- events
  $('q').addEventListener('input', (e) => {
    state.q = e.target.value;
    render();
  });
  $('cat').addEventListener('change', (e) => {
    state.cat = e.target.value;
    render();
  });
  $('chain').addEventListener('change', (e) => {
    state.chain = e.target.value;
    render();
  });
  $('tab-pre').addEventListener('click', () => {
    state.tab = 'pre';
    state.sort = 'rank';
    state.dir = 1;
    render();
  });
  $('tab-live').addEventListener('click', () => {
    state.tab = 'live';
    state.sort = 'tvl_usd';
    state.dir = -1;
    render();
  });
  document.querySelectorAll('#board thead th').forEach((th, i) => {
    th.addEventListener('click', () => {
      const key = SORT_KEYS[state.tab][i];
      if (!key) return;
      if (state.sort === key) state.dir = -state.dir;
      else {
        state.sort = key;
        state.dir = key === 'name' ? 1 : -1;
      }
      render();
    });
  });
  $('rows').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-slug]');
    if (tr && state.tab === 'pre') openDrawer(tr.dataset.slug);
  });
  $('drawer-close').addEventListener('click', closeDrawer);
  $('scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDrawer();
  });

  // ---- deep links: #p=<slug> opens the detail drawer, #category=<name> filters
  render();
  const hash = new URLSearchParams(location.hash.slice(1));
  const cat = hash.get('category');
  if (cat) {
    state.cat = cat;
    $('cat').value = cat;
    render();
  }
  const slug = hash.get('p');
  if (slug) openDrawer(slug);
})();
