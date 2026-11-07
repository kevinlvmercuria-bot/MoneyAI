'use strict';

const { sql } = require('./db');
const {
    SCENARIOS,
    DEMO_SERVICE_PRICE,
    buildReviewTask,
    PRODUCTS,
    PLANNED_PRODUCTS,
    DEMO_DATE,
} = require('../public/rules');

function toTask(row) {
    const scenario = SCENARIOS[row.scenario];
    return {
        id: 'T' + String(row.id).padStart(4, '0'),
        memberId: row.member_id,
        goal: row.goal,
        context: row.context_json ? JSON.parse(row.context_json) : null,
        status: row.status,
        strategy: row.strategy,
        priority: row.priority,
        message: row.message,
        reason: row.reason,
        editedMessage: row.edited_message,
        result: scenario
            ? {
                  reply: scenario.reply,
                  booking: scenario.booking,
                  visit: scenario.visit,
                  spending: scenario.visit ? DEMO_SERVICE_PRICE : 0,
              }
            : null,
    };
}

async function state(tx) {
    const { recordsets } = await tx.request().query(`
        SELECT profile FROM dbo.Members ORDER BY id;
        SELECT * FROM dbo.Tasks ORDER BY id;
        SELECT TOP (40) name, description AS [desc], created_at FROM dbo.OperationLogs ORDER BY id DESC;
        SELECT id, member_id AS memberId, outcome, note, owner,
            CONVERT(char(10), follow_up, 23) AS followUp,
            CONVERT(char(10), recorded_as_of, 23) AS recordedAsOf
        FROM dbo.CareRecords ORDER BY id DESC;
        SELECT profile FROM dbo.Products ORDER BY id;
        SELECT TOP (1) source_hash AS sourceHash, counts_json AS counts, imported_at AS importedAt FROM dbo.ImportRuns ORDER BY imported_at DESC;
        SELECT TOP (50) id, member_id AS memberId, model, message, original_message AS originalMessage,
            reason, product_ids AS productIds, context_json AS contextJson, created_at AS createdAt, copied_at AS copiedAt FROM dbo.CopyDrafts ORDER BY id DESC;
        SELECT product_id AS productId, MAX(id) AS imageId FROM dbo.ProductImages GROUP BY product_id;
        SELECT member_id AS memberId, JSON_VALUE(payload, '$.care_need_tags') AS tags,
            JSON_VALUE(payload, '$.last_service_type') AS lastService,
            JSON_VALUE(payload, '$.preferred_care_service') AS preferredService,
            JSON_VALUE(payload, '$.recommended_followup_date') AS followupDate,
            JSON_VALUE(payload, '$.care_followup_status') AS status,
            JSON_VALUE(payload, '$.care_followup_opt_in') AS optIn
        FROM dbo.SourceRecords WHERE source_table = 'member_care_profiles';
        SELECT member_id AS memberId, payload FROM dbo.SourceRecords WHERE source_table = 'orders';
        SELECT * FROM dbo.MemberNoteEdits ORDER BY is_pinned DESC, updated_at DESC;

    `);
    const careRecords = recordsets[3];
    const careByMember = new Map();
    for (const record of careRecords)
        if (!careByMember.has(record.memberId)) careByMember.set(record.memberId, record);
    const images = new Map(recordsets[7].map((image) => [image.productId, image.imageId]));
    const careProfiles = new Map(
        recordsets[8].map((profile) => [
            profile.memberId,
            { ...profile, optIn: ['true', '1'].includes(profile.optIn) },
        ]),
    );
    const taskList = recordsets[1].map(toTask);
    const catalog = recordsets[4].length
        ? recordsets[4].map((row) => JSON.parse(row.profile))
        : PRODUCTS;
    for (const product of PLANNED_PRODUCTS)
        if (!catalog.some((item) => item.id === product.id)) catalog.push(product);
    const visits = new Map();
    for (const row of recordsets[9]) {
        const order = JSON.parse(row.payload);
        const days = Math.floor((Date.parse(DEMO_DATE) - Date.parse(order.order_date)) / 86400000);
        if (
            order.order_type !== 'nail_service' ||
            days < 0 ||
            days > 7 ||
            (visits.has(row.memberId) && visits.get(row.memberId).days <= days)
        )
            continue;
        visits.set(row.memberId, {
            days,
            date: order.order_date,
            name:
                catalog.find((product) => product.id === order.product_id)?.name ||
                order.style ||
                '美甲服务',
            productId: order.product_id,
        });
    }
    return {
        members: recordsets[0].map((row) => {
            const member = JSON.parse(row.profile);
            const record = careByMember.get(member.id);
            member.careHandled = Boolean(record);
            member.followupRecord = record || null;
            member.executedFollowups = taskList
                .filter(
                    (task) =>
                        task.memberId === member.id &&
                        task.status === 'executed_simulated' &&
                        task.context?.objective === 'scheduled',
                )
                .map((task) => task.context.followUp);
            member.recentNailVisit = visits.get(member.id) || null;
            const noteEdit = recordsets[10].find((note) => note.member_id === member.id);
            if (noteEdit) member.latestNote = noteEdit.note_text;
            member.careProfile = careProfiles.get(member.id) || null;
            member.carePaused = record?.outcome === '暂不联系';
            if (record?.outcome === '不再营销') member.consent = false;
            if (record && ['已沟通', '未回复'].includes(record.outcome))
                member.contactDays = Math.min(
                    member.contactDays,
                    Math.max(
                        0,
                        Math.floor(
                            (Date.parse(DEMO_DATE) - Date.parse(record.recordedAsOf)) / 86400000,
                        ),
                    ),
                );
            for (const task of taskList.filter(
                (task) => task.memberId === member.id && task.status === 'executed_simulated',
            ))
                member.contactDays = Math.min(
                    member.contactDays,
                    Math.max(
                        0,
                        Math.floor(
                            (Date.parse(DEMO_DATE) -
                                Date.parse(task.context?.executedOn || DEMO_DATE)) /
                                86400000,
                        ),
                    ),
                );
            return member;
        }),
        careRecords,
        products: catalog.map((product) => ({
            ...product,
            imageUrl: images.has(product.id)
                ? '/api/product-images/' + images.get(product.id)
                : null,
        })),
        copyDrafts: recordsets[6].map((row) => ({
            ...row,
            productIds: JSON.parse(row.productIds),
            context: row.contextJson ? JSON.parse(row.contextJson) : null,
        })),
        ai: require('./ai-copy').metadata(),
        dataSource: recordsets[5].length
            ? {
                  ...recordsets[5][0],
                  counts: JSON.parse(recordsets[5][0].counts),
                  kind: 'sqlite_import',
              }
            : { kind: 'generated_demo' },
        tasks: taskList,
        logs: recordsets[2].map((row) => ({
            name: row.name,
            desc: row.desc,
            time: row.created_at.toLocaleTimeString('zh-CN', {
                timeZone: 'Asia/Shanghai',
                hour12: false,
            }),
        })),
    };
}

