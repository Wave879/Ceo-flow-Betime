// ✅ Member sync — Firestore collection walking, member ID collection, team member sync, placeholder employees

import { getFSBase, fsGetDoc, patchFirestoreDoc } from './firestore.js';
import { readFirestoreStringField, readFirestoreIntegerField } from './firestore.js';
import {
    normalizeNonNegativeInteger,
    shouldIncludeBotInMemberCount,
    resolveHistoricalMemberCountFloor,
    getForcedMinimumMemberCount
} from './data-normalizer.js';
import { isLikelyLineUserId, getEmployeeDocIdFromLineUserId, fetchLineGroupMemberCount, isLineNotInGroupError } from './line-api.js';
import {
    getKnownGroupsKv,
    rememberGroupMember,
    rememberKnownGroup,
    readGroupMemberIdsFromKv,
    readKnownGroupFromSnapshot,
    deleteFirestoreDocumentByPath
} from './known-groups.js';

// Inline parseFirestoreBooleanField to avoid circular imports with mode-manager.js
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

function getFirestoreDocId(docName = '') {
    const normalized = String(docName || '').trim();
    if (!normalized) {
        return '';
    }

    const parts = normalized.split('/').filter(Boolean);
    if (parts.length === 0) {
        return '';
    }

    return parts[parts.length - 1];
}

async function walkFirestoreCollection(path, env = {}, onDocument = () => { }, options = {}) {
    const normalizedPath = String(path || '').trim();
    if (!normalizedPath || !env?.FIREBASE_PROJECT_ID || !env?.FIREBASE_API_KEY) {
        return {
            ok: false,
            scanned: 0,
            truncated: false,
            warning: 'Missing Firestore configuration'
        };
    }

    const pageSize = Number.isFinite(Number(options.pageSize)) ? Math.max(1, Math.min(1000, Math.floor(Number(options.pageSize)))) : 200;
    const maxPages = Number.isFinite(Number(options.maxPages)) ? Math.max(1, Math.floor(Number(options.maxPages))) : 30;

    let scanned = 0;
    let nextPageToken = null;
    let page = 0;

    try {
        do {
            let url = `${getFSBase(env)}/${normalizedPath}?pageSize=${pageSize}&key=${env.FIREBASE_API_KEY}`;
            if (nextPageToken) {
                url += `&pageToken=${encodeURIComponent(nextPageToken)}`;
            }

            const res = await fetch(url);
            if (!res.ok) {
                const errText = await res.text();
                return {
                    ok: false,
                    scanned,
                    truncated: false,
                    warning: `Firestore list failed (${normalizedPath}): ${res.status} ${errText}`
                };
            }

            const data = await res.json();
            const docs = Array.isArray(data?.documents) ? data.documents : [];
            for (const doc of docs) {
                try {
                    onDocument(doc || {});
                } catch (err) {
                    console.error(`walkFirestoreCollection callback error (${normalizedPath}):`, err);
                }
                scanned += 1;
            }

            nextPageToken = data?.nextPageToken || null;
            page += 1;
        } while (nextPageToken && page < maxPages);

        return {
            ok: true,
            scanned,
            truncated: Boolean(nextPageToken),
            warning: nextPageToken ? `Firestore list truncated (${normalizedPath}): maxPages reached` : null
        };
    } catch (err) {
        return {
            ok: false,
            scanned,
            truncated: false,
            warning: `Firestore list exception (${normalizedPath}): ${err?.message || String(err)}`
        };
    }
}

async function collectMemberIdsFromGroupMessages(groupId, env = {}) {
    const ids = new Set();
    const result = await walkFirestoreCollection(
        `projects/${groupId}/messages`,
        env,
        (doc) => {
            const fields = doc?.fields || {};
            const lineUserId = readFirestoreStringField(fields, 'lineUserId');
            if (lineUserId) {
                ids.add(lineUserId);
            }
        },
        { pageSize: 300, maxPages: 40 }
    );

    return {
        ids,
        scanned: result.scanned,
        warning: result.warning,
        truncated: result.truncated
    };
}

