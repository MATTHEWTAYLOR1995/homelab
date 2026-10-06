from xml.sax.saxutils import escape


def build_zwo(session_key, session, ftp_w, name_override=None):
    ftp_w = ftp_w or 250  # sane fallback if FTP unknown
    name = escape(name_override or session["title"])
    parts = [
        '<workout_file>',
        '<author>Claude</author>',
        f'<name>{name}</name>',
        f'<description>{escape(session["why"])} Based on FTP {ftp_w}W.</description>',
        '<sportType>bike</sportType>',
        '<tags><tag name="Generated"/></tags>',
        '<workout>',
        f'<Warmup Duration="{session["warmup_min"] * 60}" PowerLow="0.50" PowerHigh="0.70"/>',
    ]

    for block in session["structure"]:
        if block["kind"] == "steady":
            parts.append(
                f'<SteadyState Duration="{block["duration_min"] * 60}" '
                f'Power="{(block["low"] + block["high"]) / 2:.2f}"/>'
            )
        elif block["kind"] == "intervals":
            parts.append(
                f'<IntervalsT Repeat="{block["reps"]}" '
                f'OnDuration="{block["on_min"] * 60}" OffDuration="{block["off_min"] * 60}" '
                f'OnPower="{(block["on_low"] + block["on_high"]) / 2:.2f}" '
                f'OffPower="{block["off"]:.2f}" Cadence="90" CadenceResting="85"/>'
            )

    parts.append(f'<Cooldown Duration="{session["cooldown_min"] * 60}" PowerLow="0.60" PowerHigh="0.40"/>')
    parts.append('</workout>')
    parts.append('</workout_file>')
    return "\n".join(parts)
