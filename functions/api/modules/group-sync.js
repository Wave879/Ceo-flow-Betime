// ✅ Group sync — group type/project identity, full group sync, refreshKnownGroupIdentity

import { getFSBase, fsGetDoc, patchFirestoreDoc } from './firestore.js';
import { readFirestoreStringField, readFirestoreIntegerField } from './firestore.js';
import { normalizeKnownGroupInGroup } from './data-normalizer.js';
import { lineFetchJson, fetchLineGroupMemberCount, isLineNotInGroupError } from './line-api.js';
import {
    GROUP_TYPE_VALUES,
    normalizeGroupTypeValue,
    rememberKnownGroup,
    readKnownGroupFromSnapshot,
    isGenericKnownGroupName,
    rememberGroupMember
} from './known-groups.js';
import {
    resolveHistoricalMemberCountFloor,
    getForcedMinimumMemberCount
} from './data-normalizer.js';
import {
    collectMemberIdsFromInternalSources,
    mirrorMemberIdsToKv,
    syncGroupMembersToTeam
} from './member-sync.js';

async function readProjectIdentityFromFirestore(groupId, env = {}) {
    const normalizedGroupId = String(groupId || '').trim();
    if (!normalizedGroupId || !env?.FIREBASE_PROJECT_ID || !env?.FIREBASE_API_KEY) {
        return null;
    }

    try {
        const fields = await fsGetDoc('projects', normalizedGroupId, env);
        if (!fields) {
            return null;
        }

        const candidates = [
            readFirestoreStringField(fields, 'name'),
            readFirestoreStringField(fields, 'groupName'),
            readFirestoreStringField(fields, 'webProjectName')
        ].filter(Boolean);

        const name = candidates.find((item) => !isGenericKnownGroupName(item)) || candidates[0] || null;
        const pictureUrl = readFirestoreStringField(fields, 'pictureUrl') || null;
        const memberCount = readFirestoreIntegerField(fields, 'memberCount');
        const groupType = normalizeGroupTypeValue(readFirestoreStringField(fields, 'groupType'));

        if (!name && !pictureUrl && memberCount === null && !groupType) {
            return null;
        }

        return { name, pictureUrl, memberCount, groupType };
    } catch (err) {
        console.error(`Read project identity fallback failed (${normalizedGroupId}):`, err);
        return null;
    }
}

async function readProjectMemberCountFromMembersCollection(groupId, env = {}) {
    const normalizedGroupId = String(groupId || '').trim();
    if (!normalizedGroupId || !env?.FIREBASE_PROJECT_ID || !env?.FIREBASE_API_KEY) {
        return null;
    }

    let total = 0;
    let nextPageToken = null;
    let guard = 0;

    try {
        do {
            let url = `${getFSBase(env)}/projects/${normalizedGroupId}/members?pageSize=200&key=${env.FIREBASE_API_KEY}`;
            if (nextPageToken) {
                url += `&pageToken=${encodeURIComponent(nextPageToken)}`;
            }

            const res = await fetch(url);
            if (!res.ok) {
                const errText = await res.text();
                console.error(`Read members subcollection failed (${normalizedGroupId}):`, res.status, errText);
                return null;
            }

            const data = await res.json();
            const docs = Array.isArray(data?.documents) ? data.documents : [];
            total += docs.length;

            nextPageToken = data?.nextPageToken || null;
            guard += 1;
        } while (nextPageToken && guard < 30);

        if (nextPageToken) {
            console.error(`Members subcollection count truncated (${normalizedGroupId}): pagination guard reached`);
        }

        return total;
    } catch (err) {
        console.error(`Read members subcollection count exception (${normalizedGroupId}):`, err);
        return null;
    }
}

