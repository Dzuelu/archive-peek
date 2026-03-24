import * as fs from 'fs';
import * as path from 'path';
import { ArchiveEntry, IArchiveHandler } from '../models';

const bz2 = require('unbzip2-stream');

/**
 * Handles reading plain .bz2 (bzip2) compressed files.
 * A .bz2 file contains a single compressed file — this handler exposes it
 * as a one-entry archive whose name is the original filename (sans .bz2).
 */
export class Bz2Handler implements IArchiveHandler {
  supports(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return lower.endsWith('.bz2') && !lower.endsWith('.tar.bz2');
  }

  /**
   * Derive the inner filename by stripping the .bz2 extension.
   */
  private getInnerName(archivePath: string): string {
    const base = path.basename(archivePath);
    return base.replace(/\.bz2$/i, '') || base;
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
      const decompressor = bz2();
      const fileStream = fs.createReadStream(archivePath);

      fileStream.on('error', reject);
      decompressor.on('error', reject);
      decompressor.on('data', (chunk: Buffer) => chunks.push(chunk));
      decompressor.on('end', () => resolve(Buffer.concat(chunks)));

      fileStream.pipe(decompressor);
    });
  }
}
