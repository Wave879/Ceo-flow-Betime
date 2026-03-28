const BANGKOK_TZ = 'Asia/Bangkok';

function getFirestoreConfig(env) {
    const projectId = env?.FIREBASE_PROJECT_ID || env?.PROJECT_ID;
    const apiKey = env?.FIREBASE_API_KEY;

    if (!projectId || !apiKey) {
        throw new Error('Missing FIREBASE_PROJECT_ID or FIREBASE_API_KEY in environment variables');
    }

    return {
        projectId,
        apiKey,
        fsBase: `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`
    };
}

function parseFields(fields = {}) {
    const out = {};
    for (const [k, v] of Object.entries(fields)) {
        out[k] = v.stringValue ?? v.booleanValue ?? v.integerValue ?? v.timestampValue ?? null;
    }
    return out;
}

function parseDoc(doc) {
    if (!doc?.fields) return null;
    return { _id: doc.name?.split('/').pop(), ...parseFields(doc.fields) };
}

async function fsGet(col, id, env) {
    const { fsBase, apiKey } = getFirestoreConfig(env);
    const r = await fetch(`${fsBase}/${col}/${id}?key=${apiKey}`);
    if (!r.ok) return null;
    return parseDoc(await r.json());
}

async function fsSet(col, id, data, env) {
    const { fsBase, apiKey } = getFirestoreConfig(env);
    const fields = {};
    for (const [k, v] of Object.entries(data)) {
        if (typeof v === 'boolean') fields[k] = { booleanValue: v };
        else if (typeof v === 'number') fields[k] = { integerValue: String(v) };
        else fields[k] = { stringValue: String(v) };
    }
    await fetch(`${fsBase}/${col}/${id}?key=${apiKey}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields })
    });
}

async function fsQuery(body, env) {
    const { projectId, apiKey } = getFirestoreConfig(env);
    const r = await fetch(
        `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery?key=${apiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    const results = await r.json();
    return Array.isArray(results) ? results.filter((x) => x.document).map((x) => parseDoc(x.document)) : [];
}

async function listLineUsers(env) {
    return fsQuery({
        structuredQuery: {
            from: [{ collectionId: 'lineUsers' }]
        }
    }, env);
}

async function findEmployeeByEmployeeId(employeeId, env) {
    if (!employeeId) return null;
    const docs = await fsQuery({
        structuredQuery: {
            from: [{ collectionId: 'employees' }],
            where: {
                fieldFilter: {
                    field: { fieldPath: 'id' },
                    op: 'EQUAL',
                    value: { stringValue: String(employeeId) }
                }
            },
            limit: 1
        }
    }, env);
    return docs[0] || null;
}

async function queryInProgressTasksByAssignee(assigneeKey, env) {
    if (!assigneeKey) return [];
    return fsQuery({
        structuredQuery: {
            from: [{ collectionId: 'tasks' }],
            where: {
                fieldFilter: { field: { fieldPath: 'assignees' }, op: 'ARRAY_CONTAINS', value: { stringValue: assigneeKey } }
            }
        }
    }, env);
}

async function getInProgressTasks(userRef, env) {
    const keys = [
        userRef?.employeeId,
        userRef?.employeeDocId,
        userRef?.employeeName,
        userRef?.nickname
    ].filter(Boolean);

    if (userRef?.employeeId) {
        const empDoc = await fsGet('employees', userRef.employeeId, env) || await findEmployeeByEmployeeId(userRef.employeeId, env);
        if (empDoc) {
            keys.push(empDoc._id, empDoc.id, empDoc.fullName, empDoc.name);
        }
    }

    const merged = [];
    const seen = new Set();
    for (const key of keys) {
        const docs = await queryInProgressTasksByAssignee(key, env);
        for (const d of docs) {
            if (seen.has(d._id)) continue;
            seen.add(d._id);
            merged.push(d);
        }
    }

    return merged
        .filter((t) => t?.status !== 'completed')
        .sort((a, b) => String(a?.deadline || a?.startDate || '').localeCompare(String(b?.deadline || b?.startDate || '')));
}

function getDateKeyInTZ(date = new Date(), timeZone = BANGKOK_TZ) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    return `${y}-${m}-${d}`;
}

function getHourMinuteInTZ(date = new Date(), timeZone = BANGKOK_TZ) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).formatToParts(date);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);
    return { hour, minute };
}

function parseDeadlineToDate(deadline) {
    if (!deadline) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return new Date(`${deadline}T00:00:00+07:00`);
    const dt = new Date(deadline);
    return Number.isNaN(dt.getTime()) ? null : dt;
}

function getDaysUntilDeadline(deadline, now = new Date()) {
    const deadlineDate = parseDeadlineToDate(deadline);
    if (!deadlineDate) return null;
    const todayKey = getDateKeyInTZ(now, BANGKOK_TZ);
    const dueKey = getDateKeyInTZ(deadlineDate, BANGKOK_TZ);
    const todayUtc = Date.parse(`${todayKey}T00:00:00Z`);
    const dueUtc = Date.parse(`${dueKey}T00:00:00Z`);
    return Math.round((dueUtc - todayUtc) / 86400000);
}

