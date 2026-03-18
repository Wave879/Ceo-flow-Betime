// ✅ User Handler
// รับผิดชอบ logic แชทส่วนตัวและ AI

export async function handleUserEvent(event, env) {
    const replyToken = event.replyToken;
    const text = event.message?.text?.trim();

    if (!replyToken || !text) {
        return new Response('OK');
    }

    // ✅ /มีชีวิต
    if (text === '/มีชีวิต') {
        globalThis.__ALIVE_MODE__ = true;
        return reply(replyToken, 'เปิดโหมดมีชีวิตเรียบร้อยแล้วค่ะ', env);
    }

    // ✅ /จบชีวิต
    if (text === '/จบชีวิต') {
        globalThis.__ALIVE_MODE__ = false;
        return reply(replyToken, 'ปิดโหมดมีชีวิตแล้วค่ะ', env);
    }

    if (!globalThis.__ALIVE_MODE__) {
        return reply(replyToken, 'ยังไม่ได้เปิดโหมดมีชีวิตค่ะ พิมพ์ /มีชีวิต ก่อนใช้งาน', env);
    }

    return reply(replyToken, 'โหมดมีชีวิตทำงานอยู่', env);
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

