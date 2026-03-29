const API_KEY = process.env.FIREBASE_API_KEY;
const PROJECT = 'ceo-flow';

if (!API_KEY) {
  console.error('❌ API key missing');
  process.exit(1);
}

async function checkLatestEvents() {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/webhook_events_debug?key=${API_KEY}&pageSize=1`;
  
  try {
    const res = await fetch(url);
    const data = await res.json();
    
    if (!res.ok) {
      console.error('❌ Request failed:', data.error?.message);
      return null;
    }
    
    return data.documents ? data.documents[0] : null;
  } catch (err) {
    console.error('❌ Error:', err.message);
    return null;
  }
}

async function monitorEvents() {
  console.log('🔍 Monitoring webhook events... (Ctrl+C to stop)\n');
  
  let lastId = null;
  
  setInterval(async () => {
    const doc = await checkLatestEvents();
    if (!doc || doc.name === lastId) return;
    
    lastId = doc.name;
    const fields = doc.fields || {};
    
    const text = fields.text?.stringValue || '(no text)';
    const hasSang = fields.hasSangCommand?.booleanValue ?? false;
    const forceCmd = fields.forceCommand?.booleanValue ?? false;
    const ts = new Date(fields.lineEventTimestamp?.integerValue || Date.now()).toLocaleTimeString();
    
    console.log(`\n⏰ ${ts}`);
    console.log(`📝 Text: "${text}"`);
    console.log(`🔍 hasSangCommand: ${hasSang}`);
    console.log(`⚡ forceCommand: ${forceCmd}`);
    console.log(`📋 Source: ${fields.sourceType?.stringValue || 'unknown'} / Group: ${fields.groupId?.stringValue || 'none'}`);
    
    // Check for sang-specific fields
    if (text.includes('/สั่ง')) {
      console.log('✅ Found /สั่ง in text!');
      if (!hasSang && !forceCmd) {
        console.log('❌ BUT hasSangCommand and forceCommand are both FALSE!');
      }
    }
  }, 2000);
}

monitorEvents().catch(console.error);
