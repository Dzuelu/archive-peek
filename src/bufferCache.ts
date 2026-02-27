/**
 * A size-limited LRU cache for file content buffers.
 *
 * Keyed by `archivePath::entryPath`. When the total cached size exceeds
 * the configured limit, the least-recently-used entries are evicted.
 */
export class BufferCache {
  /** Insertion-order map; most-recently-used entries are moved to the end. */
  private cache = new Map<string, Buffer>();
  /** Running total of cached bytes. */
  private totalBytes = 0;

  /**
   * @param maxBytes Maximum total size of cached buffers (default 50 MB).
   */
  constructor(private readonly maxBytes: number = 50 * 1024 * 1024) {}

  private static key(archivePath: string, entryPath: string): string {
    return `${archivePath}::${entryPath}`;
  }

  /**
   * Retrieve a cached buffer, or `undefined` on a miss.
   * A hit promotes the entry to most-recently-used.
   */
  get(archivePath: string, entryPath: string): Buffer | undefined {
    const k = BufferCache.key(archivePath, entryPath);
    const buf = this.cache.get(k);
    if (buf !== undefined) {
      // Promote to most-recently-used by re-inserting
      this.cache.delete(k);
      this.cache.set(k, buf);
    }
    return buf;
  }

  /**
   * Store a buffer in the cache, evicting LRU entries if necessary.
   * Buffers larger than `maxBytes` are not cached at all.
   */
  set(archivePath: string, entryPath: string, data: Buffer): void {
    if (data.length > this.maxBytes) {
      return; // Don't cache buffers larger than the entire cache limit
    }

    const k = BufferCache.key(archivePath, entryPath);

    // If already cached, remove old size
    const existing = this.cache.get(k);
    if (existing !== undefined) {
      this.totalBytes -= existing.length;
      this.cache.delete(k);
    }

    // Evict LRU entries until there's room
    while (this.totalBytes + data.length > this.maxBytes && this.cache.size > 0) {
      const oldest = this.cache.keys().next().value!;
      const oldBuf = this.cache.get(oldest)!;
      this.totalBytes -= oldBuf.length;
      this.cache.delete(oldest);
    }

    this.cache.set(k, data);
    this.totalBytes += data.length;
  }

  /**
   * Evict all cached entries belonging to a specific archive.
   */
  evictArchive(archivePath: string): void {
    const prefix = `${archivePath}::`;
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(prefix)) {
        const buf = this.cache.get(key)!;
        this.totalBytes -= buf.length;
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear the entire cache.
   */
  clear(): void {
    this.cache.clear();
    this.totalBytes = 0;
  }

  /** Current total cached size in bytes. */
  get size(): number {
    return this.totalBytes;
  }

  /** Number of cached entries. */
  get count(): number {
    return this.cache.size;
  }
}
