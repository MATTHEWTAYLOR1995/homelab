#!/usr/bin/env node
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');

async function run() {
  const url = 'https://www.11v11.com/teams/charlton-athletic/tab/matches/';
  const launchOpts = { args: ['--no-sandbox', '--disable-setuid-sandbox'] };
  if (process.env.PUPPETEER_EXECUTABLE_PATH) launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  const browser = await puppeteer.launch(launchOpts);
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36');
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  const html = await page.content();
  await browser.close();

  const $ = cheerio.load(html);
  const table = $('table.width580.sortable tbody');
  const rows = table.length ? table.find('tr').toArray() : $('table tr').toArray();
  console.log(`Found ${rows.length} rows`);
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const r = rows[i];
    const tds = $(r).find('td').toArray().map(td => $(td).text().replace(/\s+/g, ' ').trim());
    console.log(i+1, JSON.stringify(tds));
  }
}

run().catch(e=>{ console.error(e); process.exit(1); });
