// ✅ Flex message builders — buildNotifyTasksFlexMessage, buildPendingTaskConfirmFlexMessage

import { normalizeProbability } from './ai-task-detection.js';

function buildNotifyTasksFlexMessage(projectName, allTasks) {
    const STATUS_COLOR = {
        'in-progress': '#F28A1A',
        'pending': '#f59e0b',
        'completed': '#10b981',
        'abandoned': '#9ca3af'
    };
    const STATUS_LABEL = {
        'in-progress': 'กำลังทำ',
        'pending': 'รอดำเนินการ',
        'completed': 'เสร็จแล้ว',
        'abandoned': 'ยกเลิก'
    };

    const active = allTasks.filter((t) => t.status !== 'completed' && t.status !== 'abandoned');
    const done = allTasks.filter((t) => t.status === 'completed').length;
    const display = active.slice(0, 10);
    const remaining = active.length - display.length;

    const taskRows = [];
    display.forEach((task, i) => {
        if (i > 0) { taskRows.push({ type: 'separator', margin: 'sm' }); }
        const color = STATUS_COLOR[task.status] || '#6b7280';
        const label = STATUS_LABEL[task.status] || task.status;
        const deadlineComp = task.deadline
            ? { type: 'text', text: `📅 ${task.deadline}`, size: 'xs', color: '#888888', align: 'end' }
            : { type: 'filler' };
        taskRows.push({
            type: 'box',
            layout: 'vertical',
            spacing: 'xs',
            contents: [
                {
                    type: 'text',
                    text: task.title.length > 60 ? task.title.slice(0, 57) + '...' : task.title,
                    size: 'sm',
                    weight: 'bold',
                    color: '#1a1a1a',
                    wrap: true
                },
                {
                    type: 'box',
                    layout: 'horizontal',
                    contents: [
                        { type: 'text', text: `● ${label}`, size: 'xs', color, flex: 1 },
                        deadlineComp
                    ]
                },
                { type: 'text', text: `👤 ${task.assignee}`, size: 'xs', color: '#555555' }
            ]
        });
    });

    if (taskRows.length === 0) {
        taskRows.push({
            type: 'text',
            text: 'ยังไม่มีงานที่กำลังดำเนินการค่ะ ✨',
            size: 'sm',
            color: '#888888',
            align: 'center'
        });
    }

    const footerContents = [];
    if (remaining > 0) {
        footerContents.push({
            type: 'text',
            text: `+ อีก ${remaining} งาน`,
            size: 'xs',
            color: '#999999',
            align: 'center',
            margin: 'xs'
        });
    }
    // ปุ่มแจ้งเตือนส่วนตัว — ส่ง /แจ้งงาน ใน chat เดิม (message action)
    footerContents.push({
        type: 'button',
        action: {
            type: 'message',
            label: 'แจ้งเตือนส่วนตัว',
            text: '/แจ้งเตือนส่วนตัว'
        },
        style: 'primary',
        color: '#24387E',
        margin: remaining > 0 ? 'sm' : 'xs',
        height: 'sm'
    });

    return {
        altText: `📋 รายการงาน ${projectName}: ${active.length} งานกำลังดำเนินการ`,
        contents: {
            type: 'bubble',
            size: 'giga',
            header: {
                type: 'box',
                layout: 'vertical',
                backgroundColor: '#24387E',
                paddingAll: 'lg',
                contents: [
                    { type: 'text', text: '📋 รายการงาน', color: '#a8b4d8', size: 'xs', weight: 'bold' },
                    {
                        type: 'text',
                        text: projectName.length > 40 ? projectName.slice(0, 37) + '...' : projectName,
                        color: '#ffffff',
                        size: 'xl',
                        weight: 'bold',
                        margin: 'xs',
                        wrap: true
                    },
                    {
                        type: 'box',
                        layout: 'horizontal',
                        margin: 'sm',
                        contents: [
                            { type: 'text', text: `🔄 กำลังทำ ${active.length} งาน`, color: '#fbbf24', size: 'xs', flex: 1 },
                            { type: 'text', text: `✅ เสร็จแล้ว ${done} งาน`, color: '#34d399', size: 'xs', align: 'end' }
                        ]
                    }
                ]
            },
            body: {
                type: 'box',
                layout: 'vertical',
                spacing: 'none',
                paddingAll: 'lg',
                contents: taskRows
            },
            footer: {
                type: 'box',
                layout: 'vertical',
                paddingAll: 'md',
                backgroundColor: '#f4f6fb',
                contents: footerContents
            }
        }
    };
}

function buildPendingTaskConfirmFlexMessage(options = {}) {
    const title = String(options?.title || '').trim() || 'งานจากข้อความล่าสุด';
    const assigneeLabel = String(options?.assigneeLabel || '').trim() || 'ยังไม่ระบุ';
    const deadlineDisplay = String(options?.deadlineDisplay || '').trim();
    const aiConfidence = normalizeProbability(options?.aiConfidence, 0);
    const ambiguityFlags = Array.isArray(options?.ambiguityFlags)
        ? options.ambiguityFlags.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
    const ambiguityText = ambiguityFlags.length > 0
        ? ambiguityFlags.join(', ')
        : 'ต้องการยืนยันจากผู้ใช้';

    const infoLines = [
        `ให้สร้างเป็นงานเลยไหมคะ: "${title.slice(0, 80)}"`,
        `มอบหมาย: ${assigneeLabel}${deadlineDisplay ? ` · กำหนดส่ง: ${deadlineDisplay}` : ''}`,
        `AI confidence: ${Math.round(aiConfidence * 100)}%`
    ];

    return {
        altText: `ยืนยันการบันทึกงาน: ${title.slice(0, 40)}`,
        contents: {
            type: 'bubble',
            size: 'kilo',
            header: {
                type: 'box',
                layout: 'vertical',
                backgroundColor: '#24387E',
                paddingAll: 'lg',
                contents: [
                    { type: 'text', text: 'ยืนยันก่อนบันทึกงาน', color: '#a8b4d8', size: 'xs', weight: 'bold' },
                    { type: 'text', text: 'AI ไม่แน่ใจ', color: '#ffffff', size: 'xl', weight: 'bold', margin: 'xs' }
                ]
            },
            body: {
                type: 'box',
                layout: 'vertical',
                spacing: 'sm',
                contents: [
                    { type: 'text', text: infoLines[0], wrap: true, size: 'sm', weight: 'bold', color: '#111827' },
                    { type: 'text', text: infoLines[1], wrap: true, size: 'xs', color: '#374151' },
                    { type: 'text', text: infoLines[2], wrap: true, size: 'xs', color: '#374151' },
                    { type: 'text', text: `เหตุผลที่ต้องถาม: ${ambiguityText}`, wrap: true, size: 'xs', color: '#6b7280' },
                    { type: 'text', text: 'คำถามนี้ถามครั้งเดียว และจะหมดอายุใน 2 นาที', wrap: true, size: 'xs', color: '#9ca3af' }
                ]
            },
            footer: {
                type: 'box',
                layout: 'vertical',
                spacing: 'sm',
                contents: [
                    {
                        type: 'button',
                        style: 'primary',
                        color: '#24387E',
                        action: { type: 'message', label: 'บันทึก', text: '/บันทึก' }
                    },
                    {
                        type: 'button',
                        style: 'secondary',
                        action: { type: 'message', label: 'ไม่บันทึก', text: '/ไม่บันทึก' }
                    }
                ]
            }
        }
    };
}

export {
    buildNotifyTasksFlexMessage,
    buildPendingTaskConfirmFlexMessage
};