async function insertTask(tx, task) {
    const result = await tx
        .request()
        .input('context', sql.NVarChar(sql.MAX), task.context ? JSON.stringify(task.context) : null)
        .input('memberId', sql.VarChar(5), task.memberId)
        .input('goal', sql.VarChar(10), task.goal)
        .input('strategy', sql.NVarChar(30), task.strategy)
        .input('priority', sql.Int, task.priority)
        .input('message', sql.NVarChar(1000), task.message)
        .input('reason', sql.NVarChar(400), task.reason)
        .query(`INSERT dbo.Tasks (member_id, goal, status, strategy, priority, message, reason, context_json)
                OUTPUT INSERTED.id VALUES (@memberId, @goal, 'pending_review', @strategy, @priority, @message, @reason, @context)`);
    return 'T' + String(result.recordset[0].id).padStart(4, '0');
}

async function updateTask(tx, taskId, status, editedMessage, scenario = null) {
    await tx
        .request()
        .input('id', sql.Int, Number(taskId.slice(1)))
        .input('status', sql.VarChar(20), status)
        .input('message', sql.NVarChar(1000), editedMessage)
        .input('scenario', sql.VarChar(10), scenario)
        .input('asOf', sql.VarChar(10), DEMO_DATE)
        .query(
            `UPDATE dbo.Tasks SET status = @status, edited_message = @message, scenario = @scenario, context_json = CASE WHEN @status = 'executed_simulated' THEN JSON_MODIFY(COALESCE(context_json, '{}'), '$.executedOn', @asOf) ELSE context_json END WHERE id = @id`,
        );
}

