// ✅ AI-based task detection (tagged task)

import { normalizeIncomingText, parseMeetingDateFromText, buildTaggedLineTaskFallbackTitle, extractQuotedMessageId } from './message-parser.js';
import { normalizeKnownGroupInGroup } from './data-normalizer.js';

function getTaggedTaskAiDeploymentName(env = {}) {
    return String(
        env?.AZURE_OPENAI_DEPLOYMENT_TASK_CAPTURE
        || env?.AZURE_OPENAI_DEPLOYMENT
        || env?.AZURE_DEPLOYMENT_NAME
        || ''
    ).trim();
}

function isTaggedTaskAiEnabled(env = {}) {
    const endpoint = String(env?.AZURE_OPENAI_ENDPOINT || '').trim();
    const key = String(env?.AZURE_OPENAI_KEY || '').trim();
    const deployment = getTaggedTaskAiDeploymentName(env);
    if (!endpoint || !key || !deployment) {
        return false;
    }

    const configuredValue = normalizeKnownGroupInGroup(
        env?.LINE_TAGGED_TASK_AI_ENABLED ?? env?.LINE_TASK_AI_ENABLED
    );

    if (configuredValue === null) {
        return true;
    }

    return configuredValue;
}

function resolveTaggedTaskAiHighConfidenceThreshold(env = {}) {
    const rawValue = Number(
        env?.LINE_TAGGED_TASK_AI_CONFIDENCE_HIGH
        ?? env?.LINE_TASK_AI_CONFIDENCE_HIGH
        ?? env?.LINE_TAGGED_TASK_AI_CONFIDENCE
        ?? env?.LINE_TASK_AI_CONFIDENCE
        ?? 0.82
    );

    if (!Number.isFinite(rawValue)) {
        return 0.82;
    }

    if (rawValue < 0.65) {
        return 0.65;
    }

    if (rawValue > 0.98) {
        return 0.98;
    }

    return rawValue;
}

function resolveTaggedTaskAiMediumConfidenceThreshold(env = {}) {
    const high = resolveTaggedTaskAiHighConfidenceThreshold(env);
    const rawValue = Number(
        env?.LINE_TAGGED_TASK_AI_CONFIDENCE_MEDIUM
        ?? env?.LINE_TASK_AI_CONFIDENCE_MEDIUM
        ?? 0.6
    );

    if (!Number.isFinite(rawValue)) {
        return 0.6;
    }

    if (rawValue < 0.35) {
        return 0.35;
    }

    if (rawValue >= high) {
        return Math.max(0.35, high - 0.01);
    }

    return rawValue;
}

function classifyTaggedTaskAiBand(confidence, env = {}) {
    const normalizedConfidence = normalizeProbability(confidence, 0);
    const highThreshold = resolveTaggedTaskAiHighConfidenceThreshold(env);
    const mediumThreshold = resolveTaggedTaskAiMediumConfidenceThreshold(env);

    if (normalizedConfidence >= highThreshold) {
        return {
            band: 'high',
            mediumThreshold,
            highThreshold
        };
    }

    if (normalizedConfidence >= mediumThreshold) {
        return {
            band: 'medium',
            mediumThreshold,
            highThreshold
        };
    }

    return {
        band: 'low',
        mediumThreshold,
        highThreshold
    };
}

function normalizeAmbiguityFlags(value) {
    const raw = Array.isArray(value)
        ? value
        : (typeof value === 'string' && value.trim() ? value.split(/[\s,|/]+/) : []);

    const allowed = new Set([
        'assignee_missing',
        'assignee_multiple',
        'deadline_missing',
        'deadline_unclear',
        'intent_unclear',
        'status_update_vs_new_task'
    ]);

    return raw
        .map((item) => String(item || '').trim().toLowerCase())
        .filter((item, index, array) => item && allowed.has(item) && array.indexOf(item) === index)
        .slice(0, 6);
}

function parseTaggedTaskCeoLexicon(env = {}) {
    const rawJson = String(env?.LINE_TASK_CEO_LEXICON_JSON || '').trim();
    if (!rawJson) {
        return [];
    }

    try {
        const parsed = JSON.parse(rawJson);
        if (!Array.isArray(parsed)) {
            return [];
        }

        return parsed
            .map((entry) => ({
                phrase: String(entry?.phrase || '').trim(),
                meaning: String(entry?.meaning || entry?.intent || '').trim(),
                titleHint: String(entry?.titleHint || '').trim()
            }))
            .filter((entry) => entry.phrase)
            .slice(0, 30);
    } catch {
        return [];
    }
}

