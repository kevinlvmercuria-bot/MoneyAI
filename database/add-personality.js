'use strict';
// 给 members 表加 personality 字段，按规则从现有数据推断
// 规则：可爱风(年轻感/卡通/亮色) 温柔风(裸色/法式/低饱和) 直爽风(纯色/简约/高频) 优雅风(新中式/猫眼/高消费)
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const DB_PATH = path.join(__dirname, 'data', 'nailmate.db');
const db = new DatabaseSync(DB_PATH);

// 1. 加字段（如果不存在）
const cols = db.prepare('PRAGMA table_info(members)').all().map(c => c.name);
if (!cols.includes('personality')) {
    db.exec("ALTER TABLE members ADD COLUMN personality TEXT DEFAULT ''");
    console.log('✓ 已添加 personality 字段');
} else {
    console.log('✓ personality 字段已存在');
}

// 2. 推断规则（按主风格+消费行为，贴合实际数据）
function inferPersonality(row) {
    const styles = (row.preferred_styles || '').split('|').filter(Boolean);
    const note = row.latest_note || '';
    const spend = row.total_spending || 0;
    const visits = row.visit_count || 0;
    const days = row.days_since_last_visit || 0;
    const primary = styles[0] || '';
    const secondary = styles[1] || '';

    // 可爱风：渐变/跳色感强 + 年轻活跃（到店频繁、近期来过）
    // 渐变、猫眼这类"玩色"风格，配合高频低消费，指向年轻活泼客群
    if ((primary === '渐变' || secondary === '渐变') && visits >= 4 && spend < 2500) {
        return '可爱风';
    }
    // 优雅风：新中式为主，或猫眼+高消费
    if (primary === '新中式' || (primary === '猫眼' && (spend > 2000 || visits >= 5))) {
        return '优雅风';
    }
    // 直爽风：纯色/极简为主 + 高频消费（决策快、不纠结）
    if (primary === '纯色' && visits >= 6) {
        return '直爽风';
    }
    // 温柔风：法式/裸色为主（经典、安全、低决策压力）
    if (primary === '法式' || primary === '裸色') {
        return '温柔风';
    }
    // 兜底按消费行为
    if (visits >= 6) return '直爽风';
    if (spend > 3000) return '优雅风';
    return '温柔风';
}

// 3. 批量更新
const rows = db.prepare('SELECT member_id, preferred_styles, latest_note, total_spending, visit_count, days_since_last_visit FROM members').all();
const update = db.prepare('UPDATE members SET personality = ? WHERE member_id = ?');
let counts = { 可爱风: 0, 温柔风: 0, 直爽风: 0, 优雅风: 0 };

db.exec('BEGIN');
for (const row of rows) {
    const p = inferPersonality(row);
    update.run(p, row.member_id);
    counts[p]++;
}
db.exec('COMMIT');

console.log('✓ 已更新', rows.length, '条会员性格标签');
console.log('分布:', counts);

// 4. 抽样验证
console.log('\n样例:');
const samples = db.prepare("SELECT member_id, display_name, preferred_styles, personality FROM members WHERE personality != '' LIMIT 5").all();
samples.forEach(s => console.log(`  ${s.member_id} ${s.display_name} [${s.preferred_styles}] → ${s.personality}`));

db.close();