function getReminderType(days, now = new Date(), force = false) {
    if (days === 3) return 'D-3';
    if (days === 1) return 'D-1';
    if (days === 0) {
        if (force) return 'D-DAY';
        const { hour, minute } = getHourMinuteInTZ(now, BANGKOK_TZ);
        if (hour === 8 && minute >= 30 && minute <= 45) return 'D-DAY';
    }
    return null;
}

function getReminderLabel(reminderType) {
    if (reminderType === 'D-3') return 'เหลือ 3 วันก่อนถึงกำหนด';
    if (reminderType === 'D-1') return 'เหลือ 1 วันก่อนถึงกำหนด';
    return 'ถึงกำหนดวันนี้ (แจ้งเตือน 08:30)';
}

function createInfoRow(label, value) {
    return {
        type: 'box',
        layout: 'baseline',
        spacing: 'sm',
        contents: [
            { type: 'text', text: label, color: '#7C8AA5', size: 'sm', flex: 3 },
            { type: 'text', text: String(value || '-'), wrap: true, color: '#1F2A44', size: 'sm', flex: 7 }
        ]
    };
}

function formatReminderMessage(userName, task, reminderType) {
    const label = getReminderLabel(reminderType);
    return `แจ้งเตือนงาน\nผู้รับผิดชอบ: ${userName || '-'}\nงาน: ${task.name || '-'}\nกำหนดส่ง: ${task.deadline || '-'}\nสถานะเตือน: ${label}`;
}

function createReminderFlexMessage(userName, task, reminderType, appUrl, brandImageUrl = '') {
    const label = getReminderLabel(reminderType);
    const message = {
        type: 'flex',
        altText: formatReminderMessage(userName, task, reminderType),
        contents: {
            type: 'bubble',
            size: 'mega',
            body: {
                type: 'box',
                layout: 'vertical',
                spacing: 'md',
                contents: [
                    {
                        type: 'box',
                        layout: 'baseline',
                        spacing: 'sm',
                        contents: [
                            { type: 'text', text: 'BETIMES', size: 'xs', weight: 'bold', color: '#24387E', flex: 0 },
                            { type: 'text', text: 'SOLUTIONS', size: 'xs', weight: 'bold', color: '#F28A1A', flex: 0 }
                        ]
                    },
                    { type: 'text', text: 'Task Deadline Reminder', weight: 'bold', size: 'lg', color: '#0F172A' },
                    { type: 'text', text: label, size: 'sm', color: '#2563EB', wrap: true },
                    { type: 'separator', margin: 'sm' },
                    createInfoRow('Task', task.name || '-'),
                    createInfoRow('Assignee', userName || '-'),
                    createInfoRow('Deadline', task.deadline || '-'),
                    createInfoRow('Ref', task._id || '-')
                ]
            },
            footer: {
                type: 'box',
                layout: 'vertical',
                spacing: 'sm',
                contents: [
                    {
                        type: 'button',
                        style: 'primary',
                        height: 'sm',
                        color: '#22C55E',
                        action: { type: 'uri', label: 'View Task Details', uri: appUrl }
                    },
                    {
                        type: 'button',
                        style: 'secondary',
                        action: { type: 'message', label: 'สถานะ', text: 'สถานะ' }
                    }
                ]
            }
        }
    };
    if (brandImageUrl) {
        message.contents.hero = {
            type: 'image',
            url: brandImageUrl,
            size: 'full',
            aspectRatio: '20:8',
            aspectMode: 'cover'
        };
    }
    return message;
}

function createNewTaskFlexMessage({ taskName, assignees, deadline, value, type }, appUrl, brandImageUrl = '') {
    const assigneeText = Array.isArray(assignees) && assignees.length > 0 ? assignees.join(', ') : 'ไม่ระบุ';
    const typeText = type === 'team' ? 'งานทีม' : 'งานเดี่ยว';
    const formattedValue = value ? new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(value) : '-';
    const altText = `มีงานใหม่: ${taskName || '-'} | ผู้รับผิดชอบ: ${assigneeText} | กำหนดส่ง: ${deadline || '-'}`;

    const message = {
        type: 'flex',
        altText,
        contents: {
            type: 'bubble',
            size: 'mega',
            body: {
                type: 'box',
                layout: 'vertical',
                spacing: 'md',
                contents: [
                    {
                        type: 'box',
                        layout: 'baseline',
                        spacing: 'sm',
                        contents: [
                            { type: 'text', text: 'BETIMES', size: 'xs', weight: 'bold', color: '#24387E', flex: 0 },
                            { type: 'text', text: 'SOLUTIONS', size: 'xs', weight: 'bold', color: '#F28A1A', flex: 0 }
                        ]
                    },
                    { type: 'text', text: 'New Task Assigned', weight: 'bold', size: 'lg', color: '#0F172A' },
                    { type: 'separator', margin: 'sm' },
                    createInfoRow('Task', taskName || '-'),
                    createInfoRow('Type', typeText),
                    createInfoRow('Assignees', assigneeText),
                    createInfoRow('Deadline', deadline || '-'),
                    createInfoRow('Value', formattedValue)
                ]
            },
            footer: {
                type: 'box',
                layout: 'vertical',
                spacing: 'sm',
                contents: [
                    {
                        type: 'button',
                        style: 'primary',
                        color: '#2563EB',
                        action: { type: 'uri', label: 'Open CEO Flow', uri: appUrl }
                    },
                    {
                        type: 'button',
                        style: 'secondary',
                        action: { type: 'message', label: 'สถานะ', text: 'สถานะ' }
                    }
                ]
            }
        }
    };
    if (brandImageUrl) {
        message.contents.hero = {
            type: 'image',
            url: brandImageUrl,
            size: 'full',
            aspectRatio: '20:8',
            aspectMode: 'cover'
        };
    }
    return message;
}

