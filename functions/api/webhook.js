// ✅ webhook.js — main entry point
// Handler functions only. All helpers live in ./modules/.

// ── Firestore ──────────────────────────────────────────────────────────────
import {
    fsString,
    fsStringArray,
    getFSBase,
    fsGetDoc,
    patchFirestoreDoc,
    createEmployee,
    upsertLineUser,
    readFirestoreStringField
} from './modules/firestore.js';

// ── LINE security ──────────────────────────────────────────────────────────
import { verifyLineWebhookSignature } from './modules/line-security.js';

// ── LINE API ───────────────────────────────────────────────────────────────
import {
    replyFlex,
    replyText,
    pushText,
    fetchLineProfile,
    getGroupSummary
} from './modules/line-api.js';

// ── Message parser ─────────────────────────────────────────────────────────
import {
    normalizeIncomingText,
    extractQuotedMessageId,
    parseExplicitAiInvocation,
    buildMeetingTaskDocId,
    parseMeetingDateFromText,
    parseTaggedLineTaskCandidate
} from './modules/message-parser.js';

// ── AI task detection ──────────────────────────────────────────────────────
import {
    isTaggedTaskAiEnabled,
    parseTaggedLineTaskCandidateWithAI
} from './modules/ai-task-detection.js';

// ── Mention processor ──────────────────────────────────────────────────────
import {
    hasAllAudienceMention,
    resolvePrimaryAssigneeMentionLabel
} from './modules/mention-processor.js';

// ── Task creator ───────────────────────────────────────────────────────────
import {
    tryCreateMeetingSummaryTask,
    tryCreateTaggedLineTask,
    tryRecordMeetingSummaryTaskReply,
    resolveSenderDisplayName
} from './modules/task-creator.js';

// ── Known groups ───────────────────────────────────────────────────────────
import {
    MSG_DEDUP_KV_PREFIX,
    getKnownGroupsSnapshot,
    isGenericKnownGroupName,
    writePendingTaskConfirm,
    readPendingTaskConfirm,
    deletePendingTaskConfirm
} from './modules/known-groups.js';

// ── Member sync (re-exported only — no direct use in handler) ─────────────

// ── Group sync ─────────────────────────────────────────────────────────────
import { refreshKnownGroupIdentity, fullGroupSync } from './modules/group-sync.js';

// ── Task query ─────────────────────────────────────────────────────────────
import { queryMyTasksForUser, queryGroupTasksForNotify } from './modules/task-query.js';

// ── Flex builder ───────────────────────────────────────────────────────────
import { buildNotifyTasksFlexMessage, buildPendingTaskConfirmFlexMessage } from './modules/flex-builder.js';

// ── Mode manager ───────────────────────────────────────────────────────────
import {
    resolveAliveModeScope,
    resolveChatSessionScope,
    readTestOrderModeState,
    writeTestOrderModeState
} from './modules/mode-manager.js';

// ── Chat session ───────────────────────────────────────────────────────────
import {
    trimChatHistory,
    readChatHistory,
    readChatSessionState,
    writeChatSessionState,
    deleteChatSessionState,
    askSoundwave
} from './modules/chat-session.js';

// ── Project member ─────────────────────────────────────────────────────────
import {
    ensureProjectRecord,
    saveGroupUser,
    saveMentionedUsers
} from './modules/project-member.js';

// ── Message persistence ────────────────────────────────────────────────────
import { saveNonGroupMessage, saveGroupMessage } from './modules/message-persistence.js';

// ── AI reply ──────────────────────────────────────────────────────────────
import { generateAIReply } from './modules/ai-reply.js';

// ── Known-groups re-exports (other API files import these from webhook.js) ──
export {
    // known-groups.js
    getKnownGroupsSnapshot,
    isGenericKnownGroupName,
    writePendingTaskConfirm,
    readPendingTaskConfirm,
    deletePendingTaskConfirm
} from './modules/known-groups.js';

export {
    clearKnownGroupsData,
    deleteKnownGroupData,
    getKnownGroupsSnapshotWithSource,
    setKnownGroupType
} from './modules/known-groups.js';

export {
    // member-sync.js
    recountMemberCountFromFirestoreSources,
    syncGroupMembersToTeam
} from './modules/member-sync.js';

export {
    // group-sync.js
    refreshKnownGroupIdentity,
    fullGroupSync
} from './modules/group-sync.js';

export {
    // task-creator.js
    tryCreateTaggedLineTask
} from './modules/task-creator.js';

export {
    // project-member.js
    registerGroupMemberIdentity
} from './modules/project-member.js';

// ─────────────────────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────────────────────

