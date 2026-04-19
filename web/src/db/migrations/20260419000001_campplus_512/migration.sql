-- Switch voice embeddings from WeSpeaker ResNet34-LM (256-dim) to CAM++ via sherpa-onnx (512-dim).
-- Existing embeddings are incompatible and must be cleared.
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_voice_embedding_l2";

--> statement-breakpoint
ALTER TABLE "people" DROP COLUMN "voice_embedding";

--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "voice_embedding" vector(512) NOT NULL DEFAULT '[0]';

--> statement-breakpoint
-- Remove the placeholder default now that the column exists
ALTER TABLE "people" ALTER COLUMN "voice_embedding" DROP DEFAULT;

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
