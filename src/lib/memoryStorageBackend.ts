import type { StorageBackend, StorageTransaction, StoreConfig } from "@mariozechner/pi-web-ui";

function clone<T>(value: T): T {
  return value === null || value === undefined ? value : structuredClone(value);
}

export class MemoryStorageBackend implements StorageBackend {
  private stores = new Map<string, Map<string, unknown>>();

  constructor(configs: StoreConfig[]) {
    for (const cfg of configs) {
      this.stores.set(cfg.name, new Map<string, unknown>());
    }
  }

  private getStore(storeName: string): Map<string, unknown> {
    let store = this.stores.get(storeName);
    if (!store) {
      store = new Map<string, unknown>();
      this.stores.set(storeName, store);
    }
    return store;
  }

  async get<T = unknown>(storeName: string, key: string): Promise<T | null> {
    const value = this.getStore(storeName).get(key);
    return value === undefined ? null : (clone(value as T) as T);
  }

  async set<T = unknown>(storeName: string, key: string, value: T): Promise<void> {
    this.getStore(storeName).set(key, clone(value));
  }

  async delete(storeName: string, key: string): Promise<void> {
    this.getStore(storeName).delete(key);
  }

  async keys(storeName: string, prefix?: string): Promise<string[]> {
    const all = Array.from(this.getStore(storeName).keys());
    if (!prefix) return all;
    return all.filter((k) => k.startsWith(prefix));
  }

  async getAllFromIndex<T = unknown>(
    storeName: string,
    indexName: string,
    direction: "asc" | "desc" = "asc"
  ): Promise<T[]> {
    const rows = Array.from(this.getStore(storeName).values()).map((v) => clone(v as T));
    rows.sort((a, b) => {
      const av = (a as Record<string, unknown>)?.[indexName];
      const bv = (b as Record<string, unknown>)?.[indexName];
      const as = String(av ?? "");
      const bs = String(bv ?? "");
      return direction === "asc" ? as.localeCompare(bs) : bs.localeCompare(as);
    });
    return rows;
  }

  async clear(storeName: string): Promise<void> {
    this.getStore(storeName).clear();
  }

  async has(storeName: string, key: string): Promise<boolean> {
    return this.getStore(storeName).has(key);
  }

  async transaction<T>(
    _storeNames: string[],
    _mode: "readonly" | "readwrite",
    operation: (tx: StorageTransaction) => Promise<T>
  ): Promise<T> {
    const tx: StorageTransaction = {
      get: (storeName, key) => this.get(storeName, key),
      set: (storeName, key, value) => this.set(storeName, key, value),
      delete: (storeName, key) => this.delete(storeName, key)
    };
    return operation(tx);
  }

  async getQuotaInfo(): Promise<{ usage: number; quota: number; percent: number }> {
    return { usage: 0, quota: 0, percent: 0 };
  }

  async requestPersistence(): Promise<boolean> {
    return true;
  }
}
