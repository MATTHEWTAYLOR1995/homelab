#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const FIXTURES_FILE = path.join(__dirname, '..', 'data', 'fixtures.json');

function readJSON() { return JSON.parse(fs.readFileSync(FIXTURES_FILE, 'utf8')); }
function writeJSON(obj) { fs.writeFileSync(FIXTURES_FILE, JSON.stringify(obj, null, 2) + '\n', 'utf8'); }

function normalizeName(n) { return (n||'').toLowerCase().replace(/[^a-z0-9 ]+/g,'').replace(/\s+/g,' ').trim(); }

function dedupe(fixtures) {
  const seen = new Set();
  const out = [];
  for (const f of fixtures) {
    const key = `${f.date}|${normalizeName(f.opponent)}|${f.competition||''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

function sortByDate(fixtures) {
  return fixtures.slice().sort((a,b)=> new Date(a.date) - new Date(b.date));
}

function run(){
  const data = readJSON();
  const fixtures = data.fixtures || [];
  const before = fixtures.length;
  const deduped = dedupe(fixtures);
  const sorted = sortByDate(deduped);
  data.fixtures = sorted;
  data.lastUpdated = new Date().toISOString().slice(0,10);
  writeJSON(data);
  console.log(`Deduped fixtures: before=${before} after=${sorted.length}`);
}

run();
