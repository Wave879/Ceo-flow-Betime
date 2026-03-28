import React, { useMemo, useState } from 'react';
import {
    Plus, Briefcase, AlertTriangle, MessageCircle, Users, FolderKanban,
    CheckCircle, XCircle, TrendingUp, Clock, Zap, Activity, ChevronRight, Trash2
} from 'lucide-react';
import { AddTaskModal, AddEmployeeModal, AddPositionModal } from '../components/Modals';
import TaskDetailModal from '../components/TaskDetailModal';

const COLORS = { primary: '#F28A1A', secondary: '#FF6B35', success: '#10b981', warning: '#f59e0b', danger: '#ef4444' };
const EMPLOYEE_FALLBACK_COLORS = ['#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#8b5cf6', '#3b82f6'];

function toDate(value) {
    if (!value) return null;
    if (typeof value?.toDate === 'function') return value.toDate();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value) {
    const date = toDate(value);
    if (!date) return '-';
    return new Intl.DateTimeFormat('th-TH', { month: 'short', day: '2-digit' }).format(date);
}

function getTaskStatus(task = {}) {
    return String(task?.status || '').trim().toLowerCase();
}

function getTaskName(task = {}) {
    return String(task?.title || task?.name || 'งานไม่ระบุชื่อ').trim();
}

function getTaskSourcePreview(task = {}) {
    return String(task?.sourceText || task?.description || task?.title || '').trim();
}

function hasTaskReply(task = {}) {
    if (String(task?.replyAnswerText || '').trim()) return true;
    const timelineEntries = Array.isArray(task?.timelineEntries) ? task.timelineEntries : [];
    return timelineEntries.some((entry = {}) => String(entry?.replyLineMessageId || '').trim());
}

function isOverdueTask(task = {}, now = new Date()) {
    const status = getTaskStatus(task);
    if (status === 'completed' || status === 'abandoned') return false;
    const deadline = toDate(task?.deadline);
    if (!deadline) return false;
    return deadline.getTime() < now.getTime();
}

