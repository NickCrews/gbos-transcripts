"""Download audio from YouTube using yt-dlp.

Pipeline stage 1: Discover new videos → download audio WAV → insert meeting row.
"""

from __future__ import annotations

import re
import sqlite3
from pathlib import Path
from typing import Any

import yt_dlp

from .config import (
    AUDIO_DIR,
    AUDIO_FORMAT,
    GBOS_CHANNEL_URL,
    MUNICIPALITY_NAME,
    MUNICIPALITY_SHORT_NAME,
    MUNICIPALITY_STATE,
    ensure_data_dirs,
)
from .db import insert_meeting, open_and_init, upsert_municipality


# ---------------------------------------------------------------------------
# Date / type parsing from video titles
# ---------------------------------------------------------------------------

# Matches patterns like "January 21, 2025", "Jan 21 2025", "01/21/2025", "2025-01-21"
_DATE_PATTERNS = [
    # "January 21, 2025" or "Jan 21, 2025"
    (
        r"(?P<month_name>Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|"
        r"Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|"
        r"Nov(?:ember)?|Dec(?:ember)?)\s+(?P<day>\d{1,2}),?\s+(?P<year>\d{4})",
        "%B %d %Y",
    ),
    # "2025-01-21"
    (r"(?P<year>\d{4})-(?P<month>\d{2})-(?P<day>\d{2})", None),
    # "01/21/2025"
    (r"(?P<month>\d{1,2})/(?P<day>\d{1,2})/(?P<year>\d{4})", None),
]

_MONTH_MAP = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
    "january": 1, "february": 2, "march": 3, "april": 4,
    "june": 6, "july": 7, "august": 8, "september": 9,
    "october": 10, "november": 11, "december": 12,
}

_MEETING_TYPE_KEYWORDS: list[tuple[str, str]] = [
    ("work session", "work_session"),
    ("special meeting", "special"),
    ("special session", "special"),
    ("quarterly", "quarterly"),
    ("joint", "joint"),
    ("regular", "regular"),
]


def parse_meeting_date(title: str) -> str | None:
    """Extract ISO-8601 date string from a YouTube video title."""
    for pattern, _fmt in _DATE_PATTERNS:
        m = re.search(pattern, title, re.IGNORECASE)
        if not m:
            continue
        gd = m.groupdict()
        year = int(gd["year"])
        if "month_name" in gd:
            month = _MONTH_MAP[gd["month_name"].lower()[:3]]
        else:
            month = int(gd["month"])
        day = int(gd["day"])
        return f"{year:04d}-{month:02d}-{day:02d}"
    return None


def parse_meeting_type(title: str) -> str | None:
    """Infer meeting type from title keywords."""
    lower = title.lower()
    for keyword, mtype in _MEETING_TYPE_KEYWORDS:
        if keyword in lower:
            return mtype
    return None


# ---------------------------------------------------------------------------
# Playlist discovery
# ---------------------------------------------------------------------------

def fetch_playlist_entries(channel_url: str = GBOS_CHANNEL_URL) -> list[dict[str, Any]]:
    """Return list of {id, title, duration} dicts from a YouTube channel/playlist."""
    opts: dict[str, Any] = {
        "extract_flat": True,
        "quiet": True,
        "no_warnings": True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(channel_url, download=False)

    if info is None:
        return []

    entries = info.get("entries", [])
    result: list[dict[str, Any]] = []
    for entry in entries:
        if entry and entry.get("id"):
            result.append(
                {
                    "youtube_id": entry["id"],
                    "title": entry.get("title", ""),
                    "duration": entry.get("duration"),
                }
            )
    return result


# ---------------------------------------------------------------------------
# Audio download
# ---------------------------------------------------------------------------

def download_audio(youtube_id: str, output_dir: Path = AUDIO_DIR) -> Path:
    """Download audio for a YouTube video, return path to the WAV file."""
    output_dir.mkdir(parents=True, exist_ok=True)
    out_path = output_dir / f"{youtube_id}.{AUDIO_FORMAT}"

    if out_path.exists():
        return out_path

    url = f"https://www.youtube.com/watch?v={youtube_id}"
    opts: dict[str, Any] = {
        "format": "bestaudio/best",
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": AUDIO_FORMAT,
            }
        ],
        "outtmpl": str(output_dir / f"{youtube_id}.%(ext)s"),
        "quiet": True,
        "no_warnings": True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([url])

    return out_path


def get_video_duration(youtube_id: str) -> float | None:
    """Fetch duration (seconds) of a YouTube video without downloading."""
    url = f"https://www.youtube.com/watch?v={youtube_id}"
    opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        try:
            info = ydl.extract_info(url, download=False)
            return info.get("duration") if info else None
        except Exception:
            return None


# ---------------------------------------------------------------------------
# Pipeline stage: discover + download
# ---------------------------------------------------------------------------

def run_download(
    conn: sqlite3.Connection,
    channel_url: str = GBOS_CHANNEL_URL,
    *,
    max_new: int | None = None,
    dry_run: bool = False,
) -> list[int]:
    """Discover new videos and download audio.

    Returns list of meeting IDs that were newly inserted.
    """
    ensure_data_dirs()

    municipality_id = upsert_municipality(
        conn,
        name=MUNICIPALITY_NAME,
        short_name=MUNICIPALITY_SHORT_NAME,
        state=MUNICIPALITY_STATE,
        youtube_channel_url=channel_url,
    )

    entries = fetch_playlist_entries(channel_url)

    new_meeting_ids: list[int] = []
    count = 0

    for entry in entries:
        if max_new is not None and count >= max_new:
            break

        youtube_id = entry["youtube_id"]
        title = entry["title"]

        # Check if already in DB
        existing = conn.execute(
            "SELECT id, status FROM meetings WHERE youtube_id = ?", (youtube_id,)
        ).fetchone()
        if existing:
            continue

        meeting_date = parse_meeting_date(title)
        meeting_type = parse_meeting_type(title)

        if dry_run:
            print(f"[dry-run] Would download: {youtube_id} — {title}")
            continue

        # Download audio
        audio_path = download_audio(youtube_id)
        relative_audio = str(audio_path.relative_to(Path(__file__).parent.parent.parent.parent))

        meeting_id = insert_meeting(
            conn,
            municipality_id=municipality_id,
            youtube_id=youtube_id,
            title=title,
            meeting_date=meeting_date,
            meeting_type=meeting_type,
            duration_secs=entry.get("duration"),
            audio_path=relative_audio,
            status="downloaded",
        )

        if meeting_id:
            new_meeting_ids.append(meeting_id)
            count += 1
            print(f"Downloaded: [{meeting_id}] {youtube_id} — {title}")

    return new_meeting_ids
