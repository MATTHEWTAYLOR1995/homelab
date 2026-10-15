import json
import logging
import os
import re
import sqlite3
import threading
import time
from contextlib import closing
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote_plus, urljoin

import requests
from bs4 import BeautifulSoup
from flask import Flask, jsonify, redirect, render_template, url_for

app = Flask(__name__)
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
log = logging.getLogger("drink-deals")
DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))
DB_PATH = DATA_DIR / "deals.sqlite3"
SCAN_INTERVAL = max(1, int(os.getenv("SCAN_INTERVAL_HOURS", "12"))) * 3600

RETAILERS = {
    "Amazon": "https://www.amazon.co.uk/s?k={query}",
    "Asda": "https://groceries.asda.com/search/{query}",
    "Iceland": "https://www.iceland.co.uk/search?q={query}",
    "Sainsbury's": "https://www.sainsburys.co.uk/gol-ui/SearchResults/{query}",
    "Waitrose": "https://www.waitrose.com/ecom/shop/search?searchTerm={query}",
    "Tesco": "https://www.tesco.com/groceries/en-GB/search?query={query}",
}
QUERIES = [
    "Diet Coke 24 cans", "Coca-Cola Zero Sugar 24 cans", "Diet Pepsi 24 cans",
    "Pepsi Max 24 cans", "Fanta Zero Sugar cans", "zero sugar soft drink cans multipack",
    "diet soft drinks cans multipack",
]
HEADERS = {"User-Agent": "DrinkDealsPersonalHomelab/1.0"}


def db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("""CREATE TABLE IF NOT EXISTS deals (
        id INTEGER PRIMARY KEY, retailer TEXT NOT NULL, title TEXT NOT NULL,
        url TEXT NOT NULL, pack_count INTEGER, price REAL,
        member_price REAL, member_label TEXT, promotion TEXT, bundle_quantity INTEGER, bundle_total REAL,
        availability TEXT, checked_at TEXT NOT NULL, UNIQUE(retailer,url,title)
    )""")
    conn.execute("CREATE TABLE IF NOT EXISTS scans (id INTEGER PRIMARY KEY, retailer TEXT, checked_at TEXT, status TEXT, message TEXT)")
    conn.commit()
    return conn


def money(value):
    try:
        return round(float(str(value).replace("£", "").replace(",", "").strip()), 2)
    except (TypeError, ValueError):
        return None


def pack_size(text):
    text = str(text).lower().replace(",", "")
    patterns = [r"(?:pack of|case of|x\s*)(\d{1,2})\s*(?:x\s*)?(?:330\s?ml|cans?|pk|pack)",
                r"(\d{1,2})\s*(?:x\s*\d{2,4}\s?ml)?\s*(?:cans?|pack)",
                r"(?:cans?|pack)\s*(?:x|of)?\s*(\d{1,2})"]
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            n = int(match.group(1))
            if 1 <= n <= 48:
                return n
    return None


def promotion_details(text):
    text = re.sub(r"\s+", " ", str(text))
    match = re.search(r"(?:buy\s*)?(\d+)\s*(?:packs?\s*)?for\s*£\s*(\d+(?:\.\d{1,2})?)", text, re.I)
    if match:
        return text[max(0, match.start()-25):min(len(text), match.end()+40)].strip(), int(match.group(1)), money(match.group(2))
    match = re.search(r"(?:clubcard price|nectar price|member price)", text, re.I)
    if match:
        return text[max(0, match.start()-25):min(len(text), match.end()+45)].strip(), None, None
    return None, None, None


