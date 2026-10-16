// Small key-value store in the browser's IndexedDB. Used to keep Map Studio
// work across page reloads; generated photos are too large for localStorage.

const DATABASE = "mappy-moments";
const STORE = "state";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadState<T>(key: string): Promise<T | null> {
  try {
    const database = await open();
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE).objectStore(STORE).get(key);
      request.onsuccess = () => resolve((request.result as T) ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    // Private browsing or blocked storage: carry on without saved state.
    return null;
  }
}

export async function saveState(key: string, value: unknown): Promise<void> {
  try {
    const database = await open();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch {
    // Nothing to do: the page still works, it just will not survive a reload.
  }
}
