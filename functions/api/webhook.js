// ✅ webhook.js v2 — Simplified for /สั่ง command only
// Handler functions only. All helpers live in ./modules/.

import {
    fsString,
    fsStringArray,
    patchFirestoreDoc
} from './modules/firestore.js';

import { verifyLineWebhookSignature } from './modules/line-security.js';
import { getGroupSummary, pushText, replyFlex, replyText } from './modules/line-api.js';
import { normalizeIncomingText, parseMeetingDateFromText, parseTaggedLineTaskCandidate } from './modules/message-parser.js';

const BANGKOK_TIME_ZONE = 'Asia/Bangkok';
const processedEvents = new Set(); // Track processed webhook events to prevent duplicates

function formatDateKeyInBangkok(date = new Date()) {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: BANGKOK_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    const parts = formatter.formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value || '1970';
    const month = parts.find((part) => part.type === 'month')?.value || '01';
    const day = parts.find((part) => part.type === 'day')?.value || '01';
    return `${year}-${month}-${day}`;
}

function addDaysToDateKey(dateKey = '', days = 0) {
    const [year, month, day] = String(dateKey || '').split('-').map((value) => Number(value));
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
        return '';
    }

    const cursor = new Date(Date.UTC(year, month - 1, day));
    cursor.setUTCDate(cursor.getUTCDate() + Number(days || 0));

    const y = cursor.getUTCFullYear();
    const m = String(cursor.getUTCMonth() + 1).padStart(2, '0');
    const d = String(cursor.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function getNextWorkingDay(dateKey = '') {
    let current = parseDeadlineToDate(dateKey);
    if (!current) {
        current = new Date();
    }

    // Move to next day
    current.setUTCDate(current.getUTCDate() + 1);

    // Skip weekends (Saturday = 6, Sunday = 0 in UTC)
    // Bangkok is UTC+7, so Friday UTC = Thursday evening, Saturday UTC = Friday evening
    // We check Bangkok day of week instead
    for (let i = 0; i < 7; i++) {
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: BANGKOK_TIME_ZONE,
            weekday: 'long'
        });
        const dayName = formatter.format(current);
        if (dayName !== 'Saturday' && dayName !== 'Sunday') {
            return formatDateKeyInBangkok(current);
        }
        current.setUTCDate(current.getUTCDate() + 1);
    }

    return formatDateKeyInBangkok(current);
}

function resolveEventDate(event = {}) {
    const eventTimestamp = Number(event?.timestamp || 0);
    if (Number.isFinite(eventTimestamp) && eventTimestamp > 0) {
        return new Date(eventTimestamp);
    }

    return new Date();
}

function resolveDeadlineDateKey(messageText = '', eventDate = new Date(), parsedDeadlineIso = '') {
    const parsed = String(parsedDeadlineIso || '').trim();
    if (parsed) {
        return parsed;
    }

    const normalized = normalizeIncomingText(messageText).toLowerCase();
    const startDateKey = formatDateKeyInBangkok(eventDate);

    if (!normalized) {
        return startDateKey;
    }

    if (/พรุ่งนี้|วันพรุ่งนี้|tomorrow|next day|วันหน้า|วันถัดไป/u.test(normalized)) {
        return addDaysToDateKey(startDateKey, 1) || startDateKey;
    }

    if (/วันนี้|today/u.test(normalized)) {
        return startDateKey;
    }

    const parsedDate = parseMeetingDateFromText(normalized);
    return parsedDate?.iso || startDateKey;
}

function getFirestoreConfig(env = {}) {
    const projectId = String(env?.FIREBASE_PROJECT_ID || env?.PROJECT_ID || '').trim();
    const apiKey = String(env?.FIREBASE_API_KEY || '').trim();
    if (!projectId || !apiKey) {
        return null;
    }

    return {
        projectId,
        apiKey,
        fsBase: `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`
    };
}

