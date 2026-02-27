import { describe, it, expect } from 'vitest';
import { BufferCache } from '../src/bufferCache';

describe('BufferCache', () => {
  it('returns undefined on cache miss', () => {
    const cache = new BufferCache();
    expect(cache.get('/archive.zip', 'file.txt')).toBeUndefined();
  });

  it('stores and retrieves a buffer', () => {
    const cache = new BufferCache();
    const data = Buffer.from('hello');
    cache.set('/archive.zip', 'file.txt', data);
    expect(cache.get('/archive.zip', 'file.txt')).toEqual(data);
  });

  it('tracks size and count', () => {
    const cache = new BufferCache();
    cache.set('/a.zip', 'f1', Buffer.alloc(100));
    cache.set('/a.zip', 'f2', Buffer.alloc(200));
    expect(cache.count).toBe(2);
    expect(cache.size).toBe(300);
  });

  it('promotes entries to most-recently-used on get', () => {
    // Cache of 300 bytes: insert 3 x 100-byte entries, access the oldest,
    // then insert a 4th — the second entry (now LRU) should be evicted.
    const cache = new BufferCache(300);
    cache.set('/a', 'f1', Buffer.alloc(100, 1));
    cache.set('/a', 'f2', Buffer.alloc(100, 2));
    cache.set('/a', 'f3', Buffer.alloc(100, 3));

    // Access f1 to promote it
    cache.get('/a', 'f1');

    // Insert f4 — must evict f2 (now the LRU)
    cache.set('/a', 'f4', Buffer.alloc(100, 4));

    expect(cache.get('/a', 'f1')).toBeDefined();
    expect(cache.get('/a', 'f2')).toBeUndefined(); // evicted
    expect(cache.get('/a', 'f3')).toBeDefined();
    expect(cache.get('/a', 'f4')).toBeDefined();
  });

  it('evicts LRU entries when cache is full', () => {
    const cache = new BufferCache(200);
    cache.set('/a', 'f1', Buffer.alloc(100));
    cache.set('/a', 'f2', Buffer.alloc(100));
    // Cache is full at 200 bytes
    cache.set('/a', 'f3', Buffer.alloc(100));

    // f1 should have been evicted
    expect(cache.get('/a', 'f1')).toBeUndefined();
    expect(cache.get('/a', 'f2')).toBeDefined();
    expect(cache.get('/a', 'f3')).toBeDefined();
    expect(cache.size).toBe(200);
  });

  it('does not cache buffers larger than maxBytes', () => {
    const cache = new BufferCache(50);
    cache.set('/a', 'big', Buffer.alloc(100));
    expect(cache.get('/a', 'big')).toBeUndefined();
    expect(cache.size).toBe(0);
    expect(cache.count).toBe(0);
  });

  it('updates existing entry in place', () => {
    const cache = new BufferCache();
    cache.set('/a', 'f1', Buffer.alloc(100));
    cache.set('/a', 'f1', Buffer.alloc(50));
    expect(cache.count).toBe(1);
    expect(cache.size).toBe(50);
  });

  it('evicts all entries for a specific archive', () => {
    const cache = new BufferCache();
    cache.set('/a.zip', 'f1', Buffer.alloc(100));
    cache.set('/a.zip', 'f2', Buffer.alloc(100));
    cache.set('/b.zip', 'f1', Buffer.alloc(100));

    cache.evictArchive('/a.zip');

    expect(cache.get('/a.zip', 'f1')).toBeUndefined();
    expect(cache.get('/a.zip', 'f2')).toBeUndefined();
    expect(cache.get('/b.zip', 'f1')).toBeDefined();
    expect(cache.size).toBe(100);
    expect(cache.count).toBe(1);
  });

  it('clears entire cache', () => {
    const cache = new BufferCache();
    cache.set('/a', 'f1', Buffer.alloc(100));
    cache.set('/b', 'f2', Buffer.alloc(100));
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.count).toBe(0);
  });
});
