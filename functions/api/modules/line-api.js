// ✅ LINE API utilities — fetch helpers, profile, group summary, message send

import { isLineGroupId } from './message-parser.js';
import { normalizeNonNegativeInteger, normalizeLineMembersCountForDisplay } from './data-normalizer.js';
import { saveBotGroupMessage } from './message-persistence.js';

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

async function replyFlex(replyToken, flexPayload, env, options = {}) {
    if (!replyToken) { return false; }
    const message = {
        type: 'flex',
        altText: String(flexPayload?.altText || 'ข้อความจากบอท'),
        contents: flexPayload.contents
    };
    const res = await fetch('https://api.line.me/v2/bot/message/reply', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.LINE_TOKEN}`
        },
        body: JSON.stringify({ replyToken, messages: [message] })
    });
    if (!res.ok) {
        const errText = await res.text();
        console.error('LINE replyFlex failed:', res.status, errText);
        return false;
    }
    const groupId = String(options?.groupId || '').trim();
    if (groupId && options?.saveToChat !== false) {
        await saveBotGroupMessage(groupId, message.altText, env).catch((err) => {
            console.error('Save bot flex message failed:', err);
        });
    }
    return true;
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

export {
    sleep,
    lineFetchJson,
    fetchLineGroupMemberCount,
    extractStatusCodeFromLineError,
    isLineNotInGroupError,
    isLikelyLineUserId,
    getEmployeeDocIdFromLineUserId,
    replyFlex,
    replyText,
    pushText,
    fetchLineProfile,
    getGroupSummary
};
