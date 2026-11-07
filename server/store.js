'use strict';

const { sql } = require('./db');
const { SCENARIOS, DEMO_SERVICE_PRICE, buildReviewTask } = require('../public/rules');

function toTask(row) {
    const scenario = SCENARIOS[row.scenario];
    return {
        id: 'T' + String(row.id).padStart(4, '0'),
        memberId: row.member_id,
        goal: row.goal,
        status: row.status,
        strategy: row.strategy,
        priority: row.priority,
        message: row.message,
        reason: row.reason,
        editedMessage: row.edited_message,
        result: scenario ? {
            reply: scenario.reply, booking: scenario.booking, visit: scenario.visit,
            spending: scenario.visit ? DEMO_SERVICE_PRICE : 0,
        } : null,
    };
}

async function state(tx) {
    const { recordsets } = await tx.request().query(`
        SELECT profile FROM dbo.Members ORDER BY id;
        SELECT * FROM dbo.Tasks ORDER BY id;
        SELECT TOP (40) name, description AS [desc], created_at FROM dbo.OperationLogs ORDER BY id DESC;
    `);
    return {
        members: recordsets[0].map((row) => JSON.parse(row.profile)),
        tasks: recordsets[1].map(toTask),
        logs: recordsets[2].map((row) => ({
            name: row.name, desc: row.desc,
            time: row.created_at.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }),
        })),
    };
}

async function insertTask(tx, task) {
    await tx.request()
        .input('memberId', sql.VarChar(5), task.memberId)
        .input('goal', sql.VarChar(10), task.goal)
        .input('strategy', sql.NVarChar(30), task.strategy)
        .input('priority', sql.Int, task.priority)
        .input('message', sql.NVarChar(1000), task.message)
        .input('reason', sql.NVarChar(400), task.reason)
        .query(`INSERT dbo.Tasks (member_id, goal, status, strategy, priority, message, reason)
                VALUES (@memberId, @goal, 'pending_review', @strategy, @priority, @message, @reason)`);
}

async function updateTask(tx, taskId, status, editedMessage, scenario = null) {
    await tx.request()
        .input('id', sql.Int, Number(taskId.slice(1)))
        .input('status', sql.VarChar(20), status)
        .input('message', sql.NVarChar(1000), editedMessage)
        .input('scenario', sql.VarChar(10), scenario)
        .query('UPDATE dbo.Tasks SET status = @status, edited_message = @message, scenario = @scenario WHERE id = @id');
}

async function log(tx, name, desc) {
    await tx.request()
        .input('name', sql.VarChar(40), name)
        .input('desc', sql.NVarChar(400), desc)
        .query('INSERT dbo.OperationLogs (name, description) VALUES (@name, @desc)');
}

async function seedTask(tx, demoMember) {
    await insertTask(tx, buildReviewTask(demoMember, null));
}

module.exports = { state, insertTask, updateTask, log, seedTask };
