import { recountMemberCountFromFirestoreSources } from './webhook.js';

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

    try {
        const recountResult = await recountMemberCountFromFirestoreSources(groupId, env);
        return new Response(JSON.stringify({ success: true, recountResult }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (err) {
        console.error('Recount group members error:', err);
        return new Response(JSON.stringify({
            error: 'RECOUNT_GROUP_MEMBERS_FAILED',
            detail: err?.message || 'Internal error'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