async function refreshKnownGroupIdentity(groupId, env = {}, current = {}) {
    const normalizedGroupId = String(groupId || '').trim();
    if (!normalizedGroupId) {
        return null;
    }

    const fallbackName = `LINE GROUP ${normalizedGroupId.slice(-6)}`;
    let resolvedName = String(current?.name || '').trim();
    let resolvedPictureUrl = current?.pictureUrl || null;
    const currentInGroup = normalizeKnownGroupInGroup(current?.inGroup);
    let resolvedInGroup = typeof currentInGroup === 'boolean' ? currentInGroup : true;
    const currentMemberCount = Number(current?.memberCount ?? current?.members);
    let resolvedMemberCount = Number.isFinite(currentMemberCount) && currentMemberCount >= 0
        ? Math.floor(currentMemberCount)
        : null;
    let resolvedGroupType = normalizeGroupTypeValue(current?.groupType ?? current?.type);
    let source = 'known-groups';
    let warning = null;

    const shouldLookupLine = Boolean(env?.LINE_TOKEN) &&
        (isGenericKnownGroupName(resolvedName) || !resolvedPictureUrl);

    if (shouldLookupLine) {
        const summaryRes = await lineFetchJson(
            `https://api.line.me/v2/bot/group/${normalizedGroupId}/summary`,
            env,
            1
        );

        if (summaryRes.ok) {
            source = 'line-summary';
            resolvedName = String(summaryRes.data?.groupName || resolvedName || fallbackName);
            resolvedPictureUrl = summaryRes.data?.pictureUrl || resolvedPictureUrl || null;
            resolvedInGroup = true;
        } else {
            warning = summaryRes.error;
            if (isLineNotInGroupError(summaryRes.error)) {
                resolvedInGroup = false;
            }
        }
    }

    const shouldLookupFirestoreProject = Boolean(env?.FIREBASE_PROJECT_ID && env?.FIREBASE_API_KEY) &&
        (isGenericKnownGroupName(resolvedName) || !resolvedPictureUrl || resolvedMemberCount === null || !resolvedGroupType);

    if (shouldLookupFirestoreProject) {
        const fallbackProject = await readProjectIdentityFromFirestore(normalizedGroupId, env);
        if (fallbackProject) {
            if (fallbackProject.name) {
                resolvedName = fallbackProject.name;
            }
            if (fallbackProject.pictureUrl && !resolvedPictureUrl) {
                resolvedPictureUrl = fallbackProject.pictureUrl;
            }
            if (fallbackProject.memberCount !== null && fallbackProject.memberCount !== undefined) {
                resolvedMemberCount = fallbackProject.memberCount;
            }
            if (fallbackProject.groupType) {
                resolvedGroupType = fallbackProject.groupType;
            }

            if (source !== 'line-summary') {
                source = 'firestore-project';
            }

            if (!isGenericKnownGroupName(resolvedName)) {
                warning = null;
            }
        }
    }

    if (!resolvedName) {
        resolvedName = fallbackName;
    }

    await rememberKnownGroup(
        normalizedGroupId,
        resolvedName,
        resolvedPictureUrl,
        env,
        resolvedMemberCount,
        resolvedGroupType,
        resolvedInGroup
    );

    return {
        groupId: normalizedGroupId,
        name: resolvedName,
        pictureUrl: resolvedPictureUrl,
        memberCount: resolvedMemberCount,
        groupType: resolvedGroupType,
        inGroup: resolvedInGroup,
        lastSeenAt: new Date().toISOString(),
        source,
        warning
    };
}

async function maybeAttachTaskBackfillResult(result, groupId, env, options = {}, shouldBackfillTasks = true) {
    if (!result || !shouldBackfillTasks || result.taskBackfillResult) {
        return;
    }

    try {
        const { backfillGroupTasksFromStoredMessages } = await import('./task-backfill.js');
        const taskBackfillResult = await backfillGroupTasksFromStoredMessages(groupId, env, {
            maxMessages: options?.taskBackfillMaxMessages,
            maxAgeDays: options?.taskBackfillMaxAgeDays
        });
        result.taskBackfillResult = taskBackfillResult;

        if (Array.isArray(taskBackfillResult?.warnings)) {
            for (const warning of taskBackfillResult.warnings) {
                result.warnings.push(`task-backfill:${warning}`);
            }
        }

        if (Number(taskBackfillResult?.errors || 0) > 0) {
            result.warnings.push(`task-backfill:errors:${taskBackfillResult.errors}`);
        }
    } catch (err) {
        result.warnings.push(`task-backfill:${err?.message || String(err)}`);
    }
}

