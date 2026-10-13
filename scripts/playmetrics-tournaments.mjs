// Reads the NCYSA sanctioned tournament list from PlayMetrics and saves it to data/tournaments.json.
// Runs daily from .github/workflows/playmetrics-tournaments.yml.
//
// How it reads: it opens the public PlayMetrics tournament page in a browser, notes the data request
// that page makes (tournament_promotions/search), then asks for every page of results. If that fails
// it falls back to reading the tournament cards on the page itself.
// If nothing can be read, the previous file is left untouched and the run fails, so the website keeps
// the last good list.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const SOURCE = process.env.SOURCE_URL || 'https://playmetricssports.com/g/tournaments/138/North-Carolina';
const OUT = 'data/tournaments.json';
const DEBUG = 'data/debug';
mkdirSync(DEBUG, { recursive: true });

const STATES = { 'North Carolina': 'NC', 'South Carolina': 'SC', Virginia: 'VA', Georgia: 'GA', Tennessee: 'TN' };
const log = [];
const note = (s) => { log.push(s); console.log(s); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });

// 1. Watch the page's own data requests.
const searches = [];
page.on('response', async (res) => {
  try {
    if (!/tournament_promotions\/search/.test(res.url())) return;
    const req = res.request();
    searches.push({ url: req.url(), method: req.method(), headers: req.headers(), body: req.postData(), json: await res.json() });
  } catch {}
});

await page.goto(SOURCE, { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => /\d+\s+tournaments?/i.test(document.body.innerText), null, { timeout: 60000 }).catch(() => {});
const stated = await page.evaluate(() => { const m = document.body.innerText.match(/(\d+)\s+tournaments?/i); return m ? +m[1] : null; });

// Scroll, and press any "load more" style button, in case the page loads more results itself.
for (let i = 0; i < 15; i++) {
  await page.mouse.wheel(0, 5000);
  await page.waitForTimeout(800);
  const more = page.getByRole('button', { name: /load more|show more|more tournaments|next/i });
  if (await more.count().catch(() => 0)) await more.first().click().catch(() => {});
}
await page.waitForTimeout(1500);

// 2. Collect every tournament the page received.
const byId = new Map();
const add = (rows) => (rows || []).forEach((r) => r && r.id != null && byId.set(r.id, r));
searches.forEach((s) => add(s.json && s.json.data));
note(`PlayMetrics says ${stated ?? '?'} tournaments. Page loaded ${byId.size} from ${searches.length} data request(s).`);

// 3. If the page held some back, ask the same data address for the next pages.
const first = searches[0];
if (first && stated && byId.size < stated) {
  const meta = Object.fromEntries(Object.entries(first.json).filter(([k]) => k !== 'data'));
  note(`Paging info from PlayMetrics: ${JSON.stringify(meta).slice(0, 300)}`);
  note(`Request: ${first.method} ${first.url} ${first.body ? 'body ' + first.body.slice(0, 300) : ''}`);
  const headers = Object.fromEntries(Object.entries(first.headers).filter(([k]) => !/^(content-length|host|cookie|:)/i.test(k)));
  const per = (first.json.data || []).length || 10;

  const tries = [];
  for (let p = 1; p <= 20; p++) {
    let url = new URL(first.url), body = first.body;
    // Body paging (JSON) and URL paging, both page-number and offset styles.
    if (body) {
      try {
        const b = JSON.parse(body);
        const set = (o) => {
          for (const k of Object.keys(o)) {
            if (/^page$|page_number|pageNumber/i.test(k)) o[k] = typeof o[k] === 'number' ? o[k] + p : p + 1;
            else if (/offset|skip|start/i.test(k)) o[k] = p * per;
            else if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) set(o[k]);
          }
        };
        set(b);
        if (!/"(page|offset|skip)/i.test(body)) { b.page = p + 1; b.offset = p * per; }
        body = JSON.stringify(b);
      } catch {}
    }
    if (!body || first.method === 'GET') {
      if (url.searchParams.has('page')) url.searchParams.set('page', String(+url.searchParams.get('page') + p));
      else if (url.searchParams.has('offset')) url.searchParams.set('offset', String(p * per));
      else { url.searchParams.set('page', String(p + 1)); url.searchParams.set('offset', String(p * per)); }
    }
    tries.push({ url: url.toString(), body });
  }

  for (const t of tries) {
    if (byId.size >= stated) break;
    try {
      const r = await fetch(t.url, { method: first.method, headers, body: first.method === 'GET' ? undefined : t.body });
      const j = await r.json();
      const before = byId.size;
      add(j.data);
      if (byId.size === before) break; // nothing new, stop paging
    } catch (e) { note(`Paging stopped: ${e.message}`); break; }
  }
  note(`After paging: ${byId.size} tournaments.`);
}

// 4. Backup: read the cards on the page.
let cards = [];
if (!byId.size) {
  cards = await page.evaluate(() => {
    const DATE = /([A-Z][a-z]{2,8}\.? \d{1,2}, \d{4})(?:\s*[–—-]\s*([A-Z][a-z]{2,8}\.? \d{1,2}, \d{4}))?/g;
    const n = (t) => (t.match(DATE) || []).length;
    const els = [...document.querySelectorAll('body *')].filter((el) => {
      const t = (el.innerText || '').trim();
      return t.length < 60 && n(t) === 1 && [...el.children].every((c) => n(c.innerText || '') === 0);
    });
    const out = [];
    for (const el of els) {
      let c = el;
      while (c.parentElement && n(c.parentElement.innerText || '') === 1) c = c.parentElement;
      if (!out.includes(c)) out.push(c);
    }
    return out.map((c) => c.innerText.split('\n').map((s) => s.trim()).filter(Boolean));
  });
  note(`Data feed not available. Read ${cards.length} cards from the page instead.`);
}

await page.screenshot({ path: `${DEBUG}/playmetrics.png`, fullPage: true });
await browser.close();

// 5. Build the clean list.
function ageText(list, label) {
  if (!list || !list.length) return '';
  const nums = list.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < nums.length; i++) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    parts.push(i === j ? `U${nums[i]}` : `U${nums[i]}–U${nums[j]}`);
    i = j;
  }
  if (list.includes('18+')) parts.push('U18+');
  return `${label} ${parts.join(', ')}`;
}
const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