async function pushLineMessage(to, message, lineToken) {
    const messages = Array.isArray(message) ? message : [message];
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${lineToken}`
        },
        body: JSON.stringify({ to, messages })
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`LINE push failed (${res.status}): ${err}`);
    }
}

async function runDeadlineNotifications(env, { force = false } = {}) {
    if (!env.LINE_TOKEN) throw new Error('Missing LINE_TOKEN');

    const users = await listLineUsers(env);
    const now = new Date();
    const dateKey = getDateKeyInTZ(now, BANGKOK_TZ);
    const summary = { users: users.length, tasksChecked: 0, sent: 0, skippedAlreadySent: 0 };

    for (const user of users) {
        if (!user?.lineUserId || !user?.employeeId) continue;
        const tasks = await getInProgressTasks(user, env);
        for (const task of tasks) {
            summary.tasksChecked++;
            const days = getDaysUntilDeadline(task.deadline, now);
            if (days === null) continue;
            const type = getReminderType(days, now, force);
            if (!type) continue;

            const logId = `${dateKey}_${type}_${user.lineUserId}_${task._id}`.replace(/[^a-zA-Z0-9_-]/g, '_');
            const already = await fsGet('notificationLogs', logId, env);
            if (already) {
                summary.skippedAlreadySent++;
                continue;
            }

            const appUrl = env.WEB_APP_URL || env.APP_URL || 'https://ceo-flow.pages.dev';
            const brandImageUrl = env.BRAND_IMAGE_URL || env.FLEX_BRAND_IMAGE_URL || '';
            const message = createReminderFlexMessage(user.nickname || user.employeeName, task, type, appUrl, brandImageUrl);
            await pushLineMessage(user.lineUserId, message, env.LINE_TOKEN);
            await fsSet('notificationLogs', logId, {
                lineUserId: user.lineUserId,
                employeeId: user.employeeId,
                taskId: task._id,
                reminderType: type,
                dateKey,
                sentAt: new Date().toISOString()
            }, env);
            summary.sent++;
        }
    }
    return summary;
}

async function broadcastNewTask(body, env) {
    if (!env.LINE_TOKEN) throw new Error('Missing LINE_TOKEN in Cloudflare Environment Variables');

    const appUrl = env.WEB_APP_URL || env.APP_URL || 'https://ceo-flow.pages.dev';
    const brandImageUrl = env.BRAND_IMAGE_URL || env.FLEX_BRAND_IMAGE_URL || '';
    const flexMessage = createNewTaskFlexMessage(body, appUrl, brandImageUrl);

    const lineResponse = await fetch('https://api.line.me/v2/bot/message/broadcast', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.LINE_TOKEN}`
        },
        body: JSON.stringify({
            messages: [flexMessage]
        })
    });
    const result = await lineResponse.json();
    return { success: lineResponse.ok, lineResult: result };
}

export async function onRequest({ request, env }) {
    try {
        const url = new URL(request.url);
        const force = url.searchParams.get('force') === '1';
        const secret = url.searchParams.get('secret');
        const hasSecret = !!env.NOTIFY_CRON_SECRET;

        if (hasSecret && secret !== env.NOTIFY_CRON_SECRET) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (request.method === 'POST') {
            let body = {};
            try {
                body = await request.json();
            } catch {
                body = {};
            }

            const taskName = body?.taskName || body?.name;
            if (taskName) {
                const result = await broadcastNewTask({
                    taskName,
                    assignees: body.assigneeNames || body.assignees || [],
                    deadline: body.deadline || '',
                    value: body.value || 0,
                    type: body.type === 'team' ? 'team' : 'individual',
                }, env);
                return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
            }
        }

        const summary = await runDeadlineNotifications(env, { force });
        return new Response(JSON.stringify({ success: true, summary }), { headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
        return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
