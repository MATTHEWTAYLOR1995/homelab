# DA3's Charlton News

An unofficial Charlton Athletic fan site with five main pages:

- **Home** (`/`) — a scroll-driven "120 years of Charlton" story: the background crossfades through different eras (1905 origins, the 1930s golden rise, the 1938 record crowd, the 1947 FA Cup, the 1985–92 wilderness years, the 1992 return home, today) as you scroll
- **Confirmed Transfers** (`/transfers/confirmed`) — every done deal, in and out, plus a "check the web" button
- **Gossip & Rumours** (`/transfers/rumours`) — transfer speculation with a "heat" rating, plus a "check the web" button
- **Season History** (`/seasons`) — every completed Charlton season since 1919–20: division, final position, manager, cup rounds, promotions/relegations and trophies, filterable by division tier
- **Fixtures** (`/fixtures`) — every league and cup fixture for the season, home and away, with kick-off times. This page is genuinely dynamic: every time it loads, the server compares each fixture's date/time against the current moment to work out what's next, what's still upcoming, and what's already been played — nothing is hand-flagged
- **Fun Facts** (`/facts`) — categorised Charlton trivia plus a "random fact" shuffle button

Built with Node.js + Express + EJS. No database — content lives in JSON files in `/data`, so it's easy to update by hand.

### Live "check the web" button

The Confirmed Transfers and Gossip & Rumours pages each have a **🔄 Check for updates** button. Pressing it calls the server's `/api/news` endpoint, which searches Google News' public RSS feed (no API key needed) for current Charlton transfer headlines and lists them with a rough "sounds confirmed / sounds like gossip" guess based on keywords in the headline.

Important honesty note: **this never edits the site automatically.** There's no reliable way for software to turn a headline into a structured "player X, fee Y, from club Z" entry — that still needs a human to read the story and judge it. The button is a research shortcut (it does the searching for you), not an auto-updater. When something checks out, add it to the relevant JSON file yourself.

Two things worth knowing about this feature:
- It needs the Docker container to have normal outbound internet access (it calls `news.google.com`). If your network is locked down, the button will fail gracefully with a message rather than crash the page.
- Results are cached in memory for 4 minutes, so mashing the button repeatedly won't hammer Google News.

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
