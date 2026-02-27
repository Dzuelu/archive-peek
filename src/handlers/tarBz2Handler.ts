import * as fs from 'fs';
import { ArchiveEntry, IArchiveHandler, StreamCacheCallback } from '../models';
import * as tar from 'tar-stream';

const bz2 = require('unbzip2-stream');

/** Max size of files to opportunistically cache while streaming (1 MB) */
const STREAM_CACHE_THRESHOLD = 1 * 1024 * 1024;

/**
 * Handles reading .tar.bz2 (and .tbz2) archive files using tar-stream + unbzip2-stream.
 * Streams through the archive without writing anything to disk.
 */
export class TarBz2Handler implements IArchiveHandler {
  supports(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return lower.endsWith('.tar.bz2') || lower.endsWith('.tbz2');
  }

  async listEntries(archivePath: string): Promise<ArchiveEntry[]> {
    return new Promise<ArchiveEntry[]>((resolve, reject) => {
      const entries: ArchiveEntry[] = [];
      const seenDirs = new Set<string>();

      const extract = tar.extract();

      extract.on('entry', (header, stream, next) => {
        const entryPath = header.name.replace(/^\.\//, '');
        if (entryPath === '' || entryPath === './') {
          stream.resume();
          next();
          return;
        }

        const parts = entryPath.split('/');
        let dirPath = '';
        for (let i = 0; i < parts.length - 1; i++) {
          if (parts[i] === '') {
            continue;
          }
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

        const isDir = header.type === 'directory';
        if (!isDir) {
          const name = parts[parts.length - 1];
          if (name) {
            entries.push({
              path: entryPath.replace(/\/$/, ''),
              name,
              isDirectory: false,
              size: header.size || 0,
              modifiedTime: header.mtime
            });
          }
        }

        stream.resume();
        next();
      });

      extract.on('finish', () => resolve(entries));
      extract.on('error', reject);

      const fileStream = fs.createReadStream(archivePath);
      const decompressor = bz2();

      fileStream.on('error', reject);
      decompressor.on('error', reject);

      fileStream.pipe(decompressor).pipe(extract);
    });
  }

  async readEntry(archivePath: string, entryPath: string, onExtraEntry?: StreamCacheCallback): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const extract = tar.extract();
      let found = false;

      extract.on('entry', (header, stream, next) => {
        const currentPath = header.name.replace(/^\.\//, '').replace(/\/$/, '');
        const targetPath = entryPath.replace(/^\.\//, '').replace(/\/$/, '');

        if (currentPath === targetPath) {
          found = true;
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', () => {
            resolve(Buffer.concat(chunks));
            next();
          });
          stream.on('error', reject);
        } else if (
          onExtraEntry &&
          header.type === 'file' &&
          header.size != null &&
          header.size > 0 &&
          header.size <= STREAM_CACHE_THRESHOLD
        ) {
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', () => {
            onExtraEntry(currentPath, Buffer.concat(chunks));
            next();
          });
          stream.on('error', () => {
            stream.resume();
            next();
          });
        } else {
          stream.resume();
          next();
        }
      });

      extract.on('finish', () => {
        if (!found) {
          reject(new Error(`Entry not found in archive: ${entryPath}`));
        }
      });
      extract.on('error', reject);

      const fileStream = fs.createReadStream(archivePath);
      const decompressor = bz2();

      fileStream.on('error', reject);
      decompressor.on('error', reject);

      fileStream.pipe(decompressor).pipe(extract);
    });
  }
}
