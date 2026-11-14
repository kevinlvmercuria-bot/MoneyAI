'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { gunzipSync } = require('node:zlib');
const root = path.join(__dirname, '..');

// The versioned fixture works in source archives and builds without .git or network.
// It contains only the fixed historical simulation, never the local data directory.
const fixture = path.join(root, 'database/fixtures/team-demo.json.gz');
const snapshot = JSON.parse(gunzipSync(fs.readFileSync(fixture), { maxOutputLength: 16 * 1024 * 1024 }).toString('utf8'));
if (snapshot.data_type !== 'simulation' || snapshot.members?.length !== 2800)
    throw new Error('模拟快照标记或会员数不符。');
for (const table of ['members', 'orders', 'products', 'appointments', 'contact_logs', 'member_notes', 'member_care_profiles', 'campaign_tasks']) {
    if (!Array.isArray(snapshot[table]) || snapshot[table].some(row => row.data_type !== 'simulation'))
        throw new Error(`模拟资料 ${table} 校验失败。`);
}
const destination = path.resolve(process.env.CLOUD_DEMO_DATA_DIR || path.join(root, 'data'));
fs.mkdirSync(destination, { recursive: true });
const output = path.join(destination, 'team-data.json');
const bytes = JSON.stringify(snapshot);
if (fs.existsSync(output)) {
    if (fs.readFileSync(output, 'utf8') !== bytes)
        throw new Error('目标已有不同的数据文件，已停止；请使用独立云端构建目录。');
} else fs.writeFileSync(output, bytes, { flag: 'wx' });
console.log('云端演示模拟资料已准备：2800 位会员。');
