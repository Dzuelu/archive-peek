/**
 * Common types and interfaces for the Archive Peek extension.
 */

/** Represents a single entry (file or directory) inside an archive */
export interface ArchiveEntry {
  /** Full path within the archive (e.g. "src/index.ts") */
  path: string;
  /** Just the file/folder name */
  name: string;
  /** Whether this entry is a directory */
  isDirectory: boolean;
  /** Uncompressed size in bytes */
  size: number;
  /** Compressed size in bytes (if available) */
  compressedSize?: number;
  /** Last modification time */
  modifiedTime?: Date;
}

/** Supported archive types */
export type ArchiveType = 'zip' | '7z' | 'rar' | 'tar' | 'tar.gz' | 'tar.bz2' | 'tar.xz';

/** Callback to opportunistically cache files encountered while streaming */
export type StreamCacheCallback = (entryPath: string, data: Buffer) => void;

/** Interface that all archive handlers must implement */
export interface IArchiveHandler {
  /** List all entries in the archive */
  listEntries(archivePath: string): Promise<ArchiveEntry[]>;
  /** Read the contents of a specific file entry */
  readEntry(archivePath: string, entryPath: string, onExtraEntry?: StreamCacheCallback): Promise<Buffer>;
  /** Check whether this handler supports the given file */
  supports(filePath: string): boolean;
  /** Optional: release any cached resources for a specific archive */
  dispose?(archivePath: string): void;
}
