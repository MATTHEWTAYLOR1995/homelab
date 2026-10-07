# Charlton News

An unofficial Charlton Athletic fan site with five main pages:

- **Home** (`/`) — a scroll-driven "120 years of Charlton" story: the background crossfades through different eras (1905 origins, the 1930s golden rise, the 1938 record crowd, the 1947 FA Cup, the 1985–92 wilderness years, the 1992 return home, today) as you scroll
- **Confirmed Transfers** (`/transfers/confirmed`) — manually maintained official deals, in and out
- **Gossip & Rumours** (`/transfers/rumours`) — automatically refreshed Charlton headlines and recently tracked transfer speculation
- **Season History** (`/seasons`) — every completed Charlton season since 1919–20: division, final position, manager, cup rounds, promotions/relegations and trophies, filterable by division tier
- **Fixtures** (`/fixtures`) — fixtures and results. On page load, the browser calls `/api/fixtures`; the server checks 11v11 for missing scores at most once every 10 minutes and updates `data/fixtures.json`. A failed source check is logged and retried after 15 minutes. Scores use the source's home-away order.
- **Fun Facts** (`/facts`) — categorised Charlton trivia plus a "random fact" shuffle button

Built with Node.js + Express + EJS. No database — content lives in JSON files in `/data`, so it's easy to update by hand.

### Automatic Charlton news headlines

The Gossip & Rumours page loads Google News RSS headlines from the last seven days when opened and refreshes them every 15 minutes while the page remains open. The **Refresh headlines** button requests an immediate update. Results are cached in memory for 15 minutes, so multiple visitors share the same feed request. The container needs outbound internet access to `news.google.com`.

Headlines link to reporting; they are not verified transfer facts and are never written into the site's JSON data. Confirmed deals remain manually maintained in `data/transfers-confirmed.json`. Transfer rumours in `data/transfers-rumours.json` older than 30 days are hidden from the current pages so stale speculation does not appear current.

## Run it with Docker (recommended)

```bash
docker compose up --build
```

Then visit **http://localhost:3000**.

The `docker-compose.yml` mounts `./data` into the container, so you can edit the JSON files on your machine and just refresh the browser — no rebuild needed.

To stop it:

```bash
docker compose down
```

## Run it without Docker

```bash
npm install
npm start
```

Visit http://localhost:3000. (Requires Node 18+.)

## Updating the content

Everything lives in three files under `data/`:

- **`data/transfers-confirmed.json`** — add a new entry to `in` or `out`. Each entry has `player`, `position`, `from`/`to`, `date`, `fee`, `window`, and `note`.
- **`data/transfers-rumours.json`** — add to the `rumours` array. `heat` is 1–5 (how strongly it's being reported), `direction` is `"in"` or `"out"`.
- **`data/seasons.json`** — one entry per season. Already populated for 1919–20 through 2025–26; the entry for `"2026-27"` can be filled in as the season progresses (position, cup rounds, top scorer, etc.) using the same shape as the existing rows.
- **`data/fixtures.json`** — one entry per fixture: `date` (YYYY-MM-DD), `kickoff` (24hr HH:MM), `competition`, `venue` (`"home"` or `"away"`), `opponent`, `ground`, and optionally `round`, `note`, `tbcTime` (true if the kick-off time might still move for TV), and `homeScore`/`awayScore` once a match has been played. The page works out "next match", "upcoming" and "results" from these dates automatically — you don't need to move fixtures between sections yourself, just keep the list up to date as the EFL confirms more rounds or reschedules games.

Save the file, refresh the browser — the server reads the JSON fresh on every request, so changes show up immediately with the container running.

## A note on accuracy

The season-by-season league record, cup rounds, promotions and relegations are transcribed from Charlton's official season-by-season history and are solid. Manager attributions from the Alan Curbishley era (1991) onward are well documented; a handful of the pre-1980s entries are compiled from historical records and are worth double-checking against the club's own archive before you treat them as gospel.

Transfer and rumour data reflects the state of the window as of **17 July 2026** — update the JSON as the summer window moves.

## Project structure

```
da3s-charlton-news/
├── server.js              # Express app + routes
├── data/                  # Edit these to update site content
│   ├── seasons.json
│   ├── transfers-confirmed.json
│   └── transfers-rumours.json
├── views/                 # EJS templates
│   ├── partials/
│   ├── home.ejs
│   ├── transfers-confirmed.ejs
│   ├── transfers-rumours.ejs
│   ├── seasons.ejs
│   └── 404.ejs
├── public/css/style.css
├── Dockerfile
└── docker-compose.yml
```
