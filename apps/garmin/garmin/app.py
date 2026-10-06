import os
from flask import Flask, render_template, Response, redirect, url_for

import garmin_client
import recommender
import zwo_builder

app = Flask(__name__)

POLL_INTERVAL_SECONDS = int(os.environ.get("POLL_INTERVAL_MINUTES", "15")) * 60
garmin_client.start_background_poller(POLL_INTERVAL_SECONDS)


def load_context(force_refresh=False):
    snapshot, mode = garmin_client.get_snapshot(force_refresh=force_refresh)
    ftp = (snapshot.get("fitness", {}) or {}).get("cycling_ftp_w")
    week_plan = recommender.build_week_plan(snapshot)
    today = recommender.recommend_today(snapshot)
    last_updated = snapshot.get("last_updated") or snapshot.get("snapshot_date")
    return snapshot, mode, ftp, week_plan, today, last_updated


@app.route("/")
def dashboard():
    snapshot, mode, ftp, week_plan, today, last_updated = load_context()
    return render_template(
        "dashboard.html",
        snapshot=snapshot, mode=mode, ftp=ftp,
        week_plan=week_plan, today=today, last_updated=last_updated,
        poll_interval_seconds=POLL_INTERVAL_SECONDS,
    )


@app.route("/week")
def week():
    snapshot, mode, ftp, week_plan, today, last_updated = load_context()
    return render_template(
        "week_plan.html",
        snapshot=snapshot, mode=mode, ftp=ftp,
        week_plan=week_plan, today=today, last_updated=last_updated,
        poll_interval_seconds=POLL_INTERVAL_SECONDS,
    )


@app.route("/improvement")
def improvement():
    snapshot, mode, ftp, week_plan, today, last_updated = load_context()
    return render_template(
        "improvement.html",
        snapshot=snapshot, mode=mode, ftp=ftp, last_updated=last_updated,
        poll_interval_seconds=POLL_INTERVAL_SECONDS,
    )


@app.route("/api/last-updated")
def api_last_updated():
    """Lightweight endpoint the page polls from the browser to know when to reload."""
    snapshot, mode = garmin_client.get_snapshot()
    return {"last_updated": snapshot.get("last_updated") or snapshot.get("snapshot_date"), "mode": mode}


@app.route("/refresh", methods=["POST"])
def refresh():
    load_context(force_refresh=True)
    return redirect(url_for("dashboard"))


@app.route("/session/<session_key>.zwo")
def download_session(session_key):
    snapshot, mode, ftp, week_plan, today, last_updated = load_context()
    session = recommender.SESSION_LIBRARY.get(session_key)
    if not session:
        return "Unknown session", 404
    if session_key == "rest":
        return "Rest day - no workout file needed.", 200
    xml = zwo_builder.build_zwo(session_key, session, ftp)
    return Response(
        xml,
        mimetype="application/xml",
        headers={"Content-Disposition": f"attachment; filename={session_key}.zwo"},
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=os.environ.get("FLASK_DEBUG") == "1")
