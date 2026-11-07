'use strict';

const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { personalityNote } = require('../public/communication');
const { DEMO_DATE } = require('../public/rules');

// 只给已有 simulation 资料追加性格备注，不重算标签或改写旧备注。
function addPersonalityNotes(file) {
    const db = new DatabaseSync(file, { open: true });
    try {
        db.exec('PRAGMA foreign_keys=ON');
        db.exec('BEGIN IMMEDIATE');
        try {
            const members = db.prepare('SELECT member_id, personality, data_type FROM members ORDER BY member_id').all();
            if (!members.length || members.some((member) => member.data_type !== 'simulation'))
                throw new Error('仅允许处理非空 simulation 会员资料');
            const annotations = members.map((member) => ({ ...member, text: personalityNote(member.personality) }));
            const existing = db.prepare('SELECT * FROM member_notes WHERE note_id = ?');
            const insert = db.prepare(`INSERT INTO member_notes
                (note_id,member_id,note_text,note_type,author_role,author_name,source,is_pinned,created_at,updated_at,data_type)
                VALUES (?,?,?,'communication','system','资料整理（演示）','personality_simulation',0,?,?,'simulation')`);
            const updateCount = db.prepare('UPDATE members SET notes_count=notes_count+1 WHERE member_id=?');
            let added = 0;
            for (const member of annotations) {
                const id = 'PERSONALITY-' + member.member_id;
                const before = existing.get(id);
                if (before) {
                    if (before.member_id !== member.member_id || before.source !== 'personality_simulation' || before.note_text !== member.text)
                        throw new Error('性格备注已存在且内容不同，请先核对');
                    continue;
                }
                const date = DEMO_DATE + 'T09:00:00+08:00';
                insert.run(id, member.member_id, member.text, date, date);
                updateCount.run(member.member_id);
                added++;
            }
            if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length)
                throw new Error('来源数据库完整性检查未通过');
            db.exec('COMMIT');
            return { members: members.length, added, skipped: members.length - added };
        } catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
    } finally {
        db.close();
    }
}

if (require.main === module) {
    try {
        console.log(addPersonalityNotes(path.join(__dirname, '..', 'data', 'nailmate.db')));
    } catch (error) {
        console.error('性格备注整理失败：', error.message);
        process.exitCode = 1;
    }
}
module.exports = { addPersonalityNotes };
