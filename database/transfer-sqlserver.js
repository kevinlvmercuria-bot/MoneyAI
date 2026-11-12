'use strict';
const { createHash } = require('node:crypto');
const { connect, transaction } = require('../server/db');
const { connectSource } = require('./sqlserver-source');
const { migrate } = require('./migrations');
const TABLES = [
    'Members',
    'Tasks',
    'OperationLogs',
    'CareRecords',
    'Products',
    'SourceRecords',
    'ImportRuns',
    'MemberProfileBackups',
    'MemberImportStage',
    'ProductImages',
    'CopyDrafts',
    'MemberNoteEdits',
    'TeamCredentials',
    'TeamDemoState',
    'TeamCareReminders',
];
const JSON_COLUMNS = new Set([
    'profile',
    'payload',
    'counts_json',
    'product_ids',
    'context_json',
]);
const quoteSource = (name) => '[' + name.replaceAll(']', ']]') + ']';
const quoteTarget = (name) => '"' + name.replaceAll('"', '""') + '"';
function canonical(value) {
    if (Buffer.isBuffer(value)) return { binary: value.toString('base64') };
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object')
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map((k) => [k, canonical(value[k])]),
        );
    return value;
}
function normalized(row, columns) {
    return Object.fromEntries(
        columns.map((c) => {
            let value = row[c.name];
            if (value !== null && JSON_COLUMNS.has(c.name))
                value = typeof value === 'string' ? JSON.parse(value) : value;
            if (value instanceof Date && c.type === 'date')
                value = value.toISOString().slice(0, 10);
            return [c.name, canonical(value)];
        }),
    );
}
function digest(rows, columns) {
    const lines = rows
        .map((row) => JSON.stringify(normalized(row, columns)))
        .sort();
    return createHash('sha256').update(lines.join('\n')).digest('hex');
}
async function backupSource(source) {
    const defaultPath = (
        await source.pool
            .request()
            .query(
                "SELECT CAST(SERVERPROPERTY('InstanceDefaultBackupPath') AS nvarchar(4000)) AS path",
            )
    ).recordset[0].path;
    if (!defaultPath)
        throw new Error('无法确定 SQL Server 备份目录，请先配置实例备份目录。');
    const file =
        defaultPath.replace(/[\\/]?$/, '\\') +
        'NailMate-before-postgres-' +
        Date.now() +
        '.bak';
    await source.pool
        .request()
        .input('file', source.sql.NVarChar(4000), file)
        .query(
            `BACKUP DATABASE ${quoteSource(source.database)} TO DISK=@file WITH COPY_ONLY,CHECKSUM;
         RESTORE VERIFYONLY FROM DISK=@file WITH CHECKSUM;`,
        );
    return file;
}
async function transfer(source, target, { apply = false } = {}) {
    const inventory = (
        await source.pool
            .request()
            .query(
                "SELECT name FROM sys.tables WHERE schema_id=SCHEMA_ID('dbo') ORDER BY name",
            )
    ).recordset.map((r) => r.name);
    const unknown = inventory.filter((name) => !TABLES.includes(name));
    if (unknown.length)
        throw new Error(
            '存在未映射的来源表，禁止遗漏搬迁：' + unknown.join(', '),
        );
    const tx = new source.sql.Transaction(source.pool);
    await tx.begin(source.sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
        // Share the old application's lock; migration requires source writes stopped.
        await new source.sql.Request(tx).query(`DECLARE @r int;
            EXEC @r=sp_getapplock @Resource='NailMateDemo',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=5000;
            IF @r<0 THROW 50000,'Source application lock unavailable',1;`);
        const data = [];
        for (const name of TABLES.filter((n) => inventory.includes(n))) {
            const columns = (
                await new source.sql.Request(tx).input(
                    'table',
                    source.sql.NVarChar(128),
                    name,
                ).query(`
                SELECT c.name,t.name AS type FROM sys.columns c JOIN sys.types t ON c.user_type_id=t.user_type_id
                WHERE c.object_id=OBJECT_ID('dbo.'+@table) ORDER BY c.column_id`)
            ).recordset;
            const rows = (
                await new source.sql.Request(tx).query(
                    `SELECT * FROM dbo.${quoteSource(name)}`,
                )
            ).recordset;
            data.push({ name, columns, rows, sha256: digest(rows, columns) });
        }
        if (!apply) {
            await tx.commit();
            return data.map(({ name, rows, sha256 }) => ({
                name,
                count: rows.length,
                sha256,
            }));
        }
        const result = await transaction(target, async (client) => {
            await migrate(client);
            for (const table of data) {
                const name = table.name.toLowerCase();
                const targetColumns = (
                    await client.query(
                        'SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2',
                        ['public', name],
                    )
                ).rows.map((r) => r.column_name);
                if (table.columns.some((c) => !targetColumns.includes(c.name)))
                    throw new Error('目标缺少来源字段：' + table.name);
                const current = (
                    await client.query(`SELECT * FROM ${quoteTarget(name)}`)
                ).rows;
                if (current.length) {
                    if (digest(current, table.columns) !== table.sha256)
                        throw new Error(
                            '目标已有不同记录，搬迁已回滚：' + table.name,
                        );
                    continue;
                }
                const columns = table.columns
                    .map((c) => quoteTarget(c.name))
                    .join(',');
                for (const row of table.rows) {
                    const values = table.columns.map((c) => {
                        const value = row[c.name];
                        return c.type === 'date' && value instanceof Date
                            ? value.toISOString().slice(0, 10)
                            : value;
                    });
                    await client.query(
                        `INSERT INTO ${quoteTarget(name)}(${columns}) VALUES(${values.map((_, i) => '$' + (i + 1)).join(',')})`,
                        values,
                    );
                }
                const after = (
                    await client.query(`SELECT * FROM ${quoteTarget(name)}`)
                ).rows;
                if (digest(after, table.columns) !== table.sha256)
                    throw new Error('搬迁后内容校验不一致：' + table.name);
            }
            for (const table of data.filter(
                (t) =>
                    t.columns.some(
                        (c) => c.name === 'id' && c.type === 'int',
                    ) && !['TeamDemoState'].includes(t.name),
            )) {
                const name = table.name.toLowerCase();
                await client.query(
                    `SELECT setval(pg_get_serial_sequence($1,'id'),COALESCE(MAX(id),1),MAX(id) IS NOT NULL) FROM ${quoteTarget(name)}`,
                    [name],
                );
            }
            return data.map(({ name, rows, sha256 }) => ({
                name,
                count: rows.length,
                sha256,
            }));
        });
        await tx.commit();
        return result;
    } catch (error) {
        await tx.rollback().catch(() => {});
        throw error;
    }
}
async function run() {
    const apply = process.argv.includes('--apply');
    if (apply && !process.argv.includes('--source-stopped'))
        throw new Error(
            '正式搬迁需先停止旧服务写入，再传 --source-stopped；不会自动停止现用服务。',
        );
    const source = await connectSource();
    let target;
    try {
        if (apply)
            console.log(
                'SQL Server 备份并校验：' + (await backupSource(source)),
            );
        target = apply ? await connect() : null;
        console.log(
            JSON.stringify(
                {
                    applied: apply,
                    tables: await transfer(source, target, { apply }),
                },
                null,
                2,
            ),
        );
    } finally {
        await target?.end();
        await source.pool.close();
    }
}
if (require.main === module)
    run().catch((e) => {
        console.error('搬迁未完成：' + e.message);
        process.exitCode = 1;
    });
module.exports = { transfer, digest, normalized, TABLES };