function parseFirestoreValue(value = {}) {
    if (!value || typeof value !== 'object') {
        return null;
    }

    if (Object.prototype.hasOwnProperty.call(value, 'stringValue')) {
        return String(value.stringValue || '');
    }
    if (Object.prototype.hasOwnProperty.call(value, 'booleanValue')) {
        return Boolean(value.booleanValue);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'integerValue')) {
        return Number(value.integerValue || 0);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'doubleValue')) {
        return Number(value.doubleValue || 0);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'timestampValue')) {
        return String(value.timestampValue || '');
    }
    if (value.arrayValue) {
        const values = Array.isArray(value.arrayValue.values) ? value.arrayValue.values : [];
        return values.map((item) => parseFirestoreValue(item));
    }
    if (value.mapValue?.fields) {
        const out = {};
        for (const [key, fieldValue] of Object.entries(value.mapValue.fields || {})) {
            out[key] = parseFirestoreValue(fieldValue);
        }
        return out;
    }

    return null;
}

function parseFirestoreDocument(doc = {}) {
    const fields = doc?.fields || {};
    const parsed = { _id: String(doc?.name || '').split('/').pop() || '' };
    for (const [key, value] of Object.entries(fields)) {
        parsed[key] = parseFirestoreValue(value);
    }
    return parsed;
}

async function fsRunQuery(body = {}, env = {}) {
    const cfg = getFirestoreConfig(env);
    if (!cfg) {
        return [];
    }

    const url = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents:runQuery?key=${cfg.apiKey}`;
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            return [];
        }

        const rows = await res.json().catch(() => []);
        if (!Array.isArray(rows)) {
            return [];
        }

        return rows
            .filter((row) => row?.document?.fields)
            .map((row) => parseFirestoreDocument(row.document));
    } catch {
        return [];
    }
}

function parseDeadlineToDate(deadline = '') {
    const raw = String(deadline || '').trim();
    if (!raw) {
        return null;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return new Date(`${raw}T00:00:00+07:00`);
    }

    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getHourMinuteInBangkok(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: BANGKOK_TIME_ZONE,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).formatToParts(date);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
    return { hour, minute };
}

function getDaysUntilDeadline(deadline = '', now = new Date()) {
    const deadlineDate = parseDeadlineToDate(deadline);
    if (!deadlineDate) {
        return null;
    }

    const todayKey = formatDateKeyInBangkok(now);
    const dueKey = formatDateKeyInBangkok(deadlineDate);
    const todayUtc = Date.parse(`${todayKey}T00:00:00Z`);
    const dueUtc = Date.parse(`${dueKey}T00:00:00Z`);
    return Math.round((dueUtc - todayUtc) / 86400000);
}

function getReminderType(days = null, now = new Date(), force = false) {
    if (days === 1) {
        return 'D-1';
    }

    if (days === 0) {
        if (force) {
            return 'D-DAY';
        }

        const { hour } = getHourMinuteInBangkok(now);
        return hour >= 17 ? 'D-DAY' : null;
    }

    return null;
}

function toNameList(values = []) {
    return Array.isArray(values)
        ? [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))]
        : [];
}

function extractAssigneeNames(task = {}) {
    const lineNames = toNameList(task?.lineAssigneeNames);
    if (lineNames.length > 0) {
        return lineNames;
    }

    const assigneeRaw = String(task?.assignee || '').trim();
    if (!assigneeRaw) {
        return [];
    }

    return toNameList(
        assigneeRaw
            .split(',')
            .map((part) => String(part || '').replace(/^@+/u, '').trim())
            .filter(Boolean)
    );
}

async function queryGroupNotificationCandidates(groupId = '', env = {}, force = true) {
    const normalizedGroupId = String(groupId || '').trim();
    if (!normalizedGroupId) {
        return [];
    }

    const docs = await fsRunQuery({
        structuredQuery: {
            from: [{ collectionId: 'tasks' }],
            where: {
                fieldFilter: {
                    field: { fieldPath: 'projectId' },
                    op: 'EQUAL',
                    value: { stringValue: normalizedGroupId }
                }
            }
        }
    }, env);

    const now = new Date();
    const filtered = docs.filter((task) => {
        const status = String(task?.status || '').trim().toLowerCase();
        return status !== 'completed' && status !== 'abandoned';
    });

    // Resolve creator names asynchronously
    const tasks = [];
    for (const task of filtered) {
        const days = getDaysUntilDeadline(task?.deadline, now);
        const reminderType = getReminderType(days, now, force);
        const assigneeNames = extractAssigneeNames(task);
        
        // Resolve creator display name
        let createdByName = '';
        const createdByUserId = String(task?.createdBy || task?.lineUserId || '').trim();
        if (createdByUserId && createdByUserId !== 'unknown') {
            // Fetch creator profile (creator might not be in group, so profile endpoint only)
            const profile = await fetchLineProfileJson(
                `https://api.line.me/v2/bot/profile/${encodeURIComponent(createdByUserId)}`,
                env
            ).catch(() => null);
            createdByName = String(profile?.displayName || profile?.name || '').trim() || createdByUserId.slice(-10);
        }

        tasks.push({
            ...task,
            reminderType,
            days,
            assigneeNames,
            createdByName
        });
    }

    return tasks
        // For testing: show all tasks (comment out filter to display all)
        // .filter((task) => Boolean(task.reminderType))
        .sort((a, b) => String(a?.deadline || '').localeCompare(String(b?.deadline || '')))
        .slice(0, 8);
}

