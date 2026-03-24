import * as path from 'path';
import { ArchiveEntry, IArchiveHandler, ArchiveType } from './models';
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
}

/**
 * Central service that manages opened archives and delegates
 * to the correct handler for each archive type.
 */
export class ArchiveManager {
  private handlers: IArchiveHandler[] = [];
  private openArchives: Map<string, OpenArchive> = new Map();
  /** LRU cache for file content buffers (default 50 MB cap). */
  private bufferCache = new BufferCache();

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

    const handler = this.getHandler(absPath);
    const entries = await handler.listEntries(absPath);

    const archive: OpenArchive = {
      filePath: absPath,
      type: archiveType,
      entries
    };

    this.openArchives.set(absPath, archive);
    return archive;
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

    const buffer = await handler.readEntry(absPath, entryPath, onExtraEntry);

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
    this.bufferCache.evictArchive(absPath);
    // Notify handlers so they can release cached resources
    for (const handler of this.handlers) {
      if (handler.dispose) {
        handler.dispose(absPath);
      }
    }
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
   */
  async refreshArchive(filePath: string): Promise<OpenArchive | undefined> {
    const absPath = path.resolve(filePath);
    if (!this.openArchives.has(absPath)) {
      return undefined;
    }
    this.openArchives.delete(absPath);
    this.bufferCache.evictArchive(absPath);
    for (const handler of this.handlers) {
      if (handler.dispose) {
        handler.dispose(absPath);
      }
    }
    return this.openArchive(absPath);
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
