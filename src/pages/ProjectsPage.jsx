import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import {
    FolderKanban, Users, MessageCircle, AlertCircle, CheckCircle,
    Clock, Send, Plus, Search, Trash2, RefreshCcw, Link2, X, Calendar, ChevronRight, Archive, Pencil, Check
} from 'lucide-react';
import { collection, query, where, orderBy, limit, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import TaskDetailModal from '../components/TaskDetailModal';
import { Avatar, StatusBadge, formatDate } from '../components/UI';

const COLORS = {
    primary: '#F28A1A',
    betimes: '#24387E',
    success: '#10b981',
    warning: '#f59e0b',
    danger: '#ef4444',
};

// Groups (dynamic from backend)

// Tasks (no mock data)
const mockTasks = [];
const LINE_GROUPS_BROWSER_CACHE_KEY = 'ceoflow_line_groups_v2';
const GROUP_TYPES_BROWSER_CACHE_KEY = 'ceoflow_group_types_v1';
const CLEAR_GROUPS_CONFIRM_TEXT = 'ลบข้อมูลกลุ่มทั้งหมด';
const DELETE_GROUP_CONFIRM_PREFIX = 'ลบกลุ่ม';
const GROUP_TYPE_VALUES = new Set(['unset', 'betimes', 'outsource', 'external']);
const ATTACHMENT_MESSAGE_TYPES = new Set(['image', 'video', 'audio', 'file']);
const TASK_POPUP_MAX = 6;
const REPLY_UNREAD_OVERDUE_MS = 7 * 24 * 60 * 60 * 1000;
const LINE_POPUP_ANIMATION_MS = 220;
const URL_IN_TEXT_REGEX = /(?:https?:\/\/|www\.)[^\s<>"']+/giu;

function readLineGroupsFromBrowserCache() {
    if (typeof window === 'undefined') {
        return [];
    }

    try {
        const raw = window.localStorage.getItem(LINE_GROUPS_BROWSER_CACHE_KEY);
        if (!raw) {
            return [];
        }

        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writeLineGroupsToBrowserCache(groups) {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        const payload = Array.isArray(groups) ? groups : [];
        window.localStorage.setItem(LINE_GROUPS_BROWSER_CACHE_KEY, JSON.stringify(payload));
    } catch {
        // ignore browser cache write errors
    }
}

function normalizeGroupType(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (GROUP_TYPE_VALUES.has(normalized)) {
        return normalized;
    }
    return 'unset';
}

function normalizeTaskStatus(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'completed' || normalized === 'abandoned' || normalized === 'in-progress') {
        return normalized;
    }

    return 'in-progress';
}

function readGroupTypesFromBrowserCache() {
    if (typeof window === 'undefined') {
        return {};
    }

    try {
        const raw = window.localStorage.getItem(GROUP_TYPES_BROWSER_CACHE_KEY);
        if (!raw) {
            return {};
        }

        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return {};
        }

        const out = {};
        for (const [groupId, type] of Object.entries(parsed)) {
            const normalizedGroupId = String(groupId || '').trim();
            if (!normalizedGroupId) {
                continue;
            }
            out[normalizedGroupId] = normalizeGroupType(type);
        }

        return out;
    } catch {
        return {};
    }
}

function writeGroupTypesToBrowserCache(typeMap) {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        const payload = typeMap && typeof typeMap === 'object' ? typeMap : {};
        window.localStorage.setItem(GROUP_TYPES_BROWSER_CACHE_KEY, JSON.stringify(payload));
    } catch {
        // ignore browser cache write errors
    }
}

function isGenericLineGroupName(name = '') {
    const normalized = String(name || '').trim();
    if (!normalized) {
        return true;
    }
    return normalized.toUpperCase().startsWith('LINE GROUP');
}

function normalizeMemberCount(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return 0;
    }
    return Math.floor(parsed);
}

function normalizeInGroup(value) {
    if (typeof value === 'boolean') {
        return value;
    }

    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
        return true;
    }

    if (normalized === 'false' || normalized === '0' || normalized === 'no') {
        return false;
    }

    return true;
}

function looksLikeLineGroupId(value) {
    return /^C[0-9a-f]{32}$/i.test(String(value || '').trim());
}

function normalizeMessageType(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized || 'text';
}

function normalizeChatText(value = '') {
    return String(value || '')
        .replace(/[\u200B-\u200D\uFEFF\u2028\u2029]/g, '')
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function normalizeExternalUrl(rawUrl = '') {
    let normalized = String(rawUrl || '').trim();
    if (!normalized) {
        return '';
    }

    normalized = normalized.replace(/[),.;!?]+$/u, '');
    if (/^www\./iu.test(normalized)) {
        normalized = `https://${normalized}`;
    }

    try {
        const parsed = new URL(normalized);
        const protocol = String(parsed.protocol || '').toLowerCase();
        if (protocol !== 'http:' && protocol !== 'https:') {
            return '';
        }
        return parsed.toString();
    } catch {
        return '';
    }
}

function renderMessageTextWithLinks(text = '') {
    const source = String(text || '');
    if (!source) {
        return '';
    }

    URL_IN_TEXT_REGEX.lastIndex = 0;
    const chunks = [];
    let cursor = 0;
    let match = URL_IN_TEXT_REGEX.exec(source);

    while (match) {
        const matchText = String(match[0] || '');
        const start = Number(match.index);
        if (start > cursor) {
            chunks.push({ kind: 'text', value: source.slice(cursor, start) });
        }

        const trimmedToken = matchText.replace(/[),.;!?]+$/u, '');
        const trailingText = matchText.slice(trimmedToken.length);
        const href = normalizeExternalUrl(trimmedToken);

        if (href) {
            chunks.push({ kind: 'link', value: trimmedToken, href });
            if (trailingText) {
                chunks.push({ kind: 'text', value: trailingText });
            }
        } else {
            chunks.push({ kind: 'text', value: matchText });
        }

        cursor = start + matchText.length;
        match = URL_IN_TEXT_REGEX.exec(source);
    }

    if (cursor < source.length) {
        chunks.push({ kind: 'text', value: source.slice(cursor) });
    }

    return chunks.map((chunk, index) => {
        if (chunk.kind !== 'link') {
            return <React.Fragment key={`text-${index}`}>{chunk.value}</React.Fragment>;
        }

        return (
            <a
                key={`link-${index}`}
                href={chunk.href}
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-1 underline-offset-2 text-sky-700 dark:text-sky-300 hover:text-sky-800 dark:hover:text-sky-200 break-all"
            >
                {chunk.value}
            </a>
        );
    });
}

function buildMessageDownloadUrl(viewUrl = '', fileName = '') {
    const rawViewUrl = String(viewUrl || '').trim();
    if (!rawViewUrl) {
        return '';
    }

    try {
        const origin = typeof window !== 'undefined' ? window.location.origin : 'https://ceoflow.pages.dev';
        const parsed = new URL(rawViewUrl, origin);
        if (!parsed.pathname.endsWith('/api/line-message-content')) {
            return rawViewUrl;
        }

        parsed.searchParams.set('download', '1');
        const safeName = String(fileName || '').trim();
        if (safeName) {
            parsed.searchParams.set('fileName', safeName);
        }

        if (typeof window !== 'undefined' && parsed.origin === window.location.origin) {
            return `${parsed.pathname}${parsed.search}`;
        }

        return parsed.toString();
    } catch {
        return rawViewUrl;
    }
}

function buildLocationMapUrl(message = {}) {
    const latitude = Number(message?.latitude);
    const longitude = Number(message?.longitude);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        return `https://www.google.com/maps?q=${encodeURIComponent(`${latitude},${longitude}`)}`;
    }

    const title = String(message?.locationTitle || '').trim();
    const address = String(message?.locationAddress || '').trim();
    const queryText = normalizeChatText([title, address].filter(Boolean).join(' '));
    if (!queryText) {
        return '';
    }

    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(queryText)}`;
}

function tryParseJsonObject(rawValue) {
    if (!rawValue) {
        return null;
    }

    if (typeof rawValue === 'object') {
        return rawValue;
    }

    const normalized = String(rawValue || '').trim();
    if (!normalized || (!normalized.startsWith('{') && !normalized.startsWith('['))) {
        return null;
    }

    try {
        const parsed = JSON.parse(normalized);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

function collectFlexTextNodes(node, output = [], depth = 0) {
    if (!node || depth > 7 || output.length >= 8) {
        return output;
    }

    if (Array.isArray(node)) {
        for (const item of node) {
            collectFlexTextNodes(item, output, depth + 1);
            if (output.length >= 8) {
                break;
            }
        }
        return output;
    }

    if (typeof node !== 'object') {
        return output;
    }

    if (String(node.type || '').toLowerCase() === 'text') {
        const textValue = normalizeChatText(node.text || '');
        if (textValue) {
            output.push(textValue);
        }
    }

    for (const value of Object.values(node)) {
        if (value && typeof value === 'object') {
            collectFlexTextNodes(value, output, depth + 1);
            if (output.length >= 8) {
                break;
            }
        }
    }

    return output;
}

function findFlexActionUrl(node, depth = 0) {
    if (!node || depth > 7) {
        return '';
    }

    if (Array.isArray(node)) {
        for (const item of node) {
            const found = findFlexActionUrl(item, depth + 1);
            if (found) {
                return found;
            }
        }
        return '';
    }

    if (typeof node !== 'object') {
        return '';
    }

    const direct = normalizeExternalUrl(node.uri || node.url || '');
    if (direct) {
        return direct;
    }

    for (const value of Object.values(node)) {
        if (value && typeof value === 'object') {
            const found = findFlexActionUrl(value, depth + 1);
            if (found) {
                return found;
            }
        }
    }

    return '';
}

function resolveFlexPreview(message = {}) {
    const candidates = [
        message?.flexContents,
        message?.contents,
        message?.text,
        message?.previewText
    ];

    let payload = null;
    let altText = normalizeChatText(message?.flexAltText || message?.altText || '');

    for (const candidate of candidates) {
        const parsed = tryParseJsonObject(candidate);
        if (!parsed) {
            continue;
        }

        if (String(parsed.type || '').toLowerCase() === 'flex' && parsed.contents) {
            payload = parsed.contents;
            altText = altText || normalizeChatText(parsed.altText || '');
            break;
        }

        payload = parsed;
        break;
    }

    const textNodes = collectFlexTextNodes(payload, []);
    const previewTitle = textNodes[0] || altText || normalizeChatText(message?.previewText || message?.text || '');
    const previewSubtitle = textNodes.slice(1, 3).join(' | ');
    const actionUrl = findFlexActionUrl(payload);

    return {
        title: previewTitle,
        subtitle: previewSubtitle,
        actionUrl
    };
}

function toMessageDate(value) {
    if (!value) {
        return null;
    }

    if (typeof value?.toDate === 'function') {
        return value.toDate();
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }

    return parsed;
}

function formatMessageDateTime(value) {
    const date = toMessageDate(value);
    if (!date) {
        return '-';
    }

    return new Intl.DateTimeFormat('th-TH', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
}

function formatMessageClock(value) {
    const date = toMessageDate(value);
    if (!date) {
        return '';
    }

    return new Intl.DateTimeFormat('th-TH', {
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
}

function getMessagePreviewFallback(type, raw) {
    switch (type) {
        case 'image':
            return '[รูปภาพ]';
        case 'video':
            return '[วิดีโอ]';
        case 'audio':
            return '[เสียง]';
        case 'file': {
            const fileName = String(raw?.fileName || '').trim();
            return fileName ? `[ไฟล์] ${fileName}` : '[ไฟล์แนบ]';
        }
        case 'flex':
            return '[Flex Message]';
        case 'sticker': {
            const stickerId = String(raw?.stickerId || '').trim();
            return stickerId ? `[สติกเกอร์ #${stickerId}]` : '[สติกเกอร์]';
        }
        case 'location':
            return '[ตำแหน่ง]';
        default:
            return `[${type}]`;
    }
}

function resolveMessageSenderName(message = {}, lineUserNameMap = new Map()) {
    if (message?.isBot) {
        return 'Aina-BT';
    }

    const embeddedSenderName = String(
        message?.senderName || message?.senderDisplayName || message?.displayName || ''
    ).trim();
    if (embeddedSenderName) {
        return embeddedSenderName;
    }

    const senderId = String(message?.lineUserId || '').trim();
    if (!senderId) {
        return 'ไม่ทราบผู้ส่ง';
    }

    return lineUserNameMap.get(senderId) || `LINE-${senderId.slice(-6)}`;
}

