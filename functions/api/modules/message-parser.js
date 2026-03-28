// ✅ Message parsing utilities

const TAGGED_TASK_IGNORED_COMMAND_PREFIXES = [
    '/test',
    '/testorder',
    '/testoder',
    '/-testorder',
    '/-testoder',
    '/มีชีวิต',
    '/จบชีวิต',
    '/ซิงข้อมูลกลุ่ม',
    '/ซิงค์ข้อมูลกลุ่ม',
    '/บันทึกข้อมูลกลุ่ม',
    '/เพิ่มโครงการ'
];

function isLineGroupId(value) {
    return /^C[0-9a-f]{32}$/i.test(String(value || '').trim());
}

function normalizeIncomingText(rawText = '') {
    return String(rawText || '')
        .normalize('NFKC')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .trim();
}

function extractQuotedMessageId(message = {}) {
    if (!message || typeof message !== 'object') {
        return '';
    }

    const candidates = [
        message.quotedMessageId,
        message.quoteMessageId,
        message?.quote?.quotedMessageId,
        message?.quote?.messageId,
        message?.quote?.id
    ];

    for (const candidate of candidates) {
        const normalized = String(candidate || '').trim();
        if (normalized) {
            return normalized;
        }
    }

    return '';
}

function parseExplicitAiInvocation(rawText = '') {
    const text = normalizeIncomingText(rawText);
    if (!text) {
        return { invoked: false, prompt: '' };
    }

    const normalized = text.toLowerCase();
    const commandPrefixes = [
        '/ai',
        '/ask',
        '/ถาม',
        '/ไอน่า',
        '/summary',
        '/สรุป',
        '@aina',
        '@ไอน่า',
        'aina',
        'ไอน่า'
    ];

    for (const prefix of commandPrefixes) {
        if (normalized.startsWith(prefix)) {
            const prompt = text.slice(prefix.length).trim();
            return { invoked: true, prompt };
        }
    }

    return { invoked: false, prompt: '' };
}

function sanitizeDocIdSegment(value = '') {
    return String(value || '')
        .trim()
        .replace(/[^A-Za-z0-9_-]/g, '');
}

function buildMeetingTaskDocId(lineMessageId = '') {
    const normalizedMessageId = sanitizeDocIdSegment(lineMessageId);
    if (normalizedMessageId) {
        return `line_task_${normalizedMessageId}`;
    }

    const rand = Math.random().toString(36).slice(2, 8);
    return `line_task_${Date.now()}_${rand}`;
}

function normalizeMeetingDateYear(rawYear, fallbackYear) {
    if (rawYear === undefined || rawYear === null || rawYear === '') {
        return fallbackYear;
    }

    let year = Number(rawYear);
    if (!Number.isFinite(year)) {
        return fallbackYear;
    }

    if (year < 100) {
        year += 2000;
    }

    if (year >= 2400) {
        year -= 543;
    }

    return year;
}

