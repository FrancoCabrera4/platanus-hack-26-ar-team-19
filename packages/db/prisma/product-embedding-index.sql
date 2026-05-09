CREATE INDEX IF NOT EXISTS "ProductEmbedding_embedding_idx"
  ON "ProductEmbedding"
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
