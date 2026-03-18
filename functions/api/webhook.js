// ✅ CEO FLOW - Connect (Temporary REST / Stub Version)
// ⚠ firebase-admin ถูกถอดออกจาก Cloudflare Workers
// จะย้าย logic การสร้าง employee ไป Firebase Cloud Functions แทน

// ✅ Firestore REST via Web API Key (Spark Plan Compatible)

function fsString(v) {
    return { stringValue: String(v) };
}

function fsStringArray(values = []) {
    const normalizedValues = Array.isArray(values)
        ? values
            .map((value) => String(value || '').trim())
            .filter(Boolean)
        : [];

    if (normalizedValues.length === 0) {
        return { arrayValue: {} };
    }

    return {
        arrayValue: {
            values: normalizedValues.map((value) => fsString(value))
        }
    };
}

function fsTimelineEntriesArray(entries = []) {
    const normalizedEntries = Array.isArray(entries)
        ? entries
            .map((entry = {}) => ({
                id: String(entry?.id || '').trim(),
                time: String(entry?.time || '').trim(),
                title: String(entry?.title || '').trim(),
                detail: String(entry?.detail || '').trim(),
                actor: String(entry?.actor || '').trim(),
                tone: String(entry?.tone || '').trim(),
                replyLineMessageId: String(entry?.replyLineMessageId || '').trim()
            }))
            .filter((entry) => entry.time || entry.detail || entry.title)
        : [];

    if (normalizedEntries.length === 0) {
        return { arrayValue: {} };
    }

    return {
        arrayValue: {
            values: normalizedEntries.map((entry) => ({
                mapValue: {
                    fields: {
                        id: fsString(entry.id),
                        time: fsString(entry.time),
                        title: fsString(entry.title),
                        detail: fsString(entry.detail),
                        actor: fsString(entry.actor),
                        tone: fsString(entry.tone),
                        replyLineMessageId: fsString(entry.replyLineMessageId)
                    }
                }
            }))
        }
    };
}

function fsTimestampISO() {
    return { timestampValue: new Date().toISOString() };
}

function getFSBase(env) {
    return `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
}

// ✅ ใช้ Web API Key แทน OAuth2 (ง่ายกว่า)
async function getAccessToken(env) {
    // ถ้ามี API Key ใช้เลย ไม่ต้อง OAuth
    if (env.FIREBASE_API_KEY) {
        return null; // จะใช้ API Key แทน
    }
    // Fallback: OAuth2
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", typ: "JWT" };
    const payload = {
        iss: env.FIREBASE_CLIENT_EMAIL,
        scope: "https://www.googleapis.com/auth/datastore",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600
    };

    function base64url(obj) {
        return btoa(JSON.stringify(obj))
            .replace(/=/g, "")
            .replace(/\+/g, "-")
            .replace(/\//g, "_");
    }

    const enc = new TextEncoder();
    const pem = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n");
    const pemContents = pem
        .replace("-----BEGIN PRIVATE KEY-----", "")
        .replace("-----END PRIVATE KEY-----", "")
        .replace(/\s+/g, "");

    const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

    const key = await crypto.subtle.importKey(
        "pkcs8",
        binaryDer.buffer,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"]
    );

    const unsigned = `${base64url(header)}.${base64url(payload)}`;
    const signature = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        key,
        enc.encode(unsigned)
    );

    const jwt = `${unsigned}.${arrayBufferToBase64Url(signature)}`;

    const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });

    const data = await res.json();
    return data.access_token;
}

function str2ab(str) {
    const buf = new ArrayBuffer(str.length);
    const view = new Uint8Array(buf);
    for (let i = 0; i < str.length; i++) view[i] = str.charCodeAt(i);
    return buf;
}

function arrayBufferToBase64Url(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (const b of bytes) {
        binary += String.fromCharCode(b);
    }
    return btoa(binary);
}

function timingSafeStringEqual(left = '', right = '') {
    const a = String(left || '');
    const b = String(right || '');
    if (a.length !== b.length) {
        return false;
    }

    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }

    return diff === 0;
}

async function verifyLineWebhookSignature(rawBody = '', signature = '', channelSecret = '') {
    const normalizedSecret = String(channelSecret || '').trim();
    if (!normalizedSecret) {
        return { ok: true, skipped: true, reason: 'missing-channel-secret' };
    }

    const normalizedSignature = String(signature || '').trim();
    if (!normalizedSignature) {
        return { ok: false, skipped: false, reason: 'missing-signature' };
    }

    try {
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
            'raw',
            encoder.encode(normalizedSecret),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );

        const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(String(rawBody || '')));
        const expectedSignature = arrayBufferToBase64(digest);
        const ok = timingSafeStringEqual(expectedSignature, normalizedSignature);

        return { ok, skipped: false, reason: ok ? '' : 'signature-mismatch' };
    } catch (err) {
        return {
            ok: false,
            skipped: false,
            reason: `signature-verify-error:${err?.message || String(err)}`
        };
    }
}

// ✅ Firestore helpers สำหรับ chat session
async function fsGetDoc(collection, docId, env) {
    const url = `${getFSBase(env)}/${collection}/${docId}?key=${env.FIREBASE_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data.fields || null;
}

async function fsSetDoc(collection, docId, fields, env) {
    const url = `${getFSBase(env)}/${collection}/${docId}?key=${env.FIREBASE_API_KEY}`;
    await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            fields: Object.fromEntries(
                Object.entries(fields).map(([k, v]) => [k, { stringValue: String(v) }])
            )
        })
    });
}

async function fsDeleteDoc(collection, docId, env) {
    const url = `${getFSBase(env)}/${collection}/${docId}?key=${env.FIREBASE_API_KEY}`;
    await fetch(url, { method: 'DELETE' });
}

async function createEmployee(lineUserId, displayName, photoUrl, env) {
    const empId = `emp_${lineUserId.slice(-6)}`;
    const FS_BASE = getFSBase(env);
    const url = `${FS_BASE}/employees?documentId=${empId}&key=${env.FIREBASE_API_KEY}`;

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            fields: {
                id: { stringValue: empId },
                fullName: { stringValue: displayName },
                name: { stringValue: displayName },
                role: { stringValue: 'member' },
                photoUrl: { stringValue: photoUrl || '' },
                createdAt: { timestampValue: new Date().toISOString() }
            }
        })
    });

    const text = await res.text();
    console.log("Firestore status:", res.status);
    console.log("Firestore response:", text);

    if (!res.ok) {
        console.error("❌ Firestore Write Failed");
        throw new Error("Firestore write failed");
    }

    console.log("✅ Employee created:", empId);
}

async function upsertLineUser(lineUserId, displayName, env) {
    const FS_BASE = getFSBase(env);
    const url = `${FS_BASE}/lineUsers/${lineUserId}?key=${env.FIREBASE_API_KEY}`;

    const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            fields: {
                lineUserId: fsString(lineUserId),
                displayName: fsString(displayName),
                employeeId: fsString(`emp_${lineUserId.slice(-6)}`),
                createdAt: fsTimestampISO()
            }
        })
    });

    if (!res.ok) {
        const err = await res.text();
        console.error('❌ lineUsers upsert failed:', err);
        throw new Error('lineUsers write failed');
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function lineFetchJson(url, env, maxRetries = 2) {
    let lastError = 'Unknown LINE API error';

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const res = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${env.LINE_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            });

            if (res.ok) {
                return { ok: true, data: await res.json() };
            }

            const errText = await res.text();
            lastError = `${res.status}: ${errText || 'LINE API error'}`;

            const retryable = res.status === 429 || res.status >= 500;
            if (!retryable || attempt === maxRetries) {
                return { ok: false, error: lastError };
            }
        } catch (err) {
            lastError = err?.message || String(err);
            if (attempt === maxRetries) {
                return { ok: false, error: lastError };
            }
        }

        await sleep(250 * (attempt + 1));
    }

    return { ok: false, error: lastError };
}

async function fetchLineGroupMemberCount(groupId, env) {
    const normalizedGroupId = String(groupId || '').trim();
    if (!normalizedGroupId) {
        return { count: null, error: 'Missing groupId' };
    }

    if (!env?.LINE_TOKEN) {
        return { count: null, error: 'Missing LINE_TOKEN' };
    }

    const countRes = await lineFetchJson(
        `https://api.line.me/v2/bot/group/${normalizedGroupId}/members/count`,
        env,
        1
    );

    if (!countRes.ok) {
        return { count: null, error: countRes.error };
    }

    const rawCount = normalizeNonNegativeInteger(countRes.data?.count);
    if (rawCount === null) {
        return { count: null, error: 'Invalid LINE members/count response' };
    }

    const count = normalizeLineMembersCountForDisplay(rawCount, env);
    if (count === null) {
        return { count: null, error: 'Invalid normalized LINE members/count response' };
    }

    return { count, error: null };
}

function extractStatusCodeFromLineError(error = '') {
    const match = String(error || '').trim().match(/^(\d{3})\s*:/);
    if (!match) {
        return null;
    }

    const status = Number(match[1]);
    return Number.isFinite(status) ? status : null;
}

function isLineNotInGroupError(error = '') {
    const status = extractStatusCodeFromLineError(error);
    return status === 404 || status === 410;
}

function normalizeKnownGroupInGroup(value) {
    if (typeof value === 'boolean') {
        return value;
    }

    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
        return null;
    }

    if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
        return true;
    }

    if (normalized === 'false' || normalized === '0' || normalized === 'no') {
        return false;
    }

    return null;
}

function normalizeNonNegativeInteger(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return null;
    }

    return Math.floor(parsed);
}

function resolveHistoricalMemberCountFloor(...candidates) {
    let floor = null;

    for (const candidate of candidates) {
        const normalized = normalizeNonNegativeInteger(candidate);
        if (normalized === null) {
            continue;
        }

        if (floor === null || normalized > floor) {
            floor = normalized;
        }
    }

    return floor;
}

function getForcedMinimumMemberCount(env = {}) {
    const candidate =
        env?.FORCED_MIN_MEMBER_COUNT ??
        env?.GROUP_MEMBER_COUNT_MIN ??
        1;

    const normalized = normalizeNonNegativeInteger(candidate);
    if (normalized === null) {
        return 1;
    }

    return normalized;
}

function shouldIncludeBotInMemberCount(env = {}) {
    const normalized = String(env?.LINE_MEMBER_COUNT_INCLUDE_BOT ?? 'true').trim().toLowerCase();
    return !(normalized === 'false' || normalized === '0' || normalized === 'no');
}

function normalizeLineMembersCountForDisplay(rawCount, env = {}) {
    const normalized = normalizeNonNegativeInteger(rawCount);
    if (normalized === null) {
        return null;
    }

    if (shouldIncludeBotInMemberCount(env)) {
        return normalized + 1;
    }

    return normalized;
}

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

    // Support Thai Buddhist year input such as 2568.
    if (year >= 2400) {
        year -= 543;
    }

    return year;
}

function parseMeetingDateFromText(rawText = '') {
    const text = normalizeIncomingText(rawText);
    if (!text) {
        return null;
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
    return String(text || '')
        .replace(/^(@[^\s]+\s*)+/u, '')
        .trim();
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

const TAGGED_TASK_IGNORED_COMMAND_PREFIXES = [
    '/test',
    '/มีชีวิต',
    '/จบชีวิต',
    '/ซิงข้อมูลกลุ่ม',
    '/ซิงค์ข้อมูลกลุ่ม',
    '/บันทึกข้อมูลกลุ่ม',
    '/เพิ่มโครงการ'
];

const TAGGED_TASK_KEYWORDS = [
    'หารือ',
    'ประเมิน',
    'ความเสี่ยง',
    'สรุป',
    'นัดหมาย',
    'nextstep',
    'next step',
    'แจ้ง',
    'ภายใน',
    'ตามด้วย',
    'เตรียม',
    'input',
    'อินพุต',
    'อินput',
    'lead',
    'ประชุม',
    'ติดตาม',
    'ช่วย',
    'วิเคราะห์',
    'จัดการ',
    'ขอ'
];

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

    const dateInfo = parseMeetingDateFromText(compactText);
    const hasDeadlineSignal = /(?:ภายใน|deadline|due|ก่อนวันที่|ภายในวันที่)/iu.test(compactText)
        || Boolean(dateInfo?.iso);
    const hasQuestion = /[?？]/u.test(compactText);

    let keywordHits = 0;
    for (const keyword of TAGGED_TASK_KEYWORDS) {
        const normalizedKeyword = String(keyword || '').trim().toLowerCase();
        if (!normalizedKeyword) {
            continue;
        }

        if (normalizedLower.includes(normalizedKeyword)) {
            keywordHits += 1;
        }
    }

    if (!hasDeadlineSignal && !hasQuestion && keywordHits === 0) {
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
        keywordHits
    };
}

const TASK_SENTIMENT_POSITIVE_KEYWORDS = [
    'ขอบคุณ',
    'เรียบร้อย',
    'สำเร็จ',
    'ดี',
    'เยี่ยม',
    'พร้อม',
    'great',
    'good',
    'thanks',
    'thank you',
    'awesome',
    'excellent',
    'done',
    'love',
    '💖',
    '❤️',
    '👍',
    '😊'
];

const TASK_SENTIMENT_NEGATIVE_KEYWORDS = [
    'ปัญหา',
    'ผิดพลาด',
    'ล่าช้า',
    'ไม่ทัน',
    'ช้า',
    'ติด',
    'กังวล',
    'เครียด',
    'ยกเลิก',
    'เสียหาย',
    'fail',
    'error',
    'issue',
    'bug',
    'broken',
    '😢',
    '😡'
];

const TASK_SENTIMENT_URGENT_KEYWORDS = [
    'ด่วน',
    'เร่ง',
    'รีบ',
    'urgent',
    'asap',
    'critical',
    'blocker',
    '⚠',
    '🔥'
];

const TASK_SENTIMENT_LABEL_BY_TYPE = {
    positive: 'เชิงบวก',
    neutral: 'เป็นกลาง',
    negative: 'กังวล',
    urgent: 'เร่งด่วน'
};

const TASK_SENTIMENT_EMOJI_BY_TYPE = {
    positive: '🙂',
    neutral: '😐',
    negative: '😟',
    urgent: '⚠️'
};

function countSentimentKeywordHits(normalizedText, keywords = []) {
    if (!normalizedText || !Array.isArray(keywords) || keywords.length === 0) {
        return 0;
    }

    let hits = 0;
    for (const keyword of keywords) {
        const normalizedKeyword = String(keyword || '').trim().toLowerCase();
        if (!normalizedKeyword) {
            continue;
        }

        if (normalizedText.includes(normalizedKeyword)) {
            hits += 1;
        }
    }

    return hits;
}

function analyzeTaskSourceSentiment(rawText = '') {
    const normalizedText = normalizeIncomingText(rawText).toLowerCase();
    if (!normalizedText) {
        return {
            type: 'neutral',
            label: TASK_SENTIMENT_LABEL_BY_TYPE.neutral,
            emoji: TASK_SENTIMENT_EMOJI_BY_TYPE.neutral,
            score: 0
        };
    }

    const positiveHits = countSentimentKeywordHits(normalizedText, TASK_SENTIMENT_POSITIVE_KEYWORDS);
    const negativeHits = countSentimentKeywordHits(normalizedText, TASK_SENTIMENT_NEGATIVE_KEYWORDS);
    const urgentHits = countSentimentKeywordHits(normalizedText, TASK_SENTIMENT_URGENT_KEYWORDS);

    let type = 'neutral';
    if (urgentHits > 0) {
        type = 'urgent';
    } else if (negativeHits > positiveHits && negativeHits > 0) {
        type = 'negative';
    } else if (positiveHits > 0) {
        type = 'positive';
    }

    const score = positiveHits - negativeHits - urgentHits;
    return {
        type,
        label: TASK_SENTIMENT_LABEL_BY_TYPE[type] || TASK_SENTIMENT_LABEL_BY_TYPE.neutral,
        emoji: TASK_SENTIMENT_EMOJI_BY_TYPE[type] || TASK_SENTIMENT_EMOJI_BY_TYPE.neutral,
        score
    };
}

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

    // Normalize separators so variants like Aina-BT / Aina_BT / Aina–BT are treated the same.
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

async function resolveMeetingTaskAssignees(event, projectId, fallbackLineUserId, env = {}) {
    const mentionAssignees = extractMeetingTaskAssigneeLineUserIds(event, env);
    const mentionDisplayNameByLineUserId = buildAssigneeMentionDisplayNameByLineUserId(event, env);
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

    const assigneeNames = [];
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

    if (!isBotTaggedMeetingSummary(event, env)) {
        return { matched: false, created: false, reason: 'not-tagged' };
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
        createdAt: { timestampValue: nowIso },
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

const LINE_TASK_SOURCE_TYPES = new Set(['line-meeting-summary', 'line-tagged-task']);

function isSupportedLineTaskSource(source = '') {
    const normalizedSource = String(source || '').trim().toLowerCase();
    return LINE_TASK_SOURCE_TYPES.has(normalizedSource);
}

async function tryCreateTaggedLineTask(event, env, options = {}) {
    const projectId = String(options?.projectId || '').trim();
    const lineUserId = String(options?.lineUserId || '').trim();
    if (!projectId) {
        return { matched: false, created: false, reason: 'missing-project' };
    }

    if (!isBotTaggedMeetingSummary(event, env)) {
        return { matched: false, created: false, reason: 'not-tagged' };
    }

    const messageText = normalizeIncomingText(event?.message?.text || '');
    const parsedCandidate = parseTaggedLineTaskCandidate(messageText);
    if (!parsedCandidate.matched) {
        return { matched: false, created: false, reason: parsedCandidate.reason || 'not-tasklike' };
    }

    const lineMessageId = String(event?.message?.id || '').trim();
    const quotedMessageId = extractQuotedMessageId(event?.message || {});
    const lineContextMessageIds = [lineMessageId, quotedMessageId]
        .map((value) => String(value || '').trim())
        .filter(Boolean);

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

    const assigneeMentionLineUserIds = extractMeetingTaskAssigneeLineUserIds(event, env);
    if (assigneeMentionLineUserIds.length === 0) {
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
    const assigneeInfo = await resolveMeetingTaskAssignees(event, projectId, lineUserId, env);
    const primaryAssigneeMentionLabel = resolvePrimaryAssigneeMentionLabel(event, assigneeInfo.assigneeLineUserIds);
    const normalizedTaskTitle = finalizeMeetingSummaryTaskTitle(parsedCandidate.title, primaryAssigneeMentionLabel);
    const assigneeDisplayName = assigneeInfo.assigneeNames[0] || creatorName || 'ยังไม่ระบุ';
    const sourceSentiment = analyzeTaskSourceSentiment(parsedCandidate.rawText || messageText);
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
        createdAt: { timestampValue: nowIso },
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

async function patchFirestoreDoc(path, fields, env, strict = false) {
    const url = `${getFSBase(env)}/${path}?key=${env.FIREBASE_API_KEY}`;

    try {
        const res = await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields })
        });

        if (res.ok) {
            return true;
        }

        const errText = await res.text();
        const message = `Firestore PATCH failed (${path}): ${res.status} ${errText}`;
        if (strict) {
            throw new Error(message);
        }

        console.error(message);
        return false;
    } catch (err) {
        if (strict) {
            throw err;
        }
        console.error(`Firestore PATCH exception (${path}):`, err);
        return false;
    }
}

const KNOWN_GROUPS_CACHE_URL = 'https://ceoflow.internal/__known_groups_v3';
const KNOWN_GROUPS_KV_KEY = 'known_groups_v2';
const KNOWN_GROUPS_KV_PREFIX = 'known_group_v2:';
const ALIVE_MODE_KV_PREFIX = 'alive_mode_v1:';
const GROUP_MEMBER_INDEX_KV_PREFIX = 'group_member_v1:';
const GROUP_TYPE_VALUES = new Set(['unset', 'betimes', 'outsource', 'external']);

function getKnownGroupsKv(env) {
    const kv = env?.KNOWN_GROUPS_KV;
    if (!kv || typeof kv.get !== 'function' || typeof kv.put !== 'function') {
        return null;
    }
    return kv;
}

function getDefaultCache() {
    if (typeof caches === 'undefined' || !caches.default) {
        return null;
    }
    return caches.default;
}

export function getKnownGroupsStoreStatus(env = {}) {
    const kv = getKnownGroupsKv(env);
    return {
        kvAvailable: Boolean(kv),
        kvListAvailable: Boolean(kv && typeof kv.list === 'function'),
        cacheAvailable: Boolean(getDefaultCache())
    };
}

function normalizeKnownGroupEntry(raw) {
    const groupId = String(raw?.groupId || raw?.id || '').trim();
    if (!groupId) {
        return null;
    }

    const groupType = normalizeGroupTypeValue(raw?.groupType ?? raw?.type ?? null);
    const inGroup = normalizeKnownGroupInGroup(raw?.inGroup);

    const rawMemberCount = raw?.memberCount ?? raw?.members ?? null;
    let memberCount = null;
    if (rawMemberCount !== null && rawMemberCount !== undefined && rawMemberCount !== '') {
        const parsed = Number(rawMemberCount);
        if (Number.isFinite(parsed) && parsed >= 0) {
            memberCount = Math.floor(parsed);
        }
    }

    return {
        groupId,
        name: String(raw?.name || `LINE GROUP ${groupId.slice(-6)}`),
        pictureUrl: raw?.pictureUrl || null,
        groupType,
        inGroup,
        memberCount,
        lastSeenAt: raw?.lastSeenAt || new Date().toISOString()
    };
}

function getKnownGroupKvItemKey(groupId) {
    return `${KNOWN_GROUPS_KV_PREFIX}${groupId}`;
}

function getAliveModeKvItemKey(docId) {
    return `${ALIVE_MODE_KV_PREFIX}${docId}`;
}

function getGroupMemberKvPrefix(groupId) {
    return `${GROUP_MEMBER_INDEX_KV_PREFIX}${groupId}:`;
}

function getGroupMemberKvItemKey(groupId, lineUserId) {
    return `${getGroupMemberKvPrefix(groupId)}${lineUserId}`;
}

function getGroupMemberLinkDocId(groupId, lineUserId) {
    const normalizedGroupId = String(groupId || '').trim();
    const normalizedLineUserId = String(lineUserId || '').trim();
    if (!normalizedGroupId || !normalizedLineUserId) {
        return '';
    }

    return `${normalizedGroupId}__${normalizedLineUserId}`;
}

async function rememberGroupMember(groupId, lineUserId, env = {}) {
    const normalizedGroupId = String(groupId || '').trim();
    const normalizedLineUserId = String(lineUserId || '').trim();
    if (!normalizedGroupId || !normalizedLineUserId) {
        return false;
    }

    const kv = getKnownGroupsKv(env);
    if (!kv) {
        return false;
    }

    try {
        await kv.put(
            getGroupMemberKvItemKey(normalizedGroupId, normalizedLineUserId),
            JSON.stringify({
                groupId: normalizedGroupId,
                lineUserId: normalizedLineUserId,
                updatedAt: new Date().toISOString()
            })
        );
        return true;
    } catch (err) {
        console.error(`Remember group member KV failed (${normalizedGroupId}:${normalizedLineUserId}):`, err);
        return false;
    }
}

async function readGroupMemberIdsFromKv(groupId, env = {}) {
    const normalizedGroupId = String(groupId || '').trim();
    if (!normalizedGroupId) {
        return {
            ids: new Set(),
            warning: 'Missing groupId',
            truncated: false
        };
    }

    const kv = getKnownGroupsKv(env);
    if (!kv || typeof kv.list !== 'function') {
        return {
            ids: new Set(),
            warning: 'KV list unavailable',
            truncated: false
        };
    }

    const ids = new Set();
    const prefix = getGroupMemberKvPrefix(normalizedGroupId);
    let cursor = undefined;
    let guard = 0;

    try {
        while (guard < 60) {
            const page = await kv.list({ prefix, cursor, limit: 1000 });
            const keys = Array.isArray(page?.keys) ? page.keys : [];

            for (const item of keys) {
                const keyName = String(item?.name || '').trim();
                if (!keyName.startsWith(prefix)) {
                    continue;
                }

                const lineUserId = keyName.slice(prefix.length).trim();
                if (lineUserId) {
                    ids.add(lineUserId);
                }
            }

            guard += 1;
            if (page?.list_complete || !page?.cursor) {
                return {
                    ids,
                    warning: null,
                    truncated: false
                };
            }

            cursor = page.cursor;
        }

        return {
            ids,
            warning: 'KV list truncated: pagination guard reached',
            truncated: true
        };
    } catch (err) {
        return {
            ids,
            warning: `KV list failed: ${err?.message || String(err)}`,
            truncated: false
        };
    }
}

function isGenericKnownGroupName(name = '') {
    const normalized = String(name || '').trim();
    if (!normalized) {
        return true;
    }
    return normalized.toUpperCase().startsWith('LINE GROUP');
}

async function readKnownGroupsFromCache() {
    const cache = getDefaultCache();
    if (!cache) {
        return [];
    }

    try {
        const key = new Request(KNOWN_GROUPS_CACHE_URL);
        const hit = await cache.match(key);
        if (!hit) {
            return [];
        }

        const data = await hit.json();
        if (!Array.isArray(data)) {
            return [];
        }

        return data
            .map(normalizeKnownGroupEntry)
            .filter(Boolean)
            .slice(0, 500);
    } catch (err) {
        console.error('Read known groups cache error:', err);
        return [];
    }
}

async function writeKnownGroupsToCache(groups) {
    const cache = getDefaultCache();
    if (!cache) {
        return false;
    }

    try {
        const payload = (Array.isArray(groups) ? groups : [])
            .map(normalizeKnownGroupEntry)
            .filter(Boolean)
            .slice(0, 500);

        const key = new Request(KNOWN_GROUPS_CACHE_URL);
        await cache.put(key, new Response(JSON.stringify(payload), {
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=31536000'
            }
        }));
        return true;
    } catch (err) {
        console.error('Write known groups cache error:', err);
        return false;
    }
}

