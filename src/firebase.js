import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const publicFallbackConfig = {
    apiKey: 'AIzaSyC0cPDAiLsjEOtwoOIYTHhzjPYKtBDJn30',
    authDomain: 'ceo-flow.firebaseapp.com',
    projectId: 'ceo-flow',
    storageBucket: 'ceo-flow.firebasestorage.app',
    messagingSenderId: '841875636090',
    appId: '1:841875636090:web:8d8fb41f25c8efaabe20c3'
};

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || publicFallbackConfig.apiKey,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || publicFallbackConfig.authDomain,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || publicFallbackConfig.projectId,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || publicFallbackConfig.storageBucket,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || publicFallbackConfig.messagingSenderId,
    appId: import.meta.env.VITE_FIREBASE_APP_ID || publicFallbackConfig.appId
};

const missingKeys = Object.entries(firebaseConfig)
    .filter(([, value]) => !String(value || '').trim())
    .map(([key]) => key);

export const hasFirebaseConfig = missingKeys.length === 0;

if (!hasFirebaseConfig) {
    console.warn(`⚠️ Firebase config incomplete. Using fallback config. Missing keys: ${missingKeys.join(', ')}`);
} else {
    console.log('✅ Firebase config loaded successfully');
}

const app = hasFirebaseConfig ? initializeApp(firebaseConfig) : null;
export const db = app ? getFirestore(app) : null;
export const storage = app ? getStorage(app) : null;

// Log Firebase initialization status
if (db) {
    console.log('✅ Firestore initialized');
} else {
    console.error('❌ Firestore not initialized - using local mode only');
}
