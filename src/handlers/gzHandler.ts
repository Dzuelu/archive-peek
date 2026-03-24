import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { ArchiveEntry, IArchiveHandler } from '../models';

/**
 * Handles reading plain .gz (gzip) compressed files.
 * A .gz file contains a single compressed file — this handler exposes it
 * as a one-entry archive whose name is the original filename (sans .gz).
 */
export class GzHandler implements IArchiveHandler {
  supports(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return lower.endsWith('.gz') && !lower.endsWith('.tar.gz');
  }

  /**
   * Derive the inner filename by stripping the .gz extension.
   */
  private getInnerName(archivePath: string): string {
    const base = path.basename(archivePath);
    return base.replace(/\.gz$/i, '') || base;
  }

  async listEntries(archivePath: string): Promise<ArchiveEntry[]> {
    const stat = fs.statSync(archivePath);
    const data = await this.decompress(archivePath);
    const innerName = this.getInnerName(archivePath);

    return [
      {
        path: innerName,
        name: innerName,
        isDirectory: false,
        size: data.length,
        compressedSize: stat.size,
        modifiedTime: stat.mtime
      }
    ];
  }

  async readEntry(archivePath: string, entryPath: string): Promise<Buffer> {
    const innerName = this.getInnerName(archivePath);
    if (entryPath !== innerName) {
      throw new Error(`Entry not found: ${entryPath}`);
    }
    return this.decompress(archivePath);
  }

  private decompress(archivePath: string): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const gunzip = zlib.createGunzip();
      const fileStream = fs.createReadStream(archivePath);

      fileStream.on('error', reject);
      gunzip.on('error', reject);
      gunzip.on('data', (chunk: Buffer) => chunks.push(chunk));
      gunzip.on('end', () => resolve(Buffer.concat(chunks)));

      fileStream.pipe(gunzip);
    });
  }
}
