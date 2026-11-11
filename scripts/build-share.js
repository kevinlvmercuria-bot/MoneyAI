'use strict';

// Rebuild the file:// and WeChat share edition from the maintained application.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, 'public', file), 'utf8');
let html = read('index.html').replace(' data-persistence="server"', '');
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, file) => `<style>${read(file)}</style>`);
html = html.replace(/\s*<script[^>]*src="[^"]+"[^>]*><\/script>/g, '');
html = html.replace('NailMate AI · 门店联系工作台', 'NailMate AI · 微信分享预览版');
html = html.replace('门店工作台 · 使用模拟会员数据', '单文件演示 · 使用模拟会员数据 · 正式登录请使用本地账号版');
html = html.replace('NailMate AI · 门店联系工作台 · 演示记录保存在门店数据库', 'NailMate AI · 微信分享预览版 · 演示记录保存在当前浏览器');
const safeScript = text => text.replace(/<\/script/gi, '<\\/script');
const scripts = [
    `<script id="nailmate-data" type="application/json">${safeScript(fs.readFileSync(path.join(root, 'data', 'team-data.json'), 'utf8'))}</script>`,
    `<script id="nailmate-product-images" type="application/json">${safeScript(read('team-product-images.json'))}</script>`,
    ...['communication.js', 'team-store.js', 'team-chart.js', 'team-workspace.js'].map(file => `<script>${safeScript(read(file))}</script>`),
].join('\n');
const output = path.resolve(process.argv[2] || path.join(root, 'NailMate_AI_微信分享版.html'));
fs.writeFileSync(output, html.replace('</body>', () => scripts + '\n</body>'));
console.log('已生成分享版：' + output);
