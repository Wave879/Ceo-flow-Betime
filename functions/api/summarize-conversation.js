function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}

function normalizeSenderName(value = '') {
    const senderName = String(value || '').replace(/\s+/g, ' ').trim();
    if (!senderName) {
        return 'ไม่ทราบผู้ส่ง';
    }
    return senderName.slice(0, 80);
}

function normalizeText(value = '', maxLength = 800) {
    const text = String(value || '')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!text) {
        return '';
    }

    return text.slice(0, maxLength);
}

function normalizeMessageRows(rawRows) {
    if (!Array.isArray(rawRows)) {
        return [];
    }

    const out = [];
    for (const row of rawRows) {
        const senderName = normalizeSenderName(row?.senderName);
        const text = normalizeText(row?.text || row?.previewText);
        if (!text) {
            continue;
        }

        const createdAtText = normalizeText(row?.createdAtText, 40) || '-';
        const type = normalizeText(row?.type, 20) || 'text';

        out.push({
            senderName,
            text,
            createdAtText,
            type,
            isBot: Boolean(row?.isBot)
        });
    }

    return out;
}

function toMention(name = '') {
    const cleaned = String(name || '').trim();
    if (!cleaned) {
        return '';
    }
    return cleaned.startsWith('@') ? cleaned : `@${cleaned}`;
}

function resolveAssigneeMentions(rows) {
    const senderCounts = new Map();

    for (const row of rows) {
        if (row?.isBot) {
            continue;
        }

        const senderName = normalizeSenderName(row?.senderName);
        const lower = senderName.toLowerCase();
        if (!senderName || lower === 'aina-bt' || lower === 'bot') {
            continue;
        }

        senderCounts.set(senderName, (senderCounts.get(senderName) || 0) + 1);
    }

    const ordered = [...senderCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name]) => toMention(name));

    return {
        primary: ordered[0] || '@คนทำงานหลัก',
        secondary: ordered[1] || '@คนรับผิดชอบร่วมกัน',
        cc: ordered.slice(2).join(' ') || '@ผู้เกี่ยวข้อง'
    };
}

function buildConversationContext(rows, maxChars = 220000) {
    const lines = [];
    let totalChars = 0;
    let truncated = false;

    for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        const line = `${i + 1}. [${row.createdAtText}] ${row.senderName}: ${row.text}`;
        const lineLen = line.length + 1;

        if (totalChars + lineLen > maxChars) {
            truncated = true;
            break;
        }

        lines.push(line);
        totalChars += lineLen;
    }

    return {
        text: lines.join('\n'),
        usedMessages: lines.length,
        droppedMessages: Math.max(0, rows.length - lines.length),
        truncated
    };
}

function normalizeAzureEndpoint(value = '') {
    return String(value || '').trim().replace(/\/+$/, '');
}

