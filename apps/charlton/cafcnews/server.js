const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// Read JSON fresh on every request so editing the /data files updates the
// site immediately -- no rebuild needed. Keeps this genuinely "dynamic"
// for a solo site owner running it out of a Docker container.
function readJSON(file) {
  const raw = fs.readFileSync(path.join(__dirname, 'data', file), 'utf-8');
  return JSON.parse(raw);
}

const SITE = {
  name: "DA3's Charlton News",
  club: 'Charlton Athletic',
  tagline: 'Valley, Floyd Road.'
};

// Provide an asset version (based on main.js mtime) for cache-busting in templates
try {
  const mainJsPath = path.join(__dirname, 'public', 'js', 'main.js');
  if (fs.existsSync(mainJsPath)) {
    app.locals.assetVersion = fs.statSync(mainJsPath).mtime.getTime();
  } else {
    app.locals.assetVersion = Date.now();
  }
} catch (e) {
  app.locals.assetVersion = Date.now();
}

app.get('/', (req, res) => {
  const seasons = readJSON('seasons.json');
  const confirmed = readJSON('transfers-confirmed.json');
  const rumours = readJSON('transfers-rumours.json');
  const currentSeason = seasons[seasons.length - 1];

  // Filter out women's-team signings from arrivals and sort latest-first
  const confirmedInFiltered = (confirmed.in || []).filter(i => i.team !== 'women')
    .slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  const confirmedOutSorted = (confirmed.out || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date));

  res.render('home', {
    site: SITE,
    active: 'home',
    currentSeason,
    latestIn: confirmedInFiltered.slice(0, 3),
    latestOut: confirmedOutSorted.slice(0, 3),
    topRumours: [...rumours.rumours].sort((a, b) => b.heat - a.heat).slice(0, 4)
  });
});

app.get('/transfers/confirmed', (req, res) => {
  const data = readJSON('transfers-confirmed.json');
  // Provide filtered and sorted lists to the view (men's arrivals only, newest first)
  const inList = (data.in || []).filter(i => i.team !== 'women')
    .slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  const outList = (data.out || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date));

  res.render('transfers-confirmed', {
    site: SITE,
    active: 'confirmed',
    data,
    inList,
    outList
  });
});

app.get('/transfers/rumours', (req, res) => {
  const data = readJSON('transfers-rumours.json');
  // Sort rumours newest-first by date, then by heat as a secondary key
  const sorted = [...data.rumours].slice().sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0;
    const db = b.date ? new Date(b.date).getTime() : 0;
    if (db !== da) return db - da;
    return (b.heat || 0) - (a.heat || 0);
  });
  res.render('transfers-rumours', {
    site: SITE,
    active: 'rumours',
    data,
    rumours: sorted
  });
});

app.get('/seasons', (req, res) => {
  const seasons = readJSON('seasons.json').slice().reverse(); // newest first
  const tierFilter = req.query.tier || 'all';
  const filtered = tierFilter === 'all'
    ? seasons
    : seasons.filter(s => String(s.tier) === tierFilter);

  const stats = {
    totalSeasons: seasons.length,
    promotions: seasons.filter(s => s.promoted).length,
    relegations: seasons.filter(s => s.relegated).length,
    faCupWins: seasons.filter(s => s.faCupWon).length,
    topFlightSeasons: seasons.filter(s => s.tier === 1).length
  };

  res.render('seasons', {
    site: SITE,
    active: 'seasons',
    seasons: filtered,
    tierFilter,
    stats
  });
});

app.get('/facts', (req, res) => {
  const data = readJSON('facts.json');
  const totalFacts = data.categories.reduce((sum, c) => sum + c.facts.length, 0);
  res.render('facts', {
    site: SITE,
    active: 'facts',
    data,
    totalFacts
  });
});

// ============================================================
// Live news check — /api/news
//
// Pulls real, current headlines from Google News' public RSS
// search feed (no API key required) and does a rough keyword-based
// guess at whether each one sounds like a confirmed deal or gossip.
// It NEVER writes to the site's data files: it's a research aid for
// whoever maintains the site, not an auto-updater. Results are
// cached briefly in memory so mashing the refresh button doesn't
// hammer Google News.
// ============================================================

const NEWS_CACHE = new Map(); // key -> { at, items }
const NEWS_CACHE_TTL_MS = 4 * 60 * 1000; // 4 minutes

