CREATE TABLE crm_records (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('clients', 'visits', 'followUps', 'sales')),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX crm_records_type_updated_at_idx ON crm_records (type, updated_at DESC);