// ✅ Full Sync Mode (Reusable from Web + LINE)
async function fullGroupSync(groupId, env, options = {}) {
    const fallbackUserId = options?.fallbackUserId || null;
    const shouldBackfillTasks = options?.taskBackfill !== false;
    const taskBackfillMode = String(
        options?.taskBackfillMode
        || env?.LINE_TASK_BACKFILL_MODE
        || 'not-in-group'
    ).trim().toLowerCase();
    const shouldBackfillWhenInGroup = taskBackfillMode === 'always';

    if (!groupId) {
        throw new Error('Missing groupId for full sync');
    }

    if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_API_KEY || !env.LINE_TOKEN) {
        throw new Error('Missing required environment variables for full group sync');
    }

    const result = {
        groupId,
        groupName: `LINE GROUP ${groupId.slice(-6)}`,
        inGroup: true,
        projectSynced: false,
        memberCount: 0,
        membersAttempted: 0,
        membersSynced: 0,
        membersFailed: 0,
        teamSyncResult: null,
        taskBackfillResult: null,
        warnings: []
    };

    // 1️⃣ ดึงชื่อกลุ่ม
    let groupPicture = null;
    let projectFallback = null;
    const summaryRes = await lineFetchJson(`https://api.line.me/v2/bot/group/${groupId}/summary`, env, 2);
    if (summaryRes.ok) {
        result.groupName = summaryRes.data.groupName || result.groupName;
        groupPicture = summaryRes.data.pictureUrl || null;
        result.inGroup = true;
    } else {
        result.warnings.push(`group-summary:${summaryRes.error}`);

        if (isLineNotInGroupError(summaryRes.error)) {
            result.inGroup = false;
            result.warnings.push('group-state:not-in-group');
        }

        projectFallback = await readProjectIdentityFromFirestore(groupId, env);
        if (projectFallback) {
            if (projectFallback.name) {
                result.groupName = projectFallback.name;
            }
            if (projectFallback.pictureUrl) {
                groupPicture = projectFallback.pictureUrl;
            }
        }
    }

    if (!groupPicture) {
        if (!projectFallback) {
            projectFallback = await readProjectIdentityFromFirestore(groupId, env);
        }

        if (projectFallback?.pictureUrl) {
            groupPicture = projectFallback.pictureUrl;
            result.warnings.push('group-picture:fallback-firestore-project');
        } else {
            const knownGroupIdentity = await readKnownGroupFromSnapshot(groupId, env);
            if (knownGroupIdentity?.pictureUrl) {
                groupPicture = knownGroupIdentity.pictureUrl;
                result.warnings.push('group-picture:fallback-known-group');
            }
        }
    }

    if (!result.inGroup) {
        await rememberKnownGroup(
            groupId,
            result.groupName,
            groupPicture,
            env,
            result.memberCount,
            projectFallback?.groupType || null,
            false
        );

        const projectFields = {
            id: { stringValue: groupId },
            name: { stringValue: result.groupName },
            source: { stringValue: 'line-group' },
            inGroup: { booleanValue: false },
            updatedAt: { timestampValue: new Date().toISOString() }
        };
        if (groupPicture) {
            projectFields.pictureUrl = { stringValue: groupPicture };
        }

        const projectSynced = await patchFirestoreDoc(`projects/${groupId}`, projectFields, env, false);
        result.projectSynced = projectSynced;
        if (!projectSynced) {
            result.warnings.push('firestore-project-write-failed');
        }

        await maybeAttachTaskBackfillResult(result, groupId, env, options, shouldBackfillTasks);

        return result;
    }

    // 2️⃣ ดึงสมาชิกทั้งหมด
    let next = null;
    const memberSet = new Set();
    let pageGuard = 0;
    let membersApiUnavailable = false;

    do {
        const membersUrl = next
            ? `https://api.line.me/v2/bot/group/${groupId}/members/ids?start=${next}`
            : `https://api.line.me/v2/bot/group/${groupId}/members/ids`;

        const membersRes = await lineFetchJson(membersUrl, env, 1);
        if (!membersRes.ok) {
            membersApiUnavailable = true;
            result.warnings.push(`group-members:${membersRes.error}`);
            if (isLineNotInGroupError(membersRes.error)) {
                result.inGroup = false;
                result.warnings.push('group-state:not-in-group');
            }
            break;
        }

        const membersData = membersRes.data || {};
        const memberIds = membersData.memberIds || [];
        next = membersData.next || null;
        pageGuard += 1;

        for (const userId of memberIds) {
            if (userId) {
                memberSet.add(userId);
            }
        }
    } while (next && pageGuard < 50);

    if (next) {
        result.warnings.push('group-members:pagination-limit-reached');
    }

    if (memberSet.size === 0 && fallbackUserId) {
        memberSet.add(fallbackUserId);
        result.warnings.push('group-members:fallback-to-command-user');
    }

    const memberIds = [...memberSet];
    let resolvedMemberCount = memberIds.length;
    let knownGroupFallback = null;
    if (result.inGroup && (membersApiUnavailable || resolvedMemberCount <= 1)) {
        const lineCountRes = await fetchLineGroupMemberCount(groupId, env);
        if (lineCountRes.count !== null && lineCountRes.count > resolvedMemberCount) {
            resolvedMemberCount = lineCountRes.count;
            result.warnings.push(`group-members:fallback-line-count:${lineCountRes.count}`);
        } else if (lineCountRes.error) {
            result.warnings.push(`group-member-count:${lineCountRes.error}`);
            if (isLineNotInGroupError(lineCountRes.error)) {
                result.inGroup = false;
                result.warnings.push('group-state:not-in-group');
            }
        }
    }

    if (resolvedMemberCount === 0) {
        if (!projectFallback) {
            projectFallback = await readProjectIdentityFromFirestore(groupId, env);
        }

        if (projectFallback?.memberCount !== null && projectFallback?.memberCount !== undefined) {
            resolvedMemberCount = Math.max(resolvedMemberCount, projectFallback.memberCount);
        }

        if (resolvedMemberCount === 0) {
            const membersCollectionCount = await readProjectMemberCountFromMembersCollection(groupId, env);
            if (membersCollectionCount !== null) {
                resolvedMemberCount = Math.max(resolvedMemberCount, membersCollectionCount);
            }
        }

        if (resolvedMemberCount === 0) {
            const internalSources = await collectMemberIdsFromInternalSources(groupId, env);
            const internalCount = internalSources.ids.size;
            if (internalCount > 0) {
                resolvedMemberCount = Math.max(resolvedMemberCount, internalCount);
                result.warnings.push(`group-members:fallback-internal-count:${internalCount}`);
                await mirrorMemberIdsToKv(groupId, internalSources.ids, env);
            }
        }

        if (resolvedMemberCount === 0) {
            knownGroupFallback = await readKnownGroupFromSnapshot(groupId, env);
            if (knownGroupFallback?.memberCount !== null && knownGroupFallback?.memberCount !== undefined) {
                resolvedMemberCount = Math.max(resolvedMemberCount, knownGroupFallback.memberCount);
                result.warnings.push(`group-members:fallback-known-group-count:${knownGroupFallback.memberCount}`);
            }
        }

        if (resolvedMemberCount > 0) {
            result.warnings.push(`group-members:fallback-firestore-count:${resolvedMemberCount}`);
        } else {
            result.warnings.push('group-members:fallback-empty');
        }
    }

    if (membersApiUnavailable) {
        if (!projectFallback) {
            projectFallback = await readProjectIdentityFromFirestore(groupId, env);
        }
        if (!knownGroupFallback) {
            knownGroupFallback = await readKnownGroupFromSnapshot(groupId, env);
        }

        const historicalFloor = resolveHistoricalMemberCountFloor(
            projectFallback?.memberCount,
            knownGroupFallback?.memberCount
        );

        if (historicalFloor !== null && historicalFloor > resolvedMemberCount) {
            resolvedMemberCount = historicalFloor;
            result.warnings.push(`group-members:fallback-historical-count:${historicalFloor}`);
        }
    }

    if (resolvedMemberCount === 0) {
        const forcedMin = getForcedMinimumMemberCount(env);
        if (forcedMin > 0) {
            resolvedMemberCount = forcedMin;
            result.warnings.push(`group-members:fallback-forced-min:${forcedMin}`);
        }
    }

    result.memberCount = resolvedMemberCount;
    result.membersAttempted = memberIds.length;

    if (!result.inGroup) {
        await rememberKnownGroup(
            groupId,
            result.groupName,
            groupPicture,
            env,
            result.memberCount,
            projectFallback?.groupType || null,
            false
        );

        const projectSynced = await patchFirestoreDoc(`projects/${groupId}`, {
            id: { stringValue: groupId },
            name: { stringValue: result.groupName },
            source: { stringValue: 'line-group' },
            inGroup: { booleanValue: false },
            updatedAt: { timestampValue: new Date().toISOString() }
        }, env, false);
        result.projectSynced = projectSynced;
        if (!projectSynced) {
            result.warnings.push('firestore-project-write-failed');
        }

        await maybeAttachTaskBackfillResult(result, groupId, env, options, shouldBackfillTasks);

        return result;
    }

    await rememberKnownGroup(
        groupId,
        result.groupName,
        groupPicture,
        env,
        result.memberCount,
        projectFallback?.groupType || null,
        true
    );

    // 3️⃣ Upsert Project (ไม่ใช้ exists=false เพื่อให้ update ได้)
    const projectFields = {
        id: { stringValue: groupId },
        name: { stringValue: result.groupName },
        source: { stringValue: 'line-group' },
        inGroup: { booleanValue: true },
        memberCount: { integerValue: String(result.memberCount) },
        updatedAt: { timestampValue: new Date().toISOString() }
    };
    if (groupPicture) {
        projectFields.pictureUrl = { stringValue: groupPicture };
    }
    if (projectFallback?.groupType) {
        projectFields.groupType = { stringValue: projectFallback.groupType };
    }

    const projectSynced = await patchFirestoreDoc(`projects/${groupId}`, projectFields, env, false);
    result.projectSynced = projectSynced;
    if (!projectSynced) {
        result.warnings.push('firestore-project-write-failed');
    }

    for (const userId of memberIds) {
        await rememberGroupMember(groupId, userId, env);

        let profile = null;

        // ใช้ endpoint สมาชิกในกลุ่มก่อน เพื่อรองรับผู้ใช้ที่ยังไม่เป็นเพื่อนกับบอท
        const groupProfileRes = await lineFetchJson(
            `https://api.line.me/v2/bot/group/${groupId}/member/${userId}`,
            env,
            1
        );
        if (groupProfileRes.ok) {
            profile = groupProfileRes.data;
        } else {
            const directProfileRes = await lineFetchJson(`https://api.line.me/v2/bot/profile/${userId}`, env, 0);
            if (directProfileRes.ok) {
                profile = directProfileRes.data;
            } else {
                result.warnings.push(`profile:${userId}:${directProfileRes.error}`);
            }
        }

        const displayName = profile?.displayName || `LINE-${String(userId).slice(-6)}`;
        const photoUrl = profile?.pictureUrl || '';

        const { registerGroupMemberIdentity } = await import('./project-member.js');
        const saved = await registerGroupMemberIdentity(
            groupId,
            userId,
            { displayName, photoUrl },
            env,
            {
                source: 'line-members-sync',
                skipPlaceholderReconcile: true
            }
        );

        if (saved.groupUserOk || saved.employeeOk || saved.memberOk || saved.memberLinkOk) {
            result.membersSynced += 1;
        } else {
            result.membersFailed += 1;
        }
    }

    try {
        const teamSyncResult = await syncGroupMembersToTeam(groupId, env, {
            seedLineUserIds: memberIds,
            fallbackUserId,
            expectedMemberCount: result.memberCount,
            groupName: result.groupName
        });
        result.teamSyncResult = teamSyncResult;
    } catch (err) {
        result.warnings.push(`team-sync:${err?.message || String(err)}`);
    }

    await maybeAttachTaskBackfillResult(
        result,
        groupId,
        env,
        options,
        shouldBackfillTasks && shouldBackfillWhenInGroup
    );

    // 4️⃣ TODO: ลบสมาชิกที่ออกจากกลุ่ม (จะเพิ่มขั้นตอนถัดไป)
    return result;
}

export {
    readProjectIdentityFromFirestore,
    readProjectMemberCountFromMembersCollection,
    refreshKnownGroupIdentity,
    maybeAttachTaskBackfillResult,
    fullGroupSync
};
