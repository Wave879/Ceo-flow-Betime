const API_KEY = process.env.FIREBASE_API_KEY;
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'ceo-flow';

if (!API_KEY) {
  console.error('❌ FIREBASE_API_KEY not set');
  process.exit(1);
}

async function listDocuments(collectionPath) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collectionPath}?key=${API_KEY}&pageSize=10`;
  
  try {
    const res = await fetch(url);
    const data = await res.json();
    
    if (!res.ok) {
      console.error(`❌ Query ${collectionPath} failed:`, data.error?.message);
      return [];
    }
    
    return data.documents || [];
  } catch (err) {
    console.error(`❌ Network error querying ${collectionPath}:`, err.message);
    return [];
  }
}

async function main() {
  console.log('🔍 Checking Firestore collections...\n');

  // Check webhook_events_debug
  const debugEvents = await listDocuments('webhook_events_debug');
  console.log(`📊 webhook_events_debug records: ${debugEvents.length}`);
  if (debugEvents.length > 0) {
    const latest = debugEvents[0];
    console.log('  Latest:');
    console.log('    - messageText:', latest.fields?.messageText?.stringValue?.slice(0, 100) || '(none)');
    console.log('    - hasSangCommand:', latest.fields?.hasSangCommand?.booleanValue ?? false);
    console.log('    - timestamp:', latest.fields?.timestamp?.timestampValue || '(none)');
  }

  // Check tasks collection
  const tasks = await listDocuments('tasks');
  console.log(`\n📋 tasks records: ${tasks.length}`);
  if (tasks.length > 0) {
    const latest = tasks[0];
    console.log('  Latest:');
    console.log('    - title:', latest.fields?.title?.stringValue?.slice(0, 80) || '(none)');
    console.log('    - source:', latest.fields?.source?.stringValue || '(none)');
    console.log('    - createdAt:', latest.fields?.createdAt?.timestampValue?.slice(0, 19) || '(none)');
  }
}

main().catch(console.error);
