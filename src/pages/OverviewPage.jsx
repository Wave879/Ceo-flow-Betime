import React, { useMemo, useState } from 'react';
import {
    Plus, Briefcase, AlertTriangle, MessageCircle, Users, FolderKanban,
    CheckCircle, XCircle, Send, ChevronRight
} from 'lucide-react';
import { PieChart } from '../components/Charts';
import { AddTaskModal, AddEmployeeModal } from '../components/Modals';
import TaskDetailModal from '../components/TaskDetailModal';

// Color palette for CEO FLOW (Betimes Orange)
const COLORS = {
    primary: '#F28A1A',
    secondary: '#FF6B35',
    betimes: '#24387E',
    success: '#10b981',
    warning: '#f59e0b',
    danger: '#ef4444',
    purple: '#8b5cf6',
};

const GROUP_TYPE_VALUES = new Set(['unset', 'betimes', 'outsource', 'external']);

function normalizeGroupType(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (GROUP_TYPE_VALUES.has(normalized)) {
        return normalized;
    }

    return 'unset';
}

function toDate(value) {
    if (!value) {
        return null;
    }

    if (typeof value?.toDate === 'function') {
        return value.toDate();
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }

    return parsed;
}

function formatDateTime(value) {
    const date = toDate(value);
    if (!date) {
        return '-';
    }

    return new Intl.DateTimeFormat('th-TH', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
}

function hasTaskReply(task = {}) {
    if (String(task?.replyAnswerText || '').trim()) {
        return true;
    }

    const timelineEntries = Array.isArray(task?.timelineEntries) ? task.timelineEntries : [];
    return timelineEntries.some((entry = {}) => {
        const replyLineMessageId = String(entry?.replyLineMessageId || '').trim();
        const title = String(entry?.title || '').trim();
        return Boolean(replyLineMessageId)
            || title === 'ตอบกลับงานจาก LINE'
            || title === 'สั่งต่องานจาก LINE'
            || title === 'สั่งต่อและเปิดงานอีกครั้งจาก LINE';
    });
}

function getTaskSourcePreview(task = {}) {
    return String(task?.sourceText || task?.description || task?.title || task?.name || '').trim();
}

function getTaskParticipantCount(task = {}) {
    const lineAssigneeNames = Array.isArray(task?.lineAssigneeNames) ? task.lineAssigneeNames.filter(Boolean) : [];
    if (lineAssigneeNames.length > 0) {
        return lineAssigneeNames.length;
    }

    const lineAssigneeIds = Array.isArray(task?.lineAssigneeIds) ? task.lineAssigneeIds.filter(Boolean) : [];
    if (lineAssigneeIds.length > 0) {
        return lineAssigneeIds.length;
    }

    const assignees = Array.isArray(task?.assignees) ? task.assignees.filter(Boolean) : [];
    if (assignees.length > 0) {
        return assignees.length;
    }

    return String(task?.assignee || '').trim() ? 1 : 0;
}

export default function OverviewPage({
    tasks = [],
    employees = [],
    positions = [],
    projects = [],
    onAddTask,
    onUpdateTask,
    onAddEmployee,
    onDeleteEmployee,
    onAddPosition,
    onDeletePosition,
    onNavigate,
}) {
    const [modal, setModal] = useState(null);
    const [selectedTask, setSelectedTask] = useState(null);

    // Calculate statistics
    const safeTasks = Array.isArray(tasks) ? tasks : [];
    const safeEmployees = Array.isArray(employees) ? employees : [];
    const safeProjects = Array.isArray(projects) ? projects : [];

    const stats = useMemo(() => {
        const now = new Date();
        const activeTasks = safeTasks.filter(task => task?.status !== 'completed').length;
        const overdueTasks = safeTasks.filter(task => {
            if (!task.deadline || task.status === 'completed') return false;
            return new Date(task.deadline) < now;
        }).length;

        const unansweredQuestions = safeTasks.filter((task) => {
            const status = String(task?.status || '').trim().toLowerCase();
            if (status === 'completed' || status === 'abandoned') {
                return false;
            }

            const source = String(task?.source || '').trim().toLowerCase();
            if (!source.startsWith('line-')) {
                return false;
            }

            return !hasTaskReply(task);
        }).length;

        return {
            total: safeTasks.length,
            active: activeTasks,
            overdue: overdueTasks,
            unanswered: unansweredQuestions
        };
    }, [safeTasks]);

    // Real project groups by type
    const groupStats = useMemo(() => {
        const eligibleProjects = safeProjects.filter((project) => {
            const source = String(project?.source || '').trim().toLowerCase();
            return source !== 'dm' && source !== 'room';
        });

        const betimes = eligibleProjects.filter((project) => {
            const type = normalizeGroupType(project?.groupType || project?.type || 'unset');
            return type === 'betimes' || type === 'unset';
        }).length;
        const outsource = eligibleProjects.filter((project) => normalizeGroupType(project?.groupType || project?.type || 'unset') === 'outsource').length;
        const external = eligibleProjects.filter((project) => normalizeGroupType(project?.groupType || project?.type || 'unset') === 'external').length;

        return [
            { name: 'Betimes ภายใน', value: betimes, color: COLORS.betimes },
            { name: 'Outsource ส้ม+ขาว', value: outsource, color: COLORS.primary },
            { name: 'คนนอก ส้ม', value: external, color: COLORS.secondary },
        ];
    }, [safeProjects]);

    const totalProjects = useMemo(
        () => groupStats.reduce((sum, item) => sum + Number(item?.value || 0), 0),
        [groupStats]
    );

    // Real urgent mentions/tasks
    const urgentMentions = useMemo(() => {
        return safeTasks
            .filter((task) => {
                const status = String(task?.status || '').trim().toLowerCase();
                if (status === 'completed' || status === 'abandoned') {
                    return false;
                }

                const sentiment = String(task?.messageSentiment || '').trim().toLowerCase();
                const preview = getTaskSourcePreview(task).toLowerCase();
                return sentiment === 'urgent'
                    || sentiment === 'negative'
                    || preview.includes('ด่วน')
                    || preview.includes('urgent')
                    || preview.includes('asap');
            })
            .sort((left, right) => {
                const leftTime = toDate(left?.updatedAt || left?.createdAt)?.getTime() || 0;
                const rightTime = toDate(right?.updatedAt || right?.createdAt)?.getTime() || 0;
                return rightTime - leftTime;
            })
            .slice(0, 5)
            .map((task) => ({
                id: task.id,
                message: getTaskSourcePreview(task) || String(task?.title || task?.name || 'งานเร่งด่วน').trim(),
                from: String(task?.createdByName || task?.assignee || 'ไม่ระบุ').trim(),
                time: formatDateTime(task?.updatedAt || task?.createdAt),
                status: hasTaskReply(task) ? 'answered' : 'pending'
            }));
    }, [safeTasks]);

    // Real recent meeting summaries
    const recentMeetings = useMemo(() => {
        return safeTasks
            .filter((task) => String(task?.source || '').trim().toLowerCase() === 'line-meeting-summary')
            .sort((left, right) => {
                const leftTime = toDate(left?.createdAt || left?.updatedAt)?.getTime() || 0;
                const rightTime = toDate(right?.createdAt || right?.updatedAt)?.getTime() || 0;
                return rightTime - leftTime;
            })
            .slice(0, 3)
            .map((task) => ({
                id: task.id,
                title: String(task?.title || task?.name || 'สรุปการประชุม').trim(),
                date: formatDateTime(task?.createdAt || task?.updatedAt || task?.deadline),
                participants: getTaskParticipantCount(task),
                summary: getTaskSourcePreview(task) || 'ยังไม่มีรายละเอียดการประชุม'
            }));
    }, [safeTasks]);

    const statCards = [
        {
            icon: <Briefcase size={24} />,
            label: 'งานที่กำลังดำเนิน',
            value: stats.active,
            color: COLORS.primary,
            bg: 'from-orange-500/20 to-amber-500/10',
        },
        {
            icon: <AlertTriangle size={24} />,
            label: 'งานเลยกำหนด',
            value: stats.overdue,
            color: COLORS.danger,
            bg: 'from-red-500/20 to-rose-500/10',
        },
        {
            icon: <MessageCircle size={24} />,
            label: 'คำถามยังไม่ตอบ',
            value: stats.unanswered,
            color: COLORS.warning,
            bg: 'from-amber-500/20 to-yellow-500/10',
        },
        {
            icon: <Users size={24} />,
            label: 'สมาชิกในทีม',
            value: safeEmployees.length,
            color: COLORS.betimes,
            bg: 'from-blue-600/20 to-indigo-500/10',
        },
    ];

    return (
        <div className="animate-fade-in space-y-6">
            {/* Hero Section */}
            <div className="relative overflow-hidden rounded-3xl p-5 sm:p-8 md:p-10"
                style={{ background: 'linear-gradient(135deg, #24387E 0%, #1a2744 100%)' }}>
                <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full opacity-10"
                    style={{ background: 'radial-gradient(circle, #F28A1A, transparent)' }} />
                <div className="absolute -bottom-16 -left-10 w-52 h-52 rounded-full opacity-10"
                    style={{ background: 'radial-gradient(circle, #FF6B35, transparent)' }} />

                <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                    <div>
                        <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/10 rounded-full border border-white/20 text-white/80 text-xs font-semibold mb-3">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            ระบบออนไลน์ • CEO FLOW
                        </div>
                        <h1 className="text-3xl md:text-4xl font-black text-white mb-2 tracking-tight leading-tight">
                            ภาพรวม<span style={{ color: COLORS.primary }}> CEO FLOW</span>
                        </h1>
                        <p className="text-white/60 text-sm max-w-md">
                            ระบบจัดการงานและติดตาม LINE Group สำหรับผู้บริหาร
                        </p>
                    </div>
                    <div className="flex gap-3">
                        <button
                            onClick={() => setModal('task')}
                            className="flex items-center gap-2 px-5 py-3 rounded-xl font-semibold text-sm transition-all hover:scale-105"
                            style={{ background: COLORS.primary, boxShadow: '0 4px 16px rgba(242,138,26,0.4)' }}
                        >
                            <Plus size={18} />
                            เพิ่มงานใหม่
                        </button>
                    </div>
                </div>
            </div>

            {/* Stat Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {statCards.map((stat, i) => (
                    <div key={i} className="relative overflow-hidden rounded-2xl p-5 bg-white dark:bg-slate-800/50 border border-slate-200/60 dark:border-white/10">
                        <div className={`absolute inset-0 bg-gradient-to-br ${stat.bg} opacity-50`} />
                        <div className="relative">
                            <div className="flex items-center justify-between mb-3">
                                <div className="w-12 h-12 rounded-xl flex items-center justify-center"
                                    style={{ backgroundColor: `${stat.color}20`, color: stat.color }}>
                                    {stat.icon}
                                </div>
                            </div>
                            <p className="text-3xl font-black text-slate-900 dark:text-white">{stat.value}</p>
                            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{stat.label}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Main Content Grid */}
            <div className="grid lg:grid-cols-3 gap-6">
                {/* Project Health Chart */}
                <div className="lg:col-span-2 bg-white dark:bg-slate-800/50 rounded-2xl p-6 border border-slate-200/60 dark:border-white/10">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white">สุขภาพโปรเจกต์</h3>
                        <span className="text-sm text-slate-500">แบ่งตามประเภทกลุ่ม</span>
                    </div>
                    <div className="flex items-center gap-8">
                        <div className="w-48 h-48">
                            <PieChart data={groupStats} centerLabel="กลุ่มทั้งหมด" centerValue={totalProjects} />
                        </div>
                        <div className="flex-1 space-y-3">
                            {groupStats.map((item, i) => (
                                <div key={i} className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                                        <span className="text-sm text-slate-600 dark:text-slate-300">{item.name}</span>
                                    </div>
                                    <span className="font-bold text-slate-900 dark:text-white">{item.value}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Urgent Mentions */}
                <div className="bg-white dark:bg-slate-800/50 rounded-2xl p-6 border border-slate-200/60 dark:border-white/10">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white">แท็กเร่งด่วน</h3>
                        <span className="px-2 py-1 bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400 text-xs font-semibold rounded-full">
                            {(Array.isArray(urgentMentions) ? urgentMentions : []).filter(m => m?.status === 'pending').length} รอตอบ
                        </span>
                    </div>
                    <div className="space-y-3">
                        {urgentMentions.length > 0 ? urgentMentions.map((mention) => (
                            <div key={mention.id} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-700/30 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors cursor-pointer">
                                <div className="flex items-start justify-between gap-2">
                                    <p className="text-sm text-slate-700 dark:text-slate-200 line-clamp-2">{mention.message}</p>
                                    {mention.status === 'pending' ? (
                                        <XCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
                                    ) : (
                                        <CheckCircle size={16} className="text-green-500 flex-shrink-0 mt-0.5" />
                                    )}
                                </div>
                                <div className="flex items-center gap-2 mt-2 text-xs text-slate-400">
                                    <span>{mention.from}</span>
                                    <span>•</span>
                                    <span>{mention.time}</span>
                                </div>
                            </div>
                        )) : (
                            <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 p-4 text-sm text-slate-500 dark:text-slate-400">
                                ยังไม่มีงานเร่งด่วนจากข้อมูลจริงในระบบ
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Recent Meeting Summaries */}
            <div className="bg-white dark:bg-slate-800/50 rounded-2xl p-6 border border-slate-200/60 dark:border-white/10">
                <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">สรุปการประชุมล่าสุด</h3>
                    <button type="button" onClick={() => onNavigate?.('projects')} className="text-sm font-medium flex items-center gap-1" style={{ color: COLORS.primary }}>
                        ดูทั้งหมด <ChevronRight size={16} />
                    </button>
                </div>
                <div className="grid md:grid-cols-3 gap-4">
                    {recentMeetings.length > 0 ? recentMeetings.map((meeting) => (
                        <div key={meeting.id} className="p-4 rounded-xl border border-slate-200/60 dark:border-white/10 hover:border-orange-200 dark:hover:border-orange-500/30 transition-colors cursor-pointer group">
                            <div className="flex items-start justify-between mb-3">
                                <div className="w-10 h-10 rounded-lg flex items-center justify-center"
                                    style={{ backgroundColor: `${COLORS.primary}20`, color: COLORS.primary }}>
                                    <Users size={20} />
                                </div>
                                <ChevronRight size={18} className="text-slate-300 group-hover:text-orange-500 transition-colors" />
                            </div>
                            <h4 className="font-semibold text-slate-900 dark:text-white mb-1">{meeting.title}</h4>
                            <p className="text-xs text-slate-500 mb-2">{meeting.date} • {meeting.participants} คน</p>
                            <p className="text-sm text-slate-600 dark:text-slate-300 line-clamp-2">{meeting.summary}</p>
                        </div>
                    )) : (
                        <div className="md:col-span-3 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 p-5 text-sm text-slate-500 dark:text-slate-400">
                            ยังไม่มี task ประเภทสรุปประชุมจากข้อมูลจริงในระบบ
                        </div>
                    )}
                </div>
            </div>

            {/* Quick Actions */}
            <div className="bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-900/20 dark:to-amber-900/20 rounded-2xl p-6 border border-orange-200/60 dark:border-orange-500/20">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">การดำเนินการด่วน</h3>
                <div className="flex flex-wrap gap-3">
                    <button type="button" onClick={() => onNavigate?.('projects')} className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200 hover:border-orange-300 dark:hover:border-orange-500 transition-colors">
                        <Send size={16} style={{ color: COLORS.primary }} />
                        ส่งข้อความ LINE
                    </button>
                    <button type="button" onClick={() => onNavigate?.('projects')} className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200 hover:border-orange-300 dark:hover:border-orange-500 transition-colors">
                        <FolderKanban size={16} style={{ color: COLORS.primary }} />
                        จัดการโปรเจกต์
                    </button>
                    <button type="button" onClick={() => setModal('employee')} className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200 hover:border-orange-300 dark:hover:border-orange-500 transition-colors">
                        <Users size={16} style={{ color: COLORS.primary }} />
                        เพิ่มสมาชิกใหม่
                    </button>
                </div>
            </div>

            {/* Modals */}
            {modal === 'task' && <AddTaskModal onClose={() => setModal(null)} onAdd={onAddTask} employees={employees} />}
            {modal === 'employee' && <AddEmployeeModal onClose={() => setModal(null)} onAdd={onAddEmployee} positions={positions} />}
            {modal === 'position' && <AddPositionModal onClose={() => setModal(null)} onAdd={onAddPosition} />}
            {selectedTask && (
                <TaskDetailModal
                    task={selectedTask}
                    employees={employees}
                    onClose={() => setSelectedTask(null)}
                    onUpdate={(id, data) => {
                        onUpdateTask?.(id, data);
                        setSelectedTask((current) => ({ ...current, ...data }));
                    }}
                />
            )}
        </div>
    );
}
