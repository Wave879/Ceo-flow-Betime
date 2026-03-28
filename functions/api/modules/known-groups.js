// ✅ Known groups store (KV + Cache) and pending task confirm

import { getFSBase, patchFirestoreDoc } from './firestore.js';
import { normalizeKnownGroupInGroup } from './data-normalizer.js';

const KNOWN_GROUPS_CACHE_URL = 'https://ceoflow.internal/__known_groups_v3';
const KNOWN_GROUPS_KV_KEY = 'known_groups_v2';
const KNOWN_GROUPS_KV_PREFIX = 'known_group_v2:';
const ALIVE_MODE_KV_PREFIX = 'alive_mode_v1:';
const TEST_ORDER_MODE_KV_PREFIX = 'test_order_mode_v1:';
const PENDING_TASK_CONFIRM_KV_PREFIX = 'pending_task_confirm_v1:';
const GROUP_MEMBER_INDEX_KV_PREFIX = 'group_member_v1:';
const MSG_DEDUP_KV_PREFIX = 'msg_dedup_v1:';
const GROUP_TYPE_VALUES = new Set(['unset', 'betimes', 'outsource', 'external']);

function normalizeGroupTypeValue(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
        return null;
    }

    if (GROUP_TYPE_VALUES.has(normalized)) {
        return normalized;
    }

    return null;
}

function getKnownGroupsKv(env) {
    const kv = env?.KNOWN_GROUPS_KV;
    if (!kv || typeof kv.get !== 'function' || typeof kv.put !== 'function') {
        return null;
    }
    return kv;
}

function getDefaultCache() {
    if (typeof caches === 'undefined' || !caches.default) {
        return null;
    }
    return caches.default;
}

function getKnownGroupsStoreStatus(env = {}) {
    const kv = getKnownGroupsKv(env);
    return {
        kvAvailable: Boolean(kv),
        kvListAvailable: Boolean(kv && typeof kv.list === 'function'),
        cacheAvailable: Boolean(getDefaultCache())
    };
}

function normalizeKnownGroupEntry(raw) {
    const groupId = String(raw?.groupId || raw?.id || '').trim();
    if (!groupId) {
        return null;
    }

    const groupType = normalizeGroupTypeValue(raw?.groupType ?? raw?.type ?? null);
    const inGroup = normalizeKnownGroupInGroup(raw?.inGroup);

    const rawMemberCount = raw?.memberCount ?? raw?.members ?? null;
    let memberCount = null;
    if (rawMemberCount !== null && rawMemberCount !== undefined && rawMemberCount !== '') {
        const parsed = Number(rawMemberCount);
        if (Number.isFinite(parsed) && parsed >= 0) {
            memberCount = Math.floor(parsed);
        }
    }

    return {
        groupId,
        name: String(raw?.name || `LINE GROUP ${groupId.slice(-6)}`),
        pictureUrl: raw?.pictureUrl || null,
        groupType,
        inGroup,
        memberCount,
        lastSeenAt: raw?.lastSeenAt || new Date().toISOString()
    };
}

function getKnownGroupKvItemKey(groupId) {
    return `${KNOWN_GROUPS_KV_PREFIX}${groupId}`;
}

function getAliveModeKvItemKey(docId) {
    return `${ALIVE_MODE_KV_PREFIX}${docId}`;
}

function getTestOrderModeKvItemKey(docId) {
    return `${TEST_ORDER_MODE_KV_PREFIX}${docId}`;
}

function getPendingTaskConfirmKvKey(scopeDocId) {
    return `${PENDING_TASK_CONFIRM_KV_PREFIX}${scopeDocId}`;
}

async function writePendingTaskConfirm(scopeDocId, payload, env) {
    const kv = getKnownGroupsKv(env);
    if (!kv) return false;
    try {
        // TTL 2 minutes (120 seconds)
        await kv.put(getPendingTaskConfirmKvKey(scopeDocId), JSON.stringify({
            ...payload,
            savedAt: new Date().toISOString()
        }), { expirationTtl: 120 });
        return true;
    } catch (err) {
        console.error('Write pending task confirm to KV failed:', err);
        return false;
    }
}

async function readPendingTaskConfirm(scopeDocId, env) {
    const kv = getKnownGroupsKv(env);
    if (!kv) return null;
    try {
        return await kv.get(getPendingTaskConfirmKvKey(scopeDocId), 'json');
    } catch (err) {
        console.error('Read pending task confirm from KV failed:', err);
        return null;
    }
}

