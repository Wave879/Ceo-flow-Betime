import { getKnownGroupsSnapshotWithSource, refreshKnownGroupIdentity } from './webhook.js';

const GROUP_TYPE_VALUES = new Set(['unset', 'betimes', 'outsource', 'external']);

function normalizeMemberCount(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return null;
    }
    return Math.floor(parsed);
}

function normalizeGroupType(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
        return null;
    }

    if (GROUP_TYPE_VALUES.has(normalized)) {
        return normalized;
    }

    return null;
}

function normalizeInGroup(value) {
    if (typeof value === 'boolean') {
        return value;
    }

    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
        return true;
    }

    if (normalized === 'false' || normalized === '0' || normalized === 'no') {
        return false;
    }

    return true;
}

function normalizeGroups(groups) {
    if (!Array.isArray(groups)) {
        return [];
    }

    const out = [];
    const seen = new Set();

    for (const raw of groups) {
        if (!normalizeInGroup(raw?.inGroup)) {
            continue;
        }

        const groupId = String(raw?.groupId || raw?.id || '').trim();
        if (!groupId || seen.has(groupId)) {
            continue;
        }
        seen.add(groupId);
        out.push({
            groupId,
            name: raw?.name || `LINE GROUP ${groupId.slice(-6)}`,
            pictureUrl: raw?.pictureUrl || null,
            groupType: normalizeGroupType(raw?.groupType ?? raw?.type),
            memberCount: normalizeMemberCount(raw?.memberCount ?? raw?.members),
            lastSeenAt: raw?.lastSeenAt || null
        });
    }

    return out;
}

async function fetchGroupIdsFromLine(env) {
    const candidates = [
        'https://api.line.me/v2/bot/group/ids',
        'https://api.line.me/v2/bot/ids/groups'
    ];

    let lastError = 'Unable to list LINE groups';

    for (const baseUrl of candidates) {
        const collected = [];
        let next = null;
        let page = 0;

        while (page < 50) {
            const url = next
                ? `${baseUrl}?start=${encodeURIComponent(next)}`
                : baseUrl;

            const res = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${env.LINE_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!res.ok) {
                const errText = await res.text();
                lastError = `${baseUrl} -> ${res.status}: ${errText || 'unknown error'}`;
                break;
            }

            const data = await res.json();
            const pageIds = Array.isArray(data.groupIds) ? data.groupIds : [];
            collected.push(...pageIds.filter((id) => typeof id === 'string' && id.trim()));

            next = data.next || data.continuationToken || null;
            page += 1;
            if (!next) {
                return [...new Set(collected)];
            }
        }
    }

    throw new Error(lastError);
}

// API สำหรับดึงรายการกลุ่มทั้งหมดที่ bot เข้าร่วม
export async function onRequest({ request, env }) {
    if (request.method !== 'GET') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    try {
        const snapshot = await getKnownGroupsSnapshotWithSource(env);
        const cachedGroups = normalizeGroups(snapshot.groups || []);
        if (cachedGroups.length > 0) {
            const enrichedGroups = [];
            let refreshFromLineCount = 0;

            for (const group of cachedGroups) {
                try {
                    const resolved = await refreshKnownGroupIdentity(group.groupId, env, group);
                    if (resolved) {
                        if (resolved.source === 'line-summary') {
                            refreshFromLineCount += 1;
                        }
                        enrichedGroups.push({
                            groupId: resolved.groupId,
                            name: resolved.name,
                            pictureUrl: resolved.pictureUrl,
                            inGroup: normalizeInGroup(resolved.inGroup),
                            groupType: normalizeGroupType(resolved.groupType ?? group.groupType),
                            memberCount: normalizeMemberCount(resolved.memberCount ?? group.memberCount),
                            lastSeenAt: resolved.lastSeenAt || group.lastSeenAt || null
                        });
                        continue;
                    }
                } catch (err) {
                    console.error(`Refresh group summary failed (${group.groupId}):`, err);
                }

                enrichedGroups.push(group);
            }

            const source = refreshFromLineCount > 0
                ? `${snapshot.source || 'known-groups'}+line-summary`
                : (snapshot.source || 'known-groups');

            return new Response(JSON.stringify({
                groups: normalizeGroups(enrichedGroups),
                source,
                store: snapshot.store || null
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (!env.LINE_TOKEN) {
            return new Response(JSON.stringify({
                groups: [],
                source: snapshot.source || 'empty',
                store: snapshot.store || null,
                warning: 'Missing LINE_TOKEN'
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        let groupIds = [];
        let warning = null;

        try {
            groupIds = await fetchGroupIdsFromLine(env);
        } catch (err) {
            warning = err?.message || 'Failed to get groups from LINE';
        }

        const groups = [];
        for (const groupId of groupIds) {
            try {
                const resolved = await refreshKnownGroupIdentity(groupId, env, { groupId });
                if (resolved) {
                    groups.push(resolved);
                }
            } catch (err) {
                console.error(`Resolve group from LINE failed (${groupId}):`, err);
                groups.push({
                    groupId,
                    name: `LINE GROUP ${groupId.slice(-6)}`,
                    pictureUrl: null
                });
            }
        }

        return new Response(JSON.stringify({ groups: normalizeGroups(groups), source: 'line-api', warning }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (err) {
        console.error('List groups error:', err);
        return new Response(JSON.stringify({ groups: [], source: 'error', warning: err?.message || 'Internal error' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