async function collectMemberIdsFromGroupUsers(groupId, env = {}) {
    const ids = new Set();
    const result = await walkFirestoreCollection(
        'groupUsers',
        env,
        (doc) => {
            const fields = doc?.fields || {};
            const projectGroup = readFirestoreStringField(fields, 'projectGroup');
            if (projectGroup !== groupId) {
                return;
            }

            const userIdFromField = readFirestoreStringField(fields, 'userId');
            const userId = userIdFromField || getFirestoreDocId(doc?.name);
            if (userId) {
                ids.add(userId);
            }
        },
        { pageSize: 300, maxPages: 40 }
    );

    return {
        ids,
        scanned: result.scanned,
        warning: result.warning,
        truncated: result.truncated
    };
}

async function collectMemberIdsFromProjectMembers(groupId, env = {}) {
    const ids = new Set();
    const result = await walkFirestoreCollection(
        `projects/${groupId}/members`,
        env,
        (doc) => {
            const fields = doc?.fields || {};
            const lineUserId = readFirestoreStringField(fields, 'lineUserId');
            const employeeId = readFirestoreStringField(fields, 'employeeId');
            const docId = getFirestoreDocId(doc?.name);

            const memberId = lineUserId || employeeId || docId;
            if (memberId) {
                ids.add(memberId);
            }
        },
        { pageSize: 300, maxPages: 40 }
    );

    return {
        ids,
        scanned: result.scanned,
        warning: result.warning,
        truncated: result.truncated
    };
}

async function collectMemberIdsFromInternalSources(groupId, env = {}) {
    const [messageResult, groupUsersResult, projectMembersResult, kvMemberIdsResult] = await Promise.all([
        collectMemberIdsFromGroupMessages(groupId, env),
        collectMemberIdsFromGroupUsers(groupId, env),
        collectMemberIdsFromProjectMembers(groupId, env),
        readGroupMemberIdsFromKv(groupId, env)
    ]);

    const ids = new Set([
        ...messageResult.ids,
        ...groupUsersResult.ids,
        ...projectMembersResult.ids,
        ...kvMemberIdsResult.ids
    ]);

    return {
        ids,
        messageResult,
        groupUsersResult,
        projectMembersResult,
        kvMemberIdsResult
    };
}

async function mirrorMemberIdsToKv(groupId, ids, env = {}) {
    const list = Array.isArray(ids) ? ids : [...(ids || [])];
    if (list.length === 0) {
        return 0;
    }

    let mirrored = 0;
    for (const memberId of list) {
        const ok = await rememberGroupMember(groupId, memberId, env);
        if (ok) {
            mirrored += 1;
        }
    }

    return mirrored;
}

