"""
Garmin data access layer.

Live mode: if GARMIN_EMAIL / GARMIN_PASSWORD are set in the environment,
a background poller authenticates with persistent Garmin OAuth tokens and
caches fresh stats to data/snapshot_cache.json. Page loads always read
from the cache (fast, no live API call per request) - the poller is what
keeps it current.

Fallback mode: if credentials are missing, login fails, or MFA is
required, falls back to data/snapshot_cache.json if present, else
data/snapshot_seed.json (a real snapshot pulled at setup time).
"""
import os
import json
import time
import logging
import statistics
import threading
from datetime import datetime, timedelta

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
SEED_PATH = os.path.join(DATA_DIR, "snapshot_seed.json")
CACHE_PATH = os.path.join(DATA_DIR, "snapshot_cache.json")
TOKENSTORE_PATH = os.environ.get(
    "GARMIN_TOKENSTORE", os.path.join(DATA_DIR, "garmin_tokens")
)
POLL_STATE_PATH = os.path.join(DATA_DIR, "garmin_poll_state.json")
DEFAULT_POLL_INTERVAL_SECONDS = int(os.environ.get("POLL_INTERVAL_MINUTES", "15")) * 60
MAX_POLL_BACKOFF_SECONDS = 24 * 60 * 60

logger = logging.getLogger("garmin_client")

_poll_lock = threading.Lock()
_last_poll_error = None
_consecutive_poll_failures = 0
_next_poll_at = 0.0
_retry_after_epoch = 0.0
_last_poll_attempt = 0.0


def get_secret(name):
    """Reads a secret from, in order of preference:
      1. A file path in {NAME}_FILE (the convention used by official Docker
         images like postgres/mysql for Docker secrets - keeps the value out
         of `docker inspect`, `docker-compose config`, and process env dumps).
      2. The plain {NAME} environment variable (simpler, but visible via
         `docker inspect` and `ps` on the host - fine for local-only use,
         less good if the host is shared or the compose file might be
         committed anywhere with real values).
    Returns None if neither is set.
    """
    file_path = os.environ.get(f"{name}_FILE")
    if file_path:
        try:
            with open(file_path) as f:
                return f.read().strip()
        except OSError as e:
            logger.warning("Could not read secret file for %s: %s", name, e)
            return None
    return os.environ.get(name)


def has_credentials():
    return bool(get_secret("GARMIN_EMAIL"))


def _load_json(path):
    with open(path) as f:
        return json.load(f)


def _load_poll_state():
    """Restore 429 backoff from the PVC so pod restarts do not retry early."""
    global _consecutive_poll_failures, _retry_after_epoch, _last_poll_error
    try:
        state = _load_json(POLL_STATE_PATH)
        _consecutive_poll_failures = max(0, int(state.get("consecutive_failures", 0)))
        _retry_after_epoch = max(0.0, float(state.get("retry_after_epoch", 0)))
        _last_poll_error = state.get("last_error")
    except FileNotFoundError:
        return
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as e:
        logger.warning("Could not restore Garmin poll retry state: %s", e)


def _save_poll_state():
    """Persist only retry metadata; never write credentials or Garmin tokens here."""
    temporary_path = f"{POLL_STATE_PATH}.tmp"
    try:
        with open(temporary_path, "w") as f:
            json.dump(
                {
                    "consecutive_failures": _consecutive_poll_failures,
                    "retry_after_epoch": _retry_after_epoch,
                    "last_error": _last_poll_error,
                },
                f,
            )
        os.chmod(temporary_path, 0o600)
        os.replace(temporary_path, POLL_STATE_PATH)
    except OSError as e:
        logger.warning("Could not save Garmin poll retry state: %s", e)


def _clear_poll_state():
    try:
        os.remove(POLL_STATE_PATH)
    except FileNotFoundError:
        pass
    except OSError as e:
        logger.warning("Could not clear Garmin poll retry state: %s", e)


_load_poll_state()


def _fallback_snapshot():
    if os.path.exists(CACHE_PATH):
        return _load_json(CACHE_PATH)
    return _load_json(SEED_PATH)


def _weekly_np_trend(activities):
    """Bucket activities with recorded power into week-starting-Monday buckets."""
    buckets = {}
    for a in activities:
        np_w = a.get("np_w") or a.get("normalized_power_w")
        if not np_w:
            continue
        try:
            d = datetime.fromisoformat(a["date"][:10])
        except Exception:
            continue
        week_start = d - timedelta(days=d.weekday())
        key = week_start.strftime("%Y-%m-%d")
        buckets.setdefault(key, []).append(np_w)

    trend = []
    for key in sorted(buckets.keys()):
        vals = buckets[key]
        week_start = datetime.strptime(key, "%Y-%m-%d")
        week_end = week_start + timedelta(days=6)
        label = f"{week_start.strftime('%b %-d')}-{week_end.strftime('%-d')}"
        trend.append({"week_label": label, "avg_np_w": round(statistics.mean(vals))})
    return trend


