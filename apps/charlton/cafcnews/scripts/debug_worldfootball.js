#!/usr/bin/env node
const puppeteer = require('puppeteer');

async function run() {
  const url = 'https://www.worldfootball.net/teams/charlton-athletic/';
  const launchOpts = { args: ['--no-sandbox','--disable-setuid-sandbox'] };
  if (process.env.PUPPETEER_EXECUTABLE_PATH) launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  const browser = await puppeteer.launch(launchOpts);
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36');
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  const html = await page.content();
  await browser.close();
  const links = [];
  const cheerio = require('cheerio');
  const $ = cheerio.load(html);
  $('a').each((i, a) => {
    const href = $(a).attr('href') || '';
    const text = $(a).text().replace(/\s+/g,' ').trim();
    if (/2026/.test(href) || /2026/.test(text) || /spielplan|matches|schedule|tab\/matches/i.test(href)) links.push({href, text});
  });
  console.log('Found', links.length, 'candidate links:');
  links.forEach(l => console.log(l.href, '->', l.text));
}

run().catch(e=>{ console.error(e); process.exit(1); });