export async function onRequest({ request, env, context }) {
    console.log("✅ Webhook hit:", request.method, request.url);
    try {
        // ✅ Sync endpoint: ดึงรายการ projects ทั้งหมด
        if (request.method === 'GET') {
            const FS_BASE = getFSBase(env);
            const res = await fetch(`${FS_BASE}/projects?key=${env.FIREBASE_API_KEY}`);
            const data = await res.text();
            return new Response(data, {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        if (request.method !== 'POST') {
            return new Response('OK', { status: 200 });
        }

        const rawBody = await request.text();
        if (!rawBody) {
            return new Response('OK', { status: 200 });
        }

        const lineSignature = request.headers.get('x-line-signature')
            || request.headers.get('X-Line-Signature')
            || '';

        const signatureResult = await verifyLineWebhookSignature(
            rawBody,
            lineSignature,
            env.LINE_CHANNEL_SECRET
        );

        if (!signatureResult.ok) {
            console.error('Invalid LINE webhook signature, event ignored:', signatureResult.reason);
            return new Response('OK', { status: 200 });
        }

        let data = null;
        try {
            data = JSON.parse(rawBody);
        } catch (e) {
            console.error('JSON parse error:', e);
            return new Response('OK', { status: 200 });
        }

        if (!data?.events?.length) {
            return new Response('OK', { status: 200 });
        }

        const eventCount = Array.isArray(data.events) ? data.events.length : 0;
        console.log('✅ Received', eventCount, 'event(s) from LINE');

        // ✅ Simple: No dedup, just process events directly
        // Always return 200 to LINE immediately, then process in background via waitUntil.
        const task = handleUnifiedEvents(data.events, env);
        if (context && context.waitUntil) {
            context.waitUntil(task);
        } else {
            await task;
        }

        // ✅ ตอบกลับทันทีเสมอ
        return new Response('OK', { status: 200 });
    } catch (err) {
        console.error("FATAL webhook error:", err);
        // ✅ ไม่ว่ากรณีใด ต้องตอบ 200 เสมอ
        return new Response('OK', { status: 200 });
    }
}

// Legacy event handler removed. All processing uses handleUnifiedEvents.
// ✅ Unified flow: ประมวลผลทุกคำสั่งและ AI ใน endpoint เดียว
async function handleUnifiedEvents(events, env) {
    if (!Array.isArray(events) || events.length === 0) {
        return;
    }

    if (globalThis.__ALIVE_MODE__ === undefined) {
        globalThis.__ALIVE_MODE__ = false;
    }

    // ✅ Process each event directly - no dedup needed
    for (const event of events) {
        try {
            console.log('Processing event:', event.type);
            await handleUnifiedEvent(event, env);
        } catch (err) {
            console.error('Event error:', err);
        }
    }
}

async function handleUnifiedEvent(event, env) {
    const replyToken = event.replyToken;
    const sourceType = event.source?.type;
    const lineUserId = event.source?.userId;
    const groupId = event.source?.groupId;
    const roomId = event.source?.roomId;
    const isGroup = sourceType === 'group';
    const groupReplyOptions = isGroup && groupId ? { groupId } : undefined;
    const fallbackReplyTarget = String(groupId || roomId || lineUserId || '').trim();
    
    const replyOrPush = async (message) => {
        const normalizedMessage = String(message || '').trim();
        if (!normalizedMessage) {
            return false;
        }

        const sent = await replyText(replyToken, normalizedMessage, env, groupReplyOptions);
        // Fallback to push when reply fails (replyToken expired / already used).
        if (!sent && fallbackReplyTarget) {
            await pushText(fallbackReplyTarget, normalizedMessage, env, { groupId: isGroup ? groupId : undefined });
            return true;
        }

        return sent;
    };
    const replyTestOrderDecision = async (remembered, reason = '', detail = '', taskInfo = null) => {
        let textResult = remembered ? '✅ จำ' : '❌ ไม่จำ';
        if (reason) {
            const reasonLabel = {
                'created': 'tagged task',
                'dry-run': 'tagged task',
                'dry-run-followup': 'followup task',
                'duplicate': 'task ซ้ำ',
                'followup-recorded': 'followup task',
                'followup-recorded-reopened': 'followup task (เปิดใหม่)',
                'meeting-summary': 'สรุปประชุม',
                'meeting-reply': 'ตอบกลับงาน',
                'no-task-signal': 'ไม่พบสัญญาณงาน'
            }[reason] || reason;
            const aiPct = (taskInfo?.aiConfidence || 0) > 0
                ? ` · AI ${Math.round(taskInfo.aiConfidence * 100)}%`
                : '';
            textResult += `\n(${reasonLabel}${aiPct})`;
        }
        if (detail) {
            textResult += `\n${detail}`;
        }
        // ถามเฉพาะตอน "บันทึก" และ AI confidence < 70% (ไม่ชัวร์) เท่านั้น
        const isLowConfidence = remembered && (taskInfo?.aiConfidence || 0) > 0 && (taskInfo?.aiConfidence || 0) < 0.70;
        const hasNoAiSignal = remembered && !taskInfo?.aiConfidence; // keyword/rule-based ไม่มี confidence — ไม่ถาม
        if (isLowConfidence) {
            textResult += '\n—\nพิมพ์ /บันทึก เพื่อยืนยัน หรือ /ไม่บันทึก เพื่อยกเลิก';
        }
        // บันทึก pending ให้ /บันทึก และ /ไม่บันทึก ทำงานได้เสมอ
        const scope = resolveAliveModeScope(sourceType, groupId, roomId, lineUserId);
        if (scope) {
            writePendingTaskConfirm(scope.docId, {
                title: taskInfo?.title || '',
                decided: remembered,
                decidedReason: reason,
                aiConfidence: taskInfo?.aiConfidence || 0,
                messageText: (taskInfo?.messageText || text || '').slice(0, 500)
            }, env).catch(() => {});
        }
        // Use replyOrPush so the testorder result reaches the user even when replyToken expired.
        return replyOrPush(textResult);
    };
    const persistGroupIdentityMetadata = async (userSource, mentionSource) => {
        if (!isGroup || !groupId) {
            return;
        }

        if (lineUserId) {
            await saveGroupUser(groupId, lineUserId, env, { source: userSource }).catch((err) => {
                console.error(`Save group user failed (${userSource}):`, err);
            });
        }

        if (event.message?.mention?.mentions?.length) {
            await saveMentionedUsers(groupId, event.message.mention.mentions, env, { source: mentionSource }).catch((err) => {
                console.error(`Save mentioned users failed (${mentionSource}):`, err);
            });
        }
    };
    let groupMessagePersisted = false;

    // เมื่อถูกเชิญเข้ากลุ่ม ให้ซิงข้อมูลทั้งกลุ่มทันที
    if (event.type === 'join' && groupId) {
        const ackSent = await replyText(replyToken, 'รับคำสั่งแล้วค่ะ กำลังเชื่อมต่อกลุ่มและซิงข้อมูลให้นะคะ', env, groupReplyOptions);

        try {
            const syncResult = await fullGroupSync(groupId, env, { fallbackUserId: lineUserId });
            let doneText = '✅ CEO FLOW เชื่อมต่อกลุ่มเรียบร้อยแล้วค่ะ';

            if ((syncResult.warnings || []).length > 0) {
                doneText = '✅ CEO FLOW เชื่อมต่อกลุ่มเรียบร้อยแล้วค่ะ (ซิงค์บางส่วน)';
            } else if ((syncResult.membersSynced || 0) > 0) {
                doneText = '✅ CEO FLOW เชื่อมต่อกลุ่มเรียบร้อย และบันทึกสมาชิกแล้ว';
            }

            if (groupId) {
                await pushText(groupId, doneText, env);
            }
        } catch (err) {
            console.error('Join full sync error:', err);
            const failText = 'เชื่อมต่อกลุ่มไม่สำเร็จ กรุณาลองใหม่อีกครั้งค่ะ';
            if (!ackSent) {
                await replyText(replyToken, failText, env, groupReplyOptions);
            }
            if (groupId) {
                await pushText(groupId, failText, env);
            }
        }
        return;
    }

    if (event.type !== 'message' || !event.message?.type) {
        return;
    }

    const messageType = String(event.message.type || '').trim().toLowerCase();
    if (!messageType) {
        return;
    }

    const isTextMessage = messageType === 'text';
    const text = isTextMessage ? normalizeIncomingText(event.message.text || '') : '';
    if (isTextMessage && !text) {
        return;
    }

    const normalizedCommandText = isTextMessage
        ? text.replace(/\s+/g, '').toLowerCase()
        : '';
    const isSyncCommand = isTextMessage && (text === '/ซิงข้อมูลกลุ่ม'
        || text === '/ซิงค์ข้อมูลกลุ่ม'
        || text === '/บันทึกข้อมูลกลุ่ม');
    const isAddProjectCommand = isTextMessage && text === '/เพิ่มโครงการ';
    const isTestCommand = isTextMessage
        && (normalizedCommandText === '/test'
            || normalizedCommandText === 'test'
            || normalizedCommandText === 'ทดสอบ'
            || normalizedCommandText === '/ทดสอบ');
    const isTestOrderOnCommand = isTextMessage
        && (normalizedCommandText === '/testorder' || normalizedCommandText === '/testoder');
    const isTestOrderOffCommand = isTextMessage
        && (normalizedCommandText === '/-testorder' || normalizedCommandText === '/-testoder');
    const isTestOrderCommand = isTestOrderOnCommand || isTestOrderOffCommand;
    const isConfirmYesCommand = isTextMessage
        && (text === '/บันทึก' || normalizedCommandText === '/บันทึก' || text === '/จำ' || normalizedCommandText === '/จำ');
    const isConfirmNoCommand = isTextMessage
        && (text === '/ไม่บันทึก' || normalizedCommandText === '/ไม่บันทึก' || text === '/ไม่จำ' || normalizedCommandText === '/ไม่จำ');
    const isConfirmCommand = isConfirmYesCommand || isConfirmNoCommand;
    const isAliveOnCommand = isTextMessage && text === '/มีชีวิต';
    const isAliveOffCommand = isTextMessage && text === '/จบชีวิต';
    // /สั่ง anywhere in message = force-create task (fast path, no AI)
    // Use includes() not regex to avoid Thai character encoding edge cases
    const hasSangCommand = isTextMessage && text.includes('/สั่ง');
    // /แจ้งงาน = ส่ง Flex Message สรุปงานในกลุ่มนั้น
    const hasAengnganCommand = isTextMessage && (text.trim() === '/แจ้งงาน' || text.includes('/แจ้งงาน'));
    // /แจ้งเตือนส่วนตัว = push แจ้งเตือนหางานของคนกดปุ่มผ่าน LINE personal chat
    const hasPersonalNotifyCommand = isTextMessage && (text.trim() === '/แจ้งเตือนส่วนตัว' || text.includes('/แจ้งเตือนส่วนตัว'));
    // คำสั่งที่ต้องข้ามทั้ง testOrderMode และ chatSession เสมอ
    const isConnectSystemCommand = isTextMessage && text === 'เชื่อมต่อระบบ';


    if (isTextMessage) {
        console.log('🔍 Webhook text message received:', {
            sourceType,
            groupId: String(groupId || ''),
            roomId: String(roomId || ''),
            hasLineUserId: Boolean(String(lineUserId || '').trim()),
            textPreview: String(text || '').slice(0, 100),
            textLength: text.length,
            isTestCommand,
            isTestOrderCommand,
            hasSangCommand,
            hasAengnganCommand
        });
    }

    // Pre-save user message to Firestore for group text events BEFORE any command early-return.
    // Must be awaited — Cloudflare Workers kills floating promises when function returns.
    // Ensures command messages like /test, /แจ้งงาน, /มีชีวิต appear in chat history.
    if (isGroup && groupId && isTextMessage) {
        await Promise.all([
            ensureProjectRecord(groupId, env, null, '').catch(() => {}),
            saveGroupMessage(groupId, lineUserId || '', event, env).catch((err) => {
                console.error('Pre-save group command message failed:', err);
            })
        ]);
        groupMessagePersisted = true;
    }

    // Fast path for health-check command to avoid reply-token expiry on slow persistence paths.
    if (isTestCommand) {
        console.log('Command matched: /test', {
            sourceType,
            groupId: String(groupId || ''),
            roomId: String(roomId || ''),
            hasLineUserId: Boolean(String(lineUserId || '').trim())
        });
        const testText = 'ไอน่าพร้อมแล้วค่ะ';
        await replyText(replyToken, testText, env, groupReplyOptions);
        return;
    }

    // /แจ้งเตือนส่วนตัว — push งานของคนกดปุ่มไปยัง LINE personal chat
    if (hasPersonalNotifyCommand && lineUserId) {
        console.log('Command matched: /แจ้งเตือนส่วนตัว', { lineUserId: String(lineUserId || '').slice(-6), groupId: String(groupId || '').slice(-6) });
        try {
            // Query tasks assigned to this user across all groups (or just this group)
            const myTasks = await queryMyTasksForUser(lineUserId, groupId || '', env, 20);
            const active = myTasks.filter((t) => t.status !== 'completed' && t.status !== 'abandoned');
            const done = myTasks.filter((t) => t.status === 'completed').length;

            // Reply in group to acknowledge
            if (isGroup && groupId) {
                await replyText(replyToken, '📩 ส่งรายการงานของคุณไปยัง chat ส่วนตัวแล้วค่ะ', env, groupReplyOptions);
            }

            // Build personal message text
            const lines = [
                `📋 รายการงานของคุณ`,
                `🔄 กำลังทำ: ${active.length} งาน | ✅ เสร็จแล้ว: ${done} งาน`,
                ''
            ];
            if (active.length === 0) {
                lines.push('✨ ไม่มีงานค้างอยู่ในขณะนี้ค่ะ');
            } else {
                active.slice(0, 10).forEach((t, i) => {
                    const deadline = t.deadline ? ` (📅 ${t.deadline})` : '';
                    const statusLabel = { 'in-progress': '🔄', 'pending': '⏳' }[t.status] || '•';
                    lines.push(`${statusLabel} ${i + 1}. ${t.title.slice(0, 60)}${deadline}`);
                });
                if (active.length > 10) {
                    lines.push(`... และอีก ${active.length - 10} งาน`);
                }
            }

            // Push to personal chat
            const pushed = await pushText(lineUserId, lines.join('\n'), env, { saveToChat: false });
            if (!pushed && !isGroup) {
                // If push failed and not in group (no reply yet), try reply
                await replyText(replyToken, lines.join('\n'), env, {}).catch(() => {});
            }
        } catch (err) {
            console.error('/แจ้งเตือนส่วนตัว error:', err);
            await replyText(replyToken, 'ขอโทษค่ะ เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้งนะคะ', env, groupReplyOptions).catch(() => {});
        }
        return;
    }

    // /แจ้งงาน — query tasks in this group → reply with Flex Message summary
    if (hasAengnganCommand && isGroup && groupId) {
        console.log('Command matched: /แจ้งงาน', { groupId, lineUserId: String(lineUserId || '').slice(-6) });
        let aengnganReplied = false;
        try {
            // Run project doc + tasks query in parallel to minimize latency before replyToken expires
            const [projectDoc, groupTasks] = await Promise.all([
                fsGetDoc('projects', groupId, env).catch(() => null),
                queryGroupTasksForNotify(groupId, env, 30)
            ]);

            const projectName = (() => {
                if (!projectDoc) return `LINE GROUP ${groupId.slice(-6)}`;
                const candidates = [
                    readFirestoreStringField(projectDoc, 'name'),
                    readFirestoreStringField(projectDoc, 'webProjectName'),
                    readFirestoreStringField(projectDoc, 'groupName')
                ].map((s) => String(s || '').trim()).filter(Boolean);
                const good = candidates.find((s) => !s.toUpperCase().startsWith('LINE GROUP'));
                return good || candidates[0] || `LINE GROUP ${groupId.slice(-6)}`;
            })();
            console.log('/แจ้งงาน projectName:', projectName, 'tasks:', groupTasks.length);

            // 3. Build + reply Flex Message
            const flexMsg = buildNotifyTasksFlexMessage(projectName, groupTasks);
            const flexSent = await replyFlex(replyToken, flexMsg, env, groupReplyOptions);
            aengnganReplied = flexSent;

            // Fallback: if Flex failed (invalid format, etc.), reply with plain text summary
            if (!flexSent) {
                const active = groupTasks.filter((t) => t.status !== 'completed' && t.status !== 'abandoned');
                const done = groupTasks.filter((t) => t.status === 'completed').length;
                const lines = [`📋 ${projectName}`, `🔄 กำลังทำ: ${active.length} งาน | ✅ เสร็จแล้ว: ${done} งาน`];
                active.slice(0, 8).forEach((t, i) => {
                    lines.push(`${i + 1}. ${t.title.slice(0, 50)}${t.deadline ? ` (${t.deadline})` : ''}`);
                });
                await replyText(replyToken, lines.join('\n'), env, groupReplyOptions);
                aengnganReplied = true;
            }
        } catch (err) {
            console.error('/แจ้งงาน error:', err);
            if (!aengnganReplied) {
                await replyText(replyToken, 'ขอโทษค่ะ เกิดข้อผิดพลาดในการดึงข้อมูลงาน กรุณาลองใหม่อีกครั้งนะคะ', env, groupReplyOptions).catch(() => {});
            }
        }
        await ensureProjectRecord(groupId, env, null, '').catch(() => {});
        return;
    }

    // Fast path for /สั่ง force-task command.
    // Inline minimal create: parse title locally (0 I/O) → 1 Firestore write → reply immediately.
    // Secondary saves/enrichment happen AFTER reply so replyToken never expires.
    if (hasSangCommand && isGroup && groupId) {
        const sangText = normalizeIncomingText(text || '');
        const sangCandidate = parseTaggedLineTaskCandidate(sangText);
        const sangTitle = sangCandidate.title || 'งานจากข้อความที่ถูกสั่งใน LINE';
        
        const deadlineInfo = parseMeetingDateFromText(sangText);
        const sangDeadlineIso = deadlineInfo?.iso || '';
        const sangDeadlineDisplay = deadlineInfo?.display || '';
        
        const sangAssigneeLineUserIds = extractMeetingTaskAssigneeLineUserIds(event, env);
        const sangManualAssigneeNames = extractManualAssigneeMentionNames(sangText);

        const sangLineMessageId = String(event?.message?.id || '').trim();
        const sangTaskDocId = buildMeetingTaskDocId(sangLineMessageId);
        const sangCreatedAtRaw = Number(event?.timestamp);
        const sangCreatedAtIso = Number.isFinite(sangCreatedAtRaw) && sangCreatedAtRaw > 0
            ? new Date(sangCreatedAtRaw).toISOString()
            : new Date().toISOString();
        const sangNowIso = new Date().toISOString();
        let sangCreated = false;
        let sangDuplicate = false;
        
        try {
            if (sangLineMessageId) {
                const existing = await fsGetDoc('tasks', sangTaskDocId, env).catch(() => null);
                if (existing) {
                    sangDuplicate = true;
                }
            }
            
            if (!sangDuplicate) {
                const finalAssignee = sangManualAssigneeNames.length > 0 
                    ? sangManualAssigneeNames[0] 
                    : (sangAssigneeLineUserIds.length > 0 ? `LINE-${sangAssigneeLineUserIds[0].slice(-6)}` : 'ยังไม่ระบุ');
                
                sangCreated = await patchFirestoreDoc(`tasks/${sangTaskDocId}`, {
                    id: fsString(sangTaskDocId),
                    projectId: fsString(groupId),
                    title: fsString(sangTitle),
                    name: fsString(sangTitle),
                    assignee: fsString(finalAssignee),
                    assignees: fsStringArray(sangManualAssigneeNames),
                    lineAssigneeIds: fsStringArray(sangAssigneeLineUserIds),
                    lineAssigneeNames: fsStringArray(sangManualAssigneeNames),
                    status: fsString('in-progress'),
                    type: fsString('individual'),
                    value: { integerValue: '0' },
                    formatIssues: { arrayValue: {} },
                    source: fsString('line-tagged-task'),
                    lineMessageId: fsString(sangLineMessageId),
                    lineContextMessageIds: fsStringArray(sangLineMessageId ? [sangLineMessageId] : []),
                    lineUserId: fsString(lineUserId || ''),
                    createdBy: fsString(lineUserId || ''),
                    createdByName: fsString('สมาชิกในกลุ่ม'),
                    sourceText: fsString(sangText.slice(0, 500)),
                    deadline: fsString(sangDeadlineDisplay),
                    deadlineText: fsString(sangDeadlineDisplay),
                    deadlineIso: fsString(sangDeadlineIso),
                    startDate: fsString(sangCreatedAtIso.split('T')[0] || ''),
                    createdAt: { timestampValue: sangCreatedAtIso },
                    updatedAt: { timestampValue: sangNowIso }
                }, env, false).catch(() => false);
            }
        } catch (err) {
            console.error('/สั่ง error:', err?.message);
        }

        const sangAck = sangDuplicate
            ? '✅ ข้อความนี้บันทึกเป็นงานไว้แล้วค่ะ'
            : sangCreated
                ? '✅ บันทึกข้อความเป็นงานเรียบร้อยแล้วค่ะ'
                : 'รับคำสั่งแล้ว แต่บันทึกงานไม่สำเร็จ กรุณาลองใหม่อีกครั้งค่ะ';
        
        try {
            await replyText(replyToken, sangAck, env, groupReplyOptions);
        } catch (err) {
            console.error('/สั่ง reply error:', err?.message);
        }

        await ensureProjectRecord(groupId, env, null, '').catch(() => {});
        await saveGroupMessage(groupId, lineUserId || '', event, env).catch(() => {});
        await persistGroupIdentityMetadata('webhook-sang', 'webhook-mention-sang').catch(() => {});
        return;
    }

    if (!isTextMessage) {
        if (isGroup && groupId) {
            await ensureProjectRecord(groupId, env, null, '').catch((err) => {
                console.error('Ensure project record for media message failed:', err);
            });

            const saved = await saveGroupMessage(groupId, lineUserId || '', event, env).catch((err) => {
                console.error('Save group media message failed:', err);
                return false;
            });

            if (saved) {
                groupMessagePersisted = true;
            }

            await persistGroupIdentityMetadata('webhook-media', 'webhook-mention-media');
        } else {
            await saveNonGroupMessage(sourceType, roomId, lineUserId || '', event, env).catch((err) => {
                console.error('Save non-group media message failed:', err);
            });
            groupMessagePersisted = true;
        }
        return;
    }

    // คำนวณก่อน save เพื่อ fast-path commands ออก Firestore pre-work
    const shouldSkipAutoTaskParsersForCommand = isSyncCommand
        || isAddProjectCommand
        || isTestCommand
        || isTestOrderCommand
        || isConfirmCommand
        || isAliveOnCommand
        || isAliveOffCommand
        || isConnectSystemCommand
        || hasSangCommand
        || hasAengnganCommand
        || hasPersonalNotifyCommand;

    // readTestOrderModeState ต้องอยู่ก่อน save เพื่อให้ skip save ได้ทัน
    const testOrderModeEnabled = shouldSkipAutoTaskParsersForCommand
        ? false
        : await readTestOrderModeState(sourceType, groupId, roomId, lineUserId, env);

    // เริ่ม save แบบ background (ไม่ await) เพื่อให้ task parsers + reply ทำงานได้ทันที
    // saves จะ complete ใน finally block ก่อน handleUnifiedEvent resolve
    let backgroundSavePromise = Promise.resolve();
    if (!shouldSkipAutoTaskParsersForCommand) {
        if (isGroup && groupId) {
            backgroundSavePromise = (async () => {
                if (!groupMessagePersisted) {
                    await ensureProjectRecord(groupId, env, null, '').catch((err) => {
                        console.error('Ensure project record for text message failed:', err);
                    });
                    await saveGroupMessage(groupId, lineUserId || '', event, env).catch((err) => {
                        console.error('Save group text message failed:', err);
                    });
                }
                await persistGroupIdentityMetadata('webhook-text', 'webhook-mention-text');
            })();
            groupMessagePersisted = true; // saves in-flight — mark immediately to prevent late-save duplicate
        } else {
            backgroundSavePromise = saveNonGroupMessage(sourceType, roomId, lineUserId || '', event, env).catch((err) => {
                console.error('Save non-group text message failed:', err);
            });
            groupMessagePersisted = true;
        }
    }

    try {

    if (true) {
        const quotedMessageId = extractQuotedMessageId(event?.message || {});

        // ใน testOrderMode ข้าม tryRecordMeetingSummaryTaskReply เพื่อลด latency
        const meetingReplyResult = testOrderModeEnabled
            ? { matched: false, updated: false, reason: 'skipped-testorder' }
            : await tryRecordMeetingSummaryTaskReply(event, env, {
                projectId: groupId,
                lineUserId
            }).catch((err) => {
                console.error('Record meeting task reply failed:', err);
                return { matched: false, updated: false, reason: 'exception' };
            });

        const meetingReplyReason = String(meetingReplyResult?.reason || '').trim();
        const meetingReplyAckText = meetingReplyResult?.matched
            ? (meetingReplyResult.updated
                ? '✅ รับข้อความตอบกลับแล้ว และอัปเดตงานเรียบร้อยค่ะ'
                : (meetingReplyReason === 'duplicate-reply'
                    ? '✅ ข้อความตอบกลับนี้บันทึกไว้แล้วค่ะ'
                    : (meetingReplyReason === 'not-assignee'
                        ? 'รับข้อความตอบกลับแล้ว แต่ยังไม่ได้รับสิทธิ์อัปเดตงานนี้ค่ะ'
                        : (meetingReplyReason === 'write-failed'
                            ? 'รับข้อความตอบกลับแล้ว แต่บันทึกงานไม่สำเร็จ กรุณาลองใหม่อีกครั้งค่ะ'
                            : ''))))
            : '';

        if (meetingReplyResult?.reason && meetingReplyResult.reason !== 'not-reply' && meetingReplyResult.reason !== 'no-task') {
            console.log('Meeting task reply decision:', {
                reason: meetingReplyResult.reason,
                matched: Boolean(meetingReplyResult.matched),
                updated: Boolean(meetingReplyResult.updated),
                groupId,
                lineMessageId: String(event?.message?.id || '').trim(),
                quotedMessageId,
                taskId: String(meetingReplyResult?.taskId || '')
            });
        }

        // DISABLED: Meeting & keyword detection - only /สั่ง command works
        return;

        if (meetingTaskResult?.reason && meetingTaskResult.reason !== 'not-summary') {
            console.log('Meeting task decision:', {
                reason: meetingTaskResult.reason,
                matched: Boolean(meetingTaskResult.matched),
                created: Boolean(meetingTaskResult.created),
                duplicate: Boolean(meetingTaskResult.duplicate),
                groupId,
                lineMessageId: String(event?.message?.id || '').trim()
            });
        }

        if (meetingTaskResult?.matched) {
            if (testOrderModeEnabled && !text.startsWith('/')) {
                const meetingSummaryParts = [];
                if (meetingTaskResult.title) meetingSummaryParts.push(`"${meetingTaskResult.title}"`);
                const meetSigs = [];
                if (meetingTaskResult.hasBotSignal) meetSigs.push('@ไอน่า');
                if (meetingTaskResult.hasCcSignal) meetSigs.push('cc:');
                if (meetingTaskResult.hasAssigneeMentionSignal) meetSigs.push('@mention');
                if (meetingTaskResult.hasAllAudienceSignal) meetSigs.push('@all');
                if (meetSigs.length > 0) meetingSummaryParts.push(`สัญญาณ: ${meetSigs.join(', ')}`);
                await replyTestOrderDecision(true, 'meeting-summary', meetingSummaryParts.join('\n'), { title: meetingTaskResult.title || '' });
                return;
            }

            if (meetingTaskResult.created || meetingTaskResult.duplicate) {
                const quoteToken = String(event?.message?.quoteToken || '').trim();
                const ackText = meetingTaskResult.duplicate
                    ? '✅ รายการนี้บันทึกเป็นงานไว้แล้วค่ะ'
                    : '✅ บันทึกสรุปประชุมเป็นงานเรียบร้อยแล้วค่ะ';

                await replyOrPush(ackText);
            } else {
                await replyOrPush('รับข้อความสรุปประชุมแล้ว แต่บันทึกงานไม่สำเร็จ กรุณาลองใหม่อีกครั้งค่ะ');
            }

            return;
        }

        // In testorder mode only: run AI in parallel with keyword parsing to get confidence score for display.
        // In normal mode: AI is called inside tryCreateTaggedLineTask when needed — no extra call here.
        const dryRunAiPromise = (testOrderModeEnabled && isTaggedTaskAiEnabled(env))
            ? parseTaggedLineTaskCandidateWithAI(text, env).catch(() => null)
            : Promise.resolve(null);

        const [taggedTaskResult, dryRunAiResult] = await Promise.all([
            tryCreateTaggedLineTask(event, env, {
                projectId: groupId,
                lineUserId,
                dryRun: testOrderModeEnabled
            }).catch((err) => {
                console.error('🤖 Auto tagged task failed:', err);
                return { matched: false, created: false, reason: 'exception' };
            }),
            dryRunAiPromise
        ]);

        console.log('🔍 Tagged task result:', {
            matched: Boolean(taggedTaskResult?.matched),
            created: Boolean(taggedTaskResult?.created),
            reason: String(taggedTaskResult?.reason || ''),
            aiConfidence: Number(taggedTaskResult?.aiConfidence || 0)
        });

        // Merge AI confidence into taggedTaskResult for display (when keyword matched but AI wasn't called internally)
        if (testOrderModeEnabled && dryRunAiResult && !(taggedTaskResult?.aiConfidence > 0) && taggedTaskResult) {
            taggedTaskResult.aiConfidence = dryRunAiResult.aiConfidence ?? 0;
            taggedTaskResult.aiTaskSignal = taggedTaskResult.aiTaskSignal || Boolean(dryRunAiResult.aiTaskSignal);
        }

        if (
            taggedTaskResult?.reason
            && taggedTaskResult.reason !== 'not-tasklike'
            && taggedTaskResult.reason !== 'no-task-signal'
            && taggedTaskResult.reason !== 'command'
            && taggedTaskResult.reason !== 'not-tagged'
            && taggedTaskResult.reason !== 'no-assignee-mention'
            && !String(taggedTaskResult.reason).startsWith('ai-')
        ) {
            const normalizedMessagePreview = normalizeIncomingText(event?.message?.text || '')
                .replace(/\s+/g, ' ')
                .slice(0, 240);
            console.log('Tagged task decision:', {
                reason: taggedTaskResult.reason,
                matched: Boolean(taggedTaskResult.matched),
                created: Boolean(taggedTaskResult.created),
                updated: Boolean(taggedTaskResult.updated),
                duplicate: Boolean(taggedTaskResult.duplicate),
                followup: Boolean(taggedTaskResult.followup),
                groupId,
                lineMessageId: String(event?.message?.id || '').trim(),
                quotedMessageId,
                taskId: String(taggedTaskResult?.taskId || ''),
                messagePreview: normalizedMessagePreview
            });
        }

        if (taggedTaskResult?.matched) {
            if (testOrderModeEnabled && !text.startsWith('/')) {
                const taggedTaskParts = [];
                if (taggedTaskResult.title) taggedTaskParts.push(`"${taggedTaskResult.title}"`);
                const tagSigs = [];
                if (taggedTaskResult.aiTaskSignal) tagSigs.push(`AI: ${Math.round((taggedTaskResult.aiConfidence || 0) * 100)}%`);
                if (taggedTaskResult.keywordHits > 0) tagSigs.push(`keyword: ${taggedTaskResult.keywordHits}`);
                if (taggedTaskResult.hasDeadlineSignal) tagSigs.push('deadline');
                if (taggedTaskResult.hasQuestion) tagSigs.push('คำถาม');
                if (taggedTaskResult.fallbackSignal) tagSigs.push(taggedTaskResult.fallbackSignal);
                if (tagSigs.length > 0) taggedTaskParts.push(`สัญญาณ: ${tagSigs.join(', ')}`);
                await replyTestOrderDecision(true, taggedTaskResult.reason || 'created', taggedTaskParts.join('\n'), { title: taggedTaskResult.title || '', aiConfidence: taggedTaskResult.aiConfidence || 0 });
                return;
            }

            const quoteToken = String(event?.message?.quoteToken || '').trim();
            const ackText = taggedTaskResult.duplicate
                ? (taggedTaskResult.followup
                    ? '✅ คำสั่งต่อเนื่องนี้บันทึกไว้แล้วค่ะ'
                    : '✅ ข้อความนี้บันทึกเป็นงานไว้แล้วค่ะ')
                : (taggedTaskResult.followup
                    ? (taggedTaskResult.updated
                        ? '✅ เพิ่มคำสั่งต่อเนื่องเข้าในงานเดิมแล้วค่ะ'
                        : 'รับข้อความต่อเนื่องแล้ว แต่บันทึกงานไม่สำเร็จ กรุณาลองใหม่อีกครั้งค่ะ')
                    : (taggedTaskResult.created
                        ? '✅ บันทึกข้อความเป็นงานเรียบร้อยแล้วค่ะ'
                        : 'รับข้อความแล้ว แต่บันทึกงานไม่สำเร็จ กรุณาลองใหม่อีกครั้งค่ะ'));

            // Use replyOrPush: if replyToken expired (async waitUntil latency),
            // the user still gets a push confirmation and can see the task was saved.
            await replyOrPush(ackText);

            return;
        }

        if (meetingReplyResult?.matched && meetingReplyAckText) {
            if (testOrderModeEnabled && !text.startsWith('/')) {
                const meetReplyDetail = meetingReplyResult.taskId
                    ? `taskId: ${String(meetingReplyResult.taskId).slice(-8)}`
                    : 'quote ตรงกับงานที่มีในระบบ';
                await replyTestOrderDecision(true, 'meeting-reply', meetReplyDetail, { title: '' });
                return;
            }

            const sent = await replyText(replyToken, meetingReplyAckText, env, {
                groupId
            });
            if (!sent) {
                console.log('Meeting reply ack failed (replyToken expired), skipping push');
            }

            return;
        }

        if (!testOrderModeEnabled && !text.startsWith('/')) {
            console.log('🔍 Message processing (AI enabled):', {
                messageLength: text.length,
                hasAssigneeSignal: Boolean(taggedTaskResult?.aiTaskSignal),
                aiEnabled: isTaggedTaskAiEnabled(env),
                taggedTaskReason: String(taggedTaskResult?.reason || ''),
                taggedTaskMatched: Boolean(taggedTaskResult?.matched)
            });
        }

        if (testOrderModeEnabled && !text.startsWith('/')) {
            const tagReason = String(taggedTaskResult?.reason || '');
            const aiConfidence = Number(taggedTaskResult?.aiConfidence || 0);
            const aiThreshold = Number(taggedTaskResult?.aiThreshold || 0);
            const aiTitle = String(taggedTaskResult?.aiTitle || '').trim();
            const isUncertain = tagReason === 'ai-medium-confidence';
            if (isUncertain) {
                const confirmTitle = aiTitle || text.slice(0, 80);
                const scope = resolveAliveModeScope(sourceType, groupId, roomId, lineUserId);
                if (scope) {
                    await writePendingTaskConfirm(scope.docId, {
                        title: confirmTitle,
                        decided: true,
                        decidedReason: 'ai-uncertain-testorder',
                        aiConfidence,
                        aiThreshold,
                        ambiguityFlags: Array.isArray(taggedTaskResult?.ambiguityFlags) ? taggedTaskResult.ambiguityFlags : [],
                        messageText: text.slice(0, 500)
                    }, env);
                }
                const askParts = [
                    `⚠️ AI ไม่แน่ใจ (${Math.round(aiConfidence * 100)}% < ${Math.round(aiThreshold * 100)}%)`,
                    `"${confirmTitle.slice(0, 80)}"`,
                    'ให้บันทึกเป็นงานไหมคะ?',
                    'ตอบ /บันทึก เพื่อบันทึก หรือ /ไม่บันทึก เพื่อข้าม'
                ];
                await replyOrPush(askParts.join('\n'));
                return;
            }
            const noTaskParts = [];
            if (tagReason === 'ai-not-task') {
                noTaskParts.push(`AI: ไม่ใช่งาน (${Math.round(aiConfidence * 100)}%)`);
            } else if (tagReason === 'ai-low-confidence') {
                noTaskParts.push(`AI: confidence ต่ำมาก (${Math.round(aiConfidence * 100)}%)`);
            } else if (tagReason === 'no-task-signal') {
                noTaskParts.push('ไม่มีสัญญาณงานที่ชัดเจน');
            } else if (tagReason === 'not-tagged' || tagReason === 'no-assignee-mention') {
                noTaskParts.push('ไม่มี @mention ผู้รับผิดชอบ');
            } else if (tagReason && tagReason !== 'not-tasklike') {
                noTaskParts.push(tagReason);
            }
            await replyTestOrderDecision(false, 'no-task-signal', noTaskParts.join(', '), { title: '', aiConfidence, messageText: text });
            return;
        }

        // Normal mode (non-testorder): if AI is uncertain, ask user once with Flex confirm
        if (!testOrderModeEnabled) {
            const tagReason = String(taggedTaskResult?.reason || '');
            const aiConfidence = Number(taggedTaskResult?.aiConfidence || 0);
            const aiThreshold = Number(taggedTaskResult?.aiThreshold || 0);
            const aiTitle = String(taggedTaskResult?.aiTitle || '').trim();
            const isUncertain = tagReason === 'ai-medium-confidence';
            if (isUncertain) {
                const confirmTitle = aiTitle || text.slice(0, 80);
                const scope = resolveAliveModeScope(sourceType, groupId, roomId, lineUserId);
                const parsedDateInfo = parseMeetingDateFromText(text);
                const ambiguityFlags = Array.isArray(taggedTaskResult?.ambiguityFlags) ? taggedTaskResult.ambiguityFlags : [];
                const assigneeLabel = resolvePrimaryAssigneeMentionLabel(event, []) || (hasAllAudienceMention(event) ? '@all' : 'ยังไม่ระบุ');
                const deadlineIso = parsedDateInfo?.iso || '';
                const deadlineDisplay = parsedDateInfo?.display || '';
                if (scope) {
                    const existingPending = await readPendingTaskConfirm(scope.docId, env);
                    if (existingPending) {
                        await replyOrPush('มีรายการรอยืนยันอยู่แล้วค่ะ ตอบ /บันทึก หรือ /ไม่บันทึก ภายใน 2 นาที');
                        return;
                    }

                    await writePendingTaskConfirm(scope.docId, {
                        title: confirmTitle,
                        decided: true,
                        decidedReason: 'ai-uncertain',
                        aiConfidence,
                        aiThreshold,
                        ambiguityFlags,
                        assigneeLabel,
                        deadlineIso,
                        deadlineDisplay,
                        messageText: text.slice(0, 500),
                        projectId: groupId || ''
                    }, env);
                }

                const flexPayload = buildPendingTaskConfirmFlexMessage({
                    title: confirmTitle,
                    assigneeLabel,
                    deadlineDisplay,
                    aiConfidence,
                    ambiguityFlags
                });
                const flexSent = await replyFlex(replyToken, flexPayload, env, groupReplyOptions);
                if (!flexSent) {
                    const askParts = [
                        `⚠️ AI ไม่แน่ใจ (${Math.round(aiConfidence * 100)}%)`,
                        `ให้สร้างเป็นงานเลยไหมคะ: "${confirmTitle.slice(0, 80)}"`,
                        `มอบหมาย ${assigneeLabel}${deadlineDisplay ? ` · กำหนดส่ง ${deadlineDisplay}` : ''}`,
                        'ตอบ /บันทึก เพื่อบันทึก หรือ /ไม่บันทึก เพื่อข้าม (หมดอายุใน 2 นาที)'
                    ];
                    await replyOrPush(askParts.join('\n'));
                }
                return;
            }
        }
    }

    // Handle sync command first so user gets an immediate acknowledgement.
    if (isSyncCommand && !isGroup) {
        await replyText(replyToken, 'คำสั่งนี้ใช้ได้เฉพาะในกลุ่มค่ะ', env, groupReplyOptions);
        return;
    }

    if (isAddProjectCommand && !isGroup) {
        await replyText(replyToken, 'คำสั่งนี้ใช้ได้เฉพาะในกลุ่มค่ะ', env, groupReplyOptions);
        return;
    }

    if (isConfirmCommand) {
        const scope = resolveAliveModeScope(sourceType, groupId, roomId, lineUserId);
        const pending = scope ? await readPendingTaskConfirm(scope.docId, env) : null;
        if (!pending) {
            await replyOrPush('ไม่พบรายการที่รอยืนยันค่ะ (อาจหมดเวลา 2 นาที)');
        } else if (isConfirmYesCommand) {
            if (scope) await deletePendingTaskConfirm(scope.docId, env);
            // If this was an uncertain AI decision, create the task now
            if ((pending.decidedReason === 'ai-uncertain' || pending.decidedReason === 'ai-uncertain-testorder') && pending.projectId) {
                const taskDocId = buildMeetingTaskDocId('');
                const nowIso = new Date().toISOString();
                const creatorName = await resolveSenderDisplayName(lineUserId, pending.projectId, env).catch(() => '');
                const taskFields = {
                    id: fsString(taskDocId),
                    projectId: fsString(pending.projectId),
                    title: fsString(pending.title),
                    name: fsString(pending.title),
                    assignee: fsString(creatorName || 'ยังไม่ระบุ'),
                    assignees: fsStringArray([]),
                    lineAssigneeIds: fsStringArray([]),
                    lineAssigneeNames: fsStringArray([]),
                    status: fsString('in-progress'),
                    type: fsString('individual'),
                    value: { integerValue: '0' },
                    formatIssues: { arrayValue: {} },
                    source: fsString('line-confirm'),
                    lineMessageId: fsString(''),
                    lineContextMessageIds: fsStringArray([]),
                    lineUserId: fsString(lineUserId || ''),
                    createdBy: fsString(lineUserId || ''),
                    createdByName: fsString(creatorName || 'สมาชิกในกลุ่ม'),
                    sourceText: fsString(pending.messageText || pending.title),
                    deadline: fsString(String(pending.deadlineIso || '')),
                    deadlineText: fsString(String(pending.deadlineDisplay || '')),
                    createdAt: { timestampValue: nowIso },
                    updatedAt: { timestampValue: nowIso }
                };
                const created = await patchFirestoreDoc(`tasks/${taskDocId}`, taskFields, env, false).catch(() => false);
                if (created) {
                    const okParts = ['✅ บันทึกงานเรียบร้อยแล้วค่ะ', `"${pending.title}"`, `AI: ${Math.round((pending.aiConfidence || 0) * 100)}%`];
                    await replyOrPush(okParts.join('\n'));
                } else {
                    await replyOrPush('บันทึกงานไม่สำเร็จ กรุณาลองใหม่อีกครั้งค่ะ');
                }
            } else {
                const alreadyYes = pending.decided === true;
                const confirmParts = [alreadyYes ? '✅ บันทึก (ยืนยัน)' : '✅ บันทึก (ผู้ใช้เปลี่ยนจากไม่บันทึก)'];
                if (pending.title) confirmParts.push(`"${pending.title}"`);
                if (pending.aiConfidence) confirmParts.push(`AI: ${Math.round(pending.aiConfidence * 100)}%`);
                await replyOrPush(confirmParts.join('\n'));
            }
        } else {
            if (scope) await deletePendingTaskConfirm(scope.docId, env);
            const alreadyNo = pending.decided === false;
            const cancelParts = [alreadyNo ? '❌ ไม่บันทึก (ยืนยัน)' : '❌ ไม่บันทึก (ผู้ใช้เปลี่ยนจากบันทึก)'];
            if (pending.title) cancelParts.push(`"${pending.title}"`);
            await replyOrPush(cancelParts.join('\n'));
        }
        return;
    }

    if (isTestOrderCommand) {
        const enableTestOrderMode = isTestOrderOnCommand;
        const updated = await writeTestOrderModeState(sourceType, groupId, roomId, lineUserId, enableTestOrderMode, env);

        const doneText = enableTestOrderMode
            ? 'เปิดโหมดทดสอบบันทึก/ไม่บันทึกแล้วค่ะ ส่งข้อความมาได้เลย ระบบจะตอบว่า "บันทึก" หรือ "ไม่บันทึก"'
            : 'ปิดโหมดทดสอบบันทึก/ไม่บันทึกแล้วค่ะ';
        const failText = enableTestOrderMode
            ? 'เปิดโหมดทดสอบบันทึก/ไม่บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้งค่ะ'
            : 'ปิดโหมดทดสอบบันทึก/ไม่บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้งค่ะ';
        const responseText = updated ? doneText : failText;

        await replyText(replyToken, responseText, env, groupReplyOptions);
        return;
    }

    if (isSyncCommand && isGroup && groupId) {
        const ackText = 'รับคำสั่งแล้วค่ะ กำลังซิงข้อมูลกลุ่มให้นะคะ';
        const ackSent = await replyText(replyToken, ackText, env, groupReplyOptions);

        // If reply token is invalid/expired, fallback to push in the same group.
        if (!ackSent) {
            await pushText(groupId, ackText, env);
        }

        try {
            const syncResult = await fullGroupSync(groupId, env, { fallbackUserId: lineUserId });
            let doneText = 'ซิงข้อมูลกลุ่มเรียบร้อยแล้วค่ะ';

            if ((syncResult.membersAttempted || 0) === 0) {
                doneText = 'ซิงข้อมูลกลุ่มเรียบร้อยแล้วค่ะ (ยังดึงรายชื่อสมาชิกไม่ได้ในรอบนี้)';
            } else if ((syncResult.membersFailed || 0) > 0 || (syncResult.warnings || []).length > 0) {
                doneText = `ซิงข้อมูลกลุ่มเรียบร้อยแล้วค่ะ (สำเร็จ ${syncResult.membersSynced}/${syncResult.membersAttempted})`;
            }

            await pushText(groupId, doneText, env);
        } catch (err) {
            console.error('Manual group sync error:', err);
            const failText = 'ซิงข้อมูลกลุ่มไม่สำเร็จ กรุณาลองใหม่อีกครั้งค่ะ';

            if (!ackSent) {
                await replyText(replyToken, failText, env, groupReplyOptions);
            }

            await pushText(groupId, failText, env);
        }
        return;
    }

    const userMessage = text;
    const trimmedUserMessage = normalizeIncomingText(userMessage);
    const chatSessionScope = resolveChatSessionScope(sourceType, groupId, roomId, lineUserId);

    if (isAliveOffCommand) {
        if (chatSessionScope) {
            await deleteChatSessionState(chatSessionScope, env).catch((err) => {
                console.error('Delete chat session failed:', err);
            });
        }

        await replyOrPush('ขอบคุณที่ใช้บริการค่ะ พิมพ์ /มีชีวิต ได้เลยนะคะถ้ามีอะไรให้ช่วย');
        return;
    }

    if (isAliveOnCommand) {
        if (!chatSessionScope) {
            await replyOrPush('เปิดโหมดไอน่าไม่สำเร็จ กรุณาลองใหม่อีกครั้งค่ะ');
            return;
        }

        const nowIso = new Date().toISOString();
        const started = await writeChatSessionState(chatSessionScope, lineUserId || '', {
            active: true,
            startedAt: nowIso,
            lastActiveAt: nowIso,
            history: []
        }, env);

        if (!started) {
            await replyOrPush('เปิดโหมดไอน่าไม่สำเร็จ กรุณาลองใหม่อีกครั้งค่ะ');
            return;
        }

        let question = '';
        if (trimmedUserMessage.startsWith('/มีชีวิต ')) {
            question = trimmedUserMessage.slice('/มีชีวิต '.length).trim();
        }

        if (!question) {
            await replyOrPush('ได้ค่ะ ไอน่าพร้อมช่วยงานแล้วค่ะ\nมีอะไรให้ช่วยจัดการไหมคะ?\n\n(พิมพ์ /จบชีวิต หรือทิ้งไว้ 3 นาที เพื่อออก)');
            return;
        }

        const aiText = await askSoundwave(question, env, []).catch((err) => {
            console.error('Ask Aina on start failed:', err);
            return 'ขออภัยค่ะ ระบบ AI ขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งค่ะ';
        });

        const newHistory = trimChatHistory([
            { role: 'user', content: question },
            { role: 'assistant', content: aiText }
        ], 10);

        await writeChatSessionState(chatSessionScope, lineUserId || '', {
            active: true,
            startedAt: nowIso,
            lastActiveAt: new Date().toISOString(),
            history: newHistory
        }, env).catch((err) => {
            console.error('Write chat session history failed:', err);
        });

        await replyOrPush(aiText);
        return;
    }

    const chatSession = await readChatSessionState(sourceType, groupId, roomId, lineUserId, env);
    // ไม่ให้ secretary mode ดัก slash commands หรือคำสั่งระบบ ให้คำสั่งทำงานได้เสมอสำหรับทุกคนในกลุ่ม
    if (chatSession && chatSessionScope && !shouldSkipAutoTaskParsersForCommand) {
        const baseTime = String(chatSession.lastActiveAt || chatSession.startedAt || '').trim();
        const baseMs = baseTime ? new Date(baseTime).getTime() : NaN;
        const elapsed = Number.isFinite(baseMs) ? (Date.now() - baseMs) : 0;

        if (elapsed > 3 * 60 * 1000) {
            await deleteChatSessionState(chatSessionScope, env).catch((err) => {
                console.error('Delete expired chat session failed:', err);
            });

            await replyOrPush('Session หมดเวลาแล้วค่ะ (3 นาที) พิมพ์ /มีชีวิต ใหม่เพื่อคุยต่อได้เลยนะคะ');
            return;
        }

        const history = readChatHistory(chatSession);
        const aiText = await askSoundwave(trimmedUserMessage, env, history).catch((err) => {
            console.error('Ask secretary in session failed:', err);
            return 'ขออภัยค่ะ ระบบ AI ขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งค่ะ';
        });

        const newHistory = trimChatHistory([
            ...history,
            { role: 'user', content: trimmedUserMessage },
            { role: 'assistant', content: aiText }
        ], 10);

        await writeChatSessionState(chatSessionScope, lineUserId || '', {
            active: true,
            startedAt: chatSession.startedAt || new Date().toISOString(),
            lastActiveAt: new Date().toISOString(),
            history: newHistory
        }, env).catch((err) => {
            console.error('Update chat session failed:', err);
        });

        await replyOrPush(aiText);
        return;
    }

    const aiInvocation = parseExplicitAiInvocation(text);
    if (aiInvocation.invoked) {
        if (!replyToken) {
            if (fallbackReplyTarget) {
                await pushText(fallbackReplyTarget, 'ไม่พบ reply token สำหรับข้อความนี้ กรุณาลองพิมพ์ใหม่อีกครั้งค่ะ', env, { groupId: isGroup ? groupId : undefined });
            }
            return;
        }

        if (!aiInvocation.prompt) {
            await replyOrPush('พิมพ์คำสั่งพร้อมคำถาม เช่น /ai ช่วยสรุปงานวันนี้ หรือ @ไอน่า ช่วยจัดลำดับงานด่วนให้หน่อย');
            return;
        }

        const aiReply = await generateAIReply(aiInvocation.prompt, env, 'alive').catch((err) => {
            console.error('AI fatal error:', err);
            return 'ขออภัยค่ะ ระบบ AI ขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งค่ะ';
        });

        await replyOrPush(aiReply);
        return;
    }

    let refreshedGroupIdentity = null;

    if (isGroup && groupId) {
        let knownGroup = null;
        try {
            const knownGroups = await getKnownGroupsSnapshot(env);
            knownGroup = knownGroups.find((entry) => entry.groupId === groupId) || null;
        } catch (err) {
            console.error('Read known groups snapshot error:', err);
        }

        refreshedGroupIdentity = await refreshKnownGroupIdentity(
            groupId,
            env,
            knownGroup || { name: `LINE GROUP ${groupId.slice(-6)}` }
        ).catch((err) => {
            console.error('Refresh known group identity error:', err);
            return null;
        });
    }

    if (isGroup && groupId) {
        const explicitGroupName = refreshedGroupIdentity?.name && !isGenericKnownGroupName(refreshedGroupIdentity.name)
            ? refreshedGroupIdentity.name
            : null;

        await ensureProjectRecord(
            groupId,
            env,
            explicitGroupName,
            refreshedGroupIdentity?.pictureUrl || ''
        ).catch((err) => {
            console.error('Ensure project record failed:', err);
        });

        if (!groupMessagePersisted) {
            const saved = await saveGroupMessage(groupId, lineUserId || '', event, env).catch((err) => {
                console.error('Save group message failed:', err);
                return false;
            });

            if (saved) {
                groupMessagePersisted = true;
            }

            await persistGroupIdentityMetadata('webhook-late', 'webhook-mention-late');
        }
    }

    if (text === 'เชื่อมต่อระบบ') {
        if (!lineUserId) {
            await replyText(replyToken, 'ไม่พบรหัสผู้ใช้ LINE สำหรับการเชื่อมต่อระบบค่ะ', env, groupReplyOptions);
            return;
        }

        try {
            const profile = await fetchLineProfile(lineUserId, isGroup ? groupId : null, env);
            const displayName = profile?.displayName || `LINE-${lineUserId.slice(-6)}`;
            const photoUrl = profile?.pictureUrl || '';

            await createEmployee(lineUserId, displayName, photoUrl, env);
            await upsertLineUser(lineUserId, displayName, env);

            const userCode = `LINE-${lineUserId.slice(-6)}`;
            await replyText(
                replyToken,
                `✅ CEO FLOW: ยินดีต้อนรับ\nคุณ ${displayName} เข้าสู่ระบบของเรา\nรหัส User "${userCode}"`,
                env,
                groupReplyOptions
            );
        } catch (err) {
            console.error('Connect system error:', err);
            await replyText(replyToken, 'เชื่อมต่อระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้งค่ะ', env, groupReplyOptions);
        }
        return;
    }

    if (isAddProjectCommand && isGroup && groupId) {
        try {
            const groupSummary = await getGroupSummary(groupId, env);
            await ensureProjectRecord(groupId, env, groupSummary.name, groupSummary.pictureUrl);
            await replyText(replyToken, 'สร้างโครงการให้แล้วค่ะ ✅', env, groupReplyOptions);
        } catch (err) {
            console.error('Create project command error:', err);
            await replyText(replyToken, 'สร้างโครงการไม่สำเร็จ กรุณาลองใหม่อีกครั้งค่ะ', env, groupReplyOptions);
        }
        return;
    }

    } finally {
        await backgroundSavePromise;
    }
}
