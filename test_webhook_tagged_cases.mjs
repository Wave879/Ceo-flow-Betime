import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { onRequest } from './functions/api/webhook.js';

function parseEnvFile(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const env = {};

    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        const index = trimmed.indexOf('=');
        if (index <= 0) {
            continue;
        }

        const key = trimmed.slice(0, index).trim();
        let value = trimmed.slice(index + 1).trim();

        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }

        env[key] = value;
    }

    return env;
}

function sanitizeDocIdSegment(value = '') {
    return String(value || '').trim().replace(/[^A-Za-z0-9_-]/g, '');
}

function buildTaskDocId(lineMessageId = '') {
    return `line_task_${sanitizeDocIdSegment(lineMessageId)}`;
}

function getEmployeeDocIdFromLineUserId(lineUserId = '') {
    const normalized = String(lineUserId || '').trim();
    return `emp_${normalized.slice(-6)}`;
}

async function sleep(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fsGetDocument(pathSuffix, env) {
    const base = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
    const url = `${base}/${pathSuffix}?key=${env.FIREBASE_API_KEY}`;

    const response = await fetch(url);
    if (response.status === 404) {
        return { ok: false, status: 404, data: null };
    }

    if (!response.ok) {
        const errorText = await response.text();
        return { ok: false, status: response.status, data: errorText };
    }

    const data = await response.json();
    return { ok: true, status: 200, data };
}

async function fsDeleteDocument(pathSuffix, env) {
    const base = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
    const url = `${base}/${pathSuffix}?key=${env.FIREBASE_API_KEY}`;

    try {
        const response = await fetch(url, { method: 'DELETE' });
        return response.status;
    } catch {
        return 0;
    }
}

function readStringField(fields, fieldName) {
    return String(fields?.[fieldName]?.stringValue || '').trim();
}

function readArrayLengthField(fields, fieldName) {
    const values = fields?.[fieldName]?.arrayValue?.values;
    return Array.isArray(values) ? values.length : 0;
}

async function fetchTaskWithRetry(taskDocId, env) {
    for (let attempt = 0; attempt < 8; attempt++) {
        const docResult = await fsGetDocument(`tasks/${taskDocId}`, env);
        if (docResult.ok) {
            return docResult;
        }

        if (docResult.status !== 404) {
            return docResult;
        }

        await sleep(250 * (attempt + 1));
    }

    return { ok: false, status: 404, data: null };
}

function createWebhookSignature(rawBody, channelSecret) {
    return crypto
        .createHmac('sha256', channelSecret)
        .update(rawBody)
        .digest('base64');
}

async function invokeWebhookEvent(event, env) {
    const payload = {
        destination: 'U00000000000000000000000000000000',
        events: [event]
    };

    const rawBody = JSON.stringify(payload);
    const signature = createWebhookSignature(rawBody, env.LINE_CHANNEL_SECRET);

    const request = new Request('https://example.local/functions/api/webhook', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-line-signature': signature
        },
        body: rawBody
    });

    const waitTasks = [];
    const context = {
        waitUntil(promise) {
            waitTasks.push(Promise.resolve(promise));
        }
    };

    const response = await onRequest({ request, env, context });
    await Promise.allSettled(waitTasks);

    return response;
}

