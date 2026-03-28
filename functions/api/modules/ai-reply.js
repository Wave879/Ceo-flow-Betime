// ✅ AI Engine — generateAIReply

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

export {
    generateAIReply
};
