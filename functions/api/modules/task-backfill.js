// ✅ Task backfill from stored messages

import { fsGetDoc } from './firestore.js';
import { readFirestoreStringField } from './firestore.js';
import { normalizeNonNegativeInteger } from './data-normalizer.js';
import { buildMeetingTaskDocId } from './message-parser.js';
import { walkFirestoreCollection, getFirestoreDocId } from './member-sync.js';
import { tryCreateMeetingSummaryTask, tryCreateTaggedLineTask } from './task-creator.js';

function resolveTaskBackfillMaxMessages(rawValue) {
    const parsed = normalizeNonNegativeInteger(rawValue);
    if (parsed === null) {
        return 60;
    }

    return Math.min(300, parsed);
}

function resolveTaskBackfillMaxAgeDays(rawValue) {
    const parsed = normalizeNonNegativeInteger(rawValue);
    if (parsed === null) {
        return 21;
    }

    if (parsed === 0) {
        return null;
    }

    return Math.min(120, parsed);
}

function readFirestoreTimestampMs(fields, key) {
    const timestampValue = String(fields?.[key]?.timestampValue || fields?.[key]?.stringValue || '').trim();
    if (!timestampValue) {
        return 0;
    }

    const ms = Date.parse(timestampValue);
    return Number.isFinite(ms) ? ms : 0;
}

function buildSyntheticGroupTextEventFromStoredMessage(groupId, messageRecord = {}) {
    const lineMessageId = String(messageRecord?.lineMessageId || '').trim();
    const text = String(messageRecord?.text || '').trim();
    if (!lineMessageId || !text) {
        return null;
    }

    const lineUserId = String(messageRecord?.lineUserId || '').trim();
    const quotedMessageId = String(messageRecord?.quotedMessageId || '').trim();
    const quoteToken = String(messageRecord?.quoteToken || '').trim();
    const createdAtMs = Number(messageRecord?.createdAtMs || 0);

    const event = {
        type: 'message',
        source: {
            type: 'group',
            groupId,
            userId: lineUserId
        },
        timestamp: createdAtMs > 0 ? createdAtMs : Date.now(),
        message: {
            id: lineMessageId,
            type: 'text',
            text
        }
    };

    if (quotedMessageId) {
        event.message.quotedMessageId = quotedMessageId;
    }

    if (quoteToken) {
        event.message.quoteToken = quoteToken;
    }

    return event;
}

