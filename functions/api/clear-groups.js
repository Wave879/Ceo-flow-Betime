import { clearKnownGroupsData } from './webhook.js';

const REQUIRED_CONFIRM_TEXT = 'ลบข้อมูลกลุ่มทั้งหมด';

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

    const confirmText = String(body?.confirmText || '').trim();
    if (confirmText !== REQUIRED_CONFIRM_TEXT) {
        return new Response(JSON.stringify({
            error: 'CONFIRMATION_MISMATCH',
            requiredText: REQUIRED_CONFIRM_TEXT
        }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const result = await clearKnownGroupsData(env);
        return new Response(JSON.stringify({ success: true, result }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (err) {
        console.error('Clear groups error:', err);
        return new Response(JSON.stringify({
            error: 'CLEAR_GROUPS_FAILED',
            detail: err?.message || 'Internal error'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
