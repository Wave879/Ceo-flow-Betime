import { fullGroupSync, getKnownGroupsSnapshotWithSource } from './webhook.js';

function normalizeGroupIds(groupIds) {
    if (!Array.isArray(groupIds)) {
        return [];
    }

    return [...new Set(groupIds.filter((id) => typeof id === 'string' && id.trim()))];
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
            const pageIds = normalizeGroupIds(data.groupIds || []);
            collected.push(...pageIds);

            next = data.next || data.continuationToken || null;
            page += 1;

            if (!next) {
                const ids = normalizeGroupIds(collected);
                if (ids.length > 0) {
                    return ids;
                }
                break;
            }
        }
    }

    throw new Error(lastError);
}

// API สำหรับ sync ทุกกลุ่มที่ bot เข้าร่วม
export async function onRequest({ request, env }) {
    if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    try {
        if (!env.LINE_TOKEN) {
            return new Response(JSON.stringify({ error: 'Missing LINE_TOKEN' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        let body = {};
        try {
            body = await request.json();
        } catch {
            body = {};
        }

        let source = 'request';
        let groupIds = normalizeGroupIds(body.groupIds || []);
        let listError = null;

        if (groupIds.length === 0) {
            source = 'known-groups';
            try {
                const snapshot = await getKnownGroupsSnapshotWithSource(env);
                groupIds = normalizeGroupIds(
                    (snapshot.groups || [])
                        .filter((g) => g?.inGroup !== false)
                        .map((g) => g.groupId || g.id)
                );
                if (snapshot.source) {
                    source = snapshot.source;
                }
            } catch (err) {
                listError = err;
            }
        }

        if (groupIds.length === 0) {
            source = 'line-api';
            try {
                groupIds = await fetchGroupIdsFromLine(env);
            } catch (err) {
                listError = err;
            }
        }

        if (groupIds.length === 0) {
            return new Response(JSON.stringify({
                error: 'Failed to get groups',
                detail: listError?.message || 'No groupIds provided and LINE API returned empty result'
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const results = [];
        let syncedSuccess = 0;
        let syncedFailed = 0;
        let teamSynced = 0;
        let teamAttempted = 0;

        // Sync แต่ละกลุ่ม
        for (const groupId of groupIds) {
            try {
                const syncResult = await fullGroupSync(groupId, env);
                results.push({ groupId, status: 'success', syncResult });
                syncedSuccess += 1;
                teamSynced += Number(syncResult?.teamSyncResult?.synced || 0);
                teamAttempted += Number(syncResult?.teamSyncResult?.attempted || 0);
            } catch (e) {
                console.error('Sync failed for group:', groupId, e);
                results.push({ groupId, status: 'failed', error: e.message });
                syncedFailed += 1;
            }
        }

        return new Response(JSON.stringify({
            success: syncedFailed === 0,
            synced: results.length,
            syncedSuccess,
            syncedFailed,
            teamSynced,
            teamAttempted,
            source,
            results
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (err) {
        console.error('Sync all error:', err);
        return new Response(JSON.stringify({ error: 'Internal error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
