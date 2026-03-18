// ✅ Group Handler
// รับผิดชอบ logic เฉพาะ group เท่านั้น

export async function handleGroupEvent(event, env) {
    const groupId = event.source?.groupId;
    const replyToken = event.replyToken;

    if (!groupId) {
        return new Response('OK');
    }

    // ✅ เมื่อบอทถูกเพิ่มเข้ากลุ่ม (auto sync ตอนเข้า)
    if (event.type === 'join') {
        // join บางกรณี replyToken ใช้ได้ แต่ไม่ควรบังคับว่าต้องมี
        return await autoSyncOnJoin(groupId, replyToken, env);
    }

    // หลังจากนี้คือ message event เท่านั้น
    if (event.type !== 'message' || !replyToken) {
        return new Response('OK');
    }

    const text = event.message?.text?.trim();

    // ✅ /มีชีวิต (ในกลุ่ม)
    if (text === '/มีชีวิต') {
        globalThis.__ALIVE_MODE__ = true;
        return await reply(replyToken, 'เปิดโหมดมีชีวิตในกลุ่มเรียบร้อยแล้วค่ะ', env);
    }

    // ✅ /จบชีวิต (ในกลุ่ม)
    if (text === '/จบชีวิต') {
        globalThis.__ALIVE_MODE__ = false;
        return await reply(replyToken, 'ปิดโหมดมีชีวิตในกลุ่มแล้วค่ะ', env);
    }

    // ✅ /ซิงข้อมูลกลุ่ม
    if (text && text.startsWith('/ซิงข้อมูลกลุ่ม')) {
        return await syncGroup(groupId, replyToken, env);
    }

    return new Response('OK');
}

async function syncGroup(groupId, replyToken, env) {
    try {
        const FS_BASE = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;

        // สร้าง/อัปเดต project
        await fetch(`${FS_BASE}/projects/${groupId}?key=${env.FIREBASE_API_KEY}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fields: {
                    id: { stringValue: groupId },
                    name: { stringValue: `LINE GROUP ${groupId.slice(-6)}` },
                    source: { stringValue: 'line-group' }
                }
            })
        });

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

    return new Response('OK');
}

// ✅ Auto sync เมื่อ bot ถูก invite เข้ากลุ่ม
async function autoSyncOnJoin(groupId, replyToken, env) {
    try {
        if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_API_KEY) {
            console.error('Missing Firebase ENV', {
                FIREBASE_PROJECT_ID: env.FIREBASE_PROJECT_ID,
                FIREBASE_API_KEY: !!env.FIREBASE_API_KEY
            });
            return new Response('Missing Firebase ENV');
        }

        const FS_BASE = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;

        // ดึงชื่อกลุ่ม
        let groupName = `LINE GROUP ${groupId.slice(-6)}`;

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
            }
        } catch (err) {
            console.error('Group summary fetch failed:', err);
        }

        // สร้าง project
        const writeRes = await fetch(`${FS_BASE}/projects/${groupId}?key=${env.FIREBASE_API_KEY}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fields: {
                    id: { stringValue: groupId },
                    name: { stringValue: groupName },
                    source: { stringValue: 'line-group' }
                }
            })
        });

        const writeText = await writeRes.text();

        if (!writeRes.ok) {
            console.error('Firestore write failed:', writeRes.status, writeText);
            return new Response('Firestore write failed');
        }

        console.log('✅ Project synced:', groupId);

        // ถ้ามี replyToken ค่อยตอบกลับ
        if (replyToken) {
            await reply(replyToken, 'เชื่อมต่อกลุ่มเรียบร้อยแล้วค่ะ', env);
        }
    } catch (err) {
        console.error('Auto sync on join error:', err);
    }

    return new Response('OK');
}

async function reply(replyToken, text, env) {
    await fetch('https://api.line.me/v2/bot/message/reply', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.LINE_TOKEN}`
        },
        body: JSON.stringify({
            replyToken,
            messages: [{ type: 'text', text }]
        })
    });

    return new Response('OK');
}

