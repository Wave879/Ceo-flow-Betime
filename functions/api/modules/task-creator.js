// ✅ Task creation — meeting summary tasks and tagged tasks

import {
    fsString,
    fsStringArray,
    fsTimelineEntriesArray,
    fsGetDoc,
    patchFirestoreDoc,
    readFirestoreStringField,
    readFirestoreStringArrayField,
    readFirestoreTimelineEntries
} from './firestore.js';
import { sleep } from './line-api.js';
import {
    normalizeIncomingText,
    extractQuotedMessageId,
    parseMeetingSummaryTaskCandidate,
    shouldPreferTaggedTaskForSummaryText,
    buildMeetingTaskDocId,
    sanitizeDocIdSegment,
    findCcBoundaryIndex,
    parseTaggedLineTaskCandidate,
    buildTaggedLineTaskFallbackTitle
} from './message-parser.js';
import { analyzeTaskSourceSentiment } from './sentiment.js';
import {
    getConfiguredBotUserIdSet,
    textMentionsAina,
    hasAllAudienceMention,
    extractManualAssigneeMentionNames,
    buildAssigneeMentionDisplayNameByLineUserId,
    isFallbackLineDisplayName,
    normalizeMentionDisplayName,
    resolvePrimaryAssigneeMentionLabel
} from './mention-processor.js';
import { isLikelyLineUserId, getEmployeeDocIdFromLineUserId, fetchLineProfile } from './line-api.js';
import {
    isTaggedTaskAiEnabled,
    shouldRunTaggedTaskAiFallback,
    parseTaggedLineTaskCandidateWithAI,
    shouldRunAiForGeneralMessages,
    normalizeProbability,
    normalizeIsoDateString,
    formatIsoDateDisplay
} from './ai-task-detection.js';
import {
    resolveReplyInsightAiMode,
    isReplyInsightAiEnabled,
    resolveReplyInsightAiConfidenceThreshold,
    normalizeReplyAiSuggestedStatus,
    parseReplyInsightWithAI
} from './ai-reply-insight.js';
import { buildMessagePreviewText } from './message-persistence.js';
import { fsGetDoc as _fsGetDoc } from './firestore.js';

const LINE_TASK_SOURCE_TYPES = new Set(['line-meeting-summary', 'line-tagged-task']);

function isSupportedLineTaskSource(source = '') {
    const normalizedSource = String(source || '').trim().toLowerCase();
    return LINE_TASK_SOURCE_TYPES.has(normalizedSource);
}

function finalizeMeetingSummaryTaskTitle(baseTitle = '', assigneeMentionLabel = '') {
    let title = normalizeIncomingText(baseTitle).replace(/\s+/g, ' ').trim();
    if (!title) {
        title = 'สรุปประเด็นการประชุม';
    }

    const mentionLabel = String(assigneeMentionLabel || '').replace(/\s+/g, '').trim();
    if (mentionLabel && mentionLabel.startsWith('@') && !title.includes(mentionLabel)) {
        title = `${title} ${mentionLabel}`.trim();
    }

    if (title.length > 180) {
        title = `${title.slice(0, 177)}...`;
    }

    return title;
}

function extractMeetingTaskAssigneeLineUserIds(event, env = {}) {
    const mentions = Array.isArray(event?.message?.mention?.mentions)
        ? event.message.mention.mentions
        : [];

    if (mentions.length === 0) {
        return [];
    }

    const rawText = String(event?.message?.text || '');
    const ccBoundaryIndex = findCcBoundaryIndex(rawText);
    const botIds = getConfiguredBotUserIdSet(env);
    const seen = new Set();
    const assigneeLineUserIds = [];

    for (const mention of mentions) {
        const mentionUserId = String(mention?.userId || '').trim();
        if (!isLikelyLineUserId(mentionUserId)) {
            continue;
        }

        if (botIds.has(mentionUserId)) {
            continue;
        }

        const mentionIndex = Number(mention?.index);
        if (ccBoundaryIndex >= 0 && Number.isFinite(mentionIndex) && mentionIndex >= ccBoundaryIndex) {
            continue;
        }

        if (seen.has(mentionUserId)) {
            continue;
        }

        seen.add(mentionUserId);
        assigneeLineUserIds.push(mentionUserId);
    }

    return assigneeLineUserIds;
}

async function resolveSenderDisplayName(lineUserId, projectId, env = {}) {
    const normalizedLineUserId = String(lineUserId || '').trim();
    if (!isLikelyLineUserId(normalizedLineUserId)) {
        return 'สมาชิกในกลุ่ม';
    }

    const groupUserFields = await fsGetDoc('groupUsers', normalizedLineUserId, env).catch(() => null);
    const cachedName = normalizeIncomingText(groupUserFields?.displayName?.stringValue || '');
    if (cachedName) {
        return cachedName;
    }

    const profile = await fetchLineProfile(normalizedLineUserId, projectId, env).catch(() => null);
    const profileName = normalizeIncomingText(profile?.displayName || '');
    if (profileName) {
        return profileName;
    }

    return `LINE-${normalizedLineUserId.slice(-6)}`;
}