async function deletePendingTaskConfirm(scopeDocId, env) {
    const kv = getKnownGroupsKv(env);
    if (!kv) return;
    try {
        await kv.delete(getPendingTaskConfirmKvKey(scopeDocId));
    } catch (err) {
        console.error('Delete pending task confirm from KV failed:', err);
    }
}

function getGroupMemberKvPrefix(groupId) {
    return `${GROUP_MEMBER_INDEX_KV_PREFIX}${groupId}:`;
}

function getGroupMemberKvItemKey(groupId, lineUserId) {
    return `${getGroupMemberKvPrefix(groupId)}${lineUserId}`;
}

function getGroupMemberLinkDocId(groupId, lineUserId) {
    const normalizedGroupId = String(groupId || '').trim();
    const normalizedLineUserId = String(lineUserId || '').trim();
    if (!normalizedGroupId || !normalizedLineUserId) {
        return '';
    }

    return `${normalizedGroupId}__${normalizedLineUserId}`;
}

async function rememberGroupMember(groupId, lineUserId, env = {}) {
    const normalizedGroupId = String(groupId || '').trim();
    const normalizedLineUserId = String(lineUserId || '').trim();
    if (!normalizedGroupId || !normalizedLineUserId) {
        return false;
    }

    const kv = getKnownGroupsKv(env);
    if (!kv) {
        return false;
    }

    try {
        await kv.put(
            getGroupMemberKvItemKey(normalizedGroupId, normalizedLineUserId),
            JSON.stringify({
                groupId: normalizedGroupId,
                lineUserId: normalizedLineUserId,
                updatedAt: new Date().toISOString()
            })
        );
        return true;
    } catch (err) {
        console.error(`Remember group member KV failed (${normalizedGroupId}:${normalizedLineUserId}):`, err);
        return false;
    }
}

async function readGroupMemberIdsFromKv(groupId, env = {}) {
    const normalizedGroupId = String(groupId || '').trim();
    if (!normalizedGroupId) {
        return {
            ids: new Set(),
            warning: 'Missing groupId',
            truncated: false
        };
    }

    const kv = getKnownGroupsKv(env);
    if (!kv || typeof kv.list !== 'function') {
        return {
            ids: new Set(),
            warning: 'KV list unavailable',
            truncated: false
        };
    }

    const ids = new Set();
    const prefix = getGroupMemberKvPrefix(normalizedGroupId);
    let cursor = undefined;
    let guard = 0;

    try {
        while (guard < 60) {
            const page = await kv.list({ prefix, cursor, limit: 1000 });
            const keys = Array.isArray(page?.keys) ? page.keys : [];

            for (const item of keys) {
                const keyName = String(item?.name || '').trim();
                if (!keyName.startsWith(prefix)) {
                    continue;
                }

                const lineUserId = keyName.slice(prefix.length).trim();
                if (lineUserId) {
                    ids.add(lineUserId);
                }
            }

            guard += 1;
            if (page?.list_complete || !page?.cursor) {
                return {
                    ids,
                    warning: null,
                    truncated: false
                };
            }

            cursor = page.cursor;
        }

        return {
            ids,
            warning: 'KV list truncated: pagination guard reached',
            truncated: true
        };
    } catch (err) {
        return {
            ids,
            warning: `KV list failed: ${err?.message || String(err)}`,
            truncated: false
        };
    }
}

function isGenericKnownGroupName(name = '') {
    const normalized = String(name || '').trim();
    if (!normalized) {
        return true;
    }
    return normalized.toUpperCase().startsWith('LINE GROUP');
}

async function readKnownGroupsFromCache() {
    const cache = getDefaultCache();
    if (!cache) {
        return [];
    }

    try {
        const key = new Request(KNOWN_GROUPS_CACHE_URL);
        const hit = await cache.match(key);
        if (!hit) {
            return [];
        }

        const data = await hit.json();
        if (!Array.isArray(data)) {
            return [];
        }

        return data
            .map(normalizeKnownGroupEntry)
            .filter(Boolean)
            .slice(0, 500);
    } catch (err) {
        console.error('Read known groups cache error:', err);
        return [];
    }
}

