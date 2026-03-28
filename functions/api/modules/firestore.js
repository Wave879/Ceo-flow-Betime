// ✅ Firestore helpers — type constructors, REST helpers, CRUD, field readers

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

async function getAccessToken(env) {
    if (env.FIREBASE_API_KEY) {
        return null;
    }
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

// ── Firestore CRUD ────────────────────────────────────────────────────────────

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

// ── Firestore field readers ───────────────────────────────────────────────────

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

export {
    fsString,
    fsStringArray,
    fsTimelineEntriesArray,
    fsTimestampISO,
    getFSBase,
    getAccessToken,
    str2ab,
    arrayBufferToBase64Url,
    arrayBufferToBase64,
    fsGetDoc,
    fsSetDoc,
    fsDeleteDoc,
    createEmployee,
    upsertLineUser,
    patchFirestoreDoc,
    readFirestoreStringField,
    readFirestoreIntegerField,
    readFirestoreStringArrayField,
    readFirestoreTimelineEntries
};
