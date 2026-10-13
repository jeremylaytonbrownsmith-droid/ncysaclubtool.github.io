// Reads the NCYSA sanctioned tournament list from PlayMetrics and saves it to data/tournaments.json.
// Runs daily from .github/workflows/playmetrics-tournaments.yml. If nothing can be read, the
// previous file is left untouched and the run fails, so the website keeps the last good list.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const SOURCE = process.env.SOURCE_URL || 'https://playmetricssports.com/g/tournaments/138/North-Carolina';
const OUT = 'data/tournaments.json';
const DEBUG = 'data/debug';
mkdirSync(DEBUG, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });

// Keep any JSON the page loads, so the parser can move to PlayMetrics' own data later if needed.
const captured = [];
page.on('response', async (res) => {
  try {
    const type = res.headers()['content-type'] || '';
    if (!type.includes('json')) return;
    const body = await res.text();
    if (/tournament/i.test(body)) captured.push({ url: res.url(), body: body.slice(0, 500000) });
  } catch {}
});

await page.goto(SOURCE, { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => /\d+\s+tournaments?/i.test(document.body.innerText), null, { timeout: 60000 }).catch(() => {});

// Scroll to the bottom a few times in case the list loads in pages.
for (let i = 0; i < 12; i++) {
  const before = await page.evaluate(() => document.body.scrollHeight);
  await page.mouse.wheel(0, 4000);
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => document.body.scrollHeight);
  if (after === before && i > 2) break;
}

const result = await page.evaluate(() => {
  const DATE = /([A-Z][a-z]{2,8}\.? \d{1,2}, \d{4})(?:\s*[–—-]\s*([A-Z][a-z]{2,8}\.? \d{1,2}, \d{4}))?/g;
  const countDates = (t) => (t.match(DATE) || []).length;
  const stated = (document.body.innerText.match(/(\d+)\s+tournaments?/i) || [])[1];

  // Smallest elements whose text is just a date or date range.
  const dateEls = [...document.querySelectorAll('body *')].filter((el) => {
    const t = (el.innerText || '').trim();
    return t.length < 60 && countDates(t) === 1 && [...el.children].every((c) => countDates(c.innerText || '') === 0);
  });

  // Walk up from each date to the largest box that still holds only that one tournament.
  const cards = [];
  for (const el of dateEls) {
    let card = el;
    while (card.parentElement && countDates(card.parentElement.innerText || '') === 1) card = card.parentElement;
    if (!cards.includes(card)) cards.push(card);
  }

  return {
    stated: stated ? +stated : null,
    cards: cards.map((card) => {
      const lines = card.innerText.split('\n').map((s) => s.trim()).filter(Boolean);
      const links = [...card.querySelectorAll('a')].map((a) => ({ text: (a.innerText || '').trim(), href: a.href }));
      const img = card.querySelector('img');
      return { lines, links, logo: img ? img.src : null };
    }),
  };
});

await page.screenshot({ path: `${DEBUG}/playmetrics.png`, fullPage: true });
writeFileSync(`${DEBUG}/captured-json.json`, JSON.stringify(captured.map((c) => ({ url: c.url, sample: c.body.slice(0, 4000) })), null, 2));
writeFileSync(`${DEBUG}/cards.json`, JSON.stringify(result, null, 2));
await browser.close();

const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
function iso(s) {
  const m = s && s.match(/([A-Za-z]+)\.? (\d{1,2}), (\d{4})/);
  if (!m) return null;
  const mo = MON[m[1].toLowerCase().slice(0, m[1].toLowerCase().startsWith('sept') ? 4 : 3)];
  return mo ? `${m[3]}-${String(mo).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}` : null;
}
function addDays(n) {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const DATE1 = /([A-Z][a-z]{2,8}\.? \d{1,2}, \d{4})(?:\s*[–—-]\s*([A-Z][a-z]{2,8}\.? \d{1,2}, \d{4}))?/;
const tournaments = [];
for (const c of result.cards) {
  const dateLine = c.lines.find((l) => DATE1.test(l));
  if (!dateLine) continue;
  const [, a, b] = dateLine.match(DATE1);
  const skip = (l) => DATE1.test(l) || /^registration/i.test(l) || /^(register|view schedule|tournament)$/i.test(l);
  const rest = c.lines.filter((l) => !skip(l));
  const name = rest[0];
  if (!name) continue;

  const placeLine = rest.find((l) => /\b(NC|SC|VA|GA|TN)\b/.test(l) && l !== name) || '';
  const [city, ...ageParts] = placeLine.split('|').map((s) => s.trim());
  const venue = (rest.find((l) => /^location:/i.test(l)) || '').replace(/^location:\s*/i, '');

  const regLine = c.lines.find((l) => /registration closes/i.test(l)) || '';
  let registrationCloses = null;
  const n = regLine.match(/in (\d+) days?/i);
  if (n) registrationCloses = addDays(+n[1]);
  else if (/today/i.test(regLine)) registrationCloses = addDays(0);
  else if (/tomorrow/i.test(regLine)) registrationCloses = addDays(1);

  const reg = c.links.find((l) => /register/i.test(l.text));
  const sched = c.links.find((l) => /schedule/i.test(l.text));

  tournaments.push({
    name,
    start: iso(a),
    end: iso(b || a),
    city: city || null,
    ages: ageParts.join(' | ') || null,
    venue: venue || null,
    registrationOpen: !!reg,
    registrationCloses,
    registerUrl: reg ? reg.href : null,
    scheduleUrl: sched ? sched.href : null,
    logo: c.logo && !/placeholder|default/i.test(c.logo) ? c.logo : null,
  });
}

tournaments.sort((x, y) => (x.start || '').localeCompare(y.start || ''));
console.log(`PlayMetrics says ${result.stated ?? '?'} tournaments; read ${tournaments.length}.`);
tournaments.forEach((t) => console.log(` ${t.start}  ${t.name}  (${t.city || 'no city'})`));

if (!tournaments.length) {
  console.error('No tournaments read. Leaving the previous data/tournaments.json in place.');
  process.exit(1);
}
if (result.stated && tournaments.length < result.stated * 0.5) {
  console.error(`Only ${tournaments.length} of ${result.stated} read. Leaving the previous file in place.`);
  process.exit(1);
}

writeFileSync(OUT, JSON.stringify({
  updated: new Date().toISOString(),
  source: SOURCE,
  statedCount: result.stated,
  count: tournaments.length,
  tournaments,
}, null, 2) + '\n');
console.log(`Saved ${OUT}`);
