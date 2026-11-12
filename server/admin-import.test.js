'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const ExcelJS = require('exceljs');
const { connect, transaction } = require('./db');
const { migrateTeam } = require('../database/migrations');
const { createApp } = require('./app');
const { authenticate } = require('./test-auth-client');
const { createWecomSettings } = require('./wecom-settings');
const { WecomError } = require('./wecom-client');
const { readRows, fields, template } = require('./member-import');
test('Excel/CSV 解析、模板、公式拒绝及文件大小边界', async () => {
    const csv = Buffer.from(
        '\ufeff姓名,手机号,备注\r\n王女士,13800138001,"喜欢裸色,不强推"\r\n',
    );
    assert.equal((await readRows(csv, 'csv')).rows[0][2], '喜欢裸色,不强推');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('会员');
    sheet.addRow(['姓名', '手机号']);
    sheet.addRow(['陈女士', '13800138002']);
    assert.equal(
        (await readRows(Buffer.from(await workbook.xlsx.writeBuffer()), 'xlsx'))
            .rows.length,
        1,
    );
    sheet.getCell('A2').value = { formula: '1+1', result: 2 };
    await assert.rejects(
        readRows(Buffer.from(await workbook.xlsx.writeBuffer()), 'xlsx'),
        /公式/,
    );
    await assert.rejects(
        readRows(Buffer.alloc(5 * 1024 * 1024 + 1), 'csv'),
        /5 MB/,
    );
    const exported = new ExcelJS.Workbook();
    await exported.xlsx.load(await template('xlsx'));
    assert.equal(exported.worksheets[0].getCell('A1').value, '姓名');
    assert.match((await template('csv')).toString('utf8'), /姓名,手机号/);
});
test(
    '管理员接入、权限检测、加密持久化、真实会员导入与测试向导',
    { timeout: 60000 },
    async () => {
        const master = await connect('postgres'),
            name = 'nailmate_admin_' + randomBytes(6).toString('hex');
        let pool, server;
        const key = randomBytes(32);
        let created = 0,
            sent = false,
            permissionFailure = false;
        const factory = ({ corpId, secret }) => ({
            configured: Boolean(corpId && secret),
            verifyConnection: async () => {
                if (secret !== 'valid-contact')
                    throw new WecomError('token error', { code: 40001 });
            },
            employees: async () => ['wx-test'],
            customers: async () => ['external-test'],
            customer: async () => ({
                external_contact: { name: '测试客户' },
                follow_user: [{ userid: 'wx-test' }],
            }),
            uploadImage: async () => 'media',
            call: async (endpoint) => {
                if (permissionFailure && endpoint.includes('get_groupmsg'))
                    throw new WecomError('permission', { code: 48002 });
                return {};
            },
            create: async () => {
                created++;
                return { msgid: 'platform-test' };
            },
            records: async () => [],
            results: async () =>
                sent
                    ? [
                          {
                              external_userid: 'external-test',
                              userid: 'wx-test',
                              status: 1,
                              send_time: Math.floor(
                                  Date.parse('2026-11-12T08:00:00Z') / 1000,
                              ),
                          },
                      ]
                    : [],
        });
        try {
            await master.query(`CREATE DATABASE "${name}"`);
            pool = await connect(name);
            await transaction(pool, migrateTeam);
            const app = createApp(pool, {
                legacy: false,
                teamNow: () => new Date('2026-11-12T08:00:00Z'),
                settingsOptions: {
                    clientFactory: factory,
                    keyProvider: () => key,
                },
            });
            server = app.listen(0, '127.0.0.1');
            await new Promise((resolve) => server.once('listening', resolve));
            const base = 'http://127.0.0.1:' + server.address().port;
            const owner = await authenticate(base, 'setup');
            const post = (request, route, body) =>
                request(base + route, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
            const get = async (request, route) => {
                const r = await request(base + route);
                assert.equal(r.status, 200, await r.clone().text());
                return r.json();
            };
            const state = (
                    await (
                        await post(owner, '/api/team', { action: 'bootstrap' })
                    ).json()
                ).state,
                employee = state.accounts[0].employee;
            const credentials = {
                username: 'admin-test-staff',
                password: 'admin-test-password',
            };
            assert.equal(
                (
                    await post(owner, '/api/team', {
                        action: 'employeeAccount',
                        employee,
                        ...credentials,
                    })
                ).status,
                200,
            );
            const staff = await authenticate(base, 'login', credentials);
            assert.equal(
                (
                    await post(staff, '/api/wecom/admin/settings', {
                        corpId: 'ww-test',
                        contactSecret: 'leak',
                    })
                ).status,
                403,
            );
            assert.equal(
                (await get(staff, '/api/wecom/status')).configured,
                false,
            );
            assert.equal(
                (
                    await post(owner, '/api/wecom/admin/settings', {
                        corpId: 'ww-test',
                        contactSecret: 'invalid-contact',
                    })
                ).status,
                200,
            );
            const bad = await (
                await post(owner, '/api/wecom/admin/check', {})
            ).json();
            assert.equal(bad.ok, false);
            assert.match(bad.checks[0].detail, /密钥无效/);
            await post(owner, '/api/wecom/admin/settings', {
                corpId: 'ww-test',
                contactSecret: 'valid-contact',
            });
            assert.equal(
                (await get(staff, '/api/wecom/status')).configured,
                true,
                '保存后无需重启即可生效',
            );
            const encrypted = (
                await pool.query('SELECT encrypted FROM wecomsettings')
            ).rows[0].encrypted;
            assert.ok(!encrypted.includes('valid-contact'));
            assert.ok(
                !JSON.stringify(
                    await get(owner, '/api/wecom/admin/settings'),
                ).includes('valid-contact'),
            );
            const reloaded = createWecomSettings(pool, {
                clientFactory: factory,
                keyProvider: () => key,
            });
            await reloaded.ensure();
            assert.equal(reloaded.publicSettings().contactConfigured, true);
        const unreadable=createWecomSettings(pool,{clientFactory:factory,keyProvider:()=>Buffer.alloc(32,99)});
        await assert.rejects(unreadable.ensure(),/配置加载失败/);
            permissionFailure = true;
            assert.equal(
                (await (await post(owner, '/api/wecom/admin/check', {})).json())
                    .ok,
                false,
            );
            permissionFailure = false;
            const check = await (
                await post(owner, '/api/wecom/admin/check', {
                    userid: 'wx-test',
                })
            ).json();
            assert.equal(check.ok, true);
            const csv = Buffer.from(
                '姓名,手机号,会员等级,余额,偏好款式,营销授权,备注\n真实测试甲,13800138001,金卡,88.50,裸色,是,喜欢简约\n真实测试乙,13800138002,普通会员,0,法式,,\n',
            );
            const upload = async (buffer, format = 'csv') => {
                const r = await owner(
                    base + '/api/team/import/inspect?format=' + format,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/octet-stream' },
                        body: buffer,
                    },
                );
                assert.equal(r.status, 200, await r.clone().text());
                return r.json();
            };
            const inspect = await upload(csv);
            const preview = await (
                await post(owner, '/api/team/import/preview', {
                    uploadId: inspect.uploadId,
                    mapping: inspect.mapping,
                })
            ).json();
            assert.equal(preview.errorCount, 0, JSON.stringify(preview));
            const committed = await post(owner, '/api/team/import/commit', {
                uploadId: preview.uploadId,
                revision: preview.revision,
            });
            assert.equal(committed.status, 200, await committed.clone().text());
            const result = await committed.json();
            assert.equal(result.imported, 2);
            assert.equal(
                (
                    await (
                        await post(owner, '/api/team/import/commit', {
                            uploadId: preview.uploadId,
                            revision: preview.revision,
                        })
                    ).json()
                ).reused,
                true,
            );
            const bootstrap = await (
                    await post(owner, '/api/team', { action: 'bootstrap' })
                ).json(),
                memberId = result.memberIds[0];
            assert.equal(
                bootstrap.snapshot.members.find((m) => m.member_id === memberId)
                    .data_type,
                'real',
            );
            assert.equal(
                bootstrap.snapshot.members.find(
                    (m) => m.member_id === result.memberIds[1],
                ).marketing_consent,
                false,
            );
            assert.equal(
                bootstrap.snapshot.members.find((m) => m.member_id === memberId)
                    .phone,
                '13800138001',
            );
            const again = await upload(csv),
                duplicate = await (
                    await post(owner, '/api/team/import/preview', {
                        uploadId: again.uploadId,
                        mapping: again.mapping,
                    })
                ).json();
            assert.equal(duplicate.alreadyImported.imported, 2);
        const conflicting=await upload(Buffer.from('姓名,手机号\n不应覆盖原姓名,13800138001\n'));
        const conflictPreview=await (await post(owner,'/api/team/import/preview',{uploadId:conflicting.uploadId,mapping:conflicting.mapping})).json();
        assert.ok(conflictPreview.errors.some(error=>error.issues.some(issue=>issue.includes('已存在'))));
        assert.equal((await post(owner,'/api/team/import/commit',{uploadId:conflictPreview.uploadId,revision:conflictPreview.revision})).status,409);
            const invalid = await upload(
                Buffer.from('姓名,手机号,余额\n重名测试,13800138003,-10\n'),
            );
            const invalidPreview = await (
                await post(owner, '/api/team/import/preview', {
                    uploadId: invalid.uploadId,
                    mapping: invalid.mapping,
                })
            ).json();
            assert.ok(invalidPreview.errorCount > 0);
            assert.equal(
                (
                    await post(owner, '/api/team/import/commit', {
                        uploadId: invalidPreview.uploadId,
                        revision: invalidPreview.revision,
                    })
                ).status,
                409,
            );
            assert.equal(
                (
                    await staff(base + '/api/team/import/inspect?format=csv', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/octet-stream' },
                        body: csv,
                    })
                ).status,
                403,
            );
            assert.equal(
                (
                    await post(owner, '/api/wecom/bindings/employee', {
                        employee,
                        userid: 'wx-test',
                    })
                ).status,
                200,
            );
            assert.equal(
                (
                    await post(owner, '/api/wecom/bindings/member', {
                        memberId,
                        employee,
                        externalUserid: 'external-test',
                    })
                ).status,
                200,
            );
            const message = '经客户同意的系统联调测试',
                request = {
                    employee,
                    memberId,
                    message,
                    idempotencyKey: randomUUID(),
                    confirmed: true,
                };
            assert.equal(
                (await post(owner, '/api/wecom/admin/wizard/preview', request))
                    .status,
                200,
            );
            assert.equal(
                (
                    await post(owner, '/api/wecom/admin/wizard/send', {
                        ...request,
                        confirmed: false,
                    })
                ).status,
                400,
            );
            const send = await post(
                owner,
                '/api/wecom/admin/wizard/send',
                request,
            );
            assert.equal(send.status, 202, await send.clone().text());
            const batch = await send.json();
            await app.locals.wecom.tick();
            assert.equal(created, 1);
        assert.equal((await post(owner,'/api/wecom/admin/wizard/send',{...request,message:'修改后的内容'})).status,409);
            sent = true;
            await post(owner, '/api/wecom/refresh', {});
            const records = await get(owner, '/api/wecom/records');
            assert.equal(
                records.records.find((r) => r.batch_id === batch.batchId)
                    .status,
                'sent',
            );
            assert.equal(
                (
                    await (
                        await post(
                            owner,
                            '/api/wecom/admin/wizard/send',
                            request,
                        )
                    ).json()
                ).reused,
                true,
            );
            assert.equal(created, 1);
            assert.equal(
                (await get(staff, '/api/wecom/records')).records.length,
                1,
                '测试记录对负责员工可见，管理员发起人独立保留',
            );
            assert.equal(
                (
                    await pool.query(
                        'SELECT initiated_by FROM wecombatches WHERE id=$1',
                        [batch.batchId],
                    )
                ).rows[0].initiated_by,
                'test-owner',
            );
        } finally {
            if (server) await new Promise((resolve) => server.close(resolve));
            await pool?.end();
            await master.query(`DROP DATABASE IF EXISTS "${name}" WITH(FORCE)`);
            await master.end();
        }
    },
);