const CONFIRMED_HINTS = [
  'sign', 'signs', 'signing', 'signed', 'complete', 'completes', 'completed',
  'official', 'confirm', 'confirmed', 'confirms', 'announce', 'announced',
  'unveil', 'unveiled', 'joins', 'joined', 'seals move', 'agree deal', 'agreed deal'
];
const RUMOUR_HINTS = [
  'linked', 'target', 'targeting', 'interested', 'interest in', 'eyeing', 'eyes move',
  'monitoring', 'keeping tabs', 'weighing up', 'considering', 'reportedly', 'rumour',
  'rumor', 'gossip', 'could move', 'want to sign', 'chasing', 'in the hunt', 'race for'
];

function classifyHeadline(title) {
  const lower = title.toLowerCase();
  const isConfirmed = CONFIRMED_HINTS.some(w => lower.includes(w));
  const isRumour = RUMOUR_HINTS.some(w => lower.includes(w));
  if (isConfirmed && !isRumour) return 'confirmed';
  if (isRumour && !isConfirmed) return 'rumour';
  return 'unclear';
}

function decodeEntities(str) {
  return str
    .replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .trim();
}

function timeAgo(pubDate) {
  const then = new Date(pubDate).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function parseRssItems(xml) {
  const items = [];
  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const block of itemBlocks) {
    const title = (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
    const link = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1];
    const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1];
    const source = (block.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1];
    if (!title || !link) continue;
    items.push({
      title: decodeEntities(title),
      link: decodeEntities(link),
      source: source ? decodeEntities(source) : null,
      pubDate: pubDate || null
    });
  }
  return items;
}

async function fetchCharltonNews() {
  const query = encodeURIComponent('"Charlton Athletic" transfer OR signing OR loan OR deal');
  const url = `https://news.google.com/rss/search?q=${query}&hl=en-GB&gl=GB&ceid=GB:en`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DA3sCharltonNews/1.0)' },
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`Feed responded ${res.status}`);
    const xml = await res.text();
    let rawItems = parseRssItems(xml).slice(0, 50);
    // sort newest-first by pubDate when available
    rawItems = rawItems.sort((a, b) => {
      const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
      const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
      return db - da;
    }).slice(0, 20);
    return rawItems.map(it => ({
      title: it.title,
      link: it.link,
      source: it.source,
      pubDate: it.pubDate || null,
      age: it.pubDate ? timeAgo(it.pubDate) : '',
      guess: classifyHeadline(it.title)
    }));
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchNewsNow() {
  // NewsNow club page for Charlton Athletic (championship)
  const url = 'https://www.newsnow.co.uk/h/Sport/Football/Championship/Charlton+Athletic';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DA3sCharltonNews/1.0)' }, signal: controller.signal });
    if (!res.ok) throw new Error(`NewsNow responded ${res.status}`);
    const html = await res.text();

    // extract NewsNow aggregated article links (they use c.newsnow.co.uk/A/...) and titles
    const items = [];
    const seen = new Set();
    const re = /<a[^>]*href="(https?:\/\/c\.newsnow\.co\.uk\/A\/[^"]+)"[^>]*>([^<]+)<\/a>/gi;
    let m;
    while ((m = re.exec(html)) && items.length < 40) {
      const link = m[1];
      const title = m[2].replace(/\s+/g, ' ').trim();
      if (!title) continue;
      // skip women's-team items
      if (/women|women's|frauen/i.test(title)) continue;
      const key = title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ title, link, source: null, pubDate: null });
    }

    // classify and return newest-first (page already lists newest first)
    return items.map(it => ({ title: it.title, link: it.link, source: it.source, pubDate: it.pubDate, age: '', guess: classifyHeadline(it.title) }));
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTransferFeed() {
  // TransferFeed lists club-specific transfer news. We'll grab recent
  // items (title + link) from the Charlton club page and return them
  // in the same shape as other news fetchers.
  const url = 'https://www.transferfeed.com/clubs/charlton-athletic/4';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DA3sCharltonNews/1.0)' }, signal: controller.signal });
    if (!res.ok) throw new Error('TransferFeed responded ' + res.status);
    const html = await res.text();
    const cheerio = require('cheerio');
    const $ = cheerio.load(html);

    const items = [];
    const seen = new Set();

    // TransferFeed uses links for each news item — pick anchors under
    // list areas. Be permissive: collect anchors that contain '/news/' or
    // that look like item blocks, dedupe by title.
    $('a').each((i, a) => {
      if (items.length >= 60) return;
      const href = $(a).attr('href') || '';
      const txt = $(a).text().replace(/\s+/g, ' ').trim();
      if (!txt) return;
      // prefer items that link to transferfeed news pages or contain 'transfer' keywords
      if (href.includes('/news/') || /transfer|linked|sign|rumour|loan|deal|interest/i.test(txt)) {
        const link = href.startsWith('http') ? href : `https://www.transferfeed.com${href}`;
        const key = txt.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        items.push({ title: txt, link, source: 'TransferFeed', pubDate: null });
      }
    });

    // fallback: if nothing found by anchors, try specific list items
    if (!items.length) {
      $('.list-group a, .news-list a').each((i, a) => {
        if (items.length >= 60) return;
        const href = $(a).attr('href') || '';
        const txt = $(a).text().replace(/\s+/g, ' ').trim();
        if (!txt) return;
        const link = href.startsWith('http') ? href : `https://www.transferfeed.com${href}`;
        const key = txt.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        items.push({ title: txt, link, source: 'TransferFeed', pubDate: null });
      });
    }

    return items.slice(0, 40).map(it => ({ title: it.title, link: it.link, source: it.source, pubDate: it.pubDate, age: '', guess: classifyHeadline(it.title) }));
  } finally {
    clearTimeout(timeout);
  }
}

