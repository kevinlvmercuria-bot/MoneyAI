'use strict';

const { readdirSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
let failed = false;

function checkDirectory(directory) {
    for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
        const relative = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            checkDirectory(relative);
        } else if (entry.name.endsWith('.js')) {
            // 前端按浏览器 ES 模块解析，后端继续遵守 CommonJS 契约。
            const moduleFile =
                directory.startsWith('public') && entry.name !== 'rules.js';
            const args = moduleFile
                ? ['--input-type=module', '--check']
                : ['--check', path.join(root, relative)];
            const result = spawnSync(process.execPath, args, {
                input: moduleFile ? readFileSync(path.join(root, relative)) : undefined,
                encoding: 'utf8',
            });
            if (result.status !== 0) {
                failed = true;
                console.error(relative + '\n' + (result.stderr || result.error?.message || '检查失败'));
            }
        }
    }
}

for (const directory of ['public', 'server', 'database', 'scripts']) checkDirectory(directory);
process.exitCode = failed ? 1 : 0;
if (!failed) console.log('前端模块与后端脚本语法检查通过。');
