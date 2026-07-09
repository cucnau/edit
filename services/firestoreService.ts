import { db, auth } from './firebase';
import { collection, doc, setDoc, getDocs, deleteDoc, writeBatch, query, where, Timestamp } from 'firebase/firestore';
import { CustomTerm, Character, Relationship, Novel } from '../types';

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

export const syncFirestoreData = async <T extends { id: string, novelId: string }>(
  type: 'vocab' | 'char' | 'rel',
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

  const collectionName = type === 'vocab' ? 'customTerms' : type === 'char' ? 'characters' : 'relationships';
  const collRef = collection(db, collectionName);

  if (action === 'GET') {
    const q = query(collRef, where('userId', '==', user.uid), where('novelId', '==', novelId));
    const querySnapshot = await getDocs(q);
    const result: any[] = [];
    const localMap = new Map<string, any>();
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      localMap.set(doc.id, data);
      // Remove userId and createdAt before returning to UI
      const { userId, createdAt, ...rest } = data;
      result.push({ id: doc.id, ...rest });
    });
    dbCache.set(`${collectionName}_${novelId}`, localMap);
    return result as T[];
  } else if (action === 'POST' && payload) {
    const cacheKey = `${collectionName}_${novelId}`;
    let dbDocsMap = dbCache.get(cacheKey);
    if (!dbDocsMap) {
      const q = query(collRef, where('userId', '==', user.uid), where('novelId', '==', novelId));
      const querySnapshot = await getDocs(q);
      dbDocsMap = new Map<string, any>();
      querySnapshot.forEach(doc => {
        dbDocsMap!.set(doc.id, doc.data());
      });
      dbCache.set(cacheKey, dbDocsMap);
    }
    
    const payloadIds = new Set(payload.map(item => item.id));

    // Group all operations to chunk them into batches of max 500
    const operations: { type: 'set' | 'delete', ref: any, data?: any }[] = [];

    // Delete removed items
    const toDeleteIds: string[] = [];
    dbDocsMap.forEach((data, id) => {
      if (!payloadIds.has(id)) {
        operations.push({ type: 'delete', ref: doc(collRef, id) });
        toDeleteIds.push(id);
      }
    });
    // Update cache
    toDeleteIds.forEach(id => dbDocsMap!.delete(id));

    // Generic field comparison to check if write can be skipped
    const areFieldsEqual = (localItem: any, dbItem: any) => {
      const allKeys = new Set([
        ...Object.keys(localItem),
        ...Object.keys(dbItem)
      ]);
      for (const key of allKeys) {
        if (key === 'createdAt' || key === 'userId') continue;
        const localVal = localItem[key];
        const dbVal = dbItem[key];
        if (localVal !== dbVal) {
          // If both values are falsy, treat them as equal (e.g. empty string vs undefined)
          if (!localVal && !dbVal) continue;
          return false;
        }
      }
      return true;
    };

    // Add/Update items only if they are new or modified
    payload.forEach(item => {
      const dbItem = dbDocsMap!.get(item.id);
      
      if (!dbItem || !areFieldsEqual(item, dbItem)) {
        const dataToSave = {
            ...item,
            novelId,
            userId: user.uid,
            createdAt: dbItem?.createdAt || Timestamp.now()
        };
        operations.push({
          type: 'set',
          ref: doc(collRef, item.id),
          data: dataToSave
        });
        dbDocsMap!.set(item.id, dataToSave);
      }
    });

    if (operations.length === 0) {
      console.log(`Sync skipped for ${collectionName}: No changes detected.`);
      return payload;
    }

    console.log(`Syncing ${collectionName}: Performing ${operations.length} writes (${operations.filter(op => op.type === 'set').length} updates/creates, ${operations.filter(op => op.type === 'delete').length} deletions)`);

    // Commit operations in chunks of 500 to adhere to Firestore limits
    const CHUNK_SIZE = 500;
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

    return payload;
  }
  return [];
};