async function backfillGroupTasksFromStoredMessages(groupId, env = {}, options = {}) {
    const normalizedGroupId = String(groupId || '').trim();
    if (!normalizedGroupId) {
        return {
            enabled: false,
            reason: 'missing-group-id',
            scanned: 0,
            eligible: 0,
            processed: 0,
            created: 0,
            updated: 0,
            duplicates: 0,
            skipped: 0,
            errors: 0,
            warnings: []
        };
    }

    const maxMessages = resolveTaskBackfillMaxMessages(
        options?.maxMessages ?? env?.LINE_TASK_BACKFILL_MAX_MESSAGES
    );
    if (maxMessages <= 0) {
        return {
            enabled: false,
            reason: 'disabled',
            scanned: 0,
            eligible: 0,
            processed: 0,
            created: 0,
            updated: 0,
            duplicates: 0,
            skipped: 0,
            errors: 0,
            warnings: []
        };
    }

    const maxAgeDays = resolveTaskBackfillMaxAgeDays(
        options?.maxAgeDays ?? env?.LINE_TASK_BACKFILL_MAX_AGE_DAYS
    );
    const cutoffMs = Number.isFinite(maxAgeDays)
        ? Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000)
        : 0;

    const warnings = [];
    const storedMessages = [];

    const listResult = await walkFirestoreCollection(
        `projects/${normalizedGroupId}/messages`,
        env,
        (doc) => {
            const fields = doc?.fields || {};
            const senderRole = readFirestoreStringField(fields, 'senderRole');
            const lineUserId = readFirestoreStringField(fields, 'lineUserId');
            const messageType = readFirestoreStringField(fields, 'type') || 'text';
            const text = readFirestoreStringField(fields, 'text');
            const lineMessageId = readFirestoreStringField(fields, 'lineMessageId');

            if (messageType !== 'text') {
                return;
            }

            if (!lineMessageId || !text) {
                return;
            }

            if (senderRole === 'bot' || lineUserId === '__bot__') {
                return;
            }

            const createdAtMs = readFirestoreTimestampMs(fields, 'createdAt');
            if (cutoffMs > 0 && createdAtMs > 0 && createdAtMs < cutoffMs) {
                return;
            }

            storedMessages.push({
                lineMessageId,
                lineUserId,
                text,
                quotedMessageId: readFirestoreStringField(fields, 'quotedMessageId'),
                quoteToken: readFirestoreStringField(fields, 'quoteToken'),
                createdAtMs,
                docId: getFirestoreDocId(doc?.name)
            });
        },
        { pageSize: 300, maxPages: 40 }
    );

    if (listResult.warning) {
        warnings.push(listResult.warning);
    }

    storedMessages.sort((left, right) => {
        const leftTime = Number(left?.createdAtMs || 0);
        const rightTime = Number(right?.createdAtMs || 0);
        if (leftTime !== rightTime) {
            return leftTime - rightTime;
        }

        const leftId = String(left?.lineMessageId || left?.docId || '');
        const rightId = String(right?.lineMessageId || right?.docId || '');
        return leftId.localeCompare(rightId);
    });

    const eligible = storedMessages.length;
    const targetMessages = eligible > maxMessages
        ? storedMessages.slice(eligible - maxMessages)
        : storedMessages;

    const summary = {
        enabled: true,
        maxMessages,
        maxAgeDays,
        scanned: listResult.scanned,
        eligible,
        processed: 0,
        created: 0,
        updated: 0,
        duplicates: 0,
        skipped: 0,
        errors: 0,
        warnings,
        truncated: Boolean(listResult.truncated)
    };

    for (const record of targetMessages) {
        summary.processed += 1;

        const lineMessageId = String(record?.lineMessageId || '').trim();
        if (!lineMessageId) {
            summary.skipped += 1;
            continue;
        }

        const taskDocId = buildMeetingTaskDocId(lineMessageId);
        const existingTask = await fsGetDoc('tasks', taskDocId, env).catch(() => null);
        if (existingTask) {
            summary.duplicates += 1;
            continue;
        }

        const syntheticEvent = buildSyntheticGroupTextEventFromStoredMessage(normalizedGroupId, record);
        if (!syntheticEvent) {
            summary.skipped += 1;
            continue;
        }

        const syntheticLineUserId = String(record?.lineUserId || '').trim();

        const meetingTaskResult = await tryCreateMeetingSummaryTask(syntheticEvent, env, {
            projectId: normalizedGroupId,
            lineUserId: syntheticLineUserId
        }).catch((err) => ({
            matched: false,
            created: false,
            reason: `exception:${err?.message || String(err)}`
        }));

        if (meetingTaskResult?.matched) {
            if (meetingTaskResult.created) {
                summary.created += 1;
            } else if (meetingTaskResult.duplicate) {
                summary.duplicates += 1;
            } else {
                summary.skipped += 1;
                if (meetingTaskResult.reason === 'write-failed' || String(meetingTaskResult.reason || '').startsWith('exception:')) {
                    summary.errors += 1;
                }
            }
            continue;
        }

        const taggedTaskResult = await tryCreateTaggedLineTask(syntheticEvent, env, {
            projectId: normalizedGroupId,
            lineUserId: syntheticLineUserId
        }).catch((err) => ({
            matched: false,
            created: false,
            reason: `exception:${err?.message || String(err)}`
        }));

        if (taggedTaskResult?.matched) {
            if (taggedTaskResult.created) {
                summary.created += 1;
            } else if (taggedTaskResult.updated) {
                summary.updated += 1;
            } else if (taggedTaskResult.duplicate) {
                summary.duplicates += 1;
            } else {
                summary.skipped += 1;
                if (taggedTaskResult.reason === 'write-failed' || String(taggedTaskResult.reason || '').startsWith('exception:')) {
                    summary.errors += 1;
                }
            }
        } else {
            summary.skipped += 1;
            if (String(taggedTaskResult?.reason || '').startsWith('exception:')) {
                summary.errors += 1;
            }
        }
    }

    console.log('Task backfill summary:', {
        groupId: normalizedGroupId,
        scanned: summary.scanned,
        eligible: summary.eligible,
        processed: summary.processed,
        created: summary.created,
        updated: summary.updated,
        duplicates: summary.duplicates,
        skipped: summary.skipped,
        errors: summary.errors,
        truncated: summary.truncated
    });

    return summary;
}

export {
    resolveTaskBackfillMaxMessages,
    resolveTaskBackfillMaxAgeDays,
    readFirestoreTimestampMs,
    buildSyntheticGroupTextEventFromStoredMessage,
    backfillGroupTasksFromStoredMessages
};
