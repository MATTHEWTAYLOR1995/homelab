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
  const m = s.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);
  if (m) {
    const day = String(m[1]).padStart(2, '0');
    const monthName = m[2].toLowerCase().slice(0,3);
    const year = m[3];
    const months = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
    const mm = months[monthName];
    if (!mm) return null;
    return new Date(Date.UTC(parseInt(year,10), mm - 1, parseInt(day,10)));
  }
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

  const url = 'https://www.11v11.com/teams/charlton-athletic/tab/matches/';
  let html;
  try {
    html = await fetchHtml(url);
  } catch (err) {
    console.error('Failed to fetch 11v11:', err.message);
    console.log('Attempting headless-browser fallback using Puppeteer...');
    try {
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
      console.error('Install puppeteer (`npm install puppeteer`) or fetch the fixture list manually.');
      return;
    }
  }

  const $ = cheerio.load(html);
  const table = $('table.width580.sortable tbody');
  const rows = table.length ? table.find('tr').toArray() : $('table tr').toArray();

  const candidates = [];
  for (const r of rows) {
    const $r = $(r);
    const tds = $r.find('td').toArray().map(td => $(td).text().replace(/\s+/g, ' ').trim());
    if (!tds.length) continue;
    const dateText = tds[0] || '';
    const matchText = tds[1] || '';
    const compText = tds[tds.length - 1] || '';

    // Only keep Championship fixtures
    if (!/championship/i.test(compText)) continue;

    const dtype = parseDateString(dateText);
    if (!dtype) continue;

    // Determine opponent and venue
    let opponent = '';
    let venue = 'home';
    const parts = matchText.split(/\s+v\s+|\s+vs?\s+/i).map(p => p.trim()).filter(Boolean);
    if (parts.length === 2) {
      if (/charlton/i.test(parts[0])) { opponent = parts[1]; venue = 'home'; }
      else if (/charlton/i.test(parts[1])) { opponent = parts[0]; venue = 'away'; }
      else { opponent = parts[0]; venue = 'home'; }
    } else {
      opponent = matchText.replace(/\bcharlton\b/ig, '').replace(/v|vs?/ig, '').trim();
    }

    candidates.push({ date: dtype.toISOString().slice(0,10), kickoff: '15:00', competition: 'Championship', venue, opponent: opponent.trim(), ground: '', round: null, tbcTime: true });
  }

  if (!candidates.length) {
    console.log('No Championship fixtures found on 11v11 page.');
    return;
  }

  // Merge: add any candidate not already present (by date+opponent)
  let added = 0;
  for (const c of candidates) {
    const exists = fixtures.some(f => f.date === c.date && normalizeName(f.opponent) === normalizeName(c.opponent) && f.competition === 'Championship');
    if (!exists) {
      fixtures.push(c);
      added++;
    }
  }

  // Sort fixtures by date
  fixtures.sort((a,b) => new Date(a.date) - new Date(b.date));

  if (added) {
    data.fixtures = fixtures;
    data.lastUpdated = new Date().toISOString().slice(0,10);
    writeJSON(data);
    console.log(`Added ${added} Championship fixture(s) to ${FIXTURES_FILE}`);
  } else {
    console.log('No new Championship fixtures to add.');
  }
}

run().catch(err => { console.error(err); process.exit(1); });
