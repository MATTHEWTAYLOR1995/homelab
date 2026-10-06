// ============================================================
// Reveal-on-scroll: fade/slide in any element with class "reveal"
// ============================================================
(function revealOnScroll() {
  const els = document.querySelectorAll('.reveal');
  if (!els.length || !('IntersectionObserver' in window)) {
    els.forEach(el => el.classList.add('is-visible'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  els.forEach(el => io.observe(el));
})();

// ============================================================
// Auto-update fixtures results
// Polls /api/fixtures periodically and updates the results list
// ============================================================
(function fixturesAutoUpdate() {
  const resultsEl = document.getElementById('resultsList');
  const lastUpdatedEl = document.getElementById('fixturesLastUpdated');
  if (!resultsEl) return;

  function renderResultRow(f) {
    const day = new Date(f.kickoffAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    const weekday = new Date(f.kickoffAt).toLocaleDateString('en-GB', { weekday: 'short' });
    const score = (f.homeScore != null && f.awayScore != null)
      ? (f.venue === 'home' ? `${f.homeScore}-${f.awayScore}` : `${f.awayScore}-${f.homeScore}`)
      : '<span class="fixture-row__pending">Result pending</span>';
    return `
      <div class="fixture-row fixture-row--played reveal">
        <div class="fixture-row__date">
          <span class="fixture-row__day">${day}</span>
          <span class="fixture-row__weekday">${weekday}</span>
        </div>
        <span class="venue-badge venue-badge--${f.venue}">${f.venue === 'home' ? 'H' : 'A'}</span>
        <div class="fixture-row__match">
          <span class="fixture-row__opponent">${f.opponent}</span>
          <span class="fixture-row__ground">${f.ground || ''}${f.round ? ' &middot; ' + f.round : ''}</span>
        </div>
        <span class="fixture-row__comp tag ${f.competition === 'Championship' ? 'tag--champ' : f.competition === 'Friendly' ? '' : 'tag--cup'}">${f.competition}</span>
        <span class="fixture-row__score">${score}</span>
      </div>
    `;
  }

  async function fetchFixtures() {
    try {
      const res = await fetch('/api/fixtures');
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      return await res.json();
    } catch (e) {
      console.warn('Failed to fetch fixtures:', e);
      return null;
    }
  }

  let polling = false;
  async function refreshResults() {
    if (polling) return;
    polling = true;
    try {
      const data = await fetchFixtures();
      if (!data) return;
      const results = data.results || [];
      if (!results.length) {
        resultsEl.innerHTML = '<p class="news-empty">No results available.</p>';
      } else {
        resultsEl.innerHTML = results.map(renderResultRow).join('');
      }
      if (lastUpdatedEl && data.lastUpdated) lastUpdatedEl.textContent = `Fixtures last updated ${data.lastUpdated}`;
    } finally {
      polling = false;
    }
  }

  // Ensure an immediate refresh on page load (runs now or on DOMContentLoaded)
  function doInitialRefresh() {
    try { refreshResults(); } catch (e) { console.warn('Initial fixtures refresh failed', e); }
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    doInitialRefresh();
  } else {
    window.addEventListener('DOMContentLoaded', doInitialRefresh);
  }
  // expose for manual refresh via button
  window.refreshFixtures = refreshResults;
  const refreshBtn = document.getElementById('refreshFixturesBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', () => { refreshBtn.disabled = true; refreshBtn.textContent = 'Refreshing…'; refreshResults().finally(() => { refreshBtn.disabled = false; refreshBtn.textContent = 'Refresh results'; }); });
  // Poll every 60 seconds
  setInterval(refreshResults, 60 * 1000);
})();

// ============================================================
// Refresh confirmed transfers (partial-page update)
// - On the confirmed transfers page this updates the Arrivals/Departures
// - On the home page this updates the "Latest confirmed moves" list
// ============================================================
(function confirmedRefresh() {
  async function fetchConfirmed() {
    const res = await fetch('/api/confirmed');
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    return await res.json();
  }

  const pageBtn = document.getElementById('refreshConfirmedBtn');
  const homeBtn = document.getElementById('refreshLatestMovesBtn');
  if (!pageBtn && !homeBtn) return;

  function renderTicketIn(t) {
    return `
      <div class="ticket ticket--in ticket--stacked">
        <div class="ticket__top">
          <span class="ticket__dir">In</span>
          <div class="ticket__body">
            <div class="ticket__player">${t.player} <span style="font-weight:400;color:var(--ink-soft);font-size:14px;">&middot; ${t.position || ''}</span></div>
            <div class="ticket__meta">from <strong>${t.from || ''}</strong> &middot; ${t.date || ''} &middot; ${t.window || ''}</div>
          </div>
          <div class="ticket__fee">${t.fee || ''}</div>
        </div>
        <p class="ticket__note">${t.note || ''}</p>
      </div>
    `;
  }

  function renderTicketOut(t) {
    return `
      <div class="ticket ticket--out ticket--stacked">
        <div class="ticket__top">
          <span class="ticket__dir">Out</span>
          <div class="ticket__body">
            <div class="ticket__player">${t.player} <span style="font-weight:400;color:var(--ink-soft);font-size:14px;">&middot; ${t.position || ''}</span></div>
            <div class="ticket__meta">to <strong>${t.to || ''}</strong> &middot; ${t.date || ''} &middot; ${t.window || ''}</div>
          </div>
          <div class="ticket__fee">${t.fee || ''}</div>
        </div>
        <p class="ticket__note">${t.note || ''}</p>
      </div>
    `;
  }

  async function updateConfirmedParts() {
    try {
      const data = await fetchConfirmed();

      // Filter out women's-team signings and sort newest-first
      const arrivals = (data.in || []).filter(i => i.team !== 'women')
        .slice().sort((a, b) => new Date(b.date) - new Date(a.date));
      const departures = (data.out || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date));

      // Replace Arrivals: find first .card-list that previously had ticket--in
      const allCardLists = Array.from(document.querySelectorAll('.card-list'));
      for (const cl of allCardLists) {
        if (cl.querySelector('.ticket--in')) {
          cl.innerHTML = arrivals.map(renderTicketIn).join('') || '<p class="news-empty">No arrivals recorded.</p>';
          break;
        }
      }

      // Replace Departures: find first .card-list that previously had ticket--out
      for (const cl of allCardLists) {
        if (cl.querySelector('.ticket--out')) {
          cl.innerHTML = departures.map(renderTicketOut).join('') || '<p class="news-empty">No departures recorded.</p>';
          break;
        }
      }

      // Update all visible 'Last updated' paragraphs
      const lastEls = Array.from(document.querySelectorAll('.wrap p'));
      for (const p of lastEls) {
        if (/Last updated/.test(p.textContent)) {
          p.textContent = `Last updated ${data.lastUpdated || ''}`;
        }
      }

      // Update home page latest moves area if present (latest-first, top of list)
      const latestArea = document.querySelector('.home-grid');
      if (latestArea) {
        const ticketContainer = latestArea.querySelector('.card-list');
        if (ticketContainer) {
          const latestIn = arrivals.slice(0, 3);
          const latestOut = departures.slice(0, 3);
          ticketContainer.innerHTML = '';
          latestIn.forEach(t => ticketContainer.insertAdjacentHTML('beforeend', `
            <div class="ticket ticket--in reveal">
              <span class="ticket__dir">In</span>
              <div class="ticket__body">
                <div class="ticket__player">${t.player}</div>
                <div class="ticket__meta">from ${t.from} &middot; ${t.date}</div>
              </div>
              <div class="ticket__fee">${t.fee}</div>
            </div>
          `));
          latestOut.forEach(t => ticketContainer.insertAdjacentHTML('beforeend', `
            <div class="ticket ticket--out reveal">
              <span class="ticket__dir">Out</span>
              <div class="ticket__body">
                <div class="ticket__player">${t.player}</div>
                <div class="ticket__meta">to ${t.to} &middot; ${t.date}</div>
              </div>
              <div class="ticket__fee">${t.fee}</div>
            </div>
          `));
        }
      }

    } catch (err) {
      console.error('Failed to refresh confirmed transfers:', err);
      alert("Couldn't refresh confirmed transfers — see console for details.");
    }
  }

  // expose so other modules (news check) can refresh confirmed parts
  window.updateConfirmedParts = updateConfirmedParts;

  if (pageBtn) pageBtn.addEventListener('click', () => {
    pageBtn.disabled = true;
    const old = pageBtn.textContent;
    pageBtn.textContent = 'Refreshing…';
    updateConfirmedParts().finally(() => { pageBtn.disabled = false; pageBtn.textContent = old; });
  });

  if (homeBtn) homeBtn.addEventListener('click', () => {
    homeBtn.disabled = true;
    const old = homeBtn.textContent;
    homeBtn.textContent = 'Refreshing…';
    updateConfirmedParts().finally(() => { homeBtn.disabled = false; homeBtn.textContent = old; });
  });
})();

// ============================================================
// Scroll-driven era story (homepage): as each panel scrolls
// into view, crossfade the sticky background behind it.
// ============================================================
(function eraStory() {
  const panels = document.querySelectorAll('.story__panel');
  if (!panels.length || !('IntersectionObserver' in window)) return;

  const bgs = document.querySelectorAll('.story__bg');
  const labels = document.querySelectorAll('.story__era-label');
  const headlines = document.querySelectorAll('.story__headline');

  function activate(era) {
    bgs.forEach(bg => bg.classList.toggle('is-active', bg.dataset.era === era));
    labels.forEach(l => l.classList.toggle('is-active', l.dataset.era === era));
    headlines.forEach(h => h.classList.toggle('is-active', h.dataset.era === era));
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        activate(entry.target.dataset.era);
      }
    });
  }, { threshold: 0.5 });

  panels.forEach(p => io.observe(p));
  // Activate the first era immediately so the stage isn't blank on load.
  if (panels[0]) activate(panels[0].dataset.era);
})();

