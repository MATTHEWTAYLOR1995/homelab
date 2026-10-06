#!/usr/bin/env node
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');

async function run() {
  const url = 'https://www.worldfootball.net/teams/te371/charlton-athletic/all-matches/';
  const launchOpts = { args: ['--no-sandbox','--disable-setuid-sandbox'] };
  if (process.env.PUPPETEER_EXECUTABLE_PATH) launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  const browser = await puppeteer.launch(launchOpts);
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36');
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  const html = await page.content();
  await browser.close();
  const $ = cheerio.load(html);
  const tables = $('table').toArray();
  console.log('Found', tables.length, 'tables on the page');
  for (let t=0;t<Math.min(tables.length,10);t++){
    const trs = $(tables[t]).find('tr').toArray();
    console.log(`Table ${t+1} has ${trs.length} rows`);
    for (let i=0;i<Math.min(trs.length,6);i++){
      const cols = $(trs[i]).find('td,th').toArray().map(td => $(td).text().replace(/\s+/g,' ').trim());
      console.log(`  Row ${i+1}:`, JSON.stringify(cols));
    }
  }
}

run().catch(e=>{ console.error(e); process.exit(1); });