async function run() {
    const rootPath = process.cwd();
    const envPath = path.join(rootPath, '.dev.vars');

    if (!fs.existsSync(envPath)) {
        throw new Error('.dev.vars not found.');
    }

    const vars = parseEnvFile(envPath);
    const required = ['FIREBASE_PROJECT_ID', 'FIREBASE_API_KEY', 'LINE_CHANNEL_SECRET', 'LINE_TOKEN'];

    for (const key of required) {
        if (!String(vars[key] || '').trim()) {
            throw new Error(`Missing required variable in .dev.vars: ${key}`);
        }
    }

    const env = {
        FIREBASE_PROJECT_ID: vars.FIREBASE_PROJECT_ID,
        FIREBASE_API_KEY: vars.FIREBASE_API_KEY,
        LINE_CHANNEL_SECRET: vars.LINE_CHANNEL_SECRET,
        LINE_TOKEN: vars.LINE_TOKEN,
        // Use fixed bot ID in tests so bot mentions can be excluded from assignee extraction.
        LINE_BOT_USER_ID: 'Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    };

    const groupId = `C${crypto.randomBytes(16).toString('hex')}`;
    const senderId = `U${crypto.randomBytes(16).toString('hex')}`;
    const assigneeId = `U${crypto.randomBytes(16).toString('hex')}`;

    const now = Date.now();
    const cases = [
        {
            name: 'tag-only',
            text: '@aina',
            mentions: []
        },
        {
            name: 'tag+mention',
            text: '@aina @crash ทำเอกสารนี้ด้วยนะ',
            mentions: [
                { index: 0, length: 5, userId: env.LINE_BOT_USER_ID },
                { index: 6, length: 6, userId: assigneeId }
            ]
        },
        {
            name: 'tag+deadline',
            text: '@aina ส่งรายงานภายใน 20/03',
            mentions: []
        }
    ];

    const results = [];
    const cleanupPaths = new Set();

    try {
        for (let index = 0; index < cases.length; index++) {
            const currentCase = cases[index];
            const messageId = `${now}${index + 1}`;
            const taskDocId = buildTaskDocId(messageId);
            const replyToken = `test_reply_${messageId}`;

            const event = {
                type: 'message',
                mode: 'active',
                timestamp: Date.now(),
                replyToken,
                source: {
                    type: 'group',
                    groupId,
                    userId: senderId
                },
                message: {
                    id: messageId,
                    type: 'text',
                    text: currentCase.text,
                    ...(currentCase.mentions.length > 0
                        ? {
                            mention: {
                                mentions: currentCase.mentions
                            }
                        }
                        : {})
                }
            };

            const response = await invokeWebhookEvent(event, env);
            const taskResult = await fetchTaskWithRetry(`line_task_${messageId}`, env);

            let taskSummary = null;
            if (taskResult.ok) {
                const fields = taskResult.data?.fields || {};
                taskSummary = {
                    source: readStringField(fields, 'source'),
                    title: readStringField(fields, 'title'),
                    deadline: readStringField(fields, 'deadline') || readStringField(fields, 'deadlineText'),
                    assigneeCount: readArrayLengthField(fields, 'lineAssigneeIds'),
                    assigneeName: readStringField(fields, 'assignee')
                };
                cleanupPaths.add(`tasks/${taskDocId}`);
            }

            cleanupPaths.add(`projects/${groupId}/messages/${messageId}`);

            results.push({
                case: currentCase.name,
                messageId,
                webhookStatus: response.status,
                taskCreated: taskResult.ok,
                taskStatus: taskResult.status,
                taskSource: taskSummary?.source || '-',
                assigneeCount: taskSummary?.assigneeCount ?? 0,
                deadline: taskSummary?.deadline || '-',
                assigneeName: taskSummary?.assigneeName || '-',
                taskTitle: taskSummary?.title || '-'
            });
        }
    } finally {
        const idsForCleanup = [senderId, assigneeId, env.LINE_BOT_USER_ID];

        cleanupPaths.add(`projects/${groupId}`);

        for (const lineUserId of idsForCleanup) {
            const employeeId = getEmployeeDocIdFromLineUserId(lineUserId);
            cleanupPaths.add(`groupUsers/${lineUserId}`);
            cleanupPaths.add(`employees/${employeeId}`);
            cleanupPaths.add(`projects/${groupId}/members/${employeeId}`);
            cleanupPaths.add(`groupMemberLinks/${groupId}__${lineUserId}`);
        }

        for (const pathSuffix of cleanupPaths) {
            await fsDeleteDocument(pathSuffix, env);
        }
    }

    const expected = {
        'tag-only': false,
        'tag+mention': true,
        'tag+deadline': true
    };

    const tableRows = results.map((row) => ({
        case: row.case,
        taskCreated: row.taskCreated,
        expected: expected[row.case],
        matchExpected: row.taskCreated === expected[row.case],
        taskSource: row.taskSource,
        assigneeCount: row.assigneeCount,
        deadline: row.deadline,
        webhookStatus: row.webhookStatus
    }));

    console.log('\n=== Tagged Task Payload Test Results ===');
    console.table(tableRows);

    console.log('\n=== Detailed Output ===');
    console.log(JSON.stringify(results, null, 2));

    const failed = tableRows.filter((row) => !row.matchExpected);
    if (failed.length > 0) {
        process.exitCode = 2;
    }
}

run().catch((err) => {
    console.error('Test runner failed:', err?.stack || err);
    process.exit(1);
});