async function recountMemberCountFromFirestoreSources(groupId, env = {}) {
    const normalizedGroupId = String(groupId || '').trim();
    if (!normalizedGroupId) {
        throw new Error('Missing groupId');
    }

    if (!env?.FIREBASE_PROJECT_ID || !env?.FIREBASE_API_KEY) {
        throw new Error('Missing Firestore configuration');
    }

    const warnings = [];
    const {
        ids: uniqueUserIds,
        messageResult,
        groupUsersResult,
        projectMembersResult,
        kvMemberIdsResult
    } = await collectMemberIdsFromInternalSources(normalizedGroupId, env);

    if (messageResult.warning) {
        warnings.push(`messages:${messageResult.warning}`);
    }
    if (groupUsersResult.warning) {
        warnings.push(`groupUsers:${groupUsersResult.warning}`);
    }
    if (projectMembersResult.warning) {
        warnings.push(`projectMembers:${projectMembersResult.warning}`);
    }
    if (kvMemberIdsResult.warning && kvMemberIdsResult.warning !== 'KV list unavailable') {
        warnings.push(`kvMembers:${kvMemberIdsResult.warning}`);
    }

    let memberCount = uniqueUserIds.size;
    let lineMembersCount = null;

    if (memberCount > 0) {
        await mirrorMemberIdsToKv(normalizedGroupId, uniqueUserIds, env);
    }

    if (memberCount <= 1) {
        const lineCountRes = await fetchLineGroupMemberCount(normalizedGroupId, env);
        if (lineCountRes.count !== null && lineCountRes.count > memberCount) {
            lineMembersCount = lineCountRes.count;
            memberCount = lineCountRes.count;
            warnings.push(`fallback:line-memberCount:${lineCountRes.count}`);
        } else if (lineCountRes.error && !isLineNotInGroupError(lineCountRes.error)) {
            warnings.push(`line-memberCount:${lineCountRes.error}`);
        }
    }

    // Use lazy import to avoid circular dependency (group-sync imports member-sync)
    const { readProjectIdentityFromFirestore } = await import('./group-sync.js');
    const projectFallback = await readProjectIdentityFromFirestore(normalizedGroupId, env);
    const knownGroupFallback = await readKnownGroupFromSnapshot(normalizedGroupId, env);

    const historicalFloor = resolveHistoricalMemberCountFloor(
        projectFallback?.memberCount,
        knownGroupFallback?.memberCount
    );

    if (historicalFloor !== null && historicalFloor > memberCount) {
        memberCount = historicalFloor;
        warnings.push(`fallback:historical-memberCount:${historicalFloor}`);
    }

    if (memberCount === 0) {
        const forcedMin = getForcedMinimumMemberCount(env);
        if (forcedMin > 0) {
            memberCount = forcedMin;
            warnings.push(`fallback:forced-min-memberCount:${forcedMin}`);
        }
    }

    await rememberKnownGroup(
        normalizedGroupId,
        projectFallback?.name || knownGroupFallback?.name || `LINE GROUP ${normalizedGroupId.slice(-6)}`,
        projectFallback?.pictureUrl || knownGroupFallback?.pictureUrl || null,
        env,
        memberCount,
        projectFallback?.groupType || knownGroupFallback?.groupType || null
    );

    const projectSynced = await patchFirestoreDoc(`projects/${normalizedGroupId}`, {
        id: { stringValue: normalizedGroupId },
        memberCount: { integerValue: String(memberCount) },
        updatedAt: { timestampValue: new Date().toISOString() }
    }, env, false);

    if (!projectSynced) {
        warnings.push('firestore-project-write-failed');
    }

    return {
        groupId: normalizedGroupId,
        memberCount,
        uniqueMembers: uniqueUserIds.size,
        fromMessages: messageResult.ids.size,
        fromGroupUsers: groupUsersResult.ids.size,
        fromProjectMembers: projectMembersResult.ids.size,
        fromKvMembers: kvMemberIdsResult.ids.size,
        fromLineMembersCount: lineMembersCount,
        scannedMessages: messageResult.scanned,
        scannedGroupUsers: groupUsersResult.scanned,
        scannedProjectMembers: projectMembersResult.scanned,
        projectSynced,
        warnings
    };
}

function isGenericLineDisplayName(name, lineUserId = '') {
    const normalizedName = String(name || '').trim();
    if (!normalizedName) {
        return true;
    }

    const normalizedLineUserId = String(lineUserId || '').trim();
    if (normalizedLineUserId) {
        return normalizedName === `LINE-${normalizedLineUserId.slice(-6)}`;
    }

    return /^LINE-[A-Za-z0-9]{4,}$/i.test(normalizedName);
}

function mergeGroupTeamCandidate(candidateMap, rawCandidate = {}) {
    if (!(candidateMap instanceof Map)) {
        return;
    }

    const lineUserIdRaw = String(rawCandidate?.lineUserId || '').trim();
    const lineUserId = isLikelyLineUserId(lineUserIdRaw) ? lineUserIdRaw : '';
    const empIdRaw = String(rawCandidate?.empId || '').trim();
    const empId = empIdRaw || getEmployeeDocIdFromLineUserId(lineUserId);
    if (!empId) {
        return;
    }

    const fallbackName = lineUserId ? `LINE-${lineUserId.slice(-6)}` : empId;
    const incomingName = String(rawCandidate?.displayName || rawCandidate?.fullName || '').trim();
    const displayName = incomingName || fallbackName;
    const source = String(rawCandidate?.source || '').trim();

    const current = candidateMap.get(empId) || {
        empId,
        lineUserId: '',
        displayName: fallbackName,
        sources: []
    };

    const merged = {
        ...current,
        empId,
        lineUserId: current.lineUserId || lineUserId,
        displayName: current.displayName,
        sources: Array.isArray(current.sources) ? [...current.sources] : []
    };

    if (source && !merged.sources.includes(source)) {
        merged.sources.push(source);
    }

    if (lineUserId && !merged.lineUserId) {
        merged.lineUserId = lineUserId;
    }

    if (!merged.displayName || isGenericLineDisplayName(merged.displayName, merged.lineUserId)) {
        merged.displayName = displayName;
    } else if (!isGenericLineDisplayName(displayName, lineUserId) && displayName.length >= merged.displayName.length) {
        merged.displayName = displayName;
    }

    candidateMap.set(empId, merged);
}