function buildTaggedTaskCeoLexiconPromptHint(env = {}) {
    const lexiconEntries = parseTaggedTaskCeoLexicon(env);
    if (lexiconEntries.length === 0) {
        return '';
    }

    const lines = lexiconEntries.map((entry) => {
        const parts = [entry.phrase];
        if (entry.meaning) {
            parts.push(`=> ${entry.meaning}`);
        }
        if (entry.titleHint) {
            parts.push(`(titleHint: ${entry.titleHint})`);
        }
        return parts.join(' ');
    });

    return `CEO-specific vocabulary hints: ${lines.join(' | ')}`;
}

function normalizeProbability(value, fallback = 0) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    if (parsed < 0) {
        return 0;
    }

    if (parsed > 1) {
        return 1;
    }

    return parsed;
}

function normalizeIsoDateString(rawDate = '') {
    const text = String(rawDate || '').trim();
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
        return '';
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
        return '';
    }

    const date = new Date(Date.UTC(year, month - 1, day));
    if (
        date.getUTCFullYear() !== year
        || date.getUTCMonth() !== (month - 1)
        || date.getUTCDate() !== day
    ) {
        return '';
    }

    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function formatIsoDateDisplay(isoDate = '') {
    const normalized = normalizeIsoDateString(isoDate);
    if (!normalized) {
        return '';
    }

    const [, year, month, day] = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/) || [];
    if (!year || !month || !day) {
        return '';
    }

    return `${day}/${month}`;
}

function parseJsonObjectFromModelContent(content = '') {
    const text = String(content || '').trim();
    if (!text) {
        return null;
    }

    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed;
        }
    } catch (_) {
        // continue and try best-effort extraction
    }

    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) {
        return null;
    }

    try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed;
        }
    } catch (_) {
        return null;
    }

    return null;
}

function shouldRunTaggedTaskAiFallback(messageText = '', parsedCandidate = {}, options = {}) {
    const reason = String(parsedCandidate?.reason || '').trim().toLowerCase();
    if (reason === 'command') {
        return false;
    }

    const compactText = normalizeIncomingText(messageText).replace(/\s+/g, ' ').trim();
    if (!compactText || compactText.length < 10 || compactText.startsWith('/')) {
        return false;
    }

    if (options?.hasAssigneeSignal || options?.isBotTagged || options?.hasAllMention) {
        return true;
    }

    const quotedMessageId = extractQuotedMessageId(options?.event?.message || {});
    if (quotedMessageId) {
        return true;
    }

    if (parsedCandidate?.matched) {
        return false;
    }

    const strongIntentPattern = /(ภายใน|deadline|due|ก่อนวันที่|เมื่อไหร่|นัดหมาย|next\s*step|nextstep|next-step|follow\s*-?\s*up|followup|สรุปให้|สรุปประเด็น|สรุปประชุม|สรุปการประชุม|ประเมิน|หารือ|ติดตามงาน|ติดตามด้วย|รบกวนช่วย|ฝากดำเนินการ|ดำเนินการให้|รายงานให้|วิเคราะห์|รีวิวให้|assign|todo|task)/iu;
    return strongIntentPattern.test(compactText);
}

function shouldRunAiForGeneralMessages(messageText = '', env = {}) {
    // Enable general message AI analysis ONLY if Azure is configured
    if (!isTaggedTaskAiEnabled(env)) {
        return false;
    }

    const compactText = normalizeIncomingText(messageText).replace(/\s+/g, ' ').trim();
    if (!compactText || compactText.length < 5 || compactText.startsWith('/')) {
        return false;
    }

    // ONLY skip extremely obvious non-task patterns
    // Thai common words that are usually NOT tasks (very strict filter)
    const skipPattern = /^(สวัสดี|สวัสดีค่ะ|สวัสดีครับ|ไปเอา|มาบ้าน|อยู่บ้าน|ได้ยินไหม|ไม่ได้|ใช่|ไม่ใช่|โอเค|OK|เข้าใจ|ขอบคุณ|ขอบใจ|ขอบคุณค่ะ|ขอบใจนะ|ไม่เป็นไร|ได้เลย|ได้แล่ว|เดี๋ยวนี้|อยู่|ที่ไหน|อันไหน|ไหนครับ|ไหนคะ|เหรอ|จริงไหม|ต่อครับ|ต่อค่ะ|รับทราบ|โอเคค่ะ|โอเครับ)+$/iu;
    
    if (skipPattern.test(compactText)) {
        return false;
    }

    // Allow AI for all other messages (general text, potential tasks, queries, etc.)
    return true;
}

