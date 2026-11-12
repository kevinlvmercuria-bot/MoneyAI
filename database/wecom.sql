CREATE TABLE IF NOT EXISTS wecomemployees(employee varchar(30) PRIMARY KEY,userid text NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS wecommembers(member_id text PRIMARY KEY,external_userid text NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS wecombatches(
 id uuid PRIMARY KEY,submitted_by text NOT NULL,idempotency_key uuid NOT NULL,request_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(submitted_by,idempotency_key)
);
CREATE TABLE IF NOT EXISTS wecomdeliveries(
 id uuid PRIMARY KEY,batch_id uuid NOT NULL REFERENCES wecombatches(id),group_id uuid NOT NULL,
 task_id text NOT NULL,member_id text NOT NULL,employee text NOT NULL,userid text NOT NULL,external_userid text NOT NULL,
 message text NOT NULL,image_data bytea,image_type text,
 status text NOT NULL CHECK(status IN ('prepared','creating','pending','unknown','sent','failed')),
 platform_id text,platform_body jsonb,detail text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,sent_at timestamptz,creation_attempt_at timestamptz,next_poll_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS wecomdelivery_active_member ON wecomdeliveries(member_id) WHERE status IN ('prepared','creating','pending','unknown');
CREATE UNIQUE INDEX IF NOT EXISTS wecomdelivery_task ON wecomdeliveries(task_id) WHERE status<>'failed';
CREATE INDEX IF NOT EXISTS wecomdelivery_poll ON wecomdeliveries(next_poll_at) WHERE status IN ('prepared','creating','pending','unknown');
