import { registerGroupMemberIdentity, syncGroupMembersToTeam } from './webhook.js';

function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}

function getFSBase(env) {
    return `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
}

function normalizeGroupId(value) {
    const groupId = String(value || '').trim();
    if (!/^C[0-9a-f]{32}$/i.test(groupId)) {
        return '';
    }
    return groupId;
}

function normalizeLineUserId(value) {
    const lineUserId = String(value || '').trim();
    if (!/^U[0-9a-f]{32}$/i.test(lineUserId)) {
        return '';
    }
    return lineUserId;
}

function readStringField(fields, key) {
    return String(fields?.[key]?.stringValue || '').trim();
}

function readIntegerField(fields, key) {
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

async function verifyLineIdToken(idToken, env) {
    const normalizedToken = String(idToken || '').trim();
    if (!normalizedToken) {
        return { ok: false, error: 'Missing idToken' };
    }

    const channelId = String(env?.LINE_LOGIN_CHANNEL_ID || env?.LINE_LIFF_CHANNEL_ID || '').trim();
    if (!channelId) {
        return { ok: false, error: 'MISSING_LINE_LOGIN_CHANNEL_ID' };
    }

    const body = new URLSearchParams({
        id_token: normalizedToken,
        client_id: channelId
    });

    const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
    });

    if (!res.ok) {
        const detail = await res.text();
        return {
            ok: false,
            error: detail || `LINE idToken verify failed (${res.status})`
        };
    }

    const data = await res.json().catch(() => null);
    const lineUserId = normalizeLineUserId(data?.sub);
    if (!lineUserId) {
        return { ok: false, error: 'LINE idToken verify returned invalid user id' };
    }

    return {
        ok: true,
        lineUserId,
        displayName: String(data?.name || '').trim(),
        pictureUrl: String(data?.picture || '').trim()
    };
}

async function readProjectIdentity(groupId, env = {}) {
    const fallback = {
        groupName: `LINE GROUP ${String(groupId || '').slice(-6)}`,
        memberCount: null
    };

    if (!env?.FIREBASE_PROJECT_ID || !env?.FIREBASE_API_KEY) {
        return fallback;
    }

    try {
        const res = await fetch(`${getFSBase(env)}/projects/${groupId}?key=${env.FIREBASE_API_KEY}`);
        if (!res.ok) {
            return fallback;
        }

        const data = await res.json().catch(() => null);
        const fields = data?.fields || {};
        const name =
            readStringField(fields, 'name') ||
            readStringField(fields, 'groupName') ||
            readStringField(fields, 'webProjectName') ||
            fallback.groupName;

        return {
            groupName: name,
            memberCount: readIntegerField(fields, 'memberCount')
        };
    } catch {
        return fallback;
    }
}

export async function onRequest({ request, env }) {
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            }
        });
    }

    if (request.method !== 'POST') {
        return jsonResponse({ error: 'Method Not Allowed' }, 405);
    }

    let body = {};
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const groupId = normalizeGroupId(body?.groupId);
    if (!groupId) {
        return jsonResponse({ error: 'Missing or invalid groupId' }, 400);
    }

    const source = String(body?.source || 'liff').trim() || 'liff';
    const rawDisplayName = String(body?.displayName || '').trim();
    const rawPictureUrl = String(body?.pictureUrl || '').trim();

    let verifiedByIdToken = false;
    let verificationWarning = null;
    let resolvedLineUserId = '';
    let resolvedDisplayName = rawDisplayName;
    let resolvedPictureUrl = rawPictureUrl;
    const fallbackLineUserId = normalizeLineUserId(body?.lineUserId);

    const idToken = String(body?.idToken || '').trim();
    if (idToken) {
        const verification = await verifyLineIdToken(idToken, env);
        if (!verification.ok && verification.error === 'MISSING_LINE_LOGIN_CHANNEL_ID' && fallbackLineUserId) {
            resolvedLineUserId = fallbackLineUserId;
            verificationWarning = 'LIFF idToken verification skipped because LINE_LOGIN_CHANNEL_ID is not configured';
        } else if (!verification.ok) {
            return jsonResponse({
                error: 'INVALID_ID_TOKEN',
                detail: verification.error
            }, 401);
        } else {
            verifiedByIdToken = true;
            resolvedLineUserId = verification.lineUserId;
            resolvedDisplayName = resolvedDisplayName || verification.displayName;
            resolvedPictureUrl = resolvedPictureUrl || verification.pictureUrl;
        }
    } else {
        resolvedLineUserId = fallbackLineUserId;
        if (!resolvedLineUserId) {
            return jsonResponse({
                error: 'Missing lineUserId or idToken'
            }, 400);
        }
    }

    try {
        const registerResult = await registerGroupMemberIdentity(
            groupId,
            resolvedLineUserId,
            {
                displayName: resolvedDisplayName,
                photoUrl: resolvedPictureUrl
            },
            env,
            {
                source: `${source}-register`
            }
        );

        if (!registerResult.groupUserOk && !registerResult.employeeOk && !registerResult.memberOk && !registerResult.memberLinkOk) {
            return jsonResponse({
                error: 'REGISTER_FAILED',
                detail: 'Unable to persist member identity'
            }, 502);
        }

        const projectIdentity = await readProjectIdentity(groupId, env);
        let teamSyncResult = null;
        let teamSyncWarning = null;

        if (registerResult.isNewGroupMember) {
            try {
                teamSyncResult = await syncGroupMembersToTeam(groupId, env, {
                    seedLineUserIds: [resolvedLineUserId],
                    expectedMemberCount: projectIdentity.memberCount,
                    groupName: projectIdentity.groupName
                });
            } catch (err) {
                teamSyncWarning = err?.message || String(err);
            }
        }

        return jsonResponse({
            success: true,
            groupId,
            lineUserId: resolvedLineUserId,
            displayName: registerResult.displayName || resolvedDisplayName || `LINE-${resolvedLineUserId.slice(-6)}`,
            isNewGroupMember: Boolean(registerResult.isNewGroupMember),
            placeholderReduced: Boolean(registerResult.placeholderReduced),
            placeholderWarning: registerResult.placeholderWarning || null,
            teamSyncResult,
            teamSyncWarning,
            verificationWarning,
            verifiedByIdToken
        }, 200);
    } catch (err) {
        console.error('LIFF register failed:', err);
        return jsonResponse({ error: 'Register failed', detail: err?.message || String(err) }, 500);
    }
}