async function resolveMeetingTaskAssignees(event, projectId, fallbackLineUserId, env = {}, options = {}) {
    const mentionAssignees = extractMeetingTaskAssigneeLineUserIds(event, env);
    const mentionDisplayNameByLineUserId = buildAssigneeMentionDisplayNameByLineUserId(event, env);
    const manualAssigneeNamesRaw = Array.isArray(options?.manualAssigneeNames)
        ? options.manualAssigneeNames
        : [];
    const manualAssigneeNames = [];
    const seenManualNames = new Set();
    for (const rawName of manualAssigneeNamesRaw) {
        const normalized = normalizeMentionDisplayName(rawName);
        const normalizedKey = normalized.toLowerCase();
        if (!normalized || seenManualNames.has(normalizedKey)) {
            continue;
        }
        seenManualNames.add(normalizedKey);
        manualAssigneeNames.push(normalized);
    }

    let assigneeLineUserIds = mentionAssignees;

    const normalizedFallbackLineUserId = String(fallbackLineUserId || '').trim();
    if (assigneeLineUserIds.length === 0 && isLikelyLineUserId(normalizedFallbackLineUserId)) {
        assigneeLineUserIds = [normalizedFallbackLineUserId];
    }

    const assigneeEmployeeIds = [];
    for (const assigneeLineUserId of assigneeLineUserIds) {
        const employeeId = getEmployeeDocIdFromLineUserId(assigneeLineUserId);
        if (employeeId) {
            assigneeEmployeeIds.push(employeeId);
        }
    }

    const assigneeNames = [...manualAssigneeNames];
    for (const assigneeLineUserId of assigneeLineUserIds) {
        const resolvedName = await resolveSenderDisplayName(assigneeLineUserId, projectId, env);
        const mentionName = String(mentionDisplayNameByLineUserId.get(assigneeLineUserId) || '').trim();
        const preferredName = isFallbackLineDisplayName(resolvedName) && mentionName
            ? mentionName
            : String(resolvedName || mentionName).trim();

        if (!preferredName) {
            continue;
        }

        if (!assigneeNames.includes(preferredName)) {
            assigneeNames.push(preferredName);
        }
    }

    return {
        assigneeLineUserIds,
        assigneeEmployeeIds: [...new Set(assigneeEmployeeIds)],
        assigneeNames
    };
}

function isBotTaggedMeetingSummary(event, env = {}) {
    const text = String(event?.message?.text || '');
    if (textMentionsAina(text)) {
        return true;
    }

    if (hasAllAudienceMention(event)) {
        return true;
    }

    const mentions = Array.isArray(event?.message?.mention?.mentions)
        ? event.message.mention.mentions
        : [];

    if (mentions.length === 0) {
        return false;
    }

    const configuredBotIds = getConfiguredBotUserIdSet(env);
    if (configuredBotIds.size === 0) {
        return true;
    }

    for (const mention of mentions) {
        const mentionUserId = String(mention?.userId || '').trim();
        if (configuredBotIds.has(mentionUserId)) {
            return true;
        }
    }

    return false;
}

