// ✅ AI reply insight analysis

import { normalizeIncomingText, parseMeetingDateFromText } from './message-parser.js';
import { normalizeKnownGroupInGroup } from './data-normalizer.js';
import { readFirestoreStringField } from './firestore.js';
import {
    getTaggedTaskAiDeploymentName,
    normalizeProbability,
    normalizeIsoDateString,
    formatIsoDateDisplay,
    parseJsonObjectFromModelContent
} from './ai-task-detection.js';

function resolveReplyInsightAiMode(env = {}) {
    const normalized = String(
        env?.LINE_REPLY_AI_MODE
        || env?.LINE_TASK_REPLY_AI_MODE
        || 'conservative'
    ).trim().toLowerCase();

    if (normalized === 'auto') {
        return 'auto';
    }

    if (normalized === 'off' || normalized === 'disabled' || normalized === 'false') {
        return 'off';
    }

    return 'conservative';
}

function isReplyInsightAiEnabled(env = {}) {
    const mode = resolveReplyInsightAiMode(env);
    if (mode === 'off') {
        return false;
    }

    const configured = normalizeKnownGroupInGroup(
        env?.LINE_REPLY_AI_ENABLED ?? env?.LINE_TASK_REPLY_AI_ENABLED
    );

    if (configured === false) {
        return false;
    }

    return true;
}

function resolveReplyInsightAiConfidenceThreshold(env = {}) {
    const rawValue = Number(
        env?.LINE_REPLY_AI_CONFIDENCE
        ?? env?.LINE_TASK_REPLY_AI_CONFIDENCE
        ?? 0.82
    );

    if (!Number.isFinite(rawValue)) {
        return 0.82;
    }

    if (rawValue < 0.5) {
        return 0.5;
    }

    if (rawValue > 0.98) {
        return 0.98;
    }

    return rawValue;
}

function normalizeReplyAiSuggestedStatus(rawStatus = '') {
    const text = String(rawStatus || '').trim();
    if (!text) {
        return '';
    }

    const normalized = text.toLowerCase().replace(/_/g, '-');
    if (
        normalized === 'completed'
        || normalized === 'done'
        || normalized === 'finished'
        || normalized === 'finish'
        || normalized === 'closed'
        || normalized === 'close'
    ) {
        return 'completed';
    }

    if (
        normalized === 'abandoned'
        || normalized === 'abandon'
        || normalized === 'cancelled'
        || normalized === 'canceled'
        || normalized === 'cancel'
        || normalized === 'dropped'
        || normalized === 'drop'
    ) {
        return 'abandoned';
    }

    if (
        normalized === 'in-progress'
        || normalized === 'inprogress'
        || normalized === 'ongoing'
        || normalized === 'progress'
        || normalized === 'working'
        || normalized === 'wip'
        || normalized === 'blocked'
        || normalized === 'pending'
        || normalized === 'on-hold'
        || normalized === 'hold'
    ) {
        return 'in-progress';
    }

    if (/เสร็จ|สำเร็จ|ปิดงาน/u.test(text)) {
        return 'completed';
    }

    if (/ยกเลิก|พักงาน|ทิ้งงาน/u.test(text)) {
        return 'abandoned';
    }

    if (/คืบหน้า|ทำต่อ|กำลังทำ|ติดปัญหา|รอดำเนิน/u.test(text)) {
        return 'in-progress';
    }

    return '';
}

function normalizeReplyAiIntent(rawIntent = '') {
    const normalized = String(rawIntent || '').trim().toLowerCase();
    const allowed = new Set(['progress', 'completed', 'blocked', 'deadline_update', 'question', 'other']);
    if (allowed.has(normalized)) {
        return normalized;
    }

    return 'other';
}

function getReplyInsightAiDeploymentName(env = {}) {
    return String(
        env?.AZURE_OPENAI_DEPLOYMENT_REPLY
        || env?.AZURE_OPENAI_DEPLOYMENT_TASK_CAPTURE
        || getTaggedTaskAiDeploymentName(env)
    ).trim();
}

