import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';

const fallbackConfig = {
  projectId: "edit-d0700",
  appId: "1:934498052644:web:f0f46786890973c406c6b1",
  apiKey: "AIzaSyDPWOR9etKCK8VGfCrn8Ak5XRMNYzedZeI",
  authDomain: "edit-d0700.firebaseapp.com",
  firestoreDatabaseId: "(default)",
  storageBucket: "edit-d0700.firebasestorage.app",
  messagingSenderId: "934498052644",
};

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || fallbackConfig.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || fallbackConfig.authDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || fallbackConfig.projectId,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || fallbackConfig.storageBucket,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || fallbackConfig.messagingSenderId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || fallbackConfig.appId,
};

const app = initializeApp(firebaseConfig);
const databaseId = import.meta.env.VITE_FIREBASE_DATABASE_ID || fallbackConfig.firestoreDatabaseId || '(default)';
export const db = getFirestore(app, databaseId);
export const auth = getAuth(app);

// Simple connection test
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
testConnection();