async function collectGroupTeamCandidates(groupId, env = {}, options = {}) {
    const candidateMap = new Map();
    const warnings = [];
    const sourceStats = {
        fromSeedLineMembers: 0,
        fromGroupMemberLinks: 0,
        fromGroupUsers: 0,
        fromMessages: 0,
        fromProjectMembers: 0
    };

    const seedLineUserIds = Array.isArray(options?.seedLineUserIds)
        ? options.seedLineUserIds
        : [];

    const fallbackUserId = String(options?.fallbackUserId || '').trim();
    const seedIds = new Set(
        [...seedLineUserIds, fallbackUserId]
            .map((id) => String(id || '').trim())
            .filter(Boolean)
    );

    for (const lineUserId of seedIds) {
        if (!isLikelyLineUserId(lineUserId)) {
            continue;
        }

        mergeGroupTeamCandidate(candidateMap, {
            lineUserId,
            displayName: `LINE-${lineUserId.slice(-6)}`,
            source: 'line-members'
        });
        sourceStats.fromSeedLineMembers += 1;
    }

    const groupMemberLinksResult = await walkFirestoreCollection(
        'groupMemberLinks',
        env,
        (doc) => {
            const fields = doc?.fields || {};
            const linkedGroupId = readFirestoreStringField(fields, 'groupId');
            if (linkedGroupId !== groupId) {
                return;
            }

            const lineUserId = readFirestoreStringField(fields, 'lineUserId');
            if (!isLikelyLineUserId(lineUserId)) {
                return;
            }

            const displayName = readFirestoreStringField(fields, 'displayName');
            mergeGroupTeamCandidate(candidateMap, {
                lineUserId,
                displayName,
                source: 'groupMemberLinks'
            });
            sourceStats.fromGroupMemberLinks += 1;
        },
        { pageSize: 300, maxPages: 40 }
    );
    if (groupMemberLinksResult.warning) {
        warnings.push(`groupMemberLinks:${groupMemberLinksResult.warning}`);
    }

    const groupUsersResult = await walkFirestoreCollection(
        'groupUsers',
        env,
        (doc) => {
            const fields = doc?.fields || {};
            const projectGroup = readFirestoreStringField(fields, 'projectGroup');
            if (projectGroup !== groupId) {
                return;
            }

            const lineUserId = readFirestoreStringField(fields, 'userId') || getFirestoreDocId(doc?.name);
            if (!isLikelyLineUserId(lineUserId)) {
                return;
            }

            const displayName = readFirestoreStringField(fields, 'displayName');
            mergeGroupTeamCandidate(candidateMap, {
                lineUserId,
                displayName,
                source: 'groupUsers'
            });
            sourceStats.fromGroupUsers += 1;
        },
        { pageSize: 300, maxPages: 40 }
    );
    if (groupUsersResult.warning) {
        warnings.push(`groupUsers:${groupUsersResult.warning}`);
    }

    const messagesResult = await walkFirestoreCollection(
        `projects/${groupId}/messages`,
        env,
        (doc) => {
            const fields = doc?.fields || {};
            const lineUserId = readFirestoreStringField(fields, 'lineUserId');
            if (!isLikelyLineUserId(lineUserId)) {
                return;
            }

            mergeGroupTeamCandidate(candidateMap, {
                lineUserId,
                displayName: `LINE-${lineUserId.slice(-6)}`,
                source: 'messages'
            });
            sourceStats.fromMessages += 1;
        },
        { pageSize: 300, maxPages: 40 }
    );
    if (messagesResult.warning) {
        warnings.push(`messages:${messagesResult.warning}`);
    }

    const projectMembersResult = await walkFirestoreCollection(
        `projects/${groupId}/members`,
        env,
        (doc) => {
            const fields = doc?.fields || {};
            const employeeId = readFirestoreStringField(fields, 'employeeId') || getFirestoreDocId(doc?.name);
            if (!employeeId) {
                return;
            }

            const lineUserIdRaw = readFirestoreStringField(fields, 'lineUserId');
            const lineUserId = isLikelyLineUserId(lineUserIdRaw) ? lineUserIdRaw : '';
            const fullName = readFirestoreStringField(fields, 'fullName') || readFirestoreStringField(fields, 'name');

            mergeGroupTeamCandidate(candidateMap, {
                empId: employeeId,
                lineUserId,
                displayName: fullName,
                source: 'projectMembers'
            });
            sourceStats.fromProjectMembers += 1;
        },
        { pageSize: 300, maxPages: 40 }
    );
    if (projectMembersResult.warning) {
        warnings.push(`projectMembers:${projectMembersResult.warning}`);
    }

    return {
        candidates: [...candidateMap.values()],
        warnings,
        sourceStats
    };
}

