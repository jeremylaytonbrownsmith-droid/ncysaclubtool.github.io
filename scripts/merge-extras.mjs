// Runs after the PlayMetrics read. Uses data/extras.json to:
//  1. Fill in club logos that PlayMetrics does not have (matched by club abbreviation in the name).
//  2. Add sanctioned tournaments that are not in PlayMetrics yet, marked pm:false.
//     A tournament counts as "in PlayMetrics" when a PlayMetrics entry has the same club
//     abbreviation and starts within 3 days. Once Colin adds it there, the extra drops off by itself.
// Safe to run any number of times: it removes its own previous additions first.
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'data/tournaments.json';
const feed = JSON.parse(readFileSync(FILE, 'utf8'));
const extras = JSON.parse(readFileSync('data/extras.json', 'utf8'));
const alias = extras.aliases || {};
const logos = extras.logos || {};

const abbr = (name) => {
  for (const w of String(name || '').split(/\s+/)) {
    const c = w.replace(/[^A-Za-z]/g, '');
    if (c.length >= 2 && c.length <= 6 && c === c.toUpperCase() && /[A-Z]/.test(c)) return alias[c] || c;
  }
  return null;
};
const day = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5;
const parse = (s) => { const t = s ? new Date(s + ' 12:00') : null; return t && !isNaN(t) ? t.toISOString().slice(0, 10) : null; };
const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })).toISOString().slice(0, 10);

const pm = (feed.tournaments || []).filter((t) => t.pm !== false);
let filled = 0;
for (const t of pm) {
  const a = abbr(t.name);
  if (!t.logo) { const l = logos[a] || (/falcons united/i.test(t.name) ? logos.FU : null); if (l) { t.logo = l; t.logoFrom = 'ncysa'; filled++; } }
}

const added = [];
for (const x of extras.tournaments || []) {
  if ((x.end || x.start) < today) continue;
  const a = alias[x.assoc] || x.assoc;
  const found = pm.some((t) => abbr(t.name) === a && Math.abs(day(t.start) - day(x.start)) <= 3);
  if (found) continue;
  const closes = parse(x.deadline);
  added.push({
    id: 'ncysa-' + x.url.replace(/\/$/, '').split('/').pop(),
    name: x.name, start: x.start, end: x.end || x.start, city: x.city, ages: x.ages, venue: x.venue || null,
    registrationOpen: !!closes && closes >= today, registrationCloses: closes,
    registerUrl: null, scheduleUrl: null, websiteUrl: x.url, clubUrl: x.website || null,
    logo: logos[a] || null, pm: false,
  });
}

feed.tournaments = [...pm, ...added].sort((x, y) => x.start.localeCompare(y.start) || x.name.localeCompare(y.name));
feed.notInPlayMetrics = added.length;
writeFileSync(FILE, JSON.stringify(feed, null, 2) + '\n');
console.log(`Logos filled: ${filled}. Not in PlayMetrics yet: ${added.length}`);
added.forEach((t) => console.log(`  ${t.start}  ${t.name}`));
