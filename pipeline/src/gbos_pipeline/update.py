"""Daily update CLI entry point.

Usage:
    uv run python -m gbos_pipeline.update [--dry-run] [--max-new N]
"""

from __future__ import annotations

import argparse
import sys

from .config import DB_PATH, GBOS_CHANNEL_URL, ensure_data_dirs
from .db import open_and_init
from .download import run_download
from .ingest import ingest_pending


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="GBOS daily update: discover new videos and process the pipeline"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be downloaded without actually downloading",
    )
    parser.add_argument(
        "--max-new",
        type=int,
        default=None,
        metavar="N",
        help="Cap the number of newly downloaded meetings (useful for testing)",
    )
    parser.add_argument(
        "--skip-download",
        action="store_true",
        help="Skip the download stage (only process already-downloaded meetings)",
    )
    parser.add_argument(
        "--channel",
        default=GBOS_CHANNEL_URL,
        help="YouTube channel URL to scan",
    )
    args = parser.parse_args(argv)

    ensure_data_dirs()
    conn = open_and_init(DB_PATH)

    if not args.skip_download:
        print("=== Stage 1: Discover + Download ===")
        new_ids = run_download(
            conn,
            channel_url=args.channel,
            max_new=args.max_new,
            dry_run=args.dry_run,
        )
        if new_ids:
            print(f"Downloaded {len(new_ids)} new meeting(s): {new_ids}")
        else:
            print("No new meetings found.")

        if args.dry_run:
            return 0

    print("\n=== Stages 2-6: Transcribe → Diarize → Identify → Align → Embed ===")
    processed = ingest_pending(conn)

    if processed:
        print(f"\nProcessed {len(processed)} meeting(s): {processed}")
    else:
        print("No meetings to process.")

    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