async function upsertGroupTeamEmployee(groupId, candidate = {}, env = {}) {
    const empId = String(candidate?.empId || '').trim();
    if (!empId) {
        return false;
    }

    const lineUserIdRaw = String(candidate?.lineUserId || '').trim();
    const lineUserId = isLikelyLineUserId(lineUserIdRaw) ? lineUserIdRaw : '';
    const fallbackName = lineUserId ? `LINE-${lineUserId.slice(-6)}` : empId;
    const displayName = String(candidate?.displayName || '').trim() || fallbackName;

    const fields = {
        id: { stringValue: empId },
        name: { stringValue: displayName },
        fullName: { stringValue: displayName },
        role: { stringValue: 'member' },
        projectId: { stringValue: groupId },
        updatedAt: { timestampValue: new Date().toISOString() }
    };

    if (lineUserId) {
        fields.lineUserId = { stringValue: lineUserId };
    }

    fields.isPlaceholder = { booleanValue: false };

    return patchFirestoreDoc(`employees/${empId}`, fields, env, false);
}

function getGroupPlaceholderEmployeeId(groupId, index) {
    const normalizedGroupId = String(groupId || '').trim();
    const normalizedIndex = Math.max(1, Math.floor(Number(index) || 1));
    return `emp_${normalizedGroupId.slice(-6)}_ph_${String(normalizedIndex).padStart(2, '0')}`;
}

function resolveExpectedTeamMemberCount(rawExpectedCount, env = {}) {
    const expected = normalizeNonNegativeInteger(rawExpectedCount);
    if (expected === null) {
        return null;
    }

    if (shouldIncludeBotInMemberCount(env) && expected > 0) {
        return Math.max(0, expected - 1);
    }

    return expected;
}

async function clearGroupPlaceholderEmployees(groupId, env = {}) {
    let deleted = 0;
    const result = await walkFirestoreCollection(
        'employees',
        env,
        async (doc) => {
            const docId = getFirestoreDocId(doc?.name);
            if (!docId) {
                return;
            }

            const fields = doc?.fields || {};
            const projectId = readFirestoreStringField(fields, 'projectId');
            if (projectId !== groupId) {
                return;
            }

            const isPlaceholder = parseFirestoreBooleanField(fields?.isPlaceholder);
            if (!isPlaceholder) {
                return;
            }

            const ok = await deleteFirestoreDocumentByPath(`employees/${docId}`, env);
            if (ok) {
                deleted += 1;
            }
        },
        { pageSize: 300, maxPages: 40 }
    );

    return {
        deleted,
        warning: result.warning || null
    };
}

async function removeOneGroupPlaceholderEmployee(groupId, env = {}) {
    const placeholders = [];
    const result = await walkFirestoreCollection(
        'employees',
        env,
        (doc) => {
            const docId = getFirestoreDocId(doc?.name);
            if (!docId) {
                return;
            }

            const fields = doc?.fields || {};
            const projectId = readFirestoreStringField(fields, 'projectId');
            if (projectId !== groupId) {
                return;
            }

            const isPlaceholder = parseFirestoreBooleanField(fields?.isPlaceholder);
            if (!isPlaceholder) {
                return;
            }

            placeholders.push({
                docId,
                placeholderIndex: readFirestoreIntegerField(fields, 'placeholderIndex') ?? Number.MAX_SAFE_INTEGER
            });
        },
        { pageSize: 300, maxPages: 40 }
    );

    if (placeholders.length === 0) {
        return {
            removed: false,
            removedDocId: null,
            warning: result.warning || null
        };
    }

    placeholders.sort((a, b) => {
        if (a.placeholderIndex !== b.placeholderIndex) {
            return a.placeholderIndex - b.placeholderIndex;
        }
        return String(a.docId || '').localeCompare(String(b.docId || ''));
    });

    const target = placeholders[0];
    const deleted = await deleteFirestoreDocumentByPath(`employees/${target.docId}`, env);

    if (!deleted) {
        return {
            removed: false,
            removedDocId: null,
            warning: result.warning || 'placeholder-delete-failed'
        };
    }

    return {
        removed: true,
        removedDocId: target.docId,
        warning: result.warning || null
    };
}