let tournaments = [...byId.values()].map((r) => {
  const a = r.address || {};
  const st = STATES[a.state] || a.state || '';
  const short = clean(r.short_description);
  return {
    id: r.id,
    name: clean(r.name),
    start: r.tournament_start_date,
    end: r.tournament_end_date || r.tournament_start_date,
    city: a.city ? `${clean(a.city).replace(/,\s*(NC|SC|VA)$/i, '')}${st ? ', ' + st : ''}` : null,
    ages: [ageText(r.eligibility && r.eligibility.male, 'Male'), ageText(r.eligibility && r.eligibility.female, 'Female')].filter(Boolean).join(' | ') || null,
    venue: /^location:/i.test(short) ? short.replace(/^location:\s*/i, '') : null,
    registrationOpen: !!r.is_registration_open,
    registrationCloses: r.registration_end_date || null,
    registerUrl: r.registration_link || null,
    scheduleUrl: r.schedule_link || null,
    websiteUrl: r.website_url || null,
    logo: r.club_image_url || null,
  };
});

if (!tournaments.length && cards.length) {
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const iso = (s) => { const m = s && s.match(/([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})/); return m && MON[m[1].toLowerCase()] ? `${m[3]}-${String(MON[m[1].toLowerCase()]).padStart(2, '0')}-${m[2].padStart(2, '0')}` : null; };
  const D = /([A-Z][a-z]{2,8}\.? \d{1,2}, \d{4})(?:\s*[–—-]\s*([A-Z][a-z]{2,8}\.? \d{1,2}, \d{4}))?/;
  tournaments = cards.map((lines) => {
    const dl = lines.find((l) => D.test(l)); if (!dl) return null;
    const [, a, b] = dl.match(D);
    const rest = lines.filter((l) => !D.test(l) && !/^registration|^(register|view schedule|tournament)$/i.test(l));
    const [city, ...ages] = (rest[1] || '').split('|').map((s) => s.trim());
    return { name: rest[0], start: iso(a), end: iso(b || a), city: city || null, ages: ages.join(' | ') || null, registrationOpen: lines.includes('Register') };
  }).filter((t) => t && t.name && t.start);
}

tournaments.sort((x, y) => (x.start || '').localeCompare(y.start || '') || x.name.localeCompare(y.name));
tournaments.forEach((t) => note(` ${t.start}  ${t.name}  (${t.city || 'no city'})`));
writeFileSync(`${DEBUG}/last-run.txt`, log.join('\n') + '\n');

if (!tournaments.length) {
  console.error('No tournaments read. Leaving the previous data/tournaments.json in place.');
  process.exit(1);
}
if (stated && tournaments.length < stated * 0.5) {
  console.error(`Only ${tournaments.length} of ${stated} read. Leaving the previous file in place.`);
  process.exit(1);
}

writeFileSync(OUT, JSON.stringify({
  updated: new Date().toISOString(),
  source: SOURCE,
  statedCount: stated,
  count: tournaments.length,
  complete: !stated || tournaments.length >= stated,
  tournaments,
}, null, 2) + '\n');
note(`Saved ${OUT} with ${tournaments.length} tournaments.`);
