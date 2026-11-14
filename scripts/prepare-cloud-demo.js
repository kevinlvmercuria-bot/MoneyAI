'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const ref = '09ca7b6dfa78278c4a4b401f1a0ec31d5fad7695';
const file = 'nailmate/NailMate_AI_微信分享版.html';
const git = args => execFileSync('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

// Always recover the fixed historical simulation; never upload the local data directory.
let html;
try { html = git(['show', `${ref}:${file}`]); }
catch {
    git(['fetch', '--depth=1', 'origin', ref]);
    html = git(['show', `${ref}:${file}`]);
}
const match = html.toString('utf8').match(/<script[^>]*id="nailmate-data"[^>]*>([\s\S]*?)<\/script>/);
if (!match) throw new Error('固定历史版本缺少模拟快照。');
const snapshot = JSON.parse(match[1]);
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