async function upsertGroupPlaceholderEmployees(groupId, groupName, totalPlaceholders, env = {}) {
    const placeholders = Math.max(0, Math.floor(Number(totalPlaceholders) || 0));
    if (placeholders <= 0) {
        return {
            attempted: 0,
            synced: 0,
            failed: 0
        };
    }

    const normalizedGroupName = String(groupName || `LINE GROUP ${groupId.slice(-6)}`).trim();
    let synced = 0;
    let failed = 0;

    for (let i = 1; i <= placeholders; i += 1) {
        const empId = getGroupPlaceholderEmployeeId(groupId, i);
        const fields = {
            id: { stringValue: empId },
            name: { stringValue: `${normalizedGroupName} สมาชิก ${i}` },
            fullName: { stringValue: `${normalizedGroupName} สมาชิก ${i}` },
            role: { stringValue: 'member' },
            projectId: { stringValue: groupId },
            isPlaceholder: { booleanValue: true },
            placeholderIndex: { integerValue: String(i) },
            updatedAt: { timestampValue: new Date().toISOString() }
        };

        const ok = await patchFirestoreDoc(`employees/${empId}`, fields, env, false);
        if (ok) {
            synced += 1;
        } else {
            failed += 1;
        }
    }

    return {
        attempted: placeholders,
        synced,
        failed
    };
}

async function syncGroupMembersToTeam(groupId, env = {}, options = {}) {
    const normalizedGroupId = String(groupId || '').trim();
    if (!normalizedGroupId) {
        throw new Error('Missing groupId');
    }

    if (!env?.FIREBASE_PROJECT_ID || !env?.FIREBASE_API_KEY) {
        throw new Error('Missing Firestore configuration');
    }

    const { candidates, warnings, sourceStats } = await collectGroupTeamCandidates(normalizedGroupId, env, options);
    const expectedMemberCount = resolveExpectedTeamMemberCount(options?.expectedMemberCount, env);

    let synced = 0;
    let failed = 0;
    for (const candidate of candidates) {
        const ok = await upsertGroupTeamEmployee(normalizedGroupId, candidate, env);
        if (ok) {
            synced += 1;
        } else {
            failed += 1;
        }
    }

    let placeholderResult = { attempted: 0, synced: 0, failed: 0 };
    const discoveredMembers = candidates.length;

    if (expectedMemberCount !== null) {
        const clearResult = await clearGroupPlaceholderEmployees(normalizedGroupId, env);
        if (clearResult.warning) {
            warnings.push(`employees-clear-placeholder:${clearResult.warning}`);
        }

        const placeholdersNeeded = Math.max(0, expectedMemberCount - discoveredMembers);
        placeholderResult = await upsertGroupPlaceholderEmployees(
            normalizedGroupId,
            options?.groupName,
            placeholdersNeeded,
            env
        );
    }

    const totalAttempted = candidates.length + placeholderResult.attempted;
    const totalSynced = synced + placeholderResult.synced;
    const totalFailed = failed + placeholderResult.failed;

    return {
        groupId: normalizedGroupId,
        attempted: totalAttempted,
        synced: totalSynced,
        failed: totalFailed,
        discoveredMembers,
        expectedMemberCount,
        placeholders: placeholderResult,
        sourceStats,
        warnings
    };
}

export {
    parseFirestoreBooleanField,
    getFirestoreDocId,
    walkFirestoreCollection,
    collectMemberIdsFromGroupMessages,
    collectMemberIdsFromGroupUsers,
    collectMemberIdsFromProjectMembers,
    collectMemberIdsFromInternalSources,
    mirrorMemberIdsToKv,
    recountMemberCountFromFirestoreSources,
    isGenericLineDisplayName,
    mergeGroupTeamCandidate,
    collectGroupTeamCandidates,
    upsertGroupTeamEmployee,
    getGroupPlaceholderEmployeeId,
    resolveExpectedTeamMemberCount,
    clearGroupPlaceholderEmployees,
    removeOneGroupPlaceholderEmployee,
    upsertGroupPlaceholderEmployees,
    syncGroupMembersToTeam
};
