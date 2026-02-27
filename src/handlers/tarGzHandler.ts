import * as fs from 'fs';
import * as zlib from 'zlib';
import { ArchiveEntry, IArchiveHandler, StreamCacheCallback } from '../models';
import * as tar from 'tar-stream';

/** Max size of files to opportunistically cache while streaming (1 MB) */
const STREAM_CACHE_THRESHOLD = 1 * 1024 * 1024;

/**
 * Handles reading .tar.gz (and .tgz) archive files using tar-stream + zlib.
 * Streams through the archive to list entries or extract a single file's contents
 * without writing anything to disk.
 */
export class TarGzHandler implements IArchiveHandler {
  supports(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return lower.endsWith('.tar.gz') || lower.endsWith('.tgz');
  }

  async listEntries(archivePath: string): Promise<ArchiveEntry[]> {
    return new Promise<ArchiveEntry[]>((resolve, reject) => {
      const entries: ArchiveEntry[] = [];
      const seenDirs = new Set<string>();

      const extract = tar.extract();

      extract.on('entry', (header, stream, next) => {
        // Collect implicit parent directories
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

        // We must consume the stream even though we don't need data for listing
        stream.resume();
        next();
      });

      extract.on('finish', () => resolve(entries));
      extract.on('error', reject);

      const fileStream = fs.createReadStream(archivePath);
      const gunzip = zlib.createGunzip();

      fileStream.on('error', reject);
      gunzip.on('error', reject);

      fileStream.pipe(gunzip).pipe(extract);
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
      const gunzip = zlib.createGunzip();

      fileStream.on('error', reject);
      gunzip.on('error', reject);

      fileStream.pipe(gunzip).pipe(extract);
    });
  }
}