function normalizeMentionLookupToken(value = '') {
    return String(value || '')
        .replace(/^@+/u, '')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function buildMentionAliases(value = '') {
    const normalized = normalizeMentionLookupToken(value);
    if (!normalized) {
        return [];
    }

    const compactSpace = normalized.replace(/\s+/g, '');
    const compactSymbol = normalized.replace(/[^a-z0-9\u0E00-\u0E7F]/giu, '');
    return [...new Set([normalized, compactSpace, compactSymbol].filter(Boolean))];
}

function buildMentionCandidatesFromOutgoingText(text = '', groupUserNameByLineId = {}) {
    const sourceText = String(text || '');
    if (!sourceText) {
        return [];
    }

    const displayNameIndex = new Map();
    for (const [lineUserIdRaw, displayNameRaw] of Object.entries(groupUserNameByLineId || {})) {
        const lineUserId = String(lineUserIdRaw || '').trim();
        if (!/^U[0-9a-f]{32}$/i.test(lineUserId)) {
            continue;
        }

        for (const alias of buildMentionAliases(displayNameRaw)) {
            if (!displayNameIndex.has(alias)) {
                displayNameIndex.set(alias, lineUserId);
            }
        }
    }

    if (displayNameIndex.size === 0) {
        return [];
    }

    const mentions = [];
    const seen = new Set();
    const mentionRegex = /@[^\s]+/gu;
    let match = mentionRegex.exec(sourceText);
    while (match) {
        const token = String(match[0] || '').trim();
        const aliases = buildMentionAliases(token);
        const isAllMention = aliases.includes('all') || aliases.includes('everyone') || aliases.includes('ทุกคน');
        if (!isAllMention) {
            const lineUserId = aliases
                .map((alias) => displayNameIndex.get(alias) || '')
                .find(Boolean);

            if (lineUserId) {
                const mentionIndex = Number(match.index);
                const mentionLength = token.length;
                const dedupeKey = `${lineUserId}:${Number.isFinite(mentionIndex) ? mentionIndex : ''}`;

                if (!seen.has(dedupeKey)) {
                    seen.add(dedupeKey);
                    mentions.push({
                        userId: lineUserId,
                        index: Number.isFinite(mentionIndex) && mentionIndex >= 0 ? mentionIndex : undefined,
                        length: mentionLength > 0 ? mentionLength : undefined
                    });
                }
            }
        }

        if (mentions.length >= 80) {
            break;
        }

        match = mentionRegex.exec(sourceText);
    }

    return mentions;
}

function buildStickerImageUrl(stickerId = '') {
    const normalizedStickerId = String(stickerId || '').trim();
    if (!/^\d+$/.test(normalizedStickerId)) {
        return '';
    }

    return `https://stickershop.line-scdn.net/stickershop/v1/sticker/${normalizedStickerId}/android/sticker.png`;
}

function resolveStickerImageUrl(message = {}) {
    const previewImageUrl = String(message?.previewImageUrl || '').trim();
    if (previewImageUrl) {
        return previewImageUrl;
    }

    const stickerId = String(message?.stickerId || '').trim();
    if (stickerId) {
        return buildStickerImageUrl(stickerId);
    }

    const viewUrl = String(message?.viewUrl || '').trim();
    return viewUrl;
}

function isFallbackLineDisplayName(name = '') {
    return /^LINE-[A-Za-z0-9]{6}$/i.test(String(name || '').trim());
}

function pickPreferredDisplayName(currentName = '', candidateName = '') {
    const current = String(currentName || '').trim();
    const candidate = String(candidateName || '').trim();

    if (!candidate) {
        return current;
    }

    if (!current) {
        return candidate;
    }

    if (isFallbackLineDisplayName(current) && !isFallbackLineDisplayName(candidate)) {
        return candidate;
    }

    return current;
}

function normalizeMeetingSummaryTaskTitle(task = {}) {
    const fallbackTitle = String(task?.title || task?.name || '').trim();
    if (String(task?.source || '').trim().toLowerCase() !== 'line-meeting-summary') {
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

function resolveTaskTitle(task = {}) {
    const title = normalizeMeetingSummaryTaskTitle(task);
    if (title) {
        return title;
    }
    return 'งานใหม่จากสรุปแชท';
}

function readTaskReplyLineMessageIds(task = {}) {
    if (!Array.isArray(task?.replyLineMessageIds)) {
        return [];
    }

    return task.replyLineMessageIds
        .map((value) => String(value || '').trim())
        .filter(Boolean);
}

function getTaskLatestReplyMeta(task = {}) {
    const replyLineMessageIds = readTaskReplyLineMessageIds(task);
    const fallbackLineMessageId = replyLineMessageIds.length > 0
        ? replyLineMessageIds[replyLineMessageIds.length - 1]
        : '';

    let latestAt = null;
    let latestTimeMs = 0;
    let latestLineMessageId = fallbackLineMessageId;
    let hasReply = false;

    const useCandidate = (timeValue, lineMessageId = '') => {
        const parsedDate = toMessageDate(timeValue);
        if (!parsedDate) {
            return;
        }

        hasReply = true;
        const timeMs = parsedDate.getTime();
        if (timeMs >= latestTimeMs) {
            latestTimeMs = timeMs;
            latestAt = parsedDate;
            if (lineMessageId) {
                latestLineMessageId = lineMessageId;
            }
        }
    };

    const explicitReplyText = String(task?.replyAnswerText || '').trim();
    if (explicitReplyText || task?.replyAnswerAt) {
        hasReply = true;
        useCandidate(task?.replyAnswerAt || task?.lastUpdatedAt || task?.updatedAt, fallbackLineMessageId);
    }

    const timelineEntries = Array.isArray(task?.timelineEntries) ? task.timelineEntries : [];
    for (const entry of timelineEntries) {
        const lineMessageId = String(entry?.replyLineMessageId || '').trim();
        const title = String(entry?.title || '').trim();
        if (!lineMessageId && title !== 'ตอบกลับงานจาก LINE') {
            continue;
        }

        hasReply = true;
        useCandidate(entry?.time, lineMessageId || fallbackLineMessageId);
    }

    if (!hasReply && fallbackLineMessageId) {
        hasReply = true;
    }

    return {
        hasReply,
        at: latestAt,
        lineMessageId: String(latestLineMessageId || fallbackLineMessageId).trim()
    };
}

function getTaskReplyReadAt(task = {}) {
    return toMessageDate(task?.replyAnswerReadAt || task?.replyReadAt || task?.lastReplyReadAt || null);
}

function isTaskReplyUnread(task = {}) {
    const latestReply = getTaskLatestReplyMeta(task);
    if (!latestReply.hasReply) {
        return false;
    }

    const readAt = getTaskReplyReadAt(task);
    if (!readAt) {
        return true;
    }

    if (!latestReply.at) {
        return false;
    }

    return readAt.getTime() < latestReply.at.getTime();
}

function isTaskReplyUnreadOverdue(task = {}) {
    if (!isTaskReplyUnread(task)) {
        return false;
    }

    const latestReply = getTaskLatestReplyMeta(task);
    if (!latestReply.at) {
        return false;
    }

    return (Date.now() - latestReply.at.getTime()) >= REPLY_UNREAD_OVERDUE_MS;
}

function isLineMeetingSummaryTask(task = {}) {
    return String(task?.source || '').trim().toLowerCase() === 'line-meeting-summary';
}

function isRecentlyCreatedTask(task = {}, windowMs = 3 * 60 * 1000) {
    const createdAt = toMessageDate(task?.createdAt);
    if (!createdAt) {
        return false;
    }

    const ageMs = Date.now() - createdAt.getTime();
    return ageMs >= 0 && ageMs <= windowMs;
}

function formatTaskDeadline(deadline = '') {
    const normalized = String(deadline || '').trim();
    if (!normalized) {
        return '-';
    }

    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
        return normalized;
    }

    return new Intl.DateTimeFormat('th-TH', {
        year: 'numeric',
        month: 'short',
        day: '2-digit'
    }).format(parsed);
}

function GroupAvatar({ name, pictureUrl, color, sizeClass = 'w-10 h-10', textClass = 'text-sm' }) {
    const initial = String(name || '?').trim().charAt(0).toUpperCase() || '?';
    const hasPicture = Boolean(String(pictureUrl || '').trim());

    return (
        <div
            className={`${sizeClass} relative overflow-hidden rounded-xl shrink-0 flex items-center justify-center`}
            style={{ backgroundColor: color }}
        >
            <span className={`${textClass} font-bold text-white`}>{initial}</span>
            {hasPicture && (
                <img
                    src={pictureUrl}
                    alt={name || 'LINE Group'}
                    className="absolute inset-0 w-full h-full object-cover"
                    loading="lazy"
                    onError={(e) => {
                        e.currentTarget.style.display = 'none';
                    }}
                />
            )}
        </div>
    );
}

export default function ProjectsPage({ tasks, employees, projects = [], onUpdateTask, onDeleteTask }) {
    const [selectedGroup, setSelectedGroup] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [taskStatusFilter, setTaskStatusFilter] = useState('all');
    const [syncAllLoading, setSyncAllLoading] = useState(false);
    const [clearAllLoading, setClearAllLoading] = useState(false);
    const [lineGroups, setLineGroups] = useState(() => readLineGroupsFromBrowserCache());
    const [groupTypeMap, setGroupTypeMap] = useState(() => readGroupTypesFromBrowserCache());
    const [groupTypeSavingMap, setGroupTypeSavingMap] = useState({});
    const [deletingGroupId, setDeletingGroupId] = useState('');
    const [deletingTaskId, setDeletingTaskId] = useState('');
    const [syncingGroupId, setSyncingGroupId] = useState('');
    const [recountingGroupId, setRecountingGroupId] = useState('');
    const [archivingGroupId, setArchivingGroupId] = useState('');
    const [renamingGroupId, setRenamingGroupId] = useState('');
    const [renameValue, setRenameValue] = useState('');
    const [groupMessages, setGroupMessages] = useState([]);
    const [messagesLoading, setMessagesLoading] = useState(false);
    const [outgoingMessage, setOutgoingMessage] = useState('');
    const [replyTarget, setReplyTarget] = useState(null);
    const [sendingMessage, setSendingMessage] = useState(false);
    const [isLineSendPopupOpen, setIsLineSendPopupOpen] = useState(false);
    const [isLineSendPopupVisible, setIsLineSendPopupVisible] = useState(false);
    const [taskPopups, setTaskPopups] = useState([]);
    const [selectedTask, setSelectedTask] = useState(null);
    const [groupUserNameByLineId, setGroupUserNameByLineId] = useState({});
    const [pendingReplyJump, setPendingReplyJump] = useState(null);
    const [highlightedLineMessageId, setHighlightedLineMessageId] = useState('');
    const [optimisticCapturedTasks, setOptimisticCapturedTasks] = useState([]);
    const lineSendModalInputRef = useRef(null);
    const lineSendModalChatScrollRef = useRef(null);
    const seenTaskIdsRef = useRef(new Set());
    const initializedTaskIdsRef = useRef(false);
    const linePopupCloseTimerRef = useRef(null);

    const openLineSendPopup = useCallback(() => {
        if (linePopupCloseTimerRef.current) {
            clearTimeout(linePopupCloseTimerRef.current);
            linePopupCloseTimerRef.current = null;
        }

        setIsLineSendPopupVisible(false);
        setIsLineSendPopupOpen(true);

        requestAnimationFrame(() => {
            setIsLineSendPopupVisible(true);
        });
    }, []);

    const closeLineSendPopup = useCallback(() => {
        setIsLineSendPopupVisible(false);

        if (linePopupCloseTimerRef.current) {
            clearTimeout(linePopupCloseTimerRef.current);
            linePopupCloseTimerRef.current = null;
        }

        linePopupCloseTimerRef.current = setTimeout(() => {
            setIsLineSendPopupOpen(false);
            linePopupCloseTimerRef.current = null;
        }, LINE_POPUP_ANIMATION_MS);
    }, []);

    useEffect(() => {
        return () => {
            if (linePopupCloseTimerRef.current) {
                clearTimeout(linePopupCloseTimerRef.current);
            }
        };
    }, []);

    const loadLineGroups = useCallback(async () => {
        try {
            const res = await fetch('/api/list-groups');
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            const data = await res.json().catch(() => ({}));
            const raw = Array.isArray(data?.groups) ? data.groups : [];
            const mapped = raw
                .map((g) => {
                    const id = g.groupId || g.id;
                    if (!id) return null;
                    return {
                        id,
                        name: g.name || `LINE GROUP ${String(id).slice(-6)}`,
                        type: normalizeGroupType(g.groupType || g.type || 'unset'),
                        unread: 0,
                        members: normalizeMemberCount(g.memberCount ?? g.members),
                        pictureUrl: g.pictureUrl || null
                    };
                })
                .filter(Boolean);

            if (mapped.length > 0) {
                setLineGroups(mapped);
                writeLineGroupsToBrowserCache(mapped);

                const backendTypes = {};
                for (const group of mapped) {
                    backendTypes[group.id] = normalizeGroupType(group.type);
                }

                setGroupTypeMap((prev) => {
                    const next = {
                        ...(prev || {}),
                        ...backendTypes
                    };
                    writeGroupTypesToBrowserCache(next);
                    return next;
                });
                return;
            }

            setLineGroups([]);
            writeLineGroupsToBrowserCache([]);
        } catch (err) {
            console.error('Load LINE groups failed:', err);

            const cached = readLineGroupsFromBrowserCache();
            if (cached.length > 0) {
                setLineGroups(cached);
            }
        }
    }, []);

    useEffect(() => {
        loadLineGroups();
    }, [loadLineGroups]);

    useEffect(() => {
        const timer = setInterval(() => {
            loadLineGroups();
        }, 3600000);  // 1 ชั่วโมง

        return () => clearInterval(timer);
    }, [loadLineGroups]);

    useEffect(() => {
        const groupId = String(selectedGroup?.id || '').trim();
        if (!groupId || !db) {
            setGroupMessages([]);
            setMessagesLoading(false);
            return undefined;
        }

        setMessagesLoading(true);
        const messagesRef = collection(db, 'projects', groupId, 'messages');
        const messagesQuery = query(messagesRef, orderBy('createdAt', 'desc'));

        const unsubscribe = onSnapshot(
            messagesQuery,
            (snapshot) => {
                const rows = (snapshot.docs || []).map((docSnap) => {
                    const raw = docSnap.data() || {};
                    const type = normalizeMessageType(raw.type || raw.messageType);
                    const senderRole = String(raw.senderRole || '').trim().toLowerCase();
                    const lineUserId = String(raw.lineUserId || '').trim();
                    const isBot = senderRole === 'bot' || lineUserId === '__bot__' || lineUserId === 'bot';
                    const text = normalizeChatText(raw.text || '');
                    const previewText = type === 'text'
                        ? (text || normalizeChatText(raw.previewText || '') || getMessagePreviewFallback(type, raw))
                        : (normalizeChatText(raw.previewText || raw.text || '') || getMessagePreviewFallback(type, raw));
                    const externalContentUrl = String(raw.externalContentUrl || '').trim();
                    const lineMessageId = String(raw.lineMessageId || '').trim();
                    const quotedMessageId = String(raw.quotedMessageId || '').trim();
                    const quotedPreviewText = normalizeChatText(raw.quotedPreviewText || '');
                    const quoteToken = String(raw.quoteToken || '').trim();
                    const senderName = String(raw.senderName || raw.senderDisplayName || raw.displayName || '').trim();
                    const hasAttachmentType = ATTACHMENT_MESSAGE_TYPES.has(type);
                    const fallbackViewUrl = hasAttachmentType && lineMessageId
                        ? `/api/line-message-content?messageId=${encodeURIComponent(lineMessageId)}`
                        : '';
                    const viewUrl = String(raw.viewUrl || externalContentUrl || fallbackViewUrl).trim();
                    const hasAttachment = hasAttachmentType || Boolean(raw.hasAttachment && hasAttachmentType);
                    const latitude = Number(raw.latitude);
                    const longitude = Number(raw.longitude);

                    return {
                        id: docSnap.id,
                        type,
                        senderRole,
                        isBot,
                        senderName,
                        lineUserId,
                        lineMessageId,
                        quotedMessageId,
                        quotedPreviewText,
                        quoteToken,
                        text,
                        previewText,
                        fileName: String(raw.fileName || '').trim(),
                        packageId: String(raw.packageId || '').trim(),
                        stickerId: String(raw.stickerId || '').trim(),
                        fileSize: normalizeMemberCount(raw.fileSize),
                        createdAt: raw.createdAt || null,
                        createdAtText: formatMessageDateTime(raw.createdAt),
                        hasAttachment,
                        viewUrl,
                        previewImageUrl: String(raw.previewImageUrl || '').trim(),
                        flexAltText: String(raw.flexAltText || raw.altText || '').trim(),
                        flexContents: raw.flexContents || raw.contents || null,
                        locationTitle: String(raw.locationTitle || '').trim(),
                        locationAddress: String(raw.locationAddress || '').trim(),
                        latitude: Number.isFinite(latitude) ? latitude : null,
                        longitude: Number.isFinite(longitude) ? longitude : null
                    };
                });

                rows.sort((a, b) => {
                    const aTime = toMessageDate(a.createdAt)?.getTime() || 0;
                    const bTime = toMessageDate(b.createdAt)?.getTime() || 0;
                    if (aTime === bTime) {
                        return String(a.id || '').localeCompare(String(b.id || ''));
                    }
                    return aTime - bTime;
                });

                setGroupMessages(rows);
                setMessagesLoading(false);
            },
            (err) => {
                console.error('Load group messages failed:', err);
                setGroupMessages([]);
                setMessagesLoading(false);
            }
        );

        return () => unsubscribe();
    }, [selectedGroup?.id]);

    useEffect(() => {
        setTaskStatusFilter('all');
    }, [selectedGroup?.id]);

    useEffect(() => {
        if (!isLineSendPopupOpen || !isLineSendPopupVisible) {
            return;
        }

        const focusTimer = setTimeout(() => {
            lineSendModalInputRef.current?.focus();
        }, 0);

        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                closeLineSendPopup();
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => {
            clearTimeout(focusTimer);
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [closeLineSendPopup, isLineSendPopupOpen, isLineSendPopupVisible]);

    useEffect(() => {
        if (!isLineSendPopupOpen || !isLineSendPopupVisible) {
            return;
        }

        const chatPanel = lineSendModalChatScrollRef.current;
        if (!chatPanel) {
            return;
        }

        requestAnimationFrame(() => {
            chatPanel.scrollTop = chatPanel.scrollHeight;
        });
    }, [isLineSendPopupOpen, isLineSendPopupVisible, groupMessages.length]);

    useEffect(() => {
        const groupId = String(selectedGroup?.id || '').trim();
        if (!groupId || !db) {
            setGroupUserNameByLineId({});
            return undefined;
        }

        const groupUsersRef = collection(db, 'groupUsers');
        const groupUsersQuery = query(
            groupUsersRef,
            where('projectGroup', '==', groupId),
            limit(800)
        );

        const unsubscribe = onSnapshot(
            groupUsersQuery,
            (snapshot) => {
                const map = {};
                for (const docSnap of (snapshot.docs || [])) {
                    const raw = docSnap.data() || {};
                    const lineUserId = String(raw.userId || raw.lineUserId || docSnap.id || '').trim();
                    const displayName = String(raw.displayName || raw.name || '').trim();
                    if (!lineUserId || !displayName) {
                        continue;
                    }
                    map[lineUserId] = displayName;
                }

                setGroupUserNameByLineId(map);
            },
            (err) => {
                console.error('Load groupUsers failed:', err);
                setGroupUserNameByLineId({});
            }
        );

        return () => unsubscribe();
    }, [selectedGroup?.id]);

    useEffect(() => {
        const persistedTaskIds = new Set(
            (tasks || [])
                .map((task) => String(task?.id || '').trim())
                .filter(Boolean)
        );

        if (persistedTaskIds.size === 0) {
            return;
        }

        setOptimisticCapturedTasks((previous) => {
            const next = (previous || []).filter((task) => {
                const taskId = String(task?.id || '').trim();
                return taskId && !persistedTaskIds.has(taskId);
            });

            return next.length === (previous || []).length ? previous : next;
        });
    }, [tasks]);

    const handleSendGroupMessage = useCallback(async () => {
        const groupId = String(selectedGroup?.id || '').trim();
        const text = String(outgoingMessage || '').trim();
        const mentionCandidates = buildMentionCandidatesFromOutgoingText(text, groupUserNameByLineId);
        const activeReply = replyTarget && String(replyTarget?.lineMessageId || '').trim()
            ? replyTarget
            : null;

        if (!groupId || !text || sendingMessage) {
            return;
        }

        setSendingMessage(true);
        try {
            const res = await fetch('/api/send-group-message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    groupId,
                    text,
                    mentionCandidates,
                    replyToLineMessageId: activeReply?.lineMessageId || '',
                    replyPreviewText: activeReply?.previewText || ''
                })
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.detail || data?.error || 'ส่งข้อความไม่สำเร็จ');
            }

            // Show newly captured task immediately in UI while waiting for Firestore snapshot propagation.
            const taskCaptureTaskId = String(data?.taskCapture?.taskId || '').trim();
            const taskCaptureCreated = Boolean(data?.taskCapture?.created);
            if (taskCaptureCreated && taskCaptureTaskId) {
                const optimisticTask = {
                    id: taskCaptureTaskId,
                    projectId: groupId,
                    title: text,
                    name: text,
                    assignee: 'สมาชิกในกลุ่ม',
                    assignees: [],
                    lineAssigneeIds: [],
                    lineAssigneeNames: [],
                    status: 'in-progress',
                    type: 'individual',
                    source: 'line-tagged-task',
                    lineMessageId: taskCaptureTaskId.replace(/^line_task_/, ''),
                    sourceText: text,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    formatIssues: []
                };

                setOptimisticCapturedTasks((previous) => {
                    const exists = (previous || []).some((task) => {
                        return String(task?.id || '').trim() === taskCaptureTaskId;
                    });

                    if (exists) {
                        return previous;
                    }

                    return [optimisticTask, ...(previous || [])].slice(0, 120);
                });
            }

            setOutgoingMessage('');
            setReplyTarget(null);
        } catch (err) {
            console.error('Send group message failed:', err);
            alert(`ส่งข้อความไม่สำเร็จ: ${err.message}`);
        } finally {
            setSendingMessage(false);
        }
    }, [selectedGroup?.id, outgoingMessage, groupUserNameByLineId, replyTarget, sendingMessage]);

    const canSendGroupMessage = Boolean(
        selectedGroup && !sendingMessage && String(outgoingMessage || '').trim()
    );

    const handleDeleteTask = useCallback(async (task) => {
        const taskId = String(task?.id || '').trim();
        if (!taskId || deletingTaskId === taskId) {
            return;
        }

        if (typeof onDeleteTask !== 'function') {
            alert('ยังไม่สามารถลบงานได้ในตอนนี้');
            return;
        }

        const taskTitle = resolveTaskTitle(task);
        const confirmed = window.confirm(`ต้องการลบงาน "${taskTitle}" ใช่หรือไม่?`);
        if (!confirmed) {
            return;
        }

        setDeletingTaskId(taskId);
        try {
            await onDeleteTask(taskId);

            setOptimisticCapturedTasks((previous) => {
                return (previous || []).filter((item) => String(item?.id || '').trim() !== taskId);
            });

            setSelectedTask((current) => {
                const currentId = String(current?.id || '').trim();
                return currentId === taskId ? null : current;
            });
        } catch (err) {
            console.error('Delete task failed:', err);
            alert(`ลบงานไม่สำเร็จ: ${err?.message || 'Unknown error'}`);
        } finally {
            setDeletingTaskId('');
        }
    }, [deletingTaskId, onDeleteTask]);

    const handleCopyLiffRegisterLink = useCallback(async () => {
        const groupId = String(selectedGroup?.id || '').trim();
        if (!groupId) {
            alert('กรุณาเลือกกลุ่มก่อน');
            return;
        }

        const liffId = String(import.meta.env.VITE_LINE_LIFF_ID || '').trim();
        if (!liffId) {
            alert('ยังไม่ได้ตั้งค่า VITE_LINE_LIFF_ID ใน environment');
            return;
        }

        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        if (!origin) {
            alert('ไม่พบ URL ระบบสำหรับสร้างลิงก์ลงทะเบียน');
            return;
        }

        const registerUrl = `${origin}/liff-register.html?groupId=${encodeURIComponent(groupId)}&liffId=${encodeURIComponent(liffId)}`;

        try {
            if (navigator?.clipboard?.writeText) {
                await navigator.clipboard.writeText(registerUrl);
                alert('คัดลอกลิงก์ลงทะเบียน LIFF แล้ว');
                return;
            }
        } catch (err) {
            console.error('Copy LIFF register link failed:', err);
        }

        window.prompt('คัดลอกลิงก์นี้ไปส่งในกลุ่ม LINE', registerUrl);
    }, [selectedGroup?.id]);

    const handleClearAllGroups = useCallback(async () => {
        if (clearAllLoading) {
            return;
        }

        const typed = window.prompt(
            `พิมพ์ "${CLEAR_GROUPS_CONFIRM_TEXT}" เพื่อยืนยันการลบข้อมูลกลุ่มทั้งหมด`
        );

        if (typed === null) {
            return;
        }

        setClearAllLoading(true);
        try {
            const res = await fetch('/api/clear-groups', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ confirmText: typed })
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                if (data?.error === 'CONFIRMATION_MISMATCH') {
                    throw new Error(`ข้อความยืนยันไม่ถูกต้อง (ต้องพิมพ์: ${data.requiredText || CLEAR_GROUPS_CONFIRM_TEXT})`);
                }
                throw new Error(data?.detail || data?.error || 'ลบข้อมูลกลุ่มไม่สำเร็จ');
            }

            writeLineGroupsToBrowserCache([]);
            writeGroupTypesToBrowserCache({});
            setLineGroups([]);
            setGroupTypeMap({});
            setSelectedGroup(null);
            await loadLineGroups();

            alert('ลบข้อมูลกลุ่มทั้งหมดเรียบร้อยแล้ว');
        } catch (err) {
            console.error('Clear groups failed:', err);
            alert(`ลบข้อมูลกลุ่มไม่สำเร็จ: ${err.message}`);
        } finally {
            setClearAllLoading(false);
        }
    }, [clearAllLoading, loadLineGroups]);

    const handleGroupTypeChange = useCallback(async (groupId, nextType) => {
        const normalizedGroupId = String(groupId || '').trim();
        if (!normalizedGroupId) {
            return;
        }

        const normalizedType = normalizeGroupType(nextType);
        const previousType = normalizeGroupType((groupTypeMap || {})[normalizedGroupId] || 'unset');

        setGroupTypeMap((prev) => {
            const next = {
                ...(prev || {}),
                [normalizedGroupId]: normalizedType
            };
            writeGroupTypesToBrowserCache(next);
            return next;
        });

        setGroupTypeSavingMap((prev) => ({
            ...(prev || {}),
            [normalizedGroupId]: true
        }));

        try {
            const res = await fetch('/api/group-type', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    groupId: normalizedGroupId,
                    groupType: normalizedType
                })
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.detail || data?.error || 'บันทึกประเภทกลุ่มไม่สำเร็จ');
            }

            const persistedType = normalizeGroupType(data?.groupType || normalizedType);
            setGroupTypeMap((prev) => {
                const next = {
                    ...(prev || {}),
                    [normalizedGroupId]: persistedType
                };
                writeGroupTypesToBrowserCache(next);
                return next;
            });

            await loadLineGroups();
        } catch (err) {
            console.error('Save group type failed:', err);

            setGroupTypeMap((prev) => {
                const next = {
                    ...(prev || {}),
                    [normalizedGroupId]: previousType
                };
                writeGroupTypesToBrowserCache(next);
                return next;
            });

            alert(`บันทึกประเภทกลุ่มไม่สำเร็จ: ${err.message}`);
        } finally {
            setGroupTypeSavingMap((prev) => {
                const next = { ...(prev || {}) };
                delete next[normalizedGroupId];
                return next;
            });
        }
    }, [groupTypeMap, loadLineGroups]);

    const handleRenameGroup = useCallback(async (groupId, newName) => {
        const id = String(groupId || '').trim();
        const name = String(newName || '').trim();
        if (!id || !name) {
            setRenamingGroupId('');
            return;
        }
        if (!db) {
            setLineGroups((prev) => prev.map((g) => g.id === id ? { ...g, name } : g));
            setRenamingGroupId('');
            return;
        }
        try {
            await updateDoc(doc(db, 'projects', id), { name, updatedAt: new Date().toISOString() });
            setLineGroups((prev) => prev.map((g) => g.id === id ? { ...g, name } : g));
        } catch (err) {
            console.error('Rename group failed:', err);
            alert(`เปลี่ยนชื่อกลุ่มไม่สำเร็จ: ${err?.message || 'Unknown error'}`);
        } finally {
            setRenamingGroupId('');
        }
    }, []);

    const handleDeleteGroup = useCallback(async (group) => {
        const groupId = String(group?.id || '').trim();
        const groupName = String(group?.name || `LINE GROUP ${groupId.slice(-6)}`).trim();
        if (!groupId || deletingGroupId) {
            return;
        }

        const confirmed = window.confirm(`${DELETE_GROUP_CONFIRM_PREFIX} "${groupName}" ใช่หรือไม่?`);
        if (!confirmed) {
            return;
        }

        setDeletingGroupId(groupId);
        try {
            const res = await fetch('/api/delete-group', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ groupId })
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.detail || data?.error || 'ลบกลุ่มไม่สำเร็จ');
            }

            setLineGroups((prev) => {
                const next = (prev || []).filter((item) => item.id !== groupId);
                writeLineGroupsToBrowserCache(next);
                return next;
            });

            setGroupTypeMap((prev) => {
                const next = { ...(prev || {}) };
                delete next[groupId];
                writeGroupTypesToBrowserCache(next);
                return next;
            });

            setSelectedGroup((prev) => (prev?.id === groupId ? null : prev));
            await loadLineGroups();
            alert(`ลบข้อมูลกลุ่ม ${groupName} เรียบร้อย`);
        } catch (err) {
            console.error('Delete group failed:', err);
            alert(`ลบข้อมูลกลุ่มไม่สำเร็จ: ${err.message}`);
        } finally {
            setDeletingGroupId('');
        }
    }, [deletingGroupId, loadLineGroups]);

    const handleSyncGroup = useCallback(async (group) => {
        const groupId = String(group?.id || '').trim();
        const groupName = String(group?.name || `LINE GROUP ${groupId.slice(-6)}`).trim();

        if (!groupId || syncingGroupId || deletingGroupId === groupId) {
            return;
        }

        setSyncingGroupId(groupId);
        try {
            const res = await fetch('/api/sync-group', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ groupId })
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.detail || data?.error || 'Sync failed');
            }

            await loadLineGroups();

            const attempted = Number(data?.syncResult?.membersAttempted || 0);
            const synced = Number(data?.syncResult?.membersSynced || 0);
            const memberCount = Number(data?.syncResult?.memberCount || 0);
            const teamAttempted = Number(data?.teamSyncResult?.attempted ?? data?.syncResult?.teamSyncResult?.attempted ?? 0);
            const teamSynced = Number(data?.teamSyncResult?.synced ?? data?.syncResult?.teamSyncResult?.synced ?? 0);
            const teamReal = Number(data?.teamSyncResult?.discoveredMembers ?? data?.syncResult?.teamSyncResult?.discoveredMembers ?? 0);
            const teamPlaceholder = Number(data?.teamSyncResult?.placeholders?.synced ?? data?.syncResult?.teamSyncResult?.placeholders?.synced ?? 0);

            if (attempted > 0 && synced >= 0) {
                alert(`ซิงก์กลุ่ม ${groupName} เรียบร้อย (สมาชิก ${synced}/${attempted}, count=${memberCount}, ทีมงาน ${teamSynced}/${teamAttempted}, จริง ${teamReal}, สำรอง ${teamPlaceholder})`);
            } else {
                alert(`ซิงก์กลุ่ม ${groupName} เรียบร้อย (count=${memberCount}, ทีมงาน ${teamSynced}/${teamAttempted}, จริง ${teamReal}, สำรอง ${teamPlaceholder})`);
            }

            // Force full UI refresh after sync so every panel reflects latest server state.
            window.location.reload();
        } catch (err) {
            console.error('Sync group failed:', err);
            alert(`ซิงก์กลุ่มไม่สำเร็จ: ${err.message}`);
        } finally {
            setSyncingGroupId('');
        }
    }, [syncingGroupId, deletingGroupId, loadLineGroups]);

    const handleRecountGroupMembers = useCallback(async (group) => {
        const groupId = String(group?.id || '').trim();
        const groupName = String(group?.name || `LINE GROUP ${groupId.slice(-6)}`).trim();

        if (!groupId || recountingGroupId || deletingGroupId === groupId) {
            return;
        }

        setRecountingGroupId(groupId);
        try {
            const res = await fetch('/api/recount-group-members', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ groupId })
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.detail || data?.error || 'รีนับสมาชิกไม่สำเร็จ');
            }

            await loadLineGroups();

            const recount = data?.recountResult || {};
            const memberCount = Number(recount?.memberCount || 0);
            const fromMessages = Number(recount?.fromMessages || 0);
            const fromGroupUsers = Number(recount?.fromGroupUsers || 0);
            const fromKvMembers = Number(recount?.fromKvMembers || 0);
            alert(`รีนับสมาชิก ${groupName} แล้ว: ${memberCount} คน (messages=${fromMessages}, groupUsers=${fromGroupUsers}, kv=${fromKvMembers})`);
        } catch (err) {
            console.error('Recount group members failed:', err);
            alert(`รีนับสมาชิกไม่สำเร็จ: ${err.message}`);
        } finally {
            setRecountingGroupId('');
        }
    }, [recountingGroupId, deletingGroupId, loadLineGroups]);

    const handleArchiveGroupTasks = useCallback(async (group) => {
        const groupId = String(group?.id || '').trim();
        const groupName = String(group?.name || `LINE GROUP ${groupId.slice(-6)}`).trim();

        if (!groupId || archivingGroupId) {
            return;
        }

        const targetTasks = (tasks || []).filter((task) => {
            const taskGroupId = String(task?.projectId || '').trim();
            const taskStatus = String(task?.status || '').trim().toLowerCase();
            return taskGroupId === groupId && taskStatus !== 'abandoned';
        });

        if (targetTasks.length === 0) {
            alert('ไม่พบ task ที่พร้อมจัดเก็บในกลุ่มนี้');
            return;
        }

        const confirmed = window.confirm(`ต้องการจัดเก็บ task ของกลุ่ม "${groupName}" จำนวน ${targetTasks.length} รายการใช่หรือไม่?`);
        if (!confirmed) {
            return;
        }

        setArchivingGroupId(groupId);

        const nowIso = new Date().toISOString();
        try {
            const updateJobs = targetTasks.map((task) => Promise.resolve(
                onUpdateTask?.(task.id, {
                    status: 'abandoned',
                    updatedAt: nowIso,
                    updatedByName: 'Web UI',
                    abandonedAt: nowIso,
                    abandonedByName: 'Web UI',
                    abandonedNote: 'จัดเก็บงานทั้งกลุ่ม'
                })
            ));

            const settled = await Promise.allSettled(updateJobs);
            const failed = settled.filter((result) => result.status === 'rejected').length;

            if (failed > 0) {
                alert(`จัดเก็บงานสำเร็จ ${targetTasks.length - failed}/${targetTasks.length} รายการ`);
            } else {
                alert(`จัดเก็บ task ของกลุ่ม ${groupName} เรียบร้อย (${targetTasks.length} รายการ)`);
            }
        } catch (err) {
            console.error('Archive group tasks failed:', err);
            alert(`จัดเก็บ task ไม่สำเร็จ: ${err.message}`);
        } finally {
            setArchivingGroupId('');
        }
    }, [archivingGroupId, onUpdateTask, tasks]);

    // รวม projects จาก Firestore + LINE groups จาก API
    const groups = useMemo(() => {
        const map = new Map();
        const taskCountByProjectId = new Map();

        for (const task of (tasks || [])) {
            const projectId = String(task?.projectId || '').trim();
            if (!projectId) {
                continue;
            }

            const currentCount = Number(taskCountByProjectId.get(projectId) || 0);
            taskCountByProjectId.set(projectId, currentCount + 1);
        }

        const visibleLineGroupIds = new Set(
            (lineGroups || [])
                .map((g) => String(g?.id || '').trim())
                .filter(Boolean)
        );
        const hasVisibleLineGroups = visibleLineGroupIds.size > 0;

        for (const p of (projects || [])) {
            const projectId = String(p?.id || '').trim();
            if (!projectId) continue;

            if (!normalizeInGroup(p?.inGroup)) {
                continue;
            }

            const source = String(p?.source || '').trim().toLowerCase();
            const isLineLikeProject =
                source === 'line-group' ||
                looksLikeLineGroupId(projectId) ||
                isGenericLineGroupName(p?.name || '');

            // Hide stale LINE projects that are no longer returned by list-groups.
            if (isLineLikeProject && hasVisibleLineGroups && !visibleLineGroupIds.has(projectId)) {
                continue;
            }

            map.set(projectId, {
                id: projectId,
                name: p.name || 'LINE GROUP',
                type: normalizeGroupType(p.groupType || p.type || 'unset'),
                unread: 0,
                members: normalizeMemberCount(p.memberCount ?? p.members),
                pictureUrl: p.pictureUrl || null
            });
        }

        for (const g of (lineGroups || [])) {
            if (!g?.id) continue;
            if (map.has(g.id)) {
                const current = map.get(g.id);
                const preferLineGroupName =
                    isGenericLineGroupName(current?.name) && !isGenericLineGroupName(g?.name);
                map.set(g.id, {
                    ...current,
                    name: preferLineGroupName
                        ? g.name
                        : (current.name || g.name || 'LINE GROUP'),
                    type: normalizeGroupType(current.type || g.type || 'unset'),
                    members: normalizeMemberCount(g.members) || normalizeMemberCount(current.members),
                    pictureUrl: g.pictureUrl || current.pictureUrl || null
                });
            } else {
                map.set(g.id, {
                    ...g,
                    type: normalizeGroupType(g.type || 'unset')
                });
            }
        }

        const merged = [...map.values()].map((group) => ({
            ...group,
            type: normalizeGroupType((groupTypeMap || {})[group.id] || group.type || 'unset'),
            unread: Number(taskCountByProjectId.get(String(group?.id || '').trim()) || 0)
        }));

        merged.sort((left, right) => {
            const leftUnread = Number(left?.unread || 0);
            const rightUnread = Number(right?.unread || 0);

            if (rightUnread !== leftUnread) {
                return rightUnread - leftUnread;
            }

            const leftName = String(left?.name || '').trim();
            const rightName = String(right?.name || '').trim();
            return leftName.localeCompare(rightName, 'th');
        });

        return merged;
    }, [projects, lineGroups, groupTypeMap, tasks]);

    const groupNameMap = useMemo(() => {
        const map = new Map();
        for (const group of (groups || [])) {
            const groupId = String(group?.id || '').trim();
            if (!groupId) {
                continue;
            }

            map.set(groupId, String(group?.name || `LINE GROUP ${groupId.slice(-6)}`).trim());
        }
        return map;
    }, [groups]);

    useEffect(() => {
        const rows = Array.isArray(tasks) ? tasks : [];

        if (!initializedTaskIdsRef.current) {
            seenTaskIdsRef.current = new Set(
                rows
                    .map((task) => String(task?.id || '').trim())
                    .filter(Boolean)
            );
            initializedTaskIdsRef.current = true;
            return;
        }

        const nextPopups = [];

        for (const task of rows) {
            const taskId = String(task?.id || '').trim();
            if (!taskId) {
                continue;
            }

            if (seenTaskIdsRef.current.has(taskId)) {
                continue;
            }
            seenTaskIdsRef.current.add(taskId);

            if (!isLineMeetingSummaryTask(task) || !isRecentlyCreatedTask(task)) {
                continue;
            }

            nextPopups.push({
                id: taskId,
                taskId,
                projectId: String(task?.projectId || '').trim(),
                title: resolveTaskTitle(task),
                deadline: String(task?.deadline || '').trim(),
                createdAt: task?.createdAt || null,
                status: String(task?.status || 'in-progress').trim().toLowerCase(),
                type: String(task?.type || 'individual').trim().toLowerCase(),
                assignee: String(task?.assignee || '').trim(),
                assignees: Array.isArray(task?.assignees) ? task.assignees.filter(Boolean).slice(0, 4) : []
            });
        }

        if (nextPopups.length > 0) {
            setTaskPopups((prev) => {
                const mergedPopups = [...nextPopups, ...prev]
                    .map((popup) => {
                        const matchingTask = (tasks || []).find((task) => String(task?.id || '').trim() === String(popup?.taskId || '').trim());
                        if (!matchingTask) {
                            return popup;
                        }

                        const hasUnreadReply = isTaskReplyUnread(matchingTask);
                        const unreadReplyOverdue = isTaskReplyUnreadOverdue(matchingTask);
                        return {
                            ...popup,
                            hasUnreadReply,
                            unreadReplyOverdue
                        };
                    })
                    .slice(0, TASK_POPUP_MAX);

                return mergedPopups;
            });
        }
    }, [tasks]);

    useEffect(() => {
        setTaskPopups((prev) => prev.map((popup) => {
            const task = (tasks || []).find((row) => String(row?.id || '').trim() === String(popup?.taskId || '').trim());
            if (!task) {
                return popup;
            }

            const hasUnreadReply = isTaskReplyUnread(task);
            const unreadReplyOverdue = isTaskReplyUnreadOverdue(task);
            if (popup.hasUnreadReply === hasUnreadReply && popup.unreadReplyOverdue === unreadReplyOverdue) {
                return popup;
            }

            return {
                ...popup,
                hasUnreadReply,
                unreadReplyOverdue
            };
        }));
    }, [tasks]);

    const dismissTaskPopup = useCallback((popupId) => {
        const normalizedPopupId = String(popupId || '').trim();
        if (!normalizedPopupId) {
            return;
        }

        setTaskPopups((prev) => prev.filter((popup) => popup.id !== normalizedPopupId));
    }, []);

    const dismissAllTaskPopups = useCallback(() => {
        setTaskPopups([]);
    }, []);

    const openTaskFromPopup = useCallback((popup) => {
        const normalizedTaskId = String(popup?.taskId || '').trim();
        if (!normalizedTaskId) {
            return;
        }

        const targetGroupId = String(popup?.projectId || '').trim();
        if (targetGroupId) {
            const targetGroup = groups.find((group) => String(group?.id || '').trim() === targetGroupId);
            if (targetGroup) {
                setSelectedGroup(targetGroup);
            }
        }

        const latestTask = (tasks || []).find((task) => String(task?.id || '').trim() === normalizedTaskId);
        if (latestTask) {
            setSelectedTask(latestTask);
        }

        dismissTaskPopup(String(popup?.id || normalizedTaskId));
    }, [dismissTaskPopup, groups, tasks]);

    useEffect(() => {
        if (!selectedTask) {
            return;
        }

        const selectedTaskId = String(selectedTask?.id || '').trim();
        if (!selectedTaskId) {
            setSelectedTask(null);
            return;
        }

        const latestTask = (tasks || []).find((task) => String(task?.id || '').trim() === selectedTaskId);
        if (!latestTask) {
            setSelectedTask(null);
            return;
        }

        if (latestTask !== selectedTask) {
            setSelectedTask(latestTask);
        }
    }, [selectedTask, tasks]);

    // เมื่อ projects เปลี่ยน ให้เลือก group แรกอัตโนมัติ
    useEffect(() => {
        if (groups.length === 0) {
            if (selectedGroup) setSelectedGroup(null);
            return;
        }

        if (!selectedGroup) {
            setSelectedGroup(groups[0]);
            return;
        }

        const latest = groups.find((g) => g.id === selectedGroup.id);
        if (!latest) {
            setSelectedGroup(groups[0]);
            return;
        }

        const hasDisplayChange =
            latest.name !== selectedGroup.name ||
            latest.pictureUrl !== selectedGroup.pictureUrl ||
            latest.type !== selectedGroup.type ||
            latest.members !== selectedGroup.members;

        if (hasDisplayChange) {
            setSelectedGroup(latest);
        }
    }, [groups, selectedGroup]);

    useEffect(() => {
        setReplyTarget(null);
    }, [selectedGroup?.id]);

    const handleJumpToTaskMessage = useCallback((task, lineMessageId, options = {}) => {
        const targetLineMessageId = String(lineMessageId || '').trim();
        const targetProjectId = String(task?.projectId || '').trim();
        const taskId = String(task?.id || '').trim();
        const markReplyRead = Boolean(options?.markReplyRead);
        const missingTargetAlert = String(options?.missingTargetAlert || 'ไม่พบตำแหน่งข้อความในแชท').trim();
        const missingLoadedAlert = String(options?.missingLoadedAlert || 'ไม่พบข้อความที่เลือกในประวัติแชทที่โหลดไว้').trim();

        if (!targetLineMessageId || !targetProjectId) {
            alert(missingTargetAlert);
            return;
        }

        if (markReplyRead && taskId) {
            onUpdateTask?.(taskId, {
                replyAnswerReadAt: new Date().toISOString(),
                replyAnswerReadBy: 'Web UI'
            });
        }

        if (String(selectedGroup?.id || '').trim() !== targetProjectId) {
            const targetGroup = groups.find((group) => String(group?.id || '').trim() === targetProjectId);
            if (targetGroup) {
                setSelectedGroup(targetGroup);
            }
        }

        openLineSendPopup();

        setPendingReplyJump({
            projectId: targetProjectId,
            lineMessageId: targetLineMessageId,
            requestedAt: Date.now(),
            missingLoadedAlert
        });
        setSelectedTask(null);
    }, [groups, onUpdateTask, openLineSendPopup, selectedGroup?.id]);

    const handleJumpToTaskReply = useCallback((task, lineMessageId) => {
        handleJumpToTaskMessage(task, lineMessageId, {
            markReplyRead: true,
            missingTargetAlert: 'ไม่พบตำแหน่งคำตอบในแชท',
            missingLoadedAlert: 'ไม่พบข้อความคำตอบในประวัติแชทที่โหลดไว้'
        });
    }, [handleJumpToTaskMessage]);

    const handleJumpToTaskQuestion = useCallback((task, lineMessageId) => {
        handleJumpToTaskMessage(task, lineMessageId, {
            markReplyRead: false,
            missingTargetAlert: 'ไม่พบตำแหน่งคำถามในแชท',
            missingLoadedAlert: 'ไม่พบข้อความคำถามในประวัติแชทที่โหลดไว้'
        });
    }, [handleJumpToTaskMessage]);

    useEffect(() => {
        if (!pendingReplyJump) {
            return;
        }

        const activeGroupId = String(selectedGroup?.id || '').trim();
        if (!activeGroupId || activeGroupId !== pendingReplyJump.projectId || messagesLoading) {
            return;
        }

        const targetLineMessageId = String(pendingReplyJump.lineMessageId || '').trim();
        if (!targetLineMessageId) {
            setPendingReplyJump(null);
            return;
        }

        const hasTargetMessage = (groupMessages || []).some((message) =>
            String(message?.lineMessageId || '').trim() === targetLineMessageId
        );

        if (!hasTargetMessage) {
            if (Date.now() - Number(pendingReplyJump.requestedAt || 0) > 2400) {
                const missingLoadedAlert = String(pendingReplyJump?.missingLoadedAlert || '').trim()
                    || 'ไม่พบข้อความที่เลือกในประวัติแชทที่โหลดไว้';
                alert(missingLoadedAlert);
                setPendingReplyJump(null);
            }
            return;
        }

        if (!isLineSendPopupOpen || !isLineSendPopupVisible) {
            return;
        }

        const chatRoot = lineSendModalChatScrollRef.current;
        if (!chatRoot) {
            return;
        }

        const messageNodes = chatRoot.querySelectorAll('[data-line-message-id]');
        let targetNode = null;

        for (const node of messageNodes) {
            const nodeLineMessageId = String(node.getAttribute('data-line-message-id') || '').trim();
            if (nodeLineMessageId === targetLineMessageId) {
                targetNode = node;
                break;
            }
        }

        if (!targetNode) {
            return;
        }

        targetNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightedLineMessageId(targetLineMessageId);
        setPendingReplyJump(null);

        setTimeout(() => {
            setHighlightedLineMessageId((currentValue) =>
                currentValue === targetLineMessageId ? '' : currentValue
            );
        }, 3000);
    }, [pendingReplyJump, selectedGroup?.id, messagesLoading, groupMessages, isLineSendPopupOpen, isLineSendPopupVisible]);

    const visibleTasks = useMemo(() => {
        const mergedById = new Map();

        for (const task of (optimisticCapturedTasks || [])) {
            const taskId = String(task?.id || '').trim();
            if (!taskId) {
                continue;
            }

            mergedById.set(taskId, task);
        }

        for (const task of (tasks || [])) {
            const taskId = String(task?.id || '').trim();
            if (!taskId) {
                continue;
            }

            // Persisted Firestore docs always win over optimistic placeholders.
            mergedById.set(taskId, task);
        }

        return [...mergedById.values()];
    }, [optimisticCapturedTasks, tasks]);

    const selectedGroupTasks = useMemo(() => {
        if (!selectedGroup) {
            return [];
        }

        return visibleTasks.filter((task) => {
            return String(task?.projectId || '').trim() === String(selectedGroup.id || '').trim();
        });
    }, [selectedGroup, visibleTasks]);

    const taskStatusCounts = useMemo(() => {
        const counts = {
            all: selectedGroupTasks.length,
            'in-progress': 0,
            completed: 0,
            abandoned: 0
        };

        for (const task of selectedGroupTasks) {
            const status = normalizeTaskStatus(task?.status);
            if (status === 'completed') {
                counts.completed += 1;
                continue;
            }

            if (status === 'abandoned') {
                counts.abandoned += 1;
                continue;
            }

            counts['in-progress'] += 1;
        }

        return counts;
    }, [selectedGroupTasks]);

    const filteredTasks = useMemo(() => {
        const normalizedSearch = String(searchTerm || '').trim().toLowerCase();

        return selectedGroupTasks.filter((task) => {
            const status = normalizeTaskStatus(task?.status);
            if (taskStatusFilter !== 'all' && status !== taskStatusFilter) {
                return false;
            }

            if (!normalizedSearch) {
                return true;
            }

            const taskName = String(task?.name || '').toLowerCase();
            const taskTitle = String(task?.title || '').toLowerCase();
            return taskName.includes(normalizedSearch) || taskTitle.includes(normalizedSearch);
        });
    }, [searchTerm, selectedGroupTasks, taskStatusFilter]);

    const taskStatusFilters = useMemo(() => {
        return [
            { value: 'all', label: 'ทั้งหมด', count: taskStatusCounts.all },
            { value: 'in-progress', label: 'กำลังทำ', count: taskStatusCounts['in-progress'] },
            { value: 'completed', label: 'เสร็จแล้ว', count: taskStatusCounts.completed },
            { value: 'abandoned', label: 'จัดเก็บ', count: taskStatusCounts.abandoned }
        ];
    }, [taskStatusCounts]);

    const lineUserNameMap = useMemo(() => {
        const map = new Map();

        for (const [lineUserId, displayName] of Object.entries(groupUserNameByLineId || {})) {
            const normalizedLineUserId = String(lineUserId || '').trim();
            const normalizedName = String(displayName || '').trim();
            if (!normalizedLineUserId || !normalizedName) {
                continue;
            }

            const currentName = map.get(normalizedLineUserId) || '';
            map.set(normalizedLineUserId, pickPreferredDisplayName(currentName, normalizedName));
        }

        for (const employee of (employees || [])) {
            const lineUserId = String(employee?.lineUserId || '').trim();
            if (!lineUserId) {
                continue;
            }

            const displayName = String(employee?.name || employee?.fullName || '').trim();
            if (!displayName) {
                continue;
            }

            const currentName = map.get(lineUserId) || '';
            map.set(lineUserId, pickPreferredDisplayName(currentName, displayName));
        }
        return map;
    }, [employees, groupUserNameByLineId]);

    const messageByLineId = useMemo(() => {
        const map = new Map();
        for (const message of (groupMessages || [])) {
            const lineMessageId = String(message?.lineMessageId || '').trim();
            if (!lineMessageId || map.has(lineMessageId)) {
                continue;
            }
            map.set(lineMessageId, message);
        }
        return map;
    }, [groupMessages]);

    const employeeById = useMemo(() => {
        const map = new Map();
        for (const employee of (employees || [])) {
            const employeeId = String(employee?.id || '').trim();
            if (!employeeId) {
                continue;
            }
            map.set(employeeId, employee);
        }
        return map;
    }, [employees]);

    const handleReplyToMessage = useCallback((message) => {
        const lineMessageId = String(message?.lineMessageId || '').trim();
        if (!lineMessageId) {
            return;
        }

        const senderName = resolveMessageSenderName(message, lineUserNameMap);

        const previewText = String(message?.previewText || message?.text || '').trim()
            || getMessagePreviewFallback(normalizeMessageType(message?.type), message);

        setReplyTarget({
            lineMessageId,
            senderName,
            previewText: previewText.slice(0, 320)
        });
    }, [lineUserNameMap]);

    const getTypeColor = (type) => {
        switch (type) {
            case 'unset': return '#64748b';
            case 'betimes': return COLORS.betimes;
            case 'outsource': return COLORS.primary;
            case 'external': return '#f97316';
            default: return COLORS.betimes;
        }
    };

    const getTypeLabel = (type) => {
        switch (type) {
            case 'unset': return 'ยังไม่ได้ตั้ง';
            case 'betimes': return 'Betimes ภายใน';
            case 'outsource': return 'Outsource ส้ม+ขาว';
            case 'external': return 'คนนอก ส้ม';
            default: return type;
        }
    };

    const groupTypeOptions = [
        { value: 'unset', label: 'ยังไม่ได้ตั้ง' },
        { value: 'betimes', label: 'Betimes ภายใน' },
        { value: 'outsource', label: 'Outsource ส้ม+ขาว' },
        { value: 'external', label: 'คนนอก ส้ม' }
    ];

    const getStatusBadge = (status) => {
        switch (normalizeTaskStatus(status)) {
            case 'completed':
                return <span className="flex items-center gap-1 text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full"><CheckCircle size={12} />เสร็จแล้ว</span>;
            case 'abandoned':
                return <span className="flex items-center gap-1 text-xs px-2 py-1 bg-slate-100 text-slate-700 rounded-full"><Archive size={12} />จัดเก็บ</span>;
            case 'in-progress':
                return <span className="flex items-center gap-1 text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-full"><Clock size={12} />กำลังทำ</span>;
            default:
                return <span className="flex items-center gap-1 text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded-full"><Clock size={12} />รอดำเนินการ</span>;
        }
    };

    const getMessageTypeLabel = (type) => {
        switch (normalizeMessageType(type)) {
            case 'text': return 'ข้อความ';
            case 'image': return 'รูปภาพ';
            case 'video': return 'วิดีโอ';
            case 'audio': return 'เสียง';
            case 'file': return 'ไฟล์';
            case 'flex': return 'Flex';
            case 'sticker': return 'สติกเกอร์';
            case 'location': return 'ตำแหน่ง';
            default: return type || 'อื่นๆ';
        }
    };

    return (
        <div className="space-y-6">
            {selectedTask && (
                <TaskDetailModal
                    task={selectedTask}
                    employees={employees}
                    onClose={() => setSelectedTask(null)}
                    onDelete={handleDeleteTask}
                    onJumpToReply={handleJumpToTaskReply}
                    onJumpToQuestion={handleJumpToTaskQuestion}
                    onUpdate={(id, data) => {
                        onUpdateTask?.(id, data);
                        setSelectedTask((current) => ({ ...current, ...data }));
                    }}
                />
            )}

            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white">โครงการ</h1>
                    <p className="text-slate-500 dark:text-slate-400">จัดการงานตาม LINE Group</p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="relative">
                        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            placeholder="ค้นหางาน..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-10 pr-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                        />
                    </div>
                    <button
                        onClick={async () => {
                            if (syncAllLoading) return;
                            const knownGroupIds = groups.map((g) => g.id).filter(Boolean);

                            setSyncAllLoading(true);
                            try {
                                const res = await fetch('/api/sync-all-groups', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(knownGroupIds.length > 0 ? { groupIds: knownGroupIds } : {})
                                });

                                const data = await res.json().catch(() => ({}));
                                if (!res.ok) {
                                    throw new Error(data.detail || data.error || 'Sync all failed');
                                }

                                await loadLineGroups();

                                if (data.syncedFailed > 0) {
                                    alert(`ซิงค์เสร็จบางส่วน: สำเร็จ ${data.syncedSuccess} / ล้มเหลว ${data.syncedFailed} / ทีมงาน ${Number(data.teamSynced || 0)}/${Number(data.teamAttempted || 0)}`);
                                } else {
                                    alert(`ซิงค์ ${data.synced} กลุ่มเรียบร้อย (ทีมงาน ${Number(data.teamSynced || 0)}/${Number(data.teamAttempted || 0)})`);
                                }
                            } catch (err) {
                                console.error('Sync all failed', err);
                                alert('ซิงค์ทุกกลุ่มไม่สำเร็จ: ' + err.message);
                            } finally {
                                setSyncAllLoading(false);
                            }
                        }}
                        disabled={syncAllLoading}
                        className="flex items-center gap-2 px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-xl font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Send size={16} />
                        {syncAllLoading ? 'กำลังซิงค์...' : 'Sync ทุกกลุ่ม'}
                    </button>

                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)] gap-6 items-start">
                {/* Group Sidebar */}
                <aside className="bg-white dark:bg-slate-800/50 rounded-2xl border border-slate-200/60 dark:border-white/10 overflow-hidden">
                    <div className="p-4 border-b border-slate-200/60 dark:border-white/10">
                        <h3 className="font-semibold text-slate-900 dark:text-white">กลุ่มโครงการ</h3>
                        <p className="text-xs text-slate-500 mt-1">ทั้งหมด {groups.length} กลุ่ม</p>
                    </div>

                    <div className="p-3 pr-1 space-y-2 max-h-[560px] overflow-y-auto custom-scroll overscroll-y-contain">
                        {groups.map(group => (
                            <div
                                key={group.id}
                                className={`px-3 py-3 rounded-xl transition-all ${selectedGroup?.id === group.id
                                    ? 'bg-orange-500 text-white shadow-sm'
                                    : 'bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-orange-300'
                                    }`}
                            >
                                <button
                                    onClick={() => setSelectedGroup(group)}
                                    className="w-full min-w-0 flex items-center justify-between gap-3 text-left"
                                >
                                    <div className="flex items-center gap-3 min-w-0">
                                        <GroupAvatar
                                            name={group.name}
                                            pictureUrl={group.pictureUrl}
                                            color={getTypeColor(group.type)}
                                            sizeClass="w-9 h-9"
                                            textClass="text-xs"
                                        />
                                        <div className="min-w-0">
                                            <p className="font-medium truncate">{group.name}</p>
                                            <p className={`text-xs truncate ${selectedGroup?.id === group.id ? 'text-orange-100' : 'text-slate-500 dark:text-slate-400'}`}>
                                                {getTypeLabel(group.type)}
                                            </p>
                                            <p className={`text-[11px] mt-0.5 flex items-center gap-1 ${selectedGroup?.id === group.id ? 'text-orange-100' : 'text-slate-500 dark:text-slate-400'}`}>
                                                <Users size={11} /> {normalizeMemberCount(group.members)} คน
                                            </p>
                                        </div>
                                    </div>

                                    {group.unread > 0 && (
                                        <span className="px-1.5 py-0.5 bg-red-500 text-white text-xs rounded-full shrink-0">
                                            {group.unread}
                                        </span>
                                    )}
                                </button>
                            </div>
                        ))}

                        {groups.length === 0 && (
                            <div className="py-10 text-center text-slate-500">
                                <FolderKanban size={36} className="mx-auto mb-2 text-slate-300" />
                                <p className="text-sm">ยังไม่มีกลุ่มโครงการ</p>
                            </div>
                        )}
                    </div>
                </aside>

                {/* Right Content */}
                <div className="space-y-6">
                    {selectedGroup ? (
                        <div className="bg-white dark:bg-slate-800/50 rounded-2xl p-6 border border-slate-200/60 dark:border-white/10">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <GroupAvatar
                                        name={selectedGroup.name}
                                        pictureUrl={selectedGroup.pictureUrl}
                                        color={getTypeColor(selectedGroup.type)}
                                        sizeClass="w-14 h-14"
                                        textClass="text-xl"
                                    />
                                    <div>
                                        <div className="flex items-center gap-2">
                                            {renamingGroupId === selectedGroup.id ? (
                                                <>
                                                    <input
                                                        autoFocus
                                                        value={renameValue}
                                                        onChange={(e) => setRenameValue(e.target.value)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') handleRenameGroup(selectedGroup.id, renameValue);
                                                            if (e.key === 'Escape') setRenamingGroupId('');
                                                        }}
                                                        className="text-xl font-bold bg-transparent border-b-2 border-orange-400 outline-none text-slate-900 dark:text-white w-48"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRenameGroup(selectedGroup.id, renameValue)}
                                                        className="p-1 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/15"
                                                        title="บันทึกชื่อ"
                                                    >
                                                        <Check size={16} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setRenamingGroupId('')}
                                                        className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
                                                        title="ยกเลิก"
                                                    >
                                                        <X size={16} />
                                                    </button>
                                                </>
                                            ) : (
                                                <>
                                                    <h2 className="text-xl font-bold text-slate-900 dark:text-white">{selectedGroup.name}</h2>
                                                    <button
                                                        type="button"
                                                        onClick={() => { setRenameValue(selectedGroup.name); setRenamingGroupId(selectedGroup.id); }}
                                                        className="p-1 rounded-lg text-slate-400 hover:text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-500/15 transition-colors"
                                                        title="เปลี่ยนชื่อกลุ่ม"
                                                    >
                                                        <Pencil size={14} />
                                                    </button>
                                                </>
                                            )}
                                            <span
                                                className="px-2 py-0.5 text-xs rounded-full text-white"
                                                style={{ backgroundColor: getTypeColor(selectedGroup.type) }}
                                            >
                                                {getTypeLabel(selectedGroup.type)}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-3 mt-1 text-sm text-slate-500">
                                            <span className="flex items-center gap-1"><Users size={14} /> {selectedGroup.members} คน</span>
                                            <span>•</span>
                                            <span className="flex items-center gap-1"><MessageCircle size={14} /> {filteredTasks.length}/{taskStatusCounts.all} งาน</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={openLineSendPopup}
                                        className="flex items-center gap-2 px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                                    >
                                        <Send size={16} />
                                        ส่ง LINE
                                    </button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="bg-white dark:bg-slate-800/50 rounded-2xl p-6 border border-dashed border-slate-300 dark:border-slate-700 text-center text-slate-500">
                            ยังไม่มีกลุ่มโครงการ
                        </div>
                    )}

                    {/* Task List */}
                    <div className="bg-white dark:bg-slate-800/50 rounded-2xl border border-slate-200/60 dark:border-white/10 overflow-hidden">
                        <div className="p-4 border-b border-slate-200/60 dark:border-white/10 space-y-3">
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                <h3 className="font-semibold text-slate-900 dark:text-white">รายการงาน</h3>

                                {selectedGroup && (
                                    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                                        <select
                                            value={selectedGroup.type}
                                            onChange={(e) => handleGroupTypeChange(selectedGroup.id, e.target.value)}
                                            disabled={Boolean(groupTypeSavingMap[selectedGroup.id]) || deletingGroupId === selectedGroup.id || syncingGroupId === selectedGroup.id || recountingGroupId === selectedGroup.id}
                                            className="min-w-[170px] text-xs rounded-lg border px-2 py-1.5 outline-none disabled:opacity-60 disabled:cursor-not-allowed bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200"
                                        >
                                            {groupTypeOptions.map((option) => (
                                                <option key={option.value} value={option.value}>{option.label}</option>
                                            ))}
                                        </select>

                                        <button
                                            onClick={() => handleSyncGroup(selectedGroup)}
                                            disabled={Boolean(syncingGroupId) || deletingGroupId === selectedGroup.id || recountingGroupId === selectedGroup.id}
                                            className="text-xs rounded-lg border px-3 py-1.5 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-1 bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                                        >
                                            <Send size={12} />
                                            ซิงก์กลุ่มนี้
                                        </button>

                                        <button
                                            onClick={() => handleRecountGroupMembers(selectedGroup)}
                                            disabled={Boolean(recountingGroupId) || deletingGroupId === selectedGroup.id || syncingGroupId === selectedGroup.id || archivingGroupId === selectedGroup.id}
                                            className="text-xs rounded-lg border px-3 py-1.5 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-1 bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                                        >
                                            <RefreshCcw size={12} />
                                            รีนับสมาชิก
                                        </button>

                                        <button
                                            onClick={() => handleArchiveGroupTasks(selectedGroup)}
                                            disabled={Boolean(archivingGroupId) || deletingGroupId === selectedGroup.id || syncingGroupId === selectedGroup.id || recountingGroupId === selectedGroup.id}
                                            className="text-xs rounded-lg border px-3 py-1.5 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-1 border-amber-300 dark:border-amber-800/70 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                                        >
                                            <Archive size={12} />
                                            {archivingGroupId === selectedGroup.id ? 'กำลังจัดเก็บ...' : 'จัดเก็บ task กลุ่มนี้'}
                                        </button>

                                        <button
                                            onClick={() => handleDeleteGroup(selectedGroup)}
                                            disabled={deletingGroupId === selectedGroup.id || syncingGroupId === selectedGroup.id || recountingGroupId === selectedGroup.id || archivingGroupId === selectedGroup.id}
                                            className="text-xs rounded-lg border px-3 py-1.5 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-1 border-red-300 dark:border-red-800 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                                        >
                                            <Trash2 size={12} />
                                            ลบกลุ่มนี้
                                        </button>
                                    </div>
                                )}
                            </div>

                            {selectedGroup && (
                                <div className="flex items-center gap-2 overflow-x-auto custom-scroll pb-1">
                                    {taskStatusFilters.map((statusItem) => {
                                        const isActive = taskStatusFilter === statusItem.value;
                                        return (
                                            <button
                                                key={statusItem.value}
                                                type="button"
                                                onClick={() => setTaskStatusFilter(statusItem.value)}
                                                className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${isActive
                                                    ? 'bg-orange-500 border-orange-500 text-white'
                                                    : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-orange-300'
                                                    }`}
                                            >
                                                <span>{statusItem.label}</span>
                                                <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${isActive ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200'}`}>
                                                    {statusItem.count}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                        <div className="p-4">
                            {filteredTasks.length > 0 ? (
                                <>
                                    <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">เลื่อนซ้าย-ขวาเพื่อดูแฟ้มการ์ดงานทั้งหมด</p>
                                    <div className="flex gap-4 overflow-x-auto custom-scroll overscroll-x-contain pb-4 snap-x snap-mandatory">
                                    {filteredTasks.map((task) => {
                                        const formatIssues = Array.isArray(task?.formatIssues) ? task.formatIssues : [];
                                        const assigneeIds = Array.isArray(task?.assignees) ? task.assignees : [];
                                        const assigneeEmployees = assigneeIds
                                            .map((employeeId) => employeeById.get(String(employeeId || '').trim()))
                                            .filter(Boolean)
                                            .slice(0, 4);
                                        const taskId = String(task?.id || '').trim();
                                        const isDeletingTask = deletingTaskId === taskId;
                                        const replyMeta = getTaskLatestReplyMeta(task);
                                        const hasAnyReply = replyMeta.hasReply;
                                        const hasUnreadReply = isTaskReplyUnread(task);
                                        const unreadReplyOverdue = isTaskReplyUnreadOverdue(task);
                                        const accentColor = normalizeTaskStatus(task?.status) === 'abandoned'
                                            ? '#64748b'
                                            : (assigneeEmployees[0]?.color || '#24387E');
                                        const cardBorderColor = hasAnyReply ? '#ef4444' : accentColor;

                                        return (
                                            <div
                                                key={task.id}
                                                role="button"
                                                tabIndex={0}
                                                onClick={() => setSelectedTask(task)}
                                                onKeyDown={(event) => {
                                                    if (event.key === 'Enter' || event.key === ' ') {
                                                        event.preventDefault();
                                                        setSelectedTask(task);
                                                    }
                                                }}
                                                className="group relative mt-3 min-w-[300px] sm:min-w-[340px] lg:min-w-[360px] max-w-[420px] snap-start shrink-0 cursor-pointer"
                                            >
                                                <div
                                                    className="absolute left-0 rounded-t-xl"
                                                    style={{
                                                        top: -10,
                                                        width: '44%',
                                                        height: 12,
                                                        background: accentColor,
                                                        borderRadius: '8px 8px 0 0',
                                                        opacity: 0.9
                                                    }}
                                                />

                                                <button
                                                    type="button"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        handleDeleteTask(task);
                                                    }}
                                                    onKeyDown={(event) => event.stopPropagation()}
                                                    disabled={isDeletingTask}
                                                    title="ลบงาน"
                                                    className="absolute top-2 right-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-lg border border-red-200 bg-white/85 text-red-500 transition-colors hover:bg-red-50 disabled:opacity-60 disabled:cursor-not-allowed dark:border-red-800/60 dark:bg-slate-900/85 dark:text-red-300 dark:hover:bg-red-950/30"
                                                >
                                                    <Trash2 size={14} />
                                                </button>

                                                <div
                                                    className="w-full text-left relative rounded-tl-none rounded-tr-2xl rounded-b-3xl border p-5 pr-11 transition-all duration-300 bg-slate-50 dark:bg-white/[0.02] hover:bg-white dark:hover:bg-[#111113] hover:-translate-y-0.5"
                                                    style={{
                                                        borderColor: `${cardBorderColor}66`,
                                                        boxShadow: `0 10px 26px -16px ${cardBorderColor}66`
                                                    }}
                                                >
                                                    <div className="absolute top-0 right-0 w-1.5 h-full rounded-r-3xl" style={{ background: accentColor, opacity: 0.45 }} />

                                                    <div className="flex items-start justify-between gap-3 mb-2">
                                                        <div className="min-w-0 flex-1">
                                                            <div className="flex items-center gap-2 mb-1">
                                                                {formatIssues.length > 0 && (
                                                                    <AlertCircle size={15} className="text-yellow-500" title="รายการที่ต้องทำให้ชัดเจน" />
                                                                )}
                                                                <h4 className="font-bold text-slate-900 dark:text-white line-clamp-2 break-words">
                                                                    {resolveTaskTitle(task)}
                                                                </h4>
                                                            </div>

                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                {getStatusBadge(task.status)}
                                                                {hasUnreadReply && (
                                                                    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-lg ${unreadReplyOverdue
                                                                        ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
                                                                        : 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
                                                                        }`}>
                                                                        <span className={`w-2 h-2 rounded-full ${unreadReplyOverdue ? 'bg-red-500 animate-pulse' : 'bg-rose-500'}`} />
                                                                        {unreadReplyOverdue ? 'ยังไม่อ่าน > 7 วัน' : 'มีคำตอบใหม่'}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>

                                                        <ChevronRight size={16} className="text-slate-400 shrink-0 mt-1 group-hover:translate-x-0.5 transition-all" />
                                                    </div>

                                                    <div className="flex items-center gap-2 mb-3">
                                                        <div className="flex -space-x-1.5">
                                                            {assigneeEmployees.map((employee) => (
                                                                <div key={`${task.id}-${employee.id}`} title={employee.name}>
                                                                    <Avatar
                                                                        name={employee.name}
                                                                        color={employee.color}
                                                                        size={22}
                                                                        url={employee.avatar}
                                                                    />
                                                                </div>
                                                            ))}
                                                        </div>
                                                        <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                                            ผู้รับผิดชอบ: {task.assignee || 'สมาชิกในกลุ่ม'}
                                                        </span>
                                                    </div>

                                                    {formatIssues.length > 0 && (
                                                        <div className="mb-3 flex flex-wrap gap-1">
                                                            {formatIssues.map((issue, index) => (
                                                                <span key={`${task.id}-issue-${index}`} className="px-2 py-0.5 bg-yellow-100 text-yellow-700 text-[11px] rounded-lg">
                                                                    {issue}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}

                                                    <div className="flex items-center justify-between gap-4 pt-2.5 border-t border-slate-200/70 dark:border-slate-700/70">
                                                        <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                                                            <Calendar size={12} />
                                                            <span>{formatDate(task.deadline) || '-'}</span>
                                                        </div>

                                                        <span
                                                            className="text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-lg"
                                                            style={{ backgroundColor: `${accentColor}1f`, color: accentColor }}
                                                        >
                                                            {task?.type === 'team' ? 'ทีม' : 'เดี่ยว'}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                    </div>
                                </>
                            ) : (
                                <div className="p-8 text-center text-slate-500">
                                    <FolderKanban size={48} className="mx-auto mb-3 text-slate-300" />
                                    <p>ไม่มีงานในกลุ่มนี้</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {isLineSendPopupOpen && selectedGroup && (
                <div
                    className={`fixed inset-0 z-[85] bg-slate-900/55 dark:bg-black/75 backdrop-blur-sm p-3 sm:p-4 flex items-center justify-center transition-opacity duration-200 ease-out ${isLineSendPopupVisible ? 'opacity-100' : 'opacity-0'}`}
                    onClick={(event) => {
                        if (event.target === event.currentTarget) {
                            closeLineSendPopup();
                        }
                    }}
                >
                    <div className={`w-full max-w-5xl h-[88vh] rounded-3xl border border-slate-200/70 dark:border-white/10 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden flex flex-col transition-all duration-200 ease-out transform-gpu ${isLineSendPopupVisible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-3 scale-[0.98]'}`}>
                        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200/70 dark:border-slate-700/80 flex items-center justify-between">
                            <div>
                                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">หน้าแชทกลุ่ม</p>
                                <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">{selectedGroup.name}</h3>
                            </div>
                            <button
                                type="button"
                                onClick={closeLineSendPopup}
                                className="w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                                aria-label="ปิดหน้าแชท"
                            >
                                <X size={14} />
                            </button>
                        </div>

                        <div className="flex-1 p-3 sm:p-4 bg-gradient-to-b from-slate-50/90 via-sky-50/40 to-indigo-50/60 dark:from-slate-900/60 dark:via-slate-900/50 dark:to-indigo-950/30 min-h-0">
                            <div className="rounded-[1.35rem] border border-slate-200/80 dark:border-slate-700/80 bg-white/90 dark:bg-slate-900/85 h-full flex flex-col overflow-hidden shadow-[0_22px_54px_-32px_rgba(15,23,42,0.45)]">
                                <div
                                    ref={lineSendModalChatScrollRef}
                                    className="flex-1 overflow-y-auto custom-scroll overscroll-y-contain p-3 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.18),_transparent_45%),radial-gradient(circle_at_bottom_right,_rgba(249,115,22,0.14),_transparent_45%)] dark:bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_45%),radial-gradient(circle_at_bottom_right,_rgba(79,70,229,0.18),_transparent_45%)]"
                                >
                                    {messagesLoading ? (
                                        <p className="text-xs text-slate-500 dark:text-slate-300">กำลังโหลดประวัติแชท...</p>
                                    ) : groupMessages.length === 0 ? (
                                        <div className="h-full flex flex-col items-center justify-center text-slate-500 dark:text-slate-300 text-sm">
                                            <MessageCircle size={34} className="mb-2 text-slate-300 dark:text-slate-600" />
                                            ยังไม่มีข้อความที่บันทึกไว้
                                        </div>
                                    ) : groupMessages.map((message, index) => {
                                        const isBotMessage = Boolean(message.isBot);
                                        const senderName = resolveMessageSenderName(message, lineUserNameMap);
                                        const senderIdentity = String(message?.lineUserId || '').trim() || senderName;
                                        const previousMessage = index > 0 ? groupMessages[index - 1] : null;
                                        const previousSenderName = previousMessage
                                            ? resolveMessageSenderName(previousMessage, lineUserNameMap)
                                            : '';
                                        const previousSenderIdentity = previousMessage
                                            ? (String(previousMessage?.lineUserId || '').trim() || previousSenderName)
                                            : '';
                                        const previousTime = toMessageDate(previousMessage?.createdAt)?.getTime() || 0;
                                        const currentTime = toMessageDate(message?.createdAt)?.getTime() || 0;
                                        const isSameSenderCluster = Boolean(previousMessage)
                                            && Boolean(previousMessage?.isBot) === isBotMessage
                                            && previousSenderIdentity === senderIdentity
                                            && previousTime > 0
                                            && currentTime > 0
                                            && (currentTime - previousTime) <= (4 * 60 * 1000);
                                        const blockSpacingClass = isSameSenderCluster
                                            ? 'mt-1'
                                            : (index === 0 ? '' : 'mt-3');
                                        const lineMessageId = String(message?.lineMessageId || '').trim();
                                        const messageType = normalizeMessageType(message?.type);
                                        const quotedMessageId = String(message?.quotedMessageId || '').trim();
                                        const quotedMessage = quotedMessageId
                                            ? messageByLineId.get(quotedMessageId)
                                            : null;
                                        const quotedPreviewText = normalizeChatText(
                                            message?.quotedPreviewText || quotedMessage?.text || quotedMessage?.previewText || ''
                                        );
                                        const replyText = quotedPreviewText || (quotedMessageId
                                            ? `ข้อความเดิม #${quotedMessageId.slice(-6)}`
                                            : '');
                                        const messageDisplayText = messageType === 'text'
                                            ? normalizeChatText(message?.text || message?.previewText || '')
                                            : (normalizeChatText(message?.previewText || message?.text || '') || getMessagePreviewFallback(messageType, message));
                                        const messageTypeLabel = getMessageTypeLabel(messageType);
                                        const stickerImageUrl = messageType === 'sticker'
                                            ? resolveStickerImageUrl(message)
                                            : '';
                                        const messageViewUrl = String(message?.viewUrl || '').trim();
                                        const messageDownloadUrl = messageType === 'file'
                                            ? buildMessageDownloadUrl(messageViewUrl, message?.fileName || '')
                                            : '';
                                        const mapViewUrl = messageType === 'location'
                                            ? buildLocationMapUrl(message)
                                            : '';
                                        const flexPreview = messageType === 'flex'
                                            ? resolveFlexPreview(message)
                                            : null;
                                        const messageTime = formatMessageClock(message?.createdAt) || message.createdAtText;
                                        const canReply = Boolean(lineMessageId) && !isBotMessage;
                                        const shouldShowIdentity = !isBotMessage && !isSameSenderCluster;
                                        const avatarInitial = senderName.slice(0, 1).toUpperCase();
                                        const isHighlightedMessage = highlightedLineMessageId && lineMessageId === highlightedLineMessageId;
                                        const bubbleTone = isBotMessage
                                            ? 'bg-[#9FE870] border-[#86D759] text-slate-900'
                                            : 'bg-white border-slate-200/95 text-slate-800 dark:bg-slate-900/85 dark:border-slate-600/80 dark:text-slate-100';
                                        const bubbleShape = isBotMessage
                                            ? (isSameSenderCluster ? 'rounded-[1.1rem] rounded-tr-md' : 'rounded-[1.1rem] rounded-br-md')
                                            : (isSameSenderCluster ? 'rounded-[1.1rem] rounded-tl-md' : 'rounded-[1.1rem] rounded-bl-md');

                                        return (
                                            <div key={`popup-${message.id}`} className={`flex ${isBotMessage ? 'justify-end' : 'justify-start'} ${blockSpacingClass}`}>
                                                <div className={`flex max-w-[92%] items-end gap-2 ${isBotMessage ? 'flex-row-reverse' : 'flex-row'}`}>
                                                    {!isBotMessage && (
                                                        shouldShowIdentity ? (
                                                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#24387E] to-[#3F5BC7] text-white text-[11px] font-bold flex items-center justify-center shrink-0 shadow-sm ring-2 ring-white/80 dark:ring-slate-900/80">
                                                                {avatarInitial}
                                                            </div>
                                                        ) : (
                                                            <div className="w-8 shrink-0" aria-hidden="true" />
                                                        )
                                                    )}

                                                    <div className={`flex flex-col ${isBotMessage ? 'items-end' : 'items-start'}`}>
                                                        {shouldShowIdentity && (
                                                            <p className="mb-0.5 ml-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300">{senderName}</p>
                                                        )}

                                                        <div className={`flex items-end gap-1.5 ${isBotMessage ? 'flex-row-reverse' : 'flex-row'}`}>
                                                            <div
                                                                data-line-message-id={lineMessageId}
                                                                className={`max-w-[76vw] sm:max-w-[440px] border px-3 py-2.5 text-sm break-words shadow-[0_8px_20px_-16px_rgba(15,23,42,0.5)] ${bubbleTone} ${bubbleShape} ${isHighlightedMessage ? 'ring-2 ring-red-400/80 dark:ring-red-500/80' : ''}`}
                                                            >
                                                                {quotedMessageId && (
                                                                    <div className="mb-2 rounded-lg border border-slate-200/90 bg-slate-50/90 px-2.5 py-1.5 dark:border-slate-600/80 dark:bg-slate-800/75">
                                                                        <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-300">[ข้อความตอบกับ]</p>
                                                                        <p className="mt-0.5 text-xs text-slate-600 break-words dark:text-slate-200">{replyText || '-'}</p>
                                                                    </div>
                                                                )}

                                                                {messageType === 'sticker' ? (
                                                                    <div className="space-y-1.5">
                                                                        <p className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-slate-700/60 dark:text-slate-200">
                                                                            {messageTypeLabel}
                                                                        </p>
                                                                        {stickerImageUrl && (
                                                                            <img
                                                                                src={stickerImageUrl}
                                                                                alt={message?.previewText || 'sticker'}
                                                                                className="max-h-36 rounded-xl border border-white/70 bg-white/80 p-1 dark:border-slate-700/70 dark:bg-slate-900/40"
                                                                                loading="lazy"
                                                                                onError={(event) => {
                                                                                    event.currentTarget.style.display = 'none';
                                                                                }}
                                                                            />
                                                                        )}
                                                                        <p className="text-xs leading-normal whitespace-normal text-slate-700 dark:text-slate-100 break-words">
                                                                            {message?.previewText || getMessagePreviewFallback('sticker', message)}
                                                                        </p>
                                                                    </div>
                                                                ) : (
                                                                    <>
                                                                        {messageType !== 'text' && (
                                                                            <p className="inline-flex mb-1 rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-slate-700/60 dark:text-slate-200">
                                                                                {messageTypeLabel}
                                                                            </p>
                                                                        )}
                                                                        <p className="text-sm leading-normal whitespace-pre-wrap break-words">
                                                                            {renderMessageTextWithLinks(messageDisplayText || '-')}
                                                                        </p>

                                                                        {messageType === 'flex' && (
                                                                            <div className="mt-2 rounded-xl border border-sky-200/80 bg-sky-50/70 px-2.5 py-2 dark:border-sky-500/40 dark:bg-sky-500/10">
                                                                                <p className="text-[11px] font-semibold text-sky-800 dark:text-sky-200">Flex Message</p>
                                                                                <p className="mt-1 text-xs text-slate-700 dark:text-slate-200 break-words whitespace-pre-wrap">
                                                                                    {renderMessageTextWithLinks(flexPreview?.title || messageDisplayText || '[Flex Message]')}
                                                                                </p>
                                                                                {flexPreview?.subtitle && (
                                                                                    <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-300 break-words whitespace-pre-wrap">
                                                                                        {renderMessageTextWithLinks(flexPreview.subtitle)}
                                                                                    </p>
                                                                                )}
                                                                                {flexPreview?.actionUrl && (
                                                                                    <a
                                                                                        href={flexPreview.actionUrl}
                                                                                        target="_blank"
                                                                                        rel="noopener noreferrer"
                                                                                        className="mt-2 inline-flex items-center rounded-md border border-sky-300 bg-white/90 px-2 py-1 text-[11px] font-semibold text-sky-700 hover:bg-sky-50 dark:border-sky-500/60 dark:bg-slate-900/60 dark:text-sky-200 dark:hover:bg-sky-500/10"
                                                                                    >
                                                                                        เปิดลิงก์ใน Flex
                                                                                    </a>
                                                                                )}
                                                                            </div>
                                                                        )}

                                                                        {messageType === 'file' && (
                                                                            <div className="mt-2 rounded-xl border border-slate-200/90 bg-slate-50/90 px-2.5 py-2 dark:border-slate-600/80 dark:bg-slate-800/75">
                                                                                <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">ไฟล์แนบ</p>
                                                                                <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300 break-all">
                                                                                    {message.fileName || messageDisplayText || 'ไฟล์แนบ'}
                                                                                </p>
                                                                            </div>
                                                                        )}

                                                                        {messageType === 'location' && mapViewUrl && (
                                                                            <a
                                                                                href={mapViewUrl}
                                                                                target="_blank"
                                                                                rel="noopener noreferrer"
                                                                                className="mt-2 inline-flex items-center rounded-md border border-indigo-300/80 bg-indigo-50/80 px-2 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100/80 dark:border-indigo-500/50 dark:bg-indigo-500/10 dark:text-indigo-200 dark:hover:bg-indigo-500/20"
                                                                            >
                                                                                ดูแผนที่
                                                                            </a>
                                                                        )}
                                                                    </>
                                                                )}

                                                                {messageType === 'image' && messageViewUrl && (
                                                                    <a href={messageViewUrl} target="_blank" rel="noopener noreferrer" className="mt-2 block">
                                                                        <img
                                                                            src={messageViewUrl}
                                                                            alt={message?.fileName || 'image'}
                                                                            className="max-h-44 rounded-xl border border-slate-200/90 object-contain bg-white dark:border-slate-600 dark:bg-slate-800 cursor-zoom-in"
                                                                        />
                                                                    </a>
                                                                )}

                                                                {messageType === 'video' && messageViewUrl && (
                                                                    <>
                                                                        <video className="mt-2 w-full max-h-48 rounded-xl border border-slate-200/90 dark:border-slate-600" controls src={messageViewUrl} />
                                                                        <a
                                                                            href={messageViewUrl}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                            className="mt-2 inline-flex items-center rounded-md border border-slate-300/80 bg-white/90 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-500/80 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-slate-800"
                                                                        >
                                                                            เปิดคลิป
                                                                        </a>
                                                                    </>
                                                                )}

                                                                {messageType === 'audio' && messageViewUrl && (
                                                                    <>
                                                                        <audio className="mt-2 w-full" controls src={messageViewUrl} />
                                                                        <a
                                                                            href={messageViewUrl}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                            className="mt-2 inline-flex items-center rounded-md border border-slate-300/80 bg-white/90 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-500/80 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-slate-800"
                                                                        >
                                                                            เปิดเสียง
                                                                        </a>
                                                                    </>
                                                                )}

                                                                {messageType === 'file' && messageViewUrl && (
                                                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                                                        <a
                                                                            href={messageViewUrl}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                            className="inline-flex items-center rounded-md border border-slate-300/80 bg-white/90 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-500/80 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-slate-800"
                                                                        >
                                                                            เปิดไฟล์
                                                                        </a>
                                                                        <a
                                                                            href={messageDownloadUrl || messageViewUrl}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                            className="inline-flex items-center rounded-md border border-emerald-300/80 bg-emerald-50/90 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100/90 dark:border-emerald-500/60 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/20"
                                                                        >
                                                                            ดาวน์โหลด
                                                                        </a>
                                                                    </div>
                                                                )}
                                                            </div>

                                                            <div className="flex items-center gap-1">
                                                                {canReply && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleReplyToMessage(message)}
                                                                        className="text-lg font-bold text-slate-300 dark:text-slate-600 hover:text-slate-400 dark:hover:text-slate-500 tracking-tighter leading-none px-0.5"
                                                                        aria-label="ตอบกลับข้อความนี้"
                                                                        title="ตอบกลับ"
                                                                    >
                                                                        ...
                                                                    </button>
                                                                )}
                                                                <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400">{messageTime}</p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                <form
                                    className="sticky bottom-0 px-3 py-2.5 border-t border-slate-200/70 dark:border-slate-700/80 bg-white/95 dark:bg-slate-900/95 backdrop-blur"
                                    onSubmit={(event) => {
                                        event.preventDefault();
                                        handleSendGroupMessage();
                                    }}
                                >
                                    {replyTarget && (
                                        <div className="mb-2 rounded-xl border border-indigo-200/80 dark:border-indigo-500/30 bg-indigo-50/80 dark:bg-indigo-500/10 px-3 py-2">
                                            <div className="flex items-center justify-between gap-2">
                                                <p className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-200">
                                                    [ข้อความตอบกับ] {replyTarget.senderName || 'ข้อความก่อนหน้า'}
                                                </p>
                                                <button
                                                    type="button"
                                                    onClick={() => setReplyTarget(null)}
                                                    className="w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-100 flex items-center justify-center hover:bg-indigo-200 dark:hover:bg-indigo-500/30"
                                                    aria-label="ยกเลิกการตอบกลับ"
                                                >
                                                    <X size={11} />
                                                </button>
                                            </div>
                                            <p className="mt-1 text-xs text-indigo-700/80 dark:text-indigo-100/90 break-words">{replyTarget.previewText || '-'}</p>
                                        </div>
                                    )}

                                    <div className="flex items-center gap-2 rounded-2xl border border-slate-200/90 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-800/90 px-2.5 py-1.5 shadow-sm">
                                        <input
                                            ref={lineSendModalInputRef}
                                            type="text"
                                            value={outgoingMessage}
                                            onChange={(event) => setOutgoingMessage(event.target.value)}
                                            placeholder="พิมพ์ข้อความ..."
                                            className="flex-1 bg-transparent text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none"
                                            disabled={!selectedGroup || sendingMessage}
                                            maxLength={2000}
                                        />

                                        <button
                                            type="submit"
                                            disabled={!canSendGroupMessage}
                                            className="w-9 h-9 rounded-full bg-gradient-to-br from-[#24387E] to-[#3F5BC7] text-white flex items-center justify-center hover:brightness-110 disabled:from-slate-300 disabled:to-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed"
                                            aria-label="ส่งข้อความ"
                                        >
                                            <Send size={14} />
                                        </button>
                                    </div>

                                    <p className="mt-1 px-2 text-[11px] text-slate-500 dark:text-slate-400">
                                        {sendingMessage
                                            ? 'กำลังส่งข้อความ...'
                                            : (replyTarget
                                                ? 'กำลังตอบกลับข้อความในกลุ่ม LINE'
                                                : 'ส่งข้อความเข้ากลุ่ม LINE ได้จากช่องนี้')}
                                    </p>
                                </form>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {taskPopups.length > 0 && (
                <div className="fixed right-4 top-20 z-[80] w-[min(94vw,440px)] space-y-3">
                    {taskPopups.map((popup) => {
                        const groupName = groupNameMap.get(popup.projectId)
                            || (popup.projectId ? `LINE GROUP ${popup.projectId.slice(-6)}` : 'ไม่ระบุกลุ่ม');
                        const assignees = (popup.assignees || [])
                            .map((employeeId) => employeeById.get(String(employeeId || '').trim()))
                            .filter(Boolean);
                        const assigneeNames = assignees.length > 0
                            ? assignees.map((employee) => String(employee?.name || '').trim().split(' ')[0]).filter(Boolean).join(', ')
                            : (popup.assignee || 'ยังไม่ระบุผู้รับผิดชอบ');
                        const accentColor = popup.status === 'abandoned'
                            ? '#64748b'
                            : (assignees[0]?.color || '#10b981');
                        const typeLabel = popup.type === 'team' ? 'ทีม' : 'เดี่ยว';
                        const hasUnreadReply = Boolean(popup?.hasUnreadReply);
                        const unreadReplyOverdue = Boolean(popup?.unreadReplyOverdue);

                        return (
                            <div
                                key={popup.id}
                                className="relative"
                            >
                                <div
                                    className="absolute left-0 rounded-t-xl"
                                    style={{
                                        top: -9,
                                        width: '40%',
                                        height: 10,
                                        background: accentColor,
                                        borderRadius: '8px 8px 0 0',
                                        opacity: 0.95
                                    }}
                                />

                                <button
                                    type="button"
                                    onClick={() => openTaskFromPopup(popup)}
                                    className="relative w-full text-left rounded-tl-none rounded-tr-2xl rounded-b-3xl border p-4 transition-all duration-200 bg-white dark:bg-[#111113] hover:-translate-y-0.5"
                                    style={{
                                        borderColor: `${accentColor}66`,
                                        boxShadow: `0 14px 28px -14px ${accentColor}55`
                                    }}
                                >
                                    <div className="absolute top-0 right-0 w-1.5 h-full rounded-r-3xl" style={{ background: accentColor, opacity: 0.5 }} />

                                    <div className="flex items-start justify-between gap-3 mb-2">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span
                                                    className="text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-lg"
                                                    style={{ backgroundColor: `${accentColor}1f`, color: accentColor }}
                                                >
                                                    {typeLabel}
                                                </span>
                                                <StatusBadge status={popup.status || 'in-progress'} />
                                                {hasUnreadReply && (
                                                    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-lg ${unreadReplyOverdue
                                                        ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
                                                        : 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
                                                        }`}>
                                                        <span className={`w-2 h-2 rounded-full ${unreadReplyOverdue ? 'bg-red-500 animate-pulse' : 'bg-rose-500'}`} />
                                                        ใหม่
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-sm font-bold text-slate-900 dark:text-white leading-snug break-words line-clamp-2">
                                                {popup.title}
                                            </p>
                                            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 truncate">{groupName}</p>
                                        </div>
                                        <ChevronRight size={16} className="text-slate-400 shrink-0 mt-1" />
                                    </div>

                                    <div className="flex items-center gap-2 mb-3">
                                        <div className="flex -space-x-1.5">
                                            {assignees.slice(0, 4).map((employee) => (
                                                <div key={`${popup.id}-${employee.id}`} title={employee.name}>
                                                    <Avatar
                                                        name={employee.name}
                                                        color={employee.color}
                                                        size={22}
                                                        url={employee.avatar}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                        <p className="text-xs text-slate-600 dark:text-slate-300 truncate">{assigneeNames}</p>
                                    </div>

                                    <div className="flex items-center gap-4 pt-2.5 border-t border-slate-200/70 dark:border-slate-700/70">
                                        <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                                            <Calendar size={12} />
                                            <span>{popup.deadline ? formatDate(popup.deadline) : formatTaskDeadline(popup.deadline)}</span>
                                        </div>
                                        <div className="ml-auto text-[11px] text-slate-400">{formatMessageDateTime(popup.createdAt)}</div>
                                    </div>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => dismissTaskPopup(popup.id)}
                                    className="absolute top-2.5 right-2.5 p-1 rounded-lg text-slate-500 hover:bg-white/80 dark:hover:bg-slate-800/60"
                                    aria-label="ปิด popup"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        );
                    })}

                    {taskPopups.length > 1 && (
                        <button
                            type="button"
                            onClick={dismissAllTaskPopups}
                            className="w-full rounded-xl border border-slate-300/80 bg-white/90 dark:bg-slate-900/70 px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                        >
                            ปิด popup ทั้งหมด ({taskPopups.length})
                        </button>
                    )}
                </div>
            )}
                </div>
            </div>
        </div>
    );
}