def walk_products(value):
    if isinstance(value, dict):
        typ = value.get("@type", "")
        if "Product" in (typ if isinstance(typ, list) else [typ]):
            yield value
        for child in value.values():
            yield from walk_products(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk_products(child)


def offer_data(product):
    offers = product.get("offers") or {}
    if isinstance(offers, list):
        offers = offers[0] if offers else {}
    if isinstance(offers, dict) and isinstance(offers.get("offers"), list):
        offers = offers["offers"][0] if offers["offers"] else offers
    price = money(offers.get("price") or (offers.get("priceSpecification") or {}).get("price")) if isinstance(offers, dict) else None
    member = None
    label = None
    if isinstance(offers, dict):
        specs = offers.get("priceSpecification", [])
        if isinstance(specs, dict): specs = [specs]
        for spec in specs if isinstance(specs, list) else []:
            p = money(spec.get("price"))
            name = " ".join(str(spec.get(k, "")) for k in ("name", "description", "priceType"))
            if p and ("member" in name.lower() or "clubcard" in name.lower() or "nectar" in name.lower()):
                member, label = p, name.strip() or "Member price"
    return price, member, label, offers.get("availability") if isinstance(offers, dict) else None


def relevant(title):
    t = title.lower()
    beverage = any(k in t for k in ("coke", "cola", "pepsi", "fanta", "lemonade", "tonic", "soda", "pop", "soft drink", "sparkling water"))
    low_or_zero = any(k in t for k in ("zero", "diet", "max", "sugar free", "sugar-free", "no sugar", "light"))
    return beverage and low_or_zero


def scrape_retailer(retailer, base_url):
    found = {}
    last_error = None
    sample_url = base_url.format(query="robots")
    parts = urlsplit(sample_url)
    robots = RobotFileParser()
    robots.set_url(f"{parts.scheme}://{parts.netloc}/robots.txt")
    try:
        robots.read()
    except Exception as exc:
        return [], f"Could not read robots.txt; skipped for safety ({type(exc).__name__})"
    session = requests.Session()
    session.headers.update(HEADERS)
    for query in QUERIES:
        url = base_url.format(query=quote_plus(query))
        if not robots.can_fetch(HEADERS["User-Agent"], url):
            return [], "Retailer robots.txt disallows automated search-page access"
        try:
            response = session.get(url, timeout=18)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, "html.parser")
            for node in soup.select('script[type="application/ld+json"]'):
                try:
                    payload = json.loads(node.string or node.get_text())
                except (json.JSONDecodeError, TypeError):
                    continue
                for product in walk_products(payload):
                    title = str(product.get("name") or "").strip()
                    if not title or not relevant(title):
                        continue
                    price, member, label, availability = offer_data(product)
                    if not price and not member:
                        continue
                    link = product.get("url")
                    if not link:
                        link = (product.get("offers") or {}).get("url") if isinstance(product.get("offers"), dict) else None
                    link = urljoin(response.url, str(link or response.url))
                    details = " ".join(str(product.get(k, "")) for k in ("description", "name"))
                    key = (title.lower(), link)
                    promotion, bundle_quantity, bundle_total = promotion_details(details)
                    row = {"retailer": retailer, "title": title, "url": link,
                           "pack_count": pack_size(title + " " + details), "price": price,
                           "member_price": member, "member_label": label,
                           "promotion": promotion, "bundle_quantity": bundle_quantity, "bundle_total": bundle_total,
                           "availability": str(availability or "Unknown").split("/")[-1],
                           "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
                    found[key] = row
            time.sleep(1.2)
        except Exception as exc:
            last_error = f"{type(exc).__name__}: {exc}"
            log.warning("%s scan query failed (%s): %s", retailer, query, exc)
            time.sleep(1.2)
    return list(found.values()), last_error


def run_scan():
    checked = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with closing(db()) as conn:
        conn.execute("DELETE FROM deals")
        for retailer, base_url in RETAILERS.items():
            rows, error = scrape_retailer(retailer, base_url)
            conn.executemany("""INSERT OR REPLACE INTO deals
                (retailer,title,url,pack_count,price,member_price,member_label,promotion,bundle_quantity,bundle_total,availability,checked_at)
                VALUES (:retailer,:title,:url,:pack_count,:price,:member_price,:member_label,:promotion,:bundle_quantity,:bundle_total,:availability,:checked_at)""", rows)
            status = "ok" if rows else "unavailable"
            message = f"{len(rows)} product(s)" if rows else (error or "No structured product prices found")
            conn.execute("INSERT INTO scans(retailer,checked_at,status,message) VALUES(?,?,?,?)", (retailer, checked, status, message[:500]))
        conn.execute("DELETE FROM scans WHERE id NOT IN (SELECT id FROM scans ORDER BY id DESC LIMIT 60)")
        conn.commit()


scan_lock = threading.Lock()
def scan_in_background():
    if scan_lock.acquire(blocking=False):
        def work():
            try: run_scan()
            except Exception: log.exception("Deal scan failed")
            finally: scan_lock.release()
        threading.Thread(target=work, daemon=True, name="price-scan").start()


@app.get("/")
def index():
    with closing(db()) as conn:
        deals = [dict(r) for r in conn.execute("SELECT * FROM deals ORDER BY retailer, title")]
        def rank(d):
            cans = d.get("pack_count") or 0
            if cans and d.get("bundle_quantity") and d.get("bundle_total") is not None:
                return d["bundle_total"] / (cans * d["bundle_quantity"])
            if cans and d.get("member_price") is not None:
                return d["member_price"] / cans
            if cans and d.get("price") is not None:
                return d["price"] / cans
            return float("inf")
        deals.sort(key=rank)
        scans = [dict(r) for r in conn.execute("SELECT * FROM scans ORDER BY id DESC LIMIT 6")]
    return render_template("index.html", deals=deals, scans=scans, scanning=scan_lock.locked(), interval=SCAN_INTERVAL // 3600)


@app.post("/refresh")
def refresh():
    scan_in_background()
    return redirect(url_for("index"))


@app.get("/healthz")
def health():
    db().close()
    return jsonify(status="ok")


def scheduler():
    while True:
        with closing(db()) as conn:
            count = conn.execute("SELECT COUNT(*) FROM deals").fetchone()[0]
            latest = conn.execute("SELECT MAX(checked_at) FROM scans").fetchone()[0]
        if not count or not latest:
            scan_in_background()
        else:
            try:
                last = datetime.fromisoformat(latest.replace("Z", "+00:00"))
                if (datetime.now(timezone.utc) - last).total_seconds() >= SCAN_INTERVAL:
                    scan_in_background()
            except ValueError:
                scan_in_background()
        time.sleep(60)


if __name__ == "__main__":
    db().close()
    threading.Thread(target=scheduler, daemon=True, name="scan-scheduler").start()
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")))
