-- Run within the configured DB_NAME; init.js creates the database first if missing.
IF OBJECT_ID(N'dbo.wg_member', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.wg_member (
        member_id varchar(5) NOT NULL PRIMARY KEY,
        days_since_visit int NOT NULL CHECK (days_since_visit >= 0),
        cycle_days int NOT NULL CHECK (cycle_days > 0),
        visits int NOT NULL CHECK (visits >= 0),
        total_spend decimal(12,2) NOT NULL CHECK (total_spend >= 0),
        balance decimal(12,2) NOT NULL CHECK (balance >= 0),
        style nvarchar(40) NOT NULL,
        secondary_style nvarchar(40) NOT NULL,
        contact_days int NOT NULL CHECK (contact_days >= 0),
        consent bit NOT NULL,
        complaint bit NOT NULL,
        appointment bit NOT NULL,
        ratio decimal(8,2) NOT NULL,
        lifecycle varchar(20) NOT NULL CHECK (lifecycle IN ('active','due','low_frequency','dormant')),
        last_visit date NOT NULL,
        member_level nvarchar(40) NOT NULL,
        created_at datetime2 NOT NULL CONSTRAINT df_wg_member_created DEFAULT SYSUTCDATETIME(),
        updated_at datetime2 NOT NULL CONSTRAINT df_wg_member_updated DEFAULT SYSUTCDATETIME(),
        deleted_at datetime2 NULL
    );
END;
