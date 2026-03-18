import { fullGroupSync } from './webhook.js';

export async function onRequest({ request, env }) {
    if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    try {
        const body = await request.json();
        const { groupId } = body || {};

        if (!groupId) {
            return new Response(JSON.stringify({ error: 'Missing groupId' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const syncResult = await fullGroupSync(groupId, env);

        return new Response(JSON.stringify({
            success: true,
            syncResult,
            teamSyncResult: syncResult?.teamSyncResult || null
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (err) {
        console.error('Web sync error:', err);
        return new Response(JSON.stringify({ error: 'Sync failed' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

