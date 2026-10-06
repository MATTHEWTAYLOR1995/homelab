const fs = require('fs');
const path = require('path');

function readJSON(file) { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', file), 'utf8')); }
function writeJSON(file, obj) { fs.writeFileSync(path.join(__dirname, '..', 'data', file), JSON.stringify(obj, null, 2) + '\n', 'utf8'); }

function normName(n) {
  if (!n) return '';
  return n.replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

function parseDate(d) {
  if (!d) return new Date(0);
  d = d.trim();
  // ISO yyyy-mm-dd
  let m = d.match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`);
  // dd.mm.yyyy
  m = d.match(/^(\d{1,2})\.(\d{1,2})\.(20\d{2})$/);
  if (m) return new Date(`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}T12:00:00Z`);
  // dd MON yyyy (e.g. 20 AUG 2026)
  m = d.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(20\d{2})$/);
  if (m) {
    const mon = {JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'}[m[2].toUpperCase()];
    if (mon) return new Date(`${m[3]}-${mon}-${m[1].padStart(2,'0')}T12:00:00Z`);
  }
  // dd/MM/yyyy
  m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const year = m[3].length===2 ? '20'+m[3] : m[3];
    return new Date(`${year}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}T12:00:00Z`);
  }
  // fallback: try Date.parse
  const parsed = Date.parse(d);
  if (!isNaN(parsed)) return new Date(parsed);
  return new Date(0);
}

function samePerson(a, b) {
  if (!a || !b) return false;
  const A = normName(a).toLowerCase();
  const B = normName(b).toLowerCase();
  if (A === B) return true;
  if (A.includes(B) || B.includes(A)) return true;
  // compare last names
  const la = A.split(' ').slice(-1)[0];
  const lb = B.split(' ').slice(-1)[0];
  if (la && lb && la === lb) return true;
  return false;
}

function dedupeAndSort() {
  const file = 'transfers-confirmed.json';
  const data = readJSON(file);
  const list = data.in || [];
  const kept = [];

  for (const entry of list) {
    const existingIdx = kept.findIndex(k => samePerson(k.player, entry.player));
    if (existingIdx === -1) {
      kept.push(entry);
    } else {
      // keep the most recent by date
      const existing = kept[existingIdx];
      const dExisting = parseDate(existing.date);
      const dNew = parseDate(entry.date);
      if (dNew > dExisting) kept[existingIdx] = entry;
    }
  }

  // sort newest-first
  kept.sort((a,b) => parseDate(b.date) - parseDate(a.date));

  const removed = list.length - kept.length;
  data.in = kept;
  data.lastUpdated = new Date().toISOString().slice(0,10);
  writeJSON(file, data);
  console.log('Dedupe/sort complete — removed', removed, 'duplicate(s); arrivals now', kept.length, 'entries.');
}

dedupeAndSort();
