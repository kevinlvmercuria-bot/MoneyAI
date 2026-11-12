'use strict';

// Local maintenance only. This is deliberately not exposed as a web endpoint.
const readline = require('node:readline');
const { Writable } = require('node:stream');
const { timingSafeEqual } = require('node:crypto');
const { connect, transaction } = require('../server/db');
const { saveCredentials } = require('../server/team-auth');

class Cancelled extends Error {
    constructor() { super('已取消，未修改密码。'); }
}

function createTerminalPrompter() {
    if (!process.stdin.isTTY || !process.stdout.isTTY)
        throw new Error('请双击 BAT，或在交互式终端运行；不接受通过管道传入密码。');
    let muted = false;
    let pending;
    const output = new Writable({
        write(chunk, encoding, done) {
            if (!muted) process.stdout.write(chunk, encoding);
            done();
        },
    });
    output.isTTY = true;
    output.columns = process.stdout.columns;
    const rl = readline.createInterface({
        input: process.stdin, output, terminal: true, historySize: 0,
    });
    rl.on('SIGINT', () => rl.close());
    rl.on('close', () => {
        muted = false;
        if (pending) { pending.reject(new Cancelled()); pending = null; process.stdout.write('\n'); }
    });
    return {
        ask(prompt, hidden = false) {
            return new Promise((resolve, reject) => {
                pending = { reject };
                rl.question(prompt, answer => {
                    muted = false;
                    pending = null;
                    if (hidden) process.stdout.write('\n');
                    resolve(answer);
                });
                muted = hidden;
            });
        },
        close() { rl.close(); },
    };
}

function checkPassword(password, confirmation) {
    if (typeof password !== 'string' || password.length < 10 || password.length > 128)
        throw new Error('密码须为 10–128 个字符。');
    if (password !== confirmation) throw new Error('两次输入的密码不一致，请重新输入。');
}

async function resetPassword(pool, { username, password, expectedSalt }) {
    checkPassword(password, password);
    if (typeof username !== 'string' || !username.trim()) throw new Error('请输入已有的工作台账号。');
    return transaction(pool, async tx => {
        const { rows } = await tx.query(`
            SELECT username,employee,salt FROM teamcredentials
            WHERE lower(username)=lower($1) FOR UPDATE`, [username.trim()]);
        const account = rows[0];
        if (!account) throw new Error('账号不存在；重置工具不会创建新账号。');
        const salt = Buffer.from(account.salt);
        if (!Buffer.isBuffer(expectedSalt) || expectedSalt.length !== salt.length || !timingSafeEqual(expectedSalt, salt))
            throw new Error('账号凭据已变化，请重新运行工具核对。');
        await saveCredentials(tx, account.employee, { username: account.username, password });
        // Preserve the exact stored name even for an older mixed-case account.
        await tx.query('UPDATE teamcredentials SET username=$2 WHERE employee=$1', [account.employee, account.username]);
        return { username: account.username, employee: account.employee };
    });
}

async function run({ connectDatabase = connect, createPrompter = createTerminalPrompter, out = console.log } = {}) {
    let pool, terminal;
    try {
        terminal = createPrompter();
        pool = await connectDatabase();
        // Display the actual connected database, never the credential-bearing URL.
        const target = (await pool.query('SELECT current_database() AS database,host(inet_server_addr()) AS host,inet_server_port() AS port')).rows[0];
        out(`\nNailMate 工作台密码重置\n数据库：${target.host}:${target.port}/${target.database}`);
        const { rows: accounts } = await pool.query("SELECT username,employee,salt FROM teamcredentials ORDER BY (employee='') DESC,username");
        if (!accounts.length) throw new Error('当前数据库没有工作台账号，请检查连接目标。');
        out('已有工作台账号：');
        for (const account of accounts) out(`  ${account.username} · ${account.employee ? '员工：' + account.employee : '老板娘'}`);
        const defaultUsername = accounts.find(account => account.employee === '')?.username || '';
        const input = await terminal.ask(`要重置的账号${defaultUsername ? '（回车选择 ' + defaultUsername + '）' : ''}：`);
        const username = input.trim() || defaultUsername;
        const account = accounts.find(item => item.username.toLowerCase() === username.toLowerCase());
        if (!account) throw new Error('账号不存在；未修改任何记录。');
        out(`将重置：${account.username}（${account.employee || '老板娘'}）。新密码输入不会显示，Ctrl+C 可取消。`);
        let password;
        for (;;) {
            password = await terminal.ask('新密码（10–128 字符）：', true);
            const confirmation = await terminal.ask('再次输入新密码：', true);
            try { checkPassword(password, confirmation); break; }
            catch (error) { out(error.message); password = ''; }
        }
        const confirmation = await terminal.ask('输入 RESET 确认重置；其他输入取消：');
        if (confirmation !== 'RESET') throw new Cancelled();
        const result = await resetPassword(pool, { username: account.username, password, expectedSalt: Buffer.from(account.salt) });
        password = '';
        out(`账号 ${result.username} 的密码已重置。请使用新密码登录，旧会话将失效，无须重启网站。`);
        out('会员、任务、反馈及其他账号未修改。');
        return result;
    } finally {
        terminal?.close();
        await pool?.end();
    }
}

if (require.main === module) {
    if (process.argv.length !== 2) {
        console.error('此工具不接受命令行密码，请通过交互界面输入。');
        process.exitCode = 1;
    } else run().catch(error => {
        if (error instanceof Cancelled) console.log(error.message);
        else {
            // Do not print database errors or connection strings with credentials.
            console.error(error.code && !error.apiStatus
                ? '操作失败：请检查 .env 的 DATABASE_URL、数据库权限和连接状态。'
                : error.message);
            process.exitCode = 1;
        }
    });
}

module.exports = { resetPassword, run, checkPassword, Cancelled };
