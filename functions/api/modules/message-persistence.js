// ✅ Message persistence — buildMessagePreviewText, buildMessageViewUrl, resolveQuotedMessagePreviewText,
// resolveNonGroupMessageStorage, saveNonGroupMessage, saveGroupMessage, saveBotGroupMessage

import { fsString, fsTimestampISO, fsGetDoc, getFSBase } from './firestore.js';
import { readFirestoreStringField } from './firestore.js';
import { normalizeNonNegativeInteger } from './data-normalizer.js';
import { extractQuotedMessageId, sanitizeDocIdSegment } from './message-parser.js';
// Inline sleep to avoid circular import with line-api.js
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
import { rememberGroupMember } from './known-groups.js';

function buildMessagePreviewText(messageType, message = {}, text = '') {
    if (messageType === 'text') {
        return text || '';
    }

    if (messageType === 'image') {
        return '[รูปภาพ]';
    }

    if (messageType === 'video') {
        return '[วิดีโอ]';
    }

    if (messageType === 'audio') {
        return '[เสียง]';
    }

    if (messageType === 'file') {
        const fileName = String(message?.fileName || '').trim();
        return fileName ? `[ไฟล์] ${fileName}` : '[ไฟล์แนบ]';
    }

    if (messageType === 'sticker') {
        return '[สติกเกอร์]';
    }

    if (messageType === 'location') {
        const title = String(message?.title || '').trim();
        const address = String(message?.address || '').trim();
        const place = title || address;
        return place ? `[ตำแหน่ง] ${place}` : '[ตำแหน่ง]';
    }

    return `[${messageType || 'message'}]`;
}

function buildMessageViewUrl(message = {}) {
    const externalContentUrl = String(message?.contentProvider?.originalContentUrl || '').trim();
    if (externalContentUrl) {
        return externalContentUrl;
    }

    const lineMessageId = String(message?.id || '').trim();
    if (!lineMessageId) {
        return '';
    }

    const params = new URLSearchParams({ messageId: lineMessageId });
    const fileName = String(message?.fileName || '').trim();
    if (fileName) {
        params.set('fileName', fileName);
    }

    return `/api/line-message-content?${params.toString()}`;
}

async function resolveQuotedMessagePreviewText(projectId, quotedMessageId, env) {
    const normalizedProjectId = String(projectId || '').trim();
    const normalizedQuotedMessageId = String(quotedMessageId || '').trim();
    if (!normalizedProjectId || !normalizedQuotedMessageId) {
        return '';
    }

    if (!env?.FIREBASE_PROJECT_ID || !env?.FIREBASE_API_KEY) {
        return '';
    }

    const stableQuotedId = sanitizeDocIdSegment(normalizedQuotedMessageId);
    if (!stableQuotedId) {
        return '';
    }

    const quotedDocId = `msg_line_${stableQuotedId.slice(0, 96)}`;
    const url = `${getFSBase(env)}/projects/${normalizedProjectId}/messages/${quotedDocId}?key=${env.FIREBASE_API_KEY}`;

    try {
        const res = await fetch(url);
        if (!res.ok) {
            return '';
        }

        const data = await res.json().catch(() => ({}));
        const fields = data?.fields || {};
        const previewText = readFirestoreStringField(fields, 'previewText');
        if (previewText) {
            return previewText;
        }

        const text = readFirestoreStringField(fields, 'text');
        if (text) {
            return text;
        }

        const messageType = readFirestoreStringField(fields, 'type');
        return messageType ? `[${messageType}]` : '';
    } catch {
        return '';
    }
}

function resolveNonGroupMessageStorage(sourceType, roomId, lineUserId) {
    const normalizedSourceType = String(sourceType || '').trim().toLowerCase();
    const normalizedRoomId = String(roomId || '').trim();
    const normalizedLineUserId = String(lineUserId || '').trim();

    if (normalizedSourceType === 'room' && normalizedRoomId) {
        const syntheticProjectId = `room_${normalizedRoomId}`;
        return {
            scopeType: 'room',
            scopeId: normalizedRoomId,
            syntheticProjectId,
            pathPrefix: `projects/${syntheticProjectId}/messages`
        };
    }

    if (normalizedSourceType === 'user') {
        const userScopeId = normalizedLineUserId || '__unknown_user__';
        const syntheticProjectId = `dm_${userScopeId}`;
        return {
            scopeType: 'user',
            scopeId: userScopeId,
            syntheticProjectId,
            pathPrefix: `projects/${syntheticProjectId}/messages`
        };
    }

    return null;
}

