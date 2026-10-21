// Keeps a record of tournaments that have already been played, so the Sanctioned Tournaments page
// can show "Past tournaments" for the season. PlayMetrics only lists upcoming events, so before each
// update this copies anything that has ended out of data/tournaments.json into data/past.json.
// It also seeds past.json from the full NCYSA list in data/extras.json. Safe to run any number of times.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const read = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };
const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })).toISOString().slice(0, 10);
const feed = read('data/tournaments.json', { tournaments: [] });
const extras = read('data/extras.json', { tournaments: [], logos: {}, aliases: {} });
const past = read('data/past.json', { tournaments: [] });
const alias = extras.aliases || {}, logos = extras.logos || {};

const abbr = (name) => {
  for (const w of String(name || '').split(/\s+/)) {
    const c = w.replace(/[^A-Za-z]/g, '');
    if (c.length >= 2 && c.length <= 6 && c === c.toUpperCase() && /[A-Z]/.test(c)) return alias[c] || c;
  }
  return null;
};
// Same tournament = same club tag, start within 3 days, and mostly the same words in the name
const GENERIC = /^(20\d\d|the|and|girls|boys|fall|spring|summer|winter)$/;
const words = (n) => { const a = (abbr(n) || '').toLowerCase(); return new Set(String(n).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 ? !(GENERIC.test(w) || w === a) : false)); };
const day = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5;
function same(a, b) {
  if (abbr(a.name) !== abbr(b.name)) return false;
  if (Math.abs(day(a.start) - day(b.start)) > 3) return false;
  const A = [...words(a.name)], B = [...words(b.name)];
  const hit = A.filter((w) => B.some((v) => v.slice(0, 5) === w.slice(0, 5))).length;
  return hit / Math.max(1, Math.min(A.length, B.length)) > 0.5;
}
const rows = past.tournaments.slice();
const key = (t) => t.name + '|' + t.start;

function add(t) {
  const end = t.end || t.start;
  if (!t.start || end >= today) return;
  const k = key(t);
  const prev = rows.find((r) => same(r, t));
  const row = {
    id: t.id || 'past-' + k.replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
    name: t.name, start: t.start, end,
    city: t.city || null, ages: t.ages || null, venue: t.venue || null,
    ncysaUrl: t.ncysaUrl || t.url || null, websiteUrl: t.websiteUrl || t.website || null,
    logo: t.logo || logos[abbr(t.name)] || (/falcons united/i.test(t.name) ? logos.FU : null) || null,
  };
  if (prev) { for (const f of Object.keys(row)) if (!prev[f] ? row[f] : false) prev[f] = row[f]; }
  else { rows.push(row); }
}
(feed.tournaments || []).forEach(add);
(extras.tournaments || []).forEach((t) => add({ ...t, ncysaUrl: t.url, websiteUrl: t.website }));

const list = rows.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
const out = { updated: new Date().toISOString(), note: 'Sanctioned tournaments that have already been played. Kept by scripts/archive-past.mjs.', count: list.length, tournaments: list };
const before = existsSync('data/past.json') ? readFileSync('data/past.json', 'utf8') : '';
const prevList = before ? JSON.stringify(JSON.parse(before).tournaments) : '';
if (prevList !== JSON.stringify(list)) { writeFileSync('data/past.json', JSON.stringify(out, null, 1) + '\n'); console.log('past.json:', list.length, 'played'); }
else console.log('past.json unchanged:', list.length);