function guessHeatFromTitle(title) {
  const t = (title || '').toLowerCase();
  if (!t) return 1;
  const strong = [/\bclose to\b/, /\bset to join\b/, /\bseals?\b/, /\bofficial\b/, /\bsigns? for\b/, /\bjoins?\b/];
  const mediumStrong = [/\bin talks?\b/, /\bnearing\b/, /\bexpected to join\b/, /\bmove to\b/];
  const medium = [/\blinked\b/, /\btarget\b/, /\btargeting\b/, /\binterested\b/, /\bpursuing\b/];
  const soft = [/\breportedly\b/, /\brumour\b/, /\bgossip\b/, /\blinked with\b/];
  if (strong.some(r => r.test(t))) return 5;
  if (mediumStrong.some(r => r.test(t))) return 4;
  if (medium.some(r => r.test(t))) return 3;
  if (soft.some(r => r.test(t))) return 2;
  return 1;
}

function extractPlayerNameFromTitle(title) {
  if (!title) return null;
  // Try to capture sequences of capitalised words likely to be a player's name
  const m = title.match(/([A-Z][a-zA-Z'’\-]+(?:\s+[A-Z][a-zA-Z'’\-]+){0,2})/g);
  if (!m || !m.length) return null;
  // Prefer longer matches (more words)
  m.sort((a,b) => b.length - a.length);
  return m[0];
}

// Preview transferfeed import candidates (auto-guess heat + player)
app.get('/api/rumours/import-preview', async (req, res) => {
  const source = req.query.source || 'transferfeed';
  try {
    let items = [];
    if (source === 'transferfeed') items = await fetchTransferFeed();
    else return res.status(400).json({ error: 'Unsupported source' });

    const candidates = (items || []).map(it => {
      const heat = guessHeatFromTitle(it.title || '');
      const player = extractPlayerNameFromTitle(it.title) || it.title;
      return {
        title: it.title,
        link: it.link || null,
        source: it.source || 'TransferFeed',
        pubDate: it.pubDate || null,
        guess: it.guess || classifyHeadline(it.title || ''),
        heat,
        player,
        summary: it.title
      };
    });
    res.json({ candidates });
  } catch (err) {
    console.error('import-preview failed:', err.message || err);
    res.status(500).json({ error: 'Could not fetch preview items' });
  }
});

