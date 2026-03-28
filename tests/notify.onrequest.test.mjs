import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/notify.js';

function createJsonResponse(status, payload) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' }
    });
}

test('rejects unauthorized POST broadcast when NOTIFY_CRON_SECRET is set', async () => {
    const originalFetch = global.fetch;
    const fetchCalls = [];
    global.fetch = async (...args) => {
        fetchCalls.push(args);
        return createJsonResponse(200, { ok: true });
    };

    try {
        const request = new Request('https://example.test/api/notify', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ taskName: 'Demo task' })
        });

        const response = await onRequest({
            request,
            env: {
                NOTIFY_CRON_SECRET: 'top-secret',
                LINE_TOKEN: 'line-token'
            }
        });

        assert.equal(response.status, 401);
        assert.equal(fetchCalls.length, 0);
    } finally {
        global.fetch = originalFetch;
    }
});

test('allows authorized POST broadcast and calls LINE broadcast endpoint', async () => {
    const originalFetch = global.fetch;
    const fetchCalls = [];
    global.fetch = async (url, init = {}) => {
        fetchCalls.push([url, init]);
        if (String(url).includes('/message/broadcast')) {
            return createJsonResponse(200, { message: 'ok' });
        }
        return createJsonResponse(500, { error: 'unexpected call' });
    };

    try {
        const request = new Request('https://example.test/api/notify?secret=top-secret', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ taskName: 'Demo task', assignees: ['A'] })
        });

        const response = await onRequest({
            request,
            env: {
                NOTIFY_CRON_SECRET: 'top-secret',
                LINE_TOKEN: 'line-token'
            }
        });

        assert.equal(response.status, 200);
        assert.equal(fetchCalls.length, 1);
        assert.match(String(fetchCalls[0][0]), /message\/broadcast/);
    } finally {
        global.fetch = originalFetch;
    }
});

test('returns successful summary for authorized GET when no users exist', async () => {
    const originalFetch = global.fetch;
    const fetchCalls = [];
    global.fetch = async (url, init = {}) => {
        fetchCalls.push([url, init]);
        if (String(url).includes(':runQuery')) {
            return createJsonResponse(200, []);
        }
        return createJsonResponse(500, { error: 'unexpected call' });
    };

    try {
        const request = new Request('https://example.test/api/notify?secret=top-secret', {
            method: 'GET'
        });

        const response = await onRequest({
            request,
            env: {
                NOTIFY_CRON_SECRET: 'top-secret',
                LINE_TOKEN: 'line-token',
                FIREBASE_PROJECT_ID: 'ceo-flow',
                FIREBASE_API_KEY: 'fake-key'
            }
        });

        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.success, true);
        assert.deepEqual(body.summary, {
            users: 0,
            tasksChecked: 0,
            sent: 0,
            skippedAlreadySent: 0
        });
        assert.equal(fetchCalls.length, 1);
        assert.match(String(fetchCalls[0][0]), /runQuery/);
    } finally {
        global.fetch = originalFetch;
    }
});
