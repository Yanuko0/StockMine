"use client";
// 很小的 IndexedDB 包裝：把日K 存在這台裝置，重新整理、關掉再開都不用重抓
// 不支援（無痕模式等）時一律回傳 null，呼叫的地方照常上網抓

const DB = "stockmine";
const STORE = "kv";
let dbp: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  dbp ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbp;
}

export async function idbGet<T>(key: string): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const r = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      r.onsuccess = () => resolve((r.result as T | undefined) ?? null);
      r.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await open();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch { resolve(); }
  });
}
