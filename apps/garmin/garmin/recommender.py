"""
Turns Garmin metrics into a weekly training plan and a specific
recommendation for today, expressed as %FTP so it works regardless
of the rider's absolute power numbers.
"""
from datetime import datetime

SESSION_LIBRARY = {
    "rest": {
        "title": "Full rest day",
        "why": "Not a riding day — full rest, no session.",
        "structure": [],
        "warmup_min": 0, "cooldown_min": 0,
        "color": "#5b6472", "icon": "moon", "ftp_pct": None,
    },
    "recovery": {
        "title": "Recovery spin",
        "why": "Readiness or load says take it easy today.",
        "structure": [
            {"kind": "steady", "duration_min": 30, "low": 0.45, "high": 0.55, "label": "Easy spin"},
        ],
        "warmup_min": 5, "cooldown_min": 5,
        "color": "#64748b", "icon": "leaf", "ftp_pct": 0.50,
    },
    "endurance": {
        "title": "Endurance base ride",
        "why": "Builds aerobic-low volume, which your monthly focus feedback flags as the priority zone.",
        "structure": [
            {"kind": "steady", "duration_min": 45, "low": 0.62, "high": 0.72, "label": "Steady endurance"},
        ],
        "warmup_min": 5, "cooldown_min": 5,
        "color": "#3b82f6", "icon": "wave", "ftp_pct": 0.67,
    },
    "tempo": {
        "title": "Tempo ride",
        "why": "Sits just below threshold to build aerobic-high volume without heavy fatigue cost.",
        "structure": [
            {"kind": "steady", "duration_min": 35, "low": 0.76, "high": 0.85, "label": "Tempo"},
        ],
        "warmup_min": 5, "cooldown_min": 5,
        "color": "#22c55e", "icon": "arrow_up_right", "ftp_pct": 0.805,
    },
    "sweet_spot": {
        "title": "Sweet spot 3x10",
        "why": "Efficient threshold-adjacent work — big aerobic-high gains for moderate fatigue.",
        "structure": [
            {"kind": "intervals", "reps": 3, "on_min": 10, "off_min": 5, "on_low": 0.88, "on_high": 0.94, "off": 0.55, "label": "Sweet spot"},
        ],
        "warmup_min": 8, "cooldown_min": 7,
        "color": "#eab308", "icon": "target", "ftp_pct": 0.91,
    },
    "threshold": {
        "title": "Threshold 2x15",
        "why": "Raises FTP directly — good when aerobic-high load is behind target and legs are fresh.",
        "structure": [
            {"kind": "intervals", "reps": 2, "on_min": 15, "off_min": 6, "on_low": 0.98, "on_high": 1.03, "off": 0.55, "label": "Threshold"},
        ],
        "warmup_min": 8, "cooldown_min": 7,
        "color": "#f97316", "icon": "mountain", "ftp_pct": 1.005,
    },
    "vo2max": {
        "title": "VO2max 5x3",
        "why": "Your anaerobic load is at 0 against a target of up to 262 — this is the gap to close.",
        "structure": [
            {"kind": "intervals", "reps": 5, "on_min": 3, "off_min": 3, "on_low": 1.10, "on_high": 1.18, "off": 0.58, "label": "VO2max"},
        ],
        "warmup_min": 10, "cooldown_min": 10,
        "color": "#ef4444", "icon": "bolt", "ftp_pct": 1.14,
    },
}

# Default weekly skeleton. Rider rides Mon, Tue, Thu, Fri; Wed, Sat, and
# Sun are fixed rest days off the bike entirely (not "recovery spin" - no
# session at all).
DEFAULT_WEEK_SKELETON = {
    0: "endurance",   # Monday
    1: "vo2max",      # Tuesday
    2: "rest",        # Wednesday - off the bike, mid-week rest
    3: "sweet_spot",  # Thursday
    4: "threshold",   # Friday - last ride before 2 full rest days, so it can carry intensity
    5: "rest",        # Saturday - off the bike
    6: "rest",        # Sunday - off the bike
}

RIDING_DAYS = {0, 1, 3, 4}


GAUGE_MIN_PCT = 0.45  # recovery-spin intensity, left edge of the dial
GAUGE_MAX_PCT = 1.18  # vo2max intensity, right edge of the dial


