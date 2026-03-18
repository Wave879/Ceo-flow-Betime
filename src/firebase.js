import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyC0cPDAiLsjEOtwoOIYTHhzjPYKtBDJn30",
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "ceo-flow.firebaseapp.com",
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "ceo-flow",
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "ceo-flow.firebasestorage.app",
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "841875636090",
    appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:841875636090:web:8d8fb41f25c8efaabe20c3"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);
