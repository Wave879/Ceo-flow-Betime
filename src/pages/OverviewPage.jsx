import React, { useMemo, useState } from 'react';
import {
    Plus,
    Briefcase,
    AlertTriangle,
    MessageCircle,
    Users,
    FolderKanban,
    CheckCircle,
    XCircle,
    Send,
    ChevronRight,
    Sparkles,
    Clock3,
    CalendarClock
} from 'lucide-react';
import { PieChart } from '../components/Charts';
import { AddTaskModal, AddEmployeeModal, AddPositionModal } from '../components/Modals';
import TaskDetailModal from '../components/TaskDetailModal';

const COLORS = {
    primary: '#F28A1A',
    secondary: '#FF6B35',
    betimes: '#24387E',
    success: '#10b981',
    warning: '#f59e0b',
    danger: '#ef4444',
    purple: '#8b5cf6'
};

const EMPLOYEE_FALLBACK_COLORS = ['#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#8b5cf6', '#3b82f6'];
const GROUP_TYPE_VALUES = new Set(['unset', 'betimes', 'outsource', 'external']);

function normalizeGroupType(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (GROUP_TYPE_VALUES.has(normalized)) {
        return normalized;
    }

    return 'unset';
}

function getGroupTypeLabel(type = 'unset') {
    if (type === 'betimes') {
        return 'ภายใน';
    }

    if (type === 'outsource') {
        return 'Outsource';
    }

    if (type === 'external') {
        return 'ภายนอก';
    }

    return 'ยังไม่จัดประเภท';
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

function formatShortDate(value) {
    const date = toDate(value);
    if (!date) {
        return '-';
    }

    return new Intl.DateTimeFormat('th-TH', {
        day: '2-digit',
        month: 'short'
    }).format(date);
}

function getTaskStatus(task = {}) {
    return String(task?.status || '').trim().toLowerCase();
}

function getTaskName(task = {}) {
    return String(task?.title || task?.name || 'งานไม่ระบุชื่อ').trim();
}

function getTaskSourcePreview(task = {}) {
    return String(task?.sourceText || task?.description || task?.title || task?.name || '').trim();
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

function isOverdueTask(task = {}, now = new Date()) {
    const status = getTaskStatus(task);
    if (status === 'completed' || status === 'abandoned') {
        return false;
    }

    const deadline = toDate(task?.deadline);
    if (!deadline) {
        return false;
    }

    return deadline.getTime() < now.getTime();
}

function getDaysUntilDeadline(task = {}, now = new Date()) {
    const deadline = toDate(task?.deadline);
    if (!deadline) {
        return null;
    }

    const diffMs = deadline.getTime() - now.getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function getEmployeeShortName(name = '') {
    const normalized = String(name || '').trim();
    if (!normalized) {
        return 'สมาชิก';
    }

    return normalized.split(' ')[0];
}

function scoreFocusTask(task = {}, now = new Date()) {
    let score = 0;
    const status = getTaskStatus(task);

    if (status === 'in-progress') {
        score += 1;
    }

    if (isOverdueTask(task, now)) {
        score += 7;
    }

    const daysUntil = getDaysUntilDeadline(task, now);
    if (Number.isFinite(daysUntil) && daysUntil !== null && daysUntil >= 0 && daysUntil <= 2) {
        score += 4;
    }

    const source = String(task?.source || '').trim().toLowerCase();
    if (source.startsWith('line-')) {
        score += 2;
        if (!hasTaskReply(task)) {
            score += 2;
        }
    }

    const sentiment = String(task?.messageSentiment || '').trim().toLowerCase();
    if (sentiment === 'urgent') {
        score += 4;
    } else if (sentiment === 'negative') {
        score += 2;
    }

    return score;
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
    onNavigate
}) {
    const [modal, setModal] = useState(null);
    const [selectedTask, setSelectedTask] = useState(null);

    const safeTasks = Array.isArray(tasks) ? tasks : [];
    const safeEmployees = Array.isArray(employees) ? employees : [];
    const safeProjects = Array.isArray(projects) ? projects : [];

    const stats = useMemo(() => {
        const now = new Date();
        const completed = safeTasks.filter((task) => getTaskStatus(task) === 'completed').length;
        const active = safeTasks.filter((task) => getTaskStatus(task) !== 'completed').length;
        const overdue = safeTasks.filter((task) => isOverdueTask(task, now)).length;

        const unanswered = safeTasks.filter((task) => {
            const status = getTaskStatus(task);
            if (status === 'completed' || status === 'abandoned') {
                return false;
            }

            const source = String(task?.source || '').trim().toLowerCase();
            if (!source.startsWith('line-')) {
                return false;
            }

            return !hasTaskReply(task);
        }).length;

        const health = safeTasks.length > 0
            ? Math.round((completed / safeTasks.length) * 100)
            : 0;

        return {
            total: safeTasks.length,
            active,
            completed,
            overdue,
            unanswered,
            members: safeEmployees.length,
            health
        };
    }, [safeEmployees.length, safeTasks]);

    const groupStats = useMemo(() => {
        const eligibleProjects = safeProjects.filter((project) => {
            const source = String(project?.source || '').trim().toLowerCase();
            return source !== 'dm' && source !== 'room';
        });

        const betimes = eligibleProjects.filter((project) => {
            const type = normalizeGroupType(project?.groupType || project?.type || 'unset');
            return type === 'betimes' || type === 'unset';
        }).length;

        const outsource = eligibleProjects.filter((project) => {
            const type = normalizeGroupType(project?.groupType || project?.type || 'unset');
            return type === 'outsource';
        }).length;

        const external = eligibleProjects.filter((project) => {
            const type = normalizeGroupType(project?.groupType || project?.type || 'unset');
            return type === 'external';
        }).length;

        return [
            { id: 'betimes', name: 'Betimes ภายใน', value: betimes, color: COLORS.betimes },
            { id: 'outsource', name: 'Outsource', value: outsource, color: COLORS.primary },
            { id: 'external', name: 'ภายนอก', value: external, color: COLORS.secondary }
        ];
    }, [safeProjects]);

    const totalProjects = useMemo(
        () => groupStats.reduce((sum, item) => sum + Number(item?.value || 0), 0),
        [groupStats]
    );

    const urgentMentions = useMemo(() => {
        return safeTasks
            .filter((task) => {
                const status = getTaskStatus(task);
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
                task,
                message: getTaskSourcePreview(task) || getTaskName(task),
                from: String(task?.createdByName || task?.assignee || 'ไม่ระบุ').trim(),
                time: formatDateTime(task?.updatedAt || task?.createdAt),
                status: hasTaskReply(task) ? 'answered' : 'pending'
            }));
    }, [safeTasks]);

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
                task,
                title: getTaskName(task),
                date: formatDateTime(task?.createdAt || task?.updatedAt || task?.deadline),
                participants: getTaskParticipantCount(task),
                summary: getTaskSourcePreview(task) || 'ยังไม่มีรายละเอียดการประชุม'
            }));
    }, [safeTasks]);

    const focusQueue = useMemo(() => {
        const now = new Date();
        return safeTasks
            .filter((task) => {
                const status = getTaskStatus(task);
                return status !== 'completed' && status !== 'abandoned';
            })
            .map((task) => {
                const deadlineDays = getDaysUntilDeadline(task, now);
                return {
                    task,
                    focusScore: scoreFocusTask(task, now),
                    overdue: isOverdueTask(task, now),
                    deadlineDays
                };
            })
            .sort((left, right) => {
                if (right.focusScore !== left.focusScore) {
                    return right.focusScore - left.focusScore;
                }

                const leftTime = toDate(left.task?.updatedAt || left.task?.createdAt)?.getTime() || 0;
                const rightTime = toDate(right.task?.updatedAt || right.task?.createdAt)?.getTime() || 0;
                return rightTime - leftTime;
            })
            .slice(0, 6);
    }, [safeTasks]);

    const projectPulseRows = useMemo(() => {
        const projectMap = new Map();
        safeProjects.forEach((project) => {
            const id = String(project?.id || '').trim();
            if (!id) {
                return;
            }

            projectMap.set(id, {
                id,
                name: String(project?.name || `กลุ่ม ${id.slice(-5)}`).trim(),
                type: normalizeGroupType(project?.groupType || project?.type || 'unset'),
                total: 0,
                overdue: 0,
                active: 0
            });
        });

        const now = new Date();
        safeTasks.forEach((task) => {
            const projectId = String(task?.projectId || '').trim();
            if (!projectId) {
                return;
            }

            if (!projectMap.has(projectId)) {
                projectMap.set(projectId, {
                    id: projectId,
                    name: `กลุ่ม ${projectId.slice(-5)}`,
                    type: 'unset',
                    total: 0,
                    overdue: 0,
                    active: 0
                });
            }

            const row = projectMap.get(projectId);
            row.total += 1;

            const status = getTaskStatus(task);
            if (status !== 'completed' && status !== 'abandoned') {
                row.active += 1;
            }

            if (isOverdueTask(task, now)) {
                row.overdue += 1;
            }
        });

        return [...projectMap.values()]
            .filter((row) => row.total > 0)
            .sort((left, right) => {
                if (right.active !== left.active) {
                    return right.active - left.active;
                }

                if (right.overdue !== left.overdue) {
                    return right.overdue - left.overdue;
                }

                return right.total - left.total;
            })
            .slice(0, 5);
    }, [safeProjects, safeTasks]);

    const employeeLoadRows = useMemo(() => {
        const employeeMap = new Map();
        safeEmployees.forEach((employee, index) => {
            const id = String(employee?.id || '').trim();
            if (!id) {
                return;
            }

            employeeMap.set(id, {
                id,
                name: String(employee?.name || 'สมาชิก').trim(),
                color: String(employee?.color || EMPLOYEE_FALLBACK_COLORS[index % EMPLOYEE_FALLBACK_COLORS.length]).trim(),
                count: 0
            });
        });

        safeTasks.forEach((task) => {
            const status = getTaskStatus(task);
            if (status === 'completed' || status === 'abandoned') {
                return;
            }

            const assignees = Array.isArray(task?.assignees) ? task.assignees : [];
            assignees.forEach((employeeId) => {
                if (employeeMap.has(employeeId)) {
                    employeeMap.get(employeeId).count += 1;
                }
            });
        });

        return [...employeeMap.values()]
            .filter((row) => row.count > 0)
            .sort((left, right) => right.count - left.count)
            .slice(0, 6);
    }, [safeEmployees, safeTasks]);

    const maxEmployeeLoad = useMemo(() => {
        return Math.max(...employeeLoadRows.map((row) => row.count), 1);
    }, [employeeLoadRows]);

    const lineSignal = useMemo(() => {
        const lineTasks = safeTasks.filter((task) => String(task?.source || '').trim().toLowerCase().startsWith('line-'));
        const answered = lineTasks.filter((task) => hasTaskReply(task)).length;
        const pending = Math.max(0, lineTasks.length - answered);
        const urgent = lineTasks.filter((task) => {
            const sentiment = String(task?.messageSentiment || '').trim().toLowerCase();
            return sentiment === 'urgent' || sentiment === 'negative';
        }).length;

        return {
            total: lineTasks.length,
            answered,
            pending,
            urgent
        };
    }, [safeTasks]);

    const statusBlocks = useMemo(() => {
        const inProgress = safeTasks.filter((task) => getTaskStatus(task) === 'in-progress').length;
        const completed = safeTasks.filter((task) => getTaskStatus(task) === 'completed').length;
        const abandoned = safeTasks.filter((task) => getTaskStatus(task) === 'abandoned').length;

        return [
            { id: 'in-progress', label: 'กำลังดำเนิน', value: inProgress, color: '#2563eb' },
            { id: 'completed', label: 'สำเร็จ', value: completed, color: '#16a34a' },
            { id: 'abandoned', label: 'พักงาน', value: abandoned, color: '#ef4444' }
        ];
    }, [safeTasks]);

    const statCards = [
        {
            icon: <Briefcase size={20} />,
            label: 'งานที่กำลังดำเนิน',
            value: stats.active,
            detail: `${stats.completed} งานสำเร็จ`,
            color: COLORS.primary,
            bg: 'from-orange-500/20 to-amber-500/10'
        },
        {
            icon: <AlertTriangle size={20} />,
            label: 'งานเลยกำหนด',
            value: stats.overdue,
            detail: 'ต้องเร่งติดตาม',
            color: COLORS.danger,
            bg: 'from-red-500/20 to-rose-500/10'
        },
        {
            icon: <MessageCircle size={20} />,
            label: 'ข้อความรอตอบ',
            value: stats.unanswered,
            detail: `${lineSignal.answered} ตอบแล้ว`,
            color: COLORS.warning,
            bg: 'from-amber-500/20 to-yellow-500/10'
        },
        {
            icon: <Users size={20} />,
            label: 'สมาชิกในทีม',
            value: stats.members,
            detail: `สุขภาพงาน ${stats.health}%`,
            color: COLORS.betimes,
            bg: 'from-blue-600/20 to-indigo-500/10'
        }
    ];

    return (
        <div className="animate-fade-in space-y-5">
            <section className="relative overflow-hidden rounded-3xl p-5 sm:p-7 border border-slate-200/70 dark:border-white/10 bg-gradient-to-br from-[#23356f] via-[#2d448f] to-[#1a2744]">
                <div
                    className="absolute -top-20 -right-20 w-72 h-72 rounded-full opacity-25"
                    style={{ background: 'radial-gradient(circle, rgba(242,138,26,0.7), transparent 60%)' }}
                />
                <div
                    className="absolute -bottom-20 -left-16 w-64 h-64 rounded-full opacity-20"
                    style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.6), transparent 60%)' }}
                />

                <div className="relative flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5">
                    <div className="lg:max-w-[64%]">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-white/25 bg-white/10 text-white/85 text-xs font-semibold mb-3">
                            <Sparkles size={13} className="text-amber-300" />
                            Mission Control • CEO FLOW Dashboard
                        </div>
                        <h1 className="text-3xl md:text-4xl font-black text-white leading-tight tracking-tight">
                            ภาพรวมการปฏิบัติงาน
                            <span className="block text-orange-300">พร้อมสั่งการได้ทันที</span>
                        </h1>
                        <p className="mt-2 text-sm text-white/70 max-w-2xl">
                            มองภาพรวมงานสำคัญ ข้อความจาก LINE และภาระทีมในหน้าจอเดียว เพื่อช่วยตัดสินใจได้เร็วขึ้น
                        </p>

                        <div className="mt-4 flex flex-wrap gap-2.5">
                            <div className="px-3 py-1.5 rounded-xl bg-white/10 border border-white/15 text-xs text-white/85">
                                งานทั้งหมด {stats.total} รายการ
                            </div>
                            <div className="px-3 py-1.5 rounded-xl bg-white/10 border border-white/15 text-xs text-white/85">
                                กลุ่มที่ติดตาม {totalProjects} กลุ่ม
                            </div>
                            <div className="px-3 py-1.5 rounded-xl bg-white/10 border border-white/15 text-xs text-white/85">
                                สัญญาณเร่งด่วน {lineSignal.urgent} รายการ
                            </div>
                        </div>
                    </div>

                    <div className="w-full lg:w-[320px] grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-2.5">
                        <button
                            type="button"
                            onClick={() => setModal('task')}
                            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm bg-orange-400 text-[#1f2937] hover:bg-orange-300 transition-colors"
                        >
                            <Plus size={16} />
                            สร้างงานใหม่
                        </button>
                        <button
                            type="button"
                            onClick={() => onNavigate?.('projects')}
                            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm bg-white/10 text-white border border-white/20 hover:bg-white/15 transition-colors"
                        >
                            <FolderKanban size={16} />
                            เปิดหน้าโครงการ
                        </button>
                        <button
                            type="button"
                            onClick={() => setModal('employee')}
                            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm bg-white/10 text-white border border-white/20 hover:bg-white/15 transition-colors"
                        >
                            <Users size={16} />
                            เพิ่มสมาชิก
                        </button>
                    </div>
                </div>
            </section>

            <section className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                {statCards.map((stat) => (
                    <article
                        key={stat.label}
                        className="relative overflow-hidden rounded-2xl p-4 border border-slate-200/70 dark:border-white/10 bg-white dark:bg-slate-900/40"
                    >
                        <div className={`absolute inset-0 bg-gradient-to-br ${stat.bg} opacity-55`} />
                        <div className="relative flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                                <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">{stat.label}</p>
                                <div
                                    className="w-9 h-9 rounded-xl flex items-center justify-center"
                                    style={{ backgroundColor: `${stat.color}25`, color: stat.color }}
                                >
                                    {stat.icon}
                                </div>
                            </div>
                            <p className="text-3xl font-black leading-none text-slate-900 dark:text-white">{stat.value}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">{stat.detail}</p>
                        </div>
                    </article>
                ))}
            </section>

            <section className="grid xl:grid-cols-12 gap-4">
                <div className="xl:col-span-8 space-y-4">
                    <article className="rounded-2xl p-5 border border-slate-200/70 dark:border-white/10 bg-white dark:bg-slate-900/40">
                        <div className="flex items-center justify-between gap-3 mb-5">
                            <div>
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Operational Radar</h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400">สุขภาพกลุ่มและสถานะงานหลักของวันนี้</p>
                            </div>
                            <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200">
                                อัปเดตเรียลไทม์
                            </span>
                        </div>

                        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5 items-center">
                            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-3 h-[280px] bg-slate-50/70 dark:bg-slate-800/40">
                                <PieChart data={groupStats} centerLabel="กลุ่มทั้งหมด" centerValue={totalProjects} />
                            </div>

                            <div className="space-y-3">
                                <div className="grid grid-cols-3 gap-2">
                                    {statusBlocks.map((block) => (
                                        <div key={block.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-2.5 bg-white dark:bg-slate-900/45">
                                            <p className="text-[11px] text-slate-500 dark:text-slate-400">{block.label}</p>
                                            <p className="mt-1 text-xl font-bold" style={{ color: block.color }}>{block.value}</p>
                                        </div>
                                    ))}
                                </div>

                                <div className="space-y-2.5">
                                    {projectPulseRows.length > 0 ? projectPulseRows.map((row) => (
                                        <div key={row.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                                            <div className="flex items-center justify-between gap-2">
                                                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{row.name}</p>
                                                <span className="text-[11px] text-slate-500 dark:text-slate-400">{getGroupTypeLabel(row.type)}</span>
                                            </div>
                                            <div className="mt-1.5 flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                                                <span>งานทั้งหมด {row.total}</span>
                                                <span>กำลังทำ {row.active}</span>
                                                <span className="text-red-500">เลยกำหนด {row.overdue}</span>
                                            </div>
                                        </div>
                                    )) : (
                                        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-4 text-sm text-slate-500 dark:text-slate-400">
                                            ยังไม่มีข้อมูลโครงการสำหรับวิเคราะห์
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </article>

                    <article className="rounded-2xl p-5 border border-slate-200/70 dark:border-white/10 bg-white dark:bg-slate-900/40">
                        <div className="flex items-center justify-between gap-3 mb-4">
                            <div>
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Focus Queue</h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400">ลำดับงานที่ควรโฟกัสก่อนตามความเร่งด่วน</p>
                            </div>
                            <span className="text-xs text-slate-500 dark:text-slate-400">{focusQueue.length} รายการ</span>
                        </div>

                        <div className="space-y-2.5">
                            {focusQueue.length > 0 ? focusQueue.map(({ task, focusScore, overdue, deadlineDays }) => (
                                <button
                                    key={task.id}
                                    type="button"
                                    onClick={() => setSelectedTask(task)}
                                    className="w-full text-left rounded-xl border border-slate-200 dark:border-slate-700 p-3 hover:border-orange-300 dark:hover:border-orange-500/40 transition-colors"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{getTaskName(task)}</p>
                                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
                                                {getTaskSourcePreview(task) || 'ยังไม่มีรายละเอียดเพิ่มเติม'}
                                            </p>
                                        </div>
                                        <span className="px-2 py-1 rounded-lg text-[11px] font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                            Score {focusScore}
                                        </span>
                                    </div>

                                    <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px]">
                                        <span className="px-2 py-1 rounded-md bg-indigo-50 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200">
                                            {String(task?.assignee || 'ยังไม่ระบุผู้รับผิดชอบ')}
                                        </span>
                                        {overdue ? (
                                            <span className="px-2 py-1 rounded-md bg-red-50 text-red-700 dark:bg-red-500/20 dark:text-red-200">เลยกำหนดแล้ว</span>
                                        ) : (
                                            <span className="px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200">
                                                {deadlineDays === null ? 'ยังไม่ระบุ deadline' : `เหลือ ${deadlineDays} วัน`}
                                            </span>
                                        )}
                                    </div>
                                </button>
                            )) : (
                                <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-4 text-sm text-slate-500 dark:text-slate-400">
                                    ตอนนี้ไม่มีงานที่ค้างดำเนินการ
                                </div>
                            )}
                        </div>
                    </article>
                </div>

                <div className="xl:col-span-4 space-y-4">
                    <article className="rounded-2xl p-5 border border-slate-200/70 dark:border-white/10 bg-white dark:bg-slate-900/40">
                        <div className="flex items-center gap-2 mb-4">
                            <MessageCircle size={17} className="text-amber-500" />
                            <h3 className="text-base font-bold text-slate-900 dark:text-white">LINE Signal</h3>
                        </div>

                        <div className="grid grid-cols-2 gap-2.5">
                            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">ข้อความทั้งหมด</p>
                                <p className="text-2xl font-black text-slate-900 dark:text-white">{lineSignal.total}</p>
                            </div>
                            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">รอตอบ</p>
                                <p className="text-2xl font-black text-red-500">{lineSignal.pending}</p>
                            </div>
                            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">ตอบแล้ว</p>
                                <p className="text-2xl font-black text-emerald-500">{lineSignal.answered}</p>
                            </div>
                            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">สัญญาณเสี่ยง</p>
                                <p className="text-2xl font-black text-amber-500">{lineSignal.urgent}</p>
                            </div>
                        </div>

                        <div className="mt-3 space-y-2 max-h-[190px] overflow-y-auto pr-1">
                            {urgentMentions.length > 0 ? urgentMentions.map((mention) => (
                                <button
                                    key={mention.id}
                                    type="button"
                                    onClick={() => setSelectedTask(mention.task)}
                                    className="w-full text-left rounded-xl p-2.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700"
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <p className="text-xs text-slate-700 dark:text-slate-200 line-clamp-2">{mention.message}</p>
                                        {mention.status === 'pending' ? (
                                            <XCircle size={14} className="text-red-500 flex-shrink-0" />
                                        ) : (
                                            <CheckCircle size={14} className="text-emerald-500 flex-shrink-0" />
                                        )}
                                    </div>
                                    <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{mention.from} • {mention.time}</p>
                                </button>
                            )) : (
                                <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-3 text-xs text-slate-500 dark:text-slate-400">
                                    ยังไม่พบข้อความเร่งด่วน
                                </div>
                            )}
                        </div>
                    </article>

                    <article className="rounded-2xl p-5 border border-slate-200/70 dark:border-white/10 bg-white dark:bg-slate-900/40">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                <Users size={17} className="text-indigo-500" />
                                <h3 className="text-base font-bold text-slate-900 dark:text-white">Team Load</h3>
                            </div>
                            <span className="text-xs text-slate-500 dark:text-slate-400">Top {employeeLoadRows.length}</span>
                        </div>

                        <div className="space-y-3">
                            {employeeLoadRows.length > 0 ? employeeLoadRows.map((row, index) => (
                                <div key={row.id} className="space-y-1.5">
                                    <div className="flex items-center justify-between gap-2 text-xs">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className="w-5 text-right text-slate-400 font-semibold">{index + 1}</span>
                                            <span className="truncate font-semibold text-slate-700 dark:text-slate-200">{getEmployeeShortName(row.name)}</span>
                                        </div>
                                        <span className="font-bold" style={{ color: row.color }}>{row.count} งาน</span>
                                    </div>
                                    <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                        <div
                                            className="h-full rounded-full transition-all duration-700"
                                            style={{
                                                width: `${(row.count / maxEmployeeLoad) * 100}%`,
                                                background: `linear-gradient(90deg, ${row.color}, ${row.color}cc)`
                                            }}
                                        />
                                    </div>
                                </div>
                            )) : (
                                <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-3 text-xs text-slate-500 dark:text-slate-400">
                                    ยังไม่มีข้อมูลภาระงานทีม
                                </div>
                            )}
                        </div>
                    </article>

                    <article className="rounded-2xl p-5 border border-slate-200/70 dark:border-white/10 bg-white dark:bg-slate-900/40">
                        <h3 className="text-base font-bold text-slate-900 dark:text-white mb-3">Quick Launch</h3>
                        <div className="space-y-2.5">
                            <button
                                type="button"
                                onClick={() => onNavigate?.('projects')}
                                className="w-full flex items-center justify-between gap-2 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:border-orange-300 dark:hover:border-orange-500/40 transition-colors"
                            >
                                <span className="flex items-center gap-2"><Send size={15} style={{ color: COLORS.primary }} /> ส่งข้อความในโครงการ</span>
                                <ChevronRight size={15} />
                            </button>
                            <button
                                type="button"
                                onClick={() => setModal('position')}
                                className="w-full flex items-center justify-between gap-2 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:border-orange-300 dark:hover:border-orange-500/40 transition-colors"
                            >
                                <span className="flex items-center gap-2"><Briefcase size={15} style={{ color: COLORS.primary }} /> เพิ่มตำแหน่งงาน</span>
                                <ChevronRight size={15} />
                            </button>
                            <button
                                type="button"
                                onClick={() => setModal('employee')}
                                className="w-full flex items-center justify-between gap-2 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:border-orange-300 dark:hover:border-orange-500/40 transition-colors"
                            >
                                <span className="flex items-center gap-2"><Users size={15} style={{ color: COLORS.primary }} /> จัดการสมาชิกทีม</span>
                                <ChevronRight size={15} />
                            </button>
                        </div>
                    </article>
                </div>
            </section>

            <section className="rounded-2xl p-5 border border-slate-200/70 dark:border-white/10 bg-white dark:bg-slate-900/40">
                <div className="flex items-center justify-between gap-3 mb-4">
                    <div>
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white">Meeting & Decision Feed</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">สรุปการประชุมล่าสุดที่บันทึกเข้าสู่ระบบ</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => onNavigate?.('projects')}
                        className="text-sm font-medium flex items-center gap-1"
                        style={{ color: COLORS.primary }}
                    >
                        เปิดทั้งหมด <ChevronRight size={16} />
                    </button>
                </div>

                <div className="grid md:grid-cols-3 gap-3">
                    {recentMeetings.length > 0 ? recentMeetings.map((meeting) => (
                        <button
                            key={meeting.id}
                            type="button"
                            onClick={() => setSelectedTask(meeting.task)}
                            className="text-left rounded-xl border border-slate-200 dark:border-slate-700 p-3 hover:border-orange-300 dark:hover:border-orange-500/40 transition-colors bg-slate-50/60 dark:bg-slate-900/35"
                        >
                            <div className="flex items-center justify-between gap-2 mb-2">
                                <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                                    style={{ backgroundColor: `${COLORS.primary}20`, color: COLORS.primary }}>
                                    <CalendarClock size={16} />
                                </div>
                                <span className="text-[11px] text-slate-500 dark:text-slate-400">{meeting.participants} คน</span>
                            </div>

                            <p className="text-sm font-semibold text-slate-900 dark:text-white line-clamp-2">{meeting.title}</p>
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{meeting.date}</p>
                            <p className="mt-2 text-xs text-slate-600 dark:text-slate-300 line-clamp-2">{meeting.summary}</p>
                        </button>
                    )) : (
                        <div className="md:col-span-3 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-4 text-sm text-slate-500 dark:text-slate-400">
                            ยังไม่มี task ประเภทสรุปประชุมจากข้อมูลจริงในระบบ
                        </div>
                    )}
                </div>
            </section>

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