async function readKnownGroupsFromKv(env) {
    const kv = getKnownGroupsKv(env);
    if (!kv) {
        return { groups: [], mode: 'unavailable' };
    }

    // Preferred mode: one KV key per group to avoid snapshot overwrite races.
    if (typeof kv.list === 'function') {
        try {
            const collected = [];
            const seen = new Set();
            let cursor = undefined;

            while (collected.length < 500) {
                const page = await kv.list({
                    prefix: KNOWN_GROUPS_KV_PREFIX,
                    cursor,
                    limit: 100
                });

                const keys = Array.isArray(page?.keys) ? page.keys : [];
                if (keys.length > 0) {
                    const rows = await Promise.all(
                        keys.map((k) => kv.get(k.name, 'json').catch(() => null))
                    );

                    for (const row of rows) {
                        const normalized = normalizeKnownGroupEntry(row);
                        if (!normalized || seen.has(normalized.groupId)) {
                            continue;
                        }

                        seen.add(normalized.groupId);
                        collected.push(normalized);
                        if (collected.length >= 500) {
                            break;
                        }
                    }
                }

                if (page?.list_complete) {
                    break;
                }

                cursor = page?.cursor;
                if (!cursor) {
                    break;
                }
            }

            if (collected.length > 0) {
                return { groups: collected, mode: 'item-keys' };
            }
        } catch (err) {
            console.error('Read known groups KV item-keys error:', err);
        }
    }

    // Legacy fallback: single snapshot key.
    try {
        const data = await kv.get(KNOWN_GROUPS_KV_KEY, 'json');
        if (!Array.isArray(data)) {
            return { groups: [], mode: 'empty' };
        }

        return {
            groups: data
                .map(normalizeKnownGroupEntry)
                .filter(Boolean)
                .slice(0, 500),
            mode: 'legacy-snapshot'
        };
    } catch (err) {
        console.error('Read known groups KV legacy error:', err);
        return { groups: [], mode: 'error' };
    }
}

async function writeKnownGroupToKv(group, env) {
    const kv = getKnownGroupsKv(env);
    if (!kv) {
        return false;
    }

    const normalized = normalizeKnownGroupEntry(group);
    if (!normalized) {
        return false;
    }

    try {
        await kv.put(getKnownGroupKvItemKey(normalized.groupId), JSON.stringify(normalized));
        return true;
    } catch (err) {
        console.error('Write known group KV item-key error:', err);
        return false;
    }
}

async function writeKnownGroupsToKv(groups, env) {
    const kv = getKnownGroupsKv(env);
    if (!kv) {
        return false;
    }

    try {
        const payload = (Array.isArray(groups) ? groups : [])
            .map(normalizeKnownGroupEntry)
            .filter(Boolean)
            .slice(0, 500);

        for (const item of payload) {
            await kv.put(getKnownGroupKvItemKey(item.groupId), JSON.stringify(item));
        }

        // Keep legacy snapshot for backward compatibility and emergency fallback.
        await kv.put(KNOWN_GROUPS_KV_KEY, JSON.stringify(payload));
        return true;
    } catch (err) {
        console.error('Write known groups KV error:', err);
        return false;
    }
}

async function deleteKnownGroupKeysByPrefix(kv, prefix) {
    if (!kv || typeof kv.list !== 'function' || typeof kv.delete !== 'function') {
        return 0;
    }

    let deleted = 0;

    for (let round = 0; round < 3; round += 1) {
        const names = new Set();
        let cursor;

        for (let guard = 0; guard < 50; guard += 1) {
            const page = await kv.list({ prefix, cursor, limit: 1000 });
            const keys = Array.isArray(page?.keys) ? page.keys : [];

            for (const item of keys) {
                const keyName = String(item?.name || '').trim();
                if (keyName) {
                    names.add(keyName);
                }
            }

            if (page?.list_complete || !page?.cursor) {
                break;
            }

            cursor = page.cursor;
        }

        if (names.size === 0) {
            break;
        }

        for (const keyName of names) {
            try {
                await kv.delete(keyName);
                deleted += 1;
            } catch (err) {
                console.error(`Delete known group key failed (${keyName}):`, err);
            }
        }
    }

    return deleted;
}

export async function clearKnownGroupsData(env = {}) {
    const kv = getKnownGroupsKv(env);
    const result = {
        kvAvailable: Boolean(kv),
        cacheAvailable: Boolean(getDefaultCache()),
        kvDeleted: 0,
        cacheDeleted: 0,
        warnings: []
    };

    if (kv) {
        try {
            if (typeof kv.list === 'function' && typeof kv.delete === 'function') {
                result.kvDeleted += await deleteKnownGroupKeysByPrefix(kv, 'known_group_');
                result.kvDeleted += await deleteKnownGroupKeysByPrefix(kv, 'known_groups_');
                result.kvDeleted += await deleteKnownGroupKeysByPrefix(kv, GROUP_MEMBER_INDEX_KV_PREFIX);
            } else if (typeof kv.delete === 'function') {
                const fallbackKeys = [KNOWN_GROUPS_KV_KEY, 'known_groups_v1', 'known_groups_v2', 'known_groups_v3'];
                for (const keyName of fallbackKeys) {
                    try {
                        await kv.delete(keyName);
                        result.kvDeleted += 1;
                    } catch (err) {
                        console.error(`Delete known groups fallback key failed (${keyName}):`, err);
                    }
                }
            } else {
                result.warnings.push('KV binding does not support delete operation');
            }
        } catch (err) {
            result.warnings.push(err?.message || 'Failed to clear KV known groups');
        }
    }

    const cache = getDefaultCache();
    if (cache) {
        const cacheUrls = [
            'https://ceoflow.internal/__known_groups_v1',
            'https://ceoflow.internal/__known_groups_v2',
            KNOWN_GROUPS_CACHE_URL
        ];

        for (const url of cacheUrls) {
            try {
                const key = new Request(url);
                const deleted = await cache.delete(key);
                if (deleted) {
                    result.cacheDeleted += 1;
                }

                // Write an empty snapshot at this edge so stale cache data won't be re-used.
                await cache.put(key, new Response(JSON.stringify([]), {
                    headers: {
                        'Content-Type': 'application/json',
                        'Cache-Control': 'public, max-age=31536000'
                    }
                }));
            } catch (err) {
                result.warnings.push(err?.message || `Failed to clear cache key (${url})`);
            }
        }
    }

    return result;
}

async function deleteFirestoreDocumentByPath(path, env = {}) {
    const normalizedPath = String(path || '').trim();
    if (!normalizedPath || !env?.FIREBASE_PROJECT_ID || !env?.FIREBASE_API_KEY) {
        return false;
    }

    const url = `${getFSBase(env)}/${normalizedPath}?key=${env.FIREBASE_API_KEY}`;
    try {
        const res = await fetch(url, { method: 'DELETE' });
        if (res.ok || res.status === 404) {
            return true;
        }

        const errText = await res.text();
        console.error(`Delete Firestore doc failed (${normalizedPath}):`, res.status, errText);
        return false;
    } catch (err) {
        console.error(`Delete Firestore doc exception (${normalizedPath}):`, err);
        return false;
    }
}

export async function deleteKnownGroupData(groupId, env = {}) {
    const normalizedGroupId = String(groupId || '').trim();
    if (!normalizedGroupId) {
        throw new Error('Missing groupId');
    }

    const kv = getKnownGroupsKv(env);
    const result = {
        groupId: normalizedGroupId,
        kvAvailable: Boolean(kv),
        cacheAvailable: Boolean(getDefaultCache()),
        firestoreConfigured: Boolean(env?.FIREBASE_PROJECT_ID && env?.FIREBASE_API_KEY),
        projectDeleted: null,
        aliveModeDeleted: null,
        warnings: []
    };

    if (kv && typeof kv.delete === 'function') {
        try {
            await kv.delete(getKnownGroupKvItemKey(normalizedGroupId));
        } catch (err) {
            result.warnings.push(err?.message || 'Failed deleting group item key from KV');
        }

        try {
            await kv.delete(getAliveModeKvItemKey(`group_${normalizedGroupId}`));
        } catch (err) {
            result.warnings.push(err?.message || 'Failed deleting alive mode key from KV');
        }

        try {
            if (typeof kv.list === 'function') {
                result.kvDeletedByPrefix = await deleteKnownGroupKeysByPrefix(kv, getGroupMemberKvPrefix(normalizedGroupId));
            }
        } catch (err) {
            result.warnings.push(err?.message || 'Failed deleting group member index keys from KV');
        }

        try {
            const snapshot = await kv.get(KNOWN_GROUPS_KV_KEY, 'json');
            if (Array.isArray(snapshot)) {
                const filtered = snapshot
                    .map(normalizeKnownGroupEntry)
                    .filter(Boolean)
                    .filter((entry) => entry.groupId !== normalizedGroupId)
                    .slice(0, 500);

                await kv.put(KNOWN_GROUPS_KV_KEY, JSON.stringify(filtered));
            }
        } catch (err) {
            result.warnings.push(err?.message || 'Failed updating legacy known_groups snapshot');
        }

        // Rebuild cache from KV after delete so stale names do not remain in edge cache.
        try {
            const latest = await readKnownGroupsFromKv(env);
            await writeKnownGroupsToCache(latest.groups || []);
        } catch (err) {
            result.warnings.push(err?.message || 'Failed refreshing cache after group delete');
        }
    } else {
        result.warnings.push('KV binding does not support delete operation');
    }

    if (result.firestoreConfigured) {
        result.projectDeleted = await deleteFirestoreDocumentByPath(`projects/${normalizedGroupId}`, env);
        if (!result.projectDeleted) {
            result.warnings.push('Failed deleting project document from Firestore');
        }

        result.aliveModeDeleted = await deleteFirestoreDocumentByPath(`aliveModes/group_${normalizedGroupId}`, env);
        if (!result.aliveModeDeleted) {
            result.warnings.push('Failed deleting scoped alive mode from Firestore');
        }
    }

    return result;
}

export async function getKnownGroupsSnapshotWithSource(env = {}) {
    const store = getKnownGroupsStoreStatus(env);
    const fromKv = await readKnownGroupsFromKv(env);
    if (fromKv.groups.length > 0) {
        let source = 'kv';

        if (fromKv.mode === 'legacy-snapshot') {
            const migrated = await writeKnownGroupsToKv(fromKv.groups, env);
            source = migrated ? 'kv-legacy->kv' : 'kv-legacy';
        }

        // Mirror KV snapshot to cache so reads stay fast across edge nodes.
        await writeKnownGroupsToCache(fromKv.groups);
        return {
            groups: fromKv.groups,
            source,
            store
        };
    }

    // KV is authoritative when available. If KV is empty, do not rehydrate from cache,
    // otherwise stale cache data can resurrect deleted groups.
    if (store.kvAvailable) {
        await writeKnownGroupsToCache([]);
        return {
            groups: [],
            source: 'kv-empty',
            store
        };
    }

    const fromCache = await readKnownGroupsFromCache();
    if (fromCache.length > 0) {
        return {
            groups: fromCache,
            source: 'cache',
            store
        };
    }

    return {
        groups: [],
        source: 'empty',
        store
    };
}

export async function getKnownGroupsSnapshot(env = {}) {
    const snapshot = await getKnownGroupsSnapshotWithSource(env);
    return snapshot.groups;
}

async function readKnownGroupFromSnapshot(groupId, env = {}) {
    const normalizedGroupId = String(groupId || '').trim();
    if (!normalizedGroupId) {
        return null;
    }

    try {
        const snapshot = await getKnownGroupsSnapshotWithSource(env);
        const found = (snapshot.groups || []).find((entry) => entry.groupId === normalizedGroupId) || null;
        return normalizeKnownGroupEntry(found);
    } catch (err) {
        console.error(`Read known group snapshot failed (${normalizedGroupId}):`, err);
        return null;
    }
}

