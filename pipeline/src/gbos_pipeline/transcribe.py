"""Transcription via Parakeet MLX.

Pipeline stage 2: WAV audio → sentence+word timestamps → raw JSON → status=transcribed.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from .config import PARAKEET_MODEL, TRANSCRIPTS_DIR, ensure_data_dirs
from .db import get_meeting_by_id, update_meeting_status


@dataclass
class TranscriptWord:
    text: str
    start: float
    end: float


@dataclass
class TranscriptSentence:
    text: str
    start: float
    end: float
    words: list[TranscriptWord]


@dataclass
class TranscriptResult:
    sentences: list[TranscriptSentence]
    duration: float | None = None


# ---------------------------------------------------------------------------
# Parakeet integration
# ---------------------------------------------------------------------------

def transcribe_audio(audio_path: Path, model_name: str = PARAKEET_MODEL) -> TranscriptResult:
    """Transcribe an audio file using Parakeet MLX.

    Returns a TranscriptResult with sentence and word-level timestamps.
    """
    from parakeet_mlx import from_pretrained  # type: ignore[import]

    model = from_pretrained(model_name)
    raw = model.transcribe(str(audio_path))

    sentences: list[TranscriptSentence] = []
    for sent in raw.sentences:
        words = [
            TranscriptWord(text=w.text, start=w.start, end=w.end)
            for w in (sent.tokens or [])
        ]
        sentences.append(
            TranscriptSentence(
                text=sent.text,
                start=sent.start,
                end=sent.end,
                words=words,
            )
        )

    return TranscriptResult(sentences=sentences)


# ---------------------------------------------------------------------------
# Serialisation helpers
# ---------------------------------------------------------------------------

def transcript_to_dict(result: TranscriptResult) -> dict[str, Any]:
    return asdict(result)


def transcript_from_dict(data: dict[str, Any]) -> TranscriptResult:
    sentences = [
        TranscriptSentence(
            text=s["text"],
            start=s["start"],
            end=s["end"],
            words=[TranscriptWord(**w) for w in s.get("words", [])],
        )
        for s in data.get("sentences", [])
    ]
    return TranscriptResult(sentences=sentences, duration=data.get("duration"))


def save_transcript(result: TranscriptResult, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(transcript_to_dict(result), f, indent=2)


def load_transcript(path: Path) -> TranscriptResult:
    with open(path) as f:
        data = json.load(f)
    return transcript_from_dict(data)


# ---------------------------------------------------------------------------
# Pipeline stage runner
# ---------------------------------------------------------------------------

def run_transcribe(conn: sqlite3.Connection, meeting_id: int) -> TranscriptResult:
    """Transcribe audio for a meeting (idempotent: loads JSON if already exists)."""
    ensure_data_dirs()

    meeting = get_meeting_by_id(conn, meeting_id)
    if meeting is None:
        raise ValueError(f"Meeting {meeting_id} not found")

    transcript_path = TRANSCRIPTS_DIR / f"{meeting['youtube_id']}.json"

    if transcript_path.exists():
        result = load_transcript(transcript_path)
    else:
        if not meeting["audio_path"]:
            raise ValueError(f"Meeting {meeting_id} has no audio_path")
        from pathlib import Path as _Path
        repo_root = _Path(__file__).parent.parent.parent.parent
        audio_path = repo_root / meeting["audio_path"]
        result = transcribe_audio(audio_path)
        save_transcript(result, transcript_path)

    relative_transcript = str(transcript_path.relative_to(
        Path(__file__).parent.parent.parent.parent
    ))
    update_meeting_status(
        conn,
        meeting_id,
        "transcribed",
        transcript_path=relative_transcript,
    )

    return result
