// ✅ Project member — ensureProjectRecord, registerGroupMemberIdentity, saveGroupUser, saveMentionedUsers

import { fsString, fsTimestampISO, fsGetDoc, patchFirestoreDoc } from './firestore.js';
import { isLikelyLineUserId, getEmployeeDocIdFromLineUserId, fetchLineProfile } from './line-api.js';
import { rememberGroupMember, getGroupMemberLinkDocId } from './known-groups.js';
import { removeOneGroupPlaceholderEmployee } from './member-sync.js';

async function ensureProjectRecord(projectId, env, explicitName = null, pictureUrl = '') {
    const fields = {
        id: fsString(projectId),
        source: fsString('line-group'),
        updatedAt: fsTimestampISO()
    };

    if (explicitName) {
        fields.name = fsString(explicitName);
    }

    if (pictureUrl) {
        fields.pictureUrl = fsString(pictureUrl);
    }

    await patchFirestoreDoc(`projects/${projectId}`, fields, env, false);
}

async function registerGroupMemberIdentity(projectId, lineUserId, identity = {}, env = {}, options = {}) {
    const normalizedProjectId = String(projectId || '').trim();
    const normalizedLineUserId = String(lineUserId || '').trim();
    if (!normalizedProjectId || !isLikelyLineUserId(normalizedLineUserId)) {
        return {
            groupUserOk: false,
            employeeOk: false,
            memberOk: false,
            memberLinkOk: false,
            isNewGroupMember: false,
            placeholderReduced: false,
            placeholderWarning: null,
            displayName: '',
            photoUrl: ''
        };
    }

    const displayName = String(identity?.displayName || '').trim() || `LINE-${normalizedLineUserId.slice(-6)}`;
    const photoUrl = String(identity?.photoUrl || identity?.pictureUrl || '').trim();
    const source = String(options?.source || 'webhook').trim() || 'webhook';
    const nowIso = new Date().toISOString();
    const empId = getEmployeeDocIdFromLineUserId(normalizedLineUserId);
    const memberLinkDocId = getGroupMemberLinkDocId(normalizedProjectId, normalizedLineUserId);

    let isNewGroupMember = false;
    if (memberLinkDocId) {
        const existingMemberLink = await fsGetDoc('groupMemberLinks', memberLinkDocId, env).catch(() => null);
        isNewGroupMember = !existingMemberLink;
    }

    const groupUserFields = {
        userId: fsString(normalizedLineUserId),
        displayName: fsString(displayName),
        projectGroup: fsString(normalizedProjectId),
        source: fsString(source),
        lastSeen: { timestampValue: nowIso },
        updatedAt: { timestampValue: nowIso }
    };
    if (isNewGroupMember) {
        groupUserFields.firstSeen = { timestampValue: nowIso };
    }

    const groupUserOk = await patchFirestoreDoc(`groupUsers/${normalizedLineUserId}`, groupUserFields, env, false);

    const memberLinkFields = {
        id: fsString(memberLinkDocId),
        groupId: fsString(normalizedProjectId),
        lineUserId: fsString(normalizedLineUserId),
        displayName: fsString(displayName),
        source: fsString(source),
        lastSeenAt: { timestampValue: nowIso },
        updatedAt: { timestampValue: nowIso }
    };
    if (isNewGroupMember) {
        memberLinkFields.firstSeenAt = { timestampValue: nowIso };
    }

    const memberLinkOk = memberLinkDocId
        ? await patchFirestoreDoc(`groupMemberLinks/${memberLinkDocId}`, memberLinkFields, env, false)
        : false;

    const employeeFields = {
        id: { stringValue: empId },
        lineUserId: { stringValue: normalizedLineUserId },
        name: { stringValue: displayName },
        fullName: { stringValue: displayName },
        role: { stringValue: 'member' },
        projectId: { stringValue: normalizedProjectId },
        isPlaceholder: { booleanValue: false },
        updatedAt: { timestampValue: nowIso }
    };
    if (photoUrl) {
        employeeFields.photoUrl = { stringValue: photoUrl };
    }

    const employeeOk = await patchFirestoreDoc(`employees/${empId}`, employeeFields, env, false);

    const memberFields = {
        employeeId: { stringValue: empId },
        lineUserId: { stringValue: normalizedLineUserId },
        fullName: { stringValue: displayName },
        role: { stringValue: 'member' },
        joinedAt: { timestampValue: nowIso },
        updatedAt: { timestampValue: nowIso }
    };
    if (photoUrl) {
        memberFields.photoUrl = { stringValue: photoUrl };
    }

    const memberOk = await patchFirestoreDoc(`projects/${normalizedProjectId}/members/${empId}`, memberFields, env, false);

    await rememberGroupMember(normalizedProjectId, normalizedLineUserId, env);

    let placeholderReduced = false;
    let placeholderWarning = null;
    if (!options?.skipPlaceholderReconcile && isNewGroupMember) {
        const placeholderResult = await removeOneGroupPlaceholderEmployee(normalizedProjectId, env);
        placeholderReduced = Boolean(placeholderResult?.removed);
        placeholderWarning = placeholderResult?.warning || null;
    }

    return {
        groupUserOk,
        employeeOk,
        memberOk,
        memberLinkOk,
        isNewGroupMember,
        placeholderReduced,
        placeholderWarning,
        displayName,
        photoUrl
    };
}

async function saveGroupUser(projectId, lineUserId, env, options = {}) {
    if (!projectId || !lineUserId) {
        return;
    }

    const profile = await fetchLineProfile(lineUserId, projectId, env);
    const displayName = profile?.displayName || `LINE-${lineUserId.slice(-6)}`;
    const photoUrl = profile?.pictureUrl || '';

    const saved = await registerGroupMemberIdentity(
        projectId,
        lineUserId,
        { displayName, photoUrl },
        env,
        options
    );

    if (saved?.placeholderWarning) {
        console.error(`Placeholder reconcile warning (${projectId}/${lineUserId}):`, saved.placeholderWarning);
    }

    if (!saved.groupUserOk && !saved.employeeOk && !saved.memberOk && !saved.memberLinkOk) {
        throw new Error(`Unable to persist user data for ${lineUserId}`);
    }
}

async function saveMentionedUsers(projectId, mentions, env, options = {}) {
    if (!Array.isArray(mentions) || mentions.length === 0) {
        return;
    }

    for (const mention of mentions) {
        const mentionedUserId = mention?.userId;
        if (!mentionedUserId) {
            continue;
        }
        await saveGroupUser(projectId, mentionedUserId, env, options);
    }
}

export {
    ensureProjectRecord,
    registerGroupMemberIdentity,
    saveGroupUser,
    saveMentionedUsers
};
