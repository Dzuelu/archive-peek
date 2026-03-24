import { ArchiveEntry, IArchiveHandler } from '../models';
import AdmZip = require('adm-zip');

/**
 * Handles reading .zip archive files using adm-zip.
 * Reads entries and file contents directly from the archive without extracting to disk.
 *
 * Caches the AdmZip instance per archive path so the archive is only read
 * from disk once. The cache is cleared when the archive is closed.
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

  /** Cached AdmZip instances keyed by absolute archive path. */
  private zipCache = new Map<string, InstanceType<typeof AdmZip>>();

  supports(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return ZipHandler.ZIP_EXTENSIONS.some((ext) => lower.endsWith(ext));
  }

  private getZip(archivePath: string): InstanceType<typeof AdmZip> {
    let zip = this.zipCache.get(archivePath);
    if (!zip) {
      zip = new AdmZip(archivePath);
      this.zipCache.set(archivePath, zip);
    }
    return zip;
  }

  async listEntries(archivePath: string): Promise<ArchiveEntry[]> {
    const zip = this.getZip(archivePath);
    const zipEntries = zip.getEntries();

    const entries: ArchiveEntry[] = [];
    const seenDirs = new Set<string>();

    for (const entry of zipEntries) {
      // Collect implicit parent directories
      const parts = entry.entryName.split('/');
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

      if (!entry.isDirectory) {
        entries.push({
          path: entry.entryName,
          name: entry.name,
          isDirectory: false,
          size: entry.header.size,
          compressedSize: entry.header.compressedSize,
          modifiedTime: entry.header.time
        });
      }
    }

    return entries;
  }

  async readEntry(archivePath: string, entryPath: string): Promise<Buffer> {
    const zip = this.getZip(archivePath);
    const buffer = zip.readFile(entryPath);
    if (!buffer) {
      throw new Error(`Entry not found in archive: ${entryPath}`);
    }
    return buffer;
  }

  dispose(archivePath: string): void {
    this.zipCache.delete(archivePath);
  }
}