async function tryCreateMeetingSummaryTask(event, env, options = {}) {
    const projectId = String(options?.projectId || '').trim();
    const lineUserId = String(options?.lineUserId || '').trim();
    if (!projectId) {
        return { matched: false, created: false, reason: 'missing-project' };
    }

    const messageText = normalizeIncomingText(event?.message?.text || '');
    const parsedCandidate = parseMeetingSummaryTaskCandidate(messageText);
    if (!parsedCandidate.matched) {
        return { matched: false, created: false, reason: 'not-summary' };
    }

    if (shouldPreferTaggedTaskForSummaryText(messageText)) {
        return { matched: false, created: false, reason: 'prefer-tagged' };
    }

    const hasBotSignal = isBotTaggedMeetingSummary(event, env);
    const hasAllAudienceSignal = hasAllAudienceMention(event);
    const hasCcSignal = findCcBoundaryIndex(messageText) >= 0;
    const hasAssigneeMentionSignal = extractMeetingTaskAssigneeLineUserIds(event, env).length > 0
        || extractManualAssigneeMentionNames(messageText).length > 0;
    const allowImplicitSummaryTrigger = hasAllAudienceSignal || hasCcSignal || hasAssigneeMentionSignal;

    if (!hasBotSignal && !allowImplicitSummaryTrigger) {
        return { matched: false, created: false, reason: 'not-tagged' };
    }

    if (options?.dryRun) {
        return {
            matched: true,
            created: false,
            duplicate: false,
            taskId: '',
            deadlineIso: parsedCandidate.deadlineIso || '',
            reason: 'dry-run',
            title: parsedCandidate.title || '',
            hasBotSignal,
            hasCcSignal,
            hasAssigneeMentionSignal,
            hasAllAudienceSignal
        };
    }

    const lineMessageId = String(event?.message?.id || '').trim();
    const quotedMessageId = extractQuotedMessageId(event?.message || {});
    const lineContextMessageIds = [lineMessageId, quotedMessageId]
        .map((value) => String(value || '').trim())
        .filter(Boolean);
    const taskDocId = buildMeetingTaskDocId(lineMessageId);

    if (lineMessageId) {
        const existing = await fsGetDoc('tasks', taskDocId, env).catch(() => null);
        if (existing) {
            return {
                matched: true,
                created: false,
                duplicate: true,
                taskId: taskDocId,
                deadlineIso: parsedCandidate.deadlineIso,
                reason: 'duplicate'
            };
        }
    }

    const creatorName = await resolveSenderDisplayName(lineUserId, projectId, env);
    const assigneeInfo = await resolveMeetingTaskAssignees(event, projectId, lineUserId, env);
    const primaryAssigneeMentionLabel = resolvePrimaryAssigneeMentionLabel(event, assigneeInfo.assigneeLineUserIds);
    const normalizedTaskTitle = finalizeMeetingSummaryTaskTitle(parsedCandidate.title, primaryAssigneeMentionLabel);
    const assigneeDisplayName = assigneeInfo.assigneeNames[0] || creatorName || 'ยังไม่ระบุ';
    const sourceSentiment = analyzeTaskSourceSentiment(parsedCandidate.rawText || messageText);
    
    // Use event.timestamp (when message was sent to LINE) as createdAt, not current time
    const createdAtRaw = Number(event?.timestamp);
    const createdAtIso = Number.isFinite(createdAtRaw) && createdAtRaw > 0
        ? new Date(createdAtRaw).toISOString()
        : new Date().toISOString();
    const nowIso = new Date().toISOString();

    const fields = {
        id: fsString(taskDocId),
        projectId: fsString(projectId),
        title: fsString(normalizedTaskTitle),
        name: fsString(normalizedTaskTitle),
        assignee: fsString(assigneeDisplayName),
        assignees: fsStringArray(assigneeInfo.assigneeEmployeeIds),
        lineAssigneeIds: fsStringArray(assigneeInfo.assigneeLineUserIds),
        lineAssigneeNames: fsStringArray(assigneeInfo.assigneeNames),
        status: fsString('in-progress'),
        type: fsString(assigneeInfo.assigneeEmployeeIds.length > 1 ? 'team' : 'individual'),
        value: { integerValue: '0' },
        formatIssues: { arrayValue: {} },
        source: fsString('line-meeting-summary'),
        lineMessageId: fsString(lineMessageId),
        lineContextMessageIds: fsStringArray(lineContextMessageIds),
        lineUserId: fsString(lineUserId),
        createdBy: fsString(lineUserId),
        createdByName: fsString(creatorName || 'สมาชิกในกลุ่ม'),
        sourceText: fsString(parsedCandidate.rawText),
        messageSentiment: fsString(sourceSentiment.type),
        messageSentimentLabel: fsString(sourceSentiment.label),
        messageSentimentEmoji: fsString(sourceSentiment.emoji),
        messageSentimentScore: { integerValue: String(sourceSentiment.score) },
        deadline: fsString(parsedCandidate.deadlineIso || ''),
        deadlineText: fsString(parsedCandidate.deadlineDisplay || ''),
        startDate: fsString(createdAtIso.split('T')[0] || ''),
        createdAt: { timestampValue: createdAtIso },
        updatedAt: { timestampValue: nowIso }
    };

    let created = false;
    for (let attempt = 0; attempt < 3; attempt++) {
        created = await patchFirestoreDoc(`tasks/${taskDocId}`, fields, env, false);
        if (created) {
            break;
        }

        await sleep(120 * (attempt + 1));
    }

    return {
        matched: true,
        created,
        duplicate: false,
        taskId: taskDocId,
        deadlineIso: parsedCandidate.deadlineIso,
        reason: created ? 'created' : 'write-failed'
    };
}