function parseThaiRelativeDate(rawText = '') {
    const text = normalizeIncomingText(rawText).toLowerCase();
    if (!text) {
        return null;
    }

    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    
    // วันนี้ today
    if (/วันนี้|today|ค่อนข้างใกล้/.test(text)) {
        const iso = today.toISOString().split('T')[0];
        const day = today.getUTCDate();
        const month = today.getUTCMonth() + 1;
        const display = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`;
        return { iso, display, raw: 'วันนี้' };
    }

    // พรุ่งนี้, วันพรุ่งนี้ tomorrow
    if (/พรุ่งนี้|วันพรุ่งนี้|tomorrow|next day|วันหน้า|วันถัดไป/.test(text)) {
        const tomorrow = new Date(today);
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        const iso = tomorrow.toISOString().split('T')[0];
        const day = tomorrow.getUTCDate();
        const month = tomorrow.getUTCMonth() + 1;
        const display = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`;
        return { iso, display, raw: 'พรุ่งนี้' };
    }

    // สัปดาห์นี้, within week
    if (/สัปดาห์นี้|week|สปดาห์/.test(text)) {
        const week = new Date(today);
        week.setUTCDate(week.getUTCDate() + 3);
        const iso = week.toISOString().split('T')[0];
        const day = week.getUTCDate();
        const month = week.getUTCMonth() + 1;
        const display = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`;
        return { iso, display, raw: 'ภายในสัปดาห์' };
    }

    return null;
}

function parseMeetingDateFromText(rawText = '') {
    const text = normalizeIncomingText(rawText);
    if (!text) {
        return null;
    }

    // Try Thai relative dates first (วันนี้, พรุ่งนี้ etc.)
    const thaiRelativeDate = parseThaiRelativeDate(text);
    if (thaiRelativeDate) {
        return thaiRelativeDate;
    }

    const match = text.match(/(?:\(|\[|วันที่\s*)?(\d{1,2})\s*[\/\-]\s*(\d{1,2})(?:\s*[\/\-]\s*(\d{2,4}))?(?:\)|\])?/u);
    if (!match) {
        return null;
    }

    const day = Number(match[1]);
    const month = Number(match[2]);
    const now = new Date();
    const year = normalizeMeetingDateYear(match[3], now.getFullYear());

    if (!Number.isFinite(day) || !Number.isFinite(month) || day < 1 || month < 1 || month > 12) {
        return null;
    }

    const candidate = new Date(Date.UTC(year, month - 1, day));
    if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== (month - 1) || candidate.getUTCDate() !== day) {
        return null;
    }

    const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const display = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`;

    return {
        iso,
        display,
        raw: String(match[0] || '').trim()
    };
}

function stripLeadingBotMentions(text = '') {
    let remaining = String(text || '').trimStart();
    if (!remaining) {
        return '';
    }

    while (true) {
        const match = remaining.match(/^(@[^\s]+)(\s+|$)/u);
        if (!match) {
            break;
        }

        const token = String(match[1] || '').trim();
        const normalizedToken = token
            .toLowerCase()
            .replace(/^@+/, '')
            .replace(/[\u2010-\u2015\-_\.]+/g, '');

        const isBotLikeMention = normalizedToken.includes('aina')
            || normalizedToken.includes('ไอน่า')
            || normalizedToken === 'ai'
            || normalizedToken === 'bot';

        if (!isBotLikeMention) {
            break;
        }

        remaining = remaining.slice(match[0].length).trimStart();
    }

    return remaining.trim();
}

function findCcBoundaryIndex(rawText = '') {
    const source = String(rawText || '');
    if (!source) {
        return -1;
    }

    const match = source.match(/(?:^|\s)(?:cc|copy)(?:\s|[:：]|@|$)/iu);
    if (!match) {
        return -1;
    }

    return Number.isFinite(match.index) ? match.index : -1;
}

function parseMeetingSummaryTaskCandidate(rawText = '') {
    const text = normalizeIncomingText(rawText);
    if (!text) {
        return { matched: false };
    }

    const compactText = text.replace(/\s+/g, ' ').trim();
    const summaryPattern = /(สรุปประเด็น|สรุปการประชุม|สรุปประชุม|สรุป.*ประชุม|meeting\s*summary|summary\s*meeting)/iu;
    if (!summaryPattern.test(compactText)) {
        return { matched: false };
    }

    const dateInfo = parseMeetingDateFromText(compactText);
    const ccBoundaryIndex = findCcBoundaryIndex(compactText);
    const summarySegment = ccBoundaryIndex >= 0
        ? compactText.slice(0, ccBoundaryIndex).trim()
        : compactText;

    let title = stripLeadingBotMentions(summarySegment)
        .replace(/^(@[^\s]+\s*)+/u, '')
        .replace(/^\/?(?:ai|ask|ถาม|ไอน่า)\s*/iu, '')
        .trim();

    if (dateInfo?.raw) {
        title = title.replace(dateInfo.raw, ' ').replace(/[()\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
    }

    if (!title) {
        title = 'สรุปประเด็นการประชุม';
    }

    if (title.length > 180) {
        title = `${title.slice(0, 177)}...`;
    }

    return {
        matched: true,
        title,
        deadlineIso: dateInfo?.iso || '',
        deadlineDisplay: dateInfo?.display || '',
        rawText: compactText
    };
}

function shouldPreferTaggedTaskForSummaryText(rawText = '') {
    const compactText = normalizeIncomingText(rawText).replace(/\s+/g, ' ').trim();
    if (!compactText) {
        return false;
    }

    const nextStepPattern = /(next\s*step|nextstep|next-step|follow\s*-?\s*up|followup|ตามด้วย|สั่งต่อ|ต่อจากงานเดิม)/iu;
    if (!nextStepPattern.test(compactText)) {
        return false;
    }

    const hasMentionLikeSignal = /(?:^|\s)@[^\s@]+/u.test(compactText);
    const hasCcSignal = findCcBoundaryIndex(compactText) >= 0;
    const hasDeadlineSignal = /(?:ภายใน|deadline|due|ก่อนวันที่|เมื่อไหร่)/iu.test(compactText)
        || Boolean(parseMeetingDateFromText(compactText)?.iso);

    return hasMentionLikeSignal || hasCcSignal || hasDeadlineSignal;
}

function buildTaggedLineTaskFallbackTitle(rawText = '') {
    const compactText = normalizeIncomingText(rawText).replace(/\s+/g, ' ').trim();
    if (!compactText) {
        return '';
    }

    const ccBoundaryIndex = findCcBoundaryIndex(compactText);
    const taskSegment = ccBoundaryIndex >= 0
        ? compactText.slice(0, ccBoundaryIndex).trim()
        : compactText;

    let title = stripLeadingBotMentions(taskSegment)
        .replace(/^\/?(?:ai|ask|ถาม|ไอน่า)\s*/iu, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!title) {
        return '';
    }

    if (title.length > 180) {
        title = `${title.slice(0, 177)}...`;
    }

    return title;
}

function parseTaggedLineTaskCandidate(rawText = '') {
    const text = normalizeIncomingText(rawText);
    if (!text) {
        return { matched: false };
    }

    const compactText = text.replace(/\s+/g, ' ').trim();
    if (!compactText) {
        return { matched: false };
    }

    const normalizedLower = compactText.toLowerCase();
    for (const commandPrefix of TAGGED_TASK_IGNORED_COMMAND_PREFIXES) {
        const normalizedCommandPrefix = String(commandPrefix || '').toLowerCase();
        if (!normalizedCommandPrefix) {
            continue;
        }

        if (normalizedLower === normalizedCommandPrefix || normalizedLower.startsWith(`${normalizedCommandPrefix} `)) {
            return { matched: false, reason: 'command' };
        }
    }

    const hasForceCommand = /(?:^|\s)\/สั่ง(?:\s|$)/u.test(compactText);
    if (hasForceCommand) {
        const cleanTitle = compactText
            .replace(/\/สั่ง/gu, '')
            .replace(/\s+/g, ' ')
            .trim();
        const ccBoundaryIndex = findCcBoundaryIndex(cleanTitle);
        const taskSegment = ccBoundaryIndex >= 0
            ? cleanTitle.slice(0, ccBoundaryIndex).trim()
            : cleanTitle;
        let title = stripLeadingBotMentions(taskSegment)
            .replace(/^(@[^\s]+\s*)+/u, '')
            .replace(/^\/?(?:ai|ask|ถาม|ไอน่า)\s*/iu, '')
            .replace(/\s+/g, ' ')
            .trim();
        if (!title) title = 'งานจากข้อความที่ถูกสั่งใน LINE';
        return {
            matched: true,
            forceCommand: true,
            title,
            deadlineIso: '',
            deadlineDisplay: '',
            rawText: compactText,
            hasDeadlineSignal: false,
            hasQuestion: false,
            keywordHits: 1
        };
    }

    const dateInfo = parseMeetingDateFromText(compactText);
    const hasDeadlineSignal = /(?:ภายใน|deadline|due|ก่อนวันที่|ภายในวันที่)/iu.test(compactText)
        || Boolean(dateInfo?.iso);
    const hasQuestion = /[?？]/u.test(compactText);

    if (!hasDeadlineSignal && !hasQuestion) {
        return { matched: false, reason: 'no-task-signal' };
    }

    const ccBoundaryIndex = findCcBoundaryIndex(compactText);
    const taskSegment = ccBoundaryIndex >= 0
        ? compactText.slice(0, ccBoundaryIndex).trim()
        : compactText;

    let title = stripLeadingBotMentions(taskSegment)
        .replace(/^\/?(?:ai|ask|ถาม|ไอน่า)\s*/iu, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (dateInfo?.raw) {
        title = title.replace(dateInfo.raw, ' ').replace(/[()\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
    }

    if (!title) {
        title = 'งานจากข้อความแท็กใน LINE';
    }

    if (title.length > 180) {
        title = `${title.slice(0, 177)}...`;
    }

    return {
        matched: true,
        title,
        deadlineIso: dateInfo?.iso || '',
        deadlineDisplay: dateInfo?.display || '',
        rawText: compactText,
        hasDeadlineSignal,
        hasQuestion,
        keywordHits: 0
    };
}

export {
    TAGGED_TASK_IGNORED_COMMAND_PREFIXES,
    isLineGroupId,
    normalizeIncomingText,
    extractQuotedMessageId,
    parseExplicitAiInvocation,
    sanitizeDocIdSegment,
    buildMeetingTaskDocId,
    normalizeMeetingDateYear,
    parseMeetingDateFromText,
    stripLeadingBotMentions,
    findCcBoundaryIndex,
    parseMeetingSummaryTaskCandidate,
    shouldPreferTaggedTaskForSummaryText,
    buildTaggedLineTaskFallbackTitle,
    parseTaggedLineTaskCandidate
};