function getDaysUntilDeadline(task = {}, now = new Date()) {
    const deadline = toDate(task?.deadline);
    if (!deadline) return null;
    const diffMs = deadline.getTime() - now.getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

// Hero KPI Card
function HeroKPICard({ label, value, subtext, bgColor, icon: Icon }) {
    return (
        <div className="rounded-2xl border border-white/[0.08] p-6 bg-white/[0.02] hover:bg-white/[0.04] transition-all">
            <div className="flex items-start justify-between mb-4">
                <div>
                    <p className="text-sm text-white/60 mb-2">{label}</p>
                    <p className="text-4xl font-bold text-white">{value}</p>
                </div>
                <div className="p-3 rounded-xl" style={{ background: `${bgColor}20`, color: bgColor }}>
                    <Icon size={24} />
                </div>
            </div>
            {subtext && <p className="text-xs text-white/40">{subtext}</p>}
        </div>
    );
}

// Urgent Task Item
function UrgentTaskItem({ task, employees, onSelect }) {
    const daysUntil = getDaysUntilDeadline(task);
    const isOverdue = isOverdueTask(task);
    const assignees = (Array.isArray(task?.assignees) ? task.assignees : [])
        .map(id => employees?.find(e => e.id === id))
        .filter(Boolean);

    return (
        <div onClick={() => onSelect(task)}
            className="p-4 rounded-xl border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.15] transition-all cursor-pointer">
            <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-sm text-white truncate">{getTaskName(task)}</h4>
                    <p className="text-xs text-white/50 line-clamp-1 mt-1">{getTaskSourcePreview(task)}</p>
                </div>
                {isOverdue && <div className="flex-shrink-0 px-2 py-1 bg-red-500/20 text-red-400 text-xs font-bold rounded">Overdue</div>}
            </div>
            <div className="flex items-center justify-between">
                <div className="flex -space-x-1.5">
                    {assignees.slice(0, 2).map((emp, i) => (
                        <div key={i} className="w-6 h-6 rounded-full text-white text-xs flex items-center justify-center font-bold"
                            style={{ background: emp?.color || '#6b7280' }}>
                            {emp?.name?.charAt(0) || '?'}
                        </div>
                    ))}
                </div>
                <span className={`text-xs font-bold ${isOverdue ? 'text-red-400' : 'text-yellow-400'}`}>
                    {isOverdue ? '❌ Overdue' : `⏰ ${daysUntil || '?'} วัน`}
                </span>
            </div>
        </div>
    );
}

// Team Member Card
function TeamMemberCard({ employee, tasks }) {
    const empTasks = tasks.filter(t => 
        Array.isArray(t.assignees) && t.assignees.includes(employee.id) && 
        getTaskStatus(t) !== 'completed'
    );
    const overdue = empTasks.filter(t => isOverdueTask(t)).length;

    return (
        <div className="p-4 rounded-xl border border-white/[0.08] bg-white/[0.02]">
            <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white"
                    style={{ background: employee.color || '#6b7280' }}>
                    {employee.name?.charAt(0) || '?'}
                </div>
                <div>
                    <p className="font-semibold text-sm text-white">{employee.name}</p>
                    <p className="text-xs text-white/50">{empTasks.length} งาน</p>
                </div>
            </div>
            {overdue > 0 && <p className="text-xs text-red-400 font-bold">🔴 {overdue} เสี่ยง</p>}
        </div>
    );
}

// Mock Data เพื่อแสดง Demo
const MOCK_DATA = {
    tasks: [
        { id: '1', title: 'ปรับปรุง Dashboard UI', description: 'ออกแบบหน้า Overview ใหม่', status: 'in-progress', assignees: ['emp1', 'emp2'], deadline: new Date(Date.now() + 2*24*60*60*1000), source: 'web', createdAt: new Date(Date.now() - 3*24*60*60*1000) },
        { id: '2', title: 'ตรวจสอบ LINE Integration', description: 'ทดสอบ Webhook และ Message', status: 'in-progress', assignees: ['emp2'], deadline: new Date(Date.now() - 1*24*60*60*1000), source: 'line-meeting', createdAt: new Date(Date.now() - 5*24*60*60*1000) },
        { id: '3', title: 'ส่งรายงานสัปดาห์', description: 'Weekly status report', status: 'in-progress', assignees: ['emp1'], deadline: new Date(Date.now() + 1*24*60*60*1000), source: 'web', createdAt: new Date(Date.now() - 2*24*60*60*1000) },
        { id: '4', title: 'ประชุมทีมพัฒนา', description: 'Sprint planning meeting', status: 'in-progress', assignees: ['emp3', 'emp4'], deadline: new Date(Date.now() + 3*24*60*60*1000), source: 'line-meeting', createdAt: new Date(Date.now() - 1*24*60*60*1000) },
        { id: '5', title: 'ตรวจเช็ก Deploy ระบบ', description: 'QA และตรวจสอบ Production', status: 'completed', assignees: ['emp1'], deadline: new Date(Date.now() - 2*24*60*60*1000), source: 'web', createdAt: new Date(Date.now() - 7*24*60*60*1000) },
    ],
    employees: [
        { id: 'emp1', name: 'สมชาย ศรีวัฒน์', color: '#6366f1', position: 'Project Manager' },
        { id: 'emp2', name: 'กิติยา พงษ์วัฒน์', color: '#ec4899', position: 'Developer' },
        { id: 'emp3', name: 'นกสวรรค์ แก้วมี', color: '#14b8a6', position: 'QA Engineer' },
        { id: 'emp4', name: 'ชัยศักดิ์ ไทยแท้', color: '#f59e0b', position: 'Designer' },
    ]
};

export default function OverviewPage({
    tasks = [], employees = [], positions = [], projects = [],
    onAddTask, onUpdateTask, onDeleteTask, onAddEmployee, onDeleteEmployee,
    onAddPosition, onDeletePosition, onNavigate
}) {
    const [modal, setModal] = useState(null);
    const [selectedTask, setSelectedTask] = useState(null);
    // ใช้ Mock Data ถ้าไม่มีข้อมูลจริง
    const safeTasks = (Array.isArray(tasks) && tasks.length > 0) ? tasks : MOCK_DATA.tasks;
    const safeEmployees = (Array.isArray(employees) && employees.length > 0) ? employees : MOCK_DATA.employees;

    const stats = useMemo(() => {
        const now = new Date();
        const completed = safeTasks.filter(t => getTaskStatus(t) === 'completed').length;
        const active = safeTasks.filter(t => getTaskStatus(t) !== 'completed').length;
        const overdue = safeTasks.filter(t => isOverdueTask(t, now)).length;
        const unanswered = safeTasks.filter(t => {
            const status = getTaskStatus(t);
            if (status === 'completed' || status === 'abandoned') return false;
            const source = String(t?.source || '').trim().toLowerCase();
            return source.startsWith('line-') && !hasTaskReply(t);
        }).length;
        const health = safeTasks.length > 0 ? Math.round((completed / safeTasks.length) * 100) : 0;
        return { total: safeTasks.length, active, completed, overdue, unanswered, health };
    }, [safeTasks]);

    const urgentTasks = useMemo(() => {
        const now = new Date();
        return safeTasks
            .filter(t => getTaskStatus(t) !== 'completed' && getTaskStatus(t) !== 'abandoned')
            .filter(t => isOverdueTask(t, now) || getDaysUntilDeadline(t, now) <= 2 || !hasTaskReply(t))
            .sort((a, b) => {
                const aScore = isOverdueTask(a, now) ? 10 : (getDaysUntilDeadline(a, now) || 999);
                const bScore = isOverdueTask(b, now) ? 10 : (getDaysUntilDeadline(b, now) || 999);
                return aScore - bScore;
            })
            .slice(0, 5);
    }, [safeTasks]);

    const topTeam = useMemo(() => {
        const map = new Map();
        safeTasks.forEach(task => {
            const assignees = Array.isArray(task?.assignees) ? task.assignees : [];
            assignees.forEach(empId => {
                const emp = safeEmployees.find(e => e.id === empId);
                if (emp && getTaskStatus(task) !== 'completed') {
                    if (!map.has(empId)) map.set(empId, { count: 0, emp });
                    map.get(empId).count += 1;
                }
            });
        });
        return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 4).map(m => m.emp);
    }, [safeTasks, safeEmployees]);

    const handleDeleteTask = (id) => {
        onDeleteTask?.(id);
        setSelectedTask(null);
    };

    const isUsingMockData = (Array.isArray(tasks) && tasks.length === 0) || tasks.length === 0;

    return (
        <div className="space-y-6">
            {/* === DEMO BADGE === */}
            {isUsingMockData && (
                <div className="max-w-md mx-auto px-4 py-2 rounded-full bg-blue-500/20 border border-blue-400/50 text-center text-sm text-blue-300 font-medium">
                    📊 Demo Data - นี่คือตัวอย่างข้อมูล เมื่อมีการสร้างงาน/ทีมจริง ข้อมูลจะอัปเดต
                </div>
            )}

            {/* === HERO SECTION === */}
            <section className="relative overflow-hidden rounded-3xl p-8 border border-white/[0.08] bg-gradient-to-br from-slate-900 via-slate-900/95 to-slate-900">
                <div className="absolute inset-0">
                    <div className="absolute top-0 right-0 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl" />
                    <div className="absolute bottom-0 left-0 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />
                </div>

                <div className="relative">
                    <div className="mb-8">
                        <p className="text-xs font-bold text-orange-400 mb-2">CEO COMMAND DECK</p>
                        <h1 className="text-5xl font-black text-white mb-2">ภาพรวมงานวันนี้</h1>
                        <p className="text-lg text-white/60">ตัดสินใจและสั่งการในหน้าเดียว</p>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                        <HeroKPICard label="งานทั้งหมด" value={stats.total} subtext={`${stats.completed} เสร็จแล้ว`} bgColor="#F28A1A" icon={Briefcase} />
                        <HeroKPICard label="งานที่กำลังทำ" value={stats.active} subtext="Active tasks" bgColor="#3b82f6" icon={CheckCircle} />
                        <HeroKPICard label="เสี่ยง" value={stats.overdue} subtext="Overdue tasks" bgColor="#ef4444" icon={AlertTriangle} />
                        <HeroKPICard label="ยังไม่ตอบ" value={stats.unanswered} subtext="LINE replies" bgColor="#f59e0b" icon={MessageCircle} />
                        <HeroKPICard label="Health Score" value={`${stats.health}%`} subtext="Completion rate" bgColor="#10b981" icon={TrendingUp} />
                    </div>

                    <div className="flex gap-3 flex-wrap">
                        <button onClick={() => setModal('task')} className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-lg transition-colors">
                            <Plus size={18} /> สร้างงาน
                        </button>
                        <button onClick={() => onNavigate?.('projects')} className="flex items-center gap-2 px-4 py-2 bg-white/[0.1] hover:bg-white/[0.15] text-white border border-white/[0.2] font-semibold rounded-lg transition-colors">
                            <FolderKanban size={18} /> เปิดโครงการ
                        </button>
                        <button onClick={() => setModal('employee')} className="flex items-center gap-2 px-4 py-2 bg-white/[0.1] hover:bg-white/[0.15] text-white border border-white/[0.2] font-semibold rounded-lg transition-colors">
                            <Users size={18} /> จัดการทีม
                        </button>
                    </div>
                </div>
            </section>

            {/* === URGENT TASKS SECTION === */}
            <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
                <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                    <Zap size={20} className="text-yellow-400" /> งานเสี่ยง & ต้องติดตาม
                </h2>
                {urgentTasks.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {urgentTasks.map(task => (
                            <UrgentTaskItem key={task.id} task={task} employees={safeEmployees} onSelect={setSelectedTask} />
                        ))}
                    </div>
                ) : (
                    <p className="text-center py-8 text-white/50">ไม่มีงานเสี่ยง ✨</p>
                )}
            </section>

            {/* === TEAM STATUS SECTION === */}
            <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
                <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                    <Users size={20} className="text-blue-400" /> สถานะทีม
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                    {topTeam.length > 0 ? (
                        topTeam.map(emp => (
                            <TeamMemberCard key={emp.id} employee={emp} tasks={safeTasks} />
                        ))
                    ) : (
                        <p className="text-white/50">ยังไม่มีข้อมูลทีม</p>
                    )}
                </div>
            </section>

            {/* === RECENT ACTIVITY SECTION === */}
            <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
                <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                    <Activity size={20} className="text-green-400" /> กิจกรรมล่าสุด
                </h2>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                    {safeTasks
                        .sort((a, b) => toDate(b?.updatedAt || b?.createdAt)?.getTime() - toDate(a?.updatedAt || a?.createdAt)?.getTime())
                        .slice(0, 8)
                        .map(task => (
                            <button key={task.id} onClick={() => setSelectedTask(task)}
                                className="w-full text-left p-3 rounded-lg hover:bg-white/[0.05] transition-colors flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-white truncate">{getTaskName(task)}</p>
                                    <p className="text-xs text-white/50">{formatDate(task?.deadline)}</p>
                                </div>
                                <span className={`text-xs font-bold flex-shrink-0 px-2 py-1 rounded ${
                                    getTaskStatus(task) === 'completed' ? 'bg-green-500/20 text-green-400' :
                                    getTaskStatus(task) === 'abandoned' ? 'bg-gray-500/20 text-gray-400' :
                                    'bg-blue-500/20 text-blue-400'
                                }`}>
                                    {getTaskStatus(task)}
                                </span>
                            </button>
                        ))}
                </div>
            </section>

            {/* === MODALS === */}
            {modal === 'task' && <AddTaskModal onClose={() => setModal(null)} onAdd={onAddTask} employees={safeEmployees} />}
            {modal === 'employee' && <AddEmployeeModal onClose={() => setModal(null)} onAdd={onAddEmployee} positions={positions} />}
            {modal === 'position' && <AddPositionModal onClose={() => setModal(null)} onAdd={onAddPosition} />}
            {selectedTask && (
                <TaskDetailModal
                    task={selectedTask}
                    employees={safeEmployees}
                    onClose={() => setSelectedTask(null)}
                    onDelete={handleDeleteTask}
                    onUpdate={(id, data) => {
                        onUpdateTask?.(id, data);
                        setSelectedTask(current => ({ ...current, ...data }));
                    }}
                />
            )}
        </div>
    );
}