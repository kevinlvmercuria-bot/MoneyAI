'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { addPersonalityNotes } = require('./personality-notes');

test('性格备注只追加模拟资料，原表数据保留，重跑无重复，异常整批回滚', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moneyai-personality-'));
    const file = path.join(dir, 'source.db');
    let db;
    try {
        fs.copyFileSync(path.join(__dirname, '..', 'data', 'nailmate.db'), file);
        db = new DatabaseSync(file);
        // 将独立副本恢复为整理前的测试起点，生产/来源文件从不写入。
        db.exec(`UPDATE members SET notes_count=notes_count-(SELECT COUNT(*) FROM member_notes n WHERE n.member_id=members.member_id AND n.source='personality_simulation');
            DELETE FROM member_notes WHERE source='personality_simulation';`);
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
        const before = Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all().map((row) => ({ ...row }))]));
        db.close(); db = null;
        const result = addPersonalityNotes(file);
        assert.equal(result.members, 2800);
        assert.equal(result.added, 2800);
        db = new DatabaseSync(file);
        for (const table of tables) {
            const after = db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all().map((row) => ({ ...row }));
            if (table === 'members') assert.deepEqual(after, before[table].map((row) => ({ ...row, notes_count: row.notes_count + 1 })));
            else if (table === 'member_notes') {
                assert.deepEqual(after.filter((row) => row.source !== 'personality_simulation'), before[table]);
                assert.equal(after.filter((row) => row.source === 'personality_simulation').length, 2800);
            } else assert.deepEqual(after, before[table], table);
        }
        db.close(); db = null;
        const firstRun = fs.readFileSync(file);
        assert.deepEqual(addPersonalityNotes(file), { members: 2800, added: 0, skipped: 2800 });
        assert.deepEqual(fs.readFileSync(file), firstRun);
        db = new DatabaseSync(file);
        db.exec("DELETE FROM member_notes WHERE source='personality_simulation'; UPDATE members SET notes_count=notes_count-1; UPDATE members SET personality='invalid' WHERE member_id='M2800';");
        db.close(); db = null;
        const invalid = fs.readFileSync(file);
        assert.throws(() => addPersonalityNotes(file), /性格标签无效/);
        assert.deepEqual(fs.readFileSync(file), invalid);
    } finally {
        db?.close();
        assert.ok(dir.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(dir).startsWith('moneyai-personality-'));
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