async function parseTaggedLineTaskCandidateWithAI(rawText = '', env = {}) {
    const compactText = normalizeIncomingText(rawText).replace(/\s+/g, ' ').trim();
    if (!compactText) {
        console.log('🤖 Azure AI: empty text');
        return { matched: false, reason: 'ai-empty-text' };
    }

    if (!isTaggedTaskAiEnabled(env)) {
        console.log('🤖 Azure AI: disabled (missing config)');
        return { matched: false, reason: 'ai-disabled' };
    }

    const azureEndpoint = String(env?.AZURE_OPENAI_ENDPOINT || '').replace(/\/$/, '');
    const azureKey = String(env?.AZURE_OPENAI_KEY || '').trim();
    const deployment = getTaggedTaskAiDeploymentName(env);
    const apiVersion = env?.AZURE_OPENAI_API_VERSION || '2024-02-15-preview';

    if (!azureEndpoint || !azureKey || !deployment) {
        console.log('🤖 Azure AI: missing config', {
            hasEndpoint: Boolean(azureEndpoint),
            hasKey: Boolean(azureKey),
            hasDeployment: Boolean(deployment)
        });
        return { matched: false, reason: 'ai-missing-config' };
    }

    console.log('🤖 Azure AI: calling...', {
        endpoint: azureEndpoint.slice(-30),
        deployment,
        textLength: compactText.length
    });

    const url = `${azureEndpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
    const systemPrompt = [
        'You extract actionable task assignments from LINE chat messages for project management.',
        'Return only one JSON object with keys:',
        'isTask (boolean), title (string), deadlineIso (string YYYY-MM-DD or empty string), confidence (number 0..1), reason (string), ambiguityFlags (array of strings).',
        'Set isTask=true ONLY when the message is a clear REQUEST or ASSIGNMENT for someone to perform work — e.g. "ช่วยทำ...", "ให้...ดำเนินการ", "ฝาก...", "รบกวน...", "@mention โปรดทำ...".',
        'Set isTask=false for: project status updates, progress reports, brainstorming/discussion, sharing information, describing past events, proposing ideas without assigning anyone, narrating what someone already did.',
        'ambiguityFlags must only contain values from: assignee_missing, assignee_multiple, deadline_missing, deadline_unclear, intent_unclear, status_update_vs_new_task.',
        'Use concise Thai title when possible. Never return markdown or extra text.'
    ].join(' ');

    const ceoLexiconPromptHint = buildTaggedTaskCeoLexiconPromptHint(env);

    const userPrompt = ceoLexiconPromptHint
        ? `ข้อความจาก LINE: ${compactText}\n\n${ceoLexiconPromptHint}`
        : `ข้อความจาก LINE: ${compactText}`;
    const requestBodyBase = {
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ],
        max_tokens: 220,
        temperature: 0.1
    };

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
        console.log('🤖 Azure AI: request failed', { error: err?.message || String(err) });
        return { matched: false, reason: 'ai-request-failed', aiError: err?.message || String(err) };
    }

    if (!response.ok) {
        const firstErrorText = await response.text();
        console.log('🤖 Azure AI: HTTP error', { status: response.status, message: firstErrorText.slice(0, 200) });
        const shouldRetryWithoutResponseFormat = response.status === 400
            && /response_format|json_object|json mode|unsupported/i.test(firstErrorText);

        if (!shouldRetryWithoutResponseFormat) {
            return {
                matched: false,
                reason: 'ai-http-error',
                aiStatus: response.status,
                aiError: firstErrorText
            };
        }

        try {
            response = await sendRequest(false);
        } catch (err) {
            console.log('🤖 Azure AI: retry failed', { error: err?.message || String(err) });
            return { matched: false, reason: 'ai-request-failed', aiError: err?.message || String(err) };
        }

        if (!response.ok) {
            const retryErrorText = await response.text();
            console.log('🤖 Azure AI: retry HTTP error', { status: response.status });
            return {
                matched: false,
                reason: 'ai-http-error',
                aiStatus: response.status,
                aiError: retryErrorText
            };
        }
    }

    let data = null;
    try {
        data = await response.json();
    } catch (_) {
        console.log('🤖 Azure AI: JSON parse failed');
        return { matched: false, reason: 'ai-invalid-json-response' };
    }

    const content = String(data?.choices?.[0]?.message?.content || '').trim();
    if (!content) {
        console.log('🤖 Azure AI: empty content');
        return { matched: false, reason: 'ai-empty-content' };
    }

    const payload = parseJsonObjectFromModelContent(content);
    if (!payload) {
        console.log('🤖 Azure AI: parse JSON failed', { contentLength: content.length });
        return { matched: false, reason: 'ai-parse-failed' };
    }

    const isTask = payload?.isTask === true
        || String(payload?.isTask || '').trim().toLowerCase() === 'true';
    const confidence = normalizeProbability(payload?.confidence, 0);
    const ambiguityFlags = normalizeAmbiguityFlags(payload?.ambiguityFlags);
    const aiBand = classifyTaggedTaskAiBand(confidence, env);

    console.log('🤖 Azure AI: success', {
        isTask,
        confidence: Math.round(confidence * 100) + '%',
        band: aiBand.band,
        title: String(payload?.title || '').slice(0, 60)
    });

    if (!isTask) {
        return {
            matched: false,
            reason: 'ai-not-task',
            aiConfidence: confidence,
            aiBand: aiBand.band,
            ambiguityFlags
        };
    }

    if (aiBand.band === 'low') {
        return {
            matched: false,
            reason: 'ai-low-confidence',
            aiConfidence: confidence,
            aiThreshold: aiBand.highThreshold,
            aiMediumThreshold: aiBand.mediumThreshold,
            aiBand: aiBand.band,
            aiTitle: String(payload?.title || '').trim(),
            ambiguityFlags
        };
    }

    if (aiBand.band === 'medium') {
        return {
            matched: false,
            reason: 'ai-medium-confidence',
            aiConfidence: confidence,
            aiThreshold: aiBand.highThreshold,
            aiMediumThreshold: aiBand.mediumThreshold,
            aiBand: aiBand.band,
            aiTitle: String(payload?.title || '').trim(),
            ambiguityFlags
        };
    }

    let deadlineIso = normalizeIsoDateString(payload?.deadlineIso || payload?.deadline || payload?.dueDate || '');
    let deadlineDisplay = formatIsoDateDisplay(deadlineIso);

    if (!deadlineIso) {
        const dateInfo = parseMeetingDateFromText(compactText);
        deadlineIso = dateInfo?.iso || '';
        deadlineDisplay = dateInfo?.display || '';
    }

    const fallbackTitleSeed = String(payload?.title || '').trim() || compactText;
    const title = buildTaggedLineTaskFallbackTitle(fallbackTitleSeed);
    if (!title) {
        return {
            matched: false,
            reason: 'ai-empty-title',
            aiConfidence: confidence
        };
    }

    return {
        matched: true,
        title,
        deadlineIso,
        deadlineDisplay,
        rawText: compactText,
        hasDeadlineSignal: Boolean(deadlineIso),
        hasQuestion: /[?？]/u.test(compactText),
        keywordHits: 0,
        aiTaskSignal: true,
        aiConfidence: confidence,
        aiBand: aiBand.band,
        ambiguityFlags,
        aiReason: String(payload?.reason || '').trim()
    };
}

export {
    getTaggedTaskAiDeploymentName,
    isTaggedTaskAiEnabled,
    resolveTaggedTaskAiHighConfidenceThreshold,
    resolveTaggedTaskAiMediumConfidenceThreshold,
    classifyTaggedTaskAiBand,
    normalizeAmbiguityFlags,
    parseTaggedTaskCeoLexicon,
    buildTaggedTaskCeoLexiconPromptHint,
    normalizeProbability,
    normalizeIsoDateString,
    formatIsoDateDisplay,
    parseJsonObjectFromModelContent,
    shouldRunTaggedTaskAiFallback,
    shouldRunAiForGeneralMessages,
    parseTaggedLineTaskCandidateWithAI
};
