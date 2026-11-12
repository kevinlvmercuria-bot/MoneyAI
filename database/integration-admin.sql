CREATE TABLE IF NOT EXISTS wecomsettings (
 id integer PRIMARY KEY CHECK(id=1), encrypted jsonb, last_check jsonb,
 updated_by text, updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE wecombatches ADD COLUMN IF NOT EXISTS initiated_by text;
CREATE TABLE IF NOT EXISTS memberimports (
 id uuid PRIMARY KEY, created_by text NOT NULL, content_hash text NOT NULL,
 payload jsonb NOT NULL, result jsonb,
 status text NOT NULL CHECK(status IN ('preview','committed')),
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 expires_at timestamptz NOT NULL DEFAULT (CURRENT_TIMESTAMP+interval '1 hour')
);
CREATE INDEX IF NOT EXISTS memberimports_hash ON memberimports(content_hash) WHERE status='committed';
