import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { ZipHandler } from '../src/handlers/zipHandler';
import { ArchiveManager } from '../src/archiveManager';
import { ArchiveChangedError } from '../src/models';
import { buildZip } from './zipBuilder';

/** Open file descriptors for this process, or undefined where we can't count them (Windows). */
function openFdCount(): number | undefined {
  for (const dir of ['/proc/self/fd', '/dev/fd']) {
    try {
      return fs.readdirSync(dir).length;
    } catch {
      // try the next location
    }
  }
  return undefined;
}

/** Write a zip with adm-zip and give it a distinct mtime so changes are detectable. */
function writeAdmZip(zipPath: string, files: Record<string, string>, mtime: Date): void {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) {
    zip.addFile(name, Buffer.from(content));
  }
  zip.writeZip(zipPath);
  fs.utimesSync(zipPath, mtime, mtime);
}

describe('ZipHandler (yauzl)', () => {
  let handler: ZipHandler;
  let tmpDir: string;
  let zipPath: string;

  beforeEach(() => {
    handler = new ZipHandler();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-peek-zip-'));
    zipPath = path.join(tmpDir, 'test.zip');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads stored and deflated entries', async () => {
    fs.writeFileSync(
      zipPath,
      buildZip([
        { name: 'stored.txt', data: 'stored content' },
        { name: 'deflated.txt', data: 'deflated '.repeat(100), deflate: true }
      ])
    );

    await handler.listEntries(zipPath);
    expect((await handler.readEntry(zipPath, 'stored.txt')).toString()).toBe('stored content');
    expect((await handler.readEntry(zipPath, 'deflated.txt')).toString()).toBe('deflated '.repeat(100));
  });

  it('reports sizes and modification time', async () => {
    fs.writeFileSync(zipPath, buildZip([{ name: 'a.txt', data: 'x'.repeat(1000), deflate: true }]));

    const [entry] = await handler.listEntries(zipPath);
    expect(entry.size).toBe(1000);
    expect(entry.compressedSize).toBeLessThan(1000);
    expect(entry.modifiedTime?.getFullYear()).toBe(2024);
  });

  it('decodes UTF-8 and CP437 file names', async () => {
    fs.writeFileSync(
      zipPath,
      buildZip([
        { name: 'héllo/wörld.txt', data: 'utf8', utf8: true },
        // 0x82 is "é" in CP437; no UTF-8 flag
        { name: Buffer.from([0x63, 0x61, 0x66, 0x82, 0x2e, 0x74, 0x78, 0x74]), data: 'cp437' }
      ])
    );

    const paths = (await handler.listEntries(zipPath)).map((e) => e.path);
    expect(paths).toContain('héllo/wörld.txt');
    expect(paths).toContain('café.txt');
    expect((await handler.readEntry(zipPath, 'café.txt')).toString()).toBe('cp437');
  });

  it('lists entries with "..", absolute or backslash names instead of rejecting the archive', async () => {
    fs.writeFileSync(
      zipPath,
      buildZip([
        { name: '../escape.txt', data: 'dotdot' },
        { name: '/absolute.txt', data: 'absolute' },
        { name: 'win\\style.txt', data: 'backslash' },
        { name: 'normal.txt', data: 'normal' }
      ])
    );

    const paths = (await handler.listEntries(zipPath)).filter((e) => !e.isDirectory).map((e) => e.path);
    expect(paths).toEqual(['../escape.txt', '/absolute.txt', 'win/style.txt', 'normal.txt']);
    expect((await handler.readEntry(zipPath, '../escape.txt')).toString()).toBe('dotdot');
    expect((await handler.readEntry(zipPath, 'win/style.txt')).toString()).toBe('backslash');
  });

  it('handles parallel reads', async () => {
    const files = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`f${i}.txt`, `content ${i}`]));
    writeAdmZip(zipPath, files, new Date(2020, 0, 1));
    await handler.listEntries(zipPath);

    const results = await Promise.all(Object.keys(files).map((name) => handler.readEntry(zipPath, name)));
    expect(results.map((b) => b.toString())).toEqual(Object.values(files));
  });

  it('rebuilds its index when reading after dispose', async () => {
    writeAdmZip(zipPath, { 'a.txt': 'a' }, new Date(2020, 0, 1));
    await handler.listEntries(zipPath);
    handler.dispose(zipPath);
    expect((await handler.readEntry(zipPath, 'a.txt')).toString()).toBe('a');
  });

  it('throws ArchiveChangedError when the archive changed since listing', async () => {
    writeAdmZip(zipPath, { 'a.txt': 'v1' }, new Date(2020, 0, 1));
    await handler.listEntries(zipPath);

    writeAdmZip(zipPath, { 'a.txt': 'v2-longer' }, new Date(2021, 0, 1));
    await expect(handler.readEntry(zipPath, 'a.txt')).rejects.toBeInstanceOf(ArchiveChangedError);
  });

  it('rejects a truncated archive without hanging', async () => {
    writeAdmZip(zipPath, { 'a.txt': 'x'.repeat(10_000) }, new Date(2020, 0, 1));
    const data = fs.readFileSync(zipPath);
    fs.writeFileSync(zipPath, data.subarray(0, data.length - 30));
    await expect(handler.listEntries(zipPath)).rejects.toThrow();
  });

  describe('file handles', () => {
    it.skipIf(openFdCount() === undefined)('leaves no file descriptors open after list, read and errors', async () => {
      writeAdmZip(zipPath, { 'a.txt': 'a', 'b.txt': 'b' }, new Date(2020, 0, 1));
      const before = openFdCount();

      await handler.listEntries(zipPath);
      await handler.readEntry(zipPath, 'a.txt');
      await Promise.all([handler.readEntry(zipPath, 'a.txt'), handler.readEntry(zipPath, 'b.txt')]);
      await expect(handler.readEntry(zipPath, 'missing.txt')).rejects.toThrow();

      fs.writeFileSync(zipPath, 'not a zip');
      await expect(handler.readEntry(zipPath, 'a.txt')).rejects.toBeInstanceOf(ArchiveChangedError);
      await expect(new ZipHandler().listEntries(zipPath)).rejects.toThrow();

      expect(openFdCount()).toBe(before);
    });

    it('does not block replacing or deleting the archive while it is in use', async () => {
      writeAdmZip(zipPath, { 'a.txt': 'a' }, new Date(2020, 0, 1));
      await handler.listEntries(zipPath);
      await handler.readEntry(zipPath, 'a.txt');

      // Atomic replace (what most build tools do), then delete
      const replacement = path.join(tmpDir, 'replacement.zip');
      writeAdmZip(replacement, { 'a.txt': 'new' }, new Date(2021, 0, 1));
      fs.renameSync(replacement, zipPath);
      fs.rmSync(zipPath);
      expect(fs.existsSync(zipPath)).toBe(false);
    });
  });
});