async function writeKnownGroupsToCache(groups) {
    const cache = getDefaultCache();
    if (!cache) {
        return false;
    }

    try {
        const payload = (Array.isArray(groups) ? groups : [])
            .map(normalizeKnownGroupEntry)
            .filter(Boolean)
            .slice(0, 500);

        const key = new Request(KNOWN_GROUPS_CACHE_URL);
        await cache.put(key, new Response(JSON.stringify(payload), {
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=31536000'
            }
        }));
        return true;
    } catch (err) {
        console.error('Write known groups cache error:', err);
        return false;
    }
}

async function readKnownGroupsFromKv(env) {
    const kv = getKnownGroupsKv(env);
    if (!kv) {
        return { groups: [], mode: 'unavailable' };
    }

    // Preferred mode: one KV key per group to avoid snapshot overwrite races.
    if (typeof kv.list === 'function') {
        try {
            const collected = [];
            const seen = new Set();
            let cursor = undefined;

            while (collected.length < 500) {
                const page = await kv.list({
                    prefix: KNOWN_GROUPS_KV_PREFIX,
                    cursor,
                    limit: 100
                });

                const keys = Array.isArray(page?.keys) ? page.keys : [];
                if (keys.length > 0) {
                    const rows = await Promise.all(
                        keys.map((k) => kv.get(k.name, 'json').catch(() => null))
                    );

                    for (const row of rows) {
                        const normalized = normalizeKnownGroupEntry(row);
                        if (!normalized || seen.has(normalized.groupId)) {
                            continue;
                        }

                        seen.add(normalized.groupId);
                        collected.push(normalized);
                        if (collected.length >= 500) {
                            break;
                        }
                    }
                }

                if (page?.list_complete) {
                    break;
                }

                cursor = page?.cursor;
                if (!cursor) {
                    break;
                }
            }

            if (collected.length > 0) {
                return { groups: collected, mode: 'item-keys' };
            }
        } catch (err) {
            console.error('Read known groups KV item-keys error:', err);
        }
    }

    // Legacy fallback: single snapshot key.
    try {
        const data = await kv.get(KNOWN_GROUPS_KV_KEY, 'json');
        if (!Array.isArray(data)) {
            return { groups: [], mode: 'empty' };
        }

        return {
            groups: data
                .map(normalizeKnownGroupEntry)
                .filter(Boolean)
                .slice(0, 500),
            mode: 'legacy-snapshot'
        };
    } catch (err) {
        console.error('Read known groups KV legacy error:', err);
        return { groups: [], mode: 'error' };
    }
}

async function writeKnownGroupToKv(group, env) {
    const kv = getKnownGroupsKv(env);
    if (!kv) {
        return false;
    }

    const normalized = normalizeKnownGroupEntry(group);
    if (!normalized) {
        return false;
    }

    try {
        await kv.put(getKnownGroupKvItemKey(normalized.groupId), JSON.stringify(normalized));
        return true;
    } catch (err) {
        console.error('Write known group KV item-key error:', err);
        return false;
    }
}

async function writeKnownGroupsToKv(groups, env) {
    const kv = getKnownGroupsKv(env);
    if (!kv) {
        return false;
    }

    try {
        const payload = (Array.isArray(groups) ? groups : [])
            .map(normalizeKnownGroupEntry)
            .filter(Boolean)
            .slice(0, 500);

        for (const item of payload) {
            await kv.put(getKnownGroupKvItemKey(item.groupId), JSON.stringify(item));
        }

        // Keep legacy snapshot for backward compatibility and emergency fallback.
        await kv.put(KNOWN_GROUPS_KV_KEY, JSON.stringify(payload));
        return true;
    } catch (err) {
        console.error('Write known groups KV error:', err);
        return false;
    }
}

async function deleteKnownGroupKeysByPrefix(kv, prefix) {
    if (!kv || typeof kv.list !== 'function' || typeof kv.delete !== 'function') {
        return 0;
    }

    let deleted = 0;

    for (let round = 0; round < 3; round += 1) {
        const names = new Set();
        let cursor;

        for (let guard = 0; guard < 50; guard += 1) {
            const page = await kv.list({ prefix, cursor, limit: 1000 });
            const keys = Array.isArray(page?.keys) ? page.keys : [];

            for (const item of keys) {
                const keyName = String(item?.name || '').trim();
                if (keyName) {
                    names.add(keyName);
                }
            }

            if (page?.list_complete || !page?.cursor) {
                break;
            }

            cursor = page.cursor;
        }

        if (names.size === 0) {
            break;
        }

        for (const keyName of names) {
            try {
                await kv.delete(keyName);
                deleted += 1;
            } catch (err) {
                console.error(`Delete known group key failed (${keyName}):`, err);
            }
        }
    }

    return deleted;
}