async function tryCreateTaggedLineTask(event, env, options = {}) {
    const projectId = String(options?.projectId || '').trim();
    const lineUserId = String(options?.lineUserId || '').trim();
    if (!projectId) {
        return { matched: false, created: false, reason: 'missing-project' };
    }

    const messageText = normalizeIncomingText(event?.message?.text || '');
    const assigneeMentionLineUserIds = extractMeetingTaskAssigneeLineUserIds(event, env);
    const manualAssigneeNames = extractManualAssigneeMentionNames(messageText);
    const isBotTagged = isBotTaggedMeetingSummary(event, env);
    const hasAllMention = hasAllAudienceMention(event);
    const hasAssigneeSignal = assigneeMentionLineUserIds.length > 0
        || manualAssigneeNames.length > 0
        || hasAllMention;

    let parsedCandidate = parseTaggedLineTaskCandidate(messageText);

    if (
        !parsedCandidate.matched
        && parsedCandidate.reason === 'no-task-signal'
        && hasAssigneeSignal
        && isBotTagged
    ) {
        const fallbackTitle = buildTaggedLineTaskFallbackTitle(messageText);
        if (fallbackTitle) {
            parsedCandidate = {
                matched: true,
                title: fallbackTitle,
                deadlineIso: '',
                deadlineDisplay: '',
                rawText: normalizeIncomingText(messageText).replace(/\s+/g, ' ').trim(),
                hasDeadlineSignal: false,
                hasQuestion: false,
                keywordHits: 0,
                fallbackSignal: 'assignee-mention'
            };
        }
    }

    const shouldRunAiFallback = false; // DISABLED: Azure too slow + unreliable. Use keyword detection only.

    if (shouldRunAiFallback && !options?.dryRun) {
        const aiCandidate = await parseTaggedLineTaskCandidateWithAI(messageText, env).catch((err) => ({
            matched: false,
            reason: 'ai-exception',
            aiError: err?.message || String(err)
        }));

        if (aiCandidate?.matched) {
            parsedCandidate = aiCandidate;
        } else if (String(aiCandidate?.reason || '').startsWith('ai-')) {
            const aiReason = aiCandidate.reason || '';
            parsedCandidate = {
                ...parsedCandidate,
                matched: false,
                reason: aiReason,
                aiConfidence: aiCandidate.aiConfidence,
                aiThreshold: aiCandidate.aiThreshold,
                aiMediumThreshold: aiCandidate.aiMediumThreshold,
                aiBand: aiCandidate.aiBand,
                aiTitle: aiCandidate.aiTitle || '',
                ambiguityFlags: Array.isArray(aiCandidate.ambiguityFlags) ? aiCandidate.ambiguityFlags : []
            };
        }
    }

    if (options?.dryRun && options?.dryRunAiResult && !(parsedCandidate.aiConfidence > 0)) {
        const aiCandidate = options.dryRunAiResult;
        parsedCandidate = {
            ...parsedCandidate,
            aiTaskSignal: aiCandidate.aiTaskSignal ?? parsedCandidate.aiTaskSignal,
            aiConfidence: aiCandidate.aiConfidence ?? parsedCandidate.aiConfidence,
            aiThreshold: aiCandidate.aiThreshold ?? parsedCandidate.aiThreshold
        };
    }

    const debugSummary = {
        projectId,
        lineUserId,
        isBotTagged,
        hasAllMention,
        hasAssigneeSignal,
        structuredMentionCount: assigneeMentionLineUserIds.length,
        manualMentionCount: manualAssigneeNames.length,
        manualMentionNames: manualAssigneeNames,
        parsedMatched: Boolean(parsedCandidate?.matched),
        parsedReason: String(parsedCandidate?.reason || ''),
        hasDeadlineSignal: Boolean(parsedCandidate?.hasDeadlineSignal),
        keywordHits: Number(parsedCandidate?.keywordHits || 0),
        aiTaskSignal: Boolean(parsedCandidate?.aiTaskSignal),
        aiConfidence: Number(parsedCandidate?.aiConfidence || 0),
        aiThreshold: Number(parsedCandidate?.aiThreshold || 0),
        messagePreview: String(messageText || '').replace(/\s+/g, ' ').slice(0, 240)
    };
    console.log('🔍 Tagged task parser summary:', debugSummary);

    if (!parsedCandidate.matched) {
        console.log('🔍 Tagged task skipped - trying general message AI:', {
            ...debugSummary,
            skippedReason: String(parsedCandidate.reason || 'not-tasklike')
        });
        
        // Try general message AI if enabled
        const shouldUseGeneralMessageAi = shouldRunAiForGeneralMessages(messageText, env);
        console.log('🤖 General message AI eligibility:', {
            eligible: shouldUseGeneralMessageAi,
            textLength: messageText.length,
            textPreview: messageText.slice(0, 80)
        });
        
        if (shouldUseGeneralMessageAi && !options?.dryRun) {
            console.log('🤖 Invoking AI for general message...');
            const aiCandidate = await parseTaggedLineTaskCandidateWithAI(messageText, env).catch((err) => ({
                matched: false,
                reason: 'ai-exception',
                aiError: err?.message || String(err)
            }));
            
            console.log('🤖 General message AI result:', {
                matched: Boolean(aiCandidate?.matched),
                reason: String(aiCandidate?.reason || ''),
                confidence: Number(aiCandidate?.aiConfidence || 0)
            });
            
            if (aiCandidate?.matched) {
                console.log('🤖 AI match! Creating task from general message');
                parsedCandidate = aiCandidate;
            }
        }
        
        // If still no match, return failure
        if (!parsedCandidate.matched) {
            console.log('🔍 No task detected (neither tagged nor AI matched)');
            return {
                matched: false,
                created: false,
                reason: parsedCandidate.reason || 'not-tasklike',
                aiConfidence: parsedCandidate.aiConfidence,
                aiThreshold: parsedCandidate.aiThreshold,
                aiMediumThreshold: parsedCandidate.aiMediumThreshold,
                aiBand: parsedCandidate.aiBand,
                aiTitle: parsedCandidate.aiTitle || '',
                ambiguityFlags: Array.isArray(parsedCandidate.ambiguityFlags) ? parsedCandidate.ambiguityFlags : []
            };
        }
    }

    const lineMessageId = String(event?.message?.id || '').trim();
    const quotedMessageId = extractQuotedMessageId(event?.message || {});
    const lineContextMessageIds = [lineMessageId, quotedMessageId]
        .map((value) => String(value || '').trim())
        .filter(Boolean);

    if (options?.dryRun) {
        return {
            matched: true,
            created: false,
            duplicate: false,
            followup: false,
            taskId: '',
            deadlineIso: parsedCandidate.deadlineIso || '',
            reason: 'dry-run',
            title: parsedCandidate.title || '',
            aiTaskSignal: parsedCandidate.aiTaskSignal || false,
            aiConfidence: parsedCandidate.aiConfidence || 0,
            keywordHits: parsedCandidate.keywordHits || 0,
            hasDeadlineSignal: parsedCandidate.hasDeadlineSignal || false,
            hasQuestion: parsedCandidate.hasQuestion || false,
            fallbackSignal: parsedCandidate.fallbackSignal || ''
        };
    }

    if (quotedMessageId) {
        const quotedTaskDocId = buildMeetingTaskDocId(quotedMessageId);
        const quotedTaskFields = await fsGetDoc('tasks', quotedTaskDocId, env).catch(() => null);
        if (quotedTaskFields) {
            const source = readFirestoreStringField(quotedTaskFields, 'source');
            if (isSupportedLineTaskSource(source)) {
                const taskProjectId = readFirestoreStringField(quotedTaskFields, 'projectId');
                if (taskProjectId && taskProjectId !== projectId) {
                    return { matched: false, created: false, reason: 'project-mismatch' };
                }

                const existingTimelineEntries = readFirestoreTimelineEntries(quotedTaskFields, 'timelineEntries');
                const existingContextMessageIds = readFirestoreStringArrayField(quotedTaskFields, 'lineContextMessageIds');
                const isDuplicateFollowUp = Boolean(lineMessageId)
                    && (
                        existingContextMessageIds.includes(lineMessageId)
                        || existingTimelineEntries.some((entry) => entry.replyLineMessageId === lineMessageId)
                    );

                if (isDuplicateFollowUp) {
                    return {
                        matched: true,
                        created: false,
                        updated: false,
                        duplicate: true,
                        followup: true,
                        taskId: quotedTaskDocId,
                        reason: 'duplicate-followup'
                    };
                }

                const messageType = String(event?.message?.type || '').trim().toLowerCase() || 'text';
                const followUpText = messageType === 'text'
                    ? (messageText || buildMessagePreviewText(messageType, event?.message || {}, messageText))
                    : buildMessagePreviewText(messageType, event?.message || {}, '');
                const actorName = await resolveSenderDisplayName(lineUserId, projectId, env);
                const createdAtRaw = Number(event?.timestamp);
                const nowIso = Number.isFinite(createdAtRaw) && createdAtRaw > 0
                    ? new Date(createdAtRaw).toISOString()
                    : new Date().toISOString();
                const timelineEntryId = lineMessageId
                    ? `line_followup_${sanitizeDocIdSegment(lineMessageId).slice(0, 64)}`
                    : `line_followup_${Date.now()}`;

                const nextTimelineEntries = [
                    ...existingTimelineEntries,
                    {
                        id: timelineEntryId,
                        time: nowIso,
                        title: 'สั่งต่อจากงานเดิมใน LINE',
                        detail: followUpText || '-',
                        actor: actorName || `LINE-${lineUserId.slice(-6)}`,
                        tone: 'violet',
                        replyLineMessageId: lineMessageId
                    }
                ].slice(-80);

                const nextContextMessageIds = [
                    ...new Set([
                        ...existingContextMessageIds,
                        ...lineContextMessageIds
                    ].filter(Boolean))
                ].slice(-120);

                const currentStatus = readFirestoreStringField(quotedTaskFields, 'status');
                const shouldReopen = currentStatus === 'completed' || currentStatus === 'abandoned';

                const updated = await patchFirestoreDoc(`tasks/${quotedTaskDocId}`, {
                    timelineEntries: fsTimelineEntriesArray(nextTimelineEntries),
                    lineContextMessageIds: fsStringArray(nextContextMessageIds),
                    lastUpdate: fsString(followUpText || '-'),
                    lastUpdatedAt: { timestampValue: nowIso },
                    lastUpdatedBy: fsString(lineUserId),
                    lastUpdatedByName: fsString(actorName || ''),
                    updatedAt: { timestampValue: nowIso },
                    updatedBy: fsString(lineUserId),
                    updatedByName: fsString(actorName || ''),
                    ...(shouldReopen ? { status: fsString('in-progress') } : {})
                }, env, false);

                return {
                    matched: true,
                    created: false,
                    updated,
                    duplicate: false,
                    followup: true,
                    taskId: quotedTaskDocId,
                    reason: updated
                        ? (shouldReopen ? 'followup-recorded-reopened' : 'followup-recorded')
                        : 'write-failed'
                };
            }
        }
    }

    const hasStrongTaskSignal = Boolean(parsedCandidate.forceCommand)
        || Boolean(parsedCandidate.hasDeadlineSignal)
        || Boolean(parsedCandidate.aiTaskSignal);
    
    // ✅ Force command (/สั่ง) สร้าง task ได้โดยไม่ต้องมี @mention
    if (parsedCandidate.forceCommand) {
        // Accept even without assignee for /สั่ง command
    } else if (!hasAssigneeSignal && !hasStrongTaskSignal) {
        console.log('Tagged task skipped: no-assignee-or-signal', {
            ...debugSummary,
            hasStrongTaskSignal
        });
        return { matched: false, created: false, reason: 'no-assignee-mention' };
    }

    const taskDocId = buildMeetingTaskDocId(lineMessageId);
    if (lineMessageId) {
        const existing = await fsGetDoc('tasks', taskDocId, env).catch(() => null);
        if (existing) {
            return {
                matched: true,
                created: false,
                duplicate: true,
                followup: false,
                taskId: taskDocId,
                deadlineIso: parsedCandidate.deadlineIso,
                reason: 'duplicate'
            };
        }
    }

    const creatorName = await resolveSenderDisplayName(lineUserId, projectId, env);
    const assigneeInfo = await resolveMeetingTaskAssignees(event, projectId, lineUserId, env, {
        manualAssigneeNames
    });
    const primaryAssigneeMentionLabel = resolvePrimaryAssigneeMentionLabel(event, assigneeInfo.assigneeLineUserIds)
        || (manualAssigneeNames.length > 0 ? `@${manualAssigneeNames[0].replace(/\s+/g, '')}` : '');
    const normalizedTaskTitle = finalizeMeetingSummaryTaskTitle(parsedCandidate.title, primaryAssigneeMentionLabel);
    const assigneeDisplayName = assigneeInfo.assigneeNames[0] || creatorName || 'ยังไม่ระบุ';
    const sourceSentiment = analyzeTaskSourceSentiment(parsedCandidate.rawText || messageText);
    
    // Use event.timestamp (when message was sent to LINE) as createdAt, not current time
    const createdAtRaw = Number(event?.timestamp);
    const createdAtIso = Number.isFinite(createdAtRaw) && createdAtRaw > 0
        ? new Date(createdAtRaw).toISOString()
        : new Date().toISOString();
    const nowIso = new Date().toISOString();

    const fields = {
        id: fsString(taskDocId),
        projectId: fsString(projectId),
        title: fsString(normalizedTaskTitle),
        name: fsString(normalizedTaskTitle),
        assignee: fsString(assigneeDisplayName),
        assignees: fsStringArray(assigneeInfo.assigneeEmployeeIds),
        lineAssigneeIds: fsStringArray(assigneeInfo.assigneeLineUserIds),
        lineAssigneeNames: fsStringArray(assigneeInfo.assigneeNames),
        status: fsString('in-progress'),
        type: fsString(assigneeInfo.assigneeEmployeeIds.length > 1 ? 'team' : 'individual'),
        value: { integerValue: '0' },
        formatIssues: { arrayValue: {} },
        source: fsString('line-tagged-task'),
        lineMessageId: fsString(lineMessageId),
        lineContextMessageIds: fsStringArray(lineContextMessageIds),
        lineUserId: fsString(lineUserId),
        createdBy: fsString(lineUserId),
        createdByName: fsString(creatorName || 'สมาชิกในกลุ่ม'),
        sourceText: fsString(parsedCandidate.rawText),
        messageSentiment: fsString(sourceSentiment.type),
        messageSentimentLabel: fsString(sourceSentiment.label),
        messageSentimentEmoji: fsString(sourceSentiment.emoji),
        messageSentimentScore: { integerValue: String(sourceSentiment.score) },
        deadline: fsString(parsedCandidate.deadlineIso || ''),
        deadlineText: fsString(parsedCandidate.deadlineDisplay || ''),
        startDate: fsString(createdAtIso.split('T')[0] || ''),
        createdAt: { timestampValue: createdAtIso },
        updatedAt: { timestampValue: nowIso }
    };

    let created = false;
    for (let attempt = 0; attempt < 3; attempt++) {
        created = await patchFirestoreDoc(`tasks/${taskDocId}`, fields, env, false);
        if (created) {
            break;
        }

        await sleep(120 * (attempt + 1));
    }

    return {
        matched: true,
        created,
        duplicate: false,
        followup: false,
        taskId: taskDocId,
        deadlineIso: parsedCandidate.deadlineIso,
        reason: created ? 'created' : 'write-failed'
    };
}

