import React, { useState } from 'react';
import { Plus, User, Briefcase, Calendar, DollarSign, Users, CheckCircle, Clock } from 'lucide-react';
import { Modal } from './UI';

// ────────────────────────────────────────────────────────
// Add Task Modal
// ────────────────────────────────────────────────────────
export function AddTaskModal({ onClose, onAdd, employees }) {
    const [form, setForm] = useState({
        name: '', description: '', type: 'individual',
        startDate: '', deadline: '', value: '',
        assignees: [], status: 'in-progress',
    });

    const toggle = (id) => {
        setForm(f => ({
            ...f,
            assignees: f.assignees.includes(id)
                ? f.assignees.filter(a => a !== id)
                : [...f.assignees, id],
        }));
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!form.name.trim() || !form.deadline) return;
        onAdd({ ...form, value: Number(form.value) || 0, id: `t${Date.now()}` });
        onClose();
    };

    return (
        <Modal title="สร้างโปรเจกต์ / งานใหม่" onClose={onClose} size="md">
            <form onSubmit={handleSubmit} className="space-y-5">
                {/* Name */}
                <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5 transition-colors">ชื่องาน *</label>
                    <input className="input-field" placeholder="ระบุชื่องานหรือโปรเจกต์..." required
                        value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                {/* Description */}
                <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5 transition-colors">รายละเอียด</label>
                    <textarea className="input-field resize-none" rows={3} placeholder="อธิบายรายละเอียดงาน..."
                        value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
                </div>
                {/* Type + Status row */}
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5 transition-colors">ประเภท</label>
                        <select className="input-field" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                            <option value="individual">งานเดี่ยว</option>
                            <option value="team">งานทีม</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5 transition-colors">สถานะ</label>
                        <select className="input-field" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                            <option value="in-progress">กำลังดำเนินการ</option>
                            <option value="completed">สำเร็จแล้ว</option>
                        </select>
                    </div>
                </div>
                {/* Dates row */}
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5 transition-colors">วันที่เริ่ม</label>
                        <input type="date" className="input-field" value={form.startDate}
                            onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5 transition-colors">วันสิ้นสุด (Deadline) *</label>
                        <input type="date" className="input-field" required value={form.deadline}
                            onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))} />
                    </div>
                </div>
                {/* Value */}
                <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5 transition-colors">มูลค่างาน (บาท)</label>
                    <input type="number" className="input-field" placeholder="0" min="0"
                        value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))} />
                </div>
                {/* Assignees */}
                <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 transition-colors">มอบหมายให้</label>
                    <div className="flex flex-wrap gap-2">
                        {employees.map(emp => {
                            const selected = form.assignees.includes(emp.id);
                            return (
                                <button type="button" key={emp.id}
                                    onClick={() => toggle(emp.id)}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium border-2 transition-all duration-150
                    ${selected ? 'border-transparent text-white shadow-md' : 'border-slate-200 dark:border-slate-700/50 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600/50'}`}
                                    style={selected ? { background: emp.color, borderColor: emp.color } : {}}
                                >
                                    <div className="w-5 h-5 rounded-full text-white text-[10px] flex items-center justify-center font-bold"
                                        style={{ background: emp.color }}>
                                        {emp.name[0]}
                                    </div>
                                    {emp.name.split(' ')[0]}
                                </button>
                            );
                        })}
                    </div>
                </div>
                {/* Actions */}
                <div className="sticky bottom-0 -mx-8 -mb-6 px-8 py-5 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 flex gap-4 mt-8 transition-colors">
                    <button type="button" onClick={onClose} className="btn-secondary flex-1 justify-center py-3">ยกเลิก</button>
                    <button type="submit" className="btn-primary flex-1 justify-center py-3">
                        <Plus size={16} /> สร้างงาน
                    </button>
                </div>
            </form>
        </Modal>
    );
}

// ────────────────────────────────────────────────────────
// Add Employee Modal
// ────────────────────────────────────────────────────────
export function AddEmployeeModal({ onClose, onAdd, positions }) {
    const [form, setForm] = useState({ name: '', position: positions[0]?.id || '', avatar: '', bio: '' });

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!form.name.trim()) return;
        onAdd(form);
        onClose();
    };

    return (
        <Modal title="เพิ่มสมาชิกทีม" onClose={onClose} size="sm">
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5 transition-colors">ชื่อ-นามสกุล *</label>
                    <input className="input-field" placeholder="ชื่อ นามสกุล" required
                        value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5 transition-colors">ตำแหน่งงาน</label>
                    <select className="input-field" value={form.position} onChange={e => setForm(f => ({ ...f, position: e.target.value }))}>
                        {positions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5 transition-colors">URL รูปโปรไฟล์</label>
                    <input className="input-field" placeholder="https://..." type="url"
                        value={form.avatar} onChange={e => setForm(f => ({ ...f, avatar: e.target.value }))} />
                </div>
                <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5 transition-colors">ประวัติย่อ (Bio)</label>
                    <textarea className="input-field resize-none" rows={3} placeholder="แนะนำตัว, ความเชี่ยวชาญ..."
                        value={form.bio} onChange={e => setForm(f => ({ ...f, bio: e.target.value }))} />
                </div>
                <div className="sticky bottom-0 -mx-8 -mb-6 px-8 py-5 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 flex gap-4 mt-8 transition-colors">
                    <button type="button" onClick={onClose} className="btn-secondary flex-1 justify-center py-3">ยกเลิก</button>
                    <button type="submit" className="btn-primary flex-1 justify-center py-3">
                        <User size={16} /> เพิ่มสมาชิก
                    </button>
                </div>
            </form>
        </Modal>
    );
}

// ────────────────────────────────────────────────────────
// Edit Employee Modal
// ────────────────────────────────────────────────────────
export function EditEmployeeModal({ employee, onClose, onUpdate, positions }) {
    const [form, setForm] = useState({
        name: employee.name || '',
        position: employee.position || positions[0]?.id || '',
        avatar: employee.avatar || '',
        bio: employee.bio || ''
    });

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!form.name.trim()) return;
        onUpdate(employee.id, form);
        onClose();
    };

    return (
        <Modal title="แก้ไขข้อมูลสมาชิก" onClose={onClose} size="sm">
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5 transition-colors">ชื่อ-นามสกุล *</label>
                    <input className="input-field" placeholder="ชื่อ นามสกุล" required
                        value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5 transition-colors">ตำแหน่งงาน</label>
                    <select className="input-field" value={form.position} onChange={e => setForm(f => ({ ...f, position: e.target.value }))}>
                        {positions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5 transition-colors">ประวัติย่อ (Bio)</label>
                    <textarea className="input-field resize-none" rows={3} placeholder="แนะนำตัว, ความเชี่ยวชาญ..."
                        value={form.bio} onChange={e => setForm(f => ({ ...f, bio: e.target.value }))} />
                </div>
                <div className="sticky bottom-0 -mx-8 -mb-6 px-8 py-5 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 flex gap-4 mt-8 transition-colors">
                    <button type="button" onClick={onClose} className="btn-secondary flex-1 justify-center py-3">ยกเลิก</button>
                    <button type="submit" className="btn-primary flex-1 justify-center py-3">
                        <User size={16} /> บันทึก
                    </button>
                </div>
            </form>
        </Modal>
    );
}

// ────────────────────────────────────────────────────────
// Add Position Modal
// ────────────────────────────────────────────────────────
export function AddPositionModal({ onClose, onAdd }) {
    const [form, setForm] = useState({ name: '', description: '' });

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!form.name.trim()) return;
        onAdd(form);
        onClose();
    };

    return (
        <Modal title="เพิ่มตำแหน่งงาน" onClose={onClose} size="sm">
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5 transition-colors">ชื่อตำแหน่ง *</label>
                    <input className="input-field" placeholder="เช่น Frontend Developer" required
                        value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5 transition-colors">รายละเอียดหน้าที่</label>
                    <textarea className="input-field resize-none" rows={3} placeholder="อธิบายหน้าที่ความรับผิดชอบ..."
                        value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
                </div>
                <div className="sticky bottom-0 -mx-8 -mb-6 px-8 py-5 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 flex gap-4 mt-8 transition-colors">
                    <button type="button" onClick={onClose} className="btn-secondary flex-1 justify-center py-3">ยกเลิก</button>
                    <button type="submit" className="btn-primary flex-1 justify-center py-3">
                        <Briefcase size={16} /> เพิ่มตำแหน่ง
                    </button>
                </div>
            </form>
        </Modal>
    );
}