function buildMeetingDateText(value = '') {
    const normalized = String(value || '').trim();
    if (normalized) {
        return normalized;
    }

    return new Intl.DateTimeFormat('th-TH', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
}

async function generateSummaryWithAzureOpenAI({ env, userPrompt }) {
    const azureEndpoint = normalizeAzureEndpoint(env?.AZURE_OPENAI_ENDPOINT);
    const azureKey = String(env?.AZURE_OPENAI_KEY || '').trim();
    const deployment = String(env?.AZURE_OPENAI_DEPLOYMENT || env?.AZURE_DEPLOYMENT_NAME || '').trim();
    const apiVersion = String(env?.AZURE_OPENAI_API_VERSION || '2024-02-15-preview').trim();

    if (!azureEndpoint || !azureKey || !deployment) {
        throw new Error('Azure OpenAI configuration missing');
    }

    const systemPrompt = [
        'คุณคือผู้ช่วยสรุปรายงานประชุมภาษาไทยสำหรับทีมเทคนิคและธุรกิจ',
        'สรุปจากบทสนทนาที่ได้รับเท่านั้น ห้ามแต่งข้อมูลนอกบทสนทนา',
        'ต้องตอบตามโครงรูปแบบที่กำหนด และห้ามใส่หัวข้อ [ข้อความทั้งหมด]',
        'ถ้าข้อมูลไม่พอ ให้ใช้คำว่า "ไม่พบข้อมูลชัดเจนจากบทสนทนา" ในหัวข้อนั้น',
        'ต้องคงหัวข้อ 1-4, Next Step, CC และ หมายเหตุ ตามแบบที่กำหนด'
    ].join('\n');

    const url = `${azureEndpoint}/openai/deployments/${deployment}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'api-key': azureKey
        },
        body: JSON.stringify({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature: 0.2,
            max_tokens: 1500
        })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const detail = data?.error?.message || data?.detail || `Azure OpenAI request failed (${res.status})`;
        throw new Error(detail);
    }

    const summary = String(data?.choices?.[0]?.message?.content || '').trim();
    if (!summary) {
        throw new Error('Azure OpenAI returned empty summary');
    }

    return summary;
}

export async function onRequest({ request, env }) {
    if (request.method !== 'POST') {
        return jsonResponse({ error: 'Method Not Allowed' }, 405);
    }

    let payload = {};
    try {
        payload = await request.json();
    } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const groupId = String(payload?.groupId || '').trim();
    const meetingName = normalizeText(payload?.groupName || 'ชื่อประชุม', 120) || 'ชื่อประชุม';
    const meetingDateText = buildMeetingDateText(payload?.latestMessageAtText);
    const rows = normalizeMessageRows(payload?.messages);

    if (!groupId) {
        return jsonResponse({ error: 'Missing groupId' }, 400);
    }

    if (rows.length === 0) {
        return jsonResponse({ error: 'No messages to summarize' }, 400);
    }

    const mentions = resolveAssigneeMentions(rows);
    const context = buildConversationContext(rows);

    const template = [
        `${mentions.primary} ${mentions.secondary}`,
        `สรุปประเด็นหารือ ${meetingName} (${meetingDateText})`,
        '',
        '1. หัวข้อหลัก',
        '  1.1 ประเด็นย่อย',
        '    1.1.1 รายละเอียดเกี่ยวกับการดำเนินงาน',
        '',
        '2. แนวทางการแก้ไขทางเทคนิค',
        '  - เสนอกระบวนการปรับปรุงซอฟต์แวร์',
        '',
        '3. กลยุทธ์ทางธุรกิจและความร่วมมือ',
        '  - สนับสนุนการร่วมมือระหว่างทีม',
        '',
        '4. สรุปภาพ Architecture',
        '  - นำเสนอโครงสร้างทางด้าน IT',
        '',
        'Next Step :',
        '1. ตรวจสอบข้อมูลเพิ่มเติม',
        '2. กำหนดเวลากิจกรรมต่อไป',
        '3. นำเสนอรายงานให้กับผู้บริหาร',
        '',
        `CC : ${mentions.cc}`,
        '',
        'หมายเหตุ:'
    ].join('\n');

    const userPrompt = [
        'กรุณาสรุปบทสนทนาทั้งหมดด้านล่างให้อยู่ในรูปแบบตาม template ที่กำหนด',
        'ห้ามใส่หัวข้อ [ข้อความทั้งหมด]',
        '',
        'Template:',
        template,
        '',
        'บทสนทนาทั้งหมด:',
        context.text,
        '',
        context.truncated
            ? `หมายเหตุระบบ: บทสนทนามีความยาวมาก เกินขีดจำกัดอินพุต จึงส่งได้ ${context.usedMessages} จาก ${rows.length} ข้อความ`
            : `หมายเหตุระบบ: ส่งบทสนทนา ${rows.length} ข้อความครบถ้วน`
    ].join('\n');

    try {
        const summary = await generateSummaryWithAzureOpenAI({ env, userPrompt });

        return jsonResponse({
            success: true,
            summary,
            source: {
                groupId,
                totalMessages: rows.length,
                usedMessages: context.usedMessages,
                droppedMessages: context.droppedMessages,
                truncated: context.truncated
            }
        }, 200);
    } catch (err) {
        console.error('Summarize conversation failed:', err);
        return jsonResponse({
            error: 'SUMMARIZE_FAILED',
            detail: err?.message || 'Unable to summarize conversation'
        }, 500);
    }
}
