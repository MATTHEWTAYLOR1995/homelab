const fs = require('fs');
const path = require('path');

function readJSON(file) { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', file), 'utf8')); }
function writeJSON(file, obj) { fs.writeFileSync(path.join(__dirname, '..', 'data', file), JSON.stringify(obj, null, 2) + '\n', 'utf8'); }

function cleanClubField(s) {
  if (!s || typeof s !== 'string') return '';
  let out = s.trim();
  // remove common prefixes
  out = out.replace(/^(Loan|Transfer|Free|Player out|Released|Retired)\.?\s*/i, '');
  // remove trailing date tokens like '10 AUG 2026' or '31/05/2027'
  out = out.replace(/\b\d{1,2}\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Za-z]*\s+20\d{2}\b/ig, '').trim();
  out = out.replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, '').trim();
  // if the remaining contains something that looks like a player name (initial + name), drop it
  if (/^[A-Z]\.?\s?[A-Za-z\-']+$/i.test(out) || /^[A-Z]\.?\s+[A-Z][a-z]+/.test(out)) {
    return '';
  }
  return out;
}

function fixFee(s) {
  if (!s || typeof s !== 'string') return s || '';
  // add space between 'End of loan' and date if missing
  return s.replace(/End of loan\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i, 'End of loan $1').trim();
}

function monthToWindow(month) {
  if (!month) return null;
  const m = month.toLowerCase();
  if (['jun','jul','aug','sep','june','july','august','september'].includes(m)) return 'Summer';
  if (['jan','feb','mar','apr','may','january','february','march','april','may'].includes(m)) return 'Winter';
  return null;
}

function inferWindowFromDate(dateStr) {
  if (!dateStr) return null;
  // formats: '2026-01-15' or '15.01.2026' or '15 JAN 2026' or '01/05/2026'
  const m1 = dateStr.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (m1) {
    const month = parseInt(m1[2],10);
    if (month>=6 && month<=9) return 'Summer ' + m1[1];
    if (month<=5) return 'Winter ' + m1[1];
    return m1[1];
  }
  const m2 = dateStr.match(/\b(\d{1,2})\.(\d{1,2})\.(20\d{2})\b/);
  if (m2) {
    const month = parseInt(m2[2],10);
    if (month>=6 && month<=9) return 'Summer ' + m2[3];
    return 'Winter ' + m2[3];
  }
  const m3 = dateStr.match(/\b(\d{1,2})\s+([A-Za-z]{3,})\s+(20\d{2})\b/);
  if (m3) {
    const w = monthToWindow(m3[2]);
    return (w ? w + ' ' : '') + m3[3];
  }
  const m4 = dateStr.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (m4) {
    const year = m4[3].length===2 ? ('20' + m4[3]) : m4[3];
    const month = parseInt(m4[2],10);
    if (month>=6 && month<=9) return 'Summer ' + year;
    return 'Winter ' + year;
  }
  return null;
}

function normalizeAll() {
  const p = path.join(__dirname, '..', 'data', 'transfers-confirmed.json');
  const data = readJSON('transfers-confirmed.json');
  let changed = 0;

  const processEntry = e => {
    const before = JSON.stringify(e);
    if (e.from) e.from = cleanClubField(e.from);
    if (e.to) e.to = cleanClubField(e.to);
    if (e.fee) e.fee = fixFee(e.fee);
    if ((!e.window || e.window === '2026') && e.date) {
      const w = inferWindowFromDate(e.date);
      if (w) e.window = w;
    }
    if (e.window === '2026') {
      // default ambiguous '2026' to Summer 2026
      e.window = 'Summer 2026';
    }
    if (JSON.stringify(e) !== before) changed += 1;
  };

  (data.in || []).forEach(processEntry);
  (data.out || []).forEach(processEntry);

  if (changed) {
    data.lastUpdated = new Date().toISOString().slice(0,10);
    writeJSON('transfers-confirmed.json', data);
  }
  console.log('Normalization complete —', changed, 'entries modified.');
}

normalizeAll();
