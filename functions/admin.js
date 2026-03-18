import admin from 'firebase-admin';
import serviceAccount from '../../ceo-flow-firebase-adminsdk-fbsvc-1de8871f56.json' assert { type: 'json' };

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

export const dbAdmin = admin.firestore();

