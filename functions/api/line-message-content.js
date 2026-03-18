function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}

function sanitizeFileName(name = '') {
    const fallback = 'line-message-content';
    const normalized = String(name || '').trim();
    if (!normalized) {
        return fallback;
    }

    return normalized
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/[\x00-\x1F\x7F]/g, '_')
        .slice(0, 160) || fallback;
}

export async function onRequest({ request, env }) {
    if (request.method !== 'GET') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    if (!env?.LINE_TOKEN) {
        return jsonResponse({ error: 'Missing LINE_TOKEN' }, 500);
    }

    const url = new URL(request.url);
    const messageId = String(url.searchParams.get('messageId') || '').trim();

    if (!messageId) {
        return jsonResponse({ error: 'Missing messageId' }, 400);
    }

    try {
        const lineRes = await fetch(
            `https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`,
            {
                headers: {
                    Authorization: `Bearer ${env.LINE_TOKEN}`
                }
            }
        );

        if (!lineRes.ok) {
            const detail = await lineRes.text();
            return jsonResponse({
                error: 'LINE_MESSAGE_CONTENT_FETCH_FAILED',
                status: lineRes.status,
                detail: detail || 'Unable to fetch LINE message content'
            }, lineRes.status);
        }

        const contentType = lineRes.headers.get('content-type') || 'application/octet-stream';
        const contentLength = lineRes.headers.get('content-length');
        const requestedName = url.searchParams.get('fileName');
        const safeFileName = sanitizeFileName(requestedName || `line-${messageId}`);
        const forceDownload = String(url.searchParams.get('download') || '').trim() === '1';

        const headers = new Headers();
        headers.set('Content-Type', contentType);
        headers.set('Cache-Control', 'private, max-age=300');
        headers.set(
            'Content-Disposition',
            `${forceDownload ? 'attachment' : 'inline'}; filename="${safeFileName}"`
        );

        if (contentLength) {
            headers.set('Content-Length', contentLength);
        }

        return new Response(lineRes.body, {
            status: 200,
            headers
        });
    } catch (err) {
        console.error('Fetch LINE message content error:', err);
        return jsonResponse({
            error: 'LINE_MESSAGE_CONTENT_FETCH_EXCEPTION',
            detail: err?.message || 'Internal error'
        }, 500);
    }
}
