import { ArchiveEntry, IArchiveHandler } from '../models';

/**
 * Handles reading .rar archive files using node-unrar-js.
 * Uses a pure-JavaScript WASM-based RAR implementation — no native binaries needed.
 */
export class RarHandler implements IArchiveHandler {
  supports(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.rar');
  }

  async listEntries(archivePath: string): Promise<ArchiveEntry[]> {
    const { createExtractorFromFile } = await import('node-unrar-js');
    const extractor = await createExtractorFromFile({ filepath: archivePath });
    const list = extractor.getFileList();

    const entries: ArchiveEntry[] = [];
    const seenDirs = new Set<string>();

    for (const fileHeader of list.fileHeaders) {
      const entryPath = fileHeader.name.replace(/\\/g, '/');

      // Collect implicit parent directories
      const parts = entryPath.replace(/\/$/, '').split('/');
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

      if (fileHeader.flags.directory) {
        const dp = entryPath.endsWith('/') ? entryPath : entryPath + '/';
        if (!seenDirs.has(dp)) {
          seenDirs.add(dp);
          entries.push({
            path: dp,
            name: parts[parts.length - 1],
            isDirectory: true,
            size: 0
          });
        }
      } else {
        entries.push({
          path: entryPath,
          name: parts[parts.length - 1],
          isDirectory: false,
          size: fileHeader.unpSize,
          compressedSize: fileHeader.packSize
        });
      }
    }

    return entries;
  }

  async readEntry(archivePath: string, entryPath: string): Promise<Buffer> {
    const { createExtractorFromFile } = await import('node-unrar-js');
    const extractor = await createExtractorFromFile({ filepath: archivePath });

    const targetPath = entryPath.replace(/\\/g, '/').replace(/\/$/, '');

    const extracted = extractor.extract({
      files: (fileHeader) => {
        const name = fileHeader.name.replace(/\\/g, '/').replace(/\/$/, '');
        return name === targetPath;
      }
    });

    for (const file of extracted.files) {
      const currentPath = file.fileHeader.name.replace(/\\/g, '/').replace(/\/$/, '');
      if (currentPath === targetPath && file.extraction) {
        return Buffer.from(file.extraction);
      }
    }

    throw new Error(`Entry not found in archive: ${entryPath}`);
  }
}
