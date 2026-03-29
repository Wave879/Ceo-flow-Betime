const BASE_URL = 'https://firestore.googleapis.com/v1/projects/wave879-web/databases/(default)/documents';
const API_KEY = process.env.FIREBASE_API_KEY;

if (!API_KEY) {
  console.error('❌ FIREBASE_API_KEY not set');
  process.exit(1);
}

async function queryCollection(collectionPath, whereField, whereOp, whereValue) {
  const url = `${BASE_URL}/${collectionPath}:runQuery?key=${API_KEY}`;
  
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: collectionPath.split('/').pop() }],
        where: whereField ? {
          fieldFilter: {
            field: { fieldPath: whereField },
            op: whereOp,
            value: { stringValue: whereValue }
          }
        } : undefined,
        orderBy: [{ field: { fieldPath: '__name__' }, direction: 'DESCENDING' }],
        limit: 10
      }
    })
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`Query ${collectionPath} failed:`, text.slice(0, 200));
    return [];
  }

  try {
    const lines = text.trim().split('\n');
    return lines.map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

async function main() {
  console.log('🔍 Checking webhook events in Firestore...\n');

  // Check webhook_events_debug
  const debugEvents = await queryCollection('webhook_events_debug');
  console.log(`📊 Latest webhook_events_debug: ${debugEvents.length} records`);
  if (debugEvents.length > 0) {
    const latest = debugEvents[0]?.document?.fields;
    if (latest) {
      console.log('  Latest event:');
      console.log('    - messageText:', latest.messageText?.stringValue || '(none)');
      console.log('    - hasSangCommand:', latest.hasSangCommand?.booleanValue ?? false);
      console.log('    - forceCommand:', latest.forceCommand?.booleanValue ?? false);
      console.log('    - timestamp:', latest.timestamp?.timestampValue || '(none)');
    }
  }

  // Check tasks collection for recent
  const tasks = await queryCollection('tasks');
  console.log(`\n📋 Latest tasks: ${tasks.length} records`);
  if (tasks.length > 0) {
    const latest = tasks[0]?.document;
    if (latest) {
      console.log('  Latest task:');
      console.log('    - title:', latest.fields?.title?.stringValue || '(none)');
      console.log('    - source:', latest.fields?.source?.stringValue || '(none)');
      console.log('    - createdAt:', latest.fields?.createdAt?.timestampValue || '(none)');
    }
  }
}

main().catch(console.error);
