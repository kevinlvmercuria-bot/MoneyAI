CREATE TABLE IF NOT EXISTS teamcredentials (
 employee varchar(30) PRIMARY KEY, username varchar(32) NOT NULL,
 salt bytea NOT NULL CHECK(octet_length(salt)=16),
 password_hash bytea NOT NULL CHECK(octet_length(password_hash)=64)
);
CREATE UNIQUE INDEX IF NOT EXISTS teamcredentials_username ON teamcredentials(lower(username));