def fetch_live():
    """Attempt a real Garmin Connect pull. Raises on any failure."""
    import garminconnect  # imported lazily so the app runs without the package in demo mode

    email = get_secret("GARMIN_EMAIL")
    password = get_secret("GARMIN_PASSWORD")
    if not email or not password:
        raise RuntimeError("Garmin credentials not configured")

    os.makedirs(TOKENSTORE_PATH, mode=0o700, exist_ok=True)
    try:
        os.chmod(TOKENSTORE_PATH, 0o700)
    except OSError as e:
        logger.warning("Could not restrict Garmin token directory permissions: %s", e)

    client = garminconnect.Garmin(email, password)
    client.login(TOKENSTORE_PATH)

    today = datetime.now().strftime("%Y-%m-%d")
    since = (datetime.now() - timedelta(days=42)).strftime("%Y-%m-%d")

    max_metrics = client.get_max_metrics(today) or [{}]
    mm = max_metrics[0] if isinstance(max_metrics, list) else max_metrics
    vo2_running = None
    vo2_cycling = None
    ftp = None
    try:
        vo2_running = mm.get("generic", {}).get("vo2MaxPreciseValue")
        vo2_cycling = mm.get("cycling", {}).get("vo2MaxPreciseValue")
    except Exception:
        pass

    training_status = client.get_training_status(today) or {}
    readiness = client.get_training_readiness(today) or [{}]
    r0 = readiness[0] if isinstance(readiness, list) and readiness else {}

    activities_raw = client.get_activities(0, 100) or []
    activities = []
    for a in activities_raw:
        start = a.get("startTimeLocal", "")
        if start < since:
            continue
        activities.append({
            "date": start[:10],
            "name": a.get("activityName", ""),
            "type": a.get("activityType", {}).get("typeKey", ""),
            "duration_min": round((a.get("duration") or 0) / 60, 1),
            "avg_power_w": a.get("avgPower"),
            "np_w": a.get("normPower") or a.get("avgPower"),
        })

    hrv_data = client.get_hrv_data(today) or {}

    ftp_val = None
    try:
        ftp_val = client.get_user_summary(today).get("functionalThresholdPower")
    except Exception:
        pass

    snapshot = {
        "snapshot_date": today,
        "last_updated": datetime.now().isoformat(timespec="seconds"),
        "recovery": {
            "training_readiness_score": r0.get("score"),
            "training_readiness_level": r0.get("level"),
            "hrv_weekly_avg_ms": (hrv_data.get("hrvSummary", {}) or {}).get("weeklyAvg"),
            "hrv_status": (hrv_data.get("hrvSummary", {}) or {}).get("status"),
            "sleep_weekly_avg_hours": None,
            "sleep_weekly_avg_score": None,
            "training_status_feedback": training_status.get("mostRecentTrainingStatus", {}).get("latestTrainingStatusData", {}),
        },
        "fitness": {
            "vo2_max_running": vo2_running,
            "vo2_max_cycling": vo2_cycling,
            "cycling_ftp_w": ftp_val,
        },
        "training_load": {},
        "recent_load_42d": {},
        "weekly_power_trend": _weekly_np_trend(activities),
        "recent_activities": sorted(activities, key=lambda a: a["date"], reverse=True)[:20],
    }

    with open(CACHE_PATH, "w") as f:
        json.dump(snapshot, f, indent=2)

    return snapshot


def get_snapshot(force_refresh=False):
    """Read the cached snapshot, optionally requesting a guarded live refresh."""
    has_creds = has_credentials()

    if has_creds and (force_refresh or not os.path.exists(CACHE_PATH)):
        poll_once(force=force_refresh)

    if has_creds:
        mode = (
            "live (cached)"
            if _last_poll_error is None
            else f"live (cached, last poll failed: {_last_poll_error})"
        )
        return _fallback_snapshot(), mode

    return _fallback_snapshot(), "demo"


def poll_once(interval_seconds=DEFAULT_POLL_INTERVAL_SECONDS, force=False):
    """Fetch Garmin data once, reusing saved tokens and backing off after failures."""
    global _last_poll_error, _consecutive_poll_failures
    global _next_poll_at, _retry_after_epoch, _last_poll_attempt
    if not has_credentials():
        return False

    with _poll_lock:
        now = time.monotonic()
        if time.time() < _retry_after_epoch:
            logger.debug("Skipping Garmin poll during failure cooldown")
            return False
        if not force and now < _next_poll_at:
            return False
        if force and now - _last_poll_attempt < 60:
            logger.debug(
                "Skipping Garmin refresh requested within 60 seconds of the previous attempt"
            )
            return False

        _last_poll_attempt = now
        try:
            fetch_live()
            _last_poll_error = None
            _consecutive_poll_failures = 0
            _retry_after_epoch = 0.0
            _next_poll_at = time.monotonic() + interval_seconds
            _clear_poll_state()
            logger.info("Garmin poll succeeded")
            return True
        except Exception as e:
            _last_poll_error = f"{e.__class__.__name__}"
            _consecutive_poll_failures += 1
            is_rate_limited = "429" in str(e) or "TooManyRequests" in e.__class__.__name__
            base_delay = (
                max(interval_seconds, 60 * 60) if is_rate_limited else interval_seconds
            )
            delay = min(
                base_delay * (2 ** (_consecutive_poll_failures - 1)),
                MAX_POLL_BACKOFF_SECONDS,
            )
            _retry_after_epoch = time.time() + delay
            _next_poll_at = time.monotonic() + delay
            _save_poll_state()
            logger.warning(
                "Garmin poll failed; retrying in %s seconds (failure %s): %s",
                delay,
                _consecutive_poll_failures,
                e,
            )
            return False


def start_background_poller(interval_seconds=DEFAULT_POLL_INTERVAL_SECONDS):
    """Start one background poller that respects retries and token reuse."""
    if not has_credentials():
        return None

    def _loop():
        poll_once(interval_seconds)
        while True:
            now = time.monotonic()
            next_run = _next_poll_at if _next_poll_at > now else now + interval_seconds
            time.sleep(max(1, min(interval_seconds, next_run - now)))
            poll_once(interval_seconds)

    thread = threading.Thread(target=_loop, name="garmin-poller", daemon=True)
    thread.start()
    return thread
