
import { CustomTerm } from '../types';

// IndexedDB Service
const DB_NAME = 'ChiVietDB';
const DB_VERSION = 4;
const STORE_SETTINGS = 'settings';
const STORE_CUSTOM_TERMS = 'custom_terms';

export const KEY_VIETPHRASE = 'vietphrase_data';

const dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
        reject("IndexedDB not supported");
        return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => {
        console.error("DB Open Error", request.error);
        reject(request.error);
    };
    
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
            db.createObjectStore(STORE_SETTINGS);
        }
        if (!db.objectStoreNames.contains(STORE_CUSTOM_TERMS)) {
            db.createObjectStore(STORE_CUSTOM_TERMS, { keyPath: 'id' });
        }
    };
});

export const db = {
    async getVietphrase(): Promise<string | null> {
        try {
            const db = await dbPromise;
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_SETTINGS, 'readonly');
                const store = tx.objectStore(STORE_SETTINGS);
                const req = store.get(KEY_VIETPHRASE);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        } catch (e) {
            console.error("DB Get Vietphrase Error", e);
            return null;
        }
    },

    async saveVietphrase(content: string): Promise<void> {
        try {
            const db = await dbPromise;
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_SETTINGS, 'readwrite');
                const store = tx.objectStore(STORE_SETTINGS);
                const req = store.put(content, KEY_VIETPHRASE);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        } catch (e) {
            console.error("DB Save Vietphrase Error", e);
        }
    },

    async getAllCustomTerms(): Promise<CustomTerm[]> {
        try {
            const db = await dbPromise;
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_CUSTOM_TERMS, 'readonly');
                const store = tx.objectStore(STORE_CUSTOM_TERMS);
                const req = store.getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => reject(req.error);
            });
        } catch (e) {
            console.error("DB Get Terms Error", e);
            return [];
        }
    },

    async saveCustomTerm(term: CustomTerm): Promise<void> {
        try {
            const db = await dbPromise;
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_CUSTOM_TERMS, 'readwrite');
                const store = tx.objectStore(STORE_CUSTOM_TERMS);
                const req = store.put(term);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        } catch (e) {
            console.error("DB Save Term Error", e);
        }
    },

    async deleteCustomTerm(id: string): Promise<void> {
        try {
            const db = await dbPromise;
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_CUSTOM_TERMS, 'readwrite');
                const store = tx.objectStore(STORE_CUSTOM_TERMS);
                const req = store.delete(id);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        } catch (e) {
            console.error("DB Delete Term Error", e);
        }
    },

    async bulkSaveCustomTerms(terms: CustomTerm[]): Promise<void> {
        try {
            const db = await dbPromise;
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_CUSTOM_TERMS, 'readwrite');
                const store = tx.objectStore(STORE_CUSTOM_TERMS);
                
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error);

                const clearReq = store.clear();
                
                clearReq.onsuccess = () => {
                    terms.forEach(term => {
                        store.put(term);
                    });
                };
                
                clearReq.onerror = (e) => {
                     // If clear fails, we should probably abort or reject
                     console.error("Clear store failed", e);
                     // The tx.onerror should catch this, but let's be safe
                };
            });
        } catch (e) {
            console.error("DB Bulk Save Error", e);
        }
    }
};
