function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}

function getFSBase(env) {
    return `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
}

function fsString(value = '') {
    return { stringValue: String(value) };
}

function fsTimestampISO(value) {
    const iso = value || new Date().toISOString();
    return { timestampValue: iso };
}

function sanitizeDocIdSegment(value = '') {
    return String(value || '')
        .trim()
        .replace(/[^A-Za-z0-9_-]/g, '');
}

function normalizeGroupId(value) {
    const groupId = String(value || '').trim();
    if (!groupId || !groupId.startsWith('C')) {
        return '';
    }
    return groupId;
}

function normalizeOutgoingText(value) {
    const text = String(value || '').trim();
    if (!text) {
        return '';
    }
    return text.slice(0, 2000);
}

function normalizeReplyMessageId(value) {
    const lineMessageId = String(value || '').trim();
    if (!lineMessageId) {
        return '';
    }
    return lineMessageId.slice(0, 128);
}

function normalizeReplyPreviewText(value) {
    const text = String(value || '').trim();
    if (!text) {
        return '';
    }
    return text.slice(0, 320);
}

function readFirestoreStringField(fields, key) {
    return String(fields?.[key]?.stringValue || '').trim();
}

async function readReplyTargetMetadata(projectId, lineMessageId, env) {
    const normalizedProjectId = String(projectId || '').trim();
    const normalizedLineMessageId = String(lineMessageId || '').trim();
    if (!normalizedProjectId || !normalizedLineMessageId) {
        return {
            quoteToken: '',
            previewText: ''
        };
    }

    if (!env?.FIREBASE_PROJECT_ID || !env?.FIREBASE_API_KEY) {
        return {
            quoteToken: '',
            previewText: ''
        };
    }

    const stableMessageId = sanitizeDocIdSegment(normalizedLineMessageId);
    if (!stableMessageId) {
        return {
            quoteToken: '',
            previewText: ''
        };
    }

    const messageDocId = `msg_line_${stableMessageId.slice(0, 96)}`;
    const FS_BASE = getFSBase(env);
    const url = `${FS_BASE}/projects/${normalizedProjectId}/messages/${messageDocId}?key=${env.FIREBASE_API_KEY}`;

    try {
        const res = await fetch(url);
        if (!res.ok) {
            return {
                quoteToken: '',
                previewText: ''
            };
        }

        const doc = await res.json().catch(() => ({}));
        const fields = doc?.fields || {};
        const previewText =
            readFirestoreStringField(fields, 'previewText') ||
            readFirestoreStringField(fields, 'text');

        return {
            quoteToken: readFirestoreStringField(fields, 'quoteToken'),
            previewText
        };
    } catch {
        return {
            quoteToken: '',
            previewText: ''
        };
    }
}

async function pushLineText(groupId, text, lineToken, quoteToken = '') {
    const message = { type: 'text', text };
    const normalizedQuoteToken = String(quoteToken || '').trim();
    if (normalizedQuoteToken) {
        message.quoteToken = normalizedQuoteToken;
    }

    try {
        const res = await fetch('https://api.line.me/v2/bot/message/push', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${lineToken}`
            },
            body: JSON.stringify({
                to: groupId,
                messages: [message]
            })
        });

        if (res.ok) {
            return { ok: true, status: res.status, detail: '' };
        }

        const detail = await res.text();
        return { ok: false, status: res.status, detail: detail || `LINE returned ${res.status}` };
    } catch (err) {
        return {
            ok: false,
            status: 0,
            detail: err?.message || String(err)
        };
    }
}

async function persistBotMessage(projectId, text, env, options = {}) {
    if (!env?.FIREBASE_PROJECT_ID || !env?.FIREBASE_API_KEY) {
        return false;
    }

    const quotedMessageId = normalizeReplyMessageId(options?.replyToLineMessageId);
    const quotedPreviewText = normalizeReplyPreviewText(options?.replyPreviewText);

    const rand = Math.random().toString(36).slice(2, 7);
    const messageId = `msg_${Date.now()}_bot_${rand}`;
    const FS_BASE = getFSBase(env);

    const res = await fetch(`${FS_BASE}/projects/${projectId}/messages/${messageId}?key=${env.FIREBASE_API_KEY}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            fields: {
                id: fsString(messageId),
                projectId: fsString(projectId),
                lineUserId: fsString('__bot__'),
                senderRole: fsString('bot'),
                text: fsString(text),
                previewText: fsString(text),
                type: fsString('text'),
                lineMessageId: fsString(''),
                quotedMessageId: fsString(quotedMessageId),
                quotedPreviewText: fsString(quotedPreviewText),
                hasAttachment: { booleanValue: false },
                createdAt: fsTimestampISO()
            }
        })
    });

    return res.ok;
}

export async function onRequest({ request, env }) {
    if (request.method !== 'POST') {
        return jsonResponse({ error: 'Method Not Allowed' }, 405);
    }

    if (!env?.LINE_TOKEN) {
        return jsonResponse({ error: 'Missing LINE_TOKEN' }, 500);
    }

    let payload = {};
    try {
        payload = await request.json();
    } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const groupId = normalizeGroupId(payload?.groupId);
    const text = normalizeOutgoingText(payload?.text);
    const replyToLineMessageId = normalizeReplyMessageId(payload?.replyToLineMessageId);
    const requestedReplyPreviewText = normalizeReplyPreviewText(payload?.replyPreviewText);

    if (!groupId) {
        return jsonResponse({ error: 'Missing or invalid groupId' }, 400);
    }

    if (!text) {
        return jsonResponse({ error: 'Missing text' }, 400);
    }

    let replyMetadata = {
        quoteToken: '',
        previewText: ''
    };

    if (replyToLineMessageId) {
        replyMetadata = await readReplyTargetMetadata(groupId, replyToLineMessageId, env);
    }

    let lineResult = await pushLineText(groupId, text, env.LINE_TOKEN, replyMetadata.quoteToken);
    let quoteFallbackUsed = false;
    if (!lineResult.ok && replyMetadata.quoteToken) {
        quoteFallbackUsed = true;
        lineResult = await pushLineText(groupId, text, env.LINE_TOKEN, '');
    }

    if (!lineResult.ok) {
        return jsonResponse({
            error: 'LINE_PUSH_FAILED',
            detail: lineResult.detail
        }, 502);
    }

    const persisted = await persistBotMessage(groupId, text, env, {
        replyToLineMessageId,
        replyPreviewText: replyMetadata.previewText || requestedReplyPreviewText
    }).catch(() => false);

    return jsonResponse({
        success: true,
        persisted,
        reply: {
            linked: Boolean(replyToLineMessageId),
            quoteLinked: Boolean(replyMetadata.quoteToken) && !quoteFallbackUsed,
            quoteFallbackUsed,
            quotedMessageId: replyToLineMessageId,
            quotedPreviewText: replyMetadata.previewText || requestedReplyPreviewText
        }
    }, 200);
}