async function rememberKnownGroup(groupId, name, pictureUrl = null, env = {}, memberCount = null, groupType = null, inGroup = undefined) {
    const normalized = normalizeKnownGroupEntry({
        groupId,
        name,
        pictureUrl,
        groupType,
        inGroup,
        memberCount,
        lastSeenAt: new Date().toISOString()
    });

    if (!normalized) {
        return;
    }

    const cachedCurrent = await readKnownGroupsFromCache();
    const map = new Map(cachedCurrent.map((entry) => [entry.groupId, entry]));
    const previous = map.get(normalized.groupId) || {};

    const mergedEntry = {
        ...previous,
        ...normalized,
        groupType: normalized.groupType ?? previous.groupType ?? null,
        inGroup: typeof normalized.inGroup === 'boolean'
            ? normalized.inGroup
            : (typeof previous.inGroup === 'boolean' ? previous.inGroup : true),
        memberCount: normalized.memberCount ?? previous.memberCount ?? null,
        lastSeenAt: new Date().toISOString()
    };

    map.set(normalized.groupId, mergedEntry);

    const next = [...map.values()];
    const kvWriteOk = await writeKnownGroupToKv(mergedEntry, env);
    const cacheWriteOk = await writeKnownGroupsToCache(next);

    if (!kvWriteOk && getKnownGroupsKv(env)) {
        console.error('Known groups KV write failed; cache mirror status:', cacheWriteOk);
    }
}

export async function setKnownGroupType(groupId, groupType, env = {}) {
    const normalizedGroupId = String(groupId || '').trim();
    if (!normalizedGroupId) {
        throw new Error('Missing groupId');
    }

    const normalizedGroupType = normalizeGroupTypeValue(groupType) || 'unset';
    let existing = null;

    try {
        const snapshot = await getKnownGroupsSnapshotWithSource(env);
        existing = (snapshot.groups || []).find((entry) => entry.groupId === normalizedGroupId) || null;
    } catch (err) {
        console.error(`Read known group for setKnownGroupType failed (${normalizedGroupId}):`, err);
    }

    await rememberKnownGroup(
        normalizedGroupId,
        existing?.name || `LINE GROUP ${normalizedGroupId.slice(-6)}`,
        existing?.pictureUrl || null,
        env,
        existing?.memberCount ?? null,
        normalizedGroupType,
        existing?.inGroup
    );

    let firestoreSynced = false;
    if (env?.FIREBASE_PROJECT_ID && env?.FIREBASE_API_KEY) {
        firestoreSynced = await patchFirestoreDoc(`projects/${normalizedGroupId}`, {
            id: { stringValue: normalizedGroupId },
            groupType: { stringValue: normalizedGroupType },
            updatedAt: { timestampValue: new Date().toISOString() }
        }, env, false);
    }

    return {
        groupId: normalizedGroupId,
        groupType: normalizedGroupType,
        firestoreSynced
    };
}

function getFirestoreDocId(docName = '') {
    const normalized = String(docName || '').trim();
    if (!normalized) {
        return '';
    }

    const parts = normalized.split('/').filter(Boolean);
    if (parts.length === 0) {
        return '';
    }

    return parts[parts.length - 1];
}

async function walkFirestoreCollection(path, env = {}, onDocument = () => { }, options = {}) {
    const normalizedPath = String(path || '').trim();
    if (!normalizedPath || !env?.FIREBASE_PROJECT_ID || !env?.FIREBASE_API_KEY) {
        return {
            ok: false,
            scanned: 0,
            truncated: false,
            warning: 'Missing Firestore configuration'
        };
    }

    const pageSize = Number.isFinite(Number(options.pageSize)) ? Math.max(1, Math.min(1000, Math.floor(Number(options.pageSize)))) : 200;
    const maxPages = Number.isFinite(Number(options.maxPages)) ? Math.max(1, Math.floor(Number(options.maxPages))) : 30;

    let scanned = 0;
    let nextPageToken = null;
    let page = 0;

    try {
        do {
            let url = `${getFSBase(env)}/${normalizedPath}?pageSize=${pageSize}&key=${env.FIREBASE_API_KEY}`;
            if (nextPageToken) {
                url += `&pageToken=${encodeURIComponent(nextPageToken)}`;
            }

            const res = await fetch(url);
            if (!res.ok) {
                const errText = await res.text();
                return {
                    ok: false,
                    scanned,
                    truncated: false,
                    warning: `Firestore list failed (${normalizedPath}): ${res.status} ${errText}`
                };
            }

            const data = await res.json();
            const docs = Array.isArray(data?.documents) ? data.documents : [];
            for (const doc of docs) {
                try {
                    onDocument(doc || {});
                } catch (err) {
                    console.error(`walkFirestoreCollection callback error (${normalizedPath}):`, err);
                }
                scanned += 1;
            }

            nextPageToken = data?.nextPageToken || null;
            page += 1;
        } while (nextPageToken && page < maxPages);

        return {
            ok: true,
            scanned,
            truncated: Boolean(nextPageToken),
            warning: nextPageToken ? `Firestore list truncated (${normalizedPath}): maxPages reached` : null
        };
    } catch (err) {
        return {
            ok: false,
            scanned,
            truncated: false,
            warning: `Firestore list exception (${normalizedPath}): ${err?.message || String(err)}`
        };
    }
}

async function collectMemberIdsFromGroupMessages(groupId, env = {}) {
    const ids = new Set();
    const result = await walkFirestoreCollection(
        `projects/${groupId}/messages`,
        env,
        (doc) => {
            const fields = doc?.fields || {};
            const lineUserId = readFirestoreStringField(fields, 'lineUserId');
            if (lineUserId) {
                ids.add(lineUserId);
            }
        },
        { pageSize: 300, maxPages: 40 }
    );

    return {
        ids,
        scanned: result.scanned,
        warning: result.warning,
        truncated: result.truncated
    };
}

async function collectMemberIdsFromGroupUsers(groupId, env = {}) {
    const ids = new Set();
    const result = await walkFirestoreCollection(
        'groupUsers',
        env,
        (doc) => {
            const fields = doc?.fields || {};
            const projectGroup = readFirestoreStringField(fields, 'projectGroup');
            if (projectGroup !== groupId) {
                return;
            }

            const userIdFromField = readFirestoreStringField(fields, 'userId');
            const userId = userIdFromField || getFirestoreDocId(doc?.name);
            if (userId) {
                ids.add(userId);
            }
        },
        { pageSize: 300, maxPages: 40 }
    );

    return {
        ids,
        scanned: result.scanned,
        warning: result.warning,
        truncated: result.truncated
    };
}

async function collectMemberIdsFromProjectMembers(groupId, env = {}) {
    const ids = new Set();
    const result = await walkFirestoreCollection(
        `projects/${groupId}/members`,
        env,
        (doc) => {
            const fields = doc?.fields || {};
            const lineUserId = readFirestoreStringField(fields, 'lineUserId');
            const employeeId = readFirestoreStringField(fields, 'employeeId');
            const docId = getFirestoreDocId(doc?.name);

            const memberId = lineUserId || employeeId || docId;
            if (memberId) {
                ids.add(memberId);
            }
        },
        { pageSize: 300, maxPages: 40 }
    );

    return {
        ids,
        scanned: result.scanned,
        warning: result.warning,
        truncated: result.truncated
    };
}

async function collectMemberIdsFromInternalSources(groupId, env = {}) {
    const [messageResult, groupUsersResult, projectMembersResult, kvMemberIdsResult] = await Promise.all([
        collectMemberIdsFromGroupMessages(groupId, env),
        collectMemberIdsFromGroupUsers(groupId, env),
        collectMemberIdsFromProjectMembers(groupId, env),
        readGroupMemberIdsFromKv(groupId, env)
    ]);

    const ids = new Set([
        ...messageResult.ids,
        ...groupUsersResult.ids,
        ...projectMembersResult.ids,
        ...kvMemberIdsResult.ids
    ]);

    return {
        ids,
        messageResult,
        groupUsersResult,
        projectMembersResult,
        kvMemberIdsResult
    };
}

async function mirrorMemberIdsToKv(groupId, ids, env = {}) {
    const list = Array.isArray(ids) ? ids : [...(ids || [])];
    if (list.length === 0) {
        return 0;
    }

    let mirrored = 0;
    for (const memberId of list) {
        const ok = await rememberGroupMember(groupId, memberId, env);
        if (ok) {
            mirrored += 1;
        }
    }

    return mirrored;
}

export async function recountMemberCountFromFirestoreSources(groupId, env = {}) {
    const normalizedGroupId = String(groupId || '').trim();
    if (!normalizedGroupId) {
        throw new Error('Missing groupId');
    }

    if (!env?.FIREBASE_PROJECT_ID || !env?.FIREBASE_API_KEY) {
        throw new Error('Missing Firestore configuration');
    }

    const warnings = [];
    const {
        ids: uniqueUserIds,
        messageResult,
        groupUsersResult,
        projectMembersResult,
        kvMemberIdsResult
    } = await collectMemberIdsFromInternalSources(normalizedGroupId, env);

    if (messageResult.warning) {
        warnings.push(`messages:${messageResult.warning}`);
    }
    if (groupUsersResult.warning) {
        warnings.push(`groupUsers:${groupUsersResult.warning}`);
    }
    if (projectMembersResult.warning) {
        warnings.push(`projectMembers:${projectMembersResult.warning}`);
    }
    if (kvMemberIdsResult.warning && kvMemberIdsResult.warning !== 'KV list unavailable') {
        warnings.push(`kvMembers:${kvMemberIdsResult.warning}`);
    }

    let memberCount = uniqueUserIds.size;
    let lineMembersCount = null;

    if (memberCount > 0) {
        await mirrorMemberIdsToKv(normalizedGroupId, uniqueUserIds, env);
    }

    if (memberCount <= 1) {
        const lineCountRes = await fetchLineGroupMemberCount(normalizedGroupId, env);
        if (lineCountRes.count !== null && lineCountRes.count > memberCount) {
            lineMembersCount = lineCountRes.count;
            memberCount = lineCountRes.count;
            warnings.push(`fallback:line-memberCount:${lineCountRes.count}`);
        } else if (lineCountRes.error && !isLineNotInGroupError(lineCountRes.error)) {
            warnings.push(`line-memberCount:${lineCountRes.error}`);
        }
    }

    const projectFallback = await readProjectIdentityFromFirestore(normalizedGroupId, env);
    const knownGroupFallback = await readKnownGroupFromSnapshot(normalizedGroupId, env);

    const historicalFloor = resolveHistoricalMemberCountFloor(
        projectFallback?.memberCount,
        knownGroupFallback?.memberCount
    );

    if (historicalFloor !== null && historicalFloor > memberCount) {
        memberCount = historicalFloor;
        warnings.push(`fallback:historical-memberCount:${historicalFloor}`);
    }

    if (memberCount === 0) {
        const forcedMin = getForcedMinimumMemberCount(env);
        if (forcedMin > 0) {
            memberCount = forcedMin;
            warnings.push(`fallback:forced-min-memberCount:${forcedMin}`);
        }
    }

    await rememberKnownGroup(
        normalizedGroupId,
        projectFallback?.name || knownGroupFallback?.name || `LINE GROUP ${normalizedGroupId.slice(-6)}`,
        projectFallback?.pictureUrl || knownGroupFallback?.pictureUrl || null,
        env,
        memberCount,
        projectFallback?.groupType || knownGroupFallback?.groupType || null
    );

    const projectSynced = await patchFirestoreDoc(`projects/${normalizedGroupId}`, {
        id: { stringValue: normalizedGroupId },
        memberCount: { integerValue: String(memberCount) },
        updatedAt: { timestampValue: new Date().toISOString() }
    }, env, false);

    if (!projectSynced) {
        warnings.push('firestore-project-write-failed');
    }

    return {
        groupId: normalizedGroupId,
        memberCount,
        uniqueMembers: uniqueUserIds.size,
        fromMessages: messageResult.ids.size,
        fromGroupUsers: groupUsersResult.ids.size,
        fromProjectMembers: projectMembersResult.ids.size,
        fromKvMembers: kvMemberIdsResult.ids.size,
        fromLineMembersCount: lineMembersCount,
        scannedMessages: messageResult.scanned,
        scannedGroupUsers: groupUsersResult.scanned,
        scannedProjectMembers: projectMembersResult.scanned,
        projectSynced,
        warnings
    };
}

function readFirestoreStringField(fields, key) {
    return String(fields?.[key]?.stringValue || '').trim();
}

function readFirestoreIntegerField(fields, key) {
    const field = fields?.[key];
    if (!field || typeof field !== 'object') {
        return null;
    }

    const numericCandidates = [field.integerValue, field.doubleValue, field.stringValue];
    for (const raw of numericCandidates) {
        if (raw === undefined || raw === null || raw === '') {
            continue;
        }

        const parsed = Number(raw);
        if (Number.isFinite(parsed) && parsed >= 0) {
            return Math.floor(parsed);
        }
    }

    return null;
}

function readFirestoreStringArrayField(fields, key) {
    const values = fields?.[key]?.arrayValue?.values;
    if (!Array.isArray(values) || values.length === 0) {
        return [];
    }

    const output = [];
    for (const item of values) {
        const value = String(item?.stringValue || '').trim();
        if (value) {
            output.push(value);
        }
    }

    return output;
}

function readFirestoreTimelineEntries(fields, key = 'timelineEntries') {
    const values = fields?.[key]?.arrayValue?.values;
    if (!Array.isArray(values) || values.length === 0) {
        return [];
    }

    const output = [];
    for (const item of values) {
        const entryFields = item?.mapValue?.fields;
        if (!entryFields || typeof entryFields !== 'object') {
            continue;
        }

        const id = String(entryFields?.id?.stringValue || '').trim();
        const time = String(entryFields?.time?.stringValue || entryFields?.time?.timestampValue || '').trim();
        const title = String(entryFields?.title?.stringValue || '').trim();
        const detail = String(entryFields?.detail?.stringValue || '').trim();
        const actor = String(entryFields?.actor?.stringValue || '').trim();
        const tone = String(entryFields?.tone?.stringValue || '').trim();
        const replyLineMessageId = String(entryFields?.replyLineMessageId?.stringValue || '').trim();

        if (!time && !title && !detail) {
            continue;
        }

        output.push({
            id,
            time,
            title,
            detail,
            actor,
            tone,
            replyLineMessageId
        });
    }

    return output;
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

    const nextTimelineEntries = [
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
    ].slice(-60);

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

    const updated = await patchFirestoreDoc(`tasks/${taskDocId}`, {
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
        updatedByName: fsString(actorName || '')
    }, env, false);

    return {
        matched: true,
        updated,
        taskId: taskDocId,
        reason: updated ? 'reply-recorded' : 'write-failed'
    };
}

function normalizeGroupTypeValue(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
        return null;
    }

    if (GROUP_TYPE_VALUES.has(normalized)) {
        return normalized;
    }

    return null;
}

async function readProjectIdentityFromFirestore(groupId, env = {}) {
    const normalizedGroupId = String(groupId || '').trim();
    if (!normalizedGroupId || !env?.FIREBASE_PROJECT_ID || !env?.FIREBASE_API_KEY) {
        return null;
    }

    try {
        const fields = await fsGetDoc('projects', normalizedGroupId, env);
        if (!fields) {
            return null;
        }

        const candidates = [
            readFirestoreStringField(fields, 'name'),
            readFirestoreStringField(fields, 'groupName'),
            readFirestoreStringField(fields, 'webProjectName')
        ].filter(Boolean);

        const name = candidates.find((item) => !isGenericKnownGroupName(item)) || candidates[0] || null;
        const pictureUrl = readFirestoreStringField(fields, 'pictureUrl') || null;
        const memberCount = readFirestoreIntegerField(fields, 'memberCount');
        const groupType = normalizeGroupTypeValue(readFirestoreStringField(fields, 'groupType'));

        if (!name && !pictureUrl && memberCount === null && !groupType) {
            return null;
        }

        return { name, pictureUrl, memberCount, groupType };
    } catch (err) {
        console.error(`Read project identity fallback failed (${normalizedGroupId}):`, err);
        return null;
    }
}

async function readProjectMemberCountFromMembersCollection(groupId, env = {}) {
    const normalizedGroupId = String(groupId || '').trim();
    if (!normalizedGroupId || !env?.FIREBASE_PROJECT_ID || !env?.FIREBASE_API_KEY) {
        return null;
    }

    let total = 0;
    let nextPageToken = null;
    let guard = 0;

    try {
        do {
            let url = `${getFSBase(env)}/projects/${normalizedGroupId}/members?pageSize=200&key=${env.FIREBASE_API_KEY}`;
            if (nextPageToken) {
                url += `&pageToken=${encodeURIComponent(nextPageToken)}`;
            }

            const res = await fetch(url);
            if (!res.ok) {
                const errText = await res.text();
                console.error(`Read members subcollection failed (${normalizedGroupId}):`, res.status, errText);
                return null;
            }

            const data = await res.json();
            const docs = Array.isArray(data?.documents) ? data.documents : [];
            total += docs.length;

            nextPageToken = data?.nextPageToken || null;
            guard += 1;
        } while (nextPageToken && guard < 30);

        if (nextPageToken) {
            console.error(`Members subcollection count truncated (${normalizedGroupId}): pagination guard reached`);
        }

        return total;
    } catch (err) {
        console.error(`Read members subcollection count exception (${normalizedGroupId}):`, err);
        return null;
    }
}

function isLikelyLineUserId(value) {
    return /^U[0-9a-f]{32}$/i.test(String(value || '').trim());
}

function getEmployeeDocIdFromLineUserId(lineUserId) {
    const normalized = String(lineUserId || '').trim();
    if (!isLikelyLineUserId(normalized)) {
        return '';
    }

    return `emp_${normalized.slice(-6)}`;
}

function isGenericLineDisplayName(name, lineUserId = '') {
    const normalizedName = String(name || '').trim();
    if (!normalizedName) {
        return true;
    }

    const normalizedLineUserId = String(lineUserId || '').trim();
    if (normalizedLineUserId) {
        return normalizedName === `LINE-${normalizedLineUserId.slice(-6)}`;
    }

    return /^LINE-[A-Za-z0-9]{4,}$/i.test(normalizedName);
}

function mergeGroupTeamCandidate(candidateMap, rawCandidate = {}) {
    if (!(candidateMap instanceof Map)) {
        return;
    }

    const lineUserIdRaw = String(rawCandidate?.lineUserId || '').trim();
    const lineUserId = isLikelyLineUserId(lineUserIdRaw) ? lineUserIdRaw : '';
    const empIdRaw = String(rawCandidate?.empId || '').trim();
    const empId = empIdRaw || getEmployeeDocIdFromLineUserId(lineUserId);
    if (!empId) {
        return;
    }

    const fallbackName = lineUserId ? `LINE-${lineUserId.slice(-6)}` : empId;
    const incomingName = String(rawCandidate?.displayName || rawCandidate?.fullName || '').trim();
    const displayName = incomingName || fallbackName;
    const source = String(rawCandidate?.source || '').trim();

    const current = candidateMap.get(empId) || {
        empId,
        lineUserId: '',
        displayName: fallbackName,
        sources: []
    };

    const merged = {
        ...current,
        empId,
        lineUserId: current.lineUserId || lineUserId,
        displayName: current.displayName,
        sources: Array.isArray(current.sources) ? [...current.sources] : []
    };

    if (source && !merged.sources.includes(source)) {
        merged.sources.push(source);
    }

    if (lineUserId && !merged.lineUserId) {
        merged.lineUserId = lineUserId;
    }

    if (!merged.displayName || isGenericLineDisplayName(merged.displayName, merged.lineUserId)) {
        merged.displayName = displayName;
    } else if (!isGenericLineDisplayName(displayName, lineUserId) && displayName.length >= merged.displayName.length) {
        merged.displayName = displayName;
    }

    candidateMap.set(empId, merged);
}

