import * as fs from 'fs';
import { Readable } from 'stream';
import * as yauzl from 'yauzl';
import { ArchiveChangedError, ArchiveEntry, IArchiveHandler } from '../models';

/** Size of the read-ahead window used while scanning the central directory. */
const READ_WINDOW = 64 * 1024;
/** Chunk size when streaming entry data. */
const STREAM_CHUNK = 64 * 1024;

/** Where an entry's data lives inside the zip — everything yauzl needs to read it later. */
interface ZipEntryLocation {
  relativeOffsetOfLocalHeader: number;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  generalPurposeBitFlag: number;
}

/** The parsed central directory, plus the disk state it was read from. */
interface ZipIndex {
  size: number;
  mtimeMs: number;
  locations: Map<string, ZipEntryLocation>;
}

/**
 * Handles reading .zip archive files using yauzl.
 *
 * The file is never held open between operations: listing opens the file,
 * reads the central directory and closes it again; each entry read opens the
 * file, streams just that entry's bytes and closes it. Only the parsed index
 * (entry offsets and sizes) is kept in memory, so other processes are free to
 * rewrite, rename or delete the archive at any time.
 *
 * Every read checks the archive's size and mtime against the index first and
 * throws ArchiveChangedError on a mismatch, so stale offsets are never used.
 */
export class ZipHandler implements IArchiveHandler {
  private static readonly ZIP_EXTENSIONS = [
    '.zip',
    '.jar',
    '.war',
    '.ear',
    '.vsix',
    '.nupkg',
    '.apk',
    '.whl',
    '.xpi',
    '.epub',
    '.aar'
  ];

  /** Parsed indexes keyed by absolute archive path. */
  private indexes = new Map<string, ZipIndex>();

  supports(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return ZipHandler.ZIP_EXTENSIONS.some((ext) => lower.endsWith(ext));
  }

  async listEntries(archivePath: string): Promise<ArchiveEntry[]> {
    const { entries } = await this.buildIndex(archivePath);
    return entries;
  }

  async readEntry(archivePath: string, entryPath: string): Promise<Buffer> {
    const index = this.indexes.get(archivePath) ?? (await this.buildIndex(archivePath)).index;

    return withOpenFile(archivePath, async (reader, stat) => {
      if (stat.size !== index.size || stat.mtimeMs !== index.mtimeMs) {
        throw new ArchiveChangedError(archivePath);
      }

      const location = index.locations.get(entryPath);
      if (!location) {
        throw new Error(`Entry not found in archive: ${entryPath}`);
      }

      // The central directory was already parsed, so skip yauzl's open
      // (which re-reads the end of the file) and construct the ZipFile directly.
      reader.ref(); // released by zipfile.close()
      const zipfile = new yauzl.ZipFile(reader, 0, stat.size, 0, '', false, true, false, true);
      try {
        const entry = Object.assign(new yauzl.Entry(), location);
        return await readStream(await zipfile.openReadStreamPromise(entry));
      } finally {
        zipfile.close();
      }
    });
  }

  dispose(archivePath: string): void {
    this.indexes.delete(archivePath);
  }

  /**
   * Read the central directory: build the entry list for the UI and the
   * location index used by readEntry.
   */
  private async buildIndex(archivePath: string): Promise<{ entries: ArchiveEntry[]; index: ZipIndex }> {
    const result = await withOpenFile(archivePath, async (reader, stat) => {
      // decodeStrings: false skips yauzl's file name validation, which rejects
      // the whole archive if any name is absolute or contains "..". We never
      // extract to disk, so those names are listed as-is.
      const zipfile = await yauzl.fromRandomAccessReaderPromise(reader, stat.size, {
        autoClose: false,
        lazyEntries: true,
        decodeStrings: false
      });

      const entries: ArchiveEntry[] = [];
      const locations = new Map<string, ZipEntryLocation>();
      const seenDirs = new Set<string>();

      try {
        for await (const entry of zipfile.eachEntry()) {
          const entryName = yauzl.getFileNameLowLevel(
            entry.generalPurposeBitFlag,
            entry.fileNameRaw,
            entry.extraFields,
            false
          );

          // Collect implicit parent directories
          const parts = entryName.split('/');
          let dirPath = '';
          for (let i = 0; i < parts.length - 1; i++) {
            dirPath += parts[i] + '/';
            if (!seenDirs.has(dirPath)) {
              seenDirs.add(dirPath);
              entries.push({
                path: dirPath,
                name: parts[i],
                isDirectory: true,
                size: 0
              });
            }
          }

          if (!entryName.endsWith('/')) {
            entries.push({
              path: entryName,
              name: parts[parts.length - 1],
              isDirectory: false,
              size: entry.uncompressedSize,
              compressedSize: entry.compressedSize,
              modifiedTime: entry.getLastModDate()
            });
            locations.set(entryName, {
              relativeOffsetOfLocalHeader: entry.relativeOffsetOfLocalHeader,
              compressedSize: entry.compressedSize,
              uncompressedSize: entry.uncompressedSize,
              compressionMethod: entry.compressionMethod,
              generalPurposeBitFlag: entry.generalPurposeBitFlag
            });
          }
        }
      } finally {
        zipfile.close();
      }

      return { entries, index: { size: stat.size, mtimeMs: stat.mtimeMs, locations } };
    });

    this.indexes.set(archivePath, result.index);
    return result;
  }
}

