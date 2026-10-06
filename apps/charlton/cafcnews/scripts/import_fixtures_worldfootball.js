#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FIXTURES_FILE = path.join(__dirname, '..', 'data', 'fixtures.json');

function readJSON() { return JSON.parse(fs.readFileSync(FIXTURES_FILE, 'utf8')); }
function writeJSON(obj) { fs.writeFileSync(FIXTURES_FILE, JSON.stringify(obj, null, 2) + '\n', 'utf8'); }

function normalizeName(n) { return (n||'').toLowerCase().replace(/[^a-z0-9 ]+/g,'').replace(/\s+/g,' ').trim(); }

function parseDateString(s) {
  if (!s) return null;
  // dd/mm/yyyy or dd.mm.yyyy
  let m = s.match(/(\d{1,2})[\.\/](\d{1,2})[\.\/(\s)]?(\d{4})/);
  if (m) {
    const d = String(m[1]).padStart(2,'0');
    const mo = String(m[2]).padStart(2,'0');
    const y = m[3];
    return new Date(Date.UTC(parseInt(y,10), parseInt(mo,10)-1, parseInt(d,10)));
  }
  // dd Mon yyyy
  m = s.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);
  if (m) {
    const day = String(m[1]).padStart(2,'0');
    const monthName = m[2].toLowerCase().slice(0,3);
    const year = m[3];
    const months = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
    const mm = months[monthName];
    if (!mm) return null;
    return new Date(Date.UTC(parseInt(year,10), mm-1, parseInt(day,10)));
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t);
  return null;
}

async function fetchPage(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; site-scraper/1.0)' } });
    if (res.ok) return await res.text();
    throw new Error('fetch failed '+res.status);
  } catch (e) {
    // Puppeteer fallback
    try {
      const puppeteer = require('puppeteer');
      const launchOpts = { args: ['--no-sandbox','--disable-setuid-sandbox'] };
      if (process.env.PUPPETEER_EXECUTABLE_PATH) launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
      const browser = await puppeteer.launch(launchOpts);
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36');
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      const html = await page.content();
      await browser.close();
      return html;
    } catch (pe) {
      throw new Error('Both fetch and Puppeteer failed: '+(pe.message||pe));
    }
  }
}

async function run() {
  const data = readJSON();
  const fixtures = data.fixtures || [];

  const candidateUrls = [
    'https://www.worldfootball.net/teams/te371/charlton-athletic/all-matches/',
    'https://www.worldfootball.net/teams/charlton-athletic/2026/3/',
    'https://www.worldfootball.net/teams/charlton-athletic/2026/3/3/',
    'https://www.worldfootball.net/teams/charlton-athletic/2026/3/0/'
  ];

  let allCandidates = [];
  for (const url of candidateUrls) {
    console.log('Fetching', url);
    let html;
    try { html = await fetchPage(url); } catch (e) { console.warn('Failed', url, e.message); continue; }
    const $ = cheerio.load(html);
    const tables = $('table').toArray();
    for (const table of tables) {
      const headerText = $(table).find('thead th').first().text() || $(table).find('tr').first().find('th').first().text() || $(table).prevAll('h2, h3').first().text();
      if (!/Championship\s*2026\/?2027/i.test(headerText)) continue;
      const rows = $(table).find('tbody tr').toArray();
      rows.forEach(r => {
        const cols = $(r).find('td').toArray().map(td => $(td).text().replace(/\s+/g,' ').trim());
        if (!cols.length) return;
        const dateRaw = cols[0] || '';
        const dateObj = parseDateString(dateRaw);
        if (!dateObj) return;
        const date = dateObj.toISOString().slice(0,10);
        const venue = (cols[3] || '').toUpperCase().includes('A') ? 'away' : 'home';
        const opponent = (cols[5] || cols[4] || '').replace(/\(.*\)/,'').trim();
        // skip parsing scores here (will be filled by results importer). Leave null to avoid noise.
        allCandidates.push({ date, opponent, venue, competition: 'Championship', kickoff: '15:00', ground: '', round: cols[1]||null, tbcTime: true, homeScore: null, awayScore: null });
      });
    }
    if (allCandidates.length) break; // stop after first working page
  }

  if (!allCandidates.length) { console.log('No Championship fixtures found on worldfootball pages tried.'); return; }

  // Deduplicate candidates by date+opponent
  const seen = new Set();
  const uniq = [];
  for (const c of allCandidates) {
    const key = `${c.date}|${normalizeName(c.opponent)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(c);
  }

  // Remove existing Championship fixtures in the 2026/27 season range (Jul 2026 - Jun 2027)
  const seasonStart = new Date('2026-07-01');
  const seasonEnd = new Date('2027-06-30');
  const remaining = fixtures.filter(f => {
    if ((f.competition||'').toLowerCase() !== 'championship') return true;
    const fd = new Date(f.date+'T00:00:00');
    return fd < seasonStart || fd > seasonEnd;
  });

  // Add scraped season fixtures
  const newList = remaining.concat(uniq);
  newList.sort((a,b) => new Date(a.date) - new Date(b.date));
  data.fixtures = newList;
  data.lastUpdated = new Date().toISOString().slice(0,10);
  writeJSON(data);
  console.log(`Replaced Championship fixtures for 2026/27 with ${uniq.length} scraped entries.`);
}

run().catch(e=>{ console.error(e); process.exit(1); });
