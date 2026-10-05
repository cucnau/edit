import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const config = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(config);
const auth = getAuth(app);
const db = getFirestore(app, config.firestoreDatabaseId);

async function run() {
    try {
        await signInAnonymously(auth);
        const snap = await getDocs(collection(db, 'novels'));
        console.log("Novels:", snap.size);
    } catch(e) {
        console.log("Error:", e.message);
    }
}
run();
