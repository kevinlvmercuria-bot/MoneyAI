'use strict';

const {
    SCENARIOS,
    DEMO_SERVICE_PRICE,
    buildReviewTask,
    PRODUCTS,
    PLANNED_PRODUCTS,
    DEMO_DATE,
} = require('../../public/rules');

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
    const recordsets = [];
    for (const query of [
        'SELECT profile FROM Members ORDER BY id',
        'SELECT * FROM Tasks ORDER BY id',
        'SELECT name,description AS "desc",created_at FROM OperationLogs ORDER BY id DESC LIMIT 40',
        'SELECT id,member_id AS "memberId",outcome,note,owner,follow_up AS "followUp",recorded_as_of AS "recordedAsOf" FROM CareRecords ORDER BY id DESC',
        'SELECT profile FROM Products ORDER BY id',
        'SELECT source_hash AS "sourceHash",counts_json AS counts,imported_at AS "importedAt" FROM ImportRuns ORDER BY imported_at DESC LIMIT 1',
        'SELECT id,member_id AS "memberId",model,message,original_message AS "originalMessage",reason,product_ids AS "productIds",context_json AS "contextJson",created_at AS "createdAt",copied_at AS "copiedAt" FROM CopyDrafts ORDER BY id DESC LIMIT 50',
        'SELECT product_id AS "productId",MAX(id) AS "imageId" FROM ProductImages GROUP BY product_id',
        "SELECT member_id AS \"memberId\",payload->>'care_need_tags' AS tags,payload->>'last_service_type' AS \"lastService\",payload->>'preferred_care_service' AS \"preferredService\",payload->>'recommended_followup_date' AS \"followupDate\",payload->>'care_followup_status' AS status,payload->>'care_followup_opt_in' AS \"optIn\" FROM SourceRecords WHERE source_table='member_care_profiles'",
        'SELECT member_id AS "memberId",payload FROM SourceRecords WHERE source_table=\'orders\'',
        'SELECT * FROM MemberNoteEdits ORDER BY is_pinned DESC,updated_at DESC',
    ])
        recordsets.push((await tx.query(query)).rows);
    const careRecords = recordsets[3];
    const careByMember = new Map();
    for (const record of careRecords)
        if (!careByMember.has(record.memberId))
            careByMember.set(record.memberId, record);
    const images = new Map(
        recordsets[7].map((image) => [image.productId, image.imageId]),
    );
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
        if (!catalog.some((item) => item.id === product.id))
            catalog.push(product);
    const visits = new Map();
    for (const row of recordsets[9]) {
        const order = JSON.parse(row.payload);
        const days = Math.floor(
            (Date.parse(DEMO_DATE) - Date.parse(order.order_date)) / 86400000,
        );
        if (
            order.order_type !== 'nail_service' ||
            days < 0 ||
            (visits.has(row.memberId) && visits.get(row.memberId).days <= days)
        )
            continue;
        visits.set(row.memberId, {
            days,
            date: order.order_date,
            name:
                catalog.find((product) => product.id === order.product_id)
                    ?.name ||
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
            const noteEdit = recordsets[10].find(
                (note) => note.member_id === member.id,
            );
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
                            (Date.parse(DEMO_DATE) -
                                Date.parse(record.recordedAsOf)) /
                                86400000,
                        ),
                    ),
                );
            for (const task of taskList.filter(
                (task) =>
                    task.memberId === member.id &&
                    task.status === 'executed_simulated',
            ))
                member.contactDays = Math.min(
                    member.contactDays,
                    Math.max(
                        0,
                        Math.floor(
                            (Date.parse(DEMO_DATE) -
                                Date.parse(
                                    task.context?.executedOn || DEMO_DATE,
                                )) /
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
    const result = await tx.query(
        `INSERT INTO Tasks (member_id, goal, status, strategy, priority, message, reason, context_json)
                VALUES ($2, $3, 'pending_review', $4, $5, $6, $7, $1) RETURNING id`,
        [
            task.context ? JSON.stringify(task.context) : null,
            task.memberId,
            task.goal,
            task.strategy,
            task.priority,
            task.message,
            task.reason,
        ],
    );
    return 'T' + String(result.rows[0].id).padStart(4, '0');
}

async function updateTask(tx, taskId, status, editedMessage, scenario = null) {
    await tx.query(
        `UPDATE Tasks SET status = $2::varchar(20), edited_message = $3, scenario = $4, context_json = CASE WHEN $2::varchar(20) = 'executed_simulated' THEN jsonb_set(COALESCE(context_json,'{}'::jsonb),'{executedOn}',to_jsonb($5::text)) ELSE context_json END WHERE id = $1`,
        [Number(taskId.slice(1)), status, editedMessage, scenario, DEMO_DATE],
    );
}

async function log(tx, name, desc) {
    await tx.query(
        'INSERT INTO OperationLogs (name, description) VALUES ($1, $2)',
        [name, desc],
    );
}

async function seedTask(tx, demoMember) {
    await insertTask(tx, buildReviewTask(demoMember, null));
}

async function insertCareRecord(tx, record) {
    await tx.query(
        `INSERT INTO CareRecords (member_id, outcome, note, owner, follow_up, recorded_as_of)
            VALUES ($1, $2, $3, $4, $5, $6)`,
        [
            record.memberId,
            record.outcome,
            record.note,
            record.owner,
            record.followUp,
            record.recordedAsOf,
        ],
    );
}

async function memberDetails(tx, memberId) {
    const { rows: sourceRows } = await tx.query(
        `SELECT source_table, payload FROM SourceRecords WHERE member_id = $1
            AND source_table IN ('orders', 'member_notes', 'contact_logs', 'appointments', 'member_care_profiles')`,
        [memberId],
    );
    const rows = (name, date) =>
        sourceRows
            .filter((row) => row.source_table === name)
            .map((row) => JSON.parse(row.payload))
            .sort((a, b) => String(b[date]).localeCompare(String(a[date])))
            .slice(0, 10);
    const edits = (
        await tx.query('SELECT * FROM MemberNoteEdits WHERE member_id = $1', [
            memberId,
        ])
    ).rows;
    const notes = new Map(
        rows('member_notes', 'created_at').map((note) => [note.note_id, note]),
    );
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

module.exports = {
    state,
    insertTask,
    updateTask,
    log,
    seedTask,
    insertCareRecord,
    memberDetails,
};
