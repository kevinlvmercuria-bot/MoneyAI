'use strict';
const ExcelJS = require('exceljs');
const { parse } = require('csv-parse/sync');
const { randomUUID, createHash } = require('node:crypto');
const { transaction } = require('./db');
const { createTeamStore, teamBusinessClock } = require('../public/team-store');
const { loadTeamState, persistTeamState } = require('./team-repository');
const { fail, uuid } = require('./wecom-service');
const defaultSnapshot = require('../data/team-data.json');
const fields = [
    [
        'name',
        '姓名',
        true,
        ['客户姓名', '顾客姓名', '会员姓名', 'display_name', 'name'],
    ],
    ['phone', '手机号', true, ['电话', '联系电话', '手机', 'mobile', 'phone']],
    ['membershipLevel', '会员等级', false, ['等级', 'membership_level']],
    ['balance', '余额', false, ['储值余额', 'stored_balance', 'balance']],
    ['totalSpending', '累计消费', false, ['消费总额', 'total_spending']],
    ['styles', '偏好款式', false, ['风格偏好', '偏好', 'preferred_styles']],
    ['technician', '偏好技师', false, ['技师', 'preferred_technician']],
    ['joinedOn', '入会日期', false, ['注册日期', 'created_date']],
    ['lastVisit', '最近到店', false, ['最近到店日期', 'last_visit']],
    ['marketingConsent', '营销授权', false, ['同意营销', 'marketing_consent']],
    [
        'careOptIn',
        '护理回访授权',
        false,
        ['同意护理回访', 'care_followup_opt_in'],
    ],
    ['note', '备注', false, ['客户备注', 'latest_note', 'note']],
].map(([key, label, required, aliases]) => ({
    key,
    label,
    required,
    aliases: [label, key, ...aliases],
}));
const normalizePhone = (value) =>
    String(value || '')
        .trim()
        .replace(/[\s()-]/g, '')
        .replace(/^(?:\+86|0086|86)(?=1\d{10}$)/, '');
