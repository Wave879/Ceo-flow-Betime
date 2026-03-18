import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export function Modal({ title, onClose, children, size = 'md' }) {
    const sizeMap = {
        sm: 'max-w-md',
        md: 'max-w-2xl',
        lg: 'max-w-3xl',
    };

    return createPortal(
        <div className="modal-backdrop fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 dark:bg-[#030303]/80 backdrop-blur-sm transition-colors duration-300">
            <div
                className="flex min-h-full items-center justify-center p-4 sm:p-6"
                onClick={(e) => e.target === e.currentTarget && onClose()}
            >
                <div className={`animate-scale-in relative w-full ${sizeMap[size]} flex flex-col max-h-[90vh] bg-white dark:bg-slate-900 rounded-[2rem] shadow-2xl overflow-hidden border border-transparent dark:border-slate-800 transition-colors duration-200`}>
                    <div className="flex items-center justify-between px-8 py-6 border-b border-slate-100 dark:border-slate-800 transition-colors">
                        <h2 className="text-xl font-bold text-slate-800 dark:text-white transition-colors">{title}</h2>
                        <button
                            onClick={onClose}
                            className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>
                    <div className="px-8 py-6 overflow-y-auto custom-scroll flex-1 relative">
                        {children}
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}

export function Avatar({ name, color, size = 40, url }) {
    const initials = name
        ? name.split(' ').slice(0, 2).map((word) => word[0]).join('').toUpperCase()
        : '?';

    return url ? (
        <img
            src={url}
            alt={name}
            style={{ width: size, height: size, borderRadius: '50%' }}
            className="object-cover flex-shrink-0"
        />
    ) : (
        <div
            style={{
                width: size,
                height: size,
                borderRadius: '50%',
                background: `linear-gradient(135deg, ${color || '#6366f1'}, ${color ? `${color}cc` : '#8b5cf6'})`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontSize: size * 0.35,
                fontWeight: 700,
                flexShrink: 0,
            }}
        >
            {initials}
        </div>
    );
}

export function StatusBadge({ status }) {
    if (status === 'completed') {
        return (
            <span className="tag bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-500/20 transition-colors">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                สำเร็จแล้ว
            </span>
        );
    }

    if (status === 'abandoned') {
        return (
            <span className="tag bg-slate-100 dark:bg-slate-700/40 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600/50 transition-colors">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-500 inline-block" />
                ละทิ้ง
            </span>
        );
    }

    return (
        <span className="tag bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-500/20 transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block animate-pulse" />
            กำลังดำเนินการ
        </span>
    );
}

export function LoadingSpinner() {
    return (
        <div className="fixed inset-0 flex items-center justify-center bg-slate-50 dark:bg-slate-950 transition-colors duration-200">
            <div className="flex flex-col items-center gap-4">
                <div className="w-12 h-12 rounded-full border-4 border-indigo-200 dark:border-indigo-900 border-t-indigo-600 dark:border-t-indigo-500 animate-spin" />
                <p className="text-slate-500 dark:text-slate-400 font-medium transition-colors">กำลังโหลดข้อมูล...</p>
            </div>
        </div>
    );
}

export function formatCurrency(value) {
    return new Intl.NumberFormat('th-TH', {
        style: 'currency',
        currency: 'THB',
        minimumFractionDigits: 0,
    }).format(value);
}

export function formatDate(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('th-TH', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    });
}
