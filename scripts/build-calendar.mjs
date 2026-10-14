// Builds data/ncysa.ics, a calendar people can subscribe to in Google, Apple or Outlook.
// It combines the NCYSA key dates (data/events.json), the sanctioned tournaments from
// PlayMetrics (data/tournaments.json) and the monthly State of NC Meeting.
// Runs after the PlayMetrics update every morning, so subscribers always see the current list.
import { readFileSync, writeFileSync } from 'node:fs';

const read = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; } };
const events = read('data/events.json').events || [];
const tourn = read('data/tournaments.json').tournaments || [];

const CAT = { meeting: 'Meetings and Governance', statecup: 'State Cup', academy: 'Youth Academy', classic: 'Classic League',
  odp: 'ODP', coaching: 'Coaching Education', deadline: 'Deadline', office: 'NCYSA Office Closed', tourn: 'Sanctioned Tournament' };

const day = (iso) => iso.replace(/-/g, '');
const nextDay = (iso) => { const [y, m, d] = iso.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + 1)); return t.toISOString().slice(0, 10).replace(/-/g, ''); };
const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const uid = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h.toString(36); };
function fold(line) {
  const out = []; let cur = line;
  while (Buffer.byteLength(cur, 'utf8') > 74) {
    let n = 74; while (Buffer.byteLength(cur.slice(0, n), 'utf8') > 74) n--;
    out.push(cur.slice(0, n)); cur = ' ' + cur.slice(n);
  }
  out.push(cur); return out.join('\r\n');
}
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

const L = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NCYSA//Tournaments and Events//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
  'X-WR-CALNAME:NCYSA Tournaments & Events', 'X-WR-CALDESC:NCYSA sanctioned tournaments and key dates. www.ncsoccer.org',
  'X-WR-TIMEZONE:America/New_York', 'REFRESH-INTERVAL;VALUE=DURATION:PT12H', 'X-PUBLISHED-TTL:PT12H',
  'BEGIN:VTIMEZONE', 'TZID:America/New_York',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0400', 'TZNAME:EDT', 'DTSTART:19700308T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:-0400', 'TZOFFSETTO:-0500', 'TZNAME:EST', 'DTSTART:19701101T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD',
  'END:VTIMEZONE',
];

function add(e) {
  L.push('BEGIN:VEVENT', `UID:${e.uid}@ncsoccer.org`, `DTSTAMP:${stamp}`, ...e.lines, `SUMMARY:${esc(e.title)}`);
  if (e.loc) L.push(`LOCATION:${esc(e.loc)}`);
  if (e.desc) L.push(`DESCRIPTION:${esc(e.desc)}`);
  if (e.url) L.push(`URL:${e.url}`);
  L.push(`CATEGORIES:${esc(e.cat)}`, 'TRANSP:TRANSPARENT', 'END:VEVENT');
}

let n = 0;
for (const x of events) {
  if (x.tba || !x.s) continue;
  if (x.label && /TBD/i.test(x.label)) continue;           // month-only placeholders would fill a whole month
  add({
    uid: 'ev-' + uid(x.t + x.s), title: x.t, loc: x.loc, cat: CAT[x.cat] || 'NCYSA',
    lines: [`DTSTART;VALUE=DATE:${day(x.s)}`, `DTEND;VALUE=DATE:${nextDay(x.e || x.s)}`],
    desc: [CAT[x.cat], x.note, 'NCYSA Tournaments & Events: https://www.ncsoccer.org'].filter(Boolean).join('\n'),
  });
  n++;
}
for (const t of tourn) {
  if (!t.start) continue;
  const reg = t.registrationOpen && t.registrationCloses ? `Registration closes ${t.registrationCloses}` : 'Registration not open yet';
  add({
    uid: 'tn-' + (t.id || uid(t.name + t.start)), title: t.name, loc: [t.venue, t.city].filter(Boolean).join(' / '), cat: CAT.tourn,
    lines: [`DTSTART;VALUE=DATE:${day(t.start)}`, `DTEND;VALUE=DATE:${nextDay(t.end || t.start)}`],
    desc: ['NCYSA Sanctioned Tournament', t.ages, reg, t.registerUrl ? 'Register: ' + t.registerUrl : '', t.scheduleUrl ? 'Schedule: ' + t.scheduleUrl : ''].filter(Boolean).join('\n'),
    url: t.registerUrl || t.scheduleUrl || '',
  });
  n++;
}
// Monthly State of NC Meeting: third Wednesday at noon Eastern, through the end of the season
add({
  uid: 'state-of-nc-meeting', title: 'State of NC Meeting', cat: CAT.meeting,
  lines: ['DTSTART;TZID=America/New_York:20260819T120000', 'DTEND;TZID=America/New_York:20260819T130000', 'RRULE:FREQ=MONTHLY;BYDAY=3WE;UNTIL=20270630T235959Z'],
  desc: 'Monthly NCYSA meeting, every third Wednesday at 12:00 PM.',
});
n++;

L.push('END:VCALENDAR');
writeFileSync('data/ncysa.ics', L.map(fold).join('\r\n') + '\r\n');
console.log(`Saved data/ncysa.ics with ${n} entries.`);