async function clearKnownGroupsData(env = {}) {
    const kv = getKnownGroupsKv(env);
    const result = {
        kvAvailable: Boolean(kv),
        cacheAvailable: Boolean(getDefaultCache()),
        kvDeleted: 0,
        cacheDeleted: 0,
        warnings: []
    };

    if (kv) {
        try {
            if (typeof kv.list === 'function' && typeof kv.delete === 'function') {
                result.kvDeleted += await deleteKnownGroupKeysByPrefix(kv, 'known_group_');
                result.kvDeleted += await deleteKnownGroupKeysByPrefix(kv, 'known_groups_');
                result.kvDeleted += await deleteKnownGroupKeysByPrefix(kv, GROUP_MEMBER_INDEX_KV_PREFIX);
            } else if (typeof kv.delete === 'function') {
                const fallbackKeys = [KNOWN_GROUPS_KV_KEY, 'known_groups_v1', 'known_groups_v2', 'known_groups_v3'];
                for (const keyName of fallbackKeys) {
                    try {
                        await kv.delete(keyName);
                        result.kvDeleted += 1;
                    } catch (err) {
                        console.error(`Delete known groups fallback key failed (${keyName}):`, err);
                    }
                }
            } else {
                result.warnings.push('KV binding does not support delete operation');
            }
        } catch (err) {
            result.warnings.push(err?.message || 'Failed to clear KV known groups');
        }
    }

    const cache = getDefaultCache();
    if (cache) {
        const cacheUrls = [
            'https://ceoflow.internal/__known_groups_v1',
            'https://ceoflow.internal/__known_groups_v2',
            KNOWN_GROUPS_CACHE_URL
        ];

        for (const url of cacheUrls) {
            try {
                const key = new Request(url);
                const deleted = await cache.delete(key);
                if (deleted) {
                    result.cacheDeleted += 1;
                }

                // Write an empty snapshot at this edge so stale cache data won't be re-used.
                await cache.put(key, new Response(JSON.stringify([]), {
                    headers: {
                        'Content-Type': 'application/json',
                        'Cache-Control': 'public, max-age=31536000'
                    }
                }));
            } catch (err) {
                result.warnings.push(err?.message || `Failed to clear cache key (${url})`);
            }
        }
    }

    return result;
}

async function deleteFirestoreDocumentByPath(path, env = {}) {
    const normalizedPath = String(path || '').trim();
    if (!normalizedPath || !env?.FIREBASE_PROJECT_ID || !env?.FIREBASE_API_KEY) {
        return false;
    }

    const url = `${getFSBase(env)}/${normalizedPath}?key=${env.FIREBASE_API_KEY}`;
    try {
        const res = await fetch(url, { method: 'DELETE' });
        if (res.ok || res.status === 404) {
            return true;
        }

        const errText = await res.text();
        console.error(`Delete Firestore doc failed (${normalizedPath}):`, res.status, errText);
        return false;
    } catch (err) {
        console.error(`Delete Firestore doc exception (${normalizedPath}):`, err);
        return false;
    }
}

