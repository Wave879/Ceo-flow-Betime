import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Briefcase, Calendar, Camera, ChevronRight, DollarSign, Edit2, Trash2 } from 'lucide-react';
import { Avatar, StatusBadge, formatCurrency, formatDate } from '../components/UI';
import TaskDetailModal from '../components/TaskDetailModal';
import { EditEmployeeModal } from '../components/Modals';

function FolderCard({ task, assignees, onClick }) {
    const [hovered, setHovered] = useState(false);
    const mainColor = task.status === 'abandoned' ? '#64748b' : (assignees[0]?.color || '#6366f1');

    return (
        <div
            className="relative cursor-pointer group transition-all duration-300"
            style={{ marginTop: 12 }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onClick={onClick}
        >
            <div
                className="absolute left-0 rounded-t-xl transition-all duration-300"
                style={{
                    top: -10,
                    width: '42%',
                    height: 12,
                    background: hovered ? mainColor : `${mainColor}cc`,
                    borderRadius: '8px 8px 0 0',
                }}
            />
            <div
                className={`relative rounded-tl-none rounded-tr-2xl rounded-b-3xl border p-6 transition-all duration-300 overflow-hidden ${hovered ? 'bg-white dark:bg-[#111113]' : 'bg-slate-50 dark:bg-white/[0.02]'}`}
                style={{
                    borderColor: hovered ? mainColor : (task.status === 'abandoned' ? '#64748b' : undefined),
                    transform: hovered ? 'translateY(-4px)' : 'translateY(0)',
                    boxShadow: hovered
                        ? `0 20px 40px -10px ${mainColor}40, 0 0 0 1px ${mainColor} inset`
                        : task.status === 'abandoned'
                            ? '0 4px 12px -4px rgba(100,116,139,0.18)'
                            : '0 4px 12px -4px rgba(0,0,0,0.05)',
                }}
            >
                <div className={`absolute inset-0 border dark:border-white/5 pointer-events-none rounded-tl-none rounded-tr-2xl rounded-b-3xl transition-opacity ${hovered ? 'opacity-0' : 'opacity-100'}`} />
                <div className="absolute top-0 right-0 w-1.5 h-full rounded-r-3xl" style={{ background: mainColor, opacity: 0.35 }} />

                <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                            <span
                                className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-lg"
                                style={{ background: `${mainColor}20`, color: mainColor }}
                            >
                                {task.type === 'team' ? 'ทีม' : 'เดี่ยว'}
                            </span>
                            <StatusBadge status={task.status} />
                        </div>
                        <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm leading-tight transition-colors">{task.name}</h3>
                    </div>
                    <ChevronRight size={16} className="text-slate-400 dark:text-slate-500 flex-shrink-0 mt-1 group-hover:translate-x-0.5 transition-all" />
                </div>

                <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 leading-relaxed line-clamp-2 transition-colors">{task.description}</p>

                <div className="flex items-center gap-2 mb-4">
                    <div className="flex -space-x-1.5">
                        {assignees.slice(0, 5).map((employee) => (
                            <div key={employee.id} title={employee.name}>
                                <Avatar name={employee.name} color={employee.color} size={24} url={employee.avatar} />
                            </div>
                        ))}
                    </div>
                    {assignees.length > 0 && (
                        <span className="text-xs text-slate-500 dark:text-slate-400">{assignees.map((employee) => employee.name.split(' ')[0]).join(', ')}</span>
                    )}
                </div>

                <div className="flex items-center gap-4 pt-3 border-t border-slate-100 dark:border-slate-800/60 transition-colors">
                    <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                        <Calendar size={11} />
                        <span>{formatDate(task.deadline)}</span>
                    </div>
                    <div className="flex items-center gap-1 text-xs font-bold" style={{ color: mainColor }}>
                        <DollarSign size={11} />
                        <span>{formatCurrency(task.value)}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function PortfolioPage({ tasks, employees, positions, onDeleteEmployee, onUpdateEmployee, onUpdateTask }) {
    const [selectedEmpId, setSelectedEmpId] = useState(employees[0]?.id || null);
    const [filter, setFilter] = useState('all');
    const [selectedTask, setSelectedTask] = useState(null);
    const [avatarUploading, setAvatarUploading] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const avatarInputRef = useRef(null);

    useEffect(() => {
        if (!employees.length) {
            setSelectedEmpId(null);
            return;
        }
        if (!selectedEmpId || !employees.some((employee) => employee.id === selectedEmpId)) {
            setSelectedEmpId(employees[0].id);
        }
    }, [employees, selectedEmpId]);

    const selectedEmp = useMemo(() => employees.find((employee) => employee.id === selectedEmpId), [employees, selectedEmpId]);
    const empPosition = useMemo(() => positions.find((position) => position.id === selectedEmp?.position), [positions, selectedEmp]);

    const empTasks = useMemo(() => {
        let list = tasks.filter((task) => task.assignees?.includes(selectedEmpId));
        if (filter !== 'all') {
            list = list.filter((task) => task.status === filter);
        }
        return list;
    }, [tasks, selectedEmpId, filter]);

    const grouped = useMemo(() => {
        // Guard against undefined or non-array values
        if (!Array.isArray(positions) || !Array.isArray(employees)) {
            return [];
        }
        const map = {};
        positions.forEach((position) => {
            map[position.id] = { position, emps: [] };
        });
        employees.forEach((employee) => {
            if (map[employee.position]) {
                map[employee.position].emps.push(employee);
                return;
            }
            if (!map._other) {
                map._other = { position: { id: '_other', name: 'Other' }, emps: [] };
            }
            map._other.emps.push(employee);
        });
        return Object.values(map).filter((group) => group.emps.length > 0);
    }, [employees, positions]);

    const empStats = useMemo(() => {
        const all = tasks.filter((task) => task.assignees?.includes(selectedEmpId));
        return {
            total: all.length,
            completed: all.filter((task) => task.status === 'completed').length,
            inProgress: all.filter((task) => task.status === 'in-progress').length,
            abandoned: all.filter((task) => task.status === 'abandoned').length,
        };
    }, [tasks, selectedEmpId]);

    const handleAvatarChange = (event) => {
        const file = event.target.files?.[0];
        if (!file || !selectedEmpId) return;

        setAvatarUploading(true);
        const reader = new FileReader();
        reader.onload = (loadEvent) => {
            onUpdateEmployee?.(selectedEmpId, { avatar: loadEvent.target.result });
            setAvatarUploading(false);
        };
        reader.readAsDataURL(file);
        event.target.value = '';
    };

    return (
        <div className="flex flex-col xl:flex-row xl:h-[calc(100vh-100px)] animate-fade-in gap-4 xl:gap-0">
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

            {isEditModalOpen && selectedEmp && (
                <EditEmployeeModal
                    employee={selectedEmp}
                    positions={positions}
                    onClose={() => setIsEditModalOpen(false)}
                    onUpdate={onUpdateEmployee}
                />
            )}

            <div className="w-full xl:w-64 xl:flex-shrink-0 bg-white/80 dark:bg-white/[0.02] backdrop-blur-3xl rounded-3xl border border-slate-200/50 dark:border-white/[0.05] shadow-2xl xl:mr-6 flex flex-col overflow-hidden transition-colors">
                <div className="p-4 sm:p-6 border-b border-slate-100 dark:border-white/[0.05] transition-colors">
                    <h2 className="font-extrabold text-slate-800 dark:text-white transition-colors text-base tracking-tight">Team Members</h2>
                    <p className="text-xs font-medium text-slate-400 dark:text-slate-500 mt-1 transition-colors">เลือกพนักงานเพื่อดู Portfolio</p>
                </div>
                <div className="max-h-72 xl:max-h-none xl:flex-1 overflow-y-auto custom-scroll p-3">
                    {grouped.map(({ position, emps }) => (
                        <div key={position.id} className="mb-4">
                            <div className="px-2 mb-2">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{position.name}</p>
                            </div>
                            {emps.map((employee) => {
                                const isSelected = employee.id === selectedEmpId;
                                return (
                                    <div key={employee.id} className="flex items-center gap-1 mb-1 group/emp">
                                        <button
                                            onClick={() => setSelectedEmpId(employee.id)}
                                            className={`flex-1 flex items-center gap-3 px-3 py-2.5 rounded-2xl text-left transition-all duration-200 ${isSelected ? 'bg-slate-50 dark:bg-white/10 shadow-sm' : 'hover:bg-slate-50 dark:hover:bg-white/5'}`}
                                            style={isSelected ? { borderLeft: `3px solid ${employee.color}` } : { borderLeft: '3px solid transparent' }}
                                        >
                                            <Avatar name={employee.name} color={employee.color} size={32} url={employee.avatar} />
                                            <div className="min-w-0">
                                                <div className={`text-sm font-semibold truncate transition-colors ${isSelected ? 'text-slate-900 dark:text-white' : 'text-slate-700 dark:text-slate-300'}`}>
                                                    {employee.name.split(' ')[0]}
                                                </div>
                                                <div className="text-[10px] text-slate-400 dark:text-slate-500 truncate transition-colors">{employee.name.split(' ')[1] || ''}</div>
                                            </div>
                                        </button>
                                        <button
                                            onClick={() => {
                                                if (window.confirm(`ต้องการลบ "${employee.name}" ออกจากทีม?`)) {
                                                    if (selectedEmpId === employee.id) {
                                                        setSelectedEmpId(employees.find((item) => item.id !== employee.id)?.id || null);
                                                    }
                                                    onDeleteEmployee?.(employee.id);
                                                }
                                            }}
                                            className="p-1.5 rounded-xl bg-red-50 dark:bg-red-500/10 text-red-500 hover:bg-red-100 dark:hover:bg-red-500/20 hover:text-red-700 dark:hover:text-red-400 transition-all flex-shrink-0 border border-red-100 dark:border-transparent opacity-100 md:opacity-0 group-hover/emp:opacity-100 cursor-pointer"
                                            title="ลบพนักงาน"
                                        >
                                            <Trash2 size={13} />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                    {employees.length === 0 && (
                        <p className="text-center text-slate-400 dark:text-slate-500 text-xs py-8">ยังไม่มีสมาชิก</p>
                    )}
                </div>
            </div>

            <div className="flex-1 min-w-0 flex flex-col overflow-visible xl:overflow-hidden">
                {selectedEmp ? (
                    <>
                        <div
                            className="rounded-3xl p-4 sm:p-8 mb-5 sm:mb-8 flex-shrink-0 relative overflow-hidden"
                            style={{ background: `linear-gradient(135deg, ${selectedEmp.color}15, transparent)`, border: `1px solid ${selectedEmp.color}30` }}
                        >
                            <div className="absolute top-0 right-0 w-64 h-64 rounded-full blur-3xl opacity-20 pointer-events-none" style={{ background: selectedEmp.color, transform: 'translate(30%, -30%)' }} />
                            <div className="flex flex-col lg:flex-row lg:items-start gap-5">
                                <div className="relative flex-shrink-0 group/avatar">
                                    <Avatar name={selectedEmp.name} color={selectedEmp.color} size={72} url={selectedEmp.avatar} />
                                    <button
                                        onClick={() => avatarInputRef.current?.click()}
                                        className="absolute inset-0 rounded-full flex items-center justify-center bg-black/40 opacity-0 group-hover/avatar:opacity-100 transition-opacity duration-200"
                                        title="เปลี่ยนรูปโปรไฟล์"
                                    >
                                        {avatarUploading
                                            ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                            : <Camera size={20} className="text-white" />}
                                    </button>
                                    <input
                                        ref={avatarInputRef}
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={handleAvatarChange}
                                    />
                                </div>
                                <div className="flex-1 min-w-0 pr-0 lg:pr-4">
                                    <div className="flex items-center gap-3">
                                        <h1 className="text-2xl font-black text-slate-900 dark:text-white truncate transition-colors">{selectedEmp.name}</h1>
                                        <button
                                            onClick={() => setIsEditModalOpen(true)}
                                            className="p-2 rounded-xl bg-slate-100 dark:bg-white/5 hover:bg-white dark:hover:bg-white/10 text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-white transition-all border border-transparent hover:border-indigo-100 dark:hover:border-white/10 shadow-sm dark:shadow-none"
                                            title="แก้ไขข้อมูลพนักงาน"
                                        >
                                            <Edit2 size={16} />
                                        </button>
                                    </div>
                                    <div className="flex items-center gap-2 mt-1 mb-2">
                                        <Briefcase size={13} style={{ color: selectedEmp.color }} />
                                        <span className="text-sm font-semibold" style={{ color: selectedEmp.color }}>{empPosition?.name || 'ไม่ระบุตำแหน่ง'}</span>
                                    </div>
                                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed max-w-lg transition-colors">{selectedEmp.bio || 'ยังไม่มีข้อมูลประวัติ'}</p>
                                </div>
                                <div className="grid grid-cols-4 gap-2 sm:gap-3 flex-shrink-0 w-full lg:w-auto">
                                    {[
                                        { label: 'งานทั้งหมด', value: empStats.total },
                                        { label: 'สำเร็จ', value: empStats.completed },
                                        { label: 'กำลังทำ', value: empStats.inProgress },
                                        { label: 'ละทิ้ง', value: empStats.abandoned },
                                    ].map((stat) => (
                                        <div key={stat.label} className="text-center bg-white/80 dark:bg-white/5 backdrop-blur-md rounded-2xl p-4 min-w-[80px] border border-slate-200 dark:border-white/10 shadow-sm dark:shadow-none transition-colors">
                                            <div className="text-2xl font-black text-slate-900 dark:text-white transition-colors">{stat.value}</div>
                                            <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 transition-colors uppercase tracking-wider mt-1">{stat.label}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 mb-4 sm:mb-6 flex-shrink-0">
                            <span className="text-sm font-semibold text-slate-600 dark:text-slate-400 mr-2 transition-colors">กรองสถานะ:</span>
                            {[
                                { key: 'all', label: 'ทั้งหมด' },
                                { key: 'completed', label: '✓ สำเร็จแล้ว' },
                                { key: 'in-progress', label: '⟳ กำลังทำ' },
                                { key: 'abandoned', label: '⊘ ละทิ้ง' },
                            ].map((item) => (
                                <button
                                    key={item.key}
                                    onClick={() => setFilter(item.key)}
                                    className={`px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all duration-300 ${filter === item.key
                                        ? 'text-white shadow-lg shadow-indigo-500/20'
                                        : 'bg-white dark:bg-white/5 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20'}`}
                                    style={filter === item.key ? { background: selectedEmp.color, borderColor: selectedEmp.color } : {}}
                                >
                                    {item.label}
                                </button>
                            ))}
                            <span className="xl:ml-auto text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-1.5 font-bold transition-colors">
                                {empTasks.length} รายการ
                            </span>
                        </div>

                        <div className="flex-1 overflow-y-auto custom-scroll pb-6">
                            {empTasks.length > 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                    {empTasks.map((task) => {
                                        const assignees = employees.filter((employee) => task.assignees?.includes(employee.id));
                                        return (
                                            <FolderCard
                                                key={task.id}
                                                task={task}
                                                assignees={assignees}
                                                onClick={() => setSelectedTask(task)}
                                            />
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center h-full text-slate-400 dark:text-slate-600 transition-colors">
                                    <div className="text-6xl mb-4 grayscale dark:opacity-50 transition-opacity">📂</div>
                                    <p className="text-sm font-medium">ไม่พบงานในสถานะนี้</p>
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex items-center justify-center text-slate-400 dark:text-slate-600 transition-colors">
                        <div className="text-center">
                            <div className="text-6xl mb-4 grayscale dark:opacity-50 transition-opacity">👈</div>
                            <p className="font-medium">เลือกพนักงานจากแถบซ้ายเพื่อดู Portfolio</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
