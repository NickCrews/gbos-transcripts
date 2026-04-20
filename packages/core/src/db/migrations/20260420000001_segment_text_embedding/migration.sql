-- Add 384-dim text embedding column to segments for semantic search
-- (all-MiniLM-L6-v2 via @xenova/transformers).
ALTER TABLE "segments" ADD COLUMN "text_embedding" vector(384);