async function log(tx, name, desc) {
    await tx
        .request()
        .input('name', sql.VarChar(40), name)
        .input('desc', sql.NVarChar(400), desc)
        .query('INSERT dbo.OperationLogs (name, description) VALUES (@name, @desc)');
}

async function seedTask(tx, demoMember) {
    await insertTask(tx, buildReviewTask(demoMember, null));
}

async function insertCareRecord(tx, record) {
    await tx
        .request()
        .input('memberId', sql.VarChar(5), record.memberId)
        .input('outcome', sql.NVarChar(20), record.outcome)
        .input('note', sql.NVarChar(1000), record.note)
        .input('owner', sql.NVarChar(80), record.owner)
        .input('followUp', sql.VarChar(10), record.followUp)
        .input('recordedAsOf', sql.VarChar(10), record.recordedAsOf)
        .query(`INSERT dbo.CareRecords (member_id, outcome, note, owner, follow_up, recorded_as_of)
            VALUES (@memberId, @outcome, @note, @owner, @followUp, @recordedAsOf)`);
}

async function memberDetails(tx, memberId) {
    const { recordset } = await tx.request().input('memberId', sql.VarChar(5), memberId)
        .query(`SELECT source_table, payload FROM dbo.SourceRecords WHERE member_id = @memberId
            AND source_table IN ('orders', 'member_notes', 'contact_logs', 'appointments', 'member_care_profiles')`);
    const rows = (name, date) =>
        recordset
            .filter((row) => row.source_table === name)
            .map((row) => JSON.parse(row.payload))
            .sort((a, b) => String(b[date]).localeCompare(String(a[date])))
            .slice(0, 10);
    const edits = (
        await tx
            .request()
            .input('member', sql.VarChar(5), memberId)
            .query('SELECT * FROM dbo.MemberNoteEdits WHERE member_id = @member')
    ).recordset;
    const notes = new Map(rows('member_notes', 'created_at').map((note) => [note.note_id, note]));
    for (const edit of edits)
        notes.set(edit.note_id, {
            ...notes.get(edit.note_id),
            note_id: edit.note_id,
            member_id: memberId,
            note_type: edit.note_type,
            note_text: edit.note_text,
            is_pinned: Boolean(edit.is_pinned),
            author_name: edit.author_name,
            created_at: edit.updated_at.toISOString(),
            updated_at: edit.updated_at.toISOString(),
        });
    return {
        orders: rows('orders', 'order_date'),
        notes: [...notes.values()].sort(
            (a, b) =>
                Number(b.is_pinned) - Number(a.is_pinned) ||
                String(b.updated_at || b.created_at).localeCompare(
                    String(a.updated_at || a.created_at),
                ),
        ),
        contacts: rows('contact_logs', 'contact_date'),
        appointments: rows('appointments', 'appointment_date'),
        careProfile: rows('member_care_profiles', 'updated_at')[0] || null,
    };
}

module.exports = { state, insertTask, updateTask, log, seedTask, insertCareRecord, memberDetails };
