'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const temporary = path.join(root, 'codex-artifacts/tmp');
fs.mkdirSync(temporary, { recursive: true });

test('无 Git、无 remote 的源码包可以构建、重跑，并保护已有不同数据', () => {
    const isolated = fs.mkdtempSync(path.join(temporary, 'cloud-source-'));
    fs.mkdirSync(path.join(isolated, 'scripts'));
    fs.mkdirSync(path.join(isolated, 'database/fixtures'), { recursive: true });
    fs.copyFileSync(__filename.replace('.test.js', '.js'), path.join(isolated, 'scripts/prepare-cloud-demo.js'));
    fs.copyFileSync(path.join(root, 'database/fixtures/team-demo.json.gz'), path.join(isolated, 'database/fixtures/team-demo.json.gz'));
    const run = () => spawnSync(process.execPath, [path.join(isolated, 'scripts/prepare-cloud-demo.js')], {
        cwd: isolated, encoding: 'utf8',
        env: { ...process.env, PATH: '', CLOUD_DEMO_DATA_DIR: path.join(isolated, 'data') },
    });
    assert.equal(fs.existsSync(path.join(isolated, '.git')), false);
    let result = run();
    assert.equal(result.status, 0, result.stderr);
    const output = path.join(isolated, 'data/team-data.json');
    const first = fs.readFileSync(output);
    const snapshot = JSON.parse(first);
    assert.equal(snapshot.members.length, 2800);
    assert.equal(snapshot.data_type, 'simulation');
    assert.equal(require('node:crypto').createHash('sha256').update(first).digest('hex'),
        '10296198bdfb91f9cbf5adb21a88c99e56e23de6270123e28d5c26609d4a5a02');
    result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(fs.readFileSync(output), first);
    fs.writeFileSync(output, '{"existing":"keep"}');
    result = run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /目标已有不同的数据文件/);
    assert.equal(fs.readFileSync(output, 'utf8'), '{"existing":"keep"}');
    fs.writeFileSync(path.join(isolated, 'database/fixtures/team-demo.json.gz'), 'corrupt fixture');
    result = run();
    assert.notEqual(result.status, 0);
    assert.equal(fs.readFileSync(output, 'utf8'), '{"existing":"keep"}');
});
