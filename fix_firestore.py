import re

with open("services/firestoreService.ts", "r") as f:
    text = f.read()

CACHE_DECL = """
const dbCache = new Map<string, Map<string, any>>(); // Global cache to prevent repeated getDocs on POST
"""

# Insert CACHE_DECL after imports
text = re.sub(r'(import .*;\n)+', lambda m: m.group(0) + CACHE_DECL, text, count=1)

# Replace GET block
old_get = """  if (action === 'GET') {
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
  }"""

new_get = """  if (action === 'GET') {
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
  }"""

text = text.replace(old_get, new_get)

# Replace POST block
old_post = """    const q = query(collRef, where('userId', '==', user.uid), where('novelId', '==', novelId));
    const querySnapshot = await getDocs(q);
    
    const dbDocsMap = new Map<string, any>();
    querySnapshot.forEach(doc => {
      dbDocsMap.set(doc.id, doc.data());
    });"""

new_post = """    const cacheKey = `${collectionName}_${novelId}`;
    let dbDocsMap = dbCache.get(cacheKey);
    if (!dbDocsMap) {
      const q = query(collRef, where('userId', '==', user.uid), where('novelId', '==', novelId));
      const querySnapshot = await getDocs(q);
      dbDocsMap = new Map<string, any>();
      querySnapshot.forEach(doc => {
        dbDocsMap!.set(doc.id, doc.data());
      });
      dbCache.set(cacheKey, dbDocsMap);
    }"""

text = text.replace(old_post, new_post)

# Replace DELETE logic inside POST
old_delete = """    // Delete removed items
    dbDocsMap.forEach((data, id) => {
      if (!payloadIds.has(id)) {
        operations.push({ type: 'delete', ref: doc(collRef, id) });
      }
    });"""

new_delete = """    // Delete removed items
    const toDeleteIds: string[] = [];
    dbDocsMap.forEach((data, id) => {
      if (!payloadIds.has(id)) {
        operations.push({ type: 'delete', ref: doc(collRef, id) });
        toDeleteIds.push(id);
      }
    });
    // Update cache
    toDeleteIds.forEach(id => dbDocsMap!.delete(id));"""

text = text.replace(old_delete, new_delete)

# Replace ADD/UPDATE logic inside POST
old_update = """    // Add/Update items only if they are new or modified
    payload.forEach(item => {
      const dbItem = dbDocsMap.get(item.id);
      
      if (!dbItem || !areFieldsEqual(item, dbItem)) {
        operations.push({
          type: 'set',
          ref: doc(collRef, item.id),
          data: {
            ...item,
            novelId,
            userId: user.uid,
            createdAt: dbItem?.createdAt || Timestamp.now()
          }
        });
      }
    });"""

new_update = """    // Add/Update items only if they are new or modified
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
    });"""

text = text.replace(old_update, new_update)

with open("services/firestoreService.ts", "w") as f:
    f.write(text)