async function parseReplyInsightWithAI(replyText = '', taskFields = {}, env = {}) {
    const mode = resolveReplyInsightAiMode(env);
    if (!isReplyInsightAiEnabled(env)) {
        return { matched: false, reason: 'ai-disabled', mode, confidence: 0 };
    }

    const compactText = normalizeIncomingText(replyText).replace(/\s+/g, ' ').trim();
    if (!compactText) {
        return { matched: false, reason: 'ai-empty-text', mode, confidence: 0 };
    }

    const azureEndpoint = String(env?.AZURE_OPENAI_ENDPOINT || '').replace(/\/$/, '');
    const azureKey = String(env?.AZURE_OPENAI_KEY || '').trim();
    const deployment = getReplyInsightAiDeploymentName(env);
    const apiVersion = env?.AZURE_OPENAI_API_VERSION || '2024-02-15-preview';

    if (!azureEndpoint || !azureKey || !deployment) {
        return { matched: false, reason: 'ai-missing-config', mode, confidence: 0 };
    }

    const taskTitle = readFirestoreStringField(taskFields, 'title')
        || readFirestoreStringField(taskFields, 'name')
        || 'ไม่ระบุชื่อ';
    const currentStatus = readFirestoreStringField(taskFields, 'status') || 'in-progress';
    const currentDeadline = readFirestoreStringField(taskFields, 'deadline') || '';

    const systemPrompt = [
        'You analyze a LINE reply to a task and output exactly one JSON object.',
        'Use keys: isRelevant(boolean), summary(string), intent(string), suggestStatus(string), suggestDeadlineIso(string), confidence(number), reason(string).',
        'intent must be one of: progress, completed, blocked, deadline_update, question, other.',
        'suggestStatus must be one of: in-progress, completed, abandoned, or empty string.',
        'suggestDeadlineIso must be YYYY-MM-DD or empty string.',
        'If uncertain, set isRelevant=false and confidence low. Return JSON only.'
    ].join(' ');

    const userPrompt = JSON.stringify({
        taskTitle,
        currentStatus,
        currentDeadline,
        replyText: compactText
    });

    const requestBodyBase = {
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ],
        max_tokens: 240,
        temperature: 0.1
    };

    const url = `${azureEndpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
    const sendRequest = async (useJsonResponseFormat) => {
        const payload = useJsonResponseFormat
            ? { ...requestBodyBase, response_format: { type: 'json_object' } }
            : requestBodyBase;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);
        try {
            return await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': azureKey
                },
                body: JSON.stringify(payload),
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeoutId);
        }
    };

    let response;
    try {
        response = await sendRequest(true);
    } catch (err) {
        return {
            matched: false,
            reason: 'ai-request-failed',
            mode,
            confidence: 0,
            aiError: err?.message || String(err)
        };
    }

    if (!response.ok) {
        const firstErrorText = await response.text();
        const shouldRetryWithoutResponseFormat = response.status === 400
            && /response_format|json_object|json mode|unsupported/i.test(firstErrorText);

        if (!shouldRetryWithoutResponseFormat) {
            return {
                matched: false,
                reason: 'ai-http-error',
                mode,
                confidence: 0,
                aiStatus: response.status,
                aiError: firstErrorText
            };
        }

        try {
            response = await sendRequest(false);
        } catch (err) {
            return {
                matched: false,
                reason: 'ai-request-failed',
                mode,
                confidence: 0,
                aiError: err?.message || String(err)
            };
        }

        if (!response.ok) {
            const retryErrorText = await response.text();
            return {
                matched: false,
                reason: 'ai-http-error',
                mode,
                confidence: 0,
                aiStatus: response.status,
                aiError: retryErrorText
            };
        }
    }

    let data = null;
    try {
        data = await response.json();
    } catch (_) {
        return { matched: false, reason: 'ai-invalid-json-response', mode, confidence: 0 };
    }

    const content = String(data?.choices?.[0]?.message?.content || '').trim();
    if (!content) {
        return { matched: false, reason: 'ai-empty-content', mode, confidence: 0 };
    }

    const payload = parseJsonObjectFromModelContent(content);
    if (!payload) {
        return { matched: false, reason: 'ai-parse-failed', mode, confidence: 0 };
    }

    const isRelevant = payload?.isRelevant === true
        || String(payload?.isRelevant || '').trim().toLowerCase() === 'true';
    const confidence = normalizeProbability(payload?.confidence, 0);

    const summary = normalizeIncomingText(payload?.summary || '').replace(/\s+/g, ' ').trim() || compactText;
    const intent = normalizeReplyAiIntent(payload?.intent || payload?.type || payload?.action || '');
    const suggestStatus = normalizeReplyAiSuggestedStatus(payload?.suggestStatus || payload?.status || '');

    let suggestDeadlineIso = normalizeIsoDateString(
        payload?.suggestDeadlineIso || payload?.deadlineIso || payload?.deadline || payload?.dueDate || ''
    );
    if (!suggestDeadlineIso) {
        const dateInfo = parseMeetingDateFromText(compactText);
        suggestDeadlineIso = dateInfo?.iso || '';
    }

    if (!isRelevant) {
        return {
            matched: false,
            reason: 'ai-not-relevant',
            mode,
            confidence,
            summary,
            intent,
            suggestStatus,
            suggestDeadlineIso,
            aiReason: String(payload?.reason || '').trim()
        };
    }

    return {
        matched: true,
        reason: 'ai-matched',
        mode,
        confidence,
        summary,
        intent,
        suggestStatus,
        suggestDeadlineIso,
        aiReason: String(payload?.reason || '').trim()
    };
}

export {
    resolveReplyInsightAiMode,
    isReplyInsightAiEnabled,
    resolveReplyInsightAiConfidenceThreshold,
    normalizeReplyAiSuggestedStatus,
    normalizeReplyAiIntent,
    getReplyInsightAiDeploymentName,
    parseReplyInsightWithAI
};
