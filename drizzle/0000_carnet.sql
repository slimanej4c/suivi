CREATE TABLE IF NOT EXISTS records (
  owner TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('clients', 'projects', 'actions', 'notes', 'access', 'tests')),
  parent TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL,
  updated TEXT NOT NULL,
  PRIMARY KEY (owner, id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS records_parent ON records(owner, parent);
