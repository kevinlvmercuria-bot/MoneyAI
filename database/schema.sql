IF OBJECT_ID(N'dbo.Members', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Members (
        id varchar(5) NOT NULL PRIMARY KEY,
        profile nvarchar(max) NOT NULL CHECK (ISJSON(profile) = 1)
    );
END;

IF OBJECT_ID(N'dbo.Tasks', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Tasks (
        id int IDENTITY(1, 1) NOT NULL PRIMARY KEY,
        member_id varchar(5) NOT NULL REFERENCES dbo.Members(id),
        goal varchar(10) NOT NULL CHECK (goal IN ('general', 'wake', 'balance', 'launch')),
        status varchar(20) NOT NULL CHECK (status IN ('pending_review', 'approved', 'rejected', 'executed_simulated')),
        strategy nvarchar(30) NOT NULL,
        priority int NOT NULL,
        message nvarchar(1000) NOT NULL,
        reason nvarchar(400) NOT NULL,
        edited_message nvarchar(1000) NOT NULL DEFAULT N'',
        scenario varchar(10) NULL,
        CONSTRAINT CK_Tasks_Scenario CHECK (
            (status = 'executed_simulated' AND scenario IS NOT NULL AND scenario IN ('noReply', 'reply', 'booking', 'visit'))
            OR (status <> 'executed_simulated' AND scenario IS NULL)
        )
    );
    CREATE UNIQUE INDEX UX_Tasks_EffectiveMember ON dbo.Tasks(member_id) WHERE status <> 'rejected';
END;

IF OBJECT_ID(N'dbo.OperationLogs', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.OperationLogs (
        id int IDENTITY(1, 1) NOT NULL PRIMARY KEY,
        name varchar(40) NOT NULL,
        description nvarchar(400) NOT NULL,
        created_at datetime2(0) NOT NULL DEFAULT SYSUTCDATETIME()
    );
END;

IF OBJECT_ID(N'dbo.CareRecords', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.CareRecords (
        id int IDENTITY(1, 1) NOT NULL PRIMARY KEY,
        member_id varchar(5) NOT NULL UNIQUE REFERENCES dbo.Members(id),
        outcome nvarchar(20) NOT NULL CHECK (outcome IN (N'已沟通', N'未回复', N'暂不联系', N'推荐不合适', N'不再营销')),
        note nvarchar(1000) NOT NULL,
        owner nvarchar(80) NOT NULL,
        follow_up date NULL,
        recorded_as_of date NOT NULL,
        created_at datetime2(0) NOT NULL DEFAULT SYSUTCDATETIME()
    );
END;
