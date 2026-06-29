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
    const batch = writeBatch(db);
    
    const q = query(collRef, where('userId', '==', user.uid), where('novelId', '==', novelId));
    const querySnapshot = await getDocs(q);
    const existingIds = new Set(querySnapshot.docs.map(d => d.id));
    
    const payloadIds = new Set(payload.map(item => item.id));

    // Delete removed items
    existingIds.forEach(id => {
      if (!payloadIds.has(id)) {
        batch.delete(doc(collRef, id));
      }
    });

    // Add/Update items
    payload.forEach(item => {
      const docRef = doc(collRef, item.id);
      batch.set(docRef, {
        ...item,
        novelId,
        userId: user.uid,
        createdAt: Timestamp.now()
      }, { merge: true });
    });

    await batch.commit();
    return payload;
  }
  return [];
};
