import * as vscode from 'vscode';
import * as path from 'path';
import { ArchiveManager } from './archiveManager';

/**
 * URI scheme for archive virtual filesystem.
 *
 * URI format: archive://<hex-encoded-archive-path>/<archive-filename>/<entry-path>
 *
 * The archive's absolute disk path is hex-encoded into the URI authority,
 * and the path contains the human-readable archive filename followed by
 * the entry path. This makes VS Code display clean tab titles like
 * "myarchive.zip/src/index.ts" instead of hex gibberish.
 *
 * Hex encoding is used instead of base64 to avoid characters like = and +
 * that get mangled by Uri.parse().
 *
 * Example:
 *   archive://2f55736572732f...7a6970/archive.zip           → root of archive
 *   archive://2f55736572732f...7a6970/archive.zip/src/index.ts  → file inside
 */
export const ARCHIVE_SCHEME = 'archive';

/**
 * Build a URI for the root of an archive.
 */
export function archiveRootUri(archivePath: string): vscode.Uri {
  const resolved = path.resolve(archivePath);
  const encoded = Buffer.from(resolved).toString('hex');
  const archiveName = path.basename(resolved);
  return vscode.Uri.from({ scheme: ARCHIVE_SCHEME, authority: encoded, path: `/${archiveName}` });
}

/**
 * Build a URI for a specific entry inside an archive.
 */
export function archiveEntryUri(archivePath: string, entryPath: string): vscode.Uri {
  const resolved = path.resolve(archivePath);
  const encoded = Buffer.from(resolved).toString('hex');
  const archiveName = path.basename(resolved);
  return vscode.Uri.from({
    scheme: ARCHIVE_SCHEME,
    authority: encoded,
    path: `/${archiveName}/${entryPath}`
  });
}

/**
 * Decode an archive URI back into the archive disk path and entry path.
 */
export function decodeArchiveUri(uri: vscode.Uri): { archivePath: string; entryPath: string } {
  const archivePath = Buffer.from(uri.authority, 'hex').toString('utf-8');

  // path is like: /<archive-filename>/<entry-path>
  // Strip leading slash and the archive filename segment
  const fullPath = uri.path.startsWith('/') ? uri.path.slice(1) : uri.path;
  const slashIndex = fullPath.indexOf('/');

  const entryPath = slashIndex === -1 ? '' : fullPath.slice(slashIndex + 1);

  return { archivePath, entryPath };
}

/**
 * A read-only FileSystemProvider that exposes archive contents as a virtual
 * filesystem. Archives appear as expandable folders in the VS Code Explorer.
 */
export class ArchiveFileSystemProvider implements vscode.FileSystemProvider {
  private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this._onDidChangeFile.event;

  constructor(private archiveManager: ArchiveManager) {}

  watch(): vscode.Disposable {
    // Archives are static — no file watching needed
    return new vscode.Disposable(() => {});
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const { archivePath, entryPath } = decodeArchiveUri(uri);

    // Ensure archive is loaded
    await this.archiveManager.openArchive(archivePath);
    const archive = this.archiveManager.getArchive(archivePath);
    if (!archive) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    // Root of archive
    if (entryPath === '') {
      return {
        type: vscode.FileType.Directory,
        ctime: 0,
        mtime: 0,
        size: 0
      };
    }

    // Look up the entry
    const entry = archive.entries.find((e) => {
      const normalized = e.path.replace(/\/$/, '');
      return normalized === entryPath || normalized === entryPath.replace(/\/$/, '');
    });

    if (!entry) {
      // Could be an implicit directory that wasn't listed as an entry
      // Check if any entries start with this path prefix
      const prefix = entryPath.endsWith('/') ? entryPath : entryPath + '/';
      const hasChildren = archive.entries.some((e) => e.path.startsWith(prefix));
      if (hasChildren) {
        return {
          type: vscode.FileType.Directory,
          ctime: 0,
          mtime: 0,
          size: 0
        };
      }
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    if (entry.isDirectory) {
      return {
        type: vscode.FileType.Directory,
        ctime: 0,
        mtime: entry.modifiedTime?.getTime() ?? 0,
        size: 0
      };
    }

    return {
      type: vscode.FileType.File,
      ctime: 0,
      mtime: entry.modifiedTime?.getTime() ?? 0,
      size: entry.size
    };
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const { archivePath, entryPath } = decodeArchiveUri(uri);

    await this.archiveManager.openArchive(archivePath);
    const archive = this.archiveManager.getArchive(archivePath);
    if (!archive) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    const children = this.archiveManager.getChildren(archive, entryPath);

    // Sort: directories first, then alphabetically
    children.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) {
        return -1;
      }
      if (!a.isDirectory && b.isDirectory) {
        return 1;
      }
      return a.name.localeCompare(b.name);
    });

    return children.map((child) => [child.name, child.isDirectory ? vscode.FileType.Directory : vscode.FileType.File]);
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const { archivePath, entryPath } = decodeArchiveUri(uri);

    if (entryPath === '') {
      throw vscode.FileSystemError.FileIsADirectory(uri);
    }

    try {
      const buffer = await this.archiveManager.readEntry(archivePath, entryPath);
      return new Uint8Array(buffer);
    } catch (_error: any) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
  }

  // ─── Read-only: all write operations throw ──────────────────────────

  createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions('Archive is read-only');
  }

  writeFile(): void {
    throw vscode.FileSystemError.NoPermissions('Archive is read-only');
  }

  delete(): void {
    throw vscode.FileSystemError.NoPermissions('Archive is read-only');
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions('Archive is read-only');
  }
}
