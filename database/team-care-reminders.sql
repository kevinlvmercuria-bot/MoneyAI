IF OBJECT_ID(N'dbo.TeamCareReminders', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TeamCareReminders (
        member_id nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
        service_order_id nvarchar(128) COLLATE Latin1_General_100_BIN2 NOT NULL,
        completed_on date NOT NULL,
        due_on date NOT NULL,
        status varchar(16) NOT NULL,
        task_id varchar(32) NULL,
        data_type varchar(16) NOT NULL,
        created_at datetime2(3) NOT NULL,
        updated_at datetime2(3) NOT NULL,
        CONSTRAINT PK_TeamCareReminders PRIMARY KEY (member_id, service_order_id),
        CONSTRAINT CK_TeamCareReminders_WindowStatus CHECK (status IN ('pending', 'assigned', 'processed', 'booked', 'superseded', 'expired')),
        CONSTRAINT CK_TeamCareReminders_WindowTask CHECK (
            (status IN ('pending', 'expired') AND task_id IS NULL) OR status = 'superseded'
            OR (status IN ('assigned', 'processed', 'booked') AND task_id IS NOT NULL)
        ),
        CONSTRAINT CK_TeamCareReminders_WindowDate CHECK (due_on IN (DATEADD(day, 7, completed_on), DATEADD(day, 21, completed_on))),
        CONSTRAINT CK_TeamCareReminders_DataType CHECK (data_type IN ('simulation', 'real'))
    );
    CREATE UNIQUE INDEX UX_TeamCareReminders_Task ON dbo.TeamCareReminders(task_id) WHERE task_id IS NOT NULL;
END;
ELSE IF OBJECT_ID(N'dbo.CK_TeamCareReminders_WindowDate', N'C') IS NULL
BEGIN
    -- Preserve the start date of historical, completed reminders.
    ALTER TABLE dbo.TeamCareReminders DROP CONSTRAINT
        CK_TeamCareReminders_Status, CK_TeamCareReminders_Task, CK_TeamCareReminders_Date;
    ALTER TABLE dbo.TeamCareReminders WITH CHECK ADD
        CONSTRAINT CK_TeamCareReminders_WindowStatus CHECK (status IN ('pending', 'assigned', 'processed', 'booked', 'superseded', 'expired')),
        CONSTRAINT CK_TeamCareReminders_WindowTask CHECK (
            (status IN ('pending', 'expired') AND task_id IS NULL) OR status = 'superseded'
            OR (status IN ('assigned', 'processed', 'booked') AND task_id IS NOT NULL)
        ),
        CONSTRAINT CK_TeamCareReminders_WindowDate CHECK (due_on IN (DATEADD(day, 7, completed_on), DATEADD(day, 21, completed_on)));
END;
