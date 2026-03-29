const API_KEY = process.env.FIREBASE_API_KEY;
const PROJECT = process.env.FIREBASE_PROJECT_ID || 'ceo-flow';

if (!API_KEY) {
  console.error('❌ API key missing');
  process.exit(1);
}

async function getDebugEvents() {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/webhook_events_debug?key=${API_KEY}&pageSize=3`;
  
  try {
    const res = await fetch(url);
    const data = await res.json();
    
    if (!res.ok) {
      console.error('❌ Request failed:', data.error?.message);
      return [];
    }
    
    return data.documents || [];
  } catch (err) {
    console.error('❌ Error:', err.message);
    return [];
  }
}

async function main() {
  console.log('📋 Latest webhook debug events from ceo-flow:\n');
  const events = await getDebugEvents();
  
  events.forEach((doc, idx) => {
    console.log(`Event ${idx + 1}:`);
    const fields = doc.fields || {};
    
    for (const [key, value] of Object.entries(fields)) {
      const val = value.stringValue || value.booleanValue || value.integerValue || JSON.stringify(value).slice(0, 50);
      console.log(`  ${key}: ${val}`);
    }
    console.log('');
  });
}

main().catch(console.error);
