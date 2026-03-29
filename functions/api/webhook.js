// ✅ webhook.js v2 — Simplified for /สั่ง command only
// Handler functions only. All helpers live in ./modules/.

import {
    fsString,
    patchFirestoreDoc
} from './modules/firestore.js';

import { verifyLineWebhookSignature } from './modules/line-security.js';
import { replyText } from './modules/line-api.js';
import { normalizeIncomingText, parseTaggedLineTaskCandidate } from './modules/message-parser.js';

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
        // Only handle message events with text
        if (event.type !== 'message' || event.message?.type !== 'text') {
            return;
        }

        const replyToken = event.replyToken;
        const lineUserId = event.source?.userId;
        const groupId = event.source?.groupId;
        const messageText = normalizeIncomingText(event.message.text || '');

        if (!messageText) {
            return;
        }

        console.log('📝 Message:', messageText.slice(0, 80));

        // ✅ =================================================================
        // /สั่ง command — create task from message
        // =================================================================
        if (messageText.includes('/สั่ง') || messageText.includes('／สั่ง')) {
            console.log('🔥 /สั่ง detected');

            // Extract project ID (group > user)
            const projectId = groupId || lineUserId;
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

            if (!title) {
                title = '(งานจาก LINE)';
            }

            // Create task
            const taskId = `line_cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const now = new Date().toISOString();

            try {
                const created = await patchFirestoreDoc(`tasks/${taskId}`, {
                    id: fsString(taskId),
                    projectId: fsString(projectId),
                    title: fsString(title),
                    name: fsString(title),
                    status: fsString('in-progress'),
                    source: fsString('line-command'),
                    lineUserId: fsString(lineUserId || ''),
                    createdBy: fsString(lineUserId || ''),
                    createdAt: { timestampValue: now },
                    updatedAt: { timestampValue: now }
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