// Import selected rumours into data/transfers-rumours.json (safety: client must POST selected items)
app.post('/api/rumours/import', express.json(), (req, res) => {
  try {
    const items = req.body.items || [];
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'No items provided' });
    const nowDate = new Date().toISOString().slice(0,10);
    const file = path.join(__dirname, 'data', 'transfers-rumours.json');
    const data = readJSON('transfers-rumours.json');
    // Append items in a conservative normalized shape
    for (const it of items) {
      const entry = {
        player: it.player || (it.title ? it.title : 'Unknown'),
        position: it.position || null,
        club: it.club || null,
        direction: it.direction || 'in',
        heat: Number.isFinite(it.heat) ? it.heat : guessHeatFromTitle(it.title || ''),
        source: it.source || (it.link ? 'TransferFeed' : null),
        date: it.date || nowDate,
        summary: it.summary || it.title || '',
        link: it.link || null
      };
      data.rumours.unshift(entry);
    }
    data.lastUpdated = nowDate;
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
    res.json({ added: items.length, lastUpdated: data.lastUpdated });
  } catch (err) {
    console.error('import failed:', err.message || err);
    res.status(500).json({ error: 'Import failed' });
  }
});

app.get('/api/news', async (req, res) => {
  const type = req.query.type || 'all'; // 'all' | 'confirmed' | 'rumour'
  const source = req.query.source || 'google'; // 'google' | 'newsnow' | 'both'

  try {
    let items = [];
    if (source === 'newsnow') {
      items = await fetchNewsNow();
    } else if (source === 'transferfeed') {
      items = await fetchTransferFeed();
    } else if (source === 'both') {
      // fetch Google News, NewsNow and TransferFeed, concat and dedupe by title
      const [g, n, t] = await Promise.all([
        fetchCharltonNews().catch(() => []),
        fetchNewsNow().catch(() => []),
        fetchTransferFeed().catch(() => [])
      ]);
      items = [...g, ...n, ...t];
      const seen = new Set();
      items = items.filter(it => {
        const key = (it.title || '').toLowerCase();
        if (seen.has(key)) return false; seen.add(key); return true;
      });
    } else {
      items = await fetchCharltonNews();
    }

    const filtered = type === 'all' ? items : items.filter(i => i.guess === type);
    res.json({ checkedAt: new Date().toISOString(), items: filtered });
  } catch (err) {
    console.error('news check failed:', err.message || err);
    res.json({ checkedAt: new Date().toISOString(), items: [], error: "Couldn't reach the news feed from the server." });
  }
});

// ============================================================
// Fixtures — /fixtures
//
// The list of fixtures lives in data/fixtures.json (dates, kick-off
// times, competition, venue). This route does the "dynamic" part:
// every request it compares each fixture's kick-off against the
// current time to work out what's next, what's upcoming, and what's
// already been played -- rather than anyone having to hand-maintain
// a "next match" flag. Add new fixtures (new rounds, rescheduled TV
// dates, cup draws) to the JSON and they slot into the right place
// automatically.
// ============================================================
function fixtureDateTime(fixture) {
  // Combine date + kickoff into a single sortable Date (assumes UK local time).
  return new Date(`${fixture.date}T${fixture.kickoff}:00`);
}

app.get('/fixtures', (req, res) => {
  const data = readJSON('fixtures.json');
  const compFilter = req.query.comp || 'all';
  const now = new Date();

  const enriched = data.fixtures
    .map(f => ({ ...f, kickoffAt: fixtureDateTime(f) }))
    .sort((a, b) => a.kickoffAt - b.kickoffAt);

  const played = enriched.filter(f => (f.homeScore != null && f.awayScore != null) || f.kickoffAt < now);
  const upcoming = enriched.filter(f => !played.includes(f));

  const nextFixture = upcoming[0] || null;
  const results = played.slice().reverse(); // most recent first

  const competitions = ['all', ...new Set(data.fixtures.map(f => f.competition))];

  const filteredUpcoming = compFilter === 'all' ? upcoming : upcoming.filter(f => f.competition === compFilter);
  const filteredResults = compFilter === 'all' ? results : results.filter(f => f.competition === compFilter);

  const stats = {
    total: data.fixtures.length,
    home: data.fixtures.filter(f => f.venue === 'home').length,
    away: data.fixtures.filter(f => f.venue === 'away').length,
    cup: data.fixtures.filter(f => f.competition !== 'Championship' && f.competition !== 'Friendly').length
  };

  res.render('fixtures', {
    site: SITE,
    active: 'fixtures',
    season: data.season,
    note: data.note,
    lastUpdated: data.lastUpdated,
    nextFixture,
    upcoming: filteredUpcoming,
    results: filteredResults,
    competitions,
    compFilter,
    stats,
    now
  });
});

