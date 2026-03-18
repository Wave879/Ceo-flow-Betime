import React, { useState } from 'react';
import { BarChart3, Users, Sun, Moon, HardDrive, Cloud, Layers, FolderKanban, UserCircle } from 'lucide-react';
import { useFirestore } from './hooks/useFirestore';
import { useTheme } from './hooks/useTheme';
import OverviewPage from './pages/OverviewPage';
import PortfolioPage from './pages/PortfolioPage';
import ProjectsPage from './pages/ProjectsPage';
import StaffPage from './pages/StaffPage';
import { LoadingSpinner } from './components/UI';

const NAV_ITEMS = [
    { id: 'overview', label: 'ภาพรวม', shortLabel: 'ภาพรวม', icon: BarChart3 },
    { id: 'projects', label: 'โครงการ', shortLabel: 'โครงการ', icon: FolderKanban },
    { id: 'staff', label: 'ทีมงาน', shortLabel: 'ทีม', icon: UserCircle },
    { id: 'portfolio', label: 'พอร์ตโฟลิโอ', shortLabel: 'พอร์ต', icon: Users },
];

export default function App() {
    const [page, setPage] = useState('overview');
    const {
        tasks = [], employees = [], positions = [], projects = [], loading,
        addTask, updateTask,
        addEmployee, updateEmployee, deleteEmployee,
        addPosition, deletePosition,
        isLocal,
    } = useFirestore();

    const { theme, toggleTheme } = useTheme();

    if (loading) return <LoadingSpinner />;

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-[#0a0f1e] transition-colors duration-300">
            <nav
                className="sticky top-0 z-40 border-b border-slate-200/60 dark:border-white/[0.04] transition-colors duration-300"
                style={{
                    background: theme === 'dark'
                        ? 'rgba(3,3,3,0.7)'
                        : 'rgba(255,255,255,0.85)',
                    backdropFilter: 'blur(32px)',
                    WebkitBackdropFilter: 'blur(32px)'
                }}
            >
                <div
                    className="absolute top-0 left-0 right-0 h-[1px]"
                    style={{ background: 'linear-gradient(90deg, transparent, rgba(242,138,26,0.5), transparent)' }}
                />

                <div className="max-w-screen-xl mx-auto px-3 sm:px-6 py-2 sm:py-0 flex items-center justify-between min-h-[64px] gap-2 sm:gap-4">
                    <div className="flex items-center gap-3 select-none">
                        <img
                            src="/ceoflow-logo.svg"
                            alt="CEO FLOW"
                            className="h-10 sm:h-11 w-auto drop-shadow-sm"
                        />
                    </div>

                    <div className="frame-strong flex items-center gap-1 bg-white/70 dark:bg-white/[0.03] rounded-2xl p-1.5 transition-colors overflow-x-auto max-w-[48vw] sm:max-w-none">
                        {NAV_ITEMS.map(item => {
                            const Icon = item.icon;
                            const active = page === item.id;
                            return (
                                <button
                                    key={item.id}
                                    onClick={() => setPage(item.id)}
                                    className={`flex items-center gap-2 px-3 sm:px-5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-300 whitespace-nowrap
                                    ${active
                                            ? 'text-white border border-transparent dark:border-white/10 dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]'
                                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/[0.05]'}`}
                                    style={active ? { background: 'linear-gradient(135deg, #F28A1A, #FF6B35)', boxShadow: '0 4px 12px rgba(242,138,26,0.3)' } : {}}
                                >
                                    <Icon size={15} />
                                    <span className="hidden sm:inline">{item.label}</span>
                                    <span className="sm:hidden">{item.shortLabel}</span>
                                </button>
                            );
                        })}
                    </div>

                    <div className="flex items-center gap-2.5">
                        <div className="frame-strong hidden lg:flex items-center gap-2 px-3.5 py-2 bg-white/70 dark:bg-white/[0.03] rounded-2xl transition-colors">
                            <Layers size={13} className="text-orange-500 dark:text-orange-400" />
                            <span className="text-xs font-bold text-slate-600 dark:text-slate-300 transition-colors">{Array.isArray(employees) ? employees.length : 0} สมาชิก</span>
                            <span className="text-slate-200 dark:text-slate-700/50">•</span>
                            <span className="text-xs font-bold text-slate-600 dark:text-slate-300 transition-colors">{Array.isArray(tasks) ? tasks.length : 0} งาน</span>
                        </div>

                        <div
                            className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-2xl border text-xs font-bold transition-all shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]"
                            style={isLocal
                                ? (theme === 'dark'
                                    ? { background: 'rgba(251,191,36,0.1)', borderColor: 'rgba(251,191,36,0.2)', color: '#fde68a' }
                                    : { background: '#fefce8', borderColor: '#fde047', color: '#854d0e' })
                                : (theme === 'dark'
                                    ? { background: 'rgba(34,197,94,0.1)', borderColor: 'rgba(34,197,94,0.2)', color: '#86efac' }
                                    : { background: '#f0fdf4', borderColor: '#86efac', color: '#166534' })}
                            title={isLocal ? 'ใช้ localStorage' : 'เชื่อมต่อ Firebase'}
                        >
                            {isLocal ? <HardDrive size={12} /> : <Cloud size={12} />}
                            {isLocal ? 'Local' : 'Online'}
                        </div>

                        <button
                            onClick={toggleTheme}
                            className="frame-strong w-9 h-9 flex items-center justify-center bg-white/70 dark:bg-white/[0.03] rounded-xl hover:bg-slate-100 dark:hover:bg-white/[0.08] transition-all duration-300 text-slate-500 dark:text-slate-400 hover:text-orange-600 dark:hover:text-orange-300"
                            title={theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
                        >
                            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
                        </button>
                    </div>
                </div>
            </nav>

            <main className="max-w-screen-xl mx-auto px-3 sm:px-6 py-4 sm:py-7">
                {page === 'overview' ? (
                    <OverviewPage
                        tasks={tasks}
                        employees={employees}
                        positions={positions}
                        projects={projects}
                        onAddTask={addTask}
                        onUpdateTask={updateTask}
                        onAddEmployee={addEmployee}
                        onDeleteEmployee={deleteEmployee}
                        onAddPosition={addPosition}
                        onDeletePosition={deletePosition}
                        onNavigate={setPage}
                    />
                ) : page === 'projects' ? (
                    <ProjectsPage
                        tasks={tasks}
                        employees={employees}
                        projects={projects}
                        onUpdateTask={updateTask}
                    />
                ) : page === 'staff' ? (
                    <StaffPage
                        employees={employees}
                        onDeleteEmployee={deleteEmployee}
                    />
                ) : page === 'portfolio' ? (
                    <PortfolioPage
                        tasks={tasks}
                        employees={employees}
                        positions={positions}
                        onDeleteEmployee={deleteEmployee}
                        onUpdateEmployee={updateEmployee}
                        onUpdateTask={updateTask}
                    />
                ) : (
                    <div className="text-center py-20">
                        <h2 className="text-2xl font-bold text-slate-600 dark:text-slate-300">
                            {page === 'projects' ? 'โปรเจกต์' : 'ทีมงาน'}
                        </h2>
                        <p className="text-slate-500 mt-2">กำลังพัฒนา...</p>
                    </div>
                )}
            </main>
        </div>
    );
}
