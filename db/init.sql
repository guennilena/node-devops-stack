CREATE TABLE IF NOT EXISTS shipments (
  id UUID PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('created','in_transit','delivered','cancelled')),
  eta TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status);
