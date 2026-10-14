# ncysaclubtool.github.io
NCYSA club tool

## PlayMetrics tournament feed

`scripts/playmetrics-tournaments.mjs` reads NCYSA's sanctioned tournaments from
https://playmetricssports.com/g/tournaments/138/North-Carolina once a day and saves them to
`data/tournaments.json`. The ncsoccer.org Events page reads that file for its Next Tournament card.

- Runs daily around 6 AM Eastern. To update now: Actions tab > Update PlayMetrics tournaments > Run workflow.
- If a run fails, the last good `data/tournaments.json` stays in place and the card keeps working.
- `data/debug/` holds a screenshot and what the bot read on its last run, for troubleshooting.

## NCYSA key dates

`data/events.json` holds the NCYSA 2026-27 key dates (meetings, State Cup, Youth Academy, Classic League,
ODP, coaching courses, deadlines, office closures). The Events page and the homepage Coming Up strip both
read it. To change a date: open the file on GitHub, click the pencil icon, edit, and Commit changes.
The site picks it up within a few minutes.

## Logos and tournaments not in PlayMetrics yet

`data/extras.json` holds club logos (by abbreviation, e.g. `NCFCY`) and the NCYSA list of sanctioned tournaments.
Each morning `scripts/merge-extras.mjs`:

- fills in a logo when PlayMetrics has none,
- adds any upcoming NCYSA tournament that is not in PlayMetrics yet (marked `pm: false`).

On the events page these show a small gold dot on the date. Add `#review` to the page address to see them labeled "Not in PlayMetrics yet".
Once a tournament is added in PlayMetrics (same club abbreviation, start within 3 days), the PlayMetrics version replaces it automatically.
To add a new sanctioned tournament that is not in PlayMetrics, add it to the `tournaments` list in `data/extras.json`.
