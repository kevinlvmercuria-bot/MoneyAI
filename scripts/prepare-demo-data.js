'use strict';

// Recover only the repository's historical simulation fixtures, never live data.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const root = path.join(__dirname, '..');
const snapshotPath = path.join(root, 'data/team-data.json');
const sqlitePath = path.join(root, 'data/nailmate.db');
const prototype = '09ca7b6dfa78278c4a4b401f1a0ec31d5fad7695';
const legacy = '31306467ea8cfb9594776569ffc997cc7426e47b';
const tables = ['members', 'orders', 'products', 'appointments', 'contact_logs',
    'member_notes', 'member_care_profiles', 'campaign_tasks'];

function historicalFile(ref, file) {
    try {
        return execFileSync('git', ['show', `${ref}:${file}`], {
            cwd: root, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
        });
    } catch {
        throw new Error(`缺少历史模拟资料 ${ref}:${file}。请先运行 git fetch origin，或从受控备份恢复 data 目录。`);
    }
}

function validateSnapshot(snapshot) {
    if (snapshot.data_type !== 'simulation' || snapshot.as_of_date !== '2026-11-07'
        || !snapshot.snapshot_id || !snapshot.members?.length || !snapshot.products?.length)
        throw new Error('模拟快照标记、基准日或必要资料无效。');
    for (const table of tables) {
        if (!Array.isArray(snapshot[table]) || snapshot[table].some(row => row.data_type !== 'simulation'))
            throw new Error(`模拟快照 ${table} 含非模拟数据或格式无效。`);
    }
}

function prepareDemoData() {
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    if (fs.existsSync(snapshotPath)) {
        // An existing local snapshot may have intentional changes: preserve it.
        validateSnapshot(JSON.parse(fs.readFileSync(snapshotPath, 'utf8')));
        console.log('保留已有 data/team-data.json。');
    } else {
        const html = historicalFile(prototype, 'nailmate/NailMate_AI_微信分享版.html').toString('utf8');
        const match = html.match(/<script[^>]*id="nailmate-data"[^>]*>([\s\S]*?)<\/script>/);
        if (!match) throw new Error('历史分享版中未找到模拟快照。');
        const snapshot = JSON.parse(match[1]);
        validateSnapshot(snapshot);
        fs.writeFileSync(snapshotPath, JSON.stringify(snapshot), { flag: 'wx' });
        console.log(`已恢复历史模拟快照：${snapshot.members.length} 位会员。`);
    }
    if (fs.existsSync(sqlitePath)) {
        console.log('保留已有 data/nailmate.db。');
    } else {
        const bytes = historicalFile(legacy, 'data/nailmate.db');
        // SQLite's header is stable; detailed integrity is checked below.
        if (bytes.subarray(0, 16).toString() !== 'SQLite format 3\0')
            throw new Error('历史 SQLite 文件格式无效。');
        fs.writeFileSync(sqlitePath, bytes, { flag: 'wx' });
        console.log('已恢复旧版 SQLite 模拟来源文件。');
    }
    const db = new DatabaseSync(sqlitePath, { readOnly: true });
    try {
        if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok'
            || db.prepare('PRAGMA foreign_key_check').all().length)
            throw new Error('SQLite 完整性检查失败。');
    } finally { db.close(); }
    console.log('模拟资料准备完成；未连接或修改 SQL Server。');
}

if (require.main === module) {
    try { prepareDemoData(); }
    catch (error) { console.error('模拟资料准备失败：', error.message); process.exitCode = 1; }
}

module.exports = { prepareDemoData };
