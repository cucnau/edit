import { db, auth } from './firebase';
import { collection, doc, setDoc, getDocs, deleteDoc, writeBatch, query, where, Timestamp } from 'firebase/firestore';
import { CustomTerm, Character, Relationship, Novel } from '../types';

export const getNovels = async (): Promise<Novel[]> => {
  const user = auth.currentUser;
  if (!user) throw new Error('Bạn cần đăng nhập!');
  const q = query(collection(db, 'novels'), where('userId', '==', user.uid));
  const snap = await getDocs(q);
  const novels: Novel[] = [];
  snap.forEach(d => {
    novels.push({ id: d.id, name: d.data().name });
  });
  return novels;
};

export const createNovel = async (id: string, name: string): Promise<Novel> => {
  const user = auth.currentUser;
  if (!user) throw new Error('Bạn cần đăng nhập!');
  const novelRef = doc(collection(db, 'novels'), id);
  await setDoc(novelRef, { userId: user.uid, name, createdAt: Timestamp.now() });
  return { id, name };
};

export const deleteNovel = async (id: string): Promise<void> => {
  const user = auth.currentUser;
  if (!user) throw new Error('Bạn cần đăng nhập!');
  await deleteDoc(doc(db, 'novels', id));
  // In a real app we'd also delete all terms/characters associated.
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
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      // Remove userId and createdAt before returning to UI
      const { userId, createdAt, ...rest } = data;
      result.push({ id: doc.id, ...rest });
    });
    return result as T[];
  } else if (action === 'POST' && payload) {
    const q = query(collRef, where('userId', '==', user.uid), where('novelId', '==', novelId));
    const querySnapshot = await getDocs(q);
    const existingIds = new Set(querySnapshot.docs.map(d => d.id));
    
    const payloadIds = new Set(payload.map(item => item.id));

    // Group all operations to chunk them into batches of max 500
    const operations: { type: 'set' | 'delete', ref: any, data?: any }[] = [];

    // Delete removed items
    existingIds.forEach(id => {
      if (!payloadIds.has(id)) {
        operations.push({ type: 'delete', ref: doc(collRef, id) });
      }
    });

    // Add/Update items
    payload.forEach(item => {
      operations.push({
        type: 'set',
        ref: doc(collRef, item.id),
        data: {
          ...item,
          novelId,
          userId: user.uid,
          createdAt: Timestamp.now()
        }
      });
    });

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
