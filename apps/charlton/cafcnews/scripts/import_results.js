#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

/*
  import_results.js

  Usage:
    - Real mode (requires Football-Data.org API key + team id):
        FOOTBALL_DATA_KEY=yourkey TEAM_ID=xxxxx node scripts/import_results.js

    - Mock mode (no API key):
        node scripts/import_results.js --mock

  Behavior:
    - Reads data/fixtures.json and looks for fixtures without scores
      where the fixture date is today or earlier.
    - If FOOTBALL_DATA_KEY+TEAM_ID are provided, queries the Football-Data.org
      matches endpoint for that team and updates matching fixtures with
      `homeScore` and `awayScore` when the match status is FINISHED.
    - In --mock mode the script will simulate a finished match for testing.

  Notes:
    - Football-Data.org requires signing up for an API key. Provide the
      key in the `FOOTBALL_DATA_KEY` env var and Charlton's team id in
      `TEAM_ID` (the script does a best-effort name match for opponents).
*/

const FIXTURES_FILE = path.join(__dirname, '..', 'data', 'fixtures.json');

function readJSON() {
  return JSON.parse(fs.readFileSync(FIXTURES_FILE, 'utf8'));
}

function writeJSON(obj) {
  fs.writeFileSync(FIXTURES_FILE, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function dateOnlyIso(d) {
  const dt = new Date(d);
  return dt.toISOString().slice(0, 10);
}

async function fetchMatchesFromFootballData(teamId, from, to, key) {
  const url = `https://api.football-data.org/v4/teams/${teamId}/matches?dateFrom=${from}&dateTo=${to}`;
  const res = await fetch(url, { headers: { 'X-Auth-Token': key } });
  if (!res.ok) throw new Error(`football-data responded ${res.status}`);
  const json = await res.json();
  return json.matches || [];
}

function normalizeName(n) {
  return (n || '').toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
}

async function run() {
  const args = process.argv.slice(2);
  const mock = args.includes('--mock');

  const data = readJSON();
  const fixtures = data.fixtures || [];

  // find fixtures up to today that don't have scores
  const today = new Date();
  const pending = fixtures.filter(f => {
    const fDate = new Date(`${f.date}T00:00:00`);
    return fDate <= today && (f.homeScore == null || f.awayScore == null);
  });

  if (!pending.length) {
    console.log('No finished fixtures without scores found.');
    return;
  }

  const from = pending.reduce((min, f) => f.date < min ? f.date : min, pending[0].date);
  const to = dateOnlyIso(today);

  const key = process.env.FOOTBALL_DATA_KEY;
  const teamId = process.env.TEAM_ID;

  let matches = [];
  if (mock) {
    console.log('Running in mock mode — will simulate one finished match.');
    matches = pending.slice(0, 1).map(f => ({
      utcDate: new Date(`${f.date}T${f.kickoff || '15:00'}:00Z`).toISOString(),
      status: 'FINISHED',
      score: { fullTime: { home: 1, away: 2 } },
      homeTeam: { name: f.venue === 'home' ? 'Charlton Athletic' : f.opponent },
      awayTeam: { name: f.venue === 'home' ? f.opponent : 'Charlton Athletic' }
    }));
  } else if (key && teamId) {
    console.log(`Querying Football-Data.org for team ${teamId} between ${from} and ${to}...`);
    try {
      matches = await fetchMatchesFromFootballData(teamId, from, to, key);
      console.log(`Fetched ${matches.length} matches from API.`);
    } catch (err) {
      console.error('Failed to fetch from football-data:', err.message);
      return;
    }
  } else {
    console.error('No API key/team id provided and not in mock mode. Set FOOTBALL_DATA_KEY and TEAM_ID, or run with --mock.');
    return;
  }

  let updated = 0;
  for (const m of matches) {
    if (!m.utcDate) continue;
    const matchDate = dateOnlyIso(m.utcDate);
    if (!(m.score && m.score.fullTime)) continue;
    const home = normalizeName(m.homeTeam && m.homeTeam.name);
    const away = normalizeName(m.awayTeam && m.awayTeam.name);
    const homeScore = m.score.fullTime.home;
    const awayScore = m.score.fullTime.away;

    // find fixture in our data matching date and opponent name
    for (const f of fixtures) {
      if (f.date !== matchDate) continue;
      const opp = normalizeName(f.opponent);
      const isHome = f.venue === 'home';
      const opponentName = isHome ? away : home; // opponent as in match data
      if (opponentName.includes(opp) || opp.includes(opponentName) || opponentName.split(' ').slice(-1)[0] === opp.split(' ').slice(-1)[0]) {
        // found a match
        if (isHome) {
          f.homeScore = homeScore;
          f.awayScore = awayScore;
        } else {
          f.homeScore = homeScore;
          f.awayScore = awayScore;
        }
        updated++;
        console.log(`Updated ${f.date} ${f.opponent} — ${f.homeScore}-${f.awayScore}`);
        break;
      }
    }
  }

  if (updated) {
    data.fixtures = fixtures;
    writeJSON(data);
    console.log(`Wrote ${updated} updated fixture(s) to ${FIXTURES_FILE}`);
  } else {
    console.log('No fixtures were matched/updated.');
  }
}

run().catch(err => { console.error(err); process.exit(1); });
