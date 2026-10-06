const fs = require('fs');
const path = require('path');
const fetch = globalThis.fetch || require('node-fetch');
const cheerio = require('cheerio');

const TEAM_ID = '358'; // Charlton Athletic on Transfermarkt
const TM_URL = process.argv[2] || 'https://www.transfermarkt.co.uk/charlton-athletic/transfers/verein/358';
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

function normalizeClubName(name) {
  return name.replace(/\s+\(.*\)$/, '').trim();
}

async function importTransfers() {
  const candidates = [
    TM_URL,
    TM_URL + '/plus',
    TM_URL + `?saison_id=${SEASON}`,
    TM_URL + `/plus?saison_id=${SEASON}`,
    TM_URL + `?ajax=yw1&saison_id=${SEASON}`,
    TM_URL + `/plus?ajax=yw1&saison_id=${SEASON}`
  ];

  const allFound = [];
  for (const url of candidates) {
    try {
      console.log('Fetching', url);
      const html = await fetchPage(url);
      const $ = cheerio.load(html);

      // parse rows on this page
      const rows = $('tr').toArray();
      for (const row of rows) {
        const $row = $(row);
        const playerLink = $row.find('a[href*="/spieler/"]').first();
        if (!playerLink || !playerLink.length) continue;
        const player = playerLink.text().trim();

        // avoid duplicates across pages
        if (allFound.some(f => f.player === player)) continue;

        // collect club links in this row
        const clubLinks = $row.find('a[href*="/verein/"]').toArray().map(el => ({
          href: $(el).attr('href') || '',
          name: $(el).text().trim()
        }));

        const tdTexts = $row.find('td').toArray().map(td => $(td).text().trim()).filter(Boolean);

        // date detection
        const dateRegexes = [ /\d{1,2}\.\d{1,2}\.\d{2,4}/, /\d{4}-\d{2}-\d{2}/, /[A-Za-z]{3,}\s+\d{1,2},?\s*\d{4}/, /\d{1,2}\s+[A-Za-z]{3,}\s+\d{4}/ ];
        let dateText = '';
        for (const t of tdTexts) {
          for (const r of dateRegexes) {
            const m = t.match(r);
            if (m) { dateText = m[0]; break; }
          }
          if (dateText) break;
        }

        const feeRegex = /(€|£)\s?\d+[.,]?\d*k?|undisclosed|loan|end of loan|loan fee|free/i;
        const feeText = tdTexts.find(t => feeRegex.test(t)) || '';

        const positions = ['Goalkeeper','Defender','Midfielder','Forward','Winger','Left-back','Right-back','Centre-back','Striker'];
        let position = '';
        for (const t of tdTexts) {
          for (const p of positions) {
            if (new RegExp('\\b' + p.replace('-','\\-') + '\\b','i').test(t)) {
              position = p; break;
            }
          }
          if (position) break;
        }

        let direction = null;
        let otherClub = '';
        const isCharltonHref = href => href && href.includes('/verein/358');
        const nonCharltonClubs = clubLinks.filter(c => !isCharltonHref(c.href));
        const charltonClubs = clubLinks.filter(c => isCharltonHref(c.href));
        if (charltonClubs.length && nonCharltonClubs.length) {
          const firstHref = clubLinks[0] && clubLinks[0].href;
          if (isCharltonHref(firstHref)) { direction = 'out'; otherClub = normalizeClubName(nonCharltonClubs[0].name); }
          else { direction = 'in'; otherClub = normalizeClubName(nonCharltonClubs[0].name); }
        } else if (nonCharltonClubs.length === 1 && !charltonClubs.length) {
          const rowText = $row.text();
          if (/to|joins|signed|joins the club|signed for|wechselt zu/i.test(rowText)) direction = 'in';
          else if (/from|leaves|left|verlässt/i.test(rowText)) direction = 'out';
          otherClub = normalizeClubName(nonCharltonClubs[0].name);
        }

        const rowTextLower = $row.text().toLowerCase();
        const isWomen = clubLinks.some(c => /frauen|women/i.test(c.name)) || /women|frauen/.test(rowTextLower);

        if (!direction) continue;

        allFound.push({ player, date: dateText || null, fee: feeText || '', direction, club: otherClub || '', position, team: isWomen ? 'women' : 'men' });
      }
    } catch (err) {
      console.error('Fetch/parse failed for', url, err.message || err);
    }
  }

  const found = allFound;

  const rows = $('tr').toArray();
  const found = [];

  for (const row of rows) {
    const $row = $(row);
    const playerLink = $row.find('a[href*="/spieler/"]').first();
    if (!playerLink || !playerLink.length) continue;
    const player = playerLink.text().trim();

    // collect club links in this row
    const clubLinks = $row.find('a[href*="/verein/"]').toArray().map(el => ({
      href: $(el).attr('href') || '',
      name: $(el).text().trim()
    }));

    // gather all td texts for analysis
    const tdTexts = $row.find('td').toArray().map(td => $(td).text().trim()).filter(Boolean);

    // date detection (support several formats)
    const dateRegexes = [ /\d{1,2}\.\d{1,2}\.\d{2,4}/, /\d{4}-\d{2}-\d{2}/, /[A-Za-z]{3,}\s+\d{1,2},?\s*\d{4}/, /\d{1,2}\s+[A-Za-z]{3,}\s+\d{4}/ ];
    let dateText = '';
    for (const t of tdTexts) {
      for (const r of dateRegexes) {
        const m = t.match(r);
        if (m) { dateText = m[0]; break; }
      }
      if (dateText) break;
    }

    // fee detection: look for currency or loan/end of loan/free/undisclosed
    const feeRegex = /(€|£)\s?\d+[.,]?\d*k?|undisclosed|loan|end of loan|loan fee|free/i;
    const feeText = tdTexts.find(t => feeRegex.test(t)) || '';

    // try to detect position from common keywords
    const positions = ['Goalkeeper','Defender','Midfielder','Forward','Winger','Left-back','Right-back','Centre-back','Striker'];
    let position = '';
    for (const t of tdTexts) {
      for (const p of positions) {
        if (new RegExp('\\b' + p.replace('-','\\-') + '\\b','i').test(t)) {
          position = p; break;
        }
      }
      if (position) break;
    }

    // determine direction & other club
    let direction = null;
    let otherClub = '';
    const isCharltonHref = href => href && href.includes('/verein/358');
    const nonCharltonClubs = clubLinks.filter(c => !isCharltonHref(c.href));
    const charltonClubs = clubLinks.filter(c => isCharltonHref(c.href));
    if (charltonClubs.length && nonCharltonClubs.length) {
      // if Charlton appears in first club link, treat as out; otherwise in
      const firstHref = clubLinks[0] && clubLinks[0].href;
      if (isCharltonHref(firstHref)) { direction = 'out'; otherClub = normalizeClubName(nonCharltonClubs[0].name); }
      else { direction = 'in'; otherClub = normalizeClubName(nonCharltonClubs[0].name); }
    } else if (nonCharltonClubs.length === 1 && !charltonClubs.length) {
      // sometimes only one club is linked — guess from surrounding text
      const rowText = $row.text();
      if (/to|joins|signed|joins the club|signed for|wechselt zu/i.test(rowText)) direction = 'in';
      else if (/from|leaves|left|verlässt/i.test(rowText)) direction = 'out';
      otherClub = normalizeClubName(nonCharltonClubs[0].name);
    }

    // detect women's team (Transfermarkt often includes 'women' in club or link)
    const rowTextLower = $row.text().toLowerCase();
    const isWomen = clubLinks.some(c => /frauen|women/i.test(c.name)) || /women|frauen/.test(rowTextLower);

    if (!direction) continue; // skip if we couldn't determine direction

    found.push({ player, date: dateText || null, fee: feeText || '', direction, club: otherClub || '', position, team: isWomen ? 'women' : 'men' });
  }

  // read existing data and merge
  const data = readJSON('transfers-confirmed.json');
  const existingNames = new Set([...(data.in || []).map(i => i.player), ...(data.out || []).map(o => o.player)]);

  let added = 0;
  for (const f of found) {
    if (existingNames.has(f.player)) continue;
    const entry = {
      player: f.player,
      position: f.position || '',
      date: f.date || (new Date()).toISOString().slice(0,10),
      fee: f.fee || 'Undisclosed',
      window: SEASON.toString(),
      note: `Imported from Transfermarkt (${TM_URL})`,
      team: f.team || 'men'
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
    existingNames.add(f.player);
    added += 1;
    console.log('Added', f.player, f.direction, f.club || '');
  }

  data.lastUpdated = new Date().toISOString().slice(0,10);
  writeJSON('transfers-confirmed.json', data);

  console.log(`Import complete — ${added} new transfer(s) added from ${candidates.length} candidate URLs.`);
}

importTransfers().catch(err => {
  console.error('Import failed:', err.message || err);
  process.exit(1);
});
