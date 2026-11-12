CREATE TABLE IF NOT EXISTS teamdemostate (
 id integer PRIMARY KEY CHECK(id=1), payload jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
