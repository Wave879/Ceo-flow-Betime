import { deleteKnownGroupData } from './webhook.js';

export async function onRequest({ request, env }) {
    if (request.method !== 'POST' && request.method !== 'DELETE') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    let groupId = '';

    try {
        const url = new URL(request.url);
        groupId = String(url.searchParams.get('groupId') || '').trim();
    } catch {
        groupId = '';
    }

    if (!groupId) {
        try {
            const body = await request.json();
            groupId = String(body?.groupId || '').trim();
        } catch {
            groupId = '';
        }
    }

    if (!groupId) {
        return new Response(JSON.stringify({ error: 'Missing groupId' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const result = await deleteKnownGroupData(groupId, env);
        return new Response(JSON.stringify({ success: true, result }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (err) {
        console.error('Delete group error:', err);
        return new Response(JSON.stringify({
            error: 'DELETE_GROUP_FAILED',
            detail: err?.message || 'Internal error'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