async function tryRecordMeetingSummaryTaskReply(event, env, options = {}) {
    const projectId = String(options?.projectId || '').trim();
    const lineUserId = String(options?.lineUserId || '').trim();
    const quotedMessageId = extractQuotedMessageId(event?.message || {});
    if (!projectId || !quotedMessageId || !lineUserId) {
        return { matched: false, updated: false, reason: 'not-reply' };
    }

    const taskDocId = buildMeetingTaskDocId(quotedMessageId);
    const taskFields = await fsGetDoc('tasks', taskDocId, env).catch(() => null);
    if (!taskFields) {
        return { matched: false, updated: false, reason: 'no-task' };
    }

    const source = readFirestoreStringField(taskFields, 'source');
    if (!isSupportedLineTaskSource(source)) {
        return { matched: false, updated: false, reason: 'not-line-task' };
    }

    const taskProjectId = readFirestoreStringField(taskFields, 'projectId');
    if (taskProjectId && taskProjectId !== projectId) {
        return { matched: false, updated: false, reason: 'project-mismatch' };
    }

    const lineAssigneeIds = readFirestoreStringArrayField(taskFields, 'lineAssigneeIds');
    const createdByLineUserId = readFirestoreStringField(taskFields, 'createdBy');
    const isTaskCreator = createdByLineUserId && createdByLineUserId === lineUserId;
    if (lineAssigneeIds.length > 0 && !lineAssigneeIds.includes(lineUserId) && !isTaskCreator) {
        return { matched: false, updated: false, reason: 'not-assignee', taskId: taskDocId };
    }

    const replyLineMessageId = String(event?.message?.id || '').trim();
    const existingReplyLineMessageIds = readFirestoreStringArrayField(taskFields, 'replyLineMessageIds');
    if (replyLineMessageId && existingReplyLineMessageIds.includes(replyLineMessageId)) {
        return { matched: true, updated: false, reason: 'duplicate-reply', taskId: taskDocId };
    }

    const messageType = String(event?.message?.type || '').trim().toLowerCase() || 'text';
    const text = messageType === 'text' ? normalizeIncomingText(event?.message?.text || '') : '';
    const replyPreviewText = text || buildMessagePreviewText(messageType, event?.message || {}, text);
    const actorName = await resolveSenderDisplayName(lineUserId, projectId, env);

    const replyAiInsight = messageType === 'text'
        ? await parseReplyInsightWithAI(replyPreviewText, taskFields, env).catch((err) => ({
            matched: false,
            reason: 'ai-exception',
            mode: resolveReplyInsightAiMode(env),
            confidence: 0,
            aiError: err?.message || String(err)
        }))
        : {
            matched: false,
            reason: 'ai-non-text',
            mode: resolveReplyInsightAiMode(env),
            confidence: 0
        };

    const replyAiMode = replyAiInsight.mode || resolveReplyInsightAiMode(env);
    const replyAiConfidence = normalizeProbability(replyAiInsight.confidence, 0);
    const replyAiThreshold = resolveReplyInsightAiConfidenceThreshold(env);
    const canAutoApplyReplyInsight = replyAiMode === 'auto'
        && replyAiInsight.matched
        && replyAiConfidence >= replyAiThreshold;

    const suggestedStatusForAuto = canAutoApplyReplyInsight
        ? normalizeReplyAiSuggestedStatus(replyAiInsight.suggestStatus)
        : '';
    const suggestedDeadlineIsoForAuto = canAutoApplyReplyInsight
        ? normalizeIsoDateString(replyAiInsight.suggestDeadlineIso)
        : '';
    const suggestedDeadlineDisplayForAuto = formatIsoDateDisplay(suggestedDeadlineIsoForAuto);

    const createdAtRaw = Number(event?.timestamp);
    const nowIso = Number.isFinite(createdAtRaw) && createdAtRaw > 0
        ? new Date(createdAtRaw).toISOString()
        : new Date().toISOString();

    const existingTimelineEntries = readFirestoreTimelineEntries(taskFields, 'timelineEntries');
    const timelineEntryId = replyLineMessageId
        ? `line_reply_${sanitizeDocIdSegment(replyLineMessageId).slice(0, 64)}`
        : `line_reply_${Date.now()}`;

    if (replyLineMessageId && existingTimelineEntries.some((entry) => entry.replyLineMessageId === replyLineMessageId)) {
        return { matched: true, updated: false, reason: 'duplicate-reply', taskId: taskDocId };
    }

    const timelineEntries = [
        ...existingTimelineEntries,
        {
            id: timelineEntryId,
            time: nowIso,
            title: 'ตอบกลับงานจาก LINE',
            detail: replyPreviewText || '-',
            actor: actorName || `LINE-${lineUserId.slice(-6)}`,
            tone: 'blue',
            replyLineMessageId
        }
    ];

    if (replyAiInsight.matched) {
        const aiTimelineDetailParts = [
            String(replyAiInsight.summary || replyPreviewText || '-').trim()
        ];

        if (replyAiInsight.intent && replyAiInsight.intent !== 'other') {
            aiTimelineDetailParts.push(`intent=${replyAiInsight.intent}`);
        }

        if (replyAiInsight.suggestStatus) {
            aiTimelineDetailParts.push(`suggestStatus=${replyAiInsight.suggestStatus}`);
        }

        if (replyAiInsight.suggestDeadlineIso) {
            aiTimelineDetailParts.push(`suggestDeadline=${replyAiInsight.suggestDeadlineIso}`);
        }

        if (canAutoApplyReplyInsight && (suggestedStatusForAuto || suggestedDeadlineIsoForAuto)) {
            aiTimelineDetailParts.push('applied=auto');
        }

        const aiTimelineEntryId = replyLineMessageId
            ? `line_reply_ai_${sanitizeDocIdSegment(replyLineMessageId).slice(0, 60)}`
            : `line_reply_ai_${Date.now()}`;

        timelineEntries.push({
            id: aiTimelineEntryId,
            time: nowIso,
            title: canAutoApplyReplyInsight
                ? 'AI วิเคราะห์คำตอบรีเพล (ปรับงานอัตโนมัติ)'
                : 'AI วิเคราะห์คำตอบรีเพล',
            detail: aiTimelineDetailParts.join(' | ').slice(0, 380),
            actor: 'AI Insight',
            tone: canAutoApplyReplyInsight ? 'green' : 'amber',
            replyLineMessageId
        });
    }

    const nextTimelineEntries = timelineEntries.slice(-60);

    const nextReplyLineMessageIds = replyLineMessageId
        ? [...new Set([...existingReplyLineMessageIds, replyLineMessageId])].slice(-100)
        : existingReplyLineMessageIds;

    const existingLineContextMessageIds = readFirestoreStringArrayField(taskFields, 'lineContextMessageIds');
    const nextLineContextMessageIds = [
        ...new Set([
            ...existingLineContextMessageIds,
            quotedMessageId,
            replyLineMessageId
        ].filter(Boolean))
    ].slice(-120);

    const aiInsightUpdatedFields = messageType === 'text'
        ? {
            replyAiMode: fsString(replyAiMode),
            replyAiConfidence: fsString(String(replyAiConfidence)),
            replyAiThreshold: fsString(String(replyAiThreshold)),
            replyAiIntent: fsString(String(replyAiInsight.intent || '')),
            replyAiSummary: fsString(String(replyAiInsight.summary || '')),
            replyAiReason: fsString(String(replyAiInsight.aiReason || replyAiInsight.reason || '')),
            replyAiSuggestedStatus: fsString(String(replyAiInsight.suggestStatus || '')),
            replyAiSuggestedDeadline: fsString(String(replyAiInsight.suggestDeadlineIso || '')),
            replyAiAutoApplied: { booleanValue: Boolean(canAutoApplyReplyInsight && (suggestedStatusForAuto || suggestedDeadlineIsoForAuto)) },
            replyAiUpdatedAt: { timestampValue: nowIso }
        }
        : {};

    const replyUpdateFields = {
        timelineEntries: fsTimelineEntriesArray(nextTimelineEntries),
        replyLineMessageIds: fsStringArray(nextReplyLineMessageIds),
        lineContextMessageIds: fsStringArray(nextLineContextMessageIds),
        replyAnswerText: fsString(replyPreviewText || '-'),
        replyAnswerAt: { timestampValue: nowIso },
        replyAnswerBy: fsString(lineUserId),
        replyAnswerByName: fsString(actorName || ''),
        lastUpdate: fsString(replyPreviewText || '-'),
        lastUpdatedAt: { timestampValue: nowIso },
        lastUpdatedBy: fsString(lineUserId),
        lastUpdatedByName: fsString(actorName || ''),
        updatedAt: { timestampValue: nowIso },
        updatedBy: fsString(lineUserId),
        updatedByName: fsString(actorName || ''),
        ...aiInsightUpdatedFields,
        ...(canAutoApplyReplyInsight && suggestedStatusForAuto
            ? { status: fsString(suggestedStatusForAuto) }
            : {}),
        ...(canAutoApplyReplyInsight && suggestedDeadlineIsoForAuto
            ? {
                deadline: fsString(suggestedDeadlineIsoForAuto),
                deadlineText: fsString(suggestedDeadlineDisplayForAuto || '')
            }
            : {})
    };

    const updated = await patchFirestoreDoc(`tasks/${taskDocId}`, {
        ...taskFields,
        ...replyUpdateFields
    }, env, false);

    const autoApplied = Boolean(canAutoApplyReplyInsight && (suggestedStatusForAuto || suggestedDeadlineIsoForAuto));
    const recordedReason = autoApplied
        ? 'reply-recorded-ai-auto'
        : (replyAiInsight.matched ? 'reply-recorded-ai' : 'reply-recorded');

    return {
        matched: true,
        updated,
        taskId: taskDocId,
        reason: updated ? recordedReason : 'write-failed',
        aiMode: replyAiMode,
        aiAutoApplied: autoApplied,
        aiConfidence: replyAiConfidence
    };
}

export {
    LINE_TASK_SOURCE_TYPES,
    isSupportedLineTaskSource,
    finalizeMeetingSummaryTaskTitle,
    extractMeetingTaskAssigneeLineUserIds,
    resolveSenderDisplayName,
    resolveMeetingTaskAssignees,
    isBotTaggedMeetingSummary,
    tryCreateMeetingSummaryTask,
    tryCreateTaggedLineTask,
    tryRecordMeetingSummaryTaskReply
};
