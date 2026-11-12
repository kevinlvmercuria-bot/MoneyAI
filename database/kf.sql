CREATE TABLE IF NOT EXISTS kfaccounts(
 open_kfid text PRIMARY KEY,name text NOT NULL DEFAULT '',cursor text NOT NULL DEFAULT '',
 sync_token text,token_at timestamptz,last_sync_at timestamptz,last_error text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS kfconversations(
 id uuid PRIMARY KEY,open_kfid text NOT NULL REFERENCES kfaccounts(open_kfid),external_userid text NOT NULL,
 employee varchar(30),employee_username varchar(32),member_id text,updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(open_kfid,external_userid)
);
CREATE TABLE IF NOT EXISTS kfmessages(
 id text PRIMARY KEY,conversation_id uuid NOT NULL REFERENCES kfconversations(id),
 direction text NOT NULL CHECK(direction IN ('inbound','outbound','event')),
 msgtype text NOT NULL,payload jsonb NOT NULL,sent_at timestamptz NOT NULL,
 status text NOT NULL,created_by text,idempotency_key uuid,
 UNIQUE(created_by,idempotency_key)
);
CREATE INDEX IF NOT EXISTS kfmessages_conversation ON kfmessages(conversation_id,sent_at,id);
CREATE INDEX IF NOT EXISTS kfconversations_employee ON kfconversations(employee,updated_at);
