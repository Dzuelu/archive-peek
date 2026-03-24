import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { ArchiveEntry, IArchiveHandler } from '../models';
import { XzReadableStream } from 'xz-decompress';

/**
 * Handles reading plain .xz compressed files.
 * An .xz file contains a single compressed file — this handler exposes it
 * as a one-entry archive whose name is the original filename (sans .xz).
 */
export class XzHandler implements IArchiveHandler {
  supports(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return lower.endsWith('.xz') && !lower.endsWith('.tar.xz');
  }

  /**
   * Derive the inner filename by stripping the .xz extension.
   */
  private getInnerName(archivePath: string): string {
    const base = path.basename(archivePath);
    return base.replace(/\.xz$/i, '') || base;
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
      const fileStream = fs.createReadStream(archivePath);
      const webStream = Readable.toWeb(fileStream) as ReadableStream<Uint8Array>;
      const xzStream = new XzReadableStream(webStream);
      const decompressed = Readable.fromWeb(xzStream as any);

      fileStream.on('error', reject);
      decompressed.on('error', reject);
      decompressed.on('data', (chunk: Buffer) => chunks.push(chunk));
      decompressed.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }
}
