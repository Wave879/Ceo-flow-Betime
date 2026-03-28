import React, { useMemo, useState, useCallback } from 'react';
import {
    Plus, Users, UserPlus, Briefcase, CheckCircle2, TrendingUp,
    ChevronLeft, ChevronRight, FolderKanban, Calendar, Sparkles,
    AlertTriangle, Clock, Shield, MapPin, Phone, User,
    Activity, Pause, Send, ArrowRight, Flame, MessageSquare
} from 'lucide-react';
import { AddTaskModal, AddEmployeeModal, AddPositionModal } from '../components/Modals';
import TaskDetailModal from '../components/TaskDetailModal';

/* ═══════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════ */
function toDate(v) {
    if (!v) return null;
    if (typeof v?.toDate === 'function') return v.toDate();
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
}
const status = (t = {}) => String(t?.status || '').trim().toLowerCase();
const taskName = (t = {}) => String(t?.title || t?.name || 'งานไม่ระบุชื่อ').trim();

const CHART_COLORS = ['#22c55e', '#f59e0b', '#6366f1', '#ec4899', '#14b8a6', '#f43f5e', '#8b5cf6', '#06b6d4', '#f97316', '#3b82f6'];
const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const TH_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/* ═══════════════════════════════════════════
   DONUT CHART — สัดส่วนสถานะงาน (Pure SVG)
   ═══════════════════════════════════════════ */
