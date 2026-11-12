'use strict';
const {
    randomBytes,
    createCipheriv,
    createDecipheriv,
    createHash,
} = require('node:crypto');
const fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os');
const { spawnSync } = require('node:child_process');
const { transaction } = require('./db');
const { createWecomClient } = require('./wecom-client');
const fail = (ok, message, status = 400) => {
    if (!ok) throw Object.assign(new Error(message), { apiStatus: status });
};
const errorReasons = {
    40013: '企业 ID 不正确',
    40001: '密钥无效或与企业 ID 不匹配',
    40014: '访问凭据无效',
    42001: '访问凭据过期',
    48001: '应用没有对应接口权限',
    48002: '应用没有对应接口权限',
    60020: '服务端出口 IP 不在企业可信 IP 范围',
    40164: '服务端出口 IP 未加入白名单',
    60111: '所选员工标识无效',
};
function diagnosis(error) {
    const reason=errorReasons[error.code];
    return reason ? reason+(error.message?'；'+error.message:'') : error.message || '接口检测未完成';
}
function localKey(create) {
    if (process.env.WECOM_SETTINGS_KEY) {
        const key = Buffer.from(process.env.WECOM_SETTINGS_KEY, 'base64');
        fail(
            key.length === 32,
            'WECOM_SETTINGS_KEY 必须是 32 字节密钥的 Base64。',
            503,
        );
        return key;
    }
    const directory =
        process.env.WECOM_SETTINGS_DIR ||
        path.join(
            process.env.LOCALAPPDATA || path.join(os.homedir(), '.local/share'),
            'NailMate/private',
        );
    const file = path.join(directory, 'wecom-settings.key');
    if (!fs.existsSync(file)) {
        fail(create, '企微配置的解密密钥不存在，请恢复服务器密钥备份。', 503);
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        if (process.platform === 'win32') {
            const identity = [process.env.USERDOMAIN, process.env.USERNAME]
                .filter(Boolean)
                .join('\\');
            const result = spawnSync(
                'icacls.exe',
                [
                    directory,
                    '/inheritance:r',
                    '/grant:r',
                    identity + ':(OI)(CI)F',
                    '*S-1-5-18:(OI)(CI)F',
                ],
                { windowsHide: true, stdio: 'ignore' },
            );
            fail(
                result.status === 0,
                '无法限制本机密钥目录的访问权限，配置未保存。',
                503,
            );
        }
        try {
            fs.writeFileSync(file, randomBytes(32), {
                flag: 'wx',
                mode: 0o600,
            });
        } catch (e) {
            if (e.code !== 'EEXIST') throw e;
        }
    }
    const key = fs.readFileSync(file);
    fail(key.length === 32, '本机企微配置密钥损坏。', 503);
    return key;
}
function createWecomSettings(
    pool,
    {
        clientFactory = createWecomClient,
        keyProvider = localKey,
        contactClient,
        kfClient,
    } = {},
) {
    let config = {
        corpId: process.env.WECOM_CORP_ID || '',
        contactSecret: process.env.WECOM_CONTACT_SECRET || '',
        kfSecret: process.env.WECOM_KF_SECRET || '',
        callbackToken: process.env.WECOM_CALLBACK_TOKEN || '',
        callbackKey: process.env.WECOM_CALLBACK_AES_KEY || '',
    };
    let contact,
        kf,
        lastCheck = null,
        loadError = null,
        ready;
    function apply() {
        contact =
            contactClient ||
            clientFactory({
                corpId: config.corpId,
                secret: config.contactSecret,
            });
        kf =
            kfClient ||
            clientFactory({ corpId: config.corpId, secret: config.kfSecret });
    }
    const fingerprint = () =>
        createHash('sha256').update(JSON.stringify(config)).digest('hex');
    function encrypt(value) {
        const iv = randomBytes(12),
            cipher = createCipheriv('aes-256-gcm', keyProvider(true), iv);
        cipher.setAAD(Buffer.from('NailMate WeCom v1'));
        const data = Buffer.concat([
            cipher.update(JSON.stringify(value), 'utf8'),
            cipher.final(),
        ]);
        return {
            iv: iv.toString('base64'),
            tag: cipher.getAuthTag().toString('base64'),
            data: data.toString('base64'),
        };
    }
    function decrypt(blob) {
        try {
            const v = typeof blob === 'string' ? JSON.parse(blob) : blob,
                decipher = createDecipheriv(
                    'aes-256-gcm',
                    keyProvider(false),
                    Buffer.from(v.iv, 'base64'),
                );
            decipher.setAAD(Buffer.from('NailMate WeCom v1'));
            decipher.setAuthTag(Buffer.from(v.tag, 'base64'));
            return JSON.parse(
                Buffer.concat([
                    decipher.update(Buffer.from(v.data, 'base64')),
                    decipher.final(),
                ]).toString('utf8'),
            );
        } catch {
            throw Object.assign(
                new Error('已保存的企微配置无法解密，请恢复服务器密钥备份。'),
                { apiStatus: 503 },
            );
        }
    }
    apply();
    async function load() {
        const row = (
            await pool.query(
                'SELECT encrypted,last_check FROM wecomsettings WHERE id=1',
            )
        ).rows[0];
        if (row?.encrypted) config = decrypt(row.encrypted);
        lastCheck = row?.last_check ? JSON.parse(row.last_check) : null;
        apply();
    }
    function ensure() {
        if (!ready)
            ready = load().catch((error) => {
                loadError = error;
            });
        return ready.then(() => {
            if (loadError)
                throw Object.assign(
                    new Error(
                        '企微配置加载失败，请联系管理员检查迁移或密钥备份。',
                    ),
                    { apiStatus: 503 },
                );
        });
    }
    const proxy = (which) =>
        new Proxy(
            {},
            {
                get(_target, key) {
                    const target = which === 'contact' ? contact : kf;
                    const value = target[key];
                    return typeof value === 'function'
                        ? value.bind(target)
                        : value;
                },
            },
        );
    function publicSettings() {
        return {
            corpId: config.corpId,
            contactConfigured: Boolean(config.corpId && config.contactSecret),
            kfConfigured: Boolean(config.corpId && config.kfSecret),
            callbackConfigured: Boolean(
                config.callbackToken && config.callbackKey,
            ),
            lastCheck:
                lastCheck && lastCheck.fingerprint === fingerprint()
                    ? {
                          checkedAt: lastCheck.checkedAt,
                          ok: lastCheck.ok,
                          checks: lastCheck.checks,
                      }
                    : null,
        };
    }
    async function save(account, body) {
        await ensure();
        const next = { ...config };
        fail(
            typeof body.corpId === 'string' &&
                /^[a-zA-Z0-9_-]{3,100}$/.test(body.corpId.trim()),
            '请填写有效的企业 ID。',
        );
        next.corpId = body.corpId.trim();
        for (const name of [
            'contactSecret',
            'kfSecret',
            'callbackToken',
            'callbackKey',
        ])
            if (body[name]) {
                fail(
                    typeof body[name] === 'string' &&
                        body[name].trim().length <= 512,
                    '密钥格式或长度不正确。',
                );
                next[name] = body[name].trim();
            }
        fail(next.contactSecret, '请填写客户联系应用密钥。');
        if (next.callbackKey)
            fail(
                /^[A-Za-z0-9+/]{43}$/.test(next.callbackKey),
                '回调加密密钥须为平台提供的 43 位 EncodingAESKey。',
            );
        await transaction(pool, async (tx) => {
            if (config.corpId && config.corpId !== next.corpId) {
                const count = (
                    await tx.query(
                        'SELECT (SELECT COUNT(*) FROM wecomemployees)+(SELECT COUNT(*) FROM wecommembers)+(SELECT COUNT(*) FROM wecomdeliveries)+(SELECT COUNT(*) FROM kfconversations) AS n',
                    )
                ).rows[0].n;
                fail(
                    Number(count) === 0,
                    '已有企微绑定或联系历史，不能直接切换到另一企业。',
                    409,
                );
            }
            await tx.query(
                'INSERT INTO wecomsettings(id,encrypted,updated_by) VALUES(1,$1,$2) ON CONFLICT(id) DO UPDATE SET encrypted=excluded.encrypted,last_check=NULL,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP',
                [JSON.stringify(encrypt(next)), account.username],
            );
        });
        config = next;
        lastCheck = null;
        apply();
        return publicSettings();
    }
    async function check({ userid } = {}) {
        await ensure();
        const checks = [];
        async function probe(id, label, work) {
            try {
                const result = await work();
                checks.push({
                    id,
                    label,
                    status: 'passed',
                    detail: result || '通过',
                });
                return true;
            } catch (error) {
                checks.push({
                    id,
                    label,
                    status: 'failed',
                    detail: diagnosis(error),
                    code: error.code || null,
                });
                return false;
            }
        }
        const token = await probe('token', '企业 ID 与应用密钥', async () => {
            fail(contact.configured, '尚未配置企业 ID 和客户联系密钥。');
            await contact.verifyConnection();
            return '访问凭据获取成功';
        });
        if (token) {
            await probe('contact', '客户联系权限与可见员工', async () => {
                const employees = await contact.employees();
                return `可读取 ${employees.length} 名有客户联系权限的员工`;
            });
            await probe('group', '群发记录查询权限', async () => {
                const end = Math.floor(Date.now() / 1000);
                await contact.call('externalcontact/get_groupmsg_list_v2', {
                    chat_type: 'single',
                    start_time: end - 3600,
                    end_time: end,
                    limit: 1,
                    filter_type: 0,
                });
                return '群发记录查询通过；实际创建和确认发送仍需真实测试';
            });
            if (userid)
                await probe('customer', '测试员工的客户读取权限', async () => {
                    const customers = await contact.customers(userid);
                    return `可读取 ${customers.length} 名客户`;
                });
            else
                checks.push({
                    id: 'customer',
                    label: '测试员工的客户读取权限',
                    status: 'pending',
                    detail: '在真实测试向导选择员工后继续检测',
                });
        }
        if (kf.configured)
            await probe('kf', '微信客服账号权限', async () => {
                await kf.call('kf/account/list', { offset: 0, limit: 1 });
                return '客服账号读取通过；回调和实际收发仍需联调';
            });
        lastCheck = {
            fingerprint: fingerprint(),
            checkedAt: new Date().toISOString(),
            ok: token && checks.every((c) => c.status !== 'failed'),
            checks,
        };
        await pool.query(
            'INSERT INTO wecomsettings(id,last_check) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET last_check=excluded.last_check',
            [JSON.stringify(lastCheck)],
        );
        return publicSettings().lastCheck;
    }
    return {
        ensure,
        contact: proxy('contact'),
        kf: proxy('kf'),
        publicSettings,
        save,
        check,
        callback: () => ({
            token: config.callbackToken,
            key: config.callbackKey,
            corpId: config.corpId,
        }),
    };
}
module.exports = { createWecomSettings, diagnosis };
