'use strict';

const express = require('express');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const { transaction } = require('./db');
const { httpConfig, checkRequest } = require('./http-config');

const hashPassword = promisify(scrypt);
const migration = readFileSync(path.join(__dirname, '../database/team-auth.sql'), 'utf8');
const SESSION_COOKIE = 'nailmate_session';
const SESSION_DURATION = 8 * 60 * 60 * 1000;
const cookieOptions = { httpOnly: true, sameSite: 'strict', path: '/' };

function requireCondition(condition, apiStatus, message) {
    if (!condition) throw Object.assign(new Error(message), { apiStatus });
}

function initializeTeamAuth(tx) {
    return tx.query(migration);
}

function publicUser(row) {
    return { username: row.username, employee: row.employee, role: row.employee ? 'employee' : 'owner' };
}

function loginName(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

async function findCredential(db, username) {
    const result = await db.query(`
        SELECT username, employee, salt, password_hash FROM TeamCredentials WHERE lower(username)=lower($1);
    `, [username]);
    return result.rows[0];
}

async function saveCredentials(tx, employee, body) {
    const username = loginName(body.username);
    requireCondition(/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username), 400, '账号须为 3–32 位字母、数字、点、下划线或连字符。');
    requireCondition(typeof body.password === 'string' && body.password.length >= 10 && body.password.length <= 128,
        400, '密码长度须为 10–128 位。');
    const duplicate = await findCredential(tx, username);
    requireCondition(!duplicate || duplicate.employee === employee, 409, '这个账号名已被使用。');
    const salt = randomBytes(16);
    const hash = await hashPassword(body.password, salt, 64);
    await tx.query(`
            INSERT INTO TeamCredentials(employee,username,salt,password_hash) VALUES($1,$2,$3,$4)
            ON CONFLICT(employee) DO UPDATE SET username=excluded.username,salt=excluded.salt,password_hash=excluded.password_hash;
        `, [employee, username, salt, hash]);
    return { employee, username, salt };
}

function registerTeamAuth(app, pool) {
    const config = httpConfig();
    const sessionCookieOptions = { ...cookieOptions, secure: Boolean(config.origin) };
    const sessions = new Map();
    const loginAttempts = new Map();
    const parseJson = express.json({ limit: '4kb' });
    const tokenFrom = req => req.get('cookie')?.match(/(?:^|;\s*)nailmate_session=([a-f0-9]{64})(?:;|$)/)?.[1];

    async function accountFor(req, db = pool) {
        const token = tokenFrom(req);
        const session = sessions.get(token);
        if (!session || session.expires <= Date.now()) {
            sessions.delete(token);
            return null;
        }
        const credential = await findCredential(db, session.username);
        if (!credential || !Buffer.from(credential.salt).equals(session.salt) || sessions.get(token) !== session) {
            sessions.delete(token);
            return null;
        }
        return publicUser(credential);
    }

    async function requireAccount(req, db) {
        const account = await accountFor(req, db);
        const viewer = req.get('x-nailmate-user');
        requireCondition(account && (!viewer || viewer === account.username), 401, '请重新登录。');
        return account;
    }

    async function hasOwner(db = pool) {
        const { rows } = await db.query("SELECT 1 AS present FROM TeamCredentials WHERE employee='';");
        return rows.length > 0;
    }

    function signIn(req, res, credential) {
        const now = Date.now();
        for (const [token, session] of sessions) if (session.expires <= now) sessions.delete(token);
        sessions.delete(tokenFrom(req));
        const token = randomBytes(32).toString('hex');
        sessions.set(token, { username: credential.username, salt: Buffer.from(credential.salt), expires: now + SESSION_DURATION });
        res.cookie(SESSION_COOKIE, token, { ...sessionCookieOptions, maxAge: SESSION_DURATION });
        res.json({ user: publicUser(credential) });
    }

    app.use((req, res, next) => {
        checkRequest(req, config);
        res.set('X-Content-Type-Options', 'nosniff');
        next();
    });

    app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    app.get('/api/team/auth/session', async (req, res) => {
        const user = await accountFor(req);
        res.json({ user, setupRequired: !user && !(await hasOwner()) });
    });

    app.post('/api/team/auth/setup', parseJson, async (req, res) => {
        requireCondition(!config.origin, 403, '公网服务请由部署环境初始化管理员账号。');
        const credential = await transaction(pool, async tx => {
            requireCondition(!(await hasOwner(tx)), 409, '老板娘账号已创建，请登录。');
            return saveCredentials(tx, '', req.body || {});
        });
        signIn(req, res, credential);
    });

    app.post('/api/team/auth/login', parseJson, async (req, res) => {
        const now = Date.now();
        const address = req.socket.remoteAddress;
        for (const [key, value] of loginAttempts) if (value.expires <= now) loginAttempts.delete(key);
        const attempt = loginAttempts.get(address) || { count: 0, expires: now + 5 * 60 * 1000 };
        requireCondition(attempt.count < 12, 429, '尝试次数过多，请稍后再试。');
        // Count attempts before awaiting hashing so parallel requests share the limit.
        attempt.count += 1;
        loginAttempts.set(address, attempt);
        const username = loginName(req.body?.username);
        const credential = username.length <= 32 ? await findCredential(pool, username) : null;
        const password = typeof req.body?.password === 'string' && req.body.password.length <= 128 ? req.body.password : '';
        const actual = await hashPassword(password, credential?.salt || Buffer.alloc(16), 64);
        requireCondition(timingSafeEqual(actual, Buffer.from(credential?.password_hash || Buffer.alloc(64))) && credential,
            401, '账号或密码不正确。');
        loginAttempts.delete(address);
        signIn(req, res, credential);
    });

    app.post('/api/team/auth/logout', async (req, res) => {
        await requireAccount(req);
        sessions.delete(tokenFrom(req));
        res.clearCookie(SESSION_COOKIE, sessionCookieOptions).status(204).end();
    });

    async function ownerOnly(req, _res, next) {
        const account = await requireAccount(req);
        requireCondition(account.role === 'owner', 403, '此功能仅向老板娘开放。');
        next();
    }

    return { requireAccount, ownerOnly };
}

module.exports = { initializeTeamAuth, registerTeamAuth, saveCredentials };
