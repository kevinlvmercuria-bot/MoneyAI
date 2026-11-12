IF OBJECT_ID(N'dbo.TeamCredentials', N'U') IS NULL
    CREATE TABLE dbo.TeamCredentials (
        employee nvarchar(30) NOT NULL PRIMARY KEY,
        username varchar(32) NOT NULL UNIQUE,
        salt binary(16) NOT NULL,
        password_hash binary(64) NOT NULL
    );
