// ✅ Mode manager — resolveAliveModeScope, parseFirestoreBooleanField, alive mode state, test order mode state

import { fsGetDoc, fsSetDoc, patchFirestoreDoc } from './firestore.js';
import { getKnownGroupsKv, getAliveModeKvItemKey, getTestOrderModeKvItemKey } from './known-groups.js';

function resolveAliveModeScope(sourceType, groupId, roomId, lineUserId) {
    if (sourceType === 'group' && groupId) {
        return {
            docId: `group_${groupId}`,
            scopeType: 'group',
            scopeId: groupId
        };
    }

    if (sourceType === 'room' && roomId) {
        return {
            docId: `room_${roomId}`,
            scopeType: 'room',
            scopeId: roomId
        };
    }

    if (lineUserId) {
        return {
            docId: `user_${lineUserId}`,
            scopeType: 'user',
            scopeId: lineUserId
        };
    }

    return null;
}

function parseFirestoreBooleanField(field) {
    if (typeof field?.booleanValue === 'boolean') {
        return field.booleanValue;
    }

    const normalized = String(field?.stringValue || '').trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') {
        return true;
    }
    if (normalized === 'false' || normalized === '0') {
        return false;
    }

    return null;
}

function resolveChatSessionScope(sourceType, groupId, roomId, lineUserId) {
    const normalizedUserId = String(lineUserId || '').trim();
    const scopedUserId = normalizedUserId || 'anonymous';

    if (sourceType === 'group' && groupId) {
        return {
            docId: `chat_group_${groupId}_${scopedUserId}`,
            scopeType: 'group',
            scopeId: groupId
        };
    }

    if (sourceType === 'room' && roomId) {
        return {
            docId: `chat_room_${roomId}_${scopedUserId}`,
            scopeType: 'room',
            scopeId: roomId
        };
    }

    if (!normalizedUserId) {
        return null;
    }

    return {
        docId: `chat_user_${normalizedUserId}`,
        scopeType: 'user',
        scopeId: normalizedUserId
    };
}

async function readAliveModeState(sourceType, groupId, roomId, lineUserId, env) {
    const scope = resolveAliveModeScope(sourceType, groupId, roomId, lineUserId);
    if (!scope) {
        return Boolean(globalThis.__ALIVE_MODE__);
    }

    const scopedMemory = globalThis.__ALIVE_MODE_SCOPES__?.[scope.docId];
    if (typeof scopedMemory === 'boolean') {
        return scopedMemory;
    }

    const kv = getKnownGroupsKv(env);
    if (kv) {
        try {
            const payload = await kv.get(getAliveModeKvItemKey(scope.docId), 'json');
            if (payload && typeof payload === 'object') {
                if (typeof payload.enabled === 'boolean') {
                    if (!globalThis.__ALIVE_MODE_SCOPES__) {
                        globalThis.__ALIVE_MODE_SCOPES__ = {};
                    }
                    globalThis.__ALIVE_MODE_SCOPES__[scope.docId] = payload.enabled;
                    return payload.enabled;
                }

                const parsedFromPayload = parseFirestoreBooleanField({ stringValue: String(payload.enabled) });
                if (parsedFromPayload !== null) {
                    if (!globalThis.__ALIVE_MODE_SCOPES__) {
                        globalThis.__ALIVE_MODE_SCOPES__ = {};
                    }
                    globalThis.__ALIVE_MODE_SCOPES__[scope.docId] = parsedFromPayload;
                    return parsedFromPayload;
                }
            }
        } catch (err) {
            console.error('Read alive mode from KV failed:', err);
        }
    }

    try {
        const fields = await fsGetDoc('aliveModes', scope.docId, env);
        const parsed = parseFirestoreBooleanField(fields?.enabled);
        if (parsed !== null) {
            if (!globalThis.__ALIVE_MODE_SCOPES__) {
                globalThis.__ALIVE_MODE_SCOPES__ = {};
            }
            globalThis.__ALIVE_MODE_SCOPES__[scope.docId] = parsed;
            return parsed;
        }
    } catch (err) {
        console.error('Read alive mode failed:', err);
    }

    return false;
}

async function writeAliveModeState(sourceType, groupId, roomId, lineUserId, enabled, env) {
    const normalizedEnabled = Boolean(enabled);
    globalThis.__ALIVE_MODE__ = normalizedEnabled;

    const scope = resolveAliveModeScope(sourceType, groupId, roomId, lineUserId);
    if (!scope) {
        return false;
    }

    if (!globalThis.__ALIVE_MODE_SCOPES__) {
        globalThis.__ALIVE_MODE_SCOPES__ = {};
    }
    globalThis.__ALIVE_MODE_SCOPES__[scope.docId] = normalizedEnabled;

    let kvWriteOk = false;
    const kv = getKnownGroupsKv(env);
    if (kv) {
        try {
            await kv.put(getAliveModeKvItemKey(scope.docId), JSON.stringify({
                enabled: normalizedEnabled,
                scopeType: scope.scopeType,
                scopeId: scope.scopeId,
                updatedAt: new Date().toISOString()
            }));
            kvWriteOk = true;
        } catch (err) {
            console.error('Write alive mode to KV failed:', err);
        }
    }

    const ok = await patchFirestoreDoc(`aliveModes/${scope.docId}`, {
        enabled: { booleanValue: normalizedEnabled },
        scopeType: { stringValue: scope.scopeType },
        scopeId: { stringValue: scope.scopeId },
        updatedAt: { timestampValue: new Date().toISOString() }
    }, env, false);

    if (ok) {
        return true;
    }

    if (kvWriteOk) {
        return true;
    }

    try {
        await fsSetDoc('aliveModes', scope.docId, {
            enabled: normalizedEnabled ? 'true' : 'false',
            scopeType: scope.scopeType,
            scopeId: scope.scopeId,
            updatedAt: new Date().toISOString()
        }, env);
        return true;
    } catch (err) {
        console.error('Write alive mode fallback failed:', err);
        return false;
    }
}

