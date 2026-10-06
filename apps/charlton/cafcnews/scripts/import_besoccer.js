const fs = require('fs');
const path = require('path');
const fetch = globalThis.fetch || require('node-fetch');
const cheerio = require('cheerio');

const SOURCE_URL = process.argv[2] || 'https://www.besoccer.com/team/transfers/charlton-athletic-fc';
const SEASON = process.argv[3] || (new Date()).getFullYear();

function readJSON(file) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', file), 'utf8'));
}

function writeJSON(file, obj) {
  fs.writeFileSync(path.join(__dirname, '..', 'data', file), JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

async function fetchPage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DA3sCharltonNews/1.0)' }, timeout: 15000 });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return await res.text();
}

function normalizeClubName(name) { return name.replace(/\s+\(.*\)$/, '').trim(); }

function extractTransfersFromText(text) {
  // normalize spacing and uppercase months
  const clean = text.replace(/\s+/g, ' ').replace(/\u00A0/g, ' ');

  // look for date tokens like '23 JUL 2026' and capture nearby tokens
  const dateRe = /([0-3]?\d)\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Za-z]*\s+(20\d{2})/gi;
  const results = [];
  let m;
  while ((m = dateRe.exec(clean))) {
    const idx = m.index;
    const dateToken = `${m[1]} ${m[2]} ${m[3]}`;

    // get slice around the date (80 chars before and 120 after)
    const before = clean.slice(Math.max(0, idx - 80), idx).trim();
    const after = clean.slice(idx + m[0].length, idx + m[0].length + 120).trim();

    // try to find player name in 'before' - take last two words with capital letters
    const nameMatch = before.match(/([A-Z][A-Za-z\.'-]{1,40}\s+[A-Z][A-Za-z\.'-]{1,40})\s*$/);
    const player = nameMatch ? nameMatch[1].trim() : null;

    // club is usually next token(s) in 'after' until a keyword like Transfer/Loan/Free
    const clubMatch = after.match(/^([A-Za-z0-9&\.\-\'\s]{2,60}?)\s+(Transfer|Loan|Free|Released|Loan\.|Free transfer)/i);
    const club = clubMatch ? clubMatch[1].trim() : '';

    // determine direction by scanning prior segment for 'NEW SIGNING' or 'PLAYER OUT'
    const contextWindow = clean.slice(Math.max(0, idx - 200), idx + 200).toUpperCase();
    let direction = null;
    if (/NEW SIGNING|NEW SIGNINGS|NEW SIGN|NEW PLAYER/i.test(contextWindow)) direction = 'in';
    if (/PLAYER OUT|PLAYER OUTS|PLAYER OUT|OUT|TRANSFER OUT/i.test(contextWindow) && !direction) direction = 'out';

    if (player && direction) {
      results.push({ player, date: dateToken, club: normalizeClubName(club), direction, fee: '' });
    }
  }
  return results;
}

async function run() {
  console.log('Fetching', SOURCE_URL);
  const html = await fetchPage(SOURCE_URL);
  const $ = cheerio.load(html);
  const bodyText = $('body').text();

  const found = extractTransfersFromText(bodyText);

  if (!found.length) {
    console.log('No transfers parsed from Besoccer page.');
    return;
  }

  const data = readJSON('transfers-confirmed.json');
  const existing = new Set([...(data.in || []).map(i => i.player), ...(data.out || []).map(o => o.player)]);
  let added = 0;
  for (const f of found) {
    if (existing.has(f.player)) continue;
    const entry = {
      player: f.player,
      position: '',
      date: f.date || (new Date()).toISOString().slice(0,10),
      fee: f.fee || 'Undisclosed',
      window: SEASON.toString(),
      note: `Imported from BeSoccer (${SOURCE_URL})`
    };
    if (f.direction === 'in') {
      entry.from = f.club || '';
      data.in = data.in || [];
      data.in.push(entry);
    } else {
      entry.to = f.club || '';
      data.out = data.out || [];
      data.out.push(entry);
    }
    existing.add(f.player);
    added += 1;
    console.log('Added', f.player, f.direction, f.club || '');
  }

  data.lastUpdated = new Date().toISOString().slice(0,10);
  writeJSON('transfers-confirmed.json', data);

  console.log(`BeSoccer import complete — ${added} new transfer(s) added.`);
}

run().catch(err => { console.error('Import failed:', err.message || err); process.exit(1); });
