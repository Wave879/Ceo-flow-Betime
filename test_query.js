const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'ceo-flow';
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

if (!FIREBASE_API_KEY) {
    throw new Error('Missing FIREBASE_API_KEY. Set FIREBASE_API_KEY in your environment before running this script.');
}

async function fsQuery(body) {
    const r = await fetch(
        `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    const results = await r.json();
    if (!Array.isArray(results)) {
        console.error('Error from Firestore:', JSON.stringify(results, null, 2));
        return [];
    }
    return results;
}

// ค้นหางานที่กำลังดำเนินอยู่ของพนักงาน (sort by startDate asc)
async function getInProgressTasks(employeeId) {
    const docs = await fsQuery({
        structuredQuery: {
            from: [{ collectionId: 'tasks' }],
            where: {
                compositeFilter: {
                    op: 'AND',
                    filters: [
                        { fieldFilter: { field: { fieldPath: 'assignees' }, op: 'ARRAY_CONTAINS', value: { stringValue: employeeId } } },
                        { fieldFilter: { field: { fieldPath: 'status' }, op: 'NOT_EQUAL', value: { stringValue: 'completed' } } }
                    ]
                }
            },
            orderBy: [{ field: { fieldPath: 'status' } }, { field: { fieldPath: 'startDate' }, direction: 'ASCENDING' }]
        }
    });
    console.log(docs);
}

getInProgressTasks('some-id').catch(console.error);