// API for fixtures so the client can poll for updates without a full reload
app.get('/api/fixtures', (req, res) => {
  try {
    const data = readJSON('fixtures.json');
    const now = new Date();
    const enriched = data.fixtures
      .map(f => ({ ...f, kickoffAt: fixtureDateTime(f) }))
      .sort((a, b) => a.kickoffAt - b.kickoffAt);

    const played = enriched.filter(f => (f.homeScore != null && f.awayScore != null) || f.kickoffAt < now);
    const results = played.slice().reverse();

    res.json({ season: data.season, lastUpdated: data.lastUpdated || null, results });
  } catch (err) {
    console.error('failed to read fixtures:', err.message);
    res.status(500).json({ error: 'Could not read fixtures' });
  }
});

// Return confirmed transfers as JSON so the client can refresh parts
// of the page without a full reload.
app.get('/api/confirmed', (req, res) => {
  try {
    const data = readJSON('transfers-confirmed.json');
    res.json(data);
  } catch (err) {
    console.error('failed to read confirmed transfers:', err.message);
    res.status(500).json({ error: 'Could not read confirmed transfers' });
  }
});

app.get('/api/rumours', (req, res) => {
  try {
    const data = readJSON('transfers-rumours.json');
    const sorted = [...(data.rumours || [])].slice().sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : 0;
      const db = b.date ? new Date(b.date).getTime() : 0;
      if (db !== da) return db - da;
      return (b.heat || 0) - (a.heat || 0);
    });
    res.json({ lastUpdated: data.lastUpdated || null, rumours: sorted });
  } catch (err) {
    console.error('failed to read rumours:', err.message);
    res.status(500).json({ error: 'Could not read rumours' });
  }
});

// Live Championship table API — scrapes worldfootball.net standings (Puppeteer fallback)
app.get('/api/table', async (req, res) => {
  const WF_URL = 'https://www.worldfootball.net/competition/co20/england-championship/2026-2027/tabelle/';
  try {
    let html;
    try {
      const r = await fetch(WF_URL, { headers: { 'User-Agent': 'DA3sCharltonNews/1.0' } });
      if (!r.ok) throw new Error('fetch failed ' + r.status);
      html = await r.text();
    } catch (e) {
      // Puppeteer fallback
      const puppeteer = require('puppeteer');
      const launchOpts = { args: ['--no-sandbox', '--disable-setuid-sandbox'] };
      if (process.env.PUPPETEER_EXECUTABLE_PATH) launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
      const browser = await puppeteer.launch(launchOpts);
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36');
      await page.goto(WF_URL, { waitUntil: 'networkidle2', timeout: 30000 });
      html = await page.content();
      await browser.close();
    }

    const cheerio = require('cheerio');
    const $ = cheerio.load(html);

    // Find a sensible standings table: prefer the standard class, otherwise pick
    // the first table that looks like a league table (has "Team" and "M" headers).
    let table = $('table.standard_tabelle').first();
    if (!table || !table.length) {
      table = $('table').filter((i, t) => {
        const headers = $(t).find('thead th').toArray().map(th => $(th).text().replace(/\s+/g, ' ').trim().toLowerCase());
        const joined = headers.join(' ');
        return joined.includes('team') && (joined.includes('m') || joined.includes('played'));
      }).first();
    }
    if (!table || !table.length) return res.json({ lastUpdated: null, table: [] });

    const rows = [];
    table.find('tbody tr').each((i, tr) => {
      const $tr = $(tr);
      const tds = $tr.find('td').toArray();
      if (!tds.length) return;

      // position: first numeric cell
      let pos = null;
      for (let j = 0; j < tds.length; j++) {
        const txt = $(tds[j]).text().replace(/\s+/g, ' ').trim();
        if (/^\d+$/.test(txt)) { pos = txt; break; }
      }

      // team: prefer the last anchor text in the row (worldfootball puts the team link there)
      let team = '';
      const anchors = $tr.find('a').toArray();
      if (anchors.length) {
        team = $(anchors[anchors.length - 1]).text().replace(/\s+/g, ' ').trim();
      } else {
        // fallback: first non-numeric, non-goals-looking cell
        for (let j = 0; j < tds.length; j++) {
          const txt = $(tds[j]).text().replace(/\s+/g, ' ').trim();
          if (txt && !/^\d+$/.test(txt) && !/^\d+[:\-]\d+$/.test(txt)) { team = txt; break; }
        }
      }

      // Collect numeric columns after the team cell to map to P/W/D/L
      let teamIdx = -1;
      for (let j = 0; j < tds.length; j++) {
        if ($(tds[j]).text().indexOf(team) !== -1) { teamIdx = j; break; }
      }
      const nums = [];
      for (let k = Math.max(0, teamIdx + 1); k < tds.length; k++) {
        const txt = $(tds[k]).text().replace(/\s+/g, ' ').trim();
        if (/^\d+$/.test(txt)) nums.push(parseInt(txt, 10));
        else if (/^\d+[:\-]\d+$/.test(txt)) nums.push(txt);
      }

      const played = nums[0] || 0;
      const wins = nums[1] || 0;
      const draws = nums[2] || 0;
      const losses = nums[3] || 0;

      // goals: look specifically for a cell that matches "N:N" pattern
      let goalsFor = null, goalsAgainst = null;
      for (let j = 0; j < tds.length; j++) {
        const txt = $(tds[j]).text().replace(/\s+/g, ' ').trim();
        const gm = txt.match(/^(\d+)\s*[:\-]\s*(\d+)$/);
        if (gm) { goalsFor = parseInt(gm[1], 10); goalsAgainst = parseInt(gm[2], 10); break; }
      }

      // Gather purely numeric cells to determine GD and points reliably
      const numericTexts = [];
      for (let j = 0; j < tds.length; j++) {
        const txt = $(tds[j]).text().replace(/\s+/g, ' ').trim();
        if (/^[+\-]?\d+$/.test(txt)) numericTexts.push(txt);
      }
      let gd = '';
      let pts = nums[nums.length - 1] || 0;
      if (numericTexts.length) {
        pts = parseInt(numericTexts[numericTexts.length - 1], 10) || pts;
        if (numericTexts.length >= 2) gd = numericTexts[numericTexts.length - 2];
      }

      rows.push({ pos, team, played, wins, draws, losses, goalsFor, goalsAgainst, gd, points: pts });
    });

    res.json({ lastUpdated: new Date().toISOString().slice(0,10), table: rows });
  } catch (err) {
    console.error('api/table failed:', err.message || err);
    res.status(500).json({ lastUpdated: null, table: [], error: 'Could not fetch standings' });
  }
});

