"""Configuration: paths, model names, channel URL."""

import os
from pathlib import Path

# Repository root (two levels up from this file: src/gbos_pipeline/config.py)
REPO_ROOT = Path(__file__).parent.parent.parent.parent

# Data directories (gitignored)
DATA_DIR = REPO_ROOT / "data"
AUDIO_DIR = DATA_DIR / "audio"
TRANSCRIPTS_DIR = DATA_DIR / "transcripts"
DB_PATH = DATA_DIR / "gbos.db"

# YouTube channel
GBOS_CHANNEL_URL = "https://www.youtube.com/@GirdwoodBOS/videos"
MUNICIPALITY_SHORT_NAME = "gbos"
MUNICIPALITY_NAME = "Girdwood Board of Supervisors"
MUNICIPALITY_STATE = "AK"

# Model names
PARAKEET_MODEL = "mlx-community/parakeet-tdt-0.6b-v2"
SENTENCE_TRANSFORMER_MODEL = "all-MiniLM-L6-v2"

# Speaker matching threshold (cosine distance; lower = more similar)
# similarity > 0.6  ↔  distance < 0.4
VOICE_MATCH_DISTANCE_THRESHOLD = 0.4

# Audio download format
AUDIO_FORMAT = "wav"
AUDIO_SAMPLE_RATE = 16000  # Hz (required by most ASR/diarization models)

# yt-dlp options for audio-only download
YTDLP_AUDIO_OPTS: dict = {
    "format": "bestaudio/best",
    "postprocessors": [
        {
            "key": "FFmpegExtractAudio",
            "preferredcodec": AUDIO_FORMAT,
            "preferredquality": "0",  # lossless
        }
    ],
    "outtmpl": str(AUDIO_DIR / "%(id)s.%(ext)s"),
    "quiet": True,
    "no_warnings": True,
}


def ensure_data_dirs() -> None:
    """Create data directories if they don't exist."""
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    TRANSCRIPTS_DIR.mkdir(parents=True, exist_ok=True)
