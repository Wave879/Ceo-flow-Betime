import React, { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Avatar, formatDate } from './UI';

const DAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const MONTHS_TH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

export default function CalendarSidebar({ tasks, employees }) {
    const today = new Date();
    const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
    const [selectedDate, setSelectedDate] = useState(today.toISOString().slice(0, 10));

    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Map deadlines -> { dateStr: [employee colors] }
    const deadlineMap = useMemo(() => {
        const map = {};
        tasks.forEach(task => {
            if (!task.deadline) return;
            const key = task.deadline.slice(0, 10);
            if (!map[key]) map[key] = [];
            task.assignees?.forEach(eid => {
                const emp = employees.find(e => e.id === eid);
                if (emp && !map[key].includes(emp.color)) map[key].push(emp.color);
            });
        });
        return map;
    }, [tasks, employees]);

    // Tasks due on selected date
    const selectedTasks = useMemo(() => {
        return tasks.filter(t => t.deadline?.slice(0, 10) === selectedDate);
    }, [tasks, selectedDate]);

    const prevMonth = () => setViewDate(new Date(year, month - 1, 1));
    const nextMonth = () => setViewDate(new Date(year, month + 1, 1));

    const todayStr = today.toISOString().slice(0, 10);

    return (
        <div className="flex flex-col h-full">
            {/* Calendar Header */}
            <div className="flex items-center justify-between mb-4">
                <button onClick={prevMonth} className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors">
                    <ChevronLeft size={16} />
                </button>
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {MONTHS_TH[month]} {year + 543}
                </span>
                <button onClick={nextMonth} className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors">
                    <ChevronRight size={16} />
                </button>
            </div>

            {/* Day Headers */}
            <div className="grid grid-cols-7 gap-0 mb-1">
                {DAYS.map(d => (
                    <div key={d} className="text-center text-[10px] font-bold text-slate-400 dark:text-slate-500 py-1">{d}</div>
                ))}
            </div>

            {/* Days Grid */}
            <div className="grid grid-cols-7 gap-0.5">
                {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                    const day = i + 1;
                    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const isToday = dateStr === todayStr;
                    const isSelected = dateStr === selectedDate;
                    const dots = deadlineMap[dateStr] || [];

                    return (
                        <button
                            key={day}
                            onClick={() => setSelectedDate(dateStr)}
                            className={`relative flex flex-col items-center justify-center rounded-xl py-1 border transition-all duration-150
                ${isSelected ? 'bg-indigo-600 dark:bg-indigo-500 shadow-md' : isToday ? 'bg-indigo-50 dark:bg-indigo-500/10' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}
              `}
                            style={{
                                minHeight: 36,
                                borderColor: isSelected
                                    ? 'rgba(99,102,241,0.55)'
                                    : isToday
                                        ? 'rgba(99,102,241,0.22)'
                                        : 'rgba(148,163,184,0.18)'
                            }}
                        >
                            <span className={`text-xs font-semibold ${isSelected ? 'text-white' : isToday ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-600 dark:text-slate-300'}`}>
                                {day}
                            </span>
                            {dots.length > 0 && (
                                <div className="flex gap-0.5 mt-0.5">
                                    {dots.slice(0, 3).map((color, ci) => (
                                        <div
                                            key={ci}
                                            className="w-1.5 h-1.5 rounded-full"
                                            style={{ background: isSelected ? 'white' : color }}
                                        />
                                    ))}
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Selected Date Tasks */}
            <div className="mt-4 flex-1 min-h-0">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wide">
                    งาน • {new Date(selectedDate).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}
                </p>
                {selectedTasks.length === 0 ? (
                    <div className="text-center py-6">
                        <p className="text-xs text-slate-400 dark:text-slate-500">ไม่มีงานในวันนี้</p>
                    </div>
                ) : (
                    <div className="space-y-2 overflow-y-auto custom-scroll max-h-52 pr-1">
                        {selectedTasks.map(task => {
                            const emp = employees.find(e => e.id === task.assignees?.[0]);
                            return (
                                <div
                                    key={task.id}
                                    className="flex items-start gap-2 p-2.5 rounded-2xl bg-white dark:bg-slate-800/40 border border-slate-200 dark:border-white/[0.10] hover:border-indigo-300 dark:hover:border-indigo-500/30 transition-colors shadow-[inset_0_1px_0_0_rgba(255,255,255,0.6)] dark:shadow-none"
                                >
                                    {emp && <Avatar name={emp.name} color={emp.color} size={28} />}
                                    <div className="min-w-0 flex-1">
                                        <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">{task.name}</p>
                                        <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                                            ผู้รับผิดชอบ: {task.assignees?.length} คน
                                        </p>
                                    </div>
                                    <div
                                        className="w-2 h-2 rounded-full mt-1 flex-shrink-0"
                                        style={{ background: task.status === 'completed' ? '#10b981' : task.status === 'abandoned' ? '#64748b' : '#6366f1' }}
                                    />
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