def _gauge_angle(ftp_pct):
    """Maps an %FTP intensity to a 0-180 degree needle angle for the dial."""
    if not ftp_pct:
        return 0
    frac = (ftp_pct - GAUGE_MIN_PCT) / (GAUGE_MAX_PCT - GAUGE_MIN_PCT)
    frac = max(0.0, min(1.0, frac))
    return round(frac * 180, 1)


def _anaerobic_gap(load):
    target_max = load.get("anaerobic_target_max", 0) or 0
    current = load.get("monthly_load_anaerobic", 0) or 0
    return max(target_max - current, 0)


def _aerobic_high_gap(load):
    target_min = load.get("aerobic_high_target_min", 0) or 0
    current = load.get("monthly_load_aerobic_high", 0) or 0
    return max(target_min - current, 0)


def build_week_plan(snapshot):
    load = snapshot.get("training_load", {}) or {}
    readiness = (snapshot.get("recovery", {}) or {}).get("training_readiness_score") or 70
    acwr = load.get("load_ratio", 1.0) or 1.0

    plan = []
    skeleton = dict(DEFAULT_WEEK_SKELETON)

    # If anaerobic gap is large and load ratio isn't already high, put more
    # VO2max/threshold work in; if overreaching (acwr > 1.3), swap to recovery.
    # Only riding days (Mon-Fri) are ever touched - weekend rest is fixed.
    if acwr > 1.3:
        skeleton = {
            k: ("recovery" if (k in RIDING_DAYS and v in ("vo2max", "threshold", "sweet_spot")) else v)
            for k, v in skeleton.items()
        }
    elif _anaerobic_gap(load) > 150 and readiness >= 70:
        skeleton[3] = "vo2max"  # add a second high-intensity day on Thursday (Wed rest gives recovery from Tue's session)

    day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    ftp = (snapshot.get("fitness", {}) or {}).get("cycling_ftp_w")
    for i, day in enumerate(day_names):
        session_key = skeleton[i]
        session = SESSION_LIBRARY[session_key]
        target_w = round(session["ftp_pct"] * ftp) if (session["ftp_pct"] and ftp) else None
        plan.append({
            "day": day,
            "day_short": day[:3],
            "session_key": session_key,
            "title": session["title"],
            "why": session["why"],
            "color": session["color"],
            "icon": session["icon"],
            "target_w": target_w,
            "is_today": i == datetime.now().weekday(),
        })
    return plan


def recommend_today(snapshot):
    load = snapshot.get("training_load", {}) or {}
    readiness = (snapshot.get("recovery", {}) or {}).get("training_readiness_score") or 70
    acwr = load.get("load_ratio", 1.0) or 1.0

    weekday = datetime.now().weekday()
    week_plan = build_week_plan(snapshot)
    today_entry = week_plan[weekday]
    session_key = today_entry["session_key"]

    if weekday not in RIDING_DAYS:
        session = SESSION_LIBRARY["rest"]
        return {
            "session_key": "rest", "title": session["title"], "reason": session["why"],
            "session": session, "color": session["color"], "icon": session["icon"],
            "target_w": None, "gauge_angle": 0,
        }

    # Safety override: poor readiness or high ACWR always wins, regardless
    # of what the weekly skeleton says.
    if readiness < 40 or acwr > 1.5:
        session_key = "recovery"
        reason = "Readiness/load says recover today — everything else can wait."
    elif readiness < 60 and session_key in ("vo2max", "threshold"):
        session_key = "sweet_spot"
        reason = "Readiness is moderate, so easing off peak intensity to sweet spot instead."
    else:
        reason = SESSION_LIBRARY[session_key]["why"]

    session = SESSION_LIBRARY[session_key]
    ftp = (snapshot.get("fitness", {}) or {}).get("cycling_ftp_w")
    target_w = round(session["ftp_pct"] * ftp) if (session["ftp_pct"] and ftp) else None
    target_w_low = round(target_w * 0.96) if target_w else None
    target_w_high = round(target_w * 1.04) if target_w else None
    return {
        "session_key": session_key,
        "title": session["title"],
        "reason": reason,
        "session": session,
        "color": session["color"],
        "icon": session["icon"],
        "target_w": target_w,
        "target_w_low": target_w_low,
        "target_w_high": target_w_high,
        "gauge_angle": _gauge_angle(session["ftp_pct"]),
    }
