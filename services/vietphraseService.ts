
import { CustomTerm } from "../types";

export interface TrieNode {
  children: Map<string, TrieNode>;
  value?: string; // Nghĩa tiếng Việt
}

// --- INDEXED DB HELPER ---
const DB_NAME = 'ChiVietDB';
const DB_VERSION = 3;
const STORE_NAME = 'settings';
const KEY_VIETPHRASE = 'vietphrase_data';

const dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
        reject("IndexedDB not supported");
        return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
        }
    };
});

const saveToDB = async (key: string, value: any) => {
    try {
        const db = await dbPromise;
        return new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.put(value, key);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    } catch (e) {
        console.error("DB Save Error", e);
    }
};

const loadFromDB = async (key: string): Promise<any> => {
    try {
        const db = await dbPromise;
        return new Promise<any>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    } catch (e) {
        console.error("DB Load Error", e);
        return null;
    }
};

class VietphraseEngine {
  private dictionary: Map<string, string>;
  private maxKeyLength: number;
  private isLoaded: boolean = false;

  constructor() {
    this.dictionary = new Map();
    this.maxKeyLength = 0;
  }

  // Khởi tạo: Load từ DB nếu có
  async init() {
      if (this.isLoaded) return;
      const savedContent = await loadFromDB(KEY_VIETPHRASE);
      if (savedContent && typeof savedContent === 'string') {
          this.loadDictionary(savedContent, false); // false = không lưu lại vào DB nữa
          console.log("Đã khôi phục Vietphrase từ DB");
      }
      this.isLoaded = true;
  }

  // Lấy số lượng từ hiện tại
  getSize(): number {
    return this.dictionary.size;
  }

  // Nạp dữ liệu từ nội dung file text (Format: Trung=Việt)
  loadDictionary(content: string, save: boolean = true) {
    this.dictionary.clear();
    this.maxKeyLength = 0;
    
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim() || line.startsWith('#')) continue;
      
      const parts = line.split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts[1].trim();
        if (key && value) {
            this.dictionary.set(key, value);
            if (key.length > this.maxKeyLength) {
                this.maxKeyLength = key.length;
            }
        }
      }
    }
    console.log(`Đã nạp ${this.dictionary.size} từ Vietphrase. Max length: ${this.maxKeyLength}`);
    
    if (save) {
        saveToDB(KEY_VIETPHRASE, content).then(() => console.log("Đã lưu Vietphrase vào DB"));
    }
    
    return this.dictionary.size;
  }

  // Thuật toán Forward Maximum Matching (Dịch ưu tiên cụm dài nhất)
  // Cập nhật: Ưu tiên Custom Terms
  translate(text: string, customTerms: CustomTerm[] | Map<string, string> = []): string {
    // 1. Prepare Custom Map
    let customMap: Map<string, string>;
    let maxCustomLength = 0;

    if (customTerms instanceof Map) {
        customMap = customTerms;
        for (const key of customMap.keys()) {
            if (key.length > maxCustomLength) maxCustomLength = key.length;
        }
    } else {
        customMap = new Map<string, string>();
        for (const t of customTerms) {
            if (t.term && t.meaning) {
                customMap.set(t.term.trim(), t.meaning.trim());
                if (t.term.trim().length > maxCustomLength) maxCustomLength = t.term.trim().length;
            }
        }
    }

    if (this.dictionary.size === 0 && customMap.size === 0) return text;

    let result = "";
    let i = 0;
    const n = text.length;
    const globalMaxLen = Math.max(this.maxKeyLength, maxCustomLength);

    while (i < n) {
      let matched = false;
      // Thử tìm từ dài nhất bắt đầu từ vị trí i
      const limit = Math.min(n, i + globalMaxLen);
      
      for (let j = limit; j > i; j--) {
        const sub = text.substring(i, j);
        
        // ƯU TIÊN 1: Kiểm tra Custom Dictionary trước
        if (customMap.has(sub)) {
             result += " " + customMap.get(sub) + " ";
             i = j;
             matched = true;
             break;
        }

        // ƯU TIÊN 2: Kiểm tra Vietphrase Dictionary
        if (this.dictionary.has(sub)) {
          // Tìm thấy cụm từ trong từ điển
          let meaning = this.dictionary.get(sub) || sub;
          // Xử lý nếu nghĩa có nhiều lựa chọn (VD: Nghĩa1/Nghĩa2) -> lấy nghĩa đầu
          if (meaning.includes('/')) {
              meaning = meaning.split('/')[0];
          }
          result += " " + meaning + " ";
          i = j;
          matched = true;
          break;
        }
      }

      if (!matched) {
        // Không tìm thấy, giữ nguyên ký tự hiện tại
        result += text[i];
        i++;
      }
    }

    // Chuẩn hóa khoảng trắng thừa
    return result.replace(/\s+/g, ' ').trim();
  }
}

export const vietphraseEngine = new VietphraseEngine();
