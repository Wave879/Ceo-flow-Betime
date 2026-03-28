// ✅ Task queries — queryMyTasksForUser, queryGroupTasksForNotify

import { readFirestoreStringField } from './firestore.js';
import { getFirestoreDocId } from './member-sync.js';

async function queryMyTasksForUser(lineUserId, groupId, env, maxTasks = 20) {
    if (!env?.FIREBASE_PROJECT_ID || !env?.FIREBASE_API_KEY) return [];
    const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery?key=${env.FIREBASE_API_KEY}`;
    // Query tasks where lineAssigneeIds array contains this user, optionally filtered by group
    const filters = [
        {
            fieldFilter: {
                field: { fieldPath: 'lineAssigneeIds' },
                op: 'ARRAY_CONTAINS',
                value: { stringValue: lineUserId }
            }
        }
    ];
    if (groupId) {
        filters.push({
            fieldFilter: {
                field: { fieldPath: 'projectId' },
                op: 'EQUAL',
                value: { stringValue: groupId }
            }
        });
    }
    const where = filters.length > 1
        ? { compositeFilter: { op: 'AND', filters } }
        : filters[0];
    const body = {
        structuredQuery: {
            from: [{ collectionId: 'tasks' }],
            where,
            limit: maxTasks
        }
    };
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            console.error(`queryMyTasksForUser Firestore error (${res.status}):`, errText.slice(0, 200));
            return [];
        }
        const data = await res.json();
        if (!Array.isArray(data)) return [];
        return data
            .filter((r) => r?.document)
            .map((r) => {
                const fields = r.document.fields || {};
                return {
                    id: readFirestoreStringField(fields, 'id') || getFirestoreDocId(r.document.name),
                    title: readFirestoreStringField(fields, 'title') || readFirestoreStringField(fields, 'name') || 'งานไม่ระบุชื่อ',
                    status: readFirestoreStringField(fields, 'status') || 'in-progress',
                    deadline: readFirestoreStringField(fields, 'deadline') || readFirestoreStringField(fields, 'deadlineText') || ''
                };
            });
    } catch (err) {
        console.error('queryMyTasksForUser error:', err);
        return [];
    }
}

async function queryGroupTasksForNotify(groupId, env, maxTasks = 30) {
    if (!env?.FIREBASE_PROJECT_ID || !env?.FIREBASE_API_KEY) {
        return [];
    }
    const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery?key=${env.FIREBASE_API_KEY}`;
    // Note: no orderBy here — composite index (projectId + createdAt) is not guaranteed to exist.
    // We sort in JS after fetching.
    const body = {
        structuredQuery: {
            from: [{ collectionId: 'tasks' }],
            where: {
                fieldFilter: {
                    field: { fieldPath: 'projectId' },
                    op: 'EQUAL',
                    value: { stringValue: groupId }
                }
            },
            limit: maxTasks
        }
    };
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            console.error(`queryGroupTasksForNotify Firestore error (${res.status}):`, errText.slice(0, 300));
            return [];
        }
        const data = await res.json();
        if (!Array.isArray(data)) {
            console.error('queryGroupTasksForNotify: unexpected response shape', typeof data);
            return [];
        }
        const rows = data
            .filter((r) => r?.document)
            .map((r) => {
                const fields = r.document.fields || {};
                const createdAtRaw = fields?.createdAt?.timestampValue || fields?.createdAt?.stringValue || '';
                return {
                    id: readFirestoreStringField(fields, 'id') || getFirestoreDocId(r.document.name),
                    title: readFirestoreStringField(fields, 'title') || readFirestoreStringField(fields, 'name') || 'งานไม่ระบุชื่อ',
                    status: readFirestoreStringField(fields, 'status') || 'in-progress',
                    assignee: readFirestoreStringField(fields, 'assignee') || 'ยังไม่ระบุ',
                    deadline: readFirestoreStringField(fields, 'deadline') || readFirestoreStringField(fields, 'deadlineText') || '',
                    _createdAt: createdAtRaw
                };
            });
        // Sort newest first in JS (avoids needing composite Firestore index)
        rows.sort((a, b) => {
            const toMs = (v) => v ? new Date(v).getTime() : 0;
            return toMs(b._createdAt) - toMs(a._createdAt);
        });
        console.log(`queryGroupTasksForNotify: found ${rows.length} tasks for groupId=${groupId.slice(-6)}`);
        return rows;
    } catch (err) {
        console.error('queryGroupTasksForNotify error:', err);
        return [];
    }
}

export {
    queryMyTasksForUser,
    queryGroupTasksForNotify
};