function StatusDonutChart({ segments, total }) {
    const R = 70, cx = 100, cy = 100, C = 2 * Math.PI * R;
    let acc = 0;
    return (
        <div className="flex flex-col items-center">
            <svg viewBox="0 0 200 200" className="w-full max-w-[200px] mx-auto">
                <circle cx={cx} cy={cy} r={R} fill="none" strokeWidth="24"
                    className="stroke-slate-100 dark:stroke-white/[0.06]" />
                {segments.map((s, i) => {
                    const pct = total > 0 ? s.value / total : 0;
                    const len = pct * C;
                    const off = -acc * C + C * 0.25;
                    acc += pct;
                    return <circle key={i} cx={cx} cy={cy} r={R} fill="none"
                        stroke={s.color} strokeWidth="24" strokeLinecap="butt"
                        strokeDasharray={`${len} ${C - len}`} strokeDashoffset={off}
                        className="transition-all duration-700 ease-out" />;
                })}
                <text x={cx} y={cy - 4} textAnchor="middle" fontSize="10"
                    className="fill-slate-400 dark:fill-white/40" fontWeight="500">งานทั้งหมด</text>
                <text x={cx} y={cy + 22} textAnchor="middle" fontSize="32" fontWeight="900"
                    className="fill-slate-800 dark:fill-white">{total}</text>
            </svg>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 justify-center mt-3">
                {segments.map((s, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: s.color }} />
                        <span className="text-xs font-semibold text-slate-600 dark:text-white/65">{s.label}</span>
                        <span className="text-xs font-bold tabular-nums" style={{ color: s.color }}>
                            {s.value}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════
   HORIZONTAL BAR CHART — ประสิทธิภาพทีม
   ═══════════════════════════════════════════ */
function TeamBarChart({ employees, tasks }) {
    const data = useMemo(() => {
        return employees.map((e, i) => ({
            name: e.name?.split(' ')[0] || 'ไม่ระบุ',
            initial: (e.name || '?')[0].toUpperCase(),
            count: tasks.filter(t => Array.isArray(t.assignees) && t.assignees.includes(e.id)).length,
            completed: tasks.filter(t => Array.isArray(t.assignees) && t.assignees.includes(e.id) && status(t) === 'completed').length,
            color: e.color || CHART_COLORS[i % CHART_COLORS.length],
            photoUrl: e.photoUrl,
        })).sort((a, b) => b.count - a.count);
    }, [employees, tasks]);

    const max = Math.max(...data.map(d => d.count), 1);

    if (data.length === 0) return (
        <div className="flex flex-col items-center justify-center py-10 text-slate-400 dark:text-white/30">
            <Users size={28} className="mb-2 opacity-50" />
            <p className="text-sm">ยังไม่มีสมาชิก</p>
        </div>
    );

    return (
        <div className="space-y-3">
            {data.map((d, i) => (
                <div key={i} className="flex items-center gap-3 group">
                    <span className="text-xs font-bold text-slate-400 dark:text-white/30 w-4 text-right tabular-nums">{i + 1}</span>
                    {d.photoUrl ? (
                        <img src={d.photoUrl} alt={d.name} className="w-7 h-7 rounded-lg object-cover flex-shrink-0" />
                    ) : (
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0"
                            style={{ background: d.color }}>{d.initial}</div>
                    )}
                    <span className="text-sm font-semibold text-slate-700 dark:text-white/85 w-16 truncate">{d.name}</span>
                    <div className="flex-1 h-3 bg-slate-100 dark:bg-white/[0.06] rounded-full overflow-hidden relative">
                        <div className="h-full rounded-full progress-fill absolute left-0 top-0 opacity-30"
                            style={{ width: `${(d.count / max) * 100}%`, background: d.color }} />
                        <div className="h-full rounded-full progress-fill absolute left-0 top-0"
                            style={{ width: `${(d.completed / max) * 100}%`, background: d.color }} />
                    </div>
                    <span className="text-xs font-bold min-w-[40px] text-right tabular-nums" style={{ color: d.color }}>
                        {d.completed}/{d.count}
                    </span>
                </div>
            ))}
        </div>
    );
}

/* ═══════════════════════════════════════════
   SPARKLINE — แนวโน้มย้อนหลัง 4 สัปดาห์
   ═══════════════════════════════════════════ */
function WeeklySparkline({ tasks }) {
    const weekData = useMemo(() => {
        const now = new Date();
        const weeks = [];
        for (let w = 3; w >= 0; w--) {
            const weekStart = new Date(now);
            weekStart.setDate(now.getDate() - (w * 7 + now.getDay()));
            weekStart.setHours(0, 0, 0, 0);
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekEnd.getDate() + 6);
            weekEnd.setHours(23, 59, 59, 999);

            const completed = tasks.filter(t => {
                if (status(t) !== 'completed') return false;
                const d = toDate(t.completedAt || t.updatedAt);
                if (!d) return false;
                return d >= weekStart && d <= weekEnd;
            }).length;

            const created = tasks.filter(t => {
                const d = toDate(t.createdAt);
                if (!d) return false;
                return d >= weekStart && d <= weekEnd;
            }).length;

            weeks.push({ completed, created, label: `W${4 - w}` });
        }
        return weeks;
    }, [tasks]);

    const maxVal = Math.max(...weekData.map(w => Math.max(w.completed, w.created)), 1);
    const W = 200, H = 60, pad = 10;
    const stepX = (W - pad * 2) / (weekData.length - 1 || 1);

    const makePath = (key) => {
        const points = weekData.map((w, i) => {
            const x = pad + i * stepX;
            const y = H - pad - ((w[key] / maxVal) * (H - pad * 2));
            return `${x},${y}`;
        });
        return `M${points.join(' L')}`;
    };

    const makeArea = (key) => {
        const points = weekData.map((w, i) => {
            const x = pad + i * stepX;
            const y = H - pad - ((w[key] / maxVal) * (H - pad * 2));
            return `${x},${y}`;
        });
        return `M${pad},${H - pad} L${points.join(' L')} L${pad + (weekData.length - 1) * stepX},${H - pad} Z`;
    };

    return (
        <div>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 80 }}>
                <defs>
                    <linearGradient id="sparkGradCreated" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                    </linearGradient>
                    <linearGradient id="sparkGradCompleted" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#22c55e" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
                    </linearGradient>
                </defs>
                {/* Grid lines */}
                {[0.25, 0.5, 0.75].map(p => (
                    <line key={p} x1={pad} x2={W - pad} y1={H - pad - p * (H - pad * 2)} y2={H - pad - p * (H - pad * 2)}
                        stroke="currentColor" strokeWidth="0.5" className="text-slate-200 dark:text-white/[0.06]" />
                ))}
                {/* Areas */}
                <path d={makeArea('created')} fill="url(#sparkGradCreated)" />
                <path d={makeArea('completed')} fill="url(#sparkGradCompleted)" />
                {/* Lines */}
                <path d={makePath('created')} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d={makePath('completed')} fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                {/* Dots */}
                {weekData.map((w, i) => (
                    <React.Fragment key={i}>
                        <circle cx={pad + i * stepX} cy={H - pad - ((w.created / maxVal) * (H - pad * 2))}
                            r="3" fill="#3b82f6" />
                        <circle cx={pad + i * stepX} cy={H - pad - ((w.completed / maxVal) * (H - pad * 2))}
                            r="3" fill="#22c55e" />
                    </React.Fragment>
                ))}
            </svg>
            <div className="flex items-center justify-between mt-1 px-1">
                {weekData.map((w, i) => (
                    <span key={i} className="text-[10px] font-semibold text-slate-400 dark:text-white/35">{w.label}</span>
                ))}
            </div>
            <div className="flex items-center gap-4 justify-center mt-2">
                <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                    <span className="text-xs text-slate-500 dark:text-white/50">สร้างใหม่</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                    <span className="text-xs text-slate-500 dark:text-white/50">สำเร็จ</span>
                </div>
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════
   MINI CALENDAR
   ═══════════════════════════════════════════ */
function MiniCalendar({ tasks }) {
    const [offset, setOffset] = useState(0);
    const today = new Date();
    const viewDate = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startDay = new Date(year, month, 1).getDay();

    const cells = [];
    for (let i = 0; i < startDay; i++) cells.push(null);
    for (let i = 1; i <= daysInMonth; i++) cells.push(i);

    const deadlineMap = useMemo(() => {
        const map = {};
        tasks.forEach(t => {
            const dl = toDate(t.deadline);
            if (!dl || status(t) === 'completed') return;
            if (dl.getFullYear() !== year || dl.getMonth() !== month) return;
            const d = dl.getDate();
            map[d] = (map[d] || 0) + 1;
        });
        return map;
    }, [tasks, year, month]);

    return (
        <div>
            <div className="flex items-center justify-between mb-3">
                <button onClick={() => setOffset(o => o - 1)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-white/[0.06] text-slate-400 dark:text-white/40 transition-colors">
                    <ChevronLeft size={16} />
                </button>
                <span className="text-sm font-bold text-slate-700 dark:text-white">
                    {TH_MONTHS[month]} {year + 543}
                </span>
                <button onClick={() => setOffset(o => o + 1)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-white/[0.06] text-slate-400 dark:text-white/40 transition-colors">
                    <ChevronRight size={16} />
                </button>
            </div>

            <div className="grid grid-cols-7 gap-0.5 mb-1">
                {['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'].map(d => (
                    <div key={d} className="text-center text-xs font-bold text-slate-400 dark:text-white/35 py-1">{d}</div>
                ))}
            </div>

            <div className="grid grid-cols-7 gap-0.5">
                {cells.map((day, i) => {
                    const isToday = isCurrentMonth && day === today.getDate();
                    const dots = deadlineMap[day] || 0;
                    return (
                        <div key={i} className={`aspect-square flex flex-col items-center justify-center rounded-lg text-xs font-semibold transition-all
                            ${!day ? '' :
                                isToday ? 'bg-orange-500 text-white shadow-md shadow-orange-500/30' :
                                    dots > 0 ? 'text-slate-700 dark:text-white/80 bg-orange-50 dark:bg-orange-500/10' :
                                        'text-slate-600 dark:text-white/65 hover:bg-slate-50 dark:hover:bg-white/[0.04]'}`}>
                            {day}
                            {dots > 0 && (
                                <div className="flex gap-0.5 mt-0.5">
                                    {Array.from({ length: Math.min(dots, 3) }).map((_, di) => (
                                        <span key={di} className={`w-1 h-1 rounded-full ${isToday ? 'bg-white/80' : 'bg-orange-400 dark:bg-orange-500'}`} />
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="mt-3 pt-3 border-t border-slate-100 dark:border-white/[0.06]">
                <p className="text-xs font-bold text-slate-500 dark:text-white/40">
                    งาน • {today.getDate()} {TH_MONTHS_SHORT[today.getMonth()]}
                </p>
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════
   URGENCY HELPERS
   ═══════════════════════════════════════════ */
function getUrgency(task) {
    const dl = toDate(task.deadline);
    if (!dl) return null;
    const now = new Date();
    const diff = (dl - now) / (1000 * 60 * 60 * 24);
    if (diff < 0) return { label: 'เลยกำหนด', color: '#ef4444', bg: 'bg-red-50 dark:bg-red-500/10', textColor: 'text-red-600 dark:text-red-400', icon: Flame };
    if (diff <= 3) return { label: 'วิกฤต', color: '#f97316', bg: 'bg-orange-50 dark:bg-orange-500/10', textColor: 'text-orange-600 dark:text-orange-400', icon: AlertTriangle };
    if (diff <= 7) return { label: 'เร่งด่วน', color: '#eab308', bg: 'bg-yellow-50 dark:bg-yellow-500/10', textColor: 'text-yellow-600 dark:text-yellow-400', icon: Clock };
    return null;
}

function getStatusInfo(s) {
    switch (s) {
        case 'completed': return { label: 'สำเร็จ', dot: 'bg-green-500', pill: 'bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-400' };
        case 'in-progress': return { label: 'กำลังดำเนินการ', dot: 'bg-amber-500 animate-pulse', pill: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' };
        case 'abandoned': return { label: 'พักงาน', dot: 'bg-slate-400', pill: 'bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-400' };
        default: return { label: 'รับงาน', dot: 'bg-blue-500', pill: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400' };
    }
}

/* ═══════════════════════════════════════════
   OVERVIEW PAGE — Main export
   ═══════════════════════════════════════════ */
export default function OverviewPage({
    tasks = [], employees = [], positions = [], projects = [],
    onAddTask, onUpdateTask, onDeleteTask, onAddEmployee, onDeleteEmployee,
    onAddPosition, onDeletePosition, onNavigate, isLocal = false
}) {
    const [modal, setModal] = useState(null);
    const [selectedTask, setSelectedTask] = useState(null);

    const safeTasks = Array.isArray(tasks) ? tasks : [];
    const safeEmployees = Array.isArray(employees) ? employees : [];

    /* ── Stats ── */
    const stats = useMemo(() => {
        const total = safeTasks.length;
        const completed = safeTasks.filter(t => status(t) === 'completed').length;
        const inProgress = safeTasks.filter(t => status(t) === 'in-progress').length;
        const newTasks = safeTasks.filter(t => !status(t) || status(t) === 'pending' || status(t) === 'new').length;
        const abandoned = safeTasks.filter(t => status(t) === 'abandoned').length;

        // Critical = overdue or deadline within 3 days
        const now = new Date();
        const critical = safeTasks.filter(t => {
            if (status(t) === 'completed') return false;
            const dl = toDate(t.deadline);
            if (!dl) return false;
            return (dl - now) / (1000 * 60 * 60 * 24) <= 3;
        }).length;

        return { total, completed, inProgress, newTasks, abandoned, critical };
    }, [safeTasks]);

    /* ── Donut segments ── */
    const donutSegments = useMemo(() => {
        const segments = [];
        if (stats.inProgress > 0) segments.push({ label: 'กำลังทำ', value: stats.inProgress, color: '#f59e0b' });
        if (stats.completed > 0) segments.push({ label: 'สำเร็จ', value: stats.completed, color: '#22c55e' });
        if (stats.newTasks > 0) segments.push({ label: 'รับงาน', value: stats.newTasks, color: '#3b82f6' });
        if (stats.abandoned > 0) segments.push({ label: 'พักงาน', value: stats.abandoned, color: '#94a3b8' });
        if (stats.critical > 0) segments.push({ label: 'วิกฤต', value: stats.critical, color: '#ef4444' });
        return segments;
    }, [stats]);

    /* ── Replied & All tasks ── */
    const repliedTasks = useMemo(() => {
        return safeTasks
            .filter(t => t.replyAnswerAt)
            .sort((a, b) => {
                const ta = toDate(a.replyAnswerAt) || 0;
                const tb = toDate(b.replyAnswerAt) || 0;
                return tb - ta;
            })
            .slice(0, 5);
    }, [safeTasks]);

    const allActiveTasks = useMemo(() => {
        return [...safeTasks]
            .sort((a, b) => (toDate(a.deadline) || 0) - (toDate(b.deadline) || 0));
    }, [safeTasks]);

    const handleDeleteTask = useCallback((id) => { onDeleteTask?.(id); setSelectedTask(null); }, [onDeleteTask]);

    /* ── Status percentages ── */
    const statusCards = useMemo(() => {
        const t = safeTasks.length || 1;
        return [
            { label: 'รับงาน', count: stats.newTasks, pct: Math.round((stats.newTasks / t) * 100), dot: 'bg-blue-500', color: 'text-blue-600 dark:text-blue-400' },
            { label: 'กำลังดำเนินการ', count: stats.inProgress, pct: Math.round((stats.inProgress / t) * 100), dot: 'bg-amber-500', color: 'text-amber-600 dark:text-amber-400' },
            { label: 'สำเร็จ', count: stats.completed, pct: Math.round((stats.completed / t) * 100), dot: 'bg-green-500', color: 'text-green-600 dark:text-green-400' },
            { label: 'พักงาน', count: stats.abandoned, pct: Math.round((stats.abandoned / t) * 100), dot: 'bg-slate-400', color: 'text-slate-500 dark:text-slate-400' },
        ];
    }, [stats, safeTasks.length]);

    return (
        <div className="space-y-5 animate-fade-in">

            {/* ══════════ HERO BANNER ══════════ */}
            <section className="hero-banner rounded-3xl p-6 sm:p-8 relative overflow-hidden">
                {/* Gradient orbs */}
                <div className="absolute -top-20 -left-20 w-60 h-60 bg-orange-500/20 rounded-full blur-3xl pointer-events-none" />
                <div className="absolute -bottom-20 -right-20 w-60 h-60 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

                <div className="relative z-10 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                    {/* Left: Logo + Title */}
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
                            style={{ background: 'linear-gradient(135deg, #F28A1A, #FF6B35)', boxShadow: '0 8px 24px -4px rgba(242,138,26,0.4)' }}>
                            <Shield size={28} className="text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl sm:text-3xl font-black text-white leading-tight">
                                CEO <span className="text-transparent bg-clip-text" style={{ backgroundImage: 'linear-gradient(135deg, #F28A1A, #FFD700)' }}>FLOW</span>
                            </h1>
                            <p className="text-sm text-white/60 mt-0.5">ระบบจัดการทีมและโปรเจกต์แบบครบวงจร</p>
                        </div>
                    </div>

                    {/* Right: Info card */}
                    <div className="hero-info-card rounded-2xl px-5 py-3 flex flex-col gap-1.5">
                        <div className="flex items-center gap-2 text-sm">
                            <MapPin size={14} className="text-orange-400 flex-shrink-0" />
                            <span className="text-white/80">ข้อมูลองค์กร</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                            <Users size={14} className="text-orange-400 flex-shrink-0" />
                            <span className="text-white/70">{safeEmployees.length} สมาชิกในทีม</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                            <FolderKanban size={14} className="text-orange-400 flex-shrink-0" />
                            <span className="text-white/70">{safeTasks.length} งานทั้งหมด</span>
                        </div>
                    </div>
                </div>

                {/* Subtitle */}
                <p className="relative z-10 text-xs sm:text-sm text-white/50 mt-4">
                    ระบบจัดการอัจฉริยะ: ติดตามสถานะโปรเจกต์ มอบหมายงาน วิเคราะห์ข้อมูลอย่างเป็นระบบ
                </p>

                {/* Action buttons */}
                <div className="relative z-10 flex items-center gap-2 flex-wrap mt-4">
                    <button onClick={() => setModal('task')}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all duration-300 hover:-translate-y-0.5 shadow-lg"
                        style={{ background: 'linear-gradient(135deg, #F28A1A, #FF6B35)', boxShadow: '0 6px 20px -4px rgba(242,138,26,0.4)' }}>
                        <Plus size={16} /> สร้างโปรเจกต์
                    </button>
                    <button onClick={() => setModal('employee')}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white/70 hover:text-white border border-white/15 hover:border-white/30 hover:bg-white/5 transition-all">
                        <UserPlus size={15} /> เพิ่มสมาชิก
                    </button>
                    <button onClick={() => setModal('position')}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white/70 hover:text-white border border-white/15 hover:border-white/30 hover:bg-white/5 transition-all">
                        <Briefcase size={15} /> เพิ่มตำแหน่ง
                    </button>
                </div>
            </section>

            {/* ══════════ SUMMARY STAT CARDS ══════════ */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                {[
                    { label: 'งานทั้งหมด', value: stats.total, icon: FolderKanban, gradient: 'linear-gradient(135deg, #1e3a5f, #2563eb)', shadow: 'rgba(37,99,235,0.3)' },
                    { label: 'กำลังดำเนินการ', value: stats.inProgress, icon: Activity, gradient: 'linear-gradient(135deg, #065f46, #059669)', shadow: 'rgba(5,150,105,0.3)' },
                    { label: 'งานวิกฤต', value: stats.critical, icon: AlertTriangle, gradient: 'linear-gradient(135deg, #7c2d12, #ea580c)', shadow: 'rgba(234,88,12,0.3)' },
                    { label: 'สำเร็จแล้ว', value: stats.completed, icon: CheckCircle2, gradient: 'linear-gradient(135deg, #312e81, #6366f1)', shadow: 'rgba(99,102,241,0.3)' },
                ].map((card, i) => {
                    const Icon = card.icon;
                    return (
                        <div key={i}
                            className="summary-card rounded-2xl p-5 relative overflow-hidden transition-all duration-300 hover:-translate-y-1 group cursor-default"
                            style={{ background: card.gradient, boxShadow: `0 8px 24px -6px ${card.shadow}` }}>
                            <div className="absolute top-0 right-0 w-20 h-20 bg-white/5 rounded-full -mr-6 -mt-6 group-hover:scale-125 transition-transform duration-500" />
                            <p className="text-sm text-white/70 font-medium mb-1">{card.label}</p>
                            <div className="flex items-end gap-3">
                                <span className="text-4xl font-black text-white tabular-nums leading-none">{card.value}</span>
                                <Icon size={22} className="text-white/40 mb-1" />
                            </div>
                        </div>
                    );
                })}
            </div>


            {/* ══════════ CALENDAR + DEADLINE/CRITICAL ══════════ */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                {/* Calendar */}
                <div className="card p-6 lg:col-span-4">
                    <div className="flex items-center gap-2 mb-4">
                        <Calendar size={18} className="text-purple-500" />
                        <h2 className="text-lg font-bold text-slate-800 dark:text-white">ปฏิทิน Deadline</h2>
                    </div>
                    <MiniCalendar tasks={safeTasks} />
                </div>

                {/* Deadline + Critical tasks */}
                <div className="lg:col-span-8 space-y-5">
                    {/* Replied tasks */}
                    <div className="card p-6">
                        <div className="flex items-center gap-2 mb-4">
                            <MessageSquare size={18} className="text-green-500" />
                            <h2 className="text-lg font-bold text-slate-800 dark:text-white">งานที่ได้รับคำตอบแล้ว ({repliedTasks.length} งาน)</h2>
                        </div>
                        {repliedTasks.length > 0 ? (
                            <div className="space-y-2.5">
                                {repliedTasks.map(t => {
                                    const replyDate = toDate(t.replyAnswerAt);
                                    const replyText = t.replyAnswerText || t.lastUpdate || '';
                                    return (
                                        <button key={t.id} onClick={() => setSelectedTask(t)}
                                            className="w-full flex items-center gap-3 p-3 rounded-xl border border-slate-100 dark:border-white/[0.06] hover:border-green-200 dark:hover:border-green-500/20 hover:bg-green-50/50 dark:hover:bg-green-500/5 transition-all text-left group/replied">
                                            <div className="w-10 h-10 rounded-xl bg-green-50 dark:bg-green-500/10 flex items-center justify-center flex-shrink-0">
                                                <MessageSquare size={18} className="text-green-500" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-semibold text-slate-700 dark:text-white/85 truncate">{taskName(t)}</p>
                                                <p className="text-xs text-slate-400 dark:text-white/40 mt-0.5 truncate">
                                                    {replyText ? replyText.slice(0, 60) : 'ได้รับคำตอบแล้ว'}
                                                </p>
                                                <p className="text-xs text-green-400 dark:text-green-400/70 mt-0.5">
                                                    {replyDate?.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                                </p>
                                            </div>
                                            {/* Assignee avatars */}
                                            <div className="flex -space-x-1.5">
                                                {(t.assignees || []).slice(0, 3).map((aId, ai) => {
                                                    const emp = safeEmployees.find(e => e.id === aId);
                                                    if (!emp) return null;
                                                    return emp.photoUrl ? (
                                                        <img key={ai} src={emp.photoUrl} alt="" className="w-6 h-6 rounded-full border-2 border-white dark:border-[#0a0a0a] object-cover" />
                                                    ) : (
                                                        <div key={ai} className="w-6 h-6 rounded-full border-2 border-white dark:border-[#0a0a0a] flex items-center justify-center text-[9px] font-bold text-white"
                                                            style={{ background: emp.color || '#6366f1' }}>
                                                            {(emp.name || '?')[0]}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        ) : (
                            <p className="text-sm text-slate-400 dark:text-white/30 text-center py-6">ยังไม่มีงานที่ได้รับคำตอบ 💬</p>
                        )}
                    </div>

                    {/* All tasks */}
                    <div className="card p-6">
                        <div className="flex items-center gap-2 mb-4">
                            <Flame size={18} className="text-blue-500" />
                            <h2 className="text-lg font-bold text-slate-800 dark:text-white">งานทั้งหมด ({allActiveTasks.length} งาน)</h2>
                        </div>
                        {allActiveTasks.length > 0 ? (
                            <div className="space-y-2.5">
                                {allActiveTasks.map(t => {
                                    const dl = toDate(t.deadline);
                                    const si = getStatusInfo(status(t));
                                    return (
                                        <button key={t.id} onClick={() => setSelectedTask(t)}
                                            className="w-full flex items-center gap-3 p-3 rounded-xl border border-slate-100 dark:border-white/[0.06] hover:border-blue-200 dark:hover:border-blue-500/20 hover:bg-blue-50/50 dark:hover:bg-blue-500/5 transition-all text-left">
                                            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                                                <Flame size={18} className="text-blue-500" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-0.5">
                                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${si.pill}`}>
                                                        ● {si.label}
                                                    </span>
                                                </div>
                                                <p className="text-sm font-bold text-slate-800 dark:text-white/90 truncate">{taskName(t)}</p>
                                                <p className="text-xs text-slate-400 dark:text-white/35 mt-0.5">
                                                    📅 {dl?.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) || 'ไม่มีกำหนด'}
                                                </p>
                                            </div>
                                            {/* Assignee avatars */}
                                            <div className="flex -space-x-1.5">
                                                {(t.assignees || []).slice(0, 3).map((aId, ai) => {
                                                    const emp = safeEmployees.find(e => e.id === aId);
                                                    if (!emp) return null;
                                                    return emp.photoUrl ? (
                                                        <img key={ai} src={emp.photoUrl} alt="" className="w-7 h-7 rounded-full border-2 border-white dark:border-[#0a0a0a] object-cover" />
                                                    ) : (
                                                        <div key={ai} className="w-7 h-7 rounded-full border-2 border-white dark:border-[#0a0a0a] flex items-center justify-center text-[10px] font-bold text-white"
                                                            style={{ background: emp.color || '#6366f1' }}>
                                                            {(emp.name || '?')[0]}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        ) : (
                            <p className="text-sm text-slate-400 dark:text-white/30 text-center py-6">ยังไม่มีงาน 📋</p>
                        )}
                    </div>
                </div>
            </div>

            {/* ══════════ MODALS ══════════ */}
            {modal === 'task' && <AddTaskModal onClose={() => setModal(null)} onAdd={onAddTask} employees={safeEmployees} />}
            {modal === 'employee' && <AddEmployeeModal onClose={() => setModal(null)} onAdd={onAddEmployee} positions={positions} />}
            {modal === 'position' && <AddPositionModal onClose={() => setModal(null)} onAdd={onAddPosition} />}
            {selectedTask && (
                <TaskDetailModal task={selectedTask} employees={safeEmployees}
                    onClose={() => setSelectedTask(null)}
                    onDelete={handleDeleteTask}
                    onUpdate={(id, data) => { onUpdateTask?.(id, data); setSelectedTask(c => ({ ...c, ...data })); }} />
            )}
        </div>
    );
}