import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
    X, Paperclip, Link2, Mic, Video, Trash2, Download,
    Calendar, Users, User, Clock,
    ExternalLink, Play, Pause, FileText, Image, Plus, Archive, RotateCcw
} from 'lucide-react';
import { Avatar, StatusBadge, formatDate } from './UI';
import { storage } from '../firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

function normalizeMeetingSummaryTitleForDisplay(task = {}) {
    const fallbackTitle = String(task?.name || task?.title || '').trim();
    if (String(task?.source || '').trim() !== 'line-meeting-summary') {
        return fallbackTitle;
    }

    const rawSourceText = String(task?.sourceText || '').trim();
    const sourceText = (rawSourceText || fallbackTitle).replace(/\s+/g, ' ').trim();
    if (!sourceText) {
        return fallbackTitle;
    }

    const ccMatch = sourceText.match(/(?:^|\s)(?:cc|copy)(?:\s|[:：]|$)/iu);
    const beforeCc = ccMatch && Number.isFinite(ccMatch.index)
        ? sourceText.slice(0, ccMatch.index).trim()
        : sourceText;

    const leadingMentionsRaw = beforeCc.match(/^(@[^\s]+\s*)+/u)?.[0] || '';
    const leadingMentions = leadingMentionsRaw.match(/@[^\s]+/gu) || [];
    const preferredMention = leadingMentions.find((mention) => {
        const normalizedMention = String(mention || '').toLowerCase();
        return Boolean(normalizedMention)
            && normalizedMention !== '@all'
            && !normalizedMention.includes('aina')
            && !normalizedMention.includes('ไอน่า');
    }) || '';

    let normalizedTitle = beforeCc
        .replace(/^(@[^\s]+\s*)+/u, '')
        .replace(/^\/?(?:ai|ask|ถาม|ไอน่า)\s*/iu, '')
        .replace(/(?:\(|\[|วันที่\s*)?(\d{1,2})\s*[\/\-]\s*(\d{1,2})(?:\s*[\/\-]\s*(\d{2,4}))?(?:\)|\])?/u, ' ')
        .replace(/[()\[\]]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!normalizedTitle) {
        normalizedTitle = fallbackTitle || 'สรุปประเด็นการประชุม';
    }

    if (preferredMention && !normalizedTitle.includes(preferredMention)) {
        normalizedTitle = `${normalizedTitle} ${preferredMention}`.trim();
    }

    if (normalizedTitle.length > 180) {
        normalizedTitle = `${normalizedTitle.slice(0, 177)}...`;
    }

    return normalizedTitle;
}

function isLineFallbackDisplayName(name = '') {
    return /^LINE-[A-Za-z0-9]{6}$/i.test(String(name || '').trim());
}

