import React, { useMemo } from 'react';
import { Briefcase, AlertTriangle, MessageCircle, Users } from 'lucide-react';

const COLORS = {
    primary: '#F28A1A',
    betimes: '#24387E',
    warning: '#f59e0b',
    danger: '#ef4444'
};

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

export default function OverviewPage({ tasks = [], employees = [] }) {
    const safeTasks = Array.isArray(tasks) ? tasks : [];
    const safeEmployees = Array.isArray(employees) ? employees : [];

    const stats = useMemo(() => {
        const now = new Date();

        const active = safeTasks.filter((task) => String(task?.status || '').trim().toLowerCase() !== 'completed').length;

        const overdue = safeTasks.filter((task) => {
            const status = String(task?.status || '').trim().toLowerCase();
            if (status === 'completed') {
                return false;
            }

            const rawDeadline = String(task?.deadline || '').trim();
            if (!rawDeadline) {
                return false;
            }

            const deadlineDate = new Date(rawDeadline);
            if (Number.isNaN(deadlineDate.getTime())) {
                return false;
            }

            return deadlineDate < now;
        }).length;

        const unanswered = safeTasks.filter((task) => {
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
            active,
            overdue,
            unanswered,
            members: safeEmployees.length
        };
    }, [safeEmployees.length, safeTasks]);

    const statCards = [
        {
            icon: <Briefcase size={22} />,
            label: 'งานที่กำลังดำเนิน',
            value: stats.active,
            color: COLORS.primary,
            bg: 'from-orange-500/20 to-amber-500/10'
        },
        {
            icon: <AlertTriangle size={22} />,
            label: 'งานเลยกำหนด',
            value: stats.overdue,
            color: COLORS.danger,
            bg: 'from-red-500/20 to-rose-500/10'
        },
        {
            icon: <MessageCircle size={22} />,
            label: 'คำถามยังไม่ตอบ',
            value: stats.unanswered,
            color: COLORS.warning,
            bg: 'from-amber-500/20 to-yellow-500/10'
        },
        {
            icon: <Users size={22} />,
            label: 'สมาชิกในทีม',
            value: stats.members,
            color: COLORS.betimes,
            bg: 'from-blue-600/20 to-indigo-500/10'
        }
    ];

    return (
        <div className="animate-fade-in space-y-4">
            <section className="relative overflow-hidden rounded-2xl p-4 sm:p-5 md:p-6 min-h-[190px] border border-slate-200/80 dark:border-white/10 bg-gradient-to-br from-[#e9efff] via-[#dfe8ff] to-[#d4e1ff] dark:from-[#24387E] dark:to-[#1a2744]">
                <div
                    className="absolute -top-16 -right-14 w-56 h-56 rounded-full opacity-25 dark:opacity-10"
                    style={{ background: 'radial-gradient(circle, #F28A1A, transparent)' }}
                />
                <div
                    className="absolute -bottom-16 -left-10 w-44 h-44 rounded-full opacity-18 dark:opacity-10"
                    style={{ background: 'radial-gradient(circle, #FF6B35, transparent)' }}
                />

                <div className="relative flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4 xl:gap-6">
                    <div className="xl:max-w-[60%]">
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[11px] font-semibold mb-2 bg-white/65 text-slate-700 border-slate-300/80 dark:bg-white/10 dark:text-white/80 dark:border-white/20">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            ระบบออนไลน์ • CEO FLOW
                        </div>
                        <h1 className="text-[2rem] md:text-[2.25rem] font-black mb-1 tracking-tight leading-tight text-slate-900 dark:text-white">
                            ภาพรวม<span style={{ color: COLORS.primary }}> CEO FLOW</span>
                        </h1>
                        <p className="text-xs sm:text-sm max-w-lg text-slate-600 dark:text-white/60">
                            ระบบจัดการงานและติดตาม LINE Group สำหรับผู้บริหาร
                        </p>
                    </div>

                    <div className="xl:w-[290px]">
                        <div className="grid grid-cols-2 gap-2">
                            {statCards.map((stat, index) => (
                                <div
                                    key={`${stat.label}-${index}`}
                                    className="relative overflow-hidden rounded-xl p-3 min-h-[112px] border border-slate-300/70 bg-white/75 dark:border-white/10 dark:bg-slate-900/30"
                                >
                                    <div className={`absolute inset-0 bg-gradient-to-br ${stat.bg} opacity-25 dark:opacity-30`} />

                                    <div className="relative h-full flex flex-col">
                                        <p className="text-[11px] font-semibold line-clamp-1 text-slate-600 dark:text-white/75">{stat.label}</p>

                                        <div className="mt-auto flex items-end justify-between gap-2">
                                            <p className="text-[3rem] font-black leading-[0.85] text-slate-900 dark:text-white">{stat.value}</p>
                                            <div
                                                className="w-14 h-14 rounded-2xl flex items-center justify-center"
                                                style={{ backgroundColor: `${stat.color}20`, color: stat.color }}
                                            >
                                                {stat.icon}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}
