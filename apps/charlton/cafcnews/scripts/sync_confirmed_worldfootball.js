const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const WORLD_URL = 'https://www.worldfootball.net/teams/te371/charlton-athletic/transfers/';

function readLocal() {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'data', 'transfers-confirmed.json'), 'utf8');
  return JSON.parse(raw);
}

function normalizeName(n) {
  return (n || '').replace(/\s+\(.*\)$/,'').trim().toLowerCase();
}

async function fetchWF() {
  const res = await fetch(WORLD_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DA3sCharltonNews/1.0)' } });
  if (!res.ok) throw new Error('Failed to fetch worldfootball');
  const html = await res.text();
  const $ = cheerio.load(html);

  const sections = {};
  // worldfootball lists Additions and Departures as tables under headings
  $('h2, h3').each((i, el) => {
    const title = $(el).text().trim();
    if (/Additions/i.test(title) || /Departures/i.test(title)) {
      const key = /Additions/i.test(title) ? 'in' : 'out';
      const tbl = $(el).nextAll('table').first();
      if (!tbl || !tbl.length) return;
      const rows = [];
      tbl.find('tbody tr').each((ri, r) => {
        const cols = $(r).find('td').map((ci, c) => $(c).text().trim()).get();
        if (cols.length < 3) return;
        // typical cols: [date, country, name, pos, from, to]
        const date = cols[0] || '';
        const name = cols[2] || cols[1] || '';
        const pos = cols[3] || '';
        const from = cols[4] || '';
        const to = cols[5] || '';
        rows.push({ date, name, pos, from, to });
      });
      sections[key] = rows;
    }
  });
  return sections;
}

function compare(local, remote) {
  const report = { missingIn: [], missingOut: [], mismatches: [] };

  const localInNames = new Map((local.in || []).map(i => [normalizeName(i.player), i]));
  const localOutNames = new Map((local.out || []).map(o => [normalizeName(o.player), o]));

  for (const r of (remote.in || [])) {
    const n = normalizeName(r.name);
    if (!localInNames.has(n)) report.missingIn.push(r);
  }
  for (const r of (remote.out || [])) {
    const n = normalizeName(r.name);
    if (!localOutNames.has(n)) report.missingOut.push(r);
  }

  return report;
}

async function main() {
  try {
    const local = readLocal();
    const remote = await fetchWF();
    const report = compare(local, remote);
    console.log('Comparison report:');
    console.log('Missing In (on worldfootball but not local):', report.missingIn.length);
    report.missingIn.forEach(r => console.log(` - ${r.date} ${r.name} from ${r.from}`));
    console.log('Missing Out (on worldfootball but not local):', report.missingOut.length);
    report.missingOut.forEach(r => console.log(` - ${r.date} ${r.name} to ${r.to}`));
    if (!report.missingIn.length && !report.missingOut.length) console.log('No obvious differences found.');
  } catch (e) {
    console.error('Failed:', e.message);
    process.exit(1);
  }
}

if (require.main === module) main();
