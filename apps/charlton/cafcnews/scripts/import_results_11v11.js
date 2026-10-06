#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FIXTURES_FILE = path.join(__dirname, '..', 'data', 'fixtures.json');

function readJSON() {
  return JSON.parse(fs.readFileSync(FIXTURES_FILE, 'utf8'));
}

function writeJSON(obj) {
  fs.writeFileSync(FIXTURES_FILE, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function normalizeName(n) {
  return (n || '').toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
}

function parseDateString(s) {
  // Support formats like '22 Aug 2026' or '22 August 2026'
  const m = s.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);
  if (m) {
    const day = String(m[1]).padStart(2, '0');
    const monthName = m[2].toLowerCase().slice(0,3);
    const year = m[3];
    const months = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
    const mm = months[monthName];
    if (!mm) return null;
    // Use UTC to avoid timezone offset shifting the date
    return new Date(Date.UTC(parseInt(year,10), mm - 1, parseInt(day,10)));
  }
  // fallback to Date.parse for other formats
  const tryDate = Date.parse(s);
  if (!Number.isNaN(tryDate)) return new Date(tryDate);
  return null;
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-GB,en;q=0.9',
      'Referer': 'https://www.11v11.com/',
      'Connection': 'keep-alive'
    };
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`Failed ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function run() {
  const data = readJSON();
  const fixtures = data.fixtures || [];

  const today = new Date();
  const pending = fixtures.filter(f => {
    const fDate = new Date(`${f.date}T00:00:00`);
    return fDate <= today && (f.homeScore == null || f.awayScore == null);
  });

  if (!pending.length) {
    console.log('No finished fixtures without scores found.');
    return;
  }

  console.log(`Found ${pending.length} pending fixture(s) to check.`);

  const url = 'https://www.11v11.com/teams/charlton-athletic/tab/matches/';
  let html;
  try {
    html = await fetchHtml(url);
  } catch (err) {
    console.error('Failed to fetch 11v11:', err.message);
    console.log('Attempting headless-browser fallback using Puppeteer...');
    try {
      // dynamic require so script still runs if puppeteer isn't installed until user installs it
      const puppeteer = require('puppeteer');
      const launchOpts = { args: ['--no-sandbox', '--disable-setuid-sandbox'] };
      if (process.env.PUPPETEER_EXECUTABLE_PATH) launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
      const browser = await puppeteer.launch(launchOpts);
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36');
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      html = await page.content();
      await browser.close();
      console.log('Fetched 11v11 page via Puppeteer.');
    } catch (e) {
      console.error('Puppeteer fallback failed:', e.message || e);
      console.error('Install puppeteer (`npm install puppeteer`) or run the mock importer instead.');
      return;
    }
  }

  const $ = cheerio.load(html);

  // Prefer the season table if present: it lists Date | Match | Result | Score | Competition
  const table = $('table.width580.sortable tbody');
  const rows = table.length ? table.find('tr').toArray() : $('table tr').toArray();

  const candidates = [];
  for (const r of rows) {
    const $r = $(r);
    const tds = $r.find('td').toArray().map(td => $(td).text().replace(/\s+/g, ' ').trim());
    if (!tds.length) continue;
    // Expect columns: 0=date, 1=match (e.g. 'Cheltenham Town v Charlton Athletic'), 3=score
    const dateText = tds[0] || '';
    const matchText = tds[1] || '';
    const scoreText = tds[3] || '';
    const scoreMatch = (scoreText || '').match(/(\d+)\s*[\-–]\s*(\d+)/);
    const dtype = parseDateString(dateText);
    if (!dtype || !scoreMatch) continue;

    // Determine opponent robustly by splitting on ' v ' or ' vs '
    let opponent = '';
    const parts = matchText.split(/\s+v\s+|\s+vs?\s+/i).map(p => p.trim()).filter(Boolean);
    if (parts.length === 2) {
      // parts[0] is home, parts[1] is away
      if (/charlton/i.test(parts[0])) opponent = parts[1];
      else if (/charlton/i.test(parts[1])) opponent = parts[0];
      else opponent = parts[0];
    } else {
      opponent = matchText.replace(/\bcharlton\b/ig, '').replace(/v|vs?/ig, '').trim();
    }

    candidates.push({ date: dtype.toISOString().slice(0,10), opponent: opponent.trim(), homeScore: parseInt(scoreMatch[1],10), awayScore: parseInt(scoreMatch[2],10), raw: `${dateText} ${matchText} ${scoreText}` });
  }

  if (!candidates.length) {
    console.log('No candidate finished matches found on 11v11 page.');
    return;
  }
  console.log('Candidates from 11v11:', candidates);

  let updated = 0;
  for (const c of candidates) {
    for (const f of fixtures) {
      if (f.date !== c.date) continue;
      const oppNorm = normalizeName(f.opponent);
      const candNorm = normalizeName(c.opponent);
      // match by inclusion or last-name match
      if (candNorm.includes(oppNorm) || oppNorm.includes(candNorm) || candNorm.split(' ').slice(-1)[0] === oppNorm.split(' ').slice(-1)[0]) {
        // Determine home/away from fixture
        if (f.venue === 'home') {
          f.homeScore = c.homeScore;
          f.awayScore = c.awayScore;
        } else {
          f.homeScore = c.homeScore;
          f.awayScore = c.awayScore;
        }
        updated++;
        console.log(`Updated ${f.date} ${f.opponent} -> ${f.homeScore}-${f.awayScore} (from 11v11)`);
        break;
      }
    }
  }

  if (updated) {
    data.fixtures = fixtures;
    data.lastUpdated = new Date().toISOString().slice(0,10);
    writeJSON(data);
    console.log(`Wrote ${updated} updated fixture(s) to ${FIXTURES_FILE}`);
  } else {
    console.log('No fixtures were matched/updated from 11v11 candidates.');
  }
}

run().catch(err => { console.error(err); process.exit(1); });
