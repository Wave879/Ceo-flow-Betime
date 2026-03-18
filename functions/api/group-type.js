import { setKnownGroupType } from './webhook.js';

const GROUP_TYPE_VALUES = new Set(['unset', 'betimes', 'outsource', 'external']);

function normalizeGroupType(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (GROUP_TYPE_VALUES.has(normalized)) {
        return normalized;
    }
    return 'unset';
}

export async function onRequest({ request, env }) {
    if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    let body = {};
    try {
        body = await request.json();
    } catch {
        body = {};
    }

    const groupId = String(body?.groupId || '').trim();
    if (!groupId) {
        return new Response(JSON.stringify({ error: 'Missing groupId' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const groupType = normalizeGroupType(body?.groupType ?? body?.type);

    try {
        const result = await setKnownGroupType(groupId, groupType, env);
        return new Response(JSON.stringify({ success: true, ...result }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (err) {
        console.error('Set group type error:', err);
        return new Response(JSON.stringify({
            error: 'SET_GROUP_TYPE_FAILED',
            detail: err?.message || 'Internal error'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
