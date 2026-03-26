"""Text embedding for transcript segments using sentence-transformers.

Pipeline stage 5: Encode segment text → store 384-dim vectors in vec_segments.
"""

from __future__ import annotations

import sqlite3
from typing import TYPE_CHECKING

from .config import SENTENCE_TRANSFORMER_MODEL
from .db import (
    get_segments_missing_embeddings,
    insert_segment_embedding,
    update_meeting_status,
)

if TYPE_CHECKING:
    from sentence_transformers import SentenceTransformer


_model_cache: dict[str, "SentenceTransformer"] = {}


def get_model(model_name: str = SENTENCE_TRANSFORMER_MODEL) -> "SentenceTransformer":
    """Load (or return cached) sentence-transformer model."""
    if model_name not in _model_cache:
        from sentence_transformers import SentenceTransformer

        _model_cache[model_name] = SentenceTransformer(model_name)
    return _model_cache[model_name]


def embed_texts(
    texts: list[str],
    model_name: str = SENTENCE_TRANSFORMER_MODEL,
) -> list[list[float]]:
    """Encode a list of texts into 384-dim float32 embeddings."""
    model = get_model(model_name)
    embeddings = model.encode(texts, convert_to_numpy=True)
    return [emb.tolist() for emb in embeddings]


def run_embed(
    conn: sqlite3.Connection,
    meeting_id: int,
    batch_size: int = 64,
    model_name: str = SENTENCE_TRANSFORMER_MODEL,
) -> int:
    """Embed all segments in a meeting that lack vec_segments entries.

    Returns the number of segments embedded.
    """
    rows = get_segments_missing_embeddings(conn, meeting_id)
    if not rows:
        update_meeting_status(conn, meeting_id, "embedded")
        return 0

    total = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        texts = [row["text"] for row in batch]
        embeddings = embed_texts(texts, model_name)

        for row, emb in zip(batch, embeddings):
            insert_segment_embedding(conn, row["id"], emb)
        total += len(batch)

    update_meeting_status(conn, meeting_id, "embedded")
    return total