describe('ArchiveManager with a changed zip', () => {
  let manager: ArchiveManager;
  let tmpDir: string;
  let zipPath: string;

  beforeEach(() => {
    manager = new ArchiveManager();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-peek-zip-'));
    zipPath = path.join(tmpDir, 'test.zip');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('re-reads the archive and retries when it changed before the watcher noticed', async () => {
    writeAdmZip(zipPath, { 'a.txt': 'v1' }, new Date(2020, 0, 1));
    await manager.openArchive(zipPath);

    const events: string[] = [];
    manager.onDidChangeArchive((e) => events.push(e.type));

    writeAdmZip(zipPath, { 'a.txt': 'v2', 'b.txt': 'new' }, new Date(2021, 0, 1));
    expect((await manager.readEntry(zipPath, 'a.txt')).toString()).toBe('v2');
    expect(events).toEqual(['changed']);
    expect(manager.getArchive(zipPath)!.entries.map((e) => e.path)).toContain('b.txt');
  });

  it('keeps the previous entries and reports the error when the new archive is unreadable', async () => {
    writeAdmZip(zipPath, { 'a.txt': 'v1' }, new Date(2020, 0, 1));
    await manager.openArchive(zipPath);

    fs.writeFileSync(zipPath, 'not a zip');
    await expect(manager.readEntry(zipPath, 'a.txt')).rejects.toThrow();
    expect(manager.getArchive(zipPath)!.entries.map((e) => e.path)).toEqual(['a.txt']);
  });
});
