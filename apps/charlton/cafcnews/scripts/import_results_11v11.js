#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const FIXTURES_FILE = path.join(__dirname, '..', 'data', 'fixtures.json');
const SOURCE_URL = 'https://www.11v11.com/teams/charlton-athletic/tab/matches/';

function readJSON() {
  return JSON.parse(fs.readFileSync(FIXTURES_FILE, 'utf8'));
}

function writeJSON(obj) {
  const tempFile = `${FIXTURES_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  fs.renameSync(tempFile, FIXTURES_FILE);
}

function normalizeName(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
}

function canonicalName(name) {
  const normalized = normalizeName(name);
  const aliases = {
    'derby county': 'derby',
    'cardiff city': 'cardiff',
    'stoke city': 'stoke',
    'west ham united': 'west ham',
    'west bromwich albion': 'west brom',
    'queens park rangers': 'qpr',
    'preston north e': 'preston north end'
  };
  return aliases[normalized] || normalized;
}

function competitionMatches(fixtureCompetition, sourceCompetition) {
  const fixture = normalizeName(fixtureCompetition);
  const source = normalizeName(sourceCompetition);
  if (fixture === 'championship') return source.includes('championship');
  if (fixture === 'efl cup') return source.includes('league cup') || source.includes('efl cup') || source.includes('carabao cup');
  if (fixture === 'fa cup') return source.includes('fa cup');
  if (fixture === 'friendly') return source.includes('friendly');
  return fixture === source;
}

function parseDateString(value) {
  const match = (value || '').match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);
  if (!match) return null;
  const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const month = months[match[2].toLowerCase().slice(0, 3)];
  if (!month) return null;
  return `${match[3]}-${String(month).padStart(2, '0')}-${String(match[1]).padStart(2, '0')}`;
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DA3sCharltonNews/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-GB,en;q=0.9'
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`11v11 responded ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function parseCandidates(html) {
  const $ = cheerio.load(html);
  const rows = $('table.width580.sortable tbody tr').toArray();
  const candidates = [];
  for (const row of rows) {
    const cells = $(row).find('td').toArray().map(cell => $(cell).text().replace(/\s+/g, ' ').trim());
    const date = parseDateString(cells[0]);
    const matchText = cells[1] || '';
    const score = (cells[3] || '').match(/(\d+)\s*[-–]\s*(\d+)/);
    if (!date || !score) continue;

    const teams = matchText.split(/\s+v\s+|\s+vs?\s+/i).map(team => team.trim()).filter(Boolean);
    if (teams.length !== 2) continue;
    let opponent;
    if (/charlton/i.test(teams[0])) opponent = teams[1];
    else if (/charlton/i.test(teams[1])) opponent = teams[0];
    else continue;

    candidates.push({
      date,
      opponent,
      competition: cells[4] || '',
      homeScore: Number(score[1]),
      awayScore: Number(score[2])
    });
  }
  return candidates;
}

async function refreshResults() {
  const data = readJSON();
  const today = new Date().toISOString().slice(0, 10);
  const pending = (data.fixtures || []).filter(f => f.date <= today && (f.homeScore == null || f.awayScore == null));
  if (!pending.length) return { updated: 0, pending: 0 };

  let html;
  try {
    html = await fetchHtml(SOURCE_URL);
  } catch (fetchError) {
    console.warn(`Direct 11v11 request failed (${fetchError.message}); trying Chromium fallback.`);
    const puppeteer = require('puppeteer');
    const launchOptions = { args: ['--no-sandbox', '--disable-setuid-sandbox'] };
    if (process.env.PUPPETEER_EXECUTABLE_PATH) launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    const browser = await puppeteer.launch(launchOptions);
    try {
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (compatible; DA3sCharltonNews/1.0)');
      await page.goto(SOURCE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      html = await page.content();
    } finally {
      await browser.close();
    }
  }
  const candidates = parseCandidates(html);
  if (!candidates.length) throw new Error('No completed Charlton matches could be parsed from 11v11.');

  let updated = 0;
  for (const candidate of candidates) {
    for (const fixture of pending) {
      if (fixture.date !== candidate.date || !competitionMatches(fixture.competition, candidate.competition)) continue;
      if (canonicalName(fixture.opponent) !== canonicalName(candidate.opponent)) continue;
      // Scores are stored in the source's actual home-away order.
      fixture.homeScore = candidate.homeScore;
      fixture.awayScore = candidate.awayScore;
      updated++;
      console.log(`Updated ${fixture.date} ${fixture.opponent}: ${fixture.homeScore}-${fixture.awayScore}`);
      break;
    }
  }

  if (updated) {
    data.lastUpdated = new Date().toISOString().slice(0, 10);
    writeJSON(data);
  }
  return { updated, pending: pending.length };
}

if (require.main === module) {
  refreshResults()
    .then(({ updated, pending }) => console.log(`Result refresh complete: ${updated} updated from ${pending} pending fixture(s).`))
    .catch(error => { console.error('Result refresh failed:', error.message); process.exitCode = 1; });
}

module.exports = { refreshResults };