async function readTestOrderModeState(sourceType, groupId, roomId, lineUserId, env) {
    const scope = resolveAliveModeScope(sourceType, groupId, roomId, lineUserId);
    if (!scope) {
        return false;
    }

    const scopedMemory = globalThis.__TEST_ORDER_MODE_SCOPES__?.[scope.docId];
    if (typeof scopedMemory === 'boolean') {
        return scopedMemory;
    }

    const kv = getKnownGroupsKv(env);
    if (kv) {
        try {
            const payload = await kv.get(getTestOrderModeKvItemKey(scope.docId), 'json');
            if (payload && typeof payload === 'object') {
                if (typeof payload.enabled === 'boolean') {
                    if (!globalThis.__TEST_ORDER_MODE_SCOPES__) {
                        globalThis.__TEST_ORDER_MODE_SCOPES__ = {};
                    }
                    globalThis.__TEST_ORDER_MODE_SCOPES__[scope.docId] = payload.enabled;
                    return payload.enabled;
                }

                const parsedFromPayload = parseFirestoreBooleanField({ stringValue: String(payload.enabled) });
                if (parsedFromPayload !== null) {
                    if (!globalThis.__TEST_ORDER_MODE_SCOPES__) {
                        globalThis.__TEST_ORDER_MODE_SCOPES__ = {};
                    }
                    globalThis.__TEST_ORDER_MODE_SCOPES__[scope.docId] = parsedFromPayload;
                    return parsedFromPayload;
                }
            }
        } catch (err) {
            console.error('Read test-order mode from KV failed:', err);
        }
    }

    try {
        const fields = await fsGetDoc('testOrderModes', scope.docId, env);
        const parsed = parseFirestoreBooleanField(fields?.enabled);
        if (parsed !== null) {
            if (!globalThis.__TEST_ORDER_MODE_SCOPES__) {
                globalThis.__TEST_ORDER_MODE_SCOPES__ = {};
            }
            globalThis.__TEST_ORDER_MODE_SCOPES__[scope.docId] = parsed;
            return parsed;
        }
    } catch (err) {
        console.error('Read test-order mode failed:', err);
    }

    return false;
}

async function writeTestOrderModeState(sourceType, groupId, roomId, lineUserId, enabled, env) {
    const normalizedEnabled = Boolean(enabled);
    const scope = resolveAliveModeScope(sourceType, groupId, roomId, lineUserId);
    if (!scope) {
        return false;
    }

    if (!globalThis.__TEST_ORDER_MODE_SCOPES__) {
        globalThis.__TEST_ORDER_MODE_SCOPES__ = {};
    }
    globalThis.__TEST_ORDER_MODE_SCOPES__[scope.docId] = normalizedEnabled;

    let kvWriteOk = false;
    const kv = getKnownGroupsKv(env);
    if (kv) {
        try {
            await kv.put(getTestOrderModeKvItemKey(scope.docId), JSON.stringify({
                enabled: normalizedEnabled,
                scopeType: scope.scopeType,
                scopeId: scope.scopeId,
                updatedAt: new Date().toISOString()
            }));
            kvWriteOk = true;
        } catch (err) {
            console.error('Write test-order mode to KV failed:', err);
        }
    }

    const ok = await patchFirestoreDoc(`testOrderModes/${scope.docId}`, {
        enabled: { booleanValue: normalizedEnabled },
        scopeType: { stringValue: scope.scopeType },
        scopeId: { stringValue: scope.scopeId },
        updatedAt: { timestampValue: new Date().toISOString() }
    }, env, false);

    if (ok) {
        return true;
    }

    if (kvWriteOk) {
        return true;
    }

    try {
        await fsSetDoc('testOrderModes', scope.docId, {
            enabled: normalizedEnabled ? 'true' : 'false',
            scopeType: scope.scopeType,
            scopeId: scope.scopeId,
            updatedAt: new Date().toISOString()
        }, env);
        return true;
    } catch (err) {
        console.error('Write test-order mode fallback failed:', err);
        return false;
    }
}

export {
    resolveAliveModeScope,
    parseFirestoreBooleanField,
    resolveChatSessionScope,
    readAliveModeState,
    writeAliveModeState,
    readTestOrderModeState,
    writeTestOrderModeState
};