function createGroupDeadlineFlex(groupName = '', tasks = [], appUrl = 'https://ceoflow.pages.dev', brandImageUrl = '') {
    const normalizedGroupName = String(groupName || '').trim() || 'LINE Group';
    const rows = tasks.map((task, index) => ({
        type: 'box',
        layout: 'vertical',
        spacing: 'xs',
        margin: index === 0 ? 'none' : 'md',
        contents: [
            {
                type: 'text',
                text: `${index + 1}. งาน ${String(task?.name || task?.title || '-').slice(0, 60)}`,
                size: 'sm',
                weight: 'bold',
                color: '#1F2A44',
                wrap: true
            },
            ...(task.reminderType ? [{
                type: 'text',
                text: `สถานะ ${task.reminderType}`,
                size: 'xs',
                color: task.reminderType === 'D-DAY' ? '#DC2626' : '#1D4ED8',
                wrap: true
            }] : []),
            {
                type: 'text',
                text: `กำหนดส่ง ${String(task?.deadline || '-')}`,
                size: 'xs',
                color: '#475569',
                wrap: true
            },
            {
                type: 'text',
                text: `ผู้รับผิดชอบ ${task.assigneeNames.length > 0 ? task.assigneeNames.map((name) => `@${name}`).join(' ') : '-'}`,
                size: 'xs',
                color: '#334155',
                wrap: true
            },
            {
                type: 'text',
                text: `ผู้สั่งงาน ${task.createdByName ? `@${task.createdByName}` : '-'}`,
                size: 'xs',
                color: '#334155',
                wrap: true
            },
            {
                type: 'separator',
                margin: 'sm'
            }
        ]
    }));

    const bodyContents = [
        {
            type: 'box',
            layout: 'baseline',
            spacing: 'sm',
            contents: [
                { type: 'text', text: 'BETIMES', size: 'xs', weight: 'bold', color: '#24387E', flex: 0 },
                { type: 'text', text: 'SOLUTIONS', size: 'xs', weight: 'bold', color: '#F28A1A', flex: 0 }
            ]
        },
        { type: 'text', text: 'Deadline Notification', weight: 'bold', size: 'lg', color: '#0F172A' },
        { type: 'text', text: `[DevTest] ${normalizedGroupName}`, size: 'sm', color: '#2563EB', wrap: true },
        { type: 'separator', margin: 'sm' },
        ...(rows.length > 0 ? rows : [{ type: 'text', text: 'ไม่พบงานเข้าเงื่อนไข D-1 / D-DAY', size: 'sm', color: '#64748B', wrap: true }])
    ];

    const message = {
        altText: `[DevTest] ${normalizedGroupName} - แจ้งเตือนกำหนดส่งงาน`,
        contents: {
            type: 'bubble',
            size: 'mega',
            body: {
                type: 'box',
                layout: 'vertical',
                spacing: 'md',
                contents: bodyContents
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
                        action: { 
                            type: 'postback', 
                            label: 'ได้รับคำตอบแล้ว', 
                            data: `action=task_answered&taskId=${tasks[0]?._id || ''}&taskIndex=1`
                        }
                    },
                    {
                        type: 'button',
                        style: 'secondary',
                        action: { 
                            type: 'postback', 
                            label: 'เลื่อน แจ้งเตือนอีก 1 วัน', 
                            data: `action=task_postpone&taskId=${tasks[0]?._id || ''}&taskIndex=1`
                        }
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

// ✅ Handle postback events from buttons
async function handlePostback(event, env) {
    try {
        const replyToken = event.replyToken;
        const groupId = event.source?.groupId;
        const postbackData = String(event.postback?.data || '').trim();

        if (!postbackData) {
            return;
        }

        // Parse postback data format: action=task_answered&taskId=xxx or action=task_postpone&taskId=xxx
        const params = new URLSearchParams(postbackData);
        const action = String(params.get('action') || '').trim().toLowerCase();
        const taskId = String(params.get('taskId') || '').trim();

        if (!taskId) {
            await replyText(replyToken, '❌ ไม่พบ taskId', env).catch(() => {});
            return;
        }

        if (action === 'task_answered') {
            // Mark THIS task as "pending-delete"
            await patchFirestoreDoc(`tasks/${taskId}`, {
                status: fsString('pending-delete'),
                updatedAt: { timestampValue: new Date().toISOString() }
            }, env, false).catch(() => {});

            await replyText(replyToken, '✅ ตอบรับทราบ! งานนี้จัดเก็บแล้ว', env).catch(() => {});
            console.log(`✅ Task answered: ${taskId}`);

            // Fetch remaining tasks
            if (groupId) {
                const tasks = await queryGroupNotificationCandidates(groupId, env, true);
                if (tasks.length > 0) {
                    const appUrl = env.WEB_APP_URL || env.APP_URL || 'https://ceoflow.pages.dev';
                    const brandImageUrl = env.BRAND_IMAGE_URL || env.FLEX_BRAND_IMAGE_URL || '';
                    const groupSummary = await getGroupSummary(groupId, env);
                    const payload = createGroupDeadlineFlex(groupSummary?.name || `LINE GROUP ${groupId.slice(-6)}`, tasks, appUrl, brandImageUrl);
                    await replyFlex(replyToken, payload, env, { groupId, saveToChat: true }).catch(() => {});
                } else {
                    await pushText(groupId, '✅ ยินดีด้วย! งานทั้งหมดเรียบร้อยแล้ว', env, { groupId, saveToChat: true }).catch(() => {});
                }
            }
            return;
        }

        if (action === 'task_postpone') {
            // Postpone THIS task to next working day
            const nextDay = getNextWorkingDay(formatDateKeyInBangkok(new Date()));
            await patchFirestoreDoc(`tasks/${taskId}`, {
                deadline: fsString(nextDay),
                updatedAt: { timestampValue: new Date().toISOString() }
            }, env, false).catch(() => {});

            await replyText(replyToken, `✅ ตอบรับทราบ! เลื่อนแจ้งเตือนงานนี้ไปวัน ${nextDay}`, env).catch(() => {});
            console.log(`✅ Task postponed: ${taskId} to ${nextDay}`);

            // Fetch remaining tasks
            if (groupId) {
                const tasks = await queryGroupNotificationCandidates(groupId, env, true);
                if (tasks.length > 0) {
                    const appUrl = env.WEB_APP_URL || env.APP_URL || 'https://ceoflow.pages.dev';
                    const brandImageUrl = env.BRAND_IMAGE_URL || env.FLEX_BRAND_IMAGE_URL || '';
                    const groupSummary = await getGroupSummary(groupId, env);
                    const payload = createGroupDeadlineFlex(groupSummary?.name || `LINE GROUP ${groupId.slice(-6)}`, tasks, appUrl, brandImageUrl);
                    await replyFlex(replyToken, payload, env, { groupId, saveToChat: true }).catch(() => {});
                } else {
                    await pushText(groupId, '✅ ยินดีด้วย! งานทั้งหมดเรียบร้อยแล้ว', env, { groupId, saveToChat: true }).catch(() => {});
                }
            }
            return;
        }
    } catch (err) {
        console.error('❌ Postback error:', err?.message);
    }
}

function buildAssigneeTagLine(tasks = []) {
    const names = [];
    for (const task of tasks) {
        for (const name of (task?.assigneeNames || [])) {
            const normalized = String(name || '').replace(/^@+/u, '').trim();
            if (!normalized) {
                continue;
            }
            if (!names.includes(normalized)) {
                names.push(normalized);
            }
            if (names.length >= 10) {
                return names;
            }
        }
    }
    return names;
}

// Build mention text with LINE mention tags
async function buildAssigneeTagLineWithMentions(tasks = [], groupId = '', env = {}) {
    // Get unique assignee names
    const names = buildAssigneeTagLine(tasks);
    if (names.length === 0) {
        return { text: '', mentions: [] };
    }

    // Query groupUsers to get LINE userIds for mention tagging
    const cfg = getFirestoreConfig(env);
    if (!cfg || !groupId) {
        // Fallback to text-only (@name format)
        const textLine = `ผู้รับผิดชอบงาน: ${names.map((n) => `@${n}`).join(' ')}`;
        return { text: textLine, mentions: [] };
    }

    // Fetch groupUsers collection to map displayName → userId
    const userUrl = `${cfg.fsBase}/projects/${encodeURIComponent(groupId)}/groupUsers?key=${cfg.apiKey}`;
    let groupUsersList = [];
    try {
        const res = await fetch(userUrl);
        if (res.ok) {
            const data = await res.json();
            groupUsersList = (data?.documents || []).map((doc) => parseFirestoreDocument(doc));
        }
    } catch (err) {
        console.error('Failed to fetch groupUsers:', err.message);
    }

    // Build mention array with offset/length
    const mentions = [];
    let currentOffset = '\\u30e6\\u30fb\\u53d7\\u4ed8\\u3051\\u8cac\\u4efb\\u306e\\u4ecd\\u3044: '.length; // Initial offset
    const textLine = `ผู้รับผิดชอบงาน: ${names.map((name) => `@${name}`).join(' ')}`;
    
    let textOffset = 'ผู้รับผิดชอบงาน: '.length;

    for (const name of names) {
        // Find userId in groupUsers
        const groupUser = groupUsersList.find((u) => {
            const displayName = String(u?.displayName || u?.name || '').trim();
            return displayName.toLowerCase() === String(name || '').toLowerCase();
        });

        if (groupUser?.lineUserId) {
            mentions.push({
                offset: textOffset,
                length: name.length + 1, // +1 for @ symbol
                userId: groupUser.lineUserId
            });
        }

        textOffset += name.length + 1 + 1; // name + @ + space
    }

    return { text: textLine, mentions };
}

async function fetchLineProfileJson(url = '', env = {}) {
    const token = String(env?.LINE_TOKEN || '').trim();
    if (!url || !token) {
        return null;
    }

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        if (!response.ok) {
            return null;
        }

        return await response.json().catch(() => null);
    } catch {
        return null;
    }
}

async function resolveLineSenderDisplayName(event = {}, env = {}) {
    const lineUserId = String(event?.source?.userId || '').trim();
    if (!lineUserId) {
        return '';
    }

    const sourceType = String(event?.source?.type || '').trim().toLowerCase();
    const groupId = String(event?.source?.groupId || '').trim();
    const roomId = String(event?.source?.roomId || '').trim();

    const urls = [];
    if (sourceType === 'group' && groupId) {
        urls.push(`https://api.line.me/v2/bot/group/${encodeURIComponent(groupId)}/member/${encodeURIComponent(lineUserId)}`);
    }
    if (sourceType === 'room' && roomId) {
        urls.push(`https://api.line.me/v2/bot/room/${encodeURIComponent(roomId)}/member/${encodeURIComponent(lineUserId)}`);
    }
    urls.push(`https://api.line.me/v2/bot/profile/${encodeURIComponent(lineUserId)}`);

    for (const url of urls) {
        const profile = await fetchLineProfileJson(url, env);
        const name = String(profile?.displayName || profile?.name || '').trim();
        if (name) {
            return name;
        }
    }

    return '';
}

async function persistIncomingLineTextMessage(event = {}, env = {}, projectId = '') {
    const normalizedProjectId = String(projectId || '').trim();
    if (!normalizedProjectId) {
        return false;
    }

    const message = event?.message || {};
    const messageType = String(message?.type || '').trim().toLowerCase();
    if (messageType !== 'text') {
        return false;
    }

    const messageText = normalizeIncomingText(message?.text || '');
    const lineMessageId = String(message?.id || '').trim();
    const quotedMessageId = String(message?.quotedMessageId || '').trim();
    const lineUserId = String(event?.source?.userId || '').trim();
    const senderRole = lineUserId ? 'user' : 'unknown';
    const senderName = await resolveLineSenderDisplayName(event, env);
    const createdAtIso = resolveEventDate(event).toISOString();

    const docId = lineMessageId
        ? `line_${lineMessageId}`
        : `line_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return patchFirestoreDoc(`projects/${normalizedProjectId}/messages/${docId}`, {
        id: fsString(docId),
        projectId: fsString(normalizedProjectId),
        lineMessageId: fsString(lineMessageId),
        lineUserId: fsString(lineUserId),
        senderRole: fsString(senderRole),
        senderName: fsString(senderName),
        senderDisplayName: fsString(senderName),
        displayName: fsString(senderName),
        type: fsString('text'),
        text: fsString(messageText),
        previewText: fsString(messageText),
        quotedMessageId: fsString(quotedMessageId),
        createdAt: { timestampValue: createdAtIso },
        updatedAt: { timestampValue: createdAtIso }
    }, env, false);
}

export async function onRequest({ request, env, context }) {
    console.log("✅ Webhook hit:", request.method);
    
    try {
        if (request.method === 'GET') {
            return new Response('OK', { status: 200 });
        }

        if (request.method !== 'POST') {
            return new Response('OK', { status: 200 });
        }

        const rawBody = await request.text();
        if (!rawBody) {
            return new Response('OK', { status: 200 });
        }

        const lineSignature = request.headers.get('x-line-signature') || '';
        const signatureResult = await verifyLineWebhookSignature(
            rawBody,
            lineSignature,
            env.LINE_CHANNEL_SECRET
        );

        if (!signatureResult.ok) {
            console.error('Invalid LINE webhook signature');
            return new Response('OK', { status: 200 });
        }

        let data;
        try {
            data = JSON.parse(rawBody);
        } catch (e) {
            console.error('JSON parse error');
            return new Response('OK', { status: 200 });
        }

        if (!data?.events?.length) {
            return new Response('OK', { status: 200 });
        }

        console.log('✅ Received', data.events.length, 'event(s)');

        // Process events in background
        const task = Promise.all(data.events.map(e => handleEvent(e, env)));
        if (context?.waitUntil) {
            context.waitUntil(task);
        } else {
            await task;
        }

        return new Response('OK', { status: 200 });
    } catch (err) {
        console.error("FATAL webhook error:", err);
        return new Response('OK', { status: 200 });
    }
}

async function handleEvent(event, env) {
    try {
        // ✅ Handle postback events (button clicks)
        if (event.type === 'postback') {
            return handlePostback(event, env);
        }

        // Only handle message events with text
        if (event.type !== 'message' || event.message?.type !== 'text') {
            return;
        }

        // Deduplication: skip if event already processed
        const eventId = `${event.timestamp}_${event.source?.userId}_${event.message?.id}`;
        if (processedEvents.has(eventId)) {
            console.log('⚠️ Skipping duplicate event:', eventId);
            return;
        }
        processedEvents.add(eventId);

        // Clean up old events from memory (keep only last 1000)
        if (processedEvents.size > 1000) {
            const arr = Array.from(processedEvents);
            arr.slice(0, arr.length - 1000).forEach(e => processedEvents.delete(e));
        }

        const replyToken = event.replyToken;
        const lineUserId = event.source?.userId;
        const groupId = event.source?.groupId;
        const messageText = normalizeIncomingText(event.message.text || '');

        if (!messageText) {
            return;
        }

        console.log('📝 Message:', messageText.slice(0, 80));

        const projectId = groupId || lineUserId;
        await persistIncomingLineTextMessage(event, env, projectId);

        if (messageText.toLowerCase().includes('/devtestnoti') || messageText.toLowerCase().includes('／devtestnoti')) {
            if (!projectId || !groupId) {
                await replyText(replyToken, 'คำสั่งนี้ใช้ได้เฉพาะในกลุ่ม LINE', env).catch(() => {});
                return;
            }

            const appUrl = env.WEB_APP_URL || env.APP_URL || 'https://ceoflow.pages.dev';
            const brandImageUrl = env.BRAND_IMAGE_URL || env.FLEX_BRAND_IMAGE_URL || '';
            const groupSummary = await getGroupSummary(groupId, env);
            const tasks = await queryGroupNotificationCandidates(groupId, env, true);
            const payload = createGroupDeadlineFlex(groupSummary?.name || `LINE GROUP ${groupId.slice(-6)}`, tasks, appUrl, brandImageUrl);

            await replyFlex(replyToken, payload, env, { groupId, saveToChat: true }).catch(() => {});

            // Build mention line with actual LINE mention tags
            const { text: tagLineText, mentions } = await buildAssigneeTagLineWithMentions(tasks, groupId, env);
            if (tagLineText.length > 0) {
                await pushText(groupId, tagLineText, env, {
                    groupId,
                    saveToChat: true,
                    mentions: mentions.length > 0 ? mentions : undefined
                }).catch(() => {});
            }

            return;
        }

        // ✅ =================================================================
        // /สั่ง command — create task from message
        // =================================================================
        if (messageText.includes('/สั่ง') || messageText.includes('／สั่ง')) {
            console.log('🔥 /สั่ง detected');

            // Extract project ID (group > user)
            if (!projectId) {
                console.log('❌ No project ID');
                return;
            }

            // Parse title from message
            const parsed = parseTaggedLineTaskCandidate(messageText);
            let title = parsed?.title || messageText
                .replace(/\/สั่ง/gu, '')
                .replace(/／สั่ง/gu, '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 200);
            const lineAssigneeNames = Array.isArray(parsed?.lineAssigneeNames)
                ? parsed.lineAssigneeNames
                : [];
            const lineRelatedNames = Array.isArray(parsed?.lineRelatedNames)
                ? parsed.lineRelatedNames
                : [];
            const assigneeLabel = lineAssigneeNames.length > 0
                ? lineAssigneeNames.join(', ')
                : 'สมาชิกในกลุ่ม';

            if (!title) {
                title = '(งานจาก LINE)';
            }

            // Create task
            const taskId = `line_cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const sourceLineMessageId = String(event?.message?.id || '').trim();
            const eventDate = resolveEventDate(event);
            const eventTimestampIso = eventDate.toISOString();
            const startDate = formatDateKeyInBangkok(eventDate);
            const deadlineDate = resolveDeadlineDateKey(messageText, eventDate, parsed?.deadlineIso);

            try {
                const created = await patchFirestoreDoc(`tasks/${taskId}`, {
                    id: fsString(taskId),
                    projectId: fsString(projectId),
                    title: fsString(title),
                    name: fsString(title),
                    status: fsString('in-progress'),
                    source: fsString('line-command'),
                    lineMessageId: fsString(sourceLineMessageId),
                    sourceLineMessageId: fsString(sourceLineMessageId),
                    assignee: fsString(assigneeLabel),
                    lineAssigneeNames: fsStringArray(lineAssigneeNames),
                    lineRelatedNames: fsStringArray(lineRelatedNames),
                    lineUserId: fsString(lineUserId || ''),
                    createdBy: fsString(lineUserId || ''),
                    startDate: fsString(startDate),
                    deadline: fsString(deadlineDate),
                    startAt: { timestampValue: eventTimestampIso },
                    createdAt: { timestampValue: eventTimestampIso },
                    updatedAt: { timestampValue: eventTimestampIso }
                }, env, false);

                const ackMsg = created
                    ? `✅ บันทึก: "${title.slice(0, 50)}${title.length > 50 ? '...' : ''}"`
                    : '⚠️ บันทึกล้มเหลว';

                await replyText(replyToken, ackMsg, env).catch(() => {});
                console.log('✅ /สั่ง task created:', taskId);
            } catch (err) {
                console.error('❌ /สั่ง error:', err?.message);
                await replyText(replyToken, '❌ เกิดข้อผิดพลาด', env).catch(() => {});
            }
            return;
        }

        // ✅ Add more commands here in future
    } catch (err) {
        console.error('Event handler error:', err);
    }
}

// ✅ Re-export helper modules for other API files
export {
    clearKnownGroupsData,
    deleteKnownGroupData,
    getKnownGroupsSnapshotWithSource,
    setKnownGroupType
} from './modules/known-groups.js';

export {
    recountMemberCountFromFirestoreSources,
    syncGroupMembersToTeam
} from './modules/member-sync.js';

export {
    refreshKnownGroupIdentity,
    fullGroupSync
} from './modules/group-sync.js';

export {
    tryCreateTaggedLineTask
} from './modules/task-creator.js';

export {
    getKnownGroupsSnapshot,
    writePendingTaskConfirm,
    readPendingTaskConfirm,
    deletePendingTaskConfirm
} from './modules/known-groups.js';

export { registerGroupMemberIdentity } from './modules/project-member.js';
