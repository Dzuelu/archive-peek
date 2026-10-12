import * as fs from 'fs';
import * as path from 'path';
import { ArchiveChangedError, ArchiveEntry, IArchiveHandler, ArchiveType } from './models';
import { BufferCache } from './bufferCache';
import {
  ZipHandler,
  TarHandler,
  TarGzHandler,
  TarBz2Handler,
  TarXzHandler,
  GzHandler,
  Bz2Handler,
  XzHandler,
  RarHandler,
  SevenZipHandler
} from './handlers';

/**
 * Represents a currently-opened archive with its resolved entries
 * organized into a tree structure.
 */
export interface OpenArchive {
  /** Absolute path to the archive on disk */
  filePath: string;
  /** The detected archive type */
  type: ArchiveType;
  /** Flat list of all entries */
  entries: ArchiveEntry[];
  /** Modification time (ms) of the archive file on disk when it was last read */
  diskMtime: number;
  /** Size (bytes) of the archive file on disk when it was last read */
  diskSize: number;
}

/**
 * Lifecycle event for an archive tracked by the ArchiveManager.
 *
 * - `opened`:  the archive was read for the first time
 * - `changed`: the archive was re-read after changing on disk (or a manual refresh)
 * - `deleted`: the archive file disappeared from disk
 * - `closed`:  the archive was explicitly closed by the user
 */
export type ArchiveChangeEvent =
  | { type: 'opened'; filePath: string; archive: OpenArchive }
  | { type: 'changed'; filePath: string; archive: OpenArchive; previousEntries: ArchiveEntry[] }
  | { type: 'deleted'; filePath: string; previousEntries: ArchiveEntry[] }
  | { type: 'closed'; filePath: string };

export type ArchiveChangeListener = (event: ArchiveChangeEvent) => void;

/**
 * Central service that manages opened archives and delegates
 * to the correct handler for each archive type.
 */
export class ArchiveManager {
  private handlers: IArchiveHandler[] = [];
  private openArchives: Map<string, OpenArchive> = new Map();
  /** LRU cache for file content buffers (default 50 MB cap). */
  private bufferCache = new BufferCache();
  private listeners = new Set<ArchiveChangeListener>();
  /** Per-archive refresh counter so a slow, superseded refresh can't overwrite a newer one. */
  private refreshGeneration = new Map<string, number>();

  constructor() {
    this.handlers.push(new ZipHandler());
    this.handlers.push(new TarHandler());
    this.handlers.push(new TarGzHandler());
    this.handlers.push(new TarBz2Handler());
    this.handlers.push(new TarXzHandler());
    this.handlers.push(new GzHandler());
    this.handlers.push(new Bz2Handler());
    this.handlers.push(new XzHandler());
    this.handlers.push(new RarHandler());
    this.handlers.push(new SevenZipHandler());
  }

  /**
   * Subscribe to archive lifecycle events. Returns a disposable-like handle.
   */
  onDidChangeArchive(listener: ArchiveChangeListener): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  private emit(event: ArchiveChangeEvent): void {
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }

