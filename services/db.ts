
import { CustomTerm, Chapter, VietphraseFile } from '../types';
import {
  getScopedDbName,
  getLegacyDbName,
  getAppScope,
  getLocationHash,
  APP_SIGNATURE,
  hasLegacyLocalData
} from './storageScope';

// IndexedDB Service - Cô lập tuyệt đối theo từng ứng dụng + vị trí URL + xác thực danh tính
const DB_NAME = getScopedDbName();
const DB_VERSION = 5;
const STORE_SETTINGS = 'settings';
const STORE_CUSTOM_TERMS = 'custom_terms';
const STORE_CHAPTERS = 'chapters';

export const KEY_VIETPHRASE = 'vietphrase_data';
export const KEY_VIETPHRASE_FILES = 'vietphrase_files';
export const KEY_ACTIVE_SESSION = 'active_session_data';
export const KEY_HISTORY = 'app_history_data';
const KEY_APP_IDENTITY = '__app_identity';

interface DbAppIdentity {
  signature: string;
  locationHash: string;
  scope: string;
  createdAt: number;
}

function openSingleDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(name, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS);
      }
      if (!db.objectStoreNames.contains(STORE_CUSTOM_TERMS)) {
        db.createObjectStore(STORE_CUSTOM_TERMS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_CHAPTERS)) {
        db.createObjectStore(STORE_CHAPTERS, { keyPath: 'id' });
      }
    };
  });
}

function idbGet<T = any>(db: IDBDatabase, storeName: string, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(storeName)) {
      resolve(undefined);
      return;
    }
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, storeName: string, value: any, key?: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = key !== undefined ? store.put(value, key) : store.put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbGetAll<T = any>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(storeName)) {
      resolve([]);
      return;
    }
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function doesLegacyDbExist(legacyDbName: string): Promise<boolean> {
  try {
    if (typeof window.indexedDB.databases === 'function') {
      const dbs = await window.indexedDB.databases();
      return dbs.some(d => d.name === legacyDbName);
    }
  } catch {
    // ignore
  }
  return hasLegacyLocalData();
}

async function migrateLegacyDbIfNeeded(targetDb: IDBDatabase): Promise<void> {
  const existingIdentity = await idbGet<DbAppIdentity>(targetDb, STORE_SETTINGS, KEY_APP_IDENTITY);
  if (existingIdentity) {
    // Xác thực chữ ký DB đang mở phải khớp hoàn toàn với ứng dụng hiện tại
    if (existingIdentity.signature !== APP_SIGNATURE || existingIdentity.locationHash !== getLocationHash()) {
      throw new Error('IndexedDB identity mismatch - blocked to prevent cross-app data leakage');
    }
    return;
  }

  // Kiểm tra xem DB cũ của chính web này có tồn tại để di trú 1 lần không
  const legacyDbName = getLegacyDbName();
  if (legacyDbName && legacyDbName !== DB_NAME) {
    const exists = await doesLegacyDbExist(legacyDbName);
    if (exists) {
      let legacyDb: IDBDatabase | null = null;
      try {
        legacyDb = await openSingleDb(legacyDbName);
        const settingKeys = [KEY_VIETPHRASE, KEY_VIETPHRASE_FILES, KEY_ACTIVE_SESSION, KEY_HISTORY];
        for (const k of settingKeys) {
          const val = await idbGet(legacyDb, STORE_SETTINGS, k);
          if (val !== undefined && val !== null) {
            await idbPut(targetDb, STORE_SETTINGS, val, k);
          }
        }

        const legacyTerms = await idbGetAll<CustomTerm>(legacyDb, STORE_CUSTOM_TERMS);
        if (legacyTerms.length > 0) {
          await new Promise<void>((resolve, reject) => {
            const tx = targetDb.transaction(STORE_CUSTOM_TERMS, 'readwrite');
            const store = tx.objectStore(STORE_CUSTOM_TERMS);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            legacyTerms.forEach(item => store.put(item));
          });
        }

        const legacyChapters = await idbGetAll<Chapter>(legacyDb, STORE_CHAPTERS);
        if (legacyChapters.length > 0) {
          await new Promise<void>((resolve, reject) => {
            const tx = targetDb.transaction(STORE_CHAPTERS, 'readwrite');
            const store = tx.objectStore(STORE_CHAPTERS);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            legacyChapters.forEach(item => store.put(item));
          });
        }
      } catch (e) {
        console.warn('Không thể di trú DB cũ (bỏ qua an toàn):', e);
      } finally {
        if (legacyDb) {
          try {
            legacyDb.close();
          } catch {}
        }
      }
    }
  }

  // Đóng dấu danh tính ứng dụng vào DB mới
  await idbPut(
    targetDb,
    STORE_SETTINGS,
    {
      signature: APP_SIGNATURE,
      locationHash: getLocationHash(),
      scope: getAppScope(),
      createdAt: Date.now()
    } as DbAppIdentity,
    KEY_APP_IDENTITY
  );
}

