'use strict';
const {
    createHash,
    createDecipheriv,
    timingSafeEqual,
} = require('node:crypto');
function xmlField(xml, name) {
    const value =
        xml
            .match(new RegExp('<' + name + '>([\\s\\S]*?)</' + name + '>'))?.[1]
            ?.trim() || '';
    return value.startsWith('<![CDATA[') && value.endsWith(']]>')
        ? value.slice(9, -3)
        : value
              .replaceAll('&amp;', '&')
              .replaceAll('&lt;', '<')
              .replaceAll('&gt;', '>');
}
function decryptCallback(
    { signature, timestamp, nonce, encrypted },
    { token, key, corpId },
) {
    const reject = () => {
        throw Object.assign(new Error('企业微信回调校验失败。'), {
            apiStatus: 403,
        });
    };
    if (
        !token ||
        !key ||
        !corpId ||
        typeof encrypted !== 'string' ||
        typeof signature !== 'string' ||
        !/^[a-f0-9]{40}$/i.test(signature || '') ||
        typeof timestamp !== 'string' ||
        !/^[0-9]{1,16}$/.test(timestamp || '') ||
        typeof nonce !== 'string'
    )
        reject();
    const expected = createHash('sha1')
        .update([token, timestamp, nonce, encrypted].sort().join(''))
        .digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) reject();
    try {
        const aes = Buffer.from(key + '=', 'base64');
        if (aes.length !== 32) reject();
        const decipher = createDecipheriv(
            'aes-256-cbc',
            aes,
            aes.subarray(0, 16),
        );
        decipher.setAutoPadding(false);
        let plain = Buffer.concat([
            decipher.update(Buffer.from(encrypted, 'base64')),
            decipher.final(),
        ]);
        const pad = plain.at(-1);
        if (
            !pad ||
            pad > 32 ||
            !plain.subarray(-pad).every((byte) => byte === pad)
        )
            reject();
        plain = plain.subarray(0, -pad);
        if (plain.length < 20) reject();
        const length = plain.readUInt32BE(16);
        if (
            length > plain.length - 20 ||
            plain.subarray(20 + length).toString('utf8') !== corpId
        )
            reject();
        return plain.subarray(20, 20 + length).toString('utf8');
    } catch {
        reject();
    }
}
module.exports = { xmlField, decryptCallback };