/**
 * Open the archive, run `fn` with a reader over it, and close the file when
 * `fn` settles. `fn` must finish (or destroy) every stream it opens.
 */
async function withOpenFile<T>(archivePath: string, fn: (reader: FdReader, stat: fs.Stats) => Promise<T>): Promise<T> {
  const handle = await fs.promises.open(archivePath, 'r');
  const reader = new FdReader(handle.fd);
  try {
    return await fn(reader, await handle.stat());
  } finally {
    // Never close while a read is in flight: the descriptor number could be
    // reused by another open and the pending read would hit the wrong file.
    await reader.whenIdle();
    await handle.close();
  }
}

/**
 * A yauzl RandomAccessReader over a file descriptor owned by withOpenFile.
 * Small sequential reads (the central directory and local headers) are
 * served from a read-ahead window to avoid one syscall per field.
 */
class FdReader extends yauzl.RandomAccessReader {
  // Reference counting exists at runtime but isn't in the typings
  declare ref: () => void;
  declare unref: () => void;

  private window?: { start: number; data: Buffer };
  private pendingReads = 0;
  private idleWaiters: (() => void)[] = [];

  constructor(private readonly fd: number) {
    super();
  }

  /** fs.read wrapper that tracks in-flight reads for whenIdle(). */
  private readAt(
    buffer: Buffer,
    length: number,
    position: number,
    callback: (err: Error | null, bytesRead: number) => void
  ): void {
    this.pendingReads++;
    fs.read(this.fd, buffer, 0, length, position, (err, bytesRead) => {
      this.pendingReads--;
      if (this.pendingReads === 0) {
        this.idleWaiters.splice(0).forEach((resolve) => resolve());
      }
      callback(err, bytesRead);
    });
  }

  /** Resolves once no reads are in flight. */
  whenIdle(): Promise<void> {
    return this.pendingReads === 0 ? Promise.resolve() : new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  _readStreamForRange(start: number, end: number): Readable {
    // A positional reader rather than fs.createReadStream: destroying an fs
    // ReadStream closes its descriptor, which withOpenFile owns.
    let position = start;
    const readAt = this.readAt.bind(this);
    return new Readable({
      highWaterMark: STREAM_CHUNK,
      read(size) {
        const length = Math.min(size, end - position);
        if (length <= 0) {
          this.push(null);
          return;
        }
        const chunk = Buffer.allocUnsafe(length);
        readAt(chunk, length, position, (err, bytesRead) => {
          if (err) {
            this.destroy(err);
            return;
          }
          if (bytesRead === 0) {
            this.push(null); // Truncated file; yauzl reports the short read
            return;
          }
          position += bytesRead;
          this.push(chunk.subarray(0, bytesRead));
        });
      }
    });
  }

  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
    callback: (err: Error | null, bytesRead?: number) => void
  ): void {
    const w = this.window;
    if (w && position >= w.start && position + length <= w.start + w.data.length) {
      w.data.copy(buffer, offset, position - w.start, position - w.start + length);
      process.nextTick(() => callback(null, length));
      return;
    }

    const chunk = Buffer.allocUnsafe(Math.max(length, READ_WINDOW));
    this.readAt(chunk, chunk.length, position, (err, bytesRead) => {
      if (err) {
        callback(err);
        return;
      }
      this.window = { start: position, data: chunk.subarray(0, bytesRead) };
      const n = Math.min(length, bytesRead);
      chunk.copy(buffer, offset, 0, n);
      callback(null, n);
    });
  }

  close(callback: (err: Error | null) => void): void {
    // The descriptor is closed by withOpenFile
    this.window = undefined;
    setImmediate(() => callback(null));
  }
}

/** Collect a readable stream into a single Buffer. */
async function readStream(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
  } finally {
    stream.destroy();
  }
  return Buffer.concat(chunks);
}