async function collectGroupTeamCandidates(groupId, env = {}, options = {}) {
    const candidateMap = new Map();
    const warnings = [];
    const sourceStats = {
        fromSeedLineMembers: 0,
        fromGroupMemberLinks: 0,
        fromGroupUsers: 0,
        fromMessages: 0,
        fromProjectMembers: 0
    };

    const seedLineUserIds = Array.isArray(options?.seedLineUserIds)
        ? options.seedLineUserIds
        : [];

    const fallbackUserId = String(options?.fallbackUserId || '').trim();
    const seedIds = new Set(
        [...seedLineUserIds, fallbackUserId]
            .map((id) => String(id || '').trim())
            .filter(Boolean)
    );

    for (const lineUserId of seedIds) {
        if (!isLikelyLineUserId(lineUserId)) {
            continue;
        }

        mergeGroupTeamCandidate(candidateMap, {
            lineUserId,
            displayName: `LINE-${lineUserId.slice(-6)}`,
            source: 'line-members'
        });
        sourceStats.fromSeedLineMembers += 1;
    }

    const groupMemberLinksResult = await walkFirestoreCollection(
        'groupMemberLinks',
        env,
        (doc) => {
            const fields = doc?.fields || {};
            const linkedGroupId = readFirestoreStringField(fields, 'groupId');
            if (linkedGroupId !== groupId) {
                return;
            }

            const lineUserId = readFirestoreStringField(fields, 'lineUserId');
            if (!isLikelyLineUserId(lineUserId)) {
                return;
            }

            const displayName = readFirestoreStringField(fields, 'displayName');
            mergeGroupTeamCandidate(candidateMap, {
                lineUserId,
                displayName,
                source: 'groupMemberLinks'
            });
            sourceStats.fromGroupMemberLinks += 1;
        },
        { pageSize: 300, maxPages: 40 }
    );
    if (groupMemberLinksResult.warning) {
        warnings.push(`groupMemberLinks:${groupMemberLinksResult.warning}`);
    }

    const groupUsersResult = await walkFirestoreCollection(
        'groupUsers',
        env,
        (doc) => {
            const fields = doc?.fields || {};
            const projectGroup = readFirestoreStringField(fields, 'projectGroup');
            if (projectGroup !== groupId) {
                return;
            }

            const lineUserId = readFirestoreStringField(fields, 'userId') || getFirestoreDocId(doc?.name);
            if (!isLikelyLineUserId(lineUserId)) {
                return;
            }

            const displayName = readFirestoreStringField(fields, 'displayName');
            mergeGroupTeamCandidate(candidateMap, {
                lineUserId,
                displayName,
                source: 'groupUsers'
            });
            sourceStats.fromGroupUsers += 1;
        },
        { pageSize: 300, maxPages: 40 }
    );
    if (groupUsersResult.warning) {
        warnings.push(`groupUsers:${groupUsersResult.warning}`);
    }

    const messagesResult = await walkFirestoreCollection(
        `projects/${groupId}/messages`,
        env,
        (doc) => {
            const fields = doc?.fields || {};
            const lineUserId = readFirestoreStringField(fields, 'lineUserId');
            if (!isLikelyLineUserId(lineUserId)) {
                return;
            }

            mergeGroupTeamCandidate(candidateMap, {
                lineUserId,
                displayName: `LINE-${lineUserId.slice(-6)}`,
                source: 'messages'
            });
            sourceStats.fromMessages += 1;
        },
        { pageSize: 300, maxPages: 40 }
    );
    if (messagesResult.warning) {
        warnings.push(`messages:${messagesResult.warning}`);
    }

    const projectMembersResult = await walkFirestoreCollection(
        `projects/${groupId}/members`,
        env,
        (doc) => {
            const fields = doc?.fields || {};
            const employeeId = readFirestoreStringField(fields, 'employeeId') || getFirestoreDocId(doc?.name);
            if (!employeeId) {
                return;
            }

            const lineUserIdRaw = readFirestoreStringField(fields, 'lineUserId');
            const lineUserId = isLikelyLineUserId(lineUserIdRaw) ? lineUserIdRaw : '';
            const fullName = readFirestoreStringField(fields, 'fullName') || readFirestoreStringField(fields, 'name');

            mergeGroupTeamCandidate(candidateMap, {
                empId: employeeId,
                lineUserId,
                displayName: fullName,
                source: 'projectMembers'
            });
            sourceStats.fromProjectMembers += 1;
        },
        { pageSize: 300, maxPages: 40 }
    );
    if (projectMembersResult.warning) {
        warnings.push(`projectMembers:${projectMembersResult.warning}`);
    }

    return {
        candidates: [...candidateMap.values()],
        warnings,
        sourceStats
    };
}

async function upsertGroupTeamEmployee(groupId, candidate = {}, env = {}) {
    const empId = String(candidate?.empId || '').trim();
    if (!empId) {
        return false;
    }

    const lineUserIdRaw = String(candidate?.lineUserId || '').trim();
    const lineUserId = isLikelyLineUserId(lineUserIdRaw) ? lineUserIdRaw : '';
    const fallbackName = lineUserId ? `LINE-${lineUserId.slice(-6)}` : empId;
    const displayName = String(candidate?.displayName || '').trim() || fallbackName;

    const fields = {
        id: { stringValue: empId },
        name: { stringValue: displayName },
        fullName: { stringValue: displayName },
        role: { stringValue: 'member' },
        projectId: { stringValue: groupId },
        updatedAt: { timestampValue: new Date().toISOString() }
    };

    if (lineUserId) {
        fields.lineUserId = { stringValue: lineUserId };
    }

    fields.isPlaceholder = { booleanValue: false };

    return patchFirestoreDoc(`employees/${empId}`, fields, env, false);
}

function getGroupPlaceholderEmployeeId(groupId, index) {
    const normalizedGroupId = String(groupId || '').trim();
    const normalizedIndex = Math.max(1, Math.floor(Number(index) || 1));
    return `emp_${normalizedGroupId.slice(-6)}_ph_${String(normalizedIndex).padStart(2, '0')}`;
}

function resolveExpectedTeamMemberCount(rawExpectedCount, env = {}) {
    const expected = normalizeNonNegativeInteger(rawExpectedCount);
    if (expected === null) {
        return null;
    }

    if (shouldIncludeBotInMemberCount(env) && expected > 0) {
        return Math.max(0, expected - 1);
    }

    return expected;
}

async function clearGroupPlaceholderEmployees(groupId, env = {}) {
    let deleted = 0;
    const result = await walkFirestoreCollection(
        'employees',
        env,
        async (doc) => {
            const docId = getFirestoreDocId(doc?.name);
            if (!docId) {
                return;
            }

            const fields = doc?.fields || {};
            const projectId = readFirestoreStringField(fields, 'projectId');
            if (projectId !== groupId) {
                return;
            }

            const isPlaceholder = parseFirestoreBooleanField(fields?.isPlaceholder);
            if (!isPlaceholder) {
                return;
            }

            const ok = await deleteFirestoreDocumentByPath(`employees/${docId}`, env);
            if (ok) {
                deleted += 1;
            }
        },
        { pageSize: 300, maxPages: 40 }
    );

    return {
        deleted,
        warning: result.warning || null
    };
}

async function removeOneGroupPlaceholderEmployee(groupId, env = {}) {
    const placeholders = [];
    const result = await walkFirestoreCollection(
        'employees',
        env,
        (doc) => {
            const docId = getFirestoreDocId(doc?.name);
            if (!docId) {
                return;
            }

            const fields = doc?.fields || {};
            const projectId = readFirestoreStringField(fields, 'projectId');
            if (projectId !== groupId) {
                return;
            }

            const isPlaceholder = parseFirestoreBooleanField(fields?.isPlaceholder);
            if (!isPlaceholder) {
                return;
            }

            placeholders.push({
                docId,
                placeholderIndex: readFirestoreIntegerField(fields, 'placeholderIndex') ?? Number.MAX_SAFE_INTEGER
            });
        },
        { pageSize: 300, maxPages: 40 }
    );

    if (placeholders.length === 0) {
        return {
            removed: false,
            removedDocId: null,
            warning: result.warning || null
        };
    }

    placeholders.sort((a, b) => {
        if (a.placeholderIndex !== b.placeholderIndex) {
            return a.placeholderIndex - b.placeholderIndex;
        }
        return String(a.docId || '').localeCompare(String(b.docId || ''));
    });

    const target = placeholders[0];
    const deleted = await deleteFirestoreDocumentByPath(`employees/${target.docId}`, env);

    if (!deleted) {
        return {
            removed: false,
            removedDocId: null,
            warning: result.warning || 'placeholder-delete-failed'
        };
    }

    return {
        removed: true,
        removedDocId: target.docId,
        warning: result.warning || null
    };
}

async function upsertGroupPlaceholderEmployees(groupId, groupName, totalPlaceholders, env = {}) {
    const placeholders = Math.max(0, Math.floor(Number(totalPlaceholders) || 0));
    if (placeholders <= 0) {
        return {
            attempted: 0,
            synced: 0,
            failed: 0
        };
    }

    const normalizedGroupName = String(groupName || `LINE GROUP ${groupId.slice(-6)}`).trim();
    let synced = 0;
    let failed = 0;

    for (let i = 1; i <= placeholders; i += 1) {
        const empId = getGroupPlaceholderEmployeeId(groupId, i);
        const fields = {
            id: { stringValue: empId },
            name: { stringValue: `${normalizedGroupName} สมาชิก ${i}` },
            fullName: { stringValue: `${normalizedGroupName} สมาชิก ${i}` },
            role: { stringValue: 'member' },
            projectId: { stringValue: groupId },
            isPlaceholder: { booleanValue: true },
            placeholderIndex: { integerValue: String(i) },
            updatedAt: { timestampValue: new Date().toISOString() }
        };

        const ok = await patchFirestoreDoc(`employees/${empId}`, fields, env, false);
        if (ok) {
            synced += 1;
        } else {
            failed += 1;
        }
    }

    return {
        attempted: placeholders,
        synced,
        failed
    };
}

export async function syncGroupMembersToTeam(groupId, env = {}, options = {}) {
    const normalizedGroupId = String(groupId || '').trim();
    if (!normalizedGroupId) {
        throw new Error('Missing groupId');
    }

    if (!env?.FIREBASE_PROJECT_ID || !env?.FIREBASE_API_KEY) {
        throw new Error('Missing Firestore configuration');
    }

    const { candidates, warnings, sourceStats } = await collectGroupTeamCandidates(normalizedGroupId, env, options);
    const expectedMemberCount = resolveExpectedTeamMemberCount(options?.expectedMemberCount, env);

    let synced = 0;
    let failed = 0;
    for (const candidate of candidates) {
        const ok = await upsertGroupTeamEmployee(normalizedGroupId, candidate, env);
        if (ok) {
            synced += 1;
        } else {
            failed += 1;
        }
    }

    let placeholderResult = { attempted: 0, synced: 0, failed: 0 };
    const discoveredMembers = candidates.length;

    if (expectedMemberCount !== null) {
        const clearResult = await clearGroupPlaceholderEmployees(normalizedGroupId, env);
        if (clearResult.warning) {
            warnings.push(`employees-clear-placeholder:${clearResult.warning}`);
        }

        const placeholdersNeeded = Math.max(0, expectedMemberCount - discoveredMembers);
        placeholderResult = await upsertGroupPlaceholderEmployees(
            normalizedGroupId,
            options?.groupName,
            placeholdersNeeded,
            env
        );
    }

    const totalAttempted = candidates.length + placeholderResult.attempted;
    const totalSynced = synced + placeholderResult.synced;
    const totalFailed = failed + placeholderResult.failed;

    return {
        groupId: normalizedGroupId,
        attempted: totalAttempted,
        synced: totalSynced,
        failed: totalFailed,
        discoveredMembers,
        expectedMemberCount,
        placeholders: placeholderResult,
        sourceStats,
        warnings
    };
}

export async function refreshKnownGroupIdentity(groupId, env = {}, current = {}) {
    const normalizedGroupId = String(groupId || '').trim();
    if (!normalizedGroupId) {
        return null;
    }

    const fallbackName = `LINE GROUP ${normalizedGroupId.slice(-6)}`;
    let resolvedName = String(current?.name || '').trim();
    let resolvedPictureUrl = current?.pictureUrl || null;
    const currentInGroup = normalizeKnownGroupInGroup(current?.inGroup);
    let resolvedInGroup = typeof currentInGroup === 'boolean' ? currentInGroup : true;
    const currentMemberCount = Number(current?.memberCount ?? current?.members);
    let resolvedMemberCount = Number.isFinite(currentMemberCount) && currentMemberCount >= 0
        ? Math.floor(currentMemberCount)
        : null;
    let resolvedGroupType = normalizeGroupTypeValue(current?.groupType ?? current?.type);
    let source = 'known-groups';
    let warning = null;

    const shouldLookupLine = Boolean(env?.LINE_TOKEN) &&
        (isGenericKnownGroupName(resolvedName) || !resolvedPictureUrl);

    if (shouldLookupLine) {
        const summaryRes = await lineFetchJson(
            `https://api.line.me/v2/bot/group/${normalizedGroupId}/summary`,
            env,
            1
        );

        if (summaryRes.ok) {
            source = 'line-summary';
            resolvedName = String(summaryRes.data?.groupName || resolvedName || fallbackName);
            resolvedPictureUrl = summaryRes.data?.pictureUrl || resolvedPictureUrl || null;
            resolvedInGroup = true;
        } else {
            warning = summaryRes.error;
            if (isLineNotInGroupError(summaryRes.error)) {
                resolvedInGroup = false;
            }
        }
    }

    const shouldLookupFirestoreProject = Boolean(env?.FIREBASE_PROJECT_ID && env?.FIREBASE_API_KEY) &&
        (isGenericKnownGroupName(resolvedName) || !resolvedPictureUrl || resolvedMemberCount === null || !resolvedGroupType);

    if (shouldLookupFirestoreProject) {
        const fallbackProject = await readProjectIdentityFromFirestore(normalizedGroupId, env);
        if (fallbackProject) {
            if (fallbackProject.name) {
                resolvedName = fallbackProject.name;
            }
            if (fallbackProject.pictureUrl && !resolvedPictureUrl) {
                resolvedPictureUrl = fallbackProject.pictureUrl;
            }
            if (fallbackProject.memberCount !== null && fallbackProject.memberCount !== undefined) {
                resolvedMemberCount = fallbackProject.memberCount;
            }
            if (fallbackProject.groupType) {
                resolvedGroupType = fallbackProject.groupType;
            }

            if (source !== 'line-summary') {
                source = 'firestore-project';
            }

            if (!isGenericKnownGroupName(resolvedName)) {
                warning = null;
            }
        }
    }

    if (!resolvedName) {
        resolvedName = fallbackName;
    }

    await rememberKnownGroup(
        normalizedGroupId,
        resolvedName,
        resolvedPictureUrl,
        env,
        resolvedMemberCount,
        resolvedGroupType,
        resolvedInGroup
    );

    return {
        groupId: normalizedGroupId,
        name: resolvedName,
        pictureUrl: resolvedPictureUrl,
        memberCount: resolvedMemberCount,
        groupType: resolvedGroupType,
        inGroup: resolvedInGroup,
        lastSeenAt: new Date().toISOString(),
        source,
        warning
    };
}

