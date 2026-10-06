# Cycling dashboard

A small Flask app, containerized, that turns your Garmin/Zwift training data into:

- **Overview** — FTP, readiness, HRV, ACWR, weekly power trend, and monthly
  training-load balance vs. target zones (aerobic-low / aerobic-high / anaerobic).
- **This week** — an auto-generated 7-day Zwift plan, adjusted for your current
  load balance and readiness (e.g. it backs off high-intensity days if your
  ACWR is high or readiness is low, and adds VO2max work if your anaerobic
  load is behind target). Each day has a downloadable `.zwo` file.
- **Improvement** — normalized power trend over time, a recent-sessions table,
  and a couple of plain-language pointers on what to focus on next.

## Quick start (demo mode — no Garmin login needed)

```bash
cd garmin-dashboard
cp .env.example .env
docker compose up --build
```

Open **http://localhost:5000**. It runs immediately using a real snapshot of
your stats from July 2026 (`data/snapshot_seed.json`) so you can see the whole
thing working before deciding whether to connect live data.

## Live mode (pulls your real, current Garmin data)

### Recommended: Docker secrets (credentials never sit in plaintext env vars)

1. Copy the example secret files and fill in your real values:
   ```bash
   cp secrets/garmin_email.txt.example secrets/garmin_email.txt
   cp secrets/garmin_password.txt.example secrets/garmin_password.txt
   # edit both files, put only the raw value in each, no quotes
   chmod 600 secrets/garmin_email.txt secrets/garmin_password.txt
   ```
2. `docker compose up --build`. The compose file already mounts these as
   Docker secrets and points the app at them via `GARMIN_EMAIL_FILE` /
   `GARMIN_PASSWORD_FILE` - you don't need to touch `.env` for this.

Why this is better than putting them straight in `.env`:
- The values live in individual files with `600` permissions (owner read/write
  only), not as plaintext in a single `.env` that a lot of tools (shell
  history, `docker-compose config`, some IDE integrations) end up echoing.
- They don't show up under `docker inspect <container>`'s environment list or
  in `docker-compose config`'s rendered output, both of which happily print
  plain env vars in full.
- `secrets/.gitignore` blocks the real `.txt` files from ever being committed
  by accident - only the `.example` templates are tracked.

This only protects secrets *at rest and in tooling output*. Anyone with root
on the host, or shell access inside the running container, can still read
them - Docker secrets aren't a vault, just a much better default than a
plaintext `.env`.

### Simpler alternative: plain `.env`

If you'd rather skip the secrets files (e.g. quick local testing on a machine
only you use), just fill in `GARMIN_EMAIL`/`GARMIN_PASSWORD` directly in
`.env` and remove the `GARMIN_EMAIL_FILE`/`GARMIN_PASSWORD_FILE`
lines plus the `secrets:` block in `docker-compose.yml`. Still add `.env` to
`.gitignore` (already done) so it's never committed.

### Going further

If you want real secret rotation, audit logs, or to keep credentials off the
host entirely, look at a proper secrets manager instead - e.g. **Bitwarden
Secrets Manager**, **1Password CLI** (`op run --env-file=.env -- docker compose up`),
or **HashiCorp Vault**. All of these can inject the values at container start
without ever writing them to disk on the host - worth it if this box is
shared or internet-facing, overkill for a single-user home server.

Other live-mode notes:
- If your Garmin account has MFA enabled, the `garminconnect` library can't
  complete the login non-interactively. Easiest fix is a Garmin account
  without MFA, or a session-token approach (see the `garminconnect` project's
  docs for `garth` token-based login) — happy to wire that in if you hit this.
- If the live pull fails for any reason (bad credentials, MFA, Garmin API
  hiccup, rate limiting), the app automatically falls back to the last
  successful pull (`data/snapshot_cache.json`), or the seed snapshot if there
  isn't one yet — the dashboard never just breaks.

## Keeping data fresh automatically

When live mode is configured (`GARMIN_EMAIL`/`GARMIN_PASSWORD` set), a background
thread polls Garmin every **15 minutes by default** and refreshes the cache -
no need to click "Refresh" manually. Change the interval with:

```
POLL_INTERVAL_MINUTES=10
```

in `.env`. Page loads read from the cache (fast, no live API call per
request); the poller is what keeps that cache current. The page itself
also checks every 60 seconds whether the cache has changed and reloads
automatically when new data lands, so a browser tab left open stays current
too. The "Refresh" button in the top bar still works for an on-demand pull.

## Mobile

The layout is responsive - single-column cards, stacked nav, and a
horizontally-scrollable activity table below 600px width. Since it's served
over your local network, just open `http://<your-host-ip>:5000` from your
phone's browser.

## How the weekly plan is generated

`recommender.py` holds the logic:

- A default weekly skeleton for a **Mon/Tue/Thu/Fri riding schedule** (endurance /
  VO2max / rest / sweet spot / threshold), with Wednesday, Saturday, and Sunday
  as fixed full rest days — no session is ever scheduled on those days.
- If your monthly anaerobic load is well behind its target range and
  readiness is good, it adds a second high-intensity day on Thursday
  (upgrading sweet spot to VO2max), since the Wednesday rest day gives
  enough recovery from Tuesday's session to support it.
- If ACWR (acute:chronic load ratio) is over 1.3 — a sign you're piling on
  load faster than your body's adapting — every high-intensity day for the
  week gets swapped to recovery.
- "Today" additionally checks same-day readiness: below 40 forces recovery
  regardless of the plan; 40-60 downgrades VO2max/threshold days to sweet spot.

All of this is just a starting heuristic, not a coach — treat it as a
reasonable default you can override anytime.

## Editing session targets

All session power targets live in `SESSION_LIBRARY` in `recommender.py`,
expressed as fractions of FTP so they scale automatically as your FTP
changes. Add a new session type there and it becomes available for the
weekly skeleton and for direct `.zwo` download at `/session/<key>.zwo`.

## Project layout

```
garmin-dashboard/
├── app.py              Flask routes
├── garmin_client.py     Live fetch + fallback snapshot logic
├── recommender.py        Weekly plan + today's session logic
├── zwo_builder.py         Builds .zwo XML from a session definition
├── data/
│   ├── snapshot_seed.json   Real seed data (works out of the box)
│   └── snapshot_cache.json  Last live pull (created automatically)
├── templates/            Jinja2 templates
├── static/style.css
├── Dockerfile
├── docker-compose.yml
└── .env.example
```
