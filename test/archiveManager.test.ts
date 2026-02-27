import { describe, it, expect, beforeEach } from 'vitest';
import { ArchiveManager } from '../src/archiveManager';
import { fixture, HELLO_CONTENT } from './helpers';

describe('ArchiveManager', () => {
  let manager: ArchiveManager;

  beforeEach(() => {
    manager = new ArchiveManager();
  });

  describe('getArchiveType()', () => {
    it.each([
      ['test.zip', 'zip'],
      ['test.jar', 'zip'],
      ['test.war', 'zip'],
      ['test.ear', 'zip'],
      ['test.vsix', 'zip'],
      ['test.nupkg', 'zip'],
      ['test.apk', 'zip'],
      ['test.tar', 'tar'],
      ['test.tar.gz', 'tar.gz'],
      ['test.tgz', 'tar.gz'],
      ['test.tar.bz2', 'tar.bz2'],
      ['test.tbz2', 'tar.bz2'],
      ['test.tar.xz', 'tar.xz'],
      ['test.txz', 'tar.xz'],
      ['test.rar', 'rar'],
      ['test.7z', '7z']
    ])('detects %s as %s', (file, expected) => {
      expect(manager.getArchiveType(file)).toBe(expected);
    });

    it('returns undefined for unsupported extensions', () => {
      expect(manager.getArchiveType('file.txt')).toBeUndefined();
      expect(manager.getArchiveType('file.png')).toBeUndefined();
    });
  });

  describe('isSupported()', () => {
    it('returns true for supported archives', () => {
      expect(manager.isSupported('test.zip')).toBe(true);
      expect(manager.isSupported('test.tar.gz')).toBe(true);
    });

    it('returns false for unsupported files', () => {
      expect(manager.isSupported('readme.md')).toBe(false);
    });
  });

  describe('openArchive()', () => {
    it('opens a zip archive', async () => {
      const archive = await manager.openArchive(fixture('sample.zip'));
      expect(archive.type).toBe('zip');
      expect(archive.entries.length).toBeGreaterThan(0);
    });

    it('opens a tar.gz archive', async () => {
      const archive = await manager.openArchive(fixture('sample.tar.gz'));
      expect(archive.type).toBe('tar.gz');
      expect(archive.entries.length).toBeGreaterThan(0);
    });

    it('caches opened archives', async () => {
      const first = await manager.openArchive(fixture('sample.zip'));
      const second = await manager.openArchive(fixture('sample.zip'));
      expect(first).toBe(second);
    });

    it('rejects unsupported files', async () => {
      await expect(manager.openArchive('/tmp/file.txt')).rejects.toThrow('Unsupported');
    });
  });

  describe('readEntry()', () => {
    it('reads file contents from zip', async () => {
      await manager.openArchive(fixture('sample.zip'));
      const buf = await manager.readEntry(fixture('sample.zip'), 'hello.txt');
      expect(buf.toString('utf-8')).toBe(HELLO_CONTENT);
    });

    it('caches read results', async () => {
      await manager.openArchive(fixture('sample.zip'));
      const buf1 = await manager.readEntry(fixture('sample.zip'), 'hello.txt');
      const buf2 = await manager.readEntry(fixture('sample.zip'), 'hello.txt');
      // Same buffer instance from cache
      expect(buf1).toBe(buf2);
    });
  });

  describe('closeArchive()', () => {
    it('removes archive from open list', async () => {
      const archivePath = fixture('sample.zip');
      await manager.openArchive(archivePath);
      expect(manager.getArchive(archivePath)).toBeDefined();

      manager.closeArchive(archivePath);
      expect(manager.getArchive(archivePath)).toBeUndefined();
    });
  });

  describe('refreshArchive()', () => {
    it('re-reads archive entries', async () => {
      const archivePath = fixture('sample.zip');
      const first = await manager.openArchive(archivePath);
      const refreshed = await manager.refreshArchive(archivePath);
      expect(refreshed).toBeDefined();
      expect(refreshed!.entries.length).toBe(first.entries.length);
      // Should be a new object (not cached)
      expect(refreshed).not.toBe(first);
    });

    it('returns undefined for non-open archives', async () => {
      const result = await manager.refreshArchive(fixture('sample.zip'));
      expect(result).toBeUndefined();
    });
  });

  describe('getChildren()', () => {
    it('returns root-level children', async () => {
      const archive = await manager.openArchive(fixture('sample.zip'));
      const children = manager.getChildren(archive, '');
      const names = children.map((c) => c.name);
      expect(names).toContain('hello.txt');
      expect(names).toContain('package.json');
      expect(names).toContain('src');
    });

    it('returns children of a subdirectory', async () => {
      const archive = await manager.openArchive(fixture('sample.zip'));
      const children = manager.getChildren(archive, 'src/');
      const names = children.map((c) => c.name);
      expect(names).toContain('index.ts');
    });

    it('returns empty for non-existent directory', async () => {
      const archive = await manager.openArchive(fixture('sample.zip'));
      const children = manager.getChildren(archive, 'nonexistent/');
      expect(children).toHaveLength(0);
    });
  });

  describe('getOpenArchives()', () => {
    it('returns all open archives', async () => {
      await manager.openArchive(fixture('sample.zip'));
      await manager.openArchive(fixture('sample.tar.gz'));
      const open = manager.getOpenArchives();
      expect(open.length).toBe(2);
    });
  });
});
