# ncysaclubtool.github.io
NCYSA club tool

## PlayMetrics tournament feed

`scripts/playmetrics-tournaments.mjs` reads NCYSA's sanctioned tournaments from
https://playmetricssports.com/g/tournaments/138/North-Carolina once a day and saves them to
`data/tournaments.json`. The ncsoccer.org Events page reads that file for its Next Tournament card.

- Runs daily around 6 AM Eastern. To update now: Actions tab > Update PlayMetrics tournaments > Run workflow.
- If a run fails, the last good `data/tournaments.json` stays in place and the card keeps working.
- `data/debug/` holds a screenshot and what the bot read on its last run, for troubleshooting.
