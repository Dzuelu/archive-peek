import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { ArchiveChangeEvent, ArchiveManager } from '../src/archiveManager';

/** Write a zip containing the given files, bumping its mtime so the change is detectable. */
function writeZip(zipPath: string, files: Record<string, string>, mtime: Date): void {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) {
    zip.addFile(name, Buffer.from(content));
  }
  zip.writeZip(zipPath);
  fs.utimesSync(zipPath, mtime, mtime);
}

describe('ArchiveManager change detection', () => {
  let manager: ArchiveManager;
  let tmpDir: string;
  let zipPath: string;
  let events: ArchiveChangeEvent[];

  beforeEach(() => {
    manager = new ArchiveManager();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-peek-'));
    zipPath = path.join(tmpDir, 'bundle.zip');
    writeZip(zipPath, { 'hello.txt': 'v1' }, new Date(2020, 0, 1));
    events = [];
    manager.onDidChangeArchive((e) => events.push(e));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('records disk mtime and size when opening', async () => {
    const archive = await manager.openArchive(zipPath);
    const stat = fs.statSync(zipPath);
    expect(archive.diskMtime).toBe(stat.mtimeMs);
    expect(archive.diskSize).toBe(stat.size);
    expect(events.map((e) => e.type)).toEqual(['opened']);
  });

  it('does not reload when the archive is unchanged', async () => {
    await manager.openArchive(zipPath);
    expect(await manager.refreshIfChanged(zipPath)).toBe(false);
    expect(events.map((e) => e.type)).toEqual(['opened']);
  });

  it('reloads entries and evicts cached buffers when the archive changes', async () => {
    await manager.openArchive(zipPath);
    expect((await manager.readEntry(zipPath, 'hello.txt')).toString()).toBe('v1');

    writeZip(zipPath, { 'hello.txt': 'v2', 'added.txt': 'new' }, new Date(2021, 0, 1));

    expect(await manager.refreshIfChanged(zipPath)).toBe(true);
    expect((await manager.readEntry(zipPath, 'hello.txt')).toString()).toBe('v2');
    expect(
      manager
        .getArchive(zipPath)!
        .entries.map((e) => e.path)
        .sort()
    ).toEqual(['added.txt', 'hello.txt']);

    const changed = events.find((e) => e.type === 'changed');
    expect(changed).toBeDefined();
    if (changed?.type === 'changed') {
      expect(changed.previousEntries.map((e) => e.path)).toEqual(['hello.txt']);
    }
  });

  it('keeps the previous entries when the new archive cannot be read', async () => {
    await manager.openArchive(zipPath);
    fs.writeFileSync(zipPath, 'not a zip');

    await expect(manager.refreshIfChanged(zipPath)).rejects.toThrow();
    expect(manager.getArchive(zipPath)!.entries.map((e) => e.path)).toEqual(['hello.txt']);
    expect(events.some((e) => e.type === 'changed')).toBe(false);
  });

  it('emits deleted and forgets the archive when marked deleted', async () => {
    await manager.openArchive(zipPath);
    fs.rmSync(zipPath);
    manager.markDeleted(zipPath);

    expect(manager.getArchive(zipPath)).toBeUndefined();
    const deleted = events.find((e) => e.type === 'deleted');
    expect(deleted).toBeDefined();
    if (deleted?.type === 'deleted') {
      expect(deleted.previousEntries.map((e) => e.path)).toEqual(['hello.txt']);
    }
  });

  it('re-opens an archive that reappears after being deleted', async () => {
    await manager.openArchive(zipPath);
    fs.rmSync(zipPath);
    manager.markDeleted(zipPath);

    writeZip(zipPath, { 'hello.txt': 'v3' }, new Date(2022, 0, 1));
    expect(await manager.refreshIfChanged(zipPath)).toBe(true);
    expect((await manager.readEntry(zipPath, 'hello.txt')).toString()).toBe('v3');
    expect(events.map((e) => e.type)).toEqual(['opened', 'deleted', 'opened', 'changed']);
  });

  it('emits closed when an archive is closed', async () => {
    await manager.openArchive(zipPath);
    manager.closeArchive(zipPath);
    expect(events.map((e) => e.type)).toEqual(['opened', 'closed']);
  });

  it('ignores a refresh that finishes after the archive was deleted', async () => {
    await manager.openArchive(zipPath);
    writeZip(zipPath, { 'hello.txt': 'v2' }, new Date(2021, 0, 1));

    const refresh = manager.refreshArchive(zipPath);
    manager.markDeleted(zipPath);
    await refresh;

    expect(manager.getArchive(zipPath)).toBeUndefined();
    expect(events.some((e) => e.type === 'changed')).toBe(false);
  });
});