// ✅ Full Sync Mode (Reusable from Web + LINE)
export async function fullGroupSync(groupId, env, options = {}) {
    const fallbackUserId = options?.fallbackUserId || null;

    if (!groupId) {
        throw new Error('Missing groupId for full sync');
    }

    if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_API_KEY || !env.LINE_TOKEN) {
        throw new Error('Missing required environment variables for full group sync');
    }

    const result = {
        groupId,
        groupName: `LINE GROUP ${groupId.slice(-6)}`,
        inGroup: true,
        projectSynced: false,
        memberCount: 0,
        membersAttempted: 0,
        membersSynced: 0,
        membersFailed: 0,
        teamSyncResult: null,
        warnings: []
    };

    // 1️⃣ ดึงชื่อกลุ่ม
    let groupPicture = null;
    let projectFallback = null;
    const summaryRes = await lineFetchJson(`https://api.line.me/v2/bot/group/${groupId}/summary`, env, 2);
    if (summaryRes.ok) {
        result.groupName = summaryRes.data.groupName || result.groupName;
        groupPicture = summaryRes.data.pictureUrl || null;
        result.inGroup = true;
    } else {
        result.warnings.push(`group-summary:${summaryRes.error}`);

        if (isLineNotInGroupError(summaryRes.error)) {
            result.inGroup = false;
            result.warnings.push('group-state:not-in-group');
        }

        projectFallback = await readProjectIdentityFromFirestore(groupId, env);
        if (projectFallback) {
            if (projectFallback.name) {
                result.groupName = projectFallback.name;
            }
            if (projectFallback.pictureUrl) {
                groupPicture = projectFallback.pictureUrl;
            }
        }
    }

    if (!groupPicture) {
        if (!projectFallback) {
            projectFallback = await readProjectIdentityFromFirestore(groupId, env);
        }

        if (projectFallback?.pictureUrl) {
            groupPicture = projectFallback.pictureUrl;
            result.warnings.push('group-picture:fallback-firestore-project');
        } else {
            const knownGroupIdentity = await readKnownGroupFromSnapshot(groupId, env);
            if (knownGroupIdentity?.pictureUrl) {
                groupPicture = knownGroupIdentity.pictureUrl;
                result.warnings.push('group-picture:fallback-known-group');
            }
        }
    }

    if (!result.inGroup) {
        await rememberKnownGroup(
            groupId,
            result.groupName,
            groupPicture,
            env,
            result.memberCount,
            projectFallback?.groupType || null,
            false
        );

        const projectFields = {
            id: { stringValue: groupId },
            name: { stringValue: result.groupName },
            source: { stringValue: 'line-group' },
            inGroup: { booleanValue: false },
            updatedAt: { timestampValue: new Date().toISOString() }
        };
        if (groupPicture) {
            projectFields.pictureUrl = { stringValue: groupPicture };
        }

        const projectSynced = await patchFirestoreDoc(`projects/${groupId}`, projectFields, env, false);
        result.projectSynced = projectSynced;
        if (!projectSynced) {
            result.warnings.push('firestore-project-write-failed');
        }

        return result;
    }

    // 2️⃣ ดึงสมาชิกทั้งหมด
    let next = null;
    const memberSet = new Set();
    let pageGuard = 0;
    let membersApiUnavailable = false;

    do {
        const membersUrl = next
            ? `https://api.line.me/v2/bot/group/${groupId}/members/ids?start=${next}`
            : `https://api.line.me/v2/bot/group/${groupId}/members/ids`;

        const membersRes = await lineFetchJson(membersUrl, env, 1);
        if (!membersRes.ok) {
            membersApiUnavailable = true;
            result.warnings.push(`group-members:${membersRes.error}`);
            if (isLineNotInGroupError(membersRes.error)) {
                result.inGroup = false;
                result.warnings.push('group-state:not-in-group');
            }
            break;
        }

        const membersData = membersRes.data || {};
        const memberIds = membersData.memberIds || [];
        next = membersData.next || null;
        pageGuard += 1;

        for (const userId of memberIds) {
            if (userId) {
                memberSet.add(userId);
            }
        }
    } while (next && pageGuard < 50);

    if (next) {
        result.warnings.push('group-members:pagination-limit-reached');
    }

    if (memberSet.size === 0 && fallbackUserId) {
        memberSet.add(fallbackUserId);
        result.warnings.push('group-members:fallback-to-command-user');
    }

    const memberIds = [...memberSet];
    let resolvedMemberCount = memberIds.length;
    let knownGroupFallback = null;
    if (result.inGroup && (membersApiUnavailable || resolvedMemberCount <= 1)) {
        const lineCountRes = await fetchLineGroupMemberCount(groupId, env);
        if (lineCountRes.count !== null && lineCountRes.count > resolvedMemberCount) {
            resolvedMemberCount = lineCountRes.count;
            result.warnings.push(`group-members:fallback-line-count:${lineCountRes.count}`);
        } else if (lineCountRes.error) {
            result.warnings.push(`group-member-count:${lineCountRes.error}`);
            if (isLineNotInGroupError(lineCountRes.error)) {
                result.inGroup = false;
                result.warnings.push('group-state:not-in-group');
            }
        }
    }

    if (resolvedMemberCount === 0) {
        if (!projectFallback) {
            projectFallback = await readProjectIdentityFromFirestore(groupId, env);
        }

        if (projectFallback?.memberCount !== null && projectFallback?.memberCount !== undefined) {
            resolvedMemberCount = Math.max(resolvedMemberCount, projectFallback.memberCount);
        }

        if (resolvedMemberCount === 0) {
            const membersCollectionCount = await readProjectMemberCountFromMembersCollection(groupId, env);
            if (membersCollectionCount !== null) {
                resolvedMemberCount = Math.max(resolvedMemberCount, membersCollectionCount);
            }
        }

        if (resolvedMemberCount === 0) {
            const internalSources = await collectMemberIdsFromInternalSources(groupId, env);
            const internalCount = internalSources.ids.size;
            if (internalCount > 0) {
                resolvedMemberCount = Math.max(resolvedMemberCount, internalCount);
                result.warnings.push(`group-members:fallback-internal-count:${internalCount}`);
                await mirrorMemberIdsToKv(groupId, internalSources.ids, env);
            }
        }

        if (resolvedMemberCount === 0) {
            knownGroupFallback = await readKnownGroupFromSnapshot(groupId, env);
            if (knownGroupFallback?.memberCount !== null && knownGroupFallback?.memberCount !== undefined) {
                resolvedMemberCount = Math.max(resolvedMemberCount, knownGroupFallback.memberCount);
                result.warnings.push(`group-members:fallback-known-group-count:${knownGroupFallback.memberCount}`);
            }
        }

        if (resolvedMemberCount > 0) {
            result.warnings.push(`group-members:fallback-firestore-count:${resolvedMemberCount}`);
        } else {
            result.warnings.push('group-members:fallback-empty');
        }
    }

    if (membersApiUnavailable) {
        if (!projectFallback) {
            projectFallback = await readProjectIdentityFromFirestore(groupId, env);
        }
        if (!knownGroupFallback) {
            knownGroupFallback = await readKnownGroupFromSnapshot(groupId, env);
        }

        const historicalFloor = resolveHistoricalMemberCountFloor(
            projectFallback?.memberCount,
            knownGroupFallback?.memberCount
        );

        if (historicalFloor !== null && historicalFloor > resolvedMemberCount) {
            resolvedMemberCount = historicalFloor;
            result.warnings.push(`group-members:fallback-historical-count:${historicalFloor}`);
        }
    }

    if (resolvedMemberCount === 0) {
        const forcedMin = getForcedMinimumMemberCount(env);
        if (forcedMin > 0) {
            resolvedMemberCount = forcedMin;
            result.warnings.push(`group-members:fallback-forced-min:${forcedMin}`);
        }
    }

    result.memberCount = resolvedMemberCount;
    result.membersAttempted = memberIds.length;

    if (!result.inGroup) {
        await rememberKnownGroup(
            groupId,
            result.groupName,
            groupPicture,
            env,
            result.memberCount,
            projectFallback?.groupType || null,
            false
        );

        const projectSynced = await patchFirestoreDoc(`projects/${groupId}`, {
            id: { stringValue: groupId },
            name: { stringValue: result.groupName },
            source: { stringValue: 'line-group' },
            inGroup: { booleanValue: false },
            updatedAt: { timestampValue: new Date().toISOString() }
        }, env, false);
        result.projectSynced = projectSynced;
        if (!projectSynced) {
            result.warnings.push('firestore-project-write-failed');
        }

        return result;
    }

    await rememberKnownGroup(
        groupId,
        result.groupName,
        groupPicture,
        env,
        result.memberCount,
        projectFallback?.groupType || null,
        true
    );

    // 3️⃣ Upsert Project (ไม่ใช้ exists=false เพื่อให้ update ได้)
    const projectFields = {
        id: { stringValue: groupId },
        name: { stringValue: result.groupName },
        source: { stringValue: 'line-group' },
        inGroup: { booleanValue: true },
        memberCount: { integerValue: String(result.memberCount) },
        updatedAt: { timestampValue: new Date().toISOString() }
    };
    if (groupPicture) {
        projectFields.pictureUrl = { stringValue: groupPicture };
    }
    if (projectFallback?.groupType) {
        projectFields.groupType = { stringValue: projectFallback.groupType };
    }

    const projectSynced = await patchFirestoreDoc(`projects/${groupId}`, projectFields, env, false);
    result.projectSynced = projectSynced;
    if (!projectSynced) {
        result.warnings.push('firestore-project-write-failed');
    }

    for (const userId of memberIds) {
        await rememberGroupMember(groupId, userId, env);

        let profile = null;

        // ใช้ endpoint สมาชิกในกลุ่มก่อน เพื่อรองรับผู้ใช้ที่ยังไม่เป็นเพื่อนกับบอท
        const groupProfileRes = await lineFetchJson(
            `https://api.line.me/v2/bot/group/${groupId}/member/${userId}`,
            env,
            1
        );
        if (groupProfileRes.ok) {
            profile = groupProfileRes.data;
        } else {
            const directProfileRes = await lineFetchJson(`https://api.line.me/v2/bot/profile/${userId}`, env, 0);
            if (directProfileRes.ok) {
                profile = directProfileRes.data;
            } else {
                result.warnings.push(`profile:${userId}:${directProfileRes.error}`);
            }
        }

        const displayName = profile?.displayName || `LINE-${String(userId).slice(-6)}`;
        const photoUrl = profile?.pictureUrl || '';

        const saved = await registerGroupMemberIdentity(
            groupId,
            userId,
            { displayName, photoUrl },
            env,
            {
                source: 'line-members-sync',
                skipPlaceholderReconcile: true
            }
        );

        if (saved.groupUserOk || saved.employeeOk || saved.memberOk || saved.memberLinkOk) {
            result.membersSynced += 1;
        } else {
            result.membersFailed += 1;
        }
    }

    try {
        const teamSyncResult = await syncGroupMembersToTeam(groupId, env, {
            seedLineUserIds: memberIds,
            fallbackUserId,
            expectedMemberCount: result.memberCount,
            groupName: result.groupName
        });
        result.teamSyncResult = teamSyncResult;
    } catch (err) {
        result.warnings.push(`team-sync:${err?.message || String(err)}`);
    }

    // 4️⃣ TODO: ลบสมาชิกที่ออกจากกลุ่ม (จะเพิ่มขั้นตอนถัดไป)
    return result;
}

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

        // ✅ ประมวลผลแบบ background เพื่อลด timeout (Cloudflare Pages ใช้ context.waitUntil)
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

