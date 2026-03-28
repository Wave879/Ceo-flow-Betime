// ✅ Mention processing utilities

import { normalizeIncomingText, findCcBoundaryIndex } from './message-parser.js';
import { isLikelyLineUserId } from './line-api.js';

function getConfiguredBotUserIdSet(env = {}) {
    const candidates = [
        env?.LINE_BOT_USER_ID,
        env?.LINE_OFFICIAL_ACCOUNT_USER_ID,
        env?.LINE_OFFICIAL_USER_ID
    ];

    const ids = new Set();
    for (const candidate of candidates) {
        const normalized = String(candidate || '').trim();
        if (isLikelyLineUserId(normalized)) {
            ids.add(normalized);
        }
    }

    return ids;
}

function textMentionsAina(rawText = '') {
    const text = normalizeIncomingText(rawText).toLowerCase();
    if (!text) {
        return false;
    }

    const normalized = text
        .replace(/[\u2010-\u2015\-_\.]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return normalized.includes('@aina')
        || normalized.includes('aina bt')
        || normalized.includes('@aina bt')
        || normalized.includes('@ไอน่า')
        || normalized.includes('ไอน่า')
        || normalized.includes('aina');
}

function textMentionsAll(rawText = '') {
    const text = normalizeIncomingText(rawText).toLowerCase();
    if (!text) {
        return false;
    }

    const normalized = text
        .replace(/\s+/g, ' ')
        .trim();

    return /(?:^|\s)@all(?:\s|$)/iu.test(normalized)
        || /(?:^|\s)@everyone(?:\s|$)/iu.test(normalized)
        || /(?:^|\s)@ทุกคน(?:\s|$)/u.test(normalized)
        || normalized.includes('แท็กทุกคน')
        || normalized.includes('ทุกคนในกลุ่ม');
}

function extractMentionTokenFromText(rawText = '', mention = {}) {
    const source = String(rawText || '');
    if (!source) {
        return '';
    }

    const start = Number(mention?.index);
    const length = Number(mention?.length);
    if (!Number.isFinite(start) || !Number.isFinite(length) || start < 0 || length <= 0) {
        return '';
    }

    return source.slice(start, start + length).replace(/\s+/g, '').trim();
}

function hasAllAudienceMention(event = {}) {
    const rawText = String(event?.message?.text || '');
    if (textMentionsAll(rawText)) {
        return true;
    }

    const mentions = Array.isArray(event?.message?.mention?.mentions)
        ? event.message.mention.mentions
        : [];

    if (mentions.length === 0) {
        return false;
    }

    for (const mention of mentions) {
        const mentionType = String(
            mention?.type
            || mention?.mentionType
            || mention?.kind
            || ''
        ).trim().toLowerCase();

        if (mentionType === 'all' || mentionType === 'everyone') {
            return true;
        }

        const mentionToken = extractMentionTokenFromText(rawText, mention).replace(/\s+/g, '').toLowerCase();
        if (mentionToken === '@all' || mentionToken === '@everyone' || mentionToken === '@ทุกคน') {
            return true;
        }
    }

    return false;
}

function normalizeMentionDisplayName(token = '') {
    const normalized = String(token || '').trim();
    if (!normalized) {
        return '';
    }

    return normalized
        .replace(/^@+/, '')
        .replace(/[,:;!?，。、]+$/u, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractManualAssigneeMentionNames(rawText = '') {
    const text = String(rawText || '');
    if (!text) {
        return [];
    }

    const ccBoundaryIndex = findCcBoundaryIndex(text);
    const assigneeSegment = ccBoundaryIndex >= 0
        ? text.slice(0, ccBoundaryIndex)
        : text;

    const seen = new Set();
    const names = [];
    const mentionPattern = /(?:^|\s)@([^\s@]+)/gu;

    for (const match of assigneeSegment.matchAll(mentionPattern)) {
        const displayName = normalizeMentionDisplayName(match?.[1] || '');
        if (!displayName) {
            continue;
        }

        const normalized = displayName
            .toLowerCase()
            .replace(/[\u2010-\u2015\-_\.]+/g, '')
            .trim();

        if (!normalized) {
            continue;
        }

        if (normalized === 'all' || normalized === 'everyone' || normalized === 'ทุกคน') {
            continue;
        }

        const isBotLikeMention = normalized.includes('aina')
            || normalized.includes('ไอน่า')
            || normalized === 'ai'
            || normalized === 'bot';
        if (isBotLikeMention) {
            continue;
        }

        if (seen.has(normalized)) {
            continue;
        }

        seen.add(normalized);
        names.push(displayName);
    }

    return names;
}

function isFallbackLineDisplayName(name = '') {
    const normalized = String(name || '').trim();
    if (!normalized) {
        return true;
    }

    if (normalized === 'สมาชิกในกลุ่ม') {
        return true;
    }

    return /^LINE-[A-Za-z0-9]{6}$/i.test(normalized);
}

function buildAssigneeMentionDisplayNameByLineUserId(event, env = {}) {
    const mentions = Array.isArray(event?.message?.mention?.mentions)
        ? event.message.mention.mentions
        : [];

    if (mentions.length === 0) {
        return new Map();
    }

    const rawText = String(event?.message?.text || '');
    const ccBoundaryIndex = findCcBoundaryIndex(rawText);
    const botIds = getConfiguredBotUserIdSet(env);
    const map = new Map();

    for (const mention of mentions) {
        const mentionUserId = String(mention?.userId || '').trim();
        if (!isLikelyLineUserId(mentionUserId) || botIds.has(mentionUserId) || map.has(mentionUserId)) {
            continue;
        }

        const mentionIndex = Number(mention?.index);
        if (ccBoundaryIndex >= 0 && Number.isFinite(mentionIndex) && mentionIndex >= ccBoundaryIndex) {
            continue;
        }

        const mentionToken = extractMentionTokenFromText(rawText, mention);
        const displayName = normalizeMentionDisplayName(mentionToken);
        if (!displayName) {
            continue;
        }

        map.set(mentionUserId, displayName);
    }

    return map;
}

function resolvePrimaryAssigneeMentionLabel(event, assigneeLineUserIds = []) {
    const mentions = Array.isArray(event?.message?.mention?.mentions)
        ? event.message.mention.mentions
        : [];

    if (mentions.length === 0 || !Array.isArray(assigneeLineUserIds) || assigneeLineUserIds.length === 0) {
        return '';
    }

    const assigneeSet = new Set(
        assigneeLineUserIds
            .map((id) => String(id || '').trim())
            .filter(Boolean)
    );
    if (assigneeSet.size === 0) {
        return '';
    }

    const rawText = String(event?.message?.text || '');
    const ccBoundaryIndex = findCcBoundaryIndex(rawText);

    for (const mention of mentions) {
        const mentionUserId = String(mention?.userId || '').trim();
        if (!assigneeSet.has(mentionUserId)) {
            continue;
        }

        const mentionIndex = Number(mention?.index);
        if (ccBoundaryIndex >= 0 && Number.isFinite(mentionIndex) && mentionIndex >= ccBoundaryIndex) {
            continue;
        }

        const token = extractMentionTokenFromText(rawText, mention);
        if (token.startsWith('@')) {
            return token;
        }
    }

    return '';
}

export {
    getConfiguredBotUserIdSet,
    textMentionsAina,
    textMentionsAll,
    extractMentionTokenFromText,
    hasAllAudienceMention,
    normalizeMentionDisplayName,
    extractManualAssigneeMentionNames,
    isFallbackLineDisplayName,
    buildAssigneeMentionDisplayNameByLineUserId,
    resolvePrimaryAssigneeMentionLabel
};
