CREATE TABLE IF NOT EXISTS teamcarereminders (
 member_id varchar(64) NOT NULL, service_order_id varchar(128) NOT NULL,
 completed_on date NOT NULL, due_on date NOT NULL,
 status varchar(16) NOT NULL CHECK(status IN ('pending','assigned','processed','booked','superseded','expired')),
 task_id varchar(32), data_type varchar(16) NOT NULL CHECK(data_type IN ('simulation','real')),
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
 PRIMARY KEY(member_id,service_order_id),
 CHECK((status IN ('pending','expired') AND task_id IS NULL) OR status='superseded'
   OR (status IN ('assigned','processed','booked') AND task_id IS NOT NULL)),
 CHECK(due_on IN (completed_on+7,completed_on+21))
);
CREATE UNIQUE INDEX IF NOT EXISTS teamcarereminders_task ON teamcarereminders(task_id) WHERE task_id IS NOT NULL;
