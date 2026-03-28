// ✅ LINE webhook signature verification

import { arrayBufferToBase64 } from './firestore.js';

function timingSafeStringEqual(left = '', right = '') {
    const a = String(left || '');
    const b = String(right || '');
    if (a.length !== b.length) {
        return false;
    }

    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }

    return diff === 0;
}

async function verifyLineWebhookSignature(rawBody = '', signature = '', channelSecret = '') {
    const normalizedSecret = String(channelSecret || '').trim();
    if (!normalizedSecret) {
        return { ok: true, skipped: true, reason: 'missing-channel-secret' };
    }

    const normalizedSignature = String(signature || '').trim();
    if (!normalizedSignature) {
        return { ok: false, skipped: false, reason: 'missing-signature' };
    }

    try {
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
            'raw',
            encoder.encode(normalizedSecret),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );

        const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(String(rawBody || '')));
        const expectedSignature = arrayBufferToBase64(digest);
        const ok = timingSafeStringEqual(expectedSignature, normalizedSignature);

        return { ok, skipped: false, reason: ok ? '' : 'signature-mismatch' };
    } catch (err) {
        return {
            ok: false,
            skipped: false,
            reason: `signature-verify-error:${err?.message || String(err)}`
        };
    }
}

export { timingSafeStringEqual, verifyLineWebhookSignature };