function normalizeMentionDisplayName(name = '') {
    return String(name || '')
        .replace(/^@+/, '')
        .replace(/[,:;!?，。、]+$/u, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// Small helper: icon by attachment type
function AttachIcon({ type, name }) {
    const ext = name?.split('.').pop()?.toLowerCase();
    if (type === 'link') return <Link2 size={16} className="text-blue-500" />;
    if (type === 'audio') return <Mic size={16} className="text-violet-500" />;
    if (type === 'video') return <Video size={16} className="text-pink-500" />;
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return <Image size={16} className="text-emerald-500" />;
    return <FileText size={16} className="text-slate-400" />;
}

// Audio player
function AudioPlayer({ url, name }) {
    const [playing, setPlaying] = useState(false);
    const audioRef = useRef(null);
    const toggle = () => {
        if (!audioRef.current) return;
        if (playing) { audioRef.current.pause(); setPlaying(false); }
        else { audioRef.current.play(); setPlaying(true); }
    };
    return (
        <div className="flex items-center gap-3 p-3 bg-violet-50 dark:bg-violet-900/20 rounded-2xl border border-violet-100 dark:border-violet-800/50 transition-colors">
            <button onClick={toggle} className="w-9 h-9 rounded-xl bg-violet-600 dark:bg-violet-500 flex items-center justify-center text-white hover:bg-violet-700 dark:hover:bg-violet-600 transition-colors flex-shrink-0">
                {playing ? <Pause size={14} /> : <Play size={14} />}
            </button>
            <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate transition-colors">{name}</p>
                <p className="text-[10px] text-violet-500 dark:text-violet-400 mt-0.5 transition-colors">Audio</p>
            </div>
            <audio ref={audioRef} src={url} onEnded={() => setPlaying(false)} />
        </div>
    );
}

// Video preview
function VideoPreview({ url, name }) {
    return (
        <div className="rounded-2xl overflow-hidden border border-pink-100 dark:border-pink-900/50 bg-black">
            <video src={url} controls className="w-full max-h-52" />
            <div className="px-3 py-2 bg-pink-50 dark:bg-pink-900/20 transition-colors">
                <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 truncate transition-colors">{name}</p>
            </div>
        </div>
    );
}

// Image preview
function ImagePreview({ url, name }) {
    return (
        <div className="rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-800 transition-colors">
            <img src={url} alt={name} className="w-full max-h-52 object-cover" />
            <div className="px-3 py-2 bg-slate-50 dark:bg-slate-800/50 transition-colors">
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate transition-colors">{name}</p>
            </div>
        </div>
    );
}

// Attachment item
function AttachmentItem({ att, onDelete }) {
    const ext = att.name?.split('.').pop()?.toLowerCase();
    const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);

    if (att.type === 'audio') return (
        <div className="relative group">
            <AudioPlayer url={att.url} name={att.name} />
            <button onClick={() => onDelete(att.id)} className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 rounded-lg bg-red-50 text-red-400 hover:text-red-600 transition-all">
                <Trash2 size={12} />
            </button>
        </div>
    );

    if (att.type === 'video') return (
        <div className="relative group">
            <VideoPreview url={att.url} name={att.name} />
            <button onClick={() => onDelete(att.id)} className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 rounded-lg bg-red-50 text-red-400 hover:text-red-600 transition-all">
                <Trash2 size={12} />
            </button>
        </div>
    );

    if (isImage) return (
        <div className="relative group">
            <ImagePreview url={att.url} name={att.name} />
            <button onClick={() => onDelete(att.id)} className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 rounded-lg bg-red-50 text-red-400 hover:text-red-600 transition-all">
                <Trash2 size={12} />
            </button>
        </div>
    );

    if (att.type === 'link') return (
        <div className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-2xl border border-blue-100 dark:border-blue-800/50 group transition-colors">
            <Link2 size={15} className="text-blue-500 dark:text-blue-400 flex-shrink-0" />
            <a href={att.url} target="_blank" rel="noreferrer" className="flex-1 min-w-0 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors truncate">
                {att.name || att.url}
            </a>
            <ExternalLink size={12} className="text-blue-400 flex-shrink-0" />
            <button onClick={() => onDelete(att.id)} className="opacity-0 group-hover:opacity-100 p-1 rounded-lg bg-red-50 dark:bg-red-500/10 text-red-400 hover:text-red-600 dark:hover:text-red-300 transition-all ml-1">
                <Trash2 size={12} />
            </button>
        </div>
    );

    // Generic file
    return (
        <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-100 dark:border-slate-800/60 group transition-colors">
            <div className="w-9 h-9 rounded-xl bg-slate-200 dark:bg-slate-700 flex items-center justify-center flex-shrink-0 transition-colors">
                <AttachIcon type={att.type} name={att.name} />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 truncate transition-colors">{att.name}</p>
                {att.size && <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 transition-colors">{(att.size / 1024).toFixed(1)} KB</p>}
            </div>
            <a href={att.url} download={att.name} className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 transition-colors">
                <Download size={13} />
            </a>
            <button onClick={() => onDelete(att.id)} className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-red-400 transition-all">
                <Trash2 size={13} />
            </button>
        </div>
    );
}

// Main Task Detail Modal
export default function TaskDetailModal({ task, employees, onClose, onUpdate, onJumpToReply, onJumpToQuestion }) {
    const [attachments, setAttachments] = useState(task.attachments || []);
    const [linkInput, setLinkInput] = useState('');
    const [linkLabel, setLinkLabel] = useState('');
    const [timelineInput, setTimelineInput] = useState('');
    const [timelineAuthorId, setTimelineAuthorId] = useState(task.assignees?.[0] || employees[0]?.id || '');
    const [uploading, setUploading] = useState(false);
    const [activeTab, setActiveTab] = useState('detail'); // detail | timeline | attachments
    const [status, setStatus] = useState(task.status);
    const fileInputRef = useRef(null);
    const displayTaskTitle = useMemo(() => normalizeMeetingSummaryTitleForDisplay(task), [task]);
    const assigneeEmps = employees.filter(e => task.assignees?.includes(e.id));
    const mentionAssigneeNames = useMemo(() => {
        const lineNames = Array.isArray(task?.lineAssigneeNames) ? task.lineAssigneeNames : [];
        const normalized = lineNames
            .map((value) => normalizeMentionDisplayName(value))
            .filter(Boolean);

        if (normalized.length > 0) {
            return normalized;
        }

        const titleMention = String(displayTaskTitle || '').match(/@([^\s]+)/u)?.[1] || '';
        const fallbackMention = normalizeMentionDisplayName(titleMention);
        return fallbackMention ? [fallbackMention] : [];
    }, [task?.lineAssigneeNames, displayTaskTitle]);
    const assigneeRows = useMemo(() => {
        const rows = assigneeEmps.map((employee, index) => {
            const mentionName = String(mentionAssigneeNames[index] || '').trim();
            const employeeName = String(employee?.name || employee?.fullName || '').trim();

            const displayName = mentionName && (!employeeName || isLineFallbackDisplayName(employeeName))
                ? mentionName
                : (employeeName || mentionName || 'สมาชิกในกลุ่ม');

            return {
                ...employee,
                displayName,
                displayPosition: String(employee?.position || '').trim() || 'สมาชิกทีม'
            };
        });

        if (rows.length === 0 && mentionAssigneeNames.length > 0) {
            return mentionAssigneeNames.map((name, index) => ({
                id: `mention_${index}_${name}`,
                name,
                displayName: name,
                displayPosition: 'จากการแท็กในแชท',
                color: '#6366f1',
                avatar: ''
            }));
        }

        return rows;
    }, [assigneeEmps, mentionAssigneeNames]);
    const mainColor = assigneeEmps[0]?.color || '#6366f1';
    const isAbandoned = status === 'abandoned' || task.status === 'abandoned';
    const timelineAuthor = employees.find((employee) => employee.id === timelineAuthorId);
    const unknownValue = 'ไม่ทราบ';
    const actorName =
        task.lastUpdatedByName ||
        task.updatedByName ||
        task.createdByName ||
        task.lastUpdatedBy ||
        task.updatedBy ||
        task.createdBy ||
        unknownValue;

    const formatDateTime = (v) => {
        if (!v) return '-';
        const dt = new Date(v);
        if (Number.isNaN(dt.getTime())) return String(v);
        return new Intl.DateTimeFormat('th-TH', {
            dateStyle: 'medium',
            timeStyle: 'short'
        }).format(dt);
    };

    const latestReplyAnswer = useMemo(() => {
        const replyLineMessageIds = Array.isArray(task?.replyLineMessageIds)
            ? task.replyLineMessageIds.map((value) => String(value || '').trim()).filter(Boolean)
            : [];
        const latestReplyLineMessageId = replyLineMessageIds.length > 0
            ? replyLineMessageIds[replyLineMessageIds.length - 1]
            : '';

        const explicitText = String(task.replyAnswerText || '').trim();
        if (explicitText) {
            return {
                text: explicitText,
                by: String(task.replyAnswerByName || task.replyAnswerBy || '').trim() || unknownValue,
                at: task.replyAnswerAt || task.lastUpdatedAt || null,
                lineMessageId: latestReplyLineMessageId
            };
        }

        const timelineEntries = Array.isArray(task.timelineEntries) ? task.timelineEntries : [];
        const replyEntries = timelineEntries.filter((entry = {}) => {
            const replyLineMessageId = String(entry?.replyLineMessageId || '').trim();
            const title = String(entry?.title || '').trim();
            return Boolean(replyLineMessageId) || title === 'ตอบกลับงานจาก LINE';
        });

        if (replyEntries.length === 0) {
            return null;
        }

        const getTime = (value) => {
            const parsed = new Date(value || '').getTime();
            return Number.isNaN(parsed) ? 0 : parsed;
        };

        const latestEntry = [...replyEntries].sort((a, b) => getTime(b?.time) - getTime(a?.time))[0] || null;
        if (!latestEntry) {
            return null;
        }

        return {
            text: String(latestEntry?.detail || '').trim() || '-',
            by: String(latestEntry?.actor || '').trim() || unknownValue,
            at: latestEntry?.time || null,
            lineMessageId: String(latestEntry?.replyLineMessageId || latestReplyLineMessageId || '').trim()
        };
    }, [task, unknownValue]);

    const questionLineMessageId = useMemo(() => {
        const directCandidates = [
            task?.lineMessageId,
            task?.sourceLineMessageId,
            task?.originLineMessageId,
            task?.rootLineMessageId
        ];

        for (const candidate of directCandidates) {
            const normalized = String(candidate || '').trim();
            if (normalized) {
                return normalized;
            }
        }

        const contextLineMessageIds = Array.isArray(task?.lineContextMessageIds)
            ? task.lineContextMessageIds.map((value) => String(value || '').trim()).filter(Boolean)
            : [];

        return contextLineMessageIds[0] || '';
    }, [task]);

    const timelineEvents = useMemo(() => {
        const events = [];
        const createdTime =
            task.createdAt ||
            task.startDate ||
            task.updatedAt ||
            task.lastUpdatedAt ||
            task.completedAt ||
            new Date().toISOString();

        const pushEvent = (event) => {
            if (!event?.time) return;
            events.push(event);
        };

        pushEvent({
            key: 'created',
            time: createdTime,
            title: 'สั่งงาน',
            detail: `งาน: ${task.name || unknownValue}`,
            actor: task.createdByName || task.createdBy || unknownValue,
            tone: 'indigo'
        });

        if (task.updatedAt && task.updatedAt !== task.lastUpdatedAt) {
            pushEvent({
                key: 'updated',
                time: task.updatedAt,
                title: 'อัปเดตข้อมูล',
                detail: 'มีการแก้ไขรายละเอียดของงาน',
                actor: task.updatedByName || task.updatedBy || actorName,
                tone: 'violet'
            });
        }

        if (task.lastUpdatedAt || task.lastUpdate) {
            pushEvent({
                key: 'progress',
                time: task.lastUpdatedAt || task.updatedAt || new Date().toISOString(),
                title: 'อัปเดตความคืบหน้า',
                detail: task.lastUpdate || 'Latest progress was updated',
                actor: task.lastUpdatedByName || task.lastUpdatedBy || actorName,
                tone: 'amber'
            });
        }

        if (status === 'completed' || task.status === 'completed') {
            pushEvent({
                key: 'completed',
                time: task.completedAt || task.lastUpdatedAt || task.updatedAt || new Date().toISOString(),
                title: 'งานเสร็จสิ้น',
                detail: 'งานนี้ถูกปิดเป็นเสร็จสิ้นแล้ว',
                actor: task.completedByName || task.completedBy || actorName,
                tone: 'emerald'
            });
        }

        if (task.abandonedAt) {
            pushEvent({
                key: 'abandoned',
                time: task.abandonedAt,
                title: 'จัดเก็บงาน',
                detail: task.abandonedNote || 'Task was moved to archived status',
                actor: task.abandonedByName || task.abandonedBy || actorName,
                tone: 'slate'
            });
        }

        if (task.restoredAt) {
            pushEvent({
                key: 'restored',
                time: task.restoredAt,
                title: 'กู้คืนงาน',
                detail: task.restoredNote || 'Task was restored back to active work',
                actor: task.restoredByName || task.restoredBy || actorName,
                tone: 'blue'
            });
        }

        const manualEntries = Array.isArray(task.timelineEntries) ? task.timelineEntries : [];
        for (const entry of manualEntries) {
            pushEvent({
                key: `manual_${entry.id || entry.time || Math.random().toString(36).slice(2)}`,
                time: entry.time || new Date().toISOString(),
                title: entry.title || 'บันทึกเพิ่มเติม',
                detail: entry.detail || '-',
                actor: entry.actor || actorName,
                tone: entry.tone || 'violet'
            });
        }

        const latestAttachment = (Array.isArray(attachments) ? attachments : [])
            .filter((a) => a?.addedAt)
            .sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt))[0];
        if (latestAttachment) {
            pushEvent({
                key: `attachment_${latestAttachment.id}`,
                time: latestAttachment.addedAt,
                title: 'Attachment added',
                detail: latestAttachment.name || 'Attachment or link was added',
                actor: actorName,
                tone: 'blue'
            });
        }

        const getTime = (value) => {
            const t = new Date(value).getTime();
            return Number.isNaN(t) ? 0 : t;
        };

        return events
            .sort((a, b) => getTime(a.time) - getTime(b.time))
            .map((event, idx) => ({ ...event, key: `${event.key}_${idx}` }));
    }, [task, status, attachments, actorName, unknownValue]);

    // Save attachments back to parent
    const saveAttachments = (atts) => {
        setAttachments(atts);
        onUpdate?.(task.id, { attachments: atts });
    };

    const handleStatusChange = (s) => {
        setStatus(s);
        const nowIso = new Date().toISOString();
        onUpdate?.(task.id, {
            status: s,
            updatedAt: nowIso,
            updatedByName: 'Web UI',
            completedAt: s === 'completed' ? nowIso : null,
            completedByName: s === 'completed' ? 'Web UI' : null,
        });
    };

    const handleArchiveToggle = () => {
        const nowIso = new Date().toISOString();
        if (isAbandoned) {
            setStatus('in-progress');
            onUpdate?.(task.id, {
                status: 'in-progress',
                updatedAt: nowIso,
                updatedByName: 'Web UI',
                restoredAt: nowIso,
                restoredByName: 'Web UI',
                restoredNote: 'กู้คืนงานจากสถานะจัดเก็บ',
            });
            return;
        }

        setStatus('abandoned');
        onUpdate?.(task.id, {
            status: 'abandoned',
            updatedAt: nowIso,
            updatedByName: 'Web UI',
            abandonedAt: nowIso,
            abandonedByName: 'Web UI',
            abandonedNote: 'ย้ายงานไปสถานะจัดเก็บ',
        });
    };

    const addTimelineEntry = () => {
        const detail = timelineInput.trim();
        if (!detail || !timelineAuthor) return;

        const nowIso = new Date().toISOString();
        const currentEntries = Array.isArray(task.timelineEntries) ? task.timelineEntries : [];
        const nextEntries = [
            ...currentEntries,
            {
                id: `tl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                time: nowIso,
                title: 'บันทึกเพิ่มเติม',
                detail,
                actor: timelineAuthor.name,
                tone: 'violet'
            }
        ];

        onUpdate?.(task.id, {
            timelineEntries: nextEntries,
            updatedAt: nowIso,
            updatedByName: timelineAuthor.name
        });
        setTimelineInput('');
    };

    // Upload file -> base64 fallback (works without Firebase)
    const handleFileChange = async (e) => {
        const files = Array.from(e.target.files);
        if (!files.length) return;
        setUploading(true);
        const newAtts = [];

        for (const file of files) {
            const type = file.type.startsWith('audio/') ? 'audio'
                : file.type.startsWith('video/') ? 'video'
                    : 'file';

            // Try Firebase Storage first
            let url = null;
            try {
                const storageRef = ref(storage, `tasks/${task.id}/${Date.now()}_${file.name}`);

                // 5-second timeout to prevent indefinite hanging if Firebase connection fails
                await Promise.race([
                    uploadBytes(storageRef, file),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Upload timeout')), 5000))
                ]);
                url = await getDownloadURL(storageRef);
            } catch (err) {
                console.warn("Storage upload failed or timed out, using local base64 fallback:", err.message);
                // Fallback: convert to base64 so it persists in localStorage
                url = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = (ev) => resolve(ev.target.result);
                    reader.readAsDataURL(file);
                });
            }

            newAtts.push({
                id: `att_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                type,
                name: file.name,
                url,
                size: file.size,
                addedAt: new Date().toISOString()
            });
        }

        const updated = [...attachments, ...newAtts];
        saveAttachments(updated);
        setUploading(false);
        e.target.value = '';
        setActiveTab('attachments');
    };

    const addLink = () => {
        if (!linkInput.trim()) return;
        const att = { id: `att_${Date.now()}`, type: 'link', name: linkLabel || linkInput, url: linkInput, addedAt: new Date().toISOString() };
        const updated = [...attachments, att];
        saveAttachments(updated);
        setLinkInput('');
        setLinkLabel('');
        setActiveTab('attachments');
    };

    const deleteAtt = (id) => {
        saveAttachments(attachments.filter(a => a.id !== id));
    };

    useEffect(() => {
        // Cleanup logic goes here when unmounting
    }, [task]);

    return createPortal(
        <div className="modal-backdrop fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 dark:bg-[#030303]/80 backdrop-blur-sm transition-colors duration-300">
            <div
                className="flex min-h-full items-center justify-center p-4 sm:p-6"
                onClick={e => e.target === e.currentTarget && onClose()}
            >
                <div className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-[2rem] shadow-2xl overflow-hidden flex flex-col animate-scale-in border border-transparent dark:border-white/10 transition-colors duration-200" style={{ maxHeight: '92vh' }}>
                    {/* Header */}
                    <div className="flex items-start gap-4 px-7 pt-7 pb-5 relative">
                        {/* Color bar */}
                        <div className="absolute top-0 left-0 w-full h-1" style={{ background: `linear-gradient(90deg, ${mainColor}, ${mainColor}66)` }} />
                        <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                                <span className="text-xs font-bold uppercase px-2.5 py-1 rounded-xl" style={{ background: `${mainColor}18`, color: mainColor }}>
                                    {task.type === 'team' ? 'Team Task' : 'Individual Task'}
                                </span>
                                {isAbandoned && (
                                    <span className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-xl border bg-slate-100 dark:bg-slate-700/40 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600/50">
                                        <Archive size={12} />
                                        Archived
                                    </span>
                                )}
                            </div>
                            <h2 className="text-xl font-black text-slate-900 dark:text-white leading-tight transition-colors">{displayTaskTitle || task.name}</h2>
                        </div>
                        <div className="mt-1 flex flex-col items-end gap-1.5 flex-shrink-0">
                            <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                                <X size={20} />
                            </button>
                            {questionLineMessageId && typeof onJumpToQuestion === 'function' && (
                                <button
                                    type="button"
                                    onClick={() => onJumpToQuestion(task, questionLineMessageId)}
                                    className="text-[11px] font-semibold px-2 py-0.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800 transition-colors"
                                >
                                    ไปที่คำถาม
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Tabs */}
                    <div className="flex gap-1 px-7 border-b border-slate-100 dark:border-white/10 pb-px transition-colors">
                        {[
                            { key: 'detail', label: 'Details' },
                        ].map(t => (
                            <button
                                key={t.key}
                                onClick={() => setActiveTab(t.key)}
                                className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-all duration-150
                ${activeTab === t.key ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto custom-scroll px-7 py-5" style={{ minHeight: 0 }}>

                        {/* DETAIL TAB */}
                        {activeTab === 'detail' && (
                            <div className="space-y-5">
                                <div>
                                    <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2 transition-colors">คำตอบจากการตอบกลับ</h3>
                                    <div className="min-h-[120px] rounded-2xl border border-slate-100 dark:border-white/10 bg-slate-50 dark:bg-white/5 p-4 transition-colors">
                                        {latestReplyAnswer ? (
                                            <>
                                                <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">
                                                    {latestReplyAnswer.text}
                                                </p>
                                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                                    <p className="text-[11px] text-slate-400 dark:text-slate-500">
                                                        โดย {latestReplyAnswer.by} • {formatDateTime(latestReplyAnswer.at)}
                                                    </p>
                                                    {latestReplyAnswer?.lineMessageId && typeof onJumpToReply === 'function' && (
                                                        <button
                                                            type="button"
                                                            onClick={() => onJumpToReply(task, latestReplyAnswer.lineMessageId)}
                                                            className="text-[11px] font-semibold px-2 py-0.5 rounded-lg border border-indigo-200 text-indigo-600 hover:bg-indigo-50 dark:border-indigo-500/40 dark:text-indigo-300 dark:hover:bg-indigo-500/10 transition-colors"
                                                        >
                                                            ไปที่คำตอบ
                                                        </button>
                                                    )}
                                                </div>
                                            </>
                                        ) : (
                                            <p className="text-sm italic text-slate-400 dark:text-slate-500">
                                                รอรับคำตอบจากการตอบกลับ...
                                            </p>
                                        )}
                                    </div>
                                </div>

                                {/* Meta grid */}
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="bg-slate-50 dark:bg-white/5 rounded-2xl p-4 border border-slate-100 dark:border-white/10 transition-colors">
                                        <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500 mb-1.5 transition-colors">
                                            <Calendar size={13} /> <span className="text-[10px] font-bold uppercase tracking-wider">Start Date</span>
                                        </div>
                                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 transition-colors">{formatDate(task.startDate) || '-'}</p>
                                    </div>
                                    <div className="rounded-2xl p-4 border transition-colors dark:bg-white/5" style={{ background: `${mainColor}08`, borderColor: `${mainColor}30` }}>
                                        <div className="flex items-center gap-2 mb-1.5" style={{ color: mainColor }}>
                                            <Calendar size={13} /> <span className="text-[10px] font-bold uppercase tracking-wider">Deadline</span>
                                        </div>
                                        <p className="text-sm font-bold" style={{ color: mainColor }}>{formatDate(task.deadline) || '-'}</p>
                                    </div>
                                </div>

                                {/* Assignees */}
                                <div>
                                    <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3 transition-colors">Assignees</h3>
                                    <div className="space-y-2">
                                        {assigneeRows.map(emp => (
                                            <div key={emp.id} className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/10 transition-colors">
                                                <Avatar name={emp.displayName || emp.name} color={emp.color} size={36} url={emp.avatar} />
                                                <div>
                                                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 transition-colors">{emp.displayName || emp.name}</p>
                                                    <p className="text-[11px] text-slate-400 dark:text-slate-500 transition-colors">{emp.displayPosition || emp.position}</p>
                                                </div>
                                            </div>
                                        ))}
                                        {assigneeRows.length === 0 && <p className="text-sm text-slate-400 italic">No assignee</p>}
                                    </div>
                                </div>
                            </div>
                        )}
                        {/* TIMELINE TAB */}
                        {activeTab === 'timeline' && (
                            <div className="space-y-4">
                                <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider transition-colors">
                                    Task Timeline
                                </h3>
                                <div className="rounded-2xl border border-slate-100 dark:border-white/10 bg-slate-50 dark:bg-white/5 p-4 transition-colors">
                                    <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
                                        เพิ่มบันทึก Timeline
                                    </p>
                                    <div className="space-y-2">
                                        <select
                                            className="input-field"
                                            value={timelineAuthorId}
                                            onChange={(e) => setTimelineAuthorId(e.target.value)}
                                        >
                                            <option value="">เลือกผู้เขียน</option>
                                            {employees.map((employee) => (
                                                <option key={employee.id} value={employee.id}>
                                                    {employee.name}
                                                </option>
                                            ))}
                                        </select>
                                        <textarea
                                            className="input-field resize-none min-h-[92px]"
                                            placeholder="พิมพ์อัปเดตหรือบันทึกเหตุการณ์ของงาน..."
                                            value={timelineInput}
                                            onChange={(e) => setTimelineInput(e.target.value)}
                                        />
                                        <div className="flex justify-end">
                                            <button
                                                onClick={addTimelineEntry}
                                                disabled={!timelineAuthorId || !timelineInput.trim()}
                                                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                <Plus size={14} /> บันทึกลง Timeline
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                {timelineEvents.length > 0 ? (
                                    <div className="relative pl-4">
                                        <div className="absolute left-[11px] top-0 bottom-0 w-[2px] bg-slate-200 dark:bg-slate-700/70 rounded-full" />
                                        <div className="space-y-4">
                                            {timelineEvents.map((event) => {
                                                const dotClass =
                                                    event.tone === 'emerald' ? 'bg-emerald-500'
                                                        : event.tone === 'amber' ? 'bg-amber-500'
                                                            : event.tone === 'indigo' ? 'bg-indigo-500'
                                                                : event.tone === 'blue' ? 'bg-blue-500'
                                                                    : event.tone === 'slate' ? 'bg-slate-500'
                                                                    : event.tone === 'violet' ? 'bg-violet-500'
                                                                        : 'bg-slate-400';
                                                return (
                                                    <div key={event.key} className="relative pl-7">
                                                        <span className={`absolute left-0 top-2 w-[10px] h-[10px] rounded-full ring-4 ring-white dark:ring-slate-900 ${dotClass}`} />
                                                        <div className="rounded-2xl border border-slate-100 dark:border-white/10 bg-slate-50 dark:bg-white/5 p-4 transition-colors">
                                                            <div className="flex items-start justify-between gap-3">
                                                                <p className="text-sm font-bold text-slate-800 dark:text-slate-200 transition-colors">{event.title}</p>
                                                                <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 whitespace-nowrap transition-colors">
                                                                    {formatDateTime(event.time)}
                                                                </span>
                                                            </div>
                                                            <p className="text-sm text-slate-600 dark:text-slate-300 mt-1.5 transition-colors">{event.detail}</p>
                                                            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-2 transition-colors">โดย {event.actor || unknownValue}</p>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-center py-6 text-slate-400 dark:text-slate-600 transition-colors">
                                        <Clock size={32} className="mx-auto mb-2 opacity-30 dark:opacity-20" />
                                        <p className="text-sm">ยังไม่มีประวัติ timeline ของงานนี้</p>
                                    </div>
                                )}
                            </div>
                        )}
                        {/* ATTACHMENTS TAB */}
                        {activeTab === 'attachments' && (
                            <div className="space-y-5">
                                {/* Upload area */}
                                <div
                                    className="border-2 border-dashed border-slate-200 dark:border-white/20 rounded-3xl p-6 text-center cursor-pointer hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-indigo-50/50 dark:hover:bg-indigo-500/10 transition-all duration-200"
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileChange}
                                        accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar" />
                                    {uploading ? (
                                        <div className="flex flex-col items-center gap-2">
                                            <div className="w-8 h-8 rounded-full border-3 border-indigo-200 dark:border-indigo-900 border-t-indigo-600 dark:border-t-indigo-500 animate-spin" />
                                            <p className="text-sm text-indigo-600 dark:text-indigo-400 font-medium">Uploading...</p>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="flex justify-center gap-3 mb-3 text-slate-300 dark:text-slate-600">
                                                <Paperclip size={22} /> <Mic size={22} /> <Video size={22} />
                                            </div>
                                            <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">Click to upload files</p>
                                            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Supports images, audio, video, PDF, Word, Excel, and more</p>
                                        </>
                                    )}
                                </div>

                                {/* Add link */}
                                <div className="bg-blue-50 dark:bg-blue-900/10 rounded-3xl p-4 border border-blue-100 dark:border-blue-900/50 transition-colors">
                                    <h3 className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                                        <Link2 size={12} /> Add link
                                    </h3>
                                    <div className="space-y-2">
                                        <input
                                            className="input-field text-sm"
                                            placeholder="Link label (optional)"
                                            value={linkLabel}
                                            onChange={e => setLinkLabel(e.target.value)}
                                        />
                                        <div className="flex gap-2">
                                            <input
                                                className="input-field text-sm flex-1"
                                                placeholder="https://..."
                                                type="url"
                                                value={linkInput}
                                                onChange={e => setLinkInput(e.target.value)}
                                                onKeyDown={e => e.key === 'Enter' && addLink()}
                                            />
                                            <button onClick={addLink} className="btn-primary flex-shrink-0 px-4">
                                                <Plus size={14} /> Add
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* Attachment list */}
                                {attachments.length > 0 ? (
                                    <div>
                                        <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3 transition-colors">Attachments ({attachments.length})</h3>
                                        <div className="space-y-2">
                                            {attachments.map(att => (
                                                <AttachmentItem key={att.id} att={att} onDelete={deleteAtt} />
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-center py-6 text-slate-400 dark:text-slate-600 transition-colors">
                                        <Paperclip size={32} className="mx-auto mb-2 opacity-30 dark:opacity-20" />
                                        <p className="text-sm">No attachments yet</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="flex flex-wrap items-center justify-between gap-3 px-7 py-5 border-t border-slate-100 dark:border-white/10 transition-colors bg-white/50 dark:bg-slate-900/50 backdrop-blur-md rounded-b-4xl">
                        <div className="flex flex-col items-start gap-1">
                            <button
                                onClick={handleArchiveToggle}
                                className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl transition-all ${isAbandoned
                                        ? 'text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-500/10'
                                        : 'text-amber-700 hover:text-amber-800 dark:text-amber-300 dark:hover:text-amber-200 hover:bg-amber-50 dark:hover:bg-amber-500/10'
                                    }`}
                            >
                                {isAbandoned ? <RotateCcw size={15} /> : <Archive size={15} />}
                                {isAbandoned ? 'กู้คืนงาน' : 'จัดเก็บ'}
                            </button>
                            {!isAbandoned && (
                                <p className="text-[10px] text-slate-400 dark:text-slate-500 pl-1">
                                    * เมื่อได้รับคำตอบแล้วจะจัดเก็บอัตโนมัติหลังจากได้รับคำตอบเกิน 5 วัน
                                </p>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <button onClick={onClose} className="btn-secondary">Close</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}

