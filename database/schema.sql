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

IF OBJECT_ID(N'dbo.Products', N'U') IS NULL
    CREATE TABLE dbo.Products (id varchar(40) NOT NULL PRIMARY KEY, profile nvarchar(max) NOT NULL CHECK (ISJSON(profile) = 1));

IF OBJECT_ID(N'dbo.SourceRecords', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SourceRecords (
        source_table varchar(40) NOT NULL,
        source_id nvarchar(100) NOT NULL,
        member_id varchar(5) NULL,
        payload nvarchar(max) NOT NULL CHECK (ISJSON(payload) = 1),
        PRIMARY KEY (source_table, source_id)
    );
    CREATE INDEX IX_SourceRecords_Member ON dbo.SourceRecords(member_id, source_table);
END;

IF OBJECT_ID(N'dbo.ImportRuns', N'U') IS NULL
    CREATE TABLE dbo.ImportRuns (source_hash char(64) NOT NULL PRIMARY KEY, imported_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(), counts_json nvarchar(max) NOT NULL);

IF OBJECT_ID(N'dbo.MemberProfileBackups', N'U') IS NULL
    CREATE TABLE dbo.MemberProfileBackups (
        source_hash char(64) NOT NULL, member_id varchar(5) NOT NULL,
        profile nvarchar(max) NOT NULL, backed_up_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
        PRIMARY KEY (source_hash, member_id)
    );

IF OBJECT_ID(N'dbo.MemberImportStage', N'U') IS NULL
    CREATE TABLE dbo.MemberImportStage (id varchar(5) NOT NULL PRIMARY KEY, profile nvarchar(max) NOT NULL);

IF OBJECT_ID(N'dbo.ProductImages', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ProductImages (
        id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
        product_id varchar(40) NOT NULL,
        content_type varchar(30) NOT NULL,
        image_data varbinary(max) NOT NULL,
        created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_ProductImages_Product ON dbo.ProductImages(product_id, id DESC);
END;

IF OBJECT_ID(N'dbo.CopyDrafts', N'U') IS NULL
    CREATE TABLE dbo.CopyDrafts (
        id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
        member_id varchar(5) NOT NULL REFERENCES dbo.Members(id),
        model nvarchar(100) NOT NULL,
        message nvarchar(1000) NOT NULL,
        original_message nvarchar(1000) NOT NULL,
        reason nvarchar(500) NOT NULL,
        product_ids nvarchar(max) NOT NULL CHECK (ISJSON(product_ids) = 1),
        created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
        copied_at datetime2 NULL
    );

-- v4：新增上下文与本地备注覆盖，已有记录保持不变。
IF COL_LENGTH('dbo.Tasks', 'context_json') IS NULL
    ALTER TABLE dbo.Tasks ADD context_json nvarchar(max) NULL;
IF COL_LENGTH('dbo.CopyDrafts', 'context_json') IS NULL
    ALTER TABLE dbo.CopyDrafts ADD context_json nvarchar(max) NULL;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.Tasks') AND name='UX_Tasks_EffectiveMember' AND filter_definition LIKE '%rejected%')
BEGIN
    DROP INDEX UX_Tasks_EffectiveMember ON dbo.Tasks;
    CREATE UNIQUE INDEX UX_Tasks_EffectiveMember ON dbo.Tasks(member_id) WHERE status IN ('pending_review','approved');
END;
IF OBJECT_ID(N'dbo.MemberNoteEdits', N'U') IS NULL
    CREATE TABLE dbo.MemberNoteEdits (
        note_id nvarchar(100) NOT NULL PRIMARY KEY,
        member_id varchar(5) NOT NULL REFERENCES dbo.Members(id),
        note_type varchar(20) NOT NULL,
        note_text nvarchar(1200) NOT NULL,
        is_pinned bit NOT NULL DEFAULT 0,
        author_name nvarchar(80) NOT NULL,
        updated_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME()
    );

-- v4 回访续接保留每次反馈，旧记录不覆盖。
DECLARE @careUnique sysname;
SELECT TOP(1) @careUnique=kc.name FROM sys.key_constraints kc
JOIN sys.index_columns ic ON ic.object_id=kc.parent_object_id AND ic.index_id=kc.unique_index_id
JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
WHERE kc.parent_object_id=OBJECT_ID('dbo.CareRecords') AND kc.type='UQ' AND c.name='member_id';
IF @careUnique IS NOT NULL
BEGIN
    DECLARE @careDrop nvarchar(max);
    SET @careDrop=N'ALTER TABLE dbo.CareRecords DROP CONSTRAINT '+QUOTENAME(@careUnique);
    EXEC sys.sp_executesql @careDrop;
END;
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.CareRecords') AND name='IX_CareRecords_Member')
    CREATE INDEX IX_CareRecords_Member ON dbo.CareRecords(member_id,id DESC);
