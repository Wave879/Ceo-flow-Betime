import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Users, Search, Filter, MessageCircle, AlertTriangle,
    Clock, CheckCircle, TrendingUp, Mail, Phone, Briefcase, Trash2, Upload, X
} from 'lucide-react';

const COLORS = {
    primary: '#F28A1A',
    betimes: '#24387E',
    success: '#10b981',
    warning: '#f59e0b',
    danger: '#ef4444',
};

// No mock data
const mockStaff = [];

export default function StaffPage({ employees = [], onDeleteEmployee }) {
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedStaff, setSelectedStaff] = useState(null);
    const [showProfileForm, setShowProfileForm] = useState(false);
    const [firstName, setFirstName] = useState('');
    const [nickname, setNickname] = useState('');
    const [position, setPosition] = useState('');
    const [memberListImageFile, setMemberListImageFile] = useState(null);
    const [memberListImagePreviewUrl, setMemberListImagePreviewUrl] = useState('');
    const memberListInputRef = useRef(null);

    const safeEmployees = Array.isArray(employees) ? employees : [];

    const filteredStaff = useMemo(() => {
        if (safeEmployees.length === 0) return [];
        return safeEmployees.filter(staff =>
            staff?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            staff?.nickname?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            staff?.department?.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [safeEmployees, searchTerm]);

    const getWorkloadStatus = (tasksCount) => {
        const count = typeof tasksCount === 'number' ? tasksCount : 0;
        if (count >= 10) return { label: 'งานแน่น', color: COLORS.danger };
        if (count >= 5) return { label: 'ปานกลาง', color: COLORS.warning };
        return { label: 'เบาบาง', color: COLORS.success };
    };

    useEffect(() => {
        return () => {
            if (memberListImagePreviewUrl) {
                URL.revokeObjectURL(memberListImagePreviewUrl);
            }
        };
    }, [memberListImagePreviewUrl]);

    const openMemberListImagePicker = () => {
        memberListInputRef.current?.click();
    };

    const clearMemberListImage = () => {
        setMemberListImageFile(null);
        if (memberListImagePreviewUrl) {
            URL.revokeObjectURL(memberListImagePreviewUrl);
        }
        setMemberListImagePreviewUrl('');
        if (memberListInputRef.current) {
            memberListInputRef.current.value = '';
        }
    };

    const handleMemberListImageSelected = (event) => {
        const file = event?.target?.files?.[0];
        if (!file) {
            return;
        }

        if (!file.type.startsWith('image/')) {
            alert('รองรับเฉพาะไฟล์รูปภาพเท่านั้น');
            if (memberListInputRef.current) {
                memberListInputRef.current.value = '';
            }
            return;
        }

        if (memberListImagePreviewUrl) {
            URL.revokeObjectURL(memberListImagePreviewUrl);
        }

        const objectUrl = URL.createObjectURL(file);
        setMemberListImageFile(file);
        setMemberListImagePreviewUrl(objectUrl);
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white">ทีมงาน</h1>
                    <p className="text-slate-500 dark:text-slate-400">ติดตามภาระงานและการตอบกลับของทีม</p>
                </div>
                <div className="flex items-center gap-3">
                    <input
                        ref={memberListInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleMemberListImageSelected}
                        className="hidden"
                    />
                    <div className="relative">
                        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            placeholder="ค้นหาพนักงาน..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-10 pr-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                        />
                    </div>
                    <button className="flex items-center gap-2 px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
                        <Filter size={18} />
                        กรอง
                    </button>
                    <button
                        onClick={openMemberListImagePicker}
                        className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-xl text-sm font-medium hover:bg-orange-600"
                    >
                        <Upload size={16} />
                        อัปโหลดภาพรายชื่อ
                    </button>
                </div>
            </div>

            {memberListImageFile && (
                <div className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-2xl p-4">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="text-sm font-semibold text-slate-900 dark:text-white">ภาพรายชื่อสมาชิกที่เลือกแล้ว</p>
                            <p className="text-xs text-slate-500 mt-1">{memberListImageFile.name} • {Math.max(1, Math.round(memberListImageFile.size / 1024))} KB</p>
                        </div>
                        <button
                            onClick={clearMemberListImage}
                            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                            title="ล้างรูปที่เลือก"
                        >
                            <X size={16} />
                        </button>
                    </div>

                    {memberListImagePreviewUrl && (
                        <img
                            src={memberListImagePreviewUrl}
                            alt="member list preview"
                            className="mt-3 w-full max-h-72 object-contain rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50"
                        />
                    )}

                    <p className="text-xs text-slate-500 mt-3">ขั้นถัดไป: นำภาพนี้ไปใช้ดึงรายชื่อสมาชิก (OCR) และจับคู่กับทีมงานอัตโนมัติ</p>
                </div>
            )}

            <div className="grid lg:grid-cols-3 gap-6">
                {/* Staff List */}
                <div className="lg:col-span-1 space-y-3">
                    {filteredStaff.map(staff => {
                        const tasksCount = typeof staff.tasksCount === 'number' ? staff.tasksCount : 0;
                        const workload = getWorkloadStatus(tasksCount);
                        return (
                            <button
                                key={staff.id}
                                onClick={() => setSelectedStaff(staff)}
                                className={`w-full p-4 rounded-xl text-left transition-all ${selectedStaff?.id === staff.id
                                    ? 'bg-orange-50 dark:bg-orange-900/20 border-2 border-orange-500'
                                    : 'bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 hover:border-orange-300'
                                    }`}
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-12 h-12 rounded-full overflow-hidden bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
                                        {staff.photoUrl ? (
                                            <img
                                                src={staff.photoUrl}
                                                alt={staff.name}
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            <span className="text-white bg-orange-500 w-full h-full flex items-center justify-center font-bold">
                                                {staff.name?.charAt(0) || '?'}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex-1">
                                        <h3 className="font-semibold text-slate-900 dark:text-white">
                                            {staff.name || 'ไม่มีชื่อ'}
                                        </h3>
                                        <p className="text-sm text-slate-500">{staff.role}</p>
                                    </div>
                                    {(staff.pendingItems?.length || 0) > 0 && (
                                        <span className="px-2 py-1 bg-red-100 text-red-600 text-xs font-medium rounded-full">
                                            {staff.pendingItems?.length || 0}
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-4 mt-3 text-xs">
                                    <span className="flex items-center gap-1">
                                        <Briefcase size={14} /> {tasksCount} งาน
                                    </span>
                                    <span
                                        className="px-1.5 py-0.5 rounded"
                                        style={{ backgroundColor: `${workload.color}20`, color: workload.color }}
                                    >
                                        {workload.label}
                                    </span>
                                </div>
                            </button>
                        );
                    })}
                </div>

                {/* Staff Detail */}
                <div className="lg:col-span-2">
                    {selectedStaff ? (
                        <div className="bg-white dark:bg-slate-800/50 rounded-2xl border border-slate-200/60 dark:border-white/10 overflow-hidden">
                            {/* Profile Header */}
                            <div className="p-6 border-b border-slate-200/60 dark:border-white/10"
                                style={{ background: `linear-gradient(135deg, ${COLORS.betimes} 0%, #1a2744 100%)` }}>
                                <div className="flex items-center gap-4">
                                    <div className="w-20 h-20 rounded-full bg-white/20 flex items-center justify-center text-white text-3xl font-bold">
                                        {selectedStaff.nickname?.charAt(0) || selectedStaff.name?.charAt(0) || '?'}
                                    </div>
                                    <div className="text-white">
                                        <h2 className="text-2xl font-bold">
                                            {selectedStaff.name || 'ไม่มีชื่อ'} ({selectedStaff.id || '-'})
                                        </h2>
                                        <p className="opacity-80">{selectedStaff.role}</p>
                                        <p className="text-sm opacity-60">{selectedStaff.department}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Stats */}
                            <div className="grid grid-cols-3 gap-4 p-6">
                                <div className="text-center p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                                    <p className="text-3xl font-bold text-slate-900 dark:text-white">{typeof selectedStaff.tasksCount === 'number' ? selectedStaff.tasksCount : 0}</p>
                                    <p className="text-sm text-slate-500">งานทั้งหมด</p>
                                </div>
                                <div className="text-center p-4 bg-green-50 dark:bg-green-900/20 rounded-xl">
                                    <p className="text-3xl font-bold text-green-600">{typeof selectedStaff.completedTasks === 'number' ? selectedStaff.completedTasks : 0}</p>
                                    <p className="text-sm text-green-600">เสร็จแล้ว</p>
                                </div>
                                <div className="text-center p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl">
                                    <p className="text-3xl font-bold text-blue-600">{typeof selectedStaff.responseRate === 'number' ? selectedStaff.responseRate : 0}%</p>
                                    <p className="text-sm text-blue-600">อัตราตอบกลับ</p>
                                </div>
                            </div>

                            {/* Pending Items */}
                            <div className="p-6 border-t border-slate-200/60 dark:border-white/10">
                                <h3 className="font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                                    <AlertTriangle size={18} className="text-orange-500" />
                                    รายการรอดำเนินการ ({selectedStaff.pendingItems?.length || 0})
                                </h3>
                                {(selectedStaff.pendingItems?.length || 0) > 0 ? (
                                    <div className="space-y-3">
                                        {(selectedStaff.pendingItems || []).map(item => (
                                            <div key={item.id} className="flex items-center justify-between p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-xl">
                                                <div>
                                                    <p className="text-sm text-slate-700 dark:text-slate-200">{item.message}</p>
                                                    <p className="text-xs text-slate-500">{item.from} • {item.time}</p>
                                                </div>
                                                <button className="px-3 py-1 bg-orange-500 text-white text-sm rounded-lg hover:bg-orange-600">
                                                    ตอบกลับ
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-slate-500 text-center py-4">ไม่มีรายการรอดำเนินการ</p>
                                )}
                            </div>

                            {/* Quick Actions */}
                            <div className="p-6 border-t border-slate-200/60 dark:border-white/10 bg-slate-50/50 dark:bg-slate-800/30">
                                <h3 className="font-semibold text-slate-900 dark:text-white mb-3">การดำเนินการด่วน</h3>
                                <div className="flex gap-3">
                                    <button className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-xl font-medium hover:bg-orange-600">
                                        <MessageCircle size={18} />
                                        ส่ง LINE
                                    </button>
                                    <button className="flex-1 flex items-center justify-center gap-2 px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-xl font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
                                        <Mail size={18} />
                                        อีเมล
                                    </button>
                                </div>

                                {/* ✅ เพิ่มข้อมูลส่วนตัว */}
                                <div className="mt-4">
                                    <button
                                        onClick={() => setShowProfileForm(p => !p)}
                                        className="px-4 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                                    >
                                        {showProfileForm ? 'ปิดการแก้ไขข้อมูล' : 'เพิ่ม / แก้ไขข้อมูลส่วนตัว'}
                                    </button>

                                    {showProfileForm && (
                                        <div className="mt-3 space-y-3">
                                            <input
                                                type="text"
                                                value={firstName}
                                                onChange={(e) => setFirstName(e.target.value)}
                                                placeholder="ชื่อจริง"
                                                className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm"
                                            />

                                            <input
                                                type="text"
                                                value={nickname}
                                                onChange={(e) => setNickname(e.target.value)}
                                                placeholder="ชื่อเล่น"
                                                className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm"
                                            />

                                            <input
                                                type="text"
                                                value={position}
                                                onChange={(e) => setPosition(e.target.value)}
                                                placeholder="ตำแหน่ง"
                                                className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm"
                                            />

                                            <button
                                                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
                                            >
                                                บันทึกข้อมูล
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {onDeleteEmployee && selectedStaff && (
                                    <div className="mt-4 flex justify-end">
                                        <button
                                            onClick={() => {
                                                if (window.confirm(`ลบพนักงาน ${selectedStaff.name} ?`)) {
                                                    onDeleteEmployee(selectedStaff.id);
                                                    setSelectedStaff(null);
                                                }
                                            }}
                                            className="p-2 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition"
                                            title="ลบพนักงาน"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="bg-white dark:bg-slate-800/50 rounded-2xl border border-slate-200/60 dark:border-white/10 p-8 text-center">
                            <Users size={48} className="mx-auto mb-4 text-slate-300" />
                            <p className="text-slate-500">เลือกพนักงานเพื่อดูรายละเอียด</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
