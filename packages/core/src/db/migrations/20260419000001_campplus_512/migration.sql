-- Switch voice embeddings from WeSpeaker ResNet34-LM (256-dim) to CAM++ via sherpa-onnx (512-dim).
-- Existing embeddings are incompatible and must be cleared.
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_voice_embedding_l2";

--> statement-breakpoint
ALTER TABLE "people" DROP COLUMN "voice_embedding";

--> statement-breakpoint
-- Add the new 512-dim column. We can't use a NOT NULL DEFAULT here because
-- pgvector validates that the default literal matches the declared dimension,
-- so add nullable, then assert NOT NULL once the column exists. Existing rows
-- were dropped above, so there's nothing to backfill.
ALTER TABLE "people" ADD COLUMN "voice_embedding" vector(512);

--> statement-breakpoint
ALTER TABLE "people" ALTER COLUMN "voice_embedding" SET NOT NULL;

--> statement-breakpoint
CREATE INDEX "idx_voice_embedding_l2" ON "people" USING hnsw ("voice_embedding" vector_l2_ops);

--> statement-breakpoint
-- Track pipeline stage per meeting (idempotent resumption)
ALTER TABLE "meetings" ADD COLUMN IF NOT EXISTS "status" varchar NOT NULL DEFAULT 'discovered';

--> statement-breakpoint
-- Store intermediate pipeline artifacts (cleared after embedding stage)
ALTER TABLE "meetings" ADD COLUMN IF NOT EXISTS "transcription" jsonb;

--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN IF NOT EXISTS "diarization" jsonb;