async function deleteKnownGroupData(groupId, env = {}) {
    const normalizedGroupId = String(groupId || '').trim();
    if (!normalizedGroupId) {
        throw new Error('Missing groupId');
    }

    const kv = getKnownGroupsKv(env);
    const result = {
        groupId: normalizedGroupId,
        kvAvailable: Boolean(kv),
        cacheAvailable: Boolean(getDefaultCache()),
        firestoreConfigured: Boolean(env?.FIREBASE_PROJECT_ID && env?.FIREBASE_API_KEY),
        projectDeleted: null,
        aliveModeDeleted: null,
        warnings: []
    };

    if (kv && typeof kv.delete === 'function') {
        try {
            await kv.delete(getKnownGroupKvItemKey(normalizedGroupId));
        } catch (err) {
            result.warnings.push(err?.message || 'Failed deleting group item key from KV');
        }

        try {
            await kv.delete(getAliveModeKvItemKey(`group_${normalizedGroupId}`));
        } catch (err) {
            result.warnings.push(err?.message || 'Failed deleting alive mode key from KV');
        }

        try {
            await kv.delete(getTestOrderModeKvItemKey(`group_${normalizedGroupId}`));
        } catch (err) {
            result.warnings.push(err?.message || 'Failed deleting test-order mode key from KV');
        }

        try {
            if (typeof kv.list === 'function') {
                result.kvDeletedByPrefix = await deleteKnownGroupKeysByPrefix(kv, getGroupMemberKvPrefix(normalizedGroupId));
            }
        } catch (err) {
            result.warnings.push(err?.message || 'Failed deleting group member index keys from KV');
        }

        try {
            const snapshot = await kv.get(KNOWN_GROUPS_KV_KEY, 'json');
            if (Array.isArray(snapshot)) {
                const filtered = snapshot
                    .map(normalizeKnownGroupEntry)
                    .filter(Boolean)
                    .filter((entry) => entry.groupId !== normalizedGroupId)
                    .slice(0, 500);

                await kv.put(KNOWN_GROUPS_KV_KEY, JSON.stringify(filtered));
            }
        } catch (err) {
            result.warnings.push(err?.message || 'Failed updating legacy known_groups snapshot');
        }

        // Rebuild cache from KV after delete so stale names do not remain in edge cache.
        try {
            const latest = await readKnownGroupsFromKv(env);
            await writeKnownGroupsToCache(latest.groups || []);
        } catch (err) {
            result.warnings.push(err?.message || 'Failed refreshing cache after group delete');
        }
    } else {
        result.warnings.push('KV binding does not support delete operation');
    }

    if (result.firestoreConfigured) {
        result.projectDeleted = await deleteFirestoreDocumentByPath(`projects/${normalizedGroupId}`, env);
        if (!result.projectDeleted) {
            result.warnings.push('Failed deleting project document from Firestore');
        }

        result.aliveModeDeleted = await deleteFirestoreDocumentByPath(`aliveModes/group_${normalizedGroupId}`, env);
        if (!result.aliveModeDeleted) {
            result.warnings.push('Failed deleting scoped alive mode from Firestore');
        }
    }

    return result;
}

async function getKnownGroupsSnapshotWithSource(env = {}) {
    const store = getKnownGroupsStoreStatus(env);
    const fromKv = await readKnownGroupsFromKv(env);
    if (fromKv.groups.length > 0) {
        let source = 'kv';

        if (fromKv.mode === 'legacy-snapshot') {
            const migrated = await writeKnownGroupsToKv(fromKv.groups, env);
            source = migrated ? 'kv-legacy->kv' : 'kv-legacy';
        }

        // Mirror KV snapshot to cache so reads stay fast across edge nodes.
        await writeKnownGroupsToCache(fromKv.groups);
        return {
            groups: fromKv.groups,
            source,
            store
        };
    }

    // KV is authoritative when available. If KV is empty, do not rehydrate from cache,
    // otherwise stale cache data can resurrect deleted groups.
    if (store.kvAvailable) {
        await writeKnownGroupsToCache([]);
        return {
            groups: [],
            source: 'kv-empty',
            store
        };
    }

    const fromCache = await readKnownGroupsFromCache();
    if (fromCache.length > 0) {
        return {
            groups: fromCache,
            source: 'cache',
            store
        };
    }

    return {
        groups: [],
        source: 'empty',
        store
    };
}

async function getKnownGroupsSnapshot(env = {}) {
    const snapshot = await getKnownGroupsSnapshotWithSource(env);
    return snapshot.groups;
}

async function readKnownGroupFromSnapshot(groupId, env = {}) {
    const normalizedGroupId = String(groupId || '').trim();
    if (!normalizedGroupId) {
        return null;
    }

    try {
        const snapshot = await getKnownGroupsSnapshotWithSource(env);
        const found = (snapshot.groups || []).find((entry) => entry.groupId === normalizedGroupId) || null;
        return normalizeKnownGroupEntry(found);
    } catch (err) {
        console.error(`Read known group snapshot failed (${normalizedGroupId}):`, err);
        return null;
    }
}