// ✅ ฟังก์ชันประมวลผล event ทั้งหมดแบบ async
async function handleEvents(events, env) {
    const FS_BASE = getFSBase(env);
    // ✅ โหมดมีชีวิต (AI Assistant Mode)
    if (!globalThis.__AI_MODE__) {
        globalThis.__AI_MODE__ = false;
    }

    try {
        for (const event of events) {
            const replyToken = event.replyToken;
            const lineUserId = event.source?.userId;
            const groupId = event.source?.groupId;

            if (!lineUserId) continue;

            // ✅ ดึงชื่อจริงจาก LINE profile
            let displayName = '';
            let photoUrl = '';

            // ✅ ดึงโปรไฟล์เฉพาะกรณีมี userId เท่านั้น (กัน crash)
            if (lineUserId) {
                displayName = `LINE-${lineUserId.slice(-6)}`;
                try {
                    const profileRes = await fetch(
                        `https://api.line.me/v2/bot/profile/${lineUserId}`,
                        {
                            headers: {
                                Authorization: `Bearer ${env.LINE_TOKEN}`
                            }
                        }
                    );
                    if (profileRes.ok) {
                        const profile = await profileRes.json();
                        displayName = profile.displayName || displayName;
                        photoUrl = profile.pictureUrl || '';
                    }
                } catch (e) {
                    console.error('Profile fetch error:', e);
                }
            }

            // ✅ เมื่อบอทถูกเพิ่มเข้ากลุ่ม → ดึงสมาชิกทั้งหมดในกลุ่ม
            if (event.type === 'join' && groupId) {
                const projectId = groupId;

                // ✅ 1) ดึงชื่อกลุ่มจาก LINE (Group Summary)
                let groupName = `LINE GROUP ${groupId.slice(-6)}`;
                let groupPicture = '';
                try {
                    const summaryRes = await fetch(
                        `https://api.line.me/v2/bot/group/${groupId}/summary`,
                        {
                            headers: {
                                Authorization: `Bearer ${env.LINE_TOKEN}`
                            }
                        }
                    );

                    if (summaryRes.ok) {
                        const summary = await summaryRes.json();
                        groupName = summary.groupName || groupName;
                        groupPicture = summary.pictureUrl || '';
                    }
                } catch (err) {
                    console.error('Group summary fetch error:', err);
                }

                // ✅ 2) บันทึก Mapping: Line Group ID ↔ Group Name ↔ Web Project Name
                await fetch(
                    `${FS_BASE}/projects/${projectId}?key=${env.FIREBASE_API_KEY}`,
                    {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            fields: {
                                id: fsString(projectId),
                                name: fsString(groupName),
                                lineGroupId: fsString(projectId),
                                groupName: fsString(groupName),
                                webProjectName: fsString(groupName),
                                pictureUrl: fsString(groupPicture),
                                source: fsString('line-group'),
                                createdAt: fsTimestampISO(),
                                updatedAt: fsTimestampISO()
                            }
                        })
                    }
                );

                // 1. ดึงรายชื่อสมาชิกทั้งหมดในกลุ่ม
                const membersRes = await fetch(
                    `https://api.line.me/v2/bot/group/${groupId}/members/ids`,
                    {
                        headers: {
                            Authorization: `Bearer ${env.LINE_TOKEN}`
                        }
                    }
                );

                if (membersRes.ok) {
                    const membersData = await membersRes.json();
                    const memberIds = membersData.memberIds || [];

                    for (const memberId of memberIds) {
                        const profileRes = await fetch(
                            `https://api.line.me/v2/bot/profile/${memberId}`,
                            {
                                headers: {
                                    Authorization: `Bearer ${env.LINE_TOKEN}`
                                }
                            }
                        );

                        if (!profileRes.ok) continue;

                        const profile = await profileRes.json();
                        const empId = `emp_${memberId.slice(-6)}`;

                        // ✅ บันทึก employee
                        await fetch(
                            `${FS_BASE}/employees/${empId}?key=${env.FIREBASE_API_KEY}`,
                            {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    fields: {
                                        id: fsString(empId),
                                        fullName: fsString(profile.displayName || empId),
                                        name: fsString(profile.displayName || empId),
                                        role: fsString('member'),
                                        lineUserId: fsString(memberId),
                                        createdAt: fsTimestampISO()
                                    }
                                })
                            }
                        );

                        // ✅ ผูก employee เข้า project (subcollection members)
                        await fetch(
                            `${FS_BASE}/projects/${projectId}/members/${empId}?key=${env.FIREBASE_API_KEY}`,
                            {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    fields: {
                                        employeeId: fsString(empId),
                                        fullName: fsString(profile.displayName || empId),
                                        role: fsString('member'),
                                        joinedAt: fsTimestampISO()
                                    }
                                })
                            }
                        );
                    }
                }

                if (replyToken) {
                    await fetch('https://api.line.me/v2/bot/message/reply', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${env.LINE_TOKEN}`
                        },
                        body: JSON.stringify({
                            replyToken,
                            messages: [{ type: 'text', text: '✅ CEO FLOW เชื่อมต่อกลุ่มเรียบร้อย และบันทึกสมาชิกแล้ว' }]
                        })
                    });
                }

                continue;
            }

            if (event.type === 'message' && event.message?.type === 'text') {
                const text = event.message.text.trim();
                const projectId = groupId || null;

                // ✅ Health Check AI
                if (text === '/test' && replyToken) {
                    await fetch('https://api.line.me/v2/bot/message/reply', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${env.LINE_TOKEN}`
                        },
                        body: JSON.stringify({
                            replyToken,
                            messages: [{ type: 'text', text: 'ไอน่าพร้อมแล้วค่ะ' }]
                        })
                    }).catch(err => console.error('LINE test reply error:', err));

                    continue;
                }

                // ✅ 1) เก็บข้อมูลคนที่พิมพ์ข้อความ (Auto learn สมาชิก)
                // ✅ เฉพาะกรณีอยู่ในกลุ่มเท่านั้น ถึงจะเรียก group member profile
                if (projectId && lineUserId && event.source?.type === 'group') {
                    try {
                        const profileRes = await fetch(
                            `https://api.line.me/v2/bot/group/${projectId}/member/${lineUserId}`,
                            {
                                headers: {
                                    Authorization: `Bearer ${env.LINE_TOKEN}`
                                }
                            }
                        );

                        if (profileRes.ok) {
                            const profile = await profileRes.json();

                            await fetch(
                                `${FS_BASE}/groupUsers/${lineUserId}?key=${env.FIREBASE_API_KEY}`,
                                {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        fields: {
                                            userId: fsString(lineUserId),
                                            displayName: fsString(profile.displayName || ''),
                                            projectGroup: fsString(projectId),
                                            lastSeen: fsTimestampISO()
                                        }
                                    })
                                }
                            );
                        }
                    } catch (err) {
                        console.error('Auto user learn error:', err);
                    }
                }

                // ✅ 2) เก็บข้อมูลจากการ @mention
                if (projectId && event.source?.type === 'group' && event.message?.mention?.mentions?.length) {
                    for (const m of event.message.mention.mentions) {
                        const mentionedUserId = m.userId;
                        if (!mentionedUserId) continue;

                        try {
                            const profileRes = await fetch(
                                `https://api.line.me/v2/bot/group/${projectId}/member/${mentionedUserId}`,
                                {
                                    headers: {
                                        Authorization: `Bearer ${env.LINE_TOKEN}`
                                    }
                                }
                            );

                            if (!profileRes.ok) continue;

                            const profile = await profileRes.json();

                            await fetch(
                                `${FS_BASE}/groupUsers/${mentionedUserId}?key=${env.FIREBASE_API_KEY}`,
                                {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        fields: {
                                            userId: fsString(mentionedUserId),
                                            displayName: fsString(profile.displayName || ''),
                                            projectGroup: fsString(projectId),
                                            lastSeen: fsTimestampISO()
                                        }
                                    })
                                }
                            );
                        } catch (err) {
                            console.error('Mention user save error:', err);
                        }
                    }
                }

                // ✅ 3) บันทึกข้อความแชททั้งหมดลง Firestore
                if (projectId) {
                    // ✅ Fallback: สร้าง Project อัตโนมัติ ถ้ายังไม่เคยถูกสร้าง (กันกรณี join ไม่ยิง)
                    await fetch(
                        `${FS_BASE}/projects/${projectId}?key=${env.FIREBASE_API_KEY}`,
                        {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                fields: {
                                    id: fsString(projectId),
                                    name: fsString(`LINE GROUP ${projectId.slice(-6)}`),
                                    source: fsString('line-group'),
                                    updatedAt: fsTimestampISO()
                                }
                            })
                        }
                    ).catch(err => console.error('Auto project create failed:', err));

                    const messageId = `msg_${Date.now()}_${lineUserId.slice(-4)}`;

                    await fetch(
                        `${FS_BASE}/projects/${projectId}/messages/${messageId}?key=${env.FIREBASE_API_KEY}`,
                        {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                fields: {
                                    id: fsString(messageId),
                                    projectId: fsString(projectId),
                                    lineUserId: fsString(lineUserId),
                                    text: fsString(text),
                                    type: fsString('text'),
                                    createdAt: fsTimestampISO()
                                }
                            })
                        }
                    );
                }

                if (text === 'เชื่อมต่อระบบ') {
                    // ✅ สร้าง employee + บันทึก lineUsers
                    await createEmployee(lineUserId, displayName, photoUrl, env)
                        .catch(err => console.error('FS Employee Error:', err));

                    await upsertLineUser(lineUserId, displayName, env)
                        .catch(err => console.error('FS LineUser Error:', err));

                    // ✅ ตอบกลับเมื่อสร้างเสร็จ
                    const userCode = `LINE-${lineUserId.slice(-6)}`;

                    await fetch('https://api.line.me/v2/bot/message/reply', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${env.LINE_TOKEN}`
                        },
                        body: JSON.stringify({
                            replyToken,
                            messages: [
                                {
                                    type: 'text',
                                    text: `✅ CEO FLOW:  ยินดีต้อนรับ\nคุณ ${displayName} เข้าสู่ระบบของเรา \nรหัส User "${userCode}"`
                                }
                            ]
                        })
                    });

                    continue;
                }

                // ✅ ซิงข้อมูลกลุ่ม (ใช้ได้แม้อยู่ในโหมดใดก็ตาม)
                if (text === '/ซิงข้อมูลกลุ่ม' && event.source?.type === 'group' && groupId) {
                    try {
                        const FS_BASE = getFSBase(env);

                        // สร้าง/อัปเดต project เสมอ
                        await fetch(
                            `${FS_BASE}/projects/${groupId}?key=${env.FIREBASE_API_KEY}`,
                            {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    fields: {
                                        id: fsString(groupId),
                                        name: fsString(`LINE GROUP ${groupId.slice(-6)}`),
                                        source: fsString('line-group'),
                                        updatedAt: fsTimestampISO()
                                    }
                                })
                            }
                        );

                        // ดึงสมาชิกทั้งหมดในกลุ่ม
                        const membersRes = await fetch(
                            `https://api.line.me/v2/bot/group/${groupId}/members/ids`,
                            {
                                headers: {
                                    Authorization: `Bearer ${env.LINE_TOKEN}`
                                }
                            }
                        );

                        if (membersRes.ok) {
                            const membersData = await membersRes.json();
                            const memberIds = membersData.memberIds || [];

                            for (const memberId of memberIds) {
                                const empId = `emp_${memberId.slice(-6)}`;

                                await fetch(
                                    `${FS_BASE}/employees/${empId}?key=${env.FIREBASE_API_KEY}`,
                                    {
                                        method: 'PATCH',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            fields: {
                                                id: fsString(empId),
                                                lineUserId: fsString(memberId),
                                                role: fsString('member'),
                                                createdAt: fsTimestampISO()
                                            }
                                        })
                                    }
                                );

                                await fetch(
                                    `${FS_BASE}/projects/${groupId}/members/${empId}?key=${env.FIREBASE_API_KEY}`,
                                    {
                                        method: 'PATCH',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            fields: {
                                                employeeId: fsString(empId),
                                                role: fsString('member'),
                                                joinedAt: fsTimestampISO()
                                            }
                                        })
                                    }
                                );
                            }
                        }

                        await fetch('https://api.line.me/v2/bot/message/reply', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${env.LINE_TOKEN}`
                            },
                            body: JSON.stringify({
                                replyToken,
                                messages: [{ type: 'text', text: 'ซิงข้อมูลกลุ่มเรียบร้อยแล้วค่ะ' }]
                            })
                        });
                    } catch (err) {
                        console.error('Group sync error:', err);
                    }

                    continue;
                }

                // ✅ เปิดโหมดมีชีวิต
                if (text === '/มีชีวิต') {
                    globalThis.__ALIVE_MODE__ = true;

                    await fetch('https://api.line.me/v2/bot/message/reply', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${env.LINE_TOKEN}`
                        },
                        body: JSON.stringify({
                            replyToken,
                            messages: [{ type: 'text', text: 'เปิดโหมดมีชีวิตเรียบร้อยแล้วค่ะ' }]
                        })
                    });
                    continue;
                }

                // ✅ ปิดโหมดมีชีวิต
                if (text === '/จบชีวิต') {
                    globalThis.__ALIVE_MODE__ = false;

                    await fetch('https://api.line.me/v2/bot/message/reply', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${env.LINE_TOKEN}`
                        },
                        body: JSON.stringify({
                            replyToken,
                            messages: [{ type: 'text', text: 'ปิดโหมดมีชีวิตแล้วค่ะ' }]
                        })
                    });
                    continue;
                }

                // ✅ ใช้ AI เฉพาะตอนเปิดโหมดมีชีวิตเท่านั้น
                if (replyToken) {
                    if (!globalThis.__ALIVE_MODE__) {
                        await fetch('https://api.line.me/v2/bot/message/reply', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${env.LINE_TOKEN}`
                            },
                            body: JSON.stringify({
                                replyToken,
                                messages: [{ type: 'text', text: 'ยังไม่ได้เปิดโหมดมีชีวิตค่ะ พิมพ์ /มีชีวิต ก่อนใช้งาน' }]
                            })
                        });
                        continue;
                    }

                    const aiReply = await generateAIReply(text, env, 'alive').catch(err => {
                        console.error('AI fatal error:', err);
                        return 'ขออภัยค่ะ ระบบ AI ขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งค่ะ';
                    });

                    await fetch('https://api.line.me/v2/bot/message/reply', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${env.LINE_TOKEN}`
                        },
                        body: JSON.stringify({
                            replyToken,
                            messages: [{ type: 'text', text: aiReply }]
                        })
                    });

                    continue;
                }

                // ✅ คำสั่ง: บันทึกข้อมูลกลุ่ม → ดึงสมาชิกทั้งหมดแล้วบันทึกใหม่
                // ✅ ใช้ได้เฉพาะในกลุ่มเท่านั้น
                if (text === '/บันทึกข้อมูลกลุ่ม' && event.source?.type === 'group' && projectId) {
                    try {
                        // สร้าง/อัปเดต project
                        await fetch(
                            `${FS_BASE}/projects/${projectId}?key=${env.FIREBASE_API_KEY}`,
                            {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    fields: {
                                        id: fsString(projectId),
                                        name: fsString(`LINE GROUP ${projectId.slice(-6)}`),
                                        source: fsString('line-group'),
                                        updatedAt: fsTimestampISO()
                                    }
                                })
                            }
                        );

                        // ดึงสมาชิกทั้งหมดในกลุ่ม
                        const membersRes = await fetch(
                            `https://api.line.me/v2/bot/group/${projectId}/members/ids`,
                            {
                                headers: {
                                    Authorization: `Bearer ${env.LINE_TOKEN}`
                                }
                            }
                        );

                        if (membersRes.ok) {
                            const membersData = await membersRes.json();
                            const memberIds = membersData.memberIds || [];

                            for (const memberId of memberIds) {
                                const profileRes = await fetch(
                                    `https://api.line.me/v2/bot/profile/${memberId}`,
                                    {
                                        headers: {
                                            Authorization: `Bearer ${env.LINE_TOKEN}`
                                        }
                                    }
                                );

                                if (!profileRes.ok) continue;

                                const profile = await profileRes.json();
                                const empId = `emp_${memberId.slice(-6)}`;

                                // บันทึก employee
                                await fetch(
                                    `${FS_BASE}/employees/${empId}?key=${env.FIREBASE_API_KEY}`,
                                    {
                                        method: 'PATCH',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            fields: {
                                                id: fsString(empId),
                                                fullName: fsString(profile.displayName || empId),
                                                name: fsString(profile.displayName || empId),
                                                role: fsString('member'),
                                                lineUserId: fsString(memberId),
                                                createdAt: fsTimestampISO()
                                            }
                                        })
                                    }
                                );

                                // ผูก employee เข้า project
                                await fetch(
                                    `${FS_BASE}/projects/${projectId}/members/${empId}?key=${env.FIREBASE_API_KEY}`,
                                    {
                                        method: 'PATCH',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            fields: {
                                                employeeId: fsString(empId),
                                                fullName: fsString(profile.displayName || empId),
                                                role: fsString('member'),
                                                joinedAt: fsTimestampISO()
                                            }
                                        })
                                    }
                                );
                            }
                        }

                        if (replyToken) {
                            await fetch('https://api.line.me/v2/bot/message/reply', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${env.LINE_TOKEN}`
                                },
                                body: JSON.stringify({
                                    replyToken,
                                    messages: [{ type: 'text', text: 'โอเคค่ะ ✅' }]
                                })
                            });
                        }
                    } catch (err) {
                        console.error('Manual group sync error:', err);
                    }

                    continue;
                }

                // ✅ คำสั่ง: /เพิ่มโครงการ (ใช้ในกลุ่มเท่านั้น)
                if (text === '/เพิ่มโครงการ' && event.source?.type === 'group' && projectId) {
                    try {
                        await fetch(
                            `${FS_BASE}/projects/${projectId}?key=${env.FIREBASE_API_KEY}`,
                            {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    fields: {
                                        id: fsString(projectId),
                                        name: fsString(`LINE GROUP ${projectId.slice(-6)}`),
                                        source: fsString('line-group'),
                                        createdAt: fsTimestampISO(),
                                        updatedAt: fsTimestampISO(),
                                        status: fsString('active')
                                    }
                                })
                            }
                        );

                        if (replyToken) {
                            await fetch('https://api.line.me/v2/bot/message/reply', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${env.LINE_TOKEN}`
                                },
                                body: JSON.stringify({
                                    replyToken,
                                    messages: [{ type: 'text', text: 'สร้างโครงการให้แล้วค่ะ ✅' }]
                                })
                            });
                        }
                    } catch (err) {
                        console.error('Manual create project error:', err);
                    }

                    continue;
                }

                // ✅ เปิดโหมดมีชีวิต
                if (text === '/มีชีวิต') {
                    globalThis.__AI_MODE__ = true;

                    if (replyToken) {
                        await fetch('https://api.line.me/v2/bot/message/reply', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${env.LINE_TOKEN}`
                            },
                            body: JSON.stringify({
                                replyToken,
                                messages: [{
                                    type: 'text',
                                    text: '🤖 โหมดมีชีวิตเปิดแล้ว\nเลขา IT พร้อมตอบทุกคำถาม และซัพพอร์ตทุกคนค่ะ ✅'
                                }]
                            })
                        });
                    }

                    continue;
                }

                // ✅ ปิดโหมดมีชีวิต
                if (text === '/จบชีวิต') {
                    globalThis.__AI_MODE__ = false;

                    if (replyToken) {
                        await fetch('https://api.line.me/v2/bot/message/reply', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${env.LINE_TOKEN}`
                            },
                            body: JSON.stringify({
                                replyToken,
                                messages: [{
                                    type: 'text',
                                    text: '🔕 โหมดมีชีวิตปิดแล้ว\nบอทกลับสู่โหมดปกติค่ะ ✅'
                                }]
                            })
                        });
                    }

                    continue;
                }

                // ✅ AI ตอบทุกข้อความ (ทั้งส่วนตัวและกลุ่ม)
                if (replyToken) {
                    try {
                        const azureEndpoint = env.AZURE_OPENAI_ENDPOINT; // เช่น https://xxx.openai.azure.com
                        const azureKey = env.AZURE_OPENAI_KEY;
                        const deployment = env.AZURE_OPENAI_DEPLOYMENT; // ชื่อ deployment model
                        const apiVersion = env.AZURE_OPENAI_API_VERSION || '2024-02-15-preview';

                        const aiRes = await fetch(
                            `${azureEndpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`,
                            {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'api-key': azureKey
                                },
                                body: JSON.stringify({
                                    messages: [
                                        {
                                            role: 'system',
                                            content: 'คุณคือ Aina (ไอน่า) เลขา IT มืออาชีพ สุภาพ เป็นมิตร ตอบแบบมนุษย์จริง ใช้ชื่อแทนตัวเองว่า "ไอน่า" เสมอ และลงท้ายข้อความด้วย "ค่ะ — ไอน่า" ช่วยเหลือทุกเรื่องภายในองค์กร และซัพพอร์ตทุกคนอย่างเต็มที่'
                                        },
                                        {
                                            role: 'user',
                                            content: text
                                        }
                                    ],
                                    max_tokens: 500,
                                    temperature: 0.7
                                })
                            }
                        );

                        const aiData = await aiRes.json();
                        const aiReply = aiData?.choices?.[0]?.message?.content || 'ขออภัยค่ะ ระบบ AI มีปัญหาเล็กน้อย';

                        await fetch('https://api.line.me/v2/bot/message/reply', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${env.LINE_TOKEN}`
                            },
                            body: JSON.stringify({
                                replyToken,
                                messages: [{ type: 'text', text: aiReply }]
                            })
                        });
                    } catch (err) {
                        console.error('Azure OpenAI error:', err);
                    }

                    continue;
                }
            }

            if (replyToken) {
                await fetch('https://api.line.me/v2/bot/message/reply', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${env.LINE_TOKEN}`
                    },
                    body: JSON.stringify({
                        replyToken,
                        messages: [{ type: 'text', text: 'CEO FLOW: พิมพ์ "เชื่อมต่อระบบ" เพื่อเริ่มต้น' }]
                    })
                });
            }
        }
    } catch (err) {
        console.error('Webhook Error:', err);
    }
}