// Page for the live table
app.get('/table', (req, res) => {
  res.render('table', { site: SITE, active: 'table' });
});

app.get('/api/rumours/prune-preview', (req, res) => {
  try {
    const confirmed = readJSON('transfers-confirmed.json');
    const rumours = readJSON('transfers-rumours.json');
    const confirmedPlayers = new Set([...(confirmed.in || []).map(i => (i.player || '').toLowerCase()), ...(confirmed.out || []).map(o => (o.player || '').toLowerCase())]);

    const matches = (rumours.rumours || []).filter(r => {
      if (!r.player) return false;
      const name = r.player.toLowerCase();
      if (confirmedPlayers.has(name)) return true;
      // fallback: match by last name
      const last = name.split(' ').slice(-1)[0];
      for (const cp of confirmedPlayers) {
        if (cp.split(' ').slice(-1)[0] === last) return true;
      }
      return false;
    });
    res.json({ matches });
  } catch (err) {
    console.error('prune-preview failed:', err.message);
    res.status(500).json({ error: 'Could not compute prune preview' });
  }
});

app.post('/api/rumours/prune', express.json(), (req, res) => {
  try {
    const players = (req.body.players || []).map(p => (p || '').toLowerCase());
    if (!players.length) return res.status(400).json({ error: 'No players provided' });
    const rumours = readJSON('transfers-rumours.json');
    const before = rumours.rumours.length;
    rumours.rumours = rumours.rumours.filter(r => !players.includes((r.player||'').toLowerCase()));
    const removed = before - rumours.rumours.length;
    rumours.lastUpdated = new Date().toISOString().slice(0,10);
    fs.writeFileSync(path.join(__dirname, 'data', 'transfers-rumours.json'), JSON.stringify(rumours, null, 2) + '\n', 'utf8');
    res.json({ removed });
  } catch (err) {
    console.error('prune failed:', err.message);
    res.status(500).json({ error: 'Prune operation failed' });
  }
});

app.use((req, res) => {
  res.status(404).render('404', { site: SITE, active: '' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`⚽ DA3's Charlton News running at http://localhost:${PORT}`);
});
