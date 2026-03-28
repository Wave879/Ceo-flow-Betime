// ✅ Chat session — trimChatHistory, readChatHistory, chat session read/write/delete, buildChatHistoryPrompt, askSoundwave

import { fsGetDoc, fsSetDoc, patchFirestoreDoc } from './firestore.js';
import { resolveChatSessionScope, parseFirestoreBooleanField } from './mode-manager.js';
import { deleteFirestoreDocumentByPath } from './known-groups.js';

function trimChatHistory(history = [], maxItems = 10) {
    if (!Array.isArray(history)) {
        return [];
    }

    const normalized = history
        .map((item) => {
            const role = String(item?.role || '').trim().toLowerCase();
            const content = String(item?.content || '').trim();
            if (!content) {
                return null;
            }

            if (role !== 'user' && role !== 'assistant') {
                return null;
            }

            return { role, content };
        })
        .filter(Boolean);

    return normalized.slice(-Math.max(1, Math.floor(Number(maxItems) || 10)));
}

function readChatHistory(session = null) {
    if (!session) {
        return [];
    }

    const raw = String(session?.historyJson || '').trim();
    if (!raw) {
        return [];
    }

    try {
        return trimChatHistory(JSON.parse(raw), 10);
    } catch {
        return [];
    }
}

async function readChatSessionState(sourceType, groupId, roomId, lineUserId, env) {
    const scope = resolveChatSessionScope(sourceType, groupId, roomId, lineUserId);
    if (!scope) {
        return null;
    }

    try {
        const fields = await fsGetDoc('chatSessions', scope.docId, env);
        if (!fields) {
            return null;
        }

        const active = parseFirestoreBooleanField(fields?.active);
        if (active === false) {
            return null;
        }

        const startedAt = String(fields?.startedAt?.timestampValue || fields?.startedAt?.stringValue || '').trim();
        const lastActiveAt = String(fields?.lastActiveAt?.timestampValue || fields?.lastActiveAt?.stringValue || '').trim();
        const historyJson = String(fields?.historyJson?.stringValue || '').trim() || '[]';

        return {
            scope,
            startedAt,
            lastActiveAt,
            historyJson,
            active: active !== false
        };
    } catch (err) {
        console.error('Read chat session failed:', err);
        return null;
    }
}

async function writeChatSessionState(scope, lineUserId, payload = {}, env = {}) {
    if (!scope?.docId) {
        return false;
    }

    const startedAt = String(payload?.startedAt || new Date().toISOString()).trim();
    const lastActiveAt = String(payload?.lastActiveAt || new Date().toISOString()).trim();
    const history = trimChatHistory(payload?.history || [], 10);
    const historyJson = String(payload?.historyJson || JSON.stringify(history));
    const active = payload?.active !== false;

    const fields = {
        active: { booleanValue: active },
        scopeType: { stringValue: String(scope.scopeType || 'user') },
        scopeId: { stringValue: String(scope.scopeId || '') },
        lineUserId: { stringValue: String(lineUserId || '') },
        startedAt: { timestampValue: startedAt },
        lastActiveAt: { timestampValue: lastActiveAt },
        historyJson: { stringValue: historyJson },
        updatedAt: { timestampValue: new Date().toISOString() }
    };

    const ok = await patchFirestoreDoc(`chatSessions/${scope.docId}`, fields, env, false);
    if (ok) {
        return true;
    }

    try {
        await fsSetDoc('chatSessions', scope.docId, {
            active,
            scopeType: String(scope.scopeType || 'user'),
            scopeId: String(scope.scopeId || ''),
            lineUserId: String(lineUserId || ''),
            startedAt,
            lastActiveAt,
            historyJson,
            updatedAt: new Date().toISOString()
        }, env);
        return true;
    } catch (err) {
        console.error('Write chat session fallback failed:', err);
        return false;
    }
}

async function deleteChatSessionState(scope, env = {}) {
    if (!scope?.docId) {
        return false;
    }

    return deleteFirestoreDocumentByPath(`chatSessions/${scope.docId}`, env);
}

function buildChatHistoryPrompt(history = [], userMessage = '') {
    const latestMessage = String(userMessage || '').trim();
    if (!latestMessage) {
        return '';
    }

    const normalizedHistory = trimChatHistory(history, 8);
    if (normalizedHistory.length === 0) {
        return latestMessage;
    }

    const renderedHistory = normalizedHistory
        .map((item) => `${item.role === 'assistant' ? 'เลขา' : 'ผู้ใช้'}: ${item.content}`)
        .join('\n');

    return `บริบทบทสนทนาก่อนหน้า:\n${renderedHistory}\n\nข้อความล่าสุดของผู้ใช้:\n${latestMessage}`;
}

async function askSoundwave(userMessage, env, history = []) {
    const prompt = buildChatHistoryPrompt(history, userMessage);
    const { generateAIReply } = await import('./ai-reply.js');
    return generateAIReply(prompt || String(userMessage || '').trim(), env, 'secretary');
}

export {
    trimChatHistory,
    readChatHistory,
    readChatSessionState,
    writeChatSessionState,
    deleteChatSessionState,
    buildChatHistoryPrompt,
    askSoundwave
};
