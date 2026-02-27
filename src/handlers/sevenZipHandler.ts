import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { ArchiveEntry, IArchiveHandler } from '../models';
import { list as sevenList } from 'node-7z';
import sevenBin = require('7zip-bin');
import { execFile } from 'child_process';

/**
 * Handles reading .7z archive files using node-7z + 7zip-bin.
 * Lists entries via the 7z list command and extracts individual file contents
 * to a temp location to read them, then cleans up.
 */
export class SevenZipHandler implements IArchiveHandler {
  private readonly binPath: string;

  constructor() {
    this.binPath = sevenBin;
  }

  supports(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.7z');
  }

  async listEntries(archivePath: string): Promise<ArchiveEntry[]> {
    return new Promise<ArchiveEntry[]>((resolve, reject) => {
      const entries: ArchiveEntry[] = [];
      const seenDirs = new Set<string>();

      const listStream = sevenList(archivePath, { $bin: this.binPath });

      listStream.on('data', (data) => {
        const entryPath = data.file;
        const isDir = data.attr?.startsWith('D') ?? false;

        // Collect implicit parent directories
        const parts = entryPath.split(/[/\\]/);
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

        if (!isDir) {
          const name = parts[parts.length - 1];
          if (name) {
            entries.push({
              path: entryPath.replace(/\\/g, '/'),
              name,
              isDirectory: false,
              size: data.size || 0,
              compressedSize: data.compressed || 0
            });
          }
        }
      });

      listStream.on('end', () => resolve(entries));
      listStream.on('error', (err: Error) => reject(err));
    });
  }

  async readEntry(archivePath: string, entryPath: string): Promise<Buffer> {
    // 7z doesn't support streaming a single file easily; extract to a temp dir
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-peek-'));

    try {
      await new Promise<void>((resolve, reject) => {
        execFile(this.binPath, ['e', archivePath, entryPath, `-o${tmpDir}`, '-y', '-r'], (error) => {
          if (error) {
            reject(new Error(`Failed to extract entry: ${error.message}`));
          } else {
            resolve();
          }
        });
      });

      // The extracted file will be in tmpDir with just its filename
      const fileName = path.basename(entryPath);
      const extractedPath = path.join(tmpDir, fileName);

      if (!fs.existsSync(extractedPath)) {
        throw new Error(`Entry not found in archive: ${entryPath}`);
      }

      const data = fs.readFileSync(extractedPath);
      return data;
    } finally {
      // Cleanup temp directory
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}
