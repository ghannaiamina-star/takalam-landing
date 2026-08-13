-- Milestone 1 schema. Run once against the Neon database referenced by
-- DATABASE_URL. No migration framework at this size (3 tables) -- if this
-- needs to change, hand-write a follow-up ALTER script rather than adding
-- tooling.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS test_attempt (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  email TEXT,
  goal TEXT,
  goal_deadline_weeks INT,
  locale TEXT NOT NULL DEFAULT 'fr',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  grading_incomplete BOOLEAN NOT NULL DEFAULT false,
  final_band TEXT,
  speaking_band TEXT,
  grammar_band TEXT,
  reading_band TEXT,
  section1 JSONB,
  section2 JSONB,
  diagnosis JSONB
);

CREATE TABLE IF NOT EXISTS test_answer (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES test_attempt(id),
  prompt_index INT NOT NULL,
  prompt_text TEXT,
  transcript TEXT,
  audio_url TEXT,
  metrics JSONB,
  band TEXT,
  grammar_range INT,
  vocabulary_range INT,
  coherence INT,
  freeze_indicators JSONB,
  example_errors JSONB
);

CREATE INDEX IF NOT EXISTS test_answer_attempt_id_idx ON test_answer(attempt_id);

CREATE TABLE IF NOT EXISTS payment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID REFERENCES test_attempt(id),
  provider TEXT NOT NULL,
  provider_order_id TEXT NOT NULL,
  buyer_email TEXT,
  buyer_name TEXT,
  product_type TEXT NOT NULL,
  amount_eur NUMERIC NOT NULL,
  status TEXT NOT NULL,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_order_id)
);