// ============================================================
// Live news check: pulls real, current Charlton headlines from
// the web on demand (via the server's /api/news endpoint) and
// lists them for the reader to check against a source themselves.
// This never writes to the site's data files automatically —
// it's a research aid, not an auto-updater.
// ============================================================
(function liveNewsCheck() {
  const btn = document.getElementById('checkNewsBtn');
  if (!btn) return;

  const resultsEl = document.getElementById('newsResults');
  const statusEl = document.getElementById('newsStatus');
  const filterType = btn.dataset.filter || 'all'; // 'all' | 'confirmed' | 'rumour'
  const filterSource = btn.dataset.source || 'google';

  function renderItems(items) {
    if (!items.length) {
      resultsEl.innerHTML = '<p class="news-empty">No fresh headlines matched right now — try again in a bit.</p>';
      return;
    }
    resultsEl.innerHTML = items.map(item => `
      <a class="news-item" href="${item.link}" target="_blank" rel="noopener noreferrer">
        <span class="news-item__badge news-item__badge--${item.guess}">${item.guess === 'confirmed' ? 'Sounds confirmed' : item.guess === 'rumour' ? 'Sounds like gossip' : 'Unclear'}</span>
        <span class="news-item__title">${item.title}</span>
        <span class="news-item__meta">${item.source || 'Unknown source'} &middot; ${item.age || ''}</span>
      </a>
    `).join('');
  }

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const originalLabel = btn.textContent;
    btn.textContent = 'Checking the web…';
    statusEl.textContent = '';
    resultsEl.innerHTML = '<p class="news-empty">Searching for the latest Charlton stories…</p>';

    try {
      const res = await fetch(`/api/news?type=${encodeURIComponent(filterType)}&source=${encodeURIComponent(filterSource)}`);
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      const data = await res.json();

      if (data.error) {
        statusEl.textContent = data.error;
        resultsEl.innerHTML = '';
      } else {
        // ensure newest-first ordering by pubDate when available
        const items = (data.items || []).slice().sort((a, b) => {
          const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
          const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
          return db - da;
        });
        renderItems(items);
        statusEl.textContent = `Checked just now — ${items.length} headline${items.length === 1 ? '' : 's'} found. This list refreshes only when you press the button.`;
        // Also refresh confirmed transfers/arrivals so the whole page shows latest data
        if (window.updateConfirmedParts) {
          try { window.updateConfirmedParts(); } catch (e) { console.warn('updateConfirmedParts failed', e); }
        }
        // Also fetch a larger batch of gossip from multiple sources and
        // populate the stacked `#rumoursList` block (news items first,
        // then stored rumours from the server).
        try {
          const list = document.getElementById('rumoursList');
          if (list) {
            // Fetch combined news items (Google + NewsNow)
            const extraRes = await fetch('/api/news?type=rumour&source=both');
            if (extraRes && extraRes.ok) {
              const extraJson = await extraRes.json();
              list.innerHTML = (extraJson.items || []).map(it => `
                <div class="rumour">
                  <div class="rumour__head">
                    <div>
                      <div class="rumour__player"><a href="${it.link}" target="_blank" rel="noopener noreferrer">${it.title}</a></div>
                      <div class="rumour__club">${it.source || ''}</div>
                    </div>
                    <span class="rumour__dir">${it.guess || ''}</span>
                  </div>
                  <p class="rumour__summary">${it.age || ''}</p>
                </div>
              `).join('');
            }

            // Then append stored rumours from the site's `data/transfers-rumours.json`
            try {
              const rumRes = await fetch('/api/rumours');
              if (rumRes && rumRes.ok) {
                const rumJson = await rumRes.json();
                const stored = (rumJson.rumours || []).map(r => `
                  <div class="rumour">
                    <div class="rumour__head">
                      <div>
                        <div class="rumour__player">${r.player}</div>
                        <div class="rumour__club">${r.position || ''} &middot; ${r.direction === 'in' ? 'from' : 'to'} ${r.club || ''}</div>
                      </div>
                      <span class="rumour__dir">${r.direction || ''}</span>
                    </div>
                    <div class="heat">
                      <span class="heat__label">Heat</span>
                      <span class="heat__dots">${[1,2,3,4,5].map(i => `<span class="heat__dot ${i <= (r.heat||0) ? 'is-lit' : ''}"></span>`).join('')}</span>
                    </div>
                    <p class="rumour__summary">${r.summary || ''}</p>
                    <div class="rumour__source">
                      <span>${r.source || ''}</span>
                      <span>${r.date || ''}</span>
                    </div>
                  </div>
                `).join('');
                list.insertAdjacentHTML('beforeend', stored);
              }
            } catch (e) { console.warn('Failed to append stored rumours', e); }
          }
        } catch (e) {
          console.warn('Failed to refresh rumours:', e);
        }
      }
    } catch (err) {
      statusEl.textContent = "Couldn't reach the web from here — the site's network access may be restricted. Try again, or check the club's official site directly.";
      resultsEl.innerHTML = '';
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  });

  // Prune confirmed workflow
  const pruneBtn = document.getElementById('pruneConfirmedBtn');
  const prunePreview = document.getElementById('prunePreview');
  const pruneList = document.getElementById('pruneList');
  const confirmPruneBtn = document.getElementById('confirmPruneBtn');
  const cancelPruneBtn = document.getElementById('cancelPruneBtn');

  async function showPrunePreview() {
    prunePreview.style.display = 'block';
    pruneList.innerHTML = '<p class="news-empty">Checking for confirmed matches…</p>';
    try {
      const res = await fetch('/api/rumours/prune-preview');
      if (!res.ok) throw new Error('Preview failed');
      const json = await res.json();
      if (!json.matches || !json.matches.length) {
        pruneList.innerHTML = '<p class="news-empty">No rumours match confirmed transfers.</p>';
        return;
      }
      pruneList.innerHTML = json.matches.map(m => `
        <label style="display:block;margin-bottom:6px;"><input type="checkbox" data-player="${m.player}" checked> <strong>${m.player}</strong> — ${m.summary || ''} <span style="color:var(--ink-soft);">(${m.date || ''})</span></label>
      `).join('');
    } catch (e) {
      pruneList.innerHTML = '<p class="news-empty">Preview failed — see console.</p>';
      console.error(e);
    }
  }

  if (pruneBtn) pruneBtn.addEventListener('click', () => { showPrunePreview(); });
  if (cancelPruneBtn) cancelPruneBtn.addEventListener('click', () => { prunePreview.style.display = 'none'; pruneList.innerHTML = ''; });

  if (confirmPruneBtn) confirmPruneBtn.addEventListener('click', async () => {
    const checks = Array.from(pruneList.querySelectorAll('input[type=checkbox]'));
    const toRemove = checks.filter(c => c.checked).map(c => c.dataset.player);
    if (!toRemove.length) return alert('No rumours selected to prune.');
    if (!confirm(`Remove ${toRemove.length} rumour(s) that match confirmed transfers? This cannot be undone.`)) return;
    try {
      const res = await fetch('/api/rumours/prune', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ players: toRemove }) });
      if (!res.ok) throw new Error('Prune failed');
      const json = await res.json();
      alert(`Pruned ${json.removed || 0} rumour(s).`);
      prunePreview.style.display = 'none'; pruneList.innerHTML = '';
      // Refresh the rumours grid
      try {
        const rumRes = await fetch('/api/rumours');
        if (rumRes.ok) {
          const rumJson = await rumRes.json();
          const list = document.getElementById('rumoursList');
          if (list) {
            list.innerHTML = (rumJson.rumours || []).map(r => `
              <div class="rumour">
                <div class="rumour__head">
                  <div>
                    <div class="rumour__player">${r.player}</div>
                    <div class="rumour__club">${r.position || ''} &middot; ${r.direction === 'in' ? 'from' : 'to'} ${r.club || ''}</div>
                  </div>
                  <span class="rumour__dir">${r.direction || ''}</span>
                </div>
                <div class="heat">
                  <span class="heat__label">Heat</span>
                  <span class="heat__dots">${[1,2,3,4,5].map(i => `<span class="heat__dot ${i <= (r.heat||0) ? 'is-lit' : ''}"></span>`).join('')}</span>
                </div>
                <p class="rumour__summary">${r.summary || ''}</p>
                <div class="rumour__source">
                  <span>${r.source || ''}</span>
                  <span>${r.date || ''}</span>
                </div>
              </div>
            `).join('');
          }
        }
      } catch(e){console.warn('refresh after prune failed', e);}    
    } catch (e) {
      console.error(e);
      alert('Prune failed — see console.');
    }
  });
})();
