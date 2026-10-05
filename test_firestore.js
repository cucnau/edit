import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, query, where, getDocs } from 'firebase/firestore';
import fs from 'fs';

const config = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(config);
const auth = getAuth(app);
const db = getFirestore(app, config.firestoreDatabaseId);

async function run() {
    try {
        await signInWithEmailAndPassword(auth, 'askerhater21@gmail.com', '123456'); // Fake password, wait, I can't login easily.
        console.log("Logged in");
    } catch(e) {
        console.log("Login failed", e.message);
    }
}
run();