function checkZip(buffer) {
    const end = buffer.lastIndexOf(Buffer.from('504b0506', 'hex'));
    fail(
        end >= 0 && end + 22 <= buffer.length,
        'Excel 文件不是有效的 xlsx 压缩包。',
    );
    const count = buffer.readUInt16LE(end + 10);
    let offset = buffer.readUInt32LE(end + 16),
        total = 0;
    fail(
        count > 0 && count <= 1000 && offset < buffer.length,
        'Excel 文件结构或条目数量超限。',
    );
    for (let n = 0; n < count; n++) {
        fail(
            offset + 46 <= buffer.length &&
                buffer.readUInt32LE(offset) === 0x02014b50,
            'Excel 文件目录损坏。',
        );
        fail(
            !(buffer.readUInt16LE(offset + 8) & 1),
            '不支持加密 Excel，请先取消文件密码。',
        );
        total += buffer.readUInt32LE(offset + 24);
        fail(total <= 50 * 1024 * 1024, 'Excel 解压后超过 50 MB，请拆分文件。');
        offset +=
            46 +
            buffer.readUInt16LE(offset + 28) +
            buffer.readUInt16LE(offset + 30) +
            buffer.readUInt16LE(offset + 32);
    }
}
async function readRows(buffer, format) {
    fail(
        Buffer.isBuffer(buffer) &&
            buffer.length > 0 &&
            buffer.length <= 5 * 1024 * 1024,
        '文件不能为空且不能超过 5 MB。',
    );
    let rows;
    if (format === 'xlsx') {
        checkZip(buffer);
        const book = new ExcelJS.Workbook();
        try {
            await book.xlsx.load(buffer);
        } catch {
            fail(false, '无法读取 Excel，请使用未加密的 .xlsx 文件。');
        }
        const sheet = book.worksheets[0];
        fail(
            sheet && sheet.rowCount <= 501 && sheet.columnCount <= 50,
            '请使用首个工作表，最多 500 行会员、50 列。',
        );
        rows = [];
        sheet.eachRow({ includeEmpty: false }, (row) => {
            const values = [];
            for (let i = 1; i <= sheet.columnCount; i++) {
                const value = row.getCell(i).value;
                fail(
                    !(
                        value &&
                        typeof value === 'object' &&
                        ('formula' in value || 'sharedFormula' in value)
                    ),
                    `第 ${row.number} 行含公式，请粘贴为值后再导入。`,
                );
                values.push(
                    value instanceof Date
                        ? value.toISOString().slice(0, 10)
                        : value === null
                          ? ''
                          : typeof value === 'object'
                            ? row.getCell(i).text
                            : String(value),
                );
            }
            rows.push(values);
        });
    } else {
        fail(format === 'csv', '仅支持 .xlsx 或 .csv 文件。');
        let text;
        try {
            text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        } catch {
            try { text = new TextDecoder('gb18030', { fatal: true }).decode(buffer); }
            catch { fail(false,'无法识别 CSV 编码，请另存为 UTF-8 CSV。'); }
        }
        try {
            rows = parse(text, {
                bom: true,
                skip_empty_lines: true,
                trim: true,
                max_record_size: 20000,
            });
        } catch {
            fail(false, 'CSV 格式不正确，请检查引号、分隔符或文件编码。');
        }
    }
    fail(
        rows.length >= 2 && rows.length <= 501,
        '文件应包含一行表头和 1–500 行会员数据。',
    );
    const headers = rows.shift().map((value) => String(value).trim());
    while (headers.at(-1) === '') headers.pop();
    fail(
        headers.length > 0 &&
            headers.length <= 50 &&
            headers.every(Boolean) &&
            new Set(headers).size === headers.length,
        '表头不能为空或重名，最多 50 列。',
    );
    fail(
        rows.every((row) => row.slice(headers.length).every((v) => !v)),
        '存在没有表头的数据列，请补全表头。',
    );
    return {
        headers,
        rows: rows.map((row) =>
            headers.map((_, i) => String(row[i] ?? '').trim()),
        ),
    };
}
function normalizeRows(source, mapping) {
    const used = new Set();
    for (const field of fields) {
        const column = mapping[field.key];
        if (column === undefined || column === null || column === '') {
            fail(!field.required, '请匹配必填字段：' + field.label);
            continue;
        }
        fail(
            Number.isInteger(column) &&
                column >= 0 &&
                column < source.headers.length,
            '字段映射无效。',
        );
        fail(!used.has(column), '一个文件列不能重复匹配多个字段。');
        used.add(column);
    }
    const result = [],
        errors = [];
    const phones = new Set();
    source.rows.forEach((values, index) => {
        const row = { requestId: randomUUID() },
            issues = [];
        for (const field of fields) {
            const raw = values[mapping[field.key]] ?? '';
            row[field.key] = raw;
        }
        row.phone = normalizePhone(row.phone);
        if (!row.name || row.name.length > 40)
            issues.push('姓名必填且最多 40 字');
        if (!/^\+?\d{6,20}$/.test(row.phone))
            issues.push('手机号必填，请使用文本格式的有效号码');
        if (phones.has(row.phone)) issues.push('文件内手机号重复');
        phones.add(row.phone);
        row.membershipLevel ||= '普通会员';
        for (const key of ['balance', 'totalSpending']) {
            row[key] = row[key].replace(/[￥¥,\s]/g, '');
            if (row[key] && !/^\d{1,8}(?:\.\d{1,2})?$/.test(row[key]))
                issues.push(
                    (key === 'balance' ? '余额' : '累计消费') +
                        '须为非负金额，最多两位小数',
                );
        }
        for (const key of ['joinedOn', 'lastVisit'])
            row[key] = row[key]
                .replace(/\//g, '-')
                .replace(
                    /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
                    (_, y, m, d) =>
                        `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`,
                );
        for (const key of ['marketingConsent', 'careOptIn']) {
            const value = row[key].toLowerCase();
            if (['', '否', '未同意', 'false', '0'].includes(value))
                row[key] = false;
            else if (['是', '已同意', 'true', '1'].includes(value))
                row[key] = true;
            else
                issues.push(
                    (key === 'marketingConsent' ? '营销授权' : '护理授权') +
                        '须填“是”或“否”',
                );
        }
        if (row.note.length > 1200) issues.push('备注最多 1200 字');
        if (issues.length)
            errors.push({ row: index + 2, name: row.name, issues });
        result.push(row);
    });
    return { rows: result, errors };
}
function createMemberImport(
    pool,
    { snapshot = defaultSnapshot, now = () => new Date() } = {},
) {
    async function engineFor(tx) {
        const { initialState, reminders } = await loadTeamState(tx);
        return {
            engine: createTeamStore(snapshot, {
                initialState,
                careReminders: reminders,
                now,
            }),
            reminders,
        };
    }
    async function inspect(account, buffer, format) {
        const source = await readRows(buffer, format),
            id = randomUUID();
        await transaction(pool, async (tx) => {
            await tx.query(
                "DELETE FROM memberimports WHERE status='preview' AND expires_at<CURRENT_TIMESTAMP",
            );
            await tx.query(
                "INSERT INTO memberimports(id,created_by,content_hash,payload,status) VALUES($1,$2,'',$3,'preview')",
                [id, account.username, JSON.stringify(source)],
            );
        });
        const mapping = Object.fromEntries(
            fields
                .map((field) => [
                    field.key,
                    source.headers.findIndex((header) =>
                        field.aliases.some(
                            (a) => a.toLowerCase() === header.toLowerCase(),
                        ),
                    ),
                ])
                .map(([key, value]) => [key, value < 0 ? null : value]),
        );
        return {
            uploadId: id,
            headers: source.headers,
            rowCount: source.rows.length,
            sample: source.rows.slice(0, 5),
            fields: fields.map(({ aliases, ...field }) => field),
            mapping,
        };
    }
    async function load(tx, account, id) {
        fail(uuid(id), '导入批次编号无效。');
        const row = (
            await tx.query(
                'SELECT * FROM memberimports WHERE id=$1 AND created_by=$2',
                [id, account.username],
            )
        ).rows[0];
        fail(row, '导入批次不存在。', 404);
        fail(
            row.status === 'committed' || row.expires_at > new Date(),
            '预览已过期，请重新上传文件。',
            409,
        );
        return row;
    }
    function validate(engine, rows, errors) {
        const phones = new Set(
            engine
                .workspaceSnapshot()
                .members.map((m) => normalizePhone(m.phone))
                .filter(Boolean),
        );
        rows.forEach((row, index) => {
            if (phones.has(row.phone))
                errors.push({
                    row: index + 2,
                    name: row.name,
                    issues: ['手机号已存在，本次不会覆盖原会员'],
                });
            if (!errors.some((e) => e.row === index + 2))
                try {
                    engine.applyAction(
                        { role: 'owner', employee: '' },
                        { ...row, action: 'registerMember' },
                    );
                } catch (error) {
                    errors.push({
                        row: index + 2,
                        name: row.name,
                        issues: [error.message],
                    });
                }
        });
        return errors;
    }
    async function preview(account, { uploadId, mapping }) {
        return transaction(pool, async (tx) => {
            const batch = await load(tx, account, uploadId);
            fail(batch.status === 'preview', '该批次已导入。', 409);
            const source = JSON.parse(batch.payload),
                normalized = normalizeRows(source, mapping || {}),
                { engine } = await engineFor(tx);
            validate(engine, normalized.rows, normalized.errors);
            const revision = randomUUID(),
                hash = createHash('sha256')
                    .update(
                        JSON.stringify(
                            normalized.rows.map(({ requestId, ...row }) => row),
                        ),
                    )
                    .digest('hex');
            const previous = (
                await tx.query(
                    "SELECT result FROM memberimports WHERE content_hash=$1 AND status='committed' LIMIT 1",
                    [hash],
                )
            ).rows[0];
            const alreadyImported = previous
                ? JSON.parse(previous.result)
                : null;
            await tx.query(
                'UPDATE memberimports SET payload=$2,content_hash=$3 WHERE id=$1',
                [
                    uploadId,
                    JSON.stringify({
                        ...source,
                        normalized: normalized.rows,
                        revision,
                        valid: normalized.errors.length === 0,
                    }),
                    hash,
                ],
            );
            return {
                uploadId,
                revision,
                rowCount: normalized.rows.length,
                rows: normalized.rows
                    .slice(0, 100)
                    .map(({ requestId, ...row }) => row),
                errors: normalized.errors.slice(0, 200),
                errorCount: normalized.errors.length,
                alreadyImported,
                warning:
                    '仅新增真实会员，不导入服务订单；未填写授权时默认为未授权。',
            };
        });
    }
    async function commit(account, { uploadId, revision }) {
        return transaction(pool, async (tx) => {
            const batch = await load(tx, account, uploadId);
            if (batch.status === 'committed')
                return { ...JSON.parse(batch.result), reused: true };
            const source = JSON.parse(batch.payload);
            fail(
                source.revision === revision &&
                    source.valid &&
                    source.normalized?.length,
                '请重新预览并修正全部错误后导入。',
                409,
            );
            const previous = (
                await tx.query(
                    "SELECT result FROM memberimports WHERE content_hash=$1 AND status='committed' LIMIT 1",
                    [batch.content_hash],
                )
            ).rows[0];
            if (previous)
                return { ...JSON.parse(previous.result), reused: true };
            const { engine, reminders } = await engineFor(tx),
                errors = [];
            const test = createTeamStore(snapshot, {
                initialState: engine.exportState(),
                careReminders: reminders,
                now,
            });
            validate(test, source.normalized, errors);
            fail(
                !errors.length,
                '会员资料已变化，请重新预览：' +
                    errors
                        .slice(0, 3)
                        .map((e) => e.issues.join('；'))
                        .join('；'),
                409,
            );
            const memberIds = [];
            for (const row of source.normalized) {
                const { note, ...body } = row,
                    result = engine.applyAction(account, {
                        ...body,
                        action: 'registerMember',
                    });
                memberIds.push(result.memberId);
                if (note)
                    engine.applyAction(account, {
                        action: 'note',
                        memberId: result.memberId,
                        text: note,
                        type: 'communication',
                        pinned: false,
                    });
            }
            await persistTeamState(tx, engine, reminders);
            const result = { imported: memberIds.length, memberIds };
            await tx.query(
                "UPDATE memberimports SET status='committed',payload='{}'::jsonb,result=$2 WHERE id=$1",
                [uploadId, JSON.stringify(result)],
            );
            return result;
        });
    }
    return { inspect, preview, commit };
}
async function template(format) {
    const headers = fields.map((field) => field.label);
    if (format === 'csv')
        return Buffer.from('\uFEFF' + headers.join(',') + '\r\n', 'utf8');
    const book = new ExcelJS.Workbook(),
        sheet = book.addWorksheet('会员导入');
    sheet.addRow(headers);
    sheet.getRow(1).font = { bold: true };
    sheet.columns.forEach((column, index) => {
        column.width = index === 11 ? 30 : 18;
        column.numFmt = '@';
    });
    const help = book.addWorksheet('填写说明');
    help.addRow(['姓名、手机号必填；手机号建议设为文本。']);
    help.addRow(['营销授权、护理回访授权填“是”或“否”；留空视为未授权。']);
    help.addRow([
        '金额为非负数，日期使用 YYYY-MM-DD。只新增，不覆盖；一次最多 500 位。',
    ]);
    help.getColumn(1).width = 100;
    return Buffer.from(await book.xlsx.writeBuffer());
}
module.exports = {
    createMemberImport,
    readRows,
    normalizeRows,
    normalizePhone,
    template,
    fields,
};