async function saveNonGroupMessage(sourceType, roomId, lineUserId, event, env) {
    const message = event?.message;
    if (!message?.type) {
        return false;
    }

    const storage = resolveNonGroupMessageStorage(sourceType, roomId, lineUserId);
    if (!storage) {
        return false;
    }

    const messageType = String(message.type || '').trim().toLowerCase() || 'text';
    const text = messageType === 'text' ? String(message.text || '').trim() : '';
    const lineMessageId = String(message.id || '').trim();
    const FS_BASE = getFSBase(env);
    const suffixSource = String(lineUserId || storage.scopeId || lineMessageId || 'none');
    const suffix = suffixSource.slice(-8);
    const rand = Math.random().toString(36).slice(2, 7);
    const messageId = `msg_${Date.now()}_${suffix}_${rand}`;

    const createdAtRaw = Number(event?.timestamp);
    const createdAtIso = Number.isFinite(createdAtRaw) && createdAtRaw > 0
        ? new Date(createdAtRaw).toISOString()
        : new Date().toISOString();

    const fileName = String(message.fileName || '').trim();
    const fileSize = normalizeNonNegativeInteger(message.fileSize);
    const duration = normalizeNonNegativeInteger(message.duration);
    const packageId = String(message.packageId || '').trim();
    const stickerId = String(message.stickerId || '').trim();
    const title = String(message.title || '').trim();
    const address = String(message.address || '').trim();
    const latitude = Number(message.latitude);
    const longitude = Number(message.longitude);
    const contentProviderType = String(message?.contentProvider?.type || '').trim();
    const externalContentUrl = String(message?.contentProvider?.originalContentUrl || '').trim();
    const previewImageUrl = String(message?.contentProvider?.previewImageUrl || message.previewImageUrl || '').trim();
    const viewUrl = buildMessageViewUrl(message);
    const previewText = buildMessagePreviewText(messageType, message, text);
    const hasAttachment = ['image', 'video', 'audio', 'file'].includes(messageType);

    const fields = {
        id: fsString(messageId),
        projectId: fsString(storage.syntheticProjectId),
        scopeType: fsString(storage.scopeType),
        scopeId: fsString(storage.scopeId),
        lineUserId: fsString(lineUserId || ''),
        senderRole: fsString('user'),
        text: fsString(text),
        previewText: fsString(previewText),
        type: fsString(messageType),
        lineMessageId: fsString(lineMessageId),
        fileName: fsString(fileName),
        packageId: fsString(packageId),
        stickerId: fsString(stickerId),
        locationTitle: fsString(title),
        locationAddress: fsString(address),
        contentProviderType: fsString(contentProviderType),
        externalContentUrl: fsString(externalContentUrl),
        previewImageUrl: fsString(previewImageUrl),
        viewUrl: fsString(viewUrl),
        hasAttachment: { booleanValue: hasAttachment },
        createdAt: { timestampValue: createdAtIso }
    };

    if (fileSize !== null) {
        fields.fileSize = { integerValue: String(fileSize) };
    }

    if (duration !== null) {
        fields.duration = { integerValue: String(duration) };
    }

    if (Number.isFinite(latitude)) {
        fields.latitude = { doubleValue: latitude };
    }

    if (Number.isFinite(longitude)) {
        fields.longitude = { doubleValue: longitude };
    }

    if (storage.scopeType === 'room') {
        fields.roomId = fsString(storage.scopeId);
    }

    if (storage.scopeType === 'user') {
        fields.chatUserId = fsString(storage.scopeId);
    }

    const res = await fetch(`${FS_BASE}/${storage.pathPrefix}/${messageId}?key=${env.FIREBASE_API_KEY}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields })
    });

    if (!res.ok) {
        const errText = await res.text();
        console.error(`Save non-group message failed (${storage.scopeType}:${storage.scopeId}):`, res.status, errText);
        return false;
    }

    return true;
}

async function saveGroupMessage(projectId, lineUserId, event, env) {
    const message = event?.message;
    if (!projectId || !message?.type) {
        return false;
    }

    const messageType = String(message.type || '').trim().toLowerCase() || 'text';
    const text = messageType === 'text' ? String(message.text || '').trim() : '';
    const lineMessageId = String(message.id || '').trim();
    const quotedMessageId = extractQuotedMessageId(message);
    const quoteToken = String(message.quoteToken || '').trim();
    const FS_BASE = getFSBase(env);
    const suffix = (lineUserId || lineMessageId || 'none').slice(-6);
    const rand = Math.random().toString(36).slice(2, 7);
    const stableLineDocId = sanitizeDocIdSegment(lineMessageId);
    const messageId = stableLineDocId
        ? `msg_line_${stableLineDocId.slice(0, 96)}`
        : `msg_${Date.now()}_${suffix}_${rand}`;

    if (lineUserId) {
        await rememberGroupMember(projectId, lineUserId, env);
    }

    const createdAtRaw = Number(event?.timestamp);
    const createdAtIso = Number.isFinite(createdAtRaw) && createdAtRaw > 0
        ? new Date(createdAtRaw).toISOString()
        : new Date().toISOString();

    const fileName = String(message.fileName || '').trim();
    const fileSize = normalizeNonNegativeInteger(message.fileSize);
    const duration = normalizeNonNegativeInteger(message.duration);
    const packageId = String(message.packageId || '').trim();
    const stickerId = String(message.stickerId || '').trim();
    const title = String(message.title || '').trim();
    const address = String(message.address || '').trim();
    const latitude = Number(message.latitude);
    const longitude = Number(message.longitude);
    const contentProviderType = String(message?.contentProvider?.type || '').trim();
    const externalContentUrl = String(message?.contentProvider?.originalContentUrl || '').trim();
    const previewImageUrl = String(message?.contentProvider?.previewImageUrl || message.previewImageUrl || '').trim();
    const viewUrl = buildMessageViewUrl(message);
    const previewText = buildMessagePreviewText(messageType, message, text);
    const quotedPreviewText = quotedMessageId
        ? await resolveQuotedMessagePreviewText(projectId, quotedMessageId, env)
        : '';
    const hasAttachment = ['image', 'video', 'audio', 'file'].includes(messageType);

    // Lookup saved display name from groupUsers doc (single cheap read, already cached from prior messages)
    let senderName = '';
    if (lineUserId) {
        const groupUserDoc = await fsGetDoc('groupUsers', lineUserId, env).catch(() => null);
        if (groupUserDoc) {
            senderName = readFirestoreStringField(groupUserDoc, 'displayName')
                || readFirestoreStringField(groupUserDoc, 'name')
                || '';
        }
    }

    const fields = {
        id: fsString(messageId),
        projectId: fsString(projectId),
        lineUserId: fsString(lineUserId || ''),
        senderName: fsString(senderName),
        senderRole: fsString('user'),
        text: fsString(text),
        previewText: fsString(previewText),
        type: fsString(messageType),
        lineMessageId: fsString(lineMessageId),
        quotedMessageId: fsString(quotedMessageId),
        quotedPreviewText: fsString(quotedPreviewText),
        quoteToken: fsString(quoteToken),
        fileName: fsString(fileName),
        packageId: fsString(packageId),
        stickerId: fsString(stickerId),
        locationTitle: fsString(title),
        locationAddress: fsString(address),
        contentProviderType: fsString(contentProviderType),
        externalContentUrl: fsString(externalContentUrl),
        previewImageUrl: fsString(previewImageUrl),
        viewUrl: fsString(viewUrl),
        hasAttachment: { booleanValue: hasAttachment },
        createdAt: { timestampValue: createdAtIso }
    };

    if (fileSize !== null) {
        fields.fileSize = { integerValue: String(fileSize) };
    }

    if (duration !== null) {
        fields.duration = { integerValue: String(duration) };
    }

    if (Number.isFinite(latitude)) {
        fields.latitude = { doubleValue: latitude };
    }

    if (Number.isFinite(longitude)) {
        fields.longitude = { doubleValue: longitude };
    }

    const url = `${FS_BASE}/projects/${projectId}/messages/${messageId}?key=${env.FIREBASE_API_KEY}`;
    let lastStatus = null;
    let lastErrorText = '';

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const res = await fetch(url, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fields
                })
            });

            if (res.ok) {
                return true;
            }

            lastStatus = res.status;
            lastErrorText = await res.text();
        } catch (err) {
            lastErrorText = err?.message || String(err);
        }

        await sleep(120 * (attempt + 1));
    }

    console.error(
        `Save group message failed (${projectId}/${messageId}):`,
        lastStatus || 'fetch-error',
        lastErrorText
    );
    return false;
}

async function saveBotGroupMessage(projectId, text, env) {
    const normalizedProjectId = String(projectId || '').trim();
    const normalizedText = String(text || '').trim();

    if (!normalizedProjectId || !normalizedText) {
        return;
    }

    const FS_BASE = getFSBase(env);
    const rand = Math.random().toString(36).slice(2, 7);
    const messageId = `msg_${Date.now()}_bot_${rand}`;

    await fetch(`${FS_BASE}/projects/${normalizedProjectId}/messages/${messageId}?key=${env.FIREBASE_API_KEY}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            fields: {
                id: fsString(messageId),
                projectId: fsString(normalizedProjectId),
                lineUserId: fsString('__bot__'),
                senderRole: fsString('bot'),
                text: fsString(normalizedText),
                previewText: fsString(normalizedText),
                type: fsString('text'),
                lineMessageId: fsString(''),
                hasAttachment: { booleanValue: false },
                createdAt: fsTimestampISO()
            }
        })
    });
}

export {
    buildMessagePreviewText,
    buildMessageViewUrl,
    resolveQuotedMessagePreviewText,
    resolveNonGroupMessageStorage,
    saveNonGroupMessage,
    saveGroupMessage,
    saveBotGroupMessage
};
