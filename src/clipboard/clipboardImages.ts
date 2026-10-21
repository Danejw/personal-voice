/** Image bytes for clipboard history. Metadata stays in the JSON cache. */
export interface ClipboardImageStore {
  put(id: string, bytes: Uint8Array): Promise<void>;
  get(id: string): Promise<Uint8Array | null>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

/** In-memory images for tests and for a browser without IndexedDB. */
export function memoryClipboardImages(): ClipboardImageStore {
  const images = new Map<string, Uint8Array>();
  return {
    async put(id, bytes) { images.set(id, bytes.slice()); },
    async get(id) {
      const found = images.get(id);
      return found ? found.slice() : null;
    },
    async delete(id) { images.delete(id); },
    async clear() { images.clear(); },
  };
}

const DB_NAME = "personal-voice-clipboard";
const STORE = "images";

function openImages(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Clipboard image storage is unavailable."));
  });
}

/** IndexedDB so image history survives restart without putting bytes in localStorage. */
export function indexedDbClipboardImages(): ClipboardImageStore {
  return {
    async put(id, bytes) {
      const db = await openImages();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(bytes.slice(), id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("Couldn't save the clipboard image."));
      });
      db.close();
    },
    async get(id) {
      const db = await openImages();
      const bytes = await new Promise<Uint8Array | null>((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const request = tx.objectStore(STORE).get(id);
        request.onsuccess = () => {
          const result = request.result;
          resolve(result instanceof Uint8Array ? result : null);
        };
        request.onerror = () => reject(request.error ?? new Error("Couldn't read the clipboard image."));
      });
      db.close();
      return bytes;
    },
    async delete(id) {
      const db = await openImages();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("Couldn't delete the clipboard image."));
      });
      db.close();
    },
    async clear() {
      const db = await openImages();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("Couldn't clear clipboard images."));
      });
      db.close();
    },
  };
}