async function rememberKnownGroup(groupId, name, pictureUrl = null, env = {}, memberCount = null, groupType = null, inGroup = undefined) {
    const normalized = normalizeKnownGroupEntry({
        groupId,
        name,
        pictureUrl,
        groupType,
        inGroup,
        memberCount,
        lastSeenAt: new Date().toISOString()
    });

    if (!normalized) {
        return;
    }

    const cachedCurrent = await readKnownGroupsFromCache();
    const map = new Map(cachedCurrent.map((entry) => [entry.groupId, entry]));
    const previous = map.get(normalized.groupId) || {};

    const mergedEntry = {
        ...previous,
        ...normalized,
        groupType: normalized.groupType ?? previous.groupType ?? null,
        inGroup: typeof normalized.inGroup === 'boolean'
            ? normalized.inGroup
            : (typeof previous.inGroup === 'boolean' ? previous.inGroup : true),
        memberCount: normalized.memberCount ?? previous.memberCount ?? null,
        lastSeenAt: new Date().toISOString()
    };

    map.set(normalized.groupId, mergedEntry);

    const next = [...map.values()];
    const kvWriteOk = await writeKnownGroupToKv(mergedEntry, env);
    const cacheWriteOk = await writeKnownGroupsToCache(next);

    if (!kvWriteOk && getKnownGroupsKv(env)) {
        console.error('Known groups KV write failed; cache mirror status:', cacheWriteOk);
    }
}

async function setKnownGroupType(groupId, groupType, env = {}) {
    const normalizedGroupId = String(groupId || '').trim();
    if (!normalizedGroupId) {
        throw new Error('Missing groupId');
    }

    const normalizedGroupType = normalizeGroupTypeValue(groupType) || 'unset';
    let existing = null;

    try {
        const snapshot = await getKnownGroupsSnapshotWithSource(env);
        existing = (snapshot.groups || []).find((entry) => entry.groupId === normalizedGroupId) || null;
    } catch (err) {
        console.error(`Read known group for setKnownGroupType failed (${normalizedGroupId}):`, err);
    }

    await rememberKnownGroup(
        normalizedGroupId,
        existing?.name || `LINE GROUP ${normalizedGroupId.slice(-6)}`,
        existing?.pictureUrl || null,
        env,
        existing?.memberCount ?? null,
        normalizedGroupType,
        existing?.inGroup
    );

    let firestoreSynced = false;
    if (env?.FIREBASE_PROJECT_ID && env?.FIREBASE_API_KEY) {
        firestoreSynced = await patchFirestoreDoc(`projects/${normalizedGroupId}`, {
            id: { stringValue: normalizedGroupId },
            groupType: { stringValue: normalizedGroupType },
            updatedAt: { timestampValue: new Date().toISOString() }
        }, env, false);
    }

    return {
        groupId: normalizedGroupId,
        groupType: normalizedGroupType,
        firestoreSynced
    };
}

export {
    KNOWN_GROUPS_CACHE_URL,
    KNOWN_GROUPS_KV_KEY,
    KNOWN_GROUPS_KV_PREFIX,
    ALIVE_MODE_KV_PREFIX,
    TEST_ORDER_MODE_KV_PREFIX,
    PENDING_TASK_CONFIRM_KV_PREFIX,
    GROUP_MEMBER_INDEX_KV_PREFIX,
    MSG_DEDUP_KV_PREFIX,
    GROUP_TYPE_VALUES,
    normalizeGroupTypeValue,
    getKnownGroupsKv,
    getDefaultCache,
    getKnownGroupsStoreStatus,
    normalizeKnownGroupEntry,
    getKnownGroupKvItemKey,
    getAliveModeKvItemKey,
    getTestOrderModeKvItemKey,
    getPendingTaskConfirmKvKey,
    writePendingTaskConfirm,
    readPendingTaskConfirm,
    deletePendingTaskConfirm,
    getGroupMemberKvPrefix,
    getGroupMemberKvItemKey,
    getGroupMemberLinkDocId,
    rememberGroupMember,
    readGroupMemberIdsFromKv,
    isGenericKnownGroupName,
    readKnownGroupsFromCache,
    writeKnownGroupsToCache,
    readKnownGroupsFromKv,
    writeKnownGroupToKv,
    writeKnownGroupsToKv,
    deleteKnownGroupKeysByPrefix,
    clearKnownGroupsData,
    deleteFirestoreDocumentByPath,
    deleteKnownGroupData,
    getKnownGroupsSnapshotWithSource,
    getKnownGroupsSnapshot,
    readKnownGroupFromSnapshot,
    rememberKnownGroup,
    setKnownGroupType
};