  /**
   * Detect the archive type from a file path.
   */
  getArchiveType(filePath: string): ArchiveType | undefined {
    const lower = filePath.toLowerCase();
    if (
      lower.endsWith('.zip') ||
      lower.endsWith('.jar') ||
      lower.endsWith('.war') ||
      lower.endsWith('.ear') ||
      lower.endsWith('.vsix') ||
      lower.endsWith('.nupkg') ||
      lower.endsWith('.apk') ||
      lower.endsWith('.whl') ||
      lower.endsWith('.xpi') ||
      lower.endsWith('.epub') ||
      lower.endsWith('.aar')
    ) {
      return 'zip';
    }
    if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
      return 'tar.gz';
    }
    if (lower.endsWith('.tar.bz2') || lower.endsWith('.tbz2')) {
      return 'tar.bz2';
    }
    if (lower.endsWith('.tar.xz') || lower.endsWith('.txz')) {
      return 'tar.xz';
    }
    if (lower.endsWith('.tar')) {
      return 'tar';
    }
    if (lower.endsWith('.rar')) {
      return 'rar';
    }
    if (lower.endsWith('.7z')) {
      return '7z';
    }
    if (lower.endsWith('.gz')) {
      return 'gz';
    }
    if (lower.endsWith('.bz2')) {
      return 'bz2';
    }
    if (lower.endsWith('.xz')) {
      return 'xz';
    }
    return undefined;
  }

  /**
   * Check if a file path is a supported archive.
   */
  isSupported(filePath: string): boolean {
    return this.getArchiveType(filePath) !== undefined;
  }

  /**
   * Get the handler for a given file path.
   */
  private getHandler(filePath: string): IArchiveHandler {
    for (const handler of this.handlers) {
      if (handler.supports(filePath)) {
        return handler;
      }
    }
    throw new Error(`No handler found for: ${filePath}`);
  }

  /**
   * Open an archive: list its entries and cache them.
   */
  async openArchive(filePath: string): Promise<OpenArchive> {
    const absPath = path.resolve(filePath);
    const existing = this.openArchives.get(absPath);
    if (existing) {
      return existing;
    }

    const archiveType = this.getArchiveType(absPath);
    if (!archiveType) {
      throw new Error(`Unsupported archive format: ${absPath}`);
    }

    const archive = await this.loadArchive(absPath, archiveType);
    this.openArchives.set(absPath, archive);
    this.emit({ type: 'opened', filePath: absPath, archive });
    return archive;
  }

  /**
   * Read the archive's disk metadata and entry list.
   */
  private async loadArchive(absPath: string, archiveType: ArchiveType): Promise<OpenArchive> {
    const diskStat = await fs.promises.stat(absPath);
    const entries = await this.getHandler(absPath).listEntries(absPath);
    return {
      filePath: absPath,
      type: archiveType,
      entries,
      diskMtime: diskStat.mtimeMs,
      diskSize: diskStat.size
    };
  }

  /** Drop cached buffers and handler state for an archive. */
  private releaseResources(absPath: string): void {
    this.bufferCache.evictArchive(absPath);
    for (const handler of this.handlers) {
      if (handler.dispose) {
        handler.dispose(absPath);
      }
    }
  }

  /**
   * Read a single file's contents from an archive.
   * Results are cached in an LRU buffer cache to avoid re-reading.
   */
  async readEntry(archivePath: string, entryPath: string): Promise<Buffer> {
    const absPath = path.resolve(archivePath);

    // Check cache first
    const cached = this.bufferCache.get(absPath, entryPath);
    if (cached) {
      return cached;
    }

    const handler = this.getHandler(absPath);

    // Provide a callback so streaming handlers (tar) can opportunistically
    // cache small files they encounter while scanning for the target entry.
    const onExtraEntry = (extraPath: string, data: Buffer) => {
      this.bufferCache.set(absPath, extraPath, data);
    };

    let buffer: Buffer;
    try {
      buffer = await handler.readEntry(absPath, entryPath, onExtraEntry);
    } catch (error) {
      if (!(error instanceof ArchiveChangedError)) {
        throw error;
      }
      // The archive changed since it was listed (e.g. the watcher hasn't
      // caught up yet). Re-read it so listeners see the new contents, then retry once.
      if (this.openArchives.has(absPath)) {
        await this.refreshArchive(absPath);
      } else {
        this.releaseResources(absPath);
      }
      buffer = await handler.readEntry(absPath, entryPath, onExtraEntry);
    }

    // Cache the requested result
    this.bufferCache.set(absPath, entryPath, buffer);
    return buffer;
  }

  /**
   * Close an opened archive.
   */
  closeArchive(filePath: string): void {
    const absPath = path.resolve(filePath);
    this.openArchives.delete(absPath);
    this.releaseResources(absPath);
    this.emit({ type: 'closed', filePath: absPath });
  }

  /**
   * Forget an archive whose file was deleted from disk.
   */
  markDeleted(filePath: string): void {
    const absPath = path.resolve(filePath);
    const existing = this.openArchives.get(absPath);
    if (!existing) {
      return;
    }
    this.openArchives.delete(absPath);
    this.refreshGeneration.set(absPath, (this.refreshGeneration.get(absPath) ?? 0) + 1);
    this.releaseResources(absPath);
    this.emit({ type: 'deleted', filePath: absPath, previousEntries: existing.entries });
  }

  /**
   * Get all currently opened archives.
   */
  getOpenArchives(): OpenArchive[] {
    return Array.from(this.openArchives.values());
  }

  /**
   * Get a specific opened archive.
   */
  getArchive(filePath: string): OpenArchive | undefined {
    return this.openArchives.get(path.resolve(filePath));
  }

  /**
   * Refresh an already-opened archive (re-read entries).
   *
   * If the archive can't be read (e.g. it's still being written), the
   * previous entries are kept and the error is rethrown.
   */
  async refreshArchive(filePath: string): Promise<OpenArchive | undefined> {
    const absPath = path.resolve(filePath);
    const previous = this.openArchives.get(absPath);
    if (!previous) {
      return undefined;
    }

    const generation = (this.refreshGeneration.get(absPath) ?? 0) + 1;
    this.refreshGeneration.set(absPath, generation);

    // Release handler caches first so the re-read sees the new file contents
    this.releaseResources(absPath);
    const archive = await this.loadArchive(absPath, previous.type);

    if (this.refreshGeneration.get(absPath) !== generation || !this.openArchives.has(absPath)) {
      // Superseded by a newer refresh, or closed/deleted while we were reading
      return this.openArchives.get(absPath);
    }

    this.openArchives.set(absPath, archive);
    // Drop anything cached from the old file while the re-read was in flight
    this.bufferCache.evictArchive(absPath);
    this.emit({ type: 'changed', filePath: absPath, archive, previousEntries: previous.entries });
    return archive;
  }

  /**
   * Re-read an archive only if its size or mtime on disk differs from what
   * was last read. Also re-opens an archive previously marked as deleted
   * that has reappeared. Returns true if the archive was reloaded.
   */
  async refreshIfChanged(filePath: string): Promise<boolean> {
    const absPath = path.resolve(filePath);
    const diskStat = await fs.promises.stat(absPath);
    const existing = this.openArchives.get(absPath);

    if (!existing) {
      const archive = await this.openArchive(absPath);
      this.emit({ type: 'changed', filePath: absPath, archive, previousEntries: [] });
      return true;
    }

    if (existing.diskMtime === diskStat.mtimeMs && existing.diskSize === diskStat.size) {
      return false;
    }
    await this.refreshArchive(absPath);
    return true;
  }

  /**
   * Get child entries for a given directory path within an archive.
   */
  getChildren(archive: OpenArchive, parentPath: string): ArchiveEntry[] {
    const normalizedParent = parentPath === '' ? '' : parentPath.endsWith('/') ? parentPath : parentPath + '/';

    return archive.entries.filter((entry) => {
      const entryDir = entry.path.endsWith('/') ? entry.path.slice(0, -1) : entry.path;

      if (normalizedParent === '') {
        // Root level: entries with no slashes (or directory entries at root)
        const slashCount = entryDir.split('/').length;
        return slashCount === 1;
      } else {
        // Only direct children of parentPath
        if (!entry.path.startsWith(normalizedParent)) {
          return false;
        }
        const relative = entry.path.slice(normalizedParent.length).replace(/\/$/, '');
        return relative.length > 0 && !relative.includes('/');
      }
    });
  }
}