// ✅ Unified flow: ประมวลผลทุกคำสั่งและ AI ใน endpoint เดียว
async function handleUnifiedEvents(events, env) {
    if (!Array.isArray(events) || events.length === 0) {
        return;
    }

    if (globalThis.__ALIVE_MODE__ === undefined) {
        globalThis.__ALIVE_MODE__ = false;
    }

    for (const event of events) {
        try {
            await handleUnifiedEvent(event, env);
        } catch (err) {
            console.error('Unified event error:', err);
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
        if (!sent && fallbackReplyTarget) {
            await pushText(fallbackReplyTarget, normalizedMessage, env, { groupId: isGroup ? groupId : undefined });
            return true;
        }

        return sent;
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

    const isSyncCommand = isTextMessage && (text === '/ซิงข้อมูลกลุ่ม'
        || text === '/ซิงค์ข้อมูลกลุ่ม'
        || text === '/บันทึกข้อมูลกลุ่ม');
    const isAddProjectCommand = isTextMessage && text === '/เพิ่มโครงการ';
    const isTestCommand = isTextMessage && text === '/test';
    const isAliveOnCommand = isTextMessage && text === '/มีชีวิต';
    const isAliveOffCommand = isTextMessage && text === '/จบชีวิต';

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

    // Persist every incoming text (including command text) so chat history stays complete.
    if (!groupMessagePersisted) {
        if (isGroup && groupId) {
            await ensureProjectRecord(groupId, env, null, '').catch((err) => {
                console.error('Ensure project record for text message failed:', err);
            });

            const saved = await saveGroupMessage(groupId, lineUserId || '', event, env).catch((err) => {
                console.error('Save group text message failed:', err);
                return false;
            });

            if (saved) {
                groupMessagePersisted = true;
            }

            await persistGroupIdentityMetadata('webhook-text', 'webhook-mention-text');
        } else {
            await saveNonGroupMessage(sourceType, roomId, lineUserId || '', event, env).catch((err) => {
                console.error('Save non-group text message failed:', err);
            });
            groupMessagePersisted = true;
        }
    }

    if (isTextMessage && isGroup && groupId) {
        const quotedMessageId = extractQuotedMessageId(event?.message || {});
        const meetingReplyResult = await tryRecordMeetingSummaryTaskReply(event, env, {
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

        const meetingTaskResult = await tryCreateMeetingSummaryTask(event, env, {
            projectId: groupId,
            lineUserId
        }).catch((err) => {
            console.error('Auto meeting summary task failed:', err);
            return { matched: false, created: false, reason: 'exception' };
        });

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
            if (meetingTaskResult.created || meetingTaskResult.duplicate) {
                const quoteToken = String(event?.message?.quoteToken || '').trim();
                const ackText = meetingTaskResult.duplicate
                    ? '✅ รายการนี้บันทึกเป็นงานไว้แล้วค่ะ'
                    : '✅ บันทึกสรุปประชุมเป็นงานเรียบร้อยแล้วค่ะ';

                const sent = await replyText(replyToken, ackText, env, {
                    groupId,
                    quoteToken
                });

                if (!sent && fallbackReplyTarget) {
                    await pushText(fallbackReplyTarget, ackText, env, {
                        groupId,
                        quoteToken
                    });
                }
            } else {
                await replyOrPush('รับข้อความสรุปประชุมแล้ว แต่บันทึกงานไม่สำเร็จ กรุณาลองใหม่อีกครั้งค่ะ');
            }

            return;
        }

        const taggedTaskResult = await tryCreateTaggedLineTask(event, env, {
            projectId: groupId,
            lineUserId
        }).catch((err) => {
            console.error('Auto tagged task failed:', err);
            return { matched: false, created: false, reason: 'exception' };
        });

        if (
            taggedTaskResult?.reason
            && taggedTaskResult.reason !== 'not-tasklike'
            && taggedTaskResult.reason !== 'no-task-signal'
            && taggedTaskResult.reason !== 'command'
            && taggedTaskResult.reason !== 'not-tagged'
            && taggedTaskResult.reason !== 'no-assignee-mention'
        ) {
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
                taskId: String(taggedTaskResult?.taskId || '')
            });
        }

        if (taggedTaskResult?.matched) {
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

            const sent = await replyText(replyToken, ackText, env, {
                groupId,
                quoteToken
            });

            if (!sent && fallbackReplyTarget) {
                await pushText(fallbackReplyTarget, ackText, env, {
                    groupId,
                    quoteToken
                });
            }

            return;
        }

        if (meetingReplyResult?.matched && meetingReplyAckText) {
            const sent = await replyText(replyToken, meetingReplyAckText, env, {
                groupId
            });

            if (!sent && fallbackReplyTarget) {
                await pushText(fallbackReplyTarget, meetingReplyAckText, env, {
                    groupId
                });
            }

            return;
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

    if (isTestCommand) {
        const testText = 'ไอน่าพร้อมแล้วค่ะ';
        const sent = await replyText(replyToken, testText, env, groupReplyOptions);
        if (!sent && fallbackReplyTarget) {
            await pushText(fallbackReplyTarget, testText, env, { groupId: isGroup ? groupId : undefined });
        }
        return;
    }

    if (isAliveOnCommand || isAliveOffCommand) {
        const enableAliveMode = isAliveOnCommand;
        const updated = await writeAliveModeState(sourceType, groupId, roomId, lineUserId, enableAliveMode, env);

        const doneText = enableAliveMode
            ? (isGroup
                ? 'เปิดโหมดมีชีวิตในกลุ่มเรียบร้อยแล้วค่ะ เรียกใช้งานด้วย /ai หรือ @ไอน่า เช่น /ai สรุปประเด็นวันนี้'
                : 'เปิดโหมดมีชีวิตเรียบร้อยแล้วค่ะ เรียกใช้งานด้วย /ai หรือ @ไอน่า เช่น /ai ช่วยวางแผนงานวันนี้')
            : (isGroup ? 'ปิดโหมดมีชีวิตในกลุ่มแล้วค่ะ' : 'ปิดโหมดมีชีวิตแล้วค่ะ');

        const failText = enableAliveMode
            ? 'เปิดโหมดมีชีวิตไม่สำเร็จ กรุณาลองใหม่อีกครั้งค่ะ'
            : 'ปิดโหมดมีชีวิตไม่สำเร็จ กรุณาลองใหม่อีกครั้งค่ะ';

        const responseText = updated ? doneText : failText;
        const sent = await replyText(replyToken, responseText, env, groupReplyOptions);
        if (!sent && fallbackReplyTarget) {
            await pushText(fallbackReplyTarget, responseText, env, { groupId: isGroup ? groupId : undefined });
        }
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

    const aliveModeEnabled = await readAliveModeState(sourceType, groupId, roomId, lineUserId, env);
    const userMessage = text;
    const trimmedUserMessage = normalizeIncomingText(userMessage);
    const chatSessionScope = resolveChatSessionScope(sourceType, groupId, roomId, lineUserId);
    const isStopSecretaryCommand = trimmedUserMessage === 'จบถามเลขา' || trimmedUserMessage === '/จบถามเลขา';
    const isStartSecretaryCommand = trimmedUserMessage === 'ถามเลขา'
        || trimmedUserMessage === '/ถามเลขา'
        || trimmedUserMessage === 'เลขา'
        || trimmedUserMessage === '/เลขา'
        || trimmedUserMessage.startsWith('ถามเลขา ')
        || trimmedUserMessage.startsWith('/ถามเลขา ')
        || trimmedUserMessage.startsWith('เลขา ')
        || trimmedUserMessage.startsWith('/เลขา ');

    if (isStopSecretaryCommand) {
        if (chatSessionScope) {
            await deleteChatSessionState(chatSessionScope, env).catch((err) => {
                console.error('Delete chat session failed:', err);
            });
        }

        await replyOrPush('ขอบคุณที่ใช้บริการค่ะ พิมพ์ "ถามเลขา" ได้เลยนะคะถ้ามีอะไรให้ช่วย');
        return;
    }

    if (isStartSecretaryCommand) {
        if (!chatSessionScope) {
            await replyOrPush('เปิดโหมดถามเลขาไม่สำเร็จ กรุณาลองใหม่อีกครั้งค่ะ');
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
            await replyOrPush('เปิดโหมดถามเลขาไม่สำเร็จ กรุณาลองใหม่อีกครั้งค่ะ');
            return;
        }

        let question = '';
        if (trimmedUserMessage.startsWith('ถามเลขา ')) {
            question = trimmedUserMessage.slice('ถามเลขา '.length).trim();
        } else if (trimmedUserMessage.startsWith('/ถามเลขา ')) {
            question = trimmedUserMessage.slice('/ถามเลขา '.length).trim();
        } else if (trimmedUserMessage.startsWith('เลขา ')) {
            question = trimmedUserMessage.slice('เลขา '.length).trim();
        } else if (trimmedUserMessage.startsWith('/เลขา ')) {
            question = trimmedUserMessage.slice('/เลขา '.length).trim();
        }

        if (!question) {
            await replyOrPush('ได้ค่ะ เลขาส่วนตัวพร้อมช่วยงานแล้วค่ะ\nมีอะไรให้ช่วยจัดการไหมคะ?\n\n(พิมพ์ "จบถามเลขา" หรือทิ้งไว้ 3 นาที เพื่อออก)');
            return;
        }

        const aiText = await askSoundwave(question, env, []).catch((err) => {
            console.error('Ask secretary on start failed:', err);
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
    if (chatSession && chatSessionScope) {
        const baseTime = String(chatSession.lastActiveAt || chatSession.startedAt || '').trim();
        const baseMs = baseTime ? new Date(baseTime).getTime() : NaN;
        const elapsed = Number.isFinite(baseMs) ? (Date.now() - baseMs) : 0;

        if (elapsed > 3 * 60 * 1000) {
            await deleteChatSessionState(chatSessionScope, env).catch((err) => {
                console.error('Delete expired chat session failed:', err);
            });

            await replyOrPush('Session หมดเวลาแล้วค่ะ (3 นาที) พิมพ์ "ถามเลขา" ใหม่เพื่อคุยต่อได้เลยนะคะ');
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

        if (!aliveModeEnabled) {
            await replyOrPush('ยังไม่ได้เปิดโหมดมีชีวิตค่ะ พิมพ์ /มีชีวิต ก่อนใช้งาน');
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

}

async function replyText(replyToken, text, env, options = {}) {
    if (!replyToken) {
        return false;
    }

    const normalizedText = String(text || '');
    const message = { type: 'text', text: normalizedText };
    const quoteToken = String(options?.quoteToken || '').trim();
    if (quoteToken) {
        message.quoteToken = quoteToken;
    }

    const res = await fetch('https://api.line.me/v2/bot/message/reply', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.LINE_TOKEN}`
        },
        body: JSON.stringify({
            replyToken,
            messages: [message]
        })
    });

    if (!res.ok) {
        const errText = await res.text();
        console.error('LINE reply failed:', res.status, errText);
        return false;
    }

    const groupId = String(options?.groupId || '').trim();
    if (groupId && options?.saveToChat !== false) {
        await saveBotGroupMessage(groupId, normalizedText, env).catch((err) => {
            console.error('Save bot message (reply) failed:', err);
        });
    }

    return true;
}

async function pushText(to, text, env, options = {}) {
    if (!to) {
        return false;
    }

    const normalizedText = String(text || '');
    const message = { type: 'text', text: normalizedText };
    const quoteToken = String(options?.quoteToken || '').trim();
    if (quoteToken) {
        message.quoteToken = quoteToken;
    }

    const res = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.LINE_TOKEN}`
        },
        body: JSON.stringify({
            to,
            messages: [message]
        })
    });

    if (!res.ok) {
        const errText = await res.text();
        console.error('LINE push failed:', res.status, errText);
        return false;
    }

    const targetGroupId = String(options?.groupId || (isLineGroupId(to) ? to : '')).trim();
    if (targetGroupId && options?.saveToChat !== false) {
        await saveBotGroupMessage(targetGroupId, normalizedText, env).catch((err) => {
            console.error('Save bot message (push) failed:', err);
        });
    }

    return true;
}

async function fetchLineProfile(lineUserId, groupId, env) {
    if (!lineUserId) {
        return null;
    }

    const headers = { Authorization: `Bearer ${env.LINE_TOKEN}` };
    const urls = [];

    if (groupId) {
        urls.push(`https://api.line.me/v2/bot/group/${groupId}/member/${lineUserId}`);
    }

    urls.push(`https://api.line.me/v2/bot/profile/${lineUserId}`);

    for (const url of urls) {
        try {
            const res = await fetch(url, { headers });
            if (!res.ok) {
                continue;
            }
            return await res.json();
        } catch (err) {
            console.error('Profile fetch error:', err);
        }
    }

    return null;
}

async function getGroupSummary(groupId, env) {
    const fallbackName = `LINE GROUP ${groupId.slice(-6)}`;

    try {
        const res = await fetch(`https://api.line.me/v2/bot/group/${groupId}/summary`, {
            headers: { Authorization: `Bearer ${env.LINE_TOKEN}` }
        });

        if (!res.ok) {
            return { name: fallbackName, pictureUrl: '' };
        }

        const data = await res.json();
        return {
            name: data.groupName || fallbackName,
            pictureUrl: data.pictureUrl || ''
        };
    } catch (err) {
        console.error('Group summary fetch error:', err);
        return { name: fallbackName, pictureUrl: '' };
    }
}

function resolveAliveModeScope(sourceType, groupId, roomId, lineUserId) {
    if (sourceType === 'group' && groupId) {
        return {
            docId: `group_${groupId}`,
            scopeType: 'group',
            scopeId: groupId
        };
    }

    if (sourceType === 'room' && roomId) {
        return {
            docId: `room_${roomId}`,
            scopeType: 'room',
            scopeId: roomId
        };
    }

    if (lineUserId) {
        return {
            docId: `user_${lineUserId}`,
            scopeType: 'user',
            scopeId: lineUserId
        };
    }

    return null;
}

function parseFirestoreBooleanField(field) {
    if (typeof field?.booleanValue === 'boolean') {
        return field.booleanValue;
    }

    const normalized = String(field?.stringValue || '').trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') {
        return true;
    }
    if (normalized === 'false' || normalized === '0') {
        return false;
    }

    return null;
}

function resolveChatSessionScope(sourceType, groupId, roomId, lineUserId) {
    const normalizedUserId = String(lineUserId || '').trim();
    const scopedUserId = normalizedUserId || 'anonymous';

    if (sourceType === 'group' && groupId) {
        return {
            docId: `chat_group_${groupId}_${scopedUserId}`,
            scopeType: 'group',
            scopeId: groupId
        };
    }

    if (sourceType === 'room' && roomId) {
        return {
            docId: `chat_room_${roomId}_${scopedUserId}`,
            scopeType: 'room',
            scopeId: roomId
        };
    }

    if (!normalizedUserId) {
        return null;
    }

    return {
        docId: `chat_user_${normalizedUserId}`,
        scopeType: 'user',
        scopeId: normalizedUserId
    };
}

function trimChatHistory(history = [], maxItems = 10) {
    if (!Array.isArray(history)) {
        return [];
    }

    const normalized = history
        .map((item) => {
            const role = String(item?.role || '').trim().toLowerCase();
            const content = String(item?.content || '').trim();
            if (!content) {
                return null;
            }

            if (role !== 'user' && role !== 'assistant') {
                return null;
            }

            return { role, content };
        })
        .filter(Boolean);

    return normalized.slice(-Math.max(1, Math.floor(Number(maxItems) || 10)));
}

function readChatHistory(session = null) {
    if (!session) {
        return [];
    }

    const raw = String(session?.historyJson || '').trim();
    if (!raw) {
        return [];
    }

    try {
        return trimChatHistory(JSON.parse(raw), 10);
    } catch {
        return [];
    }
}

async function readChatSessionState(sourceType, groupId, roomId, lineUserId, env) {
    const scope = resolveChatSessionScope(sourceType, groupId, roomId, lineUserId);
    if (!scope) {
        return null;
    }

    try {
        const fields = await fsGetDoc('chatSessions', scope.docId, env);
        if (!fields) {
            return null;
        }

        const active = parseFirestoreBooleanField(fields?.active);
        if (active === false) {
            return null;
        }

        const startedAt = String(fields?.startedAt?.timestampValue || fields?.startedAt?.stringValue || '').trim();
        const lastActiveAt = String(fields?.lastActiveAt?.timestampValue || fields?.lastActiveAt?.stringValue || '').trim();
        const historyJson = String(fields?.historyJson?.stringValue || '').trim() || '[]';

        return {
            scope,
            startedAt,
            lastActiveAt,
            historyJson,
            active: active !== false
        };
    } catch (err) {
        console.error('Read chat session failed:', err);
        return null;
    }
}

async function writeChatSessionState(scope, lineUserId, payload = {}, env = {}) {
    if (!scope?.docId) {
        return false;
    }

    const startedAt = String(payload?.startedAt || new Date().toISOString()).trim();
    const lastActiveAt = String(payload?.lastActiveAt || new Date().toISOString()).trim();
    const history = trimChatHistory(payload?.history || [], 10);
    const historyJson = String(payload?.historyJson || JSON.stringify(history));
    const active = payload?.active !== false;

    const fields = {
        active: { booleanValue: active },
        scopeType: { stringValue: String(scope.scopeType || 'user') },
        scopeId: { stringValue: String(scope.scopeId || '') },
        lineUserId: { stringValue: String(lineUserId || '') },
        startedAt: { timestampValue: startedAt },
        lastActiveAt: { timestampValue: lastActiveAt },
        historyJson: { stringValue: historyJson },
        updatedAt: { timestampValue: new Date().toISOString() }
    };

    const ok = await patchFirestoreDoc(`chatSessions/${scope.docId}`, fields, env, false);
    if (ok) {
        return true;
    }

    try {
        await fsSetDoc('chatSessions', scope.docId, {
            active,
            scopeType: String(scope.scopeType || 'user'),
            scopeId: String(scope.scopeId || ''),
            lineUserId: String(lineUserId || ''),
            startedAt,
            lastActiveAt,
            historyJson,
            updatedAt: new Date().toISOString()
        }, env);
        return true;
    } catch (err) {
        console.error('Write chat session fallback failed:', err);
        return false;
    }
}

async function deleteChatSessionState(scope, env = {}) {
    if (!scope?.docId) {
        return false;
    }

    return deleteFirestoreDocumentByPath(`chatSessions/${scope.docId}`, env);
}

function buildChatHistoryPrompt(history = [], userMessage = '') {
    const latestMessage = String(userMessage || '').trim();
    if (!latestMessage) {
        return '';
    }

    const normalizedHistory = trimChatHistory(history, 8);
    if (normalizedHistory.length === 0) {
        return latestMessage;
    }

    const renderedHistory = normalizedHistory
        .map((item) => `${item.role === 'assistant' ? 'เลขา' : 'ผู้ใช้'}: ${item.content}`)
        .join('\n');

    return `บริบทบทสนทนาก่อนหน้า:\n${renderedHistory}\n\nข้อความล่าสุดของผู้ใช้:\n${latestMessage}`;
}

async function askSoundwave(userMessage, env, history = []) {
    const prompt = buildChatHistoryPrompt(history, userMessage);
    return generateAIReply(prompt || String(userMessage || '').trim(), env, 'secretary');
}

async function readAliveModeState(sourceType, groupId, roomId, lineUserId, env) {
    const scope = resolveAliveModeScope(sourceType, groupId, roomId, lineUserId);
    if (!scope) {
        return Boolean(globalThis.__ALIVE_MODE__);
    }

    const scopedMemory = globalThis.__ALIVE_MODE_SCOPES__?.[scope.docId];
    if (typeof scopedMemory === 'boolean') {
        return scopedMemory;
    }

    const kv = getKnownGroupsKv(env);
    if (kv) {
        try {
            const payload = await kv.get(getAliveModeKvItemKey(scope.docId), 'json');
            if (payload && typeof payload === 'object') {
                if (typeof payload.enabled === 'boolean') {
                    if (!globalThis.__ALIVE_MODE_SCOPES__) {
                        globalThis.__ALIVE_MODE_SCOPES__ = {};
                    }
                    globalThis.__ALIVE_MODE_SCOPES__[scope.docId] = payload.enabled;
                    return payload.enabled;
                }

                const parsedFromPayload = parseFirestoreBooleanField({ stringValue: String(payload.enabled) });
                if (parsedFromPayload !== null) {
                    if (!globalThis.__ALIVE_MODE_SCOPES__) {
                        globalThis.__ALIVE_MODE_SCOPES__ = {};
                    }
                    globalThis.__ALIVE_MODE_SCOPES__[scope.docId] = parsedFromPayload;
                    return parsedFromPayload;
                }
            }
        } catch (err) {
            console.error('Read alive mode from KV failed:', err);
        }
    }

    try {
        const fields = await fsGetDoc('aliveModes', scope.docId, env);
        const parsed = parseFirestoreBooleanField(fields?.enabled);
        if (parsed !== null) {
            if (!globalThis.__ALIVE_MODE_SCOPES__) {
                globalThis.__ALIVE_MODE_SCOPES__ = {};
            }
            globalThis.__ALIVE_MODE_SCOPES__[scope.docId] = parsed;
            return parsed;
        }
    } catch (err) {
        console.error('Read alive mode failed:', err);
    }

    return false;
}

async function writeAliveModeState(sourceType, groupId, roomId, lineUserId, enabled, env) {
    const normalizedEnabled = Boolean(enabled);
    globalThis.__ALIVE_MODE__ = normalizedEnabled;

    const scope = resolveAliveModeScope(sourceType, groupId, roomId, lineUserId);
    if (!scope) {
        return false;
    }

    if (!globalThis.__ALIVE_MODE_SCOPES__) {
        globalThis.__ALIVE_MODE_SCOPES__ = {};
    }
    globalThis.__ALIVE_MODE_SCOPES__[scope.docId] = normalizedEnabled;

    let kvWriteOk = false;
    const kv = getKnownGroupsKv(env);
    if (kv) {
        try {
            await kv.put(getAliveModeKvItemKey(scope.docId), JSON.stringify({
                enabled: normalizedEnabled,
                scopeType: scope.scopeType,
                scopeId: scope.scopeId,
                updatedAt: new Date().toISOString()
            }));
            kvWriteOk = true;
        } catch (err) {
            console.error('Write alive mode to KV failed:', err);
        }
    }

    const ok = await patchFirestoreDoc(`aliveModes/${scope.docId}`, {
        enabled: { booleanValue: normalizedEnabled },
        scopeType: { stringValue: scope.scopeType },
        scopeId: { stringValue: scope.scopeId },
        updatedAt: { timestampValue: new Date().toISOString() }
    }, env, false);

    if (ok) {
        return true;
    }

    if (kvWriteOk) {
        return true;
    }

    try {
        await fsSetDoc('aliveModes', scope.docId, {
            enabled: normalizedEnabled ? 'true' : 'false',
            scopeType: scope.scopeType,
            scopeId: scope.scopeId,
            updatedAt: new Date().toISOString()
        }, env);
        return true;
    } catch (err) {
        console.error('Write alive mode fallback failed:', err);
        return false;
    }
}

async function ensureProjectRecord(projectId, env, explicitName = null, pictureUrl = '') {
    const fields = {
        id: fsString(projectId),
        source: fsString('line-group'),
        updatedAt: fsTimestampISO()
    };

    if (explicitName) {
        fields.name = fsString(explicitName);
    }

    if (pictureUrl) {
        fields.pictureUrl = fsString(pictureUrl);
    }

    await patchFirestoreDoc(`projects/${projectId}`, fields, env, false);
}

export async function registerGroupMemberIdentity(projectId, lineUserId, identity = {}, env = {}, options = {}) {
    const normalizedProjectId = String(projectId || '').trim();
    const normalizedLineUserId = String(lineUserId || '').trim();
    if (!normalizedProjectId || !isLikelyLineUserId(normalizedLineUserId)) {
        return {
            groupUserOk: false,
            employeeOk: false,
            memberOk: false,
            memberLinkOk: false,
            isNewGroupMember: false,
            placeholderReduced: false,
            placeholderWarning: null,
            displayName: '',
            photoUrl: ''
        };
    }

    const displayName = String(identity?.displayName || '').trim() || `LINE-${normalizedLineUserId.slice(-6)}`;
    const photoUrl = String(identity?.photoUrl || identity?.pictureUrl || '').trim();
    const source = String(options?.source || 'webhook').trim() || 'webhook';
    const nowIso = new Date().toISOString();
    const empId = getEmployeeDocIdFromLineUserId(normalizedLineUserId);
    const memberLinkDocId = getGroupMemberLinkDocId(normalizedProjectId, normalizedLineUserId);

    let isNewGroupMember = false;
    if (memberLinkDocId) {
        const existingMemberLink = await fsGetDoc('groupMemberLinks', memberLinkDocId, env).catch(() => null);
        isNewGroupMember = !existingMemberLink;
    }

    const groupUserFields = {
        userId: fsString(normalizedLineUserId),
        displayName: fsString(displayName),
        projectGroup: fsString(normalizedProjectId),
        source: fsString(source),
        lastSeen: { timestampValue: nowIso },
        updatedAt: { timestampValue: nowIso }
    };
    if (isNewGroupMember) {
        groupUserFields.firstSeen = { timestampValue: nowIso };
    }

    const groupUserOk = await patchFirestoreDoc(`groupUsers/${normalizedLineUserId}`, groupUserFields, env, false);

    const memberLinkFields = {
        id: fsString(memberLinkDocId),
        groupId: fsString(normalizedProjectId),
        lineUserId: fsString(normalizedLineUserId),
        displayName: fsString(displayName),
        source: fsString(source),
        lastSeenAt: { timestampValue: nowIso },
        updatedAt: { timestampValue: nowIso }
    };
    if (isNewGroupMember) {
        memberLinkFields.firstSeenAt = { timestampValue: nowIso };
    }

    const memberLinkOk = memberLinkDocId
        ? await patchFirestoreDoc(`groupMemberLinks/${memberLinkDocId}`, memberLinkFields, env, false)
        : false;

    const employeeFields = {
        id: { stringValue: empId },
        lineUserId: { stringValue: normalizedLineUserId },
        name: { stringValue: displayName },
        fullName: { stringValue: displayName },
        role: { stringValue: 'member' },
        projectId: { stringValue: normalizedProjectId },
        isPlaceholder: { booleanValue: false },
        updatedAt: { timestampValue: nowIso }
    };
    if (photoUrl) {
        employeeFields.photoUrl = { stringValue: photoUrl };
    }

    const employeeOk = await patchFirestoreDoc(`employees/${empId}`, employeeFields, env, false);

    const memberFields = {
        employeeId: { stringValue: empId },
        lineUserId: { stringValue: normalizedLineUserId },
        fullName: { stringValue: displayName },
        role: { stringValue: 'member' },
        joinedAt: { timestampValue: nowIso },
        updatedAt: { timestampValue: nowIso }
    };
    if (photoUrl) {
        memberFields.photoUrl = { stringValue: photoUrl };
    }

    const memberOk = await patchFirestoreDoc(`projects/${normalizedProjectId}/members/${empId}`, memberFields, env, false);

    await rememberGroupMember(normalizedProjectId, normalizedLineUserId, env);

    let placeholderReduced = false;
    let placeholderWarning = null;
    if (!options?.skipPlaceholderReconcile && isNewGroupMember) {
        const placeholderResult = await removeOneGroupPlaceholderEmployee(normalizedProjectId, env);
        placeholderReduced = Boolean(placeholderResult?.removed);
        placeholderWarning = placeholderResult?.warning || null;
    }

    return {
        groupUserOk,
        employeeOk,
        memberOk,
        memberLinkOk,
        isNewGroupMember,
        placeholderReduced,
        placeholderWarning,
        displayName,
        photoUrl
    };
}

async function saveGroupUser(projectId, lineUserId, env, options = {}) {
    if (!projectId || !lineUserId) {
        return;
    }

    const profile = await fetchLineProfile(lineUserId, projectId, env);
    const displayName = profile?.displayName || `LINE-${lineUserId.slice(-6)}`;
    const photoUrl = profile?.pictureUrl || '';

    const saved = await registerGroupMemberIdentity(
        projectId,
        lineUserId,
        { displayName, photoUrl },
        env,
        options
    );

    if (saved?.placeholderWarning) {
        console.error(`Placeholder reconcile warning (${projectId}/${lineUserId}):`, saved.placeholderWarning);
    }

    if (!saved.groupUserOk && !saved.employeeOk && !saved.memberOk && !saved.memberLinkOk) {
        throw new Error(`Unable to persist user data for ${lineUserId}`);
    }
}

async function saveMentionedUsers(projectId, mentions, env, options = {}) {
    if (!Array.isArray(mentions) || mentions.length === 0) {
        return;
    }

    for (const mention of mentions) {
        const mentionedUserId = mention?.userId;
        if (!mentionedUserId) {
            continue;
        }
        await saveGroupUser(projectId, mentionedUserId, env, options);
    }
}

function buildMessagePreviewText(messageType, message = {}, text = '') {
    if (messageType === 'text') {
        return text || '';
    }

    if (messageType === 'image') {
        return '[รูปภาพ]';
    }

    if (messageType === 'video') {
        return '[วิดีโอ]';
    }

    if (messageType === 'audio') {
        return '[เสียง]';
    }

    if (messageType === 'file') {
        const fileName = String(message?.fileName || '').trim();
        return fileName ? `[ไฟล์] ${fileName}` : '[ไฟล์แนบ]';
    }

    if (messageType === 'sticker') {
        return '[สติกเกอร์]';
    }

    if (messageType === 'location') {
        const title = String(message?.title || '').trim();
        const address = String(message?.address || '').trim();
        const place = title || address;
        return place ? `[ตำแหน่ง] ${place}` : '[ตำแหน่ง]';
    }

    return `[${messageType || 'message'}]`;
}

function buildMessageViewUrl(message = {}) {
    const externalContentUrl = String(message?.contentProvider?.originalContentUrl || '').trim();
    if (externalContentUrl) {
        return externalContentUrl;
    }

    const lineMessageId = String(message?.id || '').trim();
    if (!lineMessageId) {
        return '';
    }

    const params = new URLSearchParams({ messageId: lineMessageId });
    const fileName = String(message?.fileName || '').trim();
    if (fileName) {
        params.set('fileName', fileName);
    }

    return `/api/line-message-content?${params.toString()}`;
}

async function resolveQuotedMessagePreviewText(projectId, quotedMessageId, env) {
    const normalizedProjectId = String(projectId || '').trim();
    const normalizedQuotedMessageId = String(quotedMessageId || '').trim();
    if (!normalizedProjectId || !normalizedQuotedMessageId) {
        return '';
    }

    if (!env?.FIREBASE_PROJECT_ID || !env?.FIREBASE_API_KEY) {
        return '';
    }

    const stableQuotedId = sanitizeDocIdSegment(normalizedQuotedMessageId);
    if (!stableQuotedId) {
        return '';
    }

    const quotedDocId = `msg_line_${stableQuotedId.slice(0, 96)}`;
    const url = `${getFSBase(env)}/projects/${normalizedProjectId}/messages/${quotedDocId}?key=${env.FIREBASE_API_KEY}`;

    try {
        const res = await fetch(url);
        if (!res.ok) {
            return '';
        }

        const data = await res.json().catch(() => ({}));
        const fields = data?.fields || {};
        const previewText = readFirestoreStringField(fields, 'previewText');
        if (previewText) {
            return previewText;
        }

        const text = readFirestoreStringField(fields, 'text');
        if (text) {
            return text;
        }

        const messageType = readFirestoreStringField(fields, 'type');
        return messageType ? `[${messageType}]` : '';
    } catch {
        return '';
    }
}

function resolveNonGroupMessageStorage(sourceType, roomId, lineUserId) {
    const normalizedSourceType = String(sourceType || '').trim().toLowerCase();
    const normalizedRoomId = String(roomId || '').trim();
    const normalizedLineUserId = String(lineUserId || '').trim();

    if (normalizedSourceType === 'room' && normalizedRoomId) {
        const syntheticProjectId = `room_${normalizedRoomId}`;
        return {
            scopeType: 'room',
            scopeId: normalizedRoomId,
            syntheticProjectId,
            pathPrefix: `projects/${syntheticProjectId}/messages`
        };
    }

    if (normalizedSourceType === 'user') {
        const userScopeId = normalizedLineUserId || '__unknown_user__';
        const syntheticProjectId = `dm_${userScopeId}`;
        return {
            scopeType: 'user',
            scopeId: userScopeId,
            syntheticProjectId,
            pathPrefix: `projects/${syntheticProjectId}/messages`
        };
    }

    return null;
}

async function saveNonGroupMessage(sourceType, roomId, lineUserId, event, env) {
    const message = event?.message;
    if (!message?.type) {
        return false;
    }

    const storage = resolveNonGroupMessageStorage(sourceType, roomId, lineUserId);
    if (!storage) {
        return false;
    }

    const messageType = String(message.type || '').trim().toLowerCase() || 'text';
    const text = messageType === 'text' ? String(message.text || '').trim() : '';
    const lineMessageId = String(message.id || '').trim();
    const FS_BASE = getFSBase(env);
    const suffixSource = String(lineUserId || storage.scopeId || lineMessageId || 'none');
    const suffix = suffixSource.slice(-8);
    const rand = Math.random().toString(36).slice(2, 7);
    const messageId = `msg_${Date.now()}_${suffix}_${rand}`;

    const createdAtRaw = Number(event?.timestamp);
    const createdAtIso = Number.isFinite(createdAtRaw) && createdAtRaw > 0
        ? new Date(createdAtRaw).toISOString()
        : new Date().toISOString();

    const fileName = String(message.fileName || '').trim();
    const fileSize = normalizeNonNegativeInteger(message.fileSize);
    const duration = normalizeNonNegativeInteger(message.duration);
    const packageId = String(message.packageId || '').trim();
    const stickerId = String(message.stickerId || '').trim();
    const title = String(message.title || '').trim();
    const address = String(message.address || '').trim();
    const latitude = Number(message.latitude);
    const longitude = Number(message.longitude);
    const contentProviderType = String(message?.contentProvider?.type || '').trim();
    const externalContentUrl = String(message?.contentProvider?.originalContentUrl || '').trim();
    const previewImageUrl = String(message?.contentProvider?.previewImageUrl || message.previewImageUrl || '').trim();
    const viewUrl = buildMessageViewUrl(message);
    const previewText = buildMessagePreviewText(messageType, message, text);
    const hasAttachment = ['image', 'video', 'audio', 'file'].includes(messageType);

    const fields = {
        id: fsString(messageId),
        projectId: fsString(storage.syntheticProjectId),
        scopeType: fsString(storage.scopeType),
        scopeId: fsString(storage.scopeId),
        lineUserId: fsString(lineUserId || ''),
        senderRole: fsString('user'),
        text: fsString(text),
        previewText: fsString(previewText),
        type: fsString(messageType),
        lineMessageId: fsString(lineMessageId),
        fileName: fsString(fileName),
        packageId: fsString(packageId),
        stickerId: fsString(stickerId),
        locationTitle: fsString(title),
        locationAddress: fsString(address),
        contentProviderType: fsString(contentProviderType),
        externalContentUrl: fsString(externalContentUrl),
        previewImageUrl: fsString(previewImageUrl),
        viewUrl: fsString(viewUrl),
        hasAttachment: { booleanValue: hasAttachment },
        createdAt: { timestampValue: createdAtIso }
    };

    if (fileSize !== null) {
        fields.fileSize = { integerValue: String(fileSize) };
    }

    if (duration !== null) {
        fields.duration = { integerValue: String(duration) };
    }

    if (Number.isFinite(latitude)) {
        fields.latitude = { doubleValue: latitude };
    }

    if (Number.isFinite(longitude)) {
        fields.longitude = { doubleValue: longitude };
    }

    if (storage.scopeType === 'room') {
        fields.roomId = fsString(storage.scopeId);
    }

    if (storage.scopeType === 'user') {
        fields.chatUserId = fsString(storage.scopeId);
    }

    const res = await fetch(`${FS_BASE}/${storage.pathPrefix}/${messageId}?key=${env.FIREBASE_API_KEY}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields })
    });

    if (!res.ok) {
        const errText = await res.text();
        console.error(`Save non-group message failed (${storage.scopeType}:${storage.scopeId}):`, res.status, errText);
        return false;
    }

    return true;
}

async function saveGroupMessage(projectId, lineUserId, event, env) {
    const message = event?.message;
    if (!projectId || !message?.type) {
        return false;
    }

    const messageType = String(message.type || '').trim().toLowerCase() || 'text';
    const text = messageType === 'text' ? String(message.text || '').trim() : '';
    const lineMessageId = String(message.id || '').trim();
    const quotedMessageId = extractQuotedMessageId(message);
    const quoteToken = String(message.quoteToken || '').trim();
    const FS_BASE = getFSBase(env);
    const suffix = (lineUserId || lineMessageId || 'none').slice(-6);
    const rand = Math.random().toString(36).slice(2, 7);
    const stableLineDocId = sanitizeDocIdSegment(lineMessageId);
    const messageId = stableLineDocId
        ? `msg_line_${stableLineDocId.slice(0, 96)}`
        : `msg_${Date.now()}_${suffix}_${rand}`;

    if (lineUserId) {
        await rememberGroupMember(projectId, lineUserId, env);
    }

    const createdAtRaw = Number(event?.timestamp);
    const createdAtIso = Number.isFinite(createdAtRaw) && createdAtRaw > 0
        ? new Date(createdAtRaw).toISOString()
        : new Date().toISOString();

    const fileName = String(message.fileName || '').trim();
    const fileSize = normalizeNonNegativeInteger(message.fileSize);
    const duration = normalizeNonNegativeInteger(message.duration);
    const packageId = String(message.packageId || '').trim();
    const stickerId = String(message.stickerId || '').trim();
    const title = String(message.title || '').trim();
    const address = String(message.address || '').trim();
    const latitude = Number(message.latitude);
    const longitude = Number(message.longitude);
    const contentProviderType = String(message?.contentProvider?.type || '').trim();
    const externalContentUrl = String(message?.contentProvider?.originalContentUrl || '').trim();
    const previewImageUrl = String(message?.contentProvider?.previewImageUrl || message.previewImageUrl || '').trim();
    const viewUrl = buildMessageViewUrl(message);
    const previewText = buildMessagePreviewText(messageType, message, text);
    const quotedPreviewText = quotedMessageId
        ? await resolveQuotedMessagePreviewText(projectId, quotedMessageId, env)
        : '';
    const hasAttachment = ['image', 'video', 'audio', 'file'].includes(messageType);

    const fields = {
        id: fsString(messageId),
        projectId: fsString(projectId),
        lineUserId: fsString(lineUserId || ''),
        senderRole: fsString('user'),
        text: fsString(text),
        previewText: fsString(previewText),
        type: fsString(messageType),
        lineMessageId: fsString(lineMessageId),
        quotedMessageId: fsString(quotedMessageId),
        quotedPreviewText: fsString(quotedPreviewText),
        quoteToken: fsString(quoteToken),
        fileName: fsString(fileName),
        packageId: fsString(packageId),
        stickerId: fsString(stickerId),
        locationTitle: fsString(title),
        locationAddress: fsString(address),
        contentProviderType: fsString(contentProviderType),
        externalContentUrl: fsString(externalContentUrl),
        previewImageUrl: fsString(previewImageUrl),
        viewUrl: fsString(viewUrl),
        hasAttachment: { booleanValue: hasAttachment },
        createdAt: { timestampValue: createdAtIso }
    };

    if (fileSize !== null) {
        fields.fileSize = { integerValue: String(fileSize) };
    }

    if (duration !== null) {
        fields.duration = { integerValue: String(duration) };
    }

    if (Number.isFinite(latitude)) {
        fields.latitude = { doubleValue: latitude };
    }

    if (Number.isFinite(longitude)) {
        fields.longitude = { doubleValue: longitude };
    }

    const url = `${FS_BASE}/projects/${projectId}/messages/${messageId}?key=${env.FIREBASE_API_KEY}`;
    let lastStatus = null;
    let lastErrorText = '';

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const res = await fetch(url, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fields
                })
            });

            if (res.ok) {
                return true;
            }

            lastStatus = res.status;
            lastErrorText = await res.text();
        } catch (err) {
            lastErrorText = err?.message || String(err);
        }

        await sleep(120 * (attempt + 1));
    }

    console.error(
        `Save group message failed (${projectId}/${messageId}):`,
        lastStatus || 'fetch-error',
        lastErrorText
    );
    return false;
}

async function saveBotGroupMessage(projectId, text, env) {
    const normalizedProjectId = String(projectId || '').trim();
    const normalizedText = String(text || '').trim();

    if (!normalizedProjectId || !normalizedText) {
        return;
    }

    const FS_BASE = getFSBase(env);
    const rand = Math.random().toString(36).slice(2, 7);
    const messageId = `msg_${Date.now()}_bot_${rand}`;

    await fetch(`${FS_BASE}/projects/${normalizedProjectId}/messages/${messageId}?key=${env.FIREBASE_API_KEY}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            fields: {
                id: fsString(messageId),
                projectId: fsString(normalizedProjectId),
                lineUserId: fsString('__bot__'),
                senderRole: fsString('bot'),
                text: fsString(normalizedText),
                previewText: fsString(normalizedText),
                type: fsString('text'),
                lineMessageId: fsString(''),
                hasAttachment: { booleanValue: false },
                createdAt: fsTimestampISO()
            }
        })
    });
}

// ✅ AI Engine ใหม่ (แยก function ชัดเจน ปลอดภัย ตรวจครบทุกชั้น)
async function generateAIReply(userText, env, mode = 'default') {
    const azureEndpoint = env.AZURE_OPENAI_ENDPOINT;
    const azureKey = env.AZURE_OPENAI_KEY;

    // ✅ รองรับทั้งชื่อใหม่และชื่อเก่าใน .dev.vars
    const baseDeployment =
        env.AZURE_OPENAI_DEPLOYMENT ||
        env.AZURE_DEPLOYMENT_NAME;

    const secretaryDeployment =
        env.AZURE_OPENAI_DEPLOYMENT_SECRETARY ||
        baseDeployment;

    const aliveDeployment =
        env.AZURE_OPENAI_DEPLOYMENT_ALIVE ||
        secretaryDeployment ||
        baseDeployment;

    const deployment = mode === 'alive'
        ? aliveDeployment
        : (mode === 'secretary' ? secretaryDeployment : baseDeployment);

    if (!azureEndpoint || !azureKey || !deployment) {
        throw new Error('Azure OpenAI configuration missing');
    }
    const apiVersion = env.AZURE_OPENAI_API_VERSION || '2024-02-15-preview';

    if (!azureEndpoint || !azureKey || !deployment) {
        throw new Error('Azure OpenAI ENV not configured');
    }

    const url = `${azureEndpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

    const isSecretary = mode === 'secretary';
    const isAlive = mode === 'alive';

    const systemPrompt = isAlive
        ? 'คุณคือ "ไอน่า" เลขาไอที น่ารัก เป็นมิตร และเป็นนักซัพพอร์ตมืออาชีพ ตอบทุกข้อความของผู้ใช้ด้วยความสุภาพ ชัดเจน กระชับ ใช้ภาษาง่าย เข้าใจเร็ว ช่วยไล่ปัญหาแบบลงมือทำได้จริง หากข้อมูลไม่พอให้ถามต่ออย่างสุภาพ ใช้คำแทนตัวเองว่า "ไอน่า" และลงท้ายด้วยคำว่า "ค่ะ"'
        : (isSecretary
        ? 'คุณคือ "เลขาส่วนตัว" ของผู้บริหาร บุคลิกสุขุม เป็นทางการ จัดลำดับความสำคัญเก่ง ชอบสรุปเป็นข้อ ๆ ชัดเจน ห้ามใช้อิโมจิ ห้ามใช้อักขระตกแต่งพิเศษ ไม่พูดถึงคำว่าไอน่า และไม่ลงท้ายด้วยชื่อใด ๆ ปิดท้ายด้วยคำว่า "ค่ะ" เท่านั้น'
        : 'คุณคือ Aina (ไอน่า) เลขา IT สายเทคนิค เป็นกันเอง ใช้คำอธิบายเชิงเทคนิคได้ ใช้ชื่อแทนตัวเองว่า "ไอน่า" ลงท้ายข้อความด้วย "ค่ะ — ไอน่า" เสมอ และห้ามใช้อิโมจิทุกกรณี');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    let res;
    try {
        res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-key': azureKey
            },
            body: JSON.stringify({
                messages: [
                    {
                        role: 'system',
                        content: systemPrompt
                    },
                    { role: 'user', content: userText }
                ],
                max_tokens: 500,
                temperature: isAlive ? 0.65 : (isSecretary ? 0.4 : 0.8)
            }),
            signal: controller.signal
        });
    } finally {
        clearTimeout(timeout);
    }

    if (!res || !res.ok) {
        const errText = res ? await res.text() : 'No response';
        throw new Error(`Azure HTTP Error: ${res?.status} ${errText}`);
    }

    const data = await res.json();

    if (!data?.choices?.length) {
        throw new Error('Invalid Azure response structure');
    }

    let content = data.choices[0]?.message?.content;

    if (!content) {
        throw new Error('Azure returned empty content');
    }

    // ✅ บังคับลบอิโมจิทุกชนิด (กันหลุดจาก model)
    content = content.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '');

    return content.trim();
}

