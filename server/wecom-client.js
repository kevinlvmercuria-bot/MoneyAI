'use strict';
class WecomError extends Error {
    constructor(message, { code, uncertain = false } = {}) {
        super(message);
        this.apiStatus = 502;
        this.code = code;
        this.uncertain = uncertain;
    }
}
function createWecomClient({
    corpId = process.env.WECOM_CORP_ID,
    secret = process.env.WECOM_CONTACT_SECRET,
    fetchImpl = fetch,
    now = Date.now,
} = {}) {
    let token,
        expires = 0,
        tokenRequest;
    const configured = Boolean(corpId && secret);
    async function json(url, options) {
        let response, result;
        try {
            response = await fetchImpl(url, {
                ...options,
                signal: AbortSignal.timeout(15000),
            });
            if (!response.ok) throw new Error('upstream http');
            result = await response.json();
        } catch {
            throw new WecomError(
                '企业微信响应未能确认，请查询发送记录后再操作。',
                { uncertain: true },
            );
        }
        if (result.errcode) {
            let detail=String(result.errmsg||'').replace(/[\r\n]/g,' ');
            for(const sensitive of [secret,token].filter(value=>typeof value==='string'&&value.length>=6)) {
                detail=detail.split(sensitive).join('[已隐藏]').split(encodeURIComponent(sensitive)).join('[已隐藏]');
            }
            detail=detail.replace(/(access_token|corpsecret)=[^\s&]+/gi,'$1=[已隐藏]').slice(0,300);
            throw new WecomError('企业微信接口返回错误 ' + result.errcode + (detail?'：'+detail:''), {
                code: result.errcode,
            });
        }
        return result;
    }
    async function accessToken() {
        if (!configured)
            throw Object.assign(new Error('尚未配置企业微信接口凭据。'), {
                apiStatus: 503,
            });
        if (token && expires > now()) return token;
        if (!tokenRequest)
            tokenRequest = (async () => {
                const url = new URL(
                    'https://qyapi.weixin.qq.com/cgi-bin/gettoken',
                );
                url.searchParams.set('corpid', corpId);
                url.searchParams.set('corpsecret', secret);
                const result = await json(url);
                if (!result.access_token)
                    throw new WecomError('企业微信未返回访问凭据。');
                token = result.access_token;
                expires =
                    now() +
                    Math.max(0, (result.expires_in || 7200) - 120) * 1000;
                return token;
            })().finally(() => {
                tokenRequest = null;
            });
        return tokenRequest;
    }
    async function call(
        endpoint,
        body,
        { query = {}, form, retry = true } = {},
    ) {
        const url = new URL('https://qyapi.weixin.qq.com/cgi-bin/' + endpoint);
        // Failure to obtain a token happens before a message request is made.
        let current;
        try {
            current = await accessToken();
        } catch (e) {
            e.uncertain = false;
            throw e;
        }
        url.searchParams.set('access_token', current);
        for (const [key, value] of Object.entries(query))
            url.searchParams.set(key, value);
        try {
            return await json(
                url,
                form
                    ? { method: 'POST', body: form }
                    : body === undefined
                      ? undefined
                      : {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(body),
                        },
            );
        } catch (e) {
            if (retry && [40014, 42001].includes(e.code)) {
                expires = 0;
                return call(endpoint, body, { query, form, retry: false });
            }
            throw e;
        }
    }
    async function pages(endpoint, body, key) {
        const rows = [];
        let cursor;
        const seen = new Set();
        do {
            const result = await call(endpoint, {
                ...body,
                limit: 1000,
                ...(cursor && { cursor }),
            });
            rows.push(...(result[key] || []));
            cursor = result.next_cursor;
            if (cursor && seen.has(cursor))
                throw new WecomError('企业微信分页游标重复。');
            seen.add(cursor);
        } while (cursor);
        return rows;
    }
    async function uploadImage(data, type = 'image/jpeg') {
        const form = new FormData();
        form.set('media', new Blob([data], { type }), 'product.jpg');
        const result = await call('media/upload', undefined, {
            query: { type: 'image' },
            form,
        });
        if (!result.media_id)
            throw new WecomError('图片上传没有返回素材编号。');
        return result.media_id;
    }
    async function downloadImage(mediaId) {
        const url = new URL('https://qyapi.weixin.qq.com/cgi-bin/media/get');
        url.searchParams.set('access_token', await accessToken());
        url.searchParams.set('media_id', mediaId);
        const response = await fetchImpl(url, {
            signal: AbortSignal.timeout(15000),
        });
        const type = response.headers.get('content-type')?.split(';')[0];
        if (
            !response.ok ||
            !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(
                type,
            )
        )
            throw new WecomError('图片素材已失效或不可读取。');
        const parts = [];
        let length = 0;
        for await (const chunk of response.body) {
            length += chunk.length;
            if (length > 2 * 1024 * 1024) {
                await response.body.cancel().catch(() => {});
                throw new WecomError('图片超过 2 MB。');
            }
            parts.push(Buffer.from(chunk));
        }
        return { type, data: Buffer.concat(parts) };
    }
    return {
        configured,
        verifyConnection: async () => { await accessToken(); return true; },
        call,
        pages,
        uploadImage,
        downloadImage,
        employees: async () =>
            (await call('externalcontact/get_follow_user_list')).follow_user ||
            [],
        customers: async (userid) =>
            (
                await call('externalcontact/list', undefined, {
                    query: { userid },
                })
            ).external_userid || [],
        customer: async (external_userid) =>
            call('externalcontact/get', undefined, {
                query: { external_userid },
            }),
        create: (body) => call('externalcontact/add_msg_template', body),
        results: (msgid, userid) =>
            pages(
                'externalcontact/get_groupmsg_send_result',
                { msgid, userid },
                'send_list',
            ),
        records: (start_time, end_time) =>
            pages(
                'externalcontact/get_groupmsg_list_v2',
                { chat_type: 'single', start_time, end_time, filter_type: 0 },
                'group_msg_list',
            ),
    };
}
module.exports = { createWecomClient, WecomError };