const dbPromise = (async (): Promise<IDBDatabase> => {
  if (typeof window === 'undefined' || !window.indexedDB) {
    throw new Error('IndexedDB not supported');
  }
  const database = await openSingleDb(DB_NAME);
  await migrateLegacyDbIfNeeded(database);
  return database;
})();

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

    async getVietphraseFiles(): Promise<VietphraseFile[] | null> {
        try {
            const db = await dbPromise;
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_SETTINGS, 'readonly');
                const store = tx.objectStore(STORE_SETTINGS);
                const req = store.get(KEY_VIETPHRASE_FILES);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => reject(req.error);
            });
        } catch (e) {
            console.error("DB Get Vietphrase Files Error", e);
            return null;
        }
    },

    async saveVietphraseFiles(files: VietphraseFile[]): Promise<void> {
        try {
            const db = await dbPromise;
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_SETTINGS, 'readwrite');
                const store = tx.objectStore(STORE_SETTINGS);
                const req = store.put(files, KEY_VIETPHRASE_FILES);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        } catch (e) {
            console.error("DB Save Vietphrase Files Error", e);
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

                // Xóa toàn bộ dữ liệu cũ trong store rồi ghi lại danh sách mới để các từ bị xóa biến mất hoàn toàn
                store.clear();
                terms.forEach(term => {
                    store.put(term);
                });
            });
        } catch (e) {
            console.error("DB Bulk Save Error", e);
        }
    },

    async getAllChapters(): Promise<Chapter[]> {
        try {
            const db = await dbPromise;
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_CHAPTERS, 'readonly');
                const store = tx.objectStore(STORE_CHAPTERS);
                const req = store.getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => reject(req.error);
            });
        } catch (e) {
            console.error("DB Get Chapters Error", e);
            return [];
        }
    },

    async saveChapter(chapter: Chapter): Promise<void> {
        try {
            const db = await dbPromise;
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_CHAPTERS, 'readwrite');
                const store = tx.objectStore(STORE_CHAPTERS);
                const req = store.put(chapter);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        } catch (e) {
            console.error("DB Save Chapter Error", e);
        }
    },

    async deleteChapter(id: string): Promise<void> {
        try {
            const db = await dbPromise;
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_CHAPTERS, 'readwrite');
                const store = tx.objectStore(STORE_CHAPTERS);
                const req = store.delete(id);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        } catch (e) {
            console.error("DB Delete Chapter Error", e);
        }
    },

    async clearAllChapters(): Promise<void> {
        try {
            const db = await dbPromise;
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_CHAPTERS, 'readwrite');
                const store = tx.objectStore(STORE_CHAPTERS);
                const req = store.clear();
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        } catch (e) {
            console.error("DB Clear Chapters Error", e);
        }
    },

    async getActiveSession(): Promise<any | null> {
        try {
            const db = await dbPromise;
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_SETTINGS, 'readonly');
                const store = tx.objectStore(STORE_SETTINGS);
                const req = store.get(KEY_ACTIVE_SESSION);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => reject(req.error);
            });
        } catch (e) {
            console.error("DB Get Active Session Error", e);
            return null;
        }
    },

    async saveActiveSession(sessionData: any): Promise<void> {
        try {
            const db = await dbPromise;
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_SETTINGS, 'readwrite');
                const store = tx.objectStore(STORE_SETTINGS);
                const req = store.put(sessionData, KEY_ACTIVE_SESSION);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        } catch (e) {
            console.error("DB Save Active Session Error", e);
        }
    },

    async getHistory(): Promise<any[] | null> {
        try {
            const db = await dbPromise;
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_SETTINGS, 'readonly');
                const store = tx.objectStore(STORE_SETTINGS);
                const req = store.get(KEY_HISTORY);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => reject(req.error);
            });
        } catch (e) {
            console.error("DB Get History Error", e);
            return null;
        }
    },

    async saveHistory(historyList: any[]): Promise<void> {
        try {
            const db = await dbPromise;
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_SETTINGS, 'readwrite');
                const store = tx.objectStore(STORE_SETTINGS);
                const req = store.put(historyList, KEY_HISTORY);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        } catch (e) {
            console.error("DB Save History Error", e);
        }
    }
};
