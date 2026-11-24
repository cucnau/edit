import { db, auth } from './firebase';
import { getAppScope, APP_SIGNATURE } from './storageScope';
import { collection, doc, setDoc, getDoc, getDocs, deleteDoc, writeBatch, query, where, Timestamp, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { CustomTerm, Character, Relationship, Novel, Chapter, TextShortcut, TranslationResponse } from '../types';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const sanitizeData = (obj: any): any => {
  if (obj === null || obj === undefined) return null;
  if (typeof obj !== 'object') return obj;
  if (obj instanceof Timestamp) return obj;
  if (Array.isArray(obj)) {
    return obj.map(sanitizeData).filter(v => v !== undefined);
  }
  const result: Record<string, any> = {};
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val !== undefined && val !== null) {
      const sanitizedVal = sanitizeData(val);
      if (sanitizedVal !== undefined && sanitizedVal !== null) {
        result[key] = sanitizedVal;
      }
    }
  }
  return result;
};

const dbCache = new Map<string, Map<string, any>>(); // Global cache to prevent repeated getDocs on POST

export const getNovels = async (): Promise<Novel[]> => {
  const user = auth.currentUser;
  if (!user) throw new Error('Bạn cần đăng nhập!');
  const path = 'novels';
  try {
    const q = query(collection(db, path), where('userId', '==', user.uid));
    const snap = await getDocs(q);
    const novels: Novel[] = [];
    snap.forEach(d => {
      novels.push({ id: d.id, name: d.data().name });
    });
    return novels;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
};

export const createNovel = async (id: string, name: string): Promise<Novel> => {
  const user = auth.currentUser;
  if (!user) throw new Error('Bạn cần đăng nhập!');
  const path = `novels/${id}`;
  try {
    const novelRef = doc(collection(db, 'novels'), id);
    await setDoc(novelRef, { userId: user.uid, name, createdAt: Timestamp.now() });
    return { id, name };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
};

export const renameNovel = async (id: string, name: string): Promise<void> => {
  const user = auth.currentUser;
  if (!user) throw new Error('Bạn cần đăng nhập!');
  const path = `novels/${id}`;
  try {
    await setDoc(doc(db, 'novels', id), { userId: user.uid, name: name.trim() }, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
};

export const listenToNovelsRealtime = (
  onUpdate: (novels: Novel[]) => void
): Unsubscribe | null => {
  const user = auth.currentUser;
  if (!user) return null;

  const q = query(collection(db, 'novels'), where('userId', '==', user.uid));
  return onSnapshot(q, (snapshot) => {
    const novels: Novel[] = [];
    snapshot.forEach(d => {
      const data = d.data();
      novels.push({ id: d.id, name: data.name || 'Không tên' });
    });
    onUpdate(novels);
  }, (error) => {
    console.warn("Lỗi lắng nghe danh sách truyện realtime:", error);
  });
};

export const deleteNovel = async (id: string): Promise<void> => {
  const user = auth.currentUser;
  if (!user) throw new Error('Bạn cần đăng nhập!');
  const path = `novels/${id}`;
  try {
    await deleteDoc(doc(db, 'novels', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
};

export const deleteFirestoreDoc = async (type: 'vocab' | 'char' | 'rel' | 'chapter' | 'shortcut', id?: string, termText?: string): Promise<void> => {
  const user = auth.currentUser;
  if (!user) return;
  const collectionName = type === 'vocab' ? 'customTerms' : type === 'char' ? 'characters' : type === 'rel' ? 'relationships' : type === 'shortcut' ? 'shortcuts' : 'chapters';
  try {
    if (id) {
      await deleteDoc(doc(db, collectionName, id));
    }
    if (termText && (type === 'vocab' || type === 'char')) {
      const field = type === 'vocab' ? 'term' : 'chineseName';
      const q = query(collection(db, collectionName), where('userId', '==', user.uid), where(field, '==', termText.trim()));
      const snap = await getDocs(q);
      snap.forEach(d => {
        deleteDoc(d.ref).catch(console.warn);
      });
    }
  } catch (error) {
    console.warn(`Lỗi xóa ${collectionName}/${id}:`, error);
  }
};

export const overwriteFirestoreData = async <T extends { id: string, novelId?: string }>(
  type: 'vocab' | 'char' | 'rel' | 'chapter' | 'shortcut',
  novelId: string,
  newItems: T[]
): Promise<void> => {
  const user = auth.currentUser;
  if (!user || !novelId) return;

  const isChunkedType = type !== 'chapter';
  if (isChunkedType) {
    // Tận dụng lại logic phân mảnh bundle của syncFirestoreData
    await syncFirestoreData(type, novelId, 'POST', newItems);
    return;
  }

  const collectionName = 'chapters';
  const collRef = collection(db, collectionName);

  // 1. Fetch all existing documents belonging to this user and novelId
  const q = query(collRef, where('userId', '==', user.uid), where('novelId', '==', novelId));
  const snapshot = await getDocs(q);

  const operations: { type: 'set' | 'delete', ref: any, data?: any }[] = [];

  // Delete all existing items
  snapshot.forEach(docSnap => {
    operations.push({ type: 'delete', ref: docSnap.ref });
  });

  // Prepare new items to insert
  newItems.forEach(item => {
    const rawData = {
      ...item,
      novelId,
      userId: user.uid,
      createdAt: Timestamp.now()
    };
    const dataToSave = sanitizeData(rawData);
    Object.keys(dataToSave).forEach(k => {
      if (dataToSave[k] === undefined) delete dataToSave[k];
    });
    operations.push({
      type: 'set',
      ref: doc(collRef, item.id),
      data: dataToSave
    });
  });

  // Execute in small batches to stay well within Firestore 10MB payload & 500 write limit
  const CHUNK_SIZE = 80;
  for (let i = 0; i < operations.length; i += CHUNK_SIZE) {
    const chunk = operations.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    chunk.forEach(op => {
      if (op.type === 'delete') {
        batch.delete(op.ref);
      } else {
        batch.set(op.ref, op.data, { merge: true });
      }
    });
    await batch.commit();
  }

  // Clear cache
  dbCache.delete(`${collectionName}_${novelId}`);
};

// Tối ưu hóa Firestore: Gom toàn bộ từ vựng / nhân vật / mối quan hệ / phím tắt vào một document duy nhất theo novelId
export const syncFirestoreData = async <T extends { id: string, novelId?: string }>(
  type: 'vocab' | 'char' | 'rel' | 'chapter' | 'shortcut',
  novelId: string,
  action: 'GET' | 'POST',
  payload?: T[]
): Promise<T[]> => {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Bạn cần đăng nhập để đồng bộ dữ liệu!');
  }
  if (!novelId) {
    throw new Error('Chưa chọn truyện!');
  }

  // Đối với vocab, char, rel, shortcut: Gom thành 1 document duy nhất `store_${type}_${novelId}`
  // Giúp giảm từ hàng nghìn lần read/write xuống đúng 1 lần đọc và 1 lần ghi!
  const isChunkedType = type !== 'chapter';
  const collectionName = type === 'vocab' ? 'customTerms' : type === 'char' ? 'characters' : type === 'rel' ? 'relationships' : type === 'shortcut' ? 'shortcuts' : 'chapters';

  if (isChunkedType) {
    const docId = `bundle_${user.uid}_${novelId}`;
    const chunkDocRef = doc(db, `${collectionName}_bundles`, docId);

    if (action === 'GET') {
      try {
        const docSnap = await getDocs(query(collection(db, `${collectionName}_bundles`), where('userId', '==', user.uid), where('novelId', '==', novelId)));
        if (!docSnap.empty) {
          let allItems: any[] = [];
          docSnap.docs.forEach(d => {
            const data = d.data();
            if (data.items) {
              allItems = allItems.concat(data.items);
            }
          });
          return allItems as T[];
        }

        // Fallback kiểm tra dữ liệu cũ nếu chưa gom bundle
        const collRef = collection(db, collectionName);
        const q = query(collRef, where('userId', '==', user.uid));
        const legacySnap = await getDocs(q);
        const legacyItems: any[] = [];
        legacySnap.forEach(d => {
          const itemData = d.data();
          if (!itemData.novelId || itemData.novelId === novelId) {
            const { userId, createdAt, ...rest } = itemData;
            legacyItems.push({ id: d.id, ...rest, novelId: itemData.novelId || novelId });
          }
        });
        return legacyItems as T[];
      } catch (err) {
        console.warn(`Lỗi lấy dữ liệu ${collectionName}:`, err);
        return [];
      }
    } else if (action === 'POST' && payload) {
      const targetPayload = payload.filter(item => !item.novelId || item.novelId === novelId);
      
      try {
        const BUNDLE_SIZE = 1500; // Giới hạn số lượng item mỗi bundle để tránh lỗi 400 Payload Too Large
        
        // 1. Xóa tất cả các bundle cũ
        const oldBundlesSnap = await getDocs(query(collection(db, `${collectionName}_bundles`), where('userId', '==', user.uid), where('novelId', '==', novelId)));
        const batch = writeBatch(db);
        
        oldBundlesSnap.forEach(d => {
          batch.delete(d.ref);
        });
        
        // 2. Chia nhỏ targetPayload thành nhiều chunks
        for (let i = 0; i < targetPayload.length; i += BUNDLE_SIZE) {
          const chunk = targetPayload.slice(i, i + BUNDLE_SIZE);
          const chunkId = `bundle_${user.uid}_${novelId}_${i / BUNDLE_SIZE}`;
          const dataToSave = sanitizeData({
            userId: user.uid,
            novelId,
            items: chunk,
            updatedAt: Date.now(),
            chunkIndex: i / BUNDLE_SIZE
          });
          batch.set(doc(db, `${collectionName}_bundles`, chunkId), dataToSave);
        }
        
        await batch.commit();
      } catch (err) {
        console.error(`Lỗi khi lưu bundle ${collectionName}:`, err);
      }
      return payload;
    }
  }

  return [];
};

export const getAllUserCustomTermsFromCloud = async (): Promise<CustomTerm[]> => {
  const user = auth.currentUser;
  if (!user) return [];
  try {
    const termsMap = new Map<string, CustomTerm>();
    
    // 1. Quét tất cả bundles customTerms_bundles của user này trên Firestore
    const bundlesSnap = await getDocs(query(collection(db, 'customTerms_bundles'), where('userId', '==', user.uid)));
    bundlesSnap.forEach(d => {
      const data = d.data();
      if (data.items && Array.isArray(data.items)) {
        data.items.forEach((item: any) => {
          if (item && item.id && item.term) {
            termsMap.set(item.id, item as CustomTerm);
          }
        });
      }
    });

    // 2. Quét cả dữ liệu dạng document đơn lẻ (legacy) nếu có
    const legacySnap = await getDocs(query(collection(db, 'customTerms'), where('userId', '==', user.uid)));
    legacySnap.forEach(d => {
      const itemData = d.data();
      if (itemData && itemData.term) {
        const { userId, createdAt, ...rest } = itemData;
        const term: CustomTerm = { id: d.id, ...rest } as CustomTerm;
        if (!termsMap.has(term.id)) {
          termsMap.set(term.id, term);
        }
      }
    });

    return Array.from(termsMap.values());
  } catch (err) {
    console.warn("Lỗi khôi phục toàn bộ từ vựng từ Cloud:", err);
    return [];
  }
};

export const getAllUserChaptersFromCloud = async (): Promise<Chapter[]> => {
  const user = auth.currentUser;
  if (!user) return [];
  try {
    const q = query(collection(db, 'chapters'), where('userId', '==', user.uid));
    const snap = await getDocs(q);
    const chapters: Chapter[] = [];
    snap.forEach(d => {
      const data = d.data();
      const { userId, ...rest } = data;
      chapters.push({ id: d.id, ...rest } as Chapter);
    });
    chapters.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    return chapters;
  } catch (error) {
    console.warn("Không thể tải toàn bộ kho chương từ đám mây:", error);
    return [];
  }
};

export const getChaptersFromCloud = async (novelId: string, retryCount = 1): Promise<Chapter[]> => {
  const user = auth.currentUser;
  if (!user) return [];
  const path = 'chapters';
  try {
    const q = novelId 
      ? query(collection(db, path), where('userId', '==', user.uid), where('novelId', '==', novelId))
      : query(collection(db, path), where('userId', '==', user.uid));
    const snap = await getDocs(q);
    const chapters: Chapter[] = [];
    snap.forEach(d => {
      const data = d.data();
      const { userId, ...rest } = data;
      chapters.push({ id: d.id, ...rest } as Chapter);
    });
    chapters.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    return chapters;
  } catch (error) {
    if (retryCount > 0) {
      await new Promise(res => setTimeout(res, 1200));
      return getChaptersFromCloud(novelId, retryCount - 1);
    }
    console.warn("Không thể tải chương từ đám mây (đang dùng cache cục bộ):", error);
    return [];
  }
};

export const saveChapterToCloud = async (chapter: Chapter): Promise<void> => {
  const user = auth.currentUser;
  if (!user) return; // Silent return if not logged in
  const path = `chapters/${chapter.id}`;
  try {
    const rawData = {
      ...chapter,
      novelId: chapter.novelId || 'default',
      userId: user.uid,
      createdAt: Timestamp.now()
    };
    const dataToSave = sanitizeData(rawData);
    Object.keys(dataToSave).forEach(k => {
      if (dataToSave[k] === undefined) delete dataToSave[k];
    });
    await setDoc(doc(db, 'chapters', chapter.id), dataToSave, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
};

export const bulkSaveChaptersToCloud = async (chapters: Chapter[]): Promise<void> => {
  const user = auth.currentUser;
  if (!user || chapters.length === 0) return;
  
  // Batch writes in small chunks of 10 chapters because chapter texts are large
  const chunkSize = 10;
  for (let i = 0; i < chapters.length; i += chunkSize) {
    const chunk = chapters.slice(i, i + chunkSize);
    const batch = writeBatch(db);
    chunk.forEach(ch => {
      if (!ch.id) return;
      const rawData = {
        ...ch,
        userId: user.uid,
        createdAt: Timestamp.now()
      };
      const dataToSave = sanitizeData(rawData);
      Object.keys(dataToSave).forEach(k => {
        if (dataToSave[k] === undefined) delete dataToSave[k];
      });
      batch.set(doc(db, 'chapters', ch.id), dataToSave, { merge: true });
    });
    await batch.commit();
  }
};

export const deleteChapterFromCloud = async (chapterId: string): Promise<void> => {
  const user = auth.currentUser;
  if (!user) return;
  const path = `chapters/${chapterId}`;
  try {
    await deleteDoc(doc(db, 'chapters', chapterId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
};

export const clearNovelChaptersFromCloud = async (novelId: string): Promise<void> => {
  const user = auth.currentUser;
  if (!user || !novelId) return;
  const path = 'chapters';
  try {
    const q = query(collection(db, 'chapters'), where('userId', '==', user.uid), where('novelId', '==', novelId));
    const snap = await getDocs(q);
    const batch = writeBatch(db);
    snap.forEach(d => {
      batch.delete(d.ref);
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
};

export const getShortcutsFromCloud = async (novelId: string): Promise<TextShortcut[]> => {
  const user = auth.currentUser;
  if (!user || !novelId) return [];
  const path = 'shortcuts';
  try {
    const q = query(collection(db, path), where('userId', '==', user.uid), where('novelId', '==', novelId));
    const snap = await getDocs(q);
    const shortcuts: TextShortcut[] = [];
    snap.forEach(d => {
      const data = d.data();
      const { userId, createdAt, ...rest } = data;
      shortcuts.push({ id: d.id, ...rest, novelId: data.novelId || novelId } as TextShortcut);
    });
    return shortcuts;
  } catch (error) {
    console.warn("Không thể tải phím tắt từ đám mây (đang dùng cache cục bộ):", error);
    return [];
  }
};

export const saveShortcutsToCloud = async (novelId: string, shortcuts: TextShortcut[]): Promise<void> => {
  const user = auth.currentUser;
  if (!user || !novelId) return;
  await overwriteFirestoreData('shortcut', novelId, shortcuts);
};

export interface ActiveSessionCloudData {
  userId: string;
  novelId: string;
  updatedAt: number;
  deviceId: string;
  currentChapterId?: string;
  currentHistoryId?: string;
  inputText: string;
  deeplText: string;
  preEditedText: string;
  status: string;
  completedSegments: number[];
  result: TranslationResponse | null;
}

export const getActiveSessionDocId = (userId: string) => {
  // Dùng APP_SIGNATURE để Laptop và Điện thoại dùng chung 1 doc phiên làm việc bất kể truy cập từ URL nào (ais-dev, ais-pre, github.io, localhost...)
  return `session_${userId}_${APP_SIGNATURE}`;
};

export const getActiveSessionFromCloud = async (): Promise<ActiveSessionCloudData | null> => {
  const user = auth.currentUser;
  if (!user) return null;

  const docId = getActiveSessionDocId(user.uid);
  const docRef = doc(db, 'activeSessions', docId);
  try {
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    return snap.data() as ActiveSessionCloudData;
  } catch (error) {
    console.warn("Lỗi tải active session từ đám mây:", error);
    return null;
  }
};

export const saveActiveSessionToCloud = async (
  sessionData: {
    novelId?: string;
    deviceId: string;
    currentChapterId?: string;
    currentHistoryId?: string;
    inputText: string;
    deeplText: string;
    preEditedText: string;
    status: string;
    completedSegments: number[];
    result: TranslationResponse | null;
  }
): Promise<void> => {
  const user = auth.currentUser;
  if (!user) return;

  const docId = getActiveSessionDocId(user.uid);
  const docRef = doc(db, 'activeSessions', docId);

  const rawData: ActiveSessionCloudData = {
    userId: user.uid,
    novelId: sessionData.novelId || '',
    updatedAt: Date.now(),
    deviceId: sessionData.deviceId,
    currentChapterId: sessionData.currentChapterId || '',
    currentHistoryId: sessionData.currentHistoryId || '',
    inputText: sessionData.inputText || '',
    deeplText: sessionData.deeplText || '',
    preEditedText: sessionData.preEditedText || '',
    status: sessionData.status || 'idle',
    completedSegments: sessionData.completedSegments || [],
    result: sessionData.result || null
  };

  const dataToSave = sanitizeData(rawData);
  Object.keys(dataToSave).forEach(k => {
    if (dataToSave[k] === undefined) delete dataToSave[k];
  });

  try {
    await setDoc(docRef, dataToSave, { merge: true });
  } catch (error) {
    console.warn("Lỗi lưu active session lên đám mây:", error);
  }
};

export const listenToActiveSession = (
  currentDeviceId: string,
  onUpdate: (data: ActiveSessionCloudData) => void
): Unsubscribe | null => {
  const user = auth.currentUser;
  if (!user) return null;

  const docId = getActiveSessionDocId(user.uid);
  const docRef = doc(db, 'activeSessions', docId);

  return onSnapshot(docRef, (docSnap) => {
    if (!docSnap.exists()) return;
    const data = docSnap.data() as ActiveSessionCloudData;
    // Bỏ qua các cập nhật được phát ra từ chính tab/thiết bị này
    if (data.deviceId === currentDeviceId) return;
    onUpdate(data);
  }, (error) => {
    console.warn("Lỗi lắng nghe active session realtime:", error);
  });
};

export const listenToChaptersRealtime = (
  novelId: string | undefined,
  onUpdate: (chapters: Chapter[]) => void
): Unsubscribe | null => {
  const user = auth.currentUser;
  if (!user || !novelId) return null;

  const q = query(collection(db, 'chapters'), where('userId', '==', user.uid), where('novelId', '==', novelId));
  
  return onSnapshot(q, (snapshot) => {
    const chapters: Chapter[] = [];
    snapshot.forEach(d => {
      const data = d.data();
      const { userId, ...rest } = data;
      chapters.push({ id: d.id, ...rest } as Chapter);
    });
    chapters.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    onUpdate(chapters);
  }, (error) => {
    console.warn("Lỗi lắng nghe kho chương realtime:", error);
  });
};

export const getAllChaptersFromCloud = async (): Promise<Chapter[]> => {
  const user = auth.currentUser;
  if (!user) return [];
  const q = query(collection(db, 'chapters'), where('userId', '==', user.uid));
  const snap = await getDocs(q);
  const chapters: Chapter[] = [];
  snap.forEach(d => {
    const data = d.data();
    const { userId, ...rest } = data;
    chapters.push({ id: d.id, ...rest } as Chapter);
  });
  return chapters.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
};

export const listenToAllChaptersRealtime = (
  onUpdate: (chapters: Chapter[]) => void
): Unsubscribe | null => {
  const user = auth.currentUser;
  if (!user) return null;

  const q = query(collection(db, 'chapters'), where('userId', '==', user.uid));
  return onSnapshot(q, (snapshot) => {
    const chapters: Chapter[] = [];
    snapshot.forEach(d => {
      const data = d.data();
      const { userId, ...rest } = data;
      chapters.push({ id: d.id, ...rest } as Chapter);
    });
    chapters.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    onUpdate(chapters);
  }, (error) => {
    console.warn("Lỗi lắng nghe toàn bộ chương realtime:", error);
  });
};

// --- LEVEL 1 & LEVEL 2 GOOGLE DOCS COLLABORATIVE SYNC ---
export interface SegmentEditEntry {
  source?: string;
  natural?: string;
  quick?: string;
  deepl?: string;
  updatedAt: number;
  deviceId: string;
}

export interface CompletedEditEntry {
  done: boolean;
  updatedAt: number;
  deviceId: string;
}

export interface DocCollabCloudData {
  userId: string;
  docKey: string;
  novelId: string;
  updatedAt: number;
  resultUpdatedAt?: number;
  deviceId: string;
  currentChapterId?: string;
  currentHistoryId?: string;
  inputText: string;
  deeplText: string;
  preEditedText: string;
  fieldsUpdatedAt?: {
    inputText?: number;
    deeplText?: number;
    preEditedText?: number;
  };
  status: string;
  completedSegments: number[];
  result: TranslationResponse | null;
  segmentEdits?: Record<string, SegmentEditEntry>;
  completedEdits?: Record<string, CompletedEditEntry>;
}

export const getDocCollabId = (userId: string, docKey: string): string => {
  const safeKey = (docKey || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  return `doc_${userId}_${safeKey}_${APP_SIGNATURE}`;
};

export const getDocCollabSessionFromCloud = async (docKey: string): Promise<DocCollabCloudData | null> => {
  const user = auth.currentUser;
  if (!user || !docKey) return null;

  const docRef = doc(db, 'activeSessions', getDocCollabId(user.uid, docKey));
  try {
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    return snap.data() as DocCollabCloudData;
  } catch (error) {
    console.warn("Lỗi tải phiên cộng tác tài liệu từ đám mây:", error);
    return null;
  }
};

export const listenToDocCollabSession = (
  docKey: string,
  currentDeviceId: string,
  onUpdate: (data: DocCollabCloudData) => void
): Unsubscribe | null => {
  const user = auth.currentUser;
  if (!user || !docKey) return null;

  const docRef = doc(db, 'activeSessions', getDocCollabId(user.uid, docKey));
  return onSnapshot(docRef, (docSnap) => {
    if (!docSnap.exists()) return;
    const data = docSnap.data() as DocCollabCloudData;
    if (data.deviceId === currentDeviceId) return;
    onUpdate(data);
  }, (error) => {
    console.warn("Lỗi lắng nghe phiên cộng tác tài liệu realtime:", error);
  });
};

export const saveDocCollabFullSession = async (
  docKey: string,
  sessionData: {
    novelId?: string;
    deviceId: string;
    currentChapterId?: string;
    currentHistoryId?: string;
    inputText: string;
    deeplText: string;
    preEditedText: string;
    status: string;
    completedSegments: number[];
    result: TranslationResponse | null;
    resultUpdatedAt?: number;
  }
): Promise<void> => {
  const user = auth.currentUser;
  if (!user || !docKey) return;

  const docRef = doc(db, 'activeSessions', getDocCollabId(user.uid, docKey));
  const now = sessionData.resultUpdatedAt || Date.now();

  const rawData: DocCollabCloudData = {
    userId: user.uid,
    docKey,
    novelId: sessionData.novelId || '',
    updatedAt: now,
    resultUpdatedAt: now,
    deviceId: sessionData.deviceId,
    currentChapterId: sessionData.currentChapterId || '',
    currentHistoryId: sessionData.currentHistoryId || '',
    inputText: sessionData.inputText || '',
    deeplText: sessionData.deeplText || '',
    preEditedText: sessionData.preEditedText || '',
    fieldsUpdatedAt: {
      inputText: now,
      deeplText: now,
      preEditedText: now,
    },
    status: sessionData.status || 'IDLE',
    completedSegments: sessionData.completedSegments || [],
    result: sessionData.result || null,
    segmentEdits: {},
    completedEdits: {}
  };

  const dataToSave = sanitizeData(rawData);
  try {
    // Ghi đè toàn bộ tài liệu khi khởi tạo/phân tích lại/xóa đoạn để làm sạch segmentEdits cũ
    await setDoc(docRef, dataToSave);
  } catch (error) {
    console.warn("Lỗi lưu toàn bộ phiên cộng tác lên đám mây:", error);
  }
};

export const updateDocCollabFields = async (
  docKey: string,
  params: {
    novelId?: string;
    deviceId: string;
    currentChapterId?: string;
    inputText?: string;
    deeplText?: string;
    preEditedText?: string;
    status?: string;
    now?: number;
  }
): Promise<void> => {
  const user = auth.currentUser;
  if (!user || !docKey) return;

  const now = params.now || Date.now();
  const docRef = doc(db, 'activeSessions', getDocCollabId(user.uid, docKey));
  const fieldsUpdatedAt: Record<string, number> = {};
  const payload: Record<string, any> = {
    userId: user.uid,
    docKey,
    novelId: params.novelId || '',
    currentChapterId: params.currentChapterId || '',
    deviceId: params.deviceId,
    updatedAt: now
  };

  if (params.inputText !== undefined) {
    payload.inputText = params.inputText;
    fieldsUpdatedAt.inputText = now;
  }
  if (params.deeplText !== undefined) {
    payload.deeplText = params.deeplText;
    fieldsUpdatedAt.deeplText = now;
  }
  if (params.preEditedText !== undefined) {
    payload.preEditedText = params.preEditedText;
    fieldsUpdatedAt.preEditedText = now;
  }
  if (params.status !== undefined) {
    payload.status = params.status;
  }
  if (Object.keys(fieldsUpdatedAt).length > 0) {
    payload.fieldsUpdatedAt = fieldsUpdatedAt;
  }

  try {
    await setDoc(docRef, sanitizeData(payload), { merge: true });
  } catch (error) {
    console.warn("Lỗi cập nhật trường tài liệu lên đám mây:", error);
  }
};

export const updateDocCollabSegment = async (
  docKey: string,
  params: {
    novelId?: string;
    deviceId: string;
    currentChapterId?: string;
    segmentIndex: number;
    edit: { source?: string; natural?: string; quick?: string; deepl?: string };
    now?: number;
  }
): Promise<void> => {
  const user = auth.currentUser;
  if (!user || !docKey) return;

  const now = params.now || Date.now();
  const docRef = doc(db, 'activeSessions', getDocCollabId(user.uid, docKey));
  const payload = sanitizeData({
    userId: user.uid,
    docKey,
    novelId: params.novelId || '',
    currentChapterId: params.currentChapterId || '',
    deviceId: params.deviceId,
    updatedAt: now,
    segmentEdits: {
      [String(params.segmentIndex)]: {
        ...params.edit,
        updatedAt: now,
        deviceId: params.deviceId
      }
    }
  });

  try {
    await setDoc(docRef, payload, { merge: true });
  } catch (error) {
    console.warn("Lỗi đồng bộ đoạn văn lên đám mây:", error);
  }
};

export const updateDocCollabCompleted = async (
  docKey: string,
  params: {
    novelId?: string;
    deviceId: string;
    currentChapterId?: string;
    segmentIndex: number;
    done: boolean;
    now?: number;
  }
): Promise<void> => {
  const user = auth.currentUser;
  if (!user || !docKey) return;

  const now = params.now || Date.now();
  const docRef = doc(db, 'activeSessions', getDocCollabId(user.uid, docKey));
  const payload = sanitizeData({
    userId: user.uid,
    docKey,
    novelId: params.novelId || '',
    currentChapterId: params.currentChapterId || '',
    deviceId: params.deviceId,
    updatedAt: now,
    completedEdits: {
      [String(params.segmentIndex)]: {
        done: params.done,
        updatedAt: now,
        deviceId: params.deviceId
      }
    }
  });

  try {
    await setDoc(docRef, payload, { merge: true });
  } catch (error) {
    console.warn("Lỗi đồng bộ trạng thái hoàn thành đoạn lên đám mây:", error);
  }
};

export const mergeCollabIntoChapterSnapshot = (
  chapter: Chapter,
  collab: DocCollabCloudData | null
): Chapter => {
  if (!collab) return chapter;
  const chapterBaseTs = chapter.resultUpdatedAt || chapter.timestamp || 0;
  const collabResultTs = collab.resultUpdatedAt || 0;

  // Nếu collab có kết quả mới hơn hẳn (vd: phân tích lại hoặc xóa đoạn)
  let baseResult = chapter.result;
  let baseCompleted = [...(chapter.completedSegments || [])];
  let effectiveResultTs = chapterBaseTs;

  if (collab.result && collabResultTs > chapterBaseTs) {
    baseResult = collab.result;
    baseCompleted = [...(collab.completedSegments || [])];
    effectiveResultTs = collabResultTs;
  }

  const segments = baseResult?.segments ? baseResult.segments.map(s => ({ ...s })) : [];
  let resultChanged = false;
  const segEdits = collab.segmentEdits || {};
  Object.keys(segEdits).forEach(key => {
    const idx = parseInt(key, 10);
    const entry = segEdits[key];
    if (isNaN(idx) || idx < 0 || idx >= segments.length || !entry) return;
    if ((entry.updatedAt || 0) > chapterBaseTs && (entry.updatedAt || 0) >= effectiveResultTs) {
      if (entry.source !== undefined) segments[idx].source = entry.source;
      if (entry.natural !== undefined) segments[idx].natural = entry.natural;
      if (entry.quick !== undefined) segments[idx].quick = entry.quick;
      if (entry.deepl !== undefined) segments[idx].deepl = entry.deepl;
      resultChanged = true;
    }
  });

  const completedSet = new Set(baseCompleted);
  const compEdits = collab.completedEdits || {};
  Object.keys(compEdits).forEach(key => {
    const idx = parseInt(key, 10);
    const entry = compEdits[key];
    if (isNaN(idx) || !entry) return;
    if ((entry.updatedAt || 0) > chapterBaseTs && (entry.updatedAt || 0) >= effectiveResultTs) {
      if (entry.done) completedSet.add(idx);
      else completedSet.delete(idx);
    }
  });

  const mergedResult = baseResult ? {
    ...baseResult,
    segments,
    naturalTranslation: segments.map(s => s.natural || '').join('\n'),
    quickTrans: segments.map(s => s.quick || '').join('\n'),
    deeplTranslation: segments.map(s => s.deepl || '').join('\n')
  } : chapter.result;

  const fieldsTs = collab.fieldsUpdatedAt || {};
  const nextInput = (fieldsTs.inputText && fieldsTs.inputText > chapterBaseTs && collab.inputText !== undefined)
    ? collab.inputText : chapter.inputText;
  const nextDeepl = (fieldsTs.deeplText && fieldsTs.deeplText > chapterBaseTs && collab.deeplText !== undefined)
    ? collab.deeplText : chapter.deeplText;
  const nextPreEdited = (fieldsTs.preEditedText && fieldsTs.preEditedText > chapterBaseTs && collab.preEditedText !== undefined)
    ? collab.preEditedText : chapter.preEditedText;

  return {
    ...chapter,
    inputText: nextInput,
    deeplText: nextDeepl,
    preEditedText: nextPreEdited,
    result: resultChanged || collabResultTs > chapterBaseTs ? mergedResult : chapter.result,
    completedSegments: Array.from(completedSet),
    resultUpdatedAt: Math.max(chapterBaseTs, effectiveResultTs),
    timestamp: Math.max(chapter.timestamp || 0, collab.updatedAt || 0)
  };
};



