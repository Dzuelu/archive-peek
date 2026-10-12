import * as vscode from 'vscode';
import * as path from 'path';
import { ArchiveChangeEvent, ArchiveManager } from './archiveManager';

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
export class ArchiveFileSystemProvider implements vscode.FileSystemProvider, vscode.Disposable {
  private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this._onDidChangeFile.event;
  private subscription: { dispose(): void };

  constructor(private archiveManager: ArchiveManager) {
    this.subscription = archiveManager.onDidChangeArchive((event) => this.onArchiveChanged(event));
  }

  watch(): vscode.Disposable {
    // Change notifications are driven by ArchiveManager events (see ArchiveWatcher)
    return new vscode.Disposable(() => {});
  }

  /**
   * Translate an archive-level change into file change events for the
   * archive root and any of its entries currently open in an editor.
   * Only open resources are notified so large archives don't flood VS Code.
   */
  private onArchiveChanged(event: ArchiveChangeEvent): void {
    if (event.type !== 'changed' && event.type !== 'deleted') {
      return;
    }

    const rootUri = archiveRootUri(event.filePath);
    const changes: vscode.FileChangeEvent[] = [
      { type: event.type === 'deleted' ? vscode.FileChangeType.Deleted : vscode.FileChangeType.Changed, uri: rootUri }
    ];

    const remaining = event.type === 'changed' ? new Set(event.archive.entries.map((e) => e.path)) : new Set();
    for (const uri of openArchiveUris(rootUri.authority)) {
      const { entryPath } = decodeArchiveUri(uri);
      if (entryPath === '') {
        continue;
      }
      changes.push({
        type: remaining.has(entryPath) ? vscode.FileChangeType.Changed : vscode.FileChangeType.Deleted,
        uri
      });
    }

    this._onDidChangeFile.fire(changes);
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const { archivePath, entryPath } = decodeArchiveUri(uri);

    // Ensure archive is loaded
    try {
      await this.archiveManager.openArchive(archivePath);
    } catch (_error) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    const archive = this.archiveManager.getArchive(archivePath);
    if (!archive) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    // Report times no older than the archive file itself. Entry timestamps
    // are often fixed (reproducible builds) or missing, and VS Code skips
    // reloading an open document whose mtime hasn't moved.
    const ctime = archive.diskMtime;
    const mtimeOf = (entryTime?: Date) => Math.max(entryTime?.getTime() ?? 0, archive.diskMtime);

    // Root of archive
    if (entryPath === '') {
      return {
        type: vscode.FileType.Directory,
        ctime,
        mtime: archive.diskMtime,
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
          ctime,
          mtime: archive.diskMtime,
          size: 0
        };
      }
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    if (entry.isDirectory) {
      return {
        type: vscode.FileType.Directory,
        ctime,
        mtime: mtimeOf(entry.modifiedTime),
        size: 0
      };
    }

    return {
      type: vscode.FileType.File,
      ctime,
      mtime: mtimeOf(entry.modifiedTime),
      size: entry.size
    };
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const { archivePath, entryPath } = decodeArchiveUri(uri);

    try {
      await this.archiveManager.openArchive(archivePath);
    } catch (_error) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
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

  dispose(): void {
    this.subscription.dispose();
    this._onDidChangeFile.dispose();
  }
}

/**
 * Collect archive:// URIs for the given archive (by URI authority) that are
 * currently open as text documents or editor tabs.
 */
function openArchiveUris(authority: string): vscode.Uri[] {
  const uris = new Map<string, vscode.Uri>();
  const add = (uri: vscode.Uri | undefined) => {
    if (uri && uri.scheme === ARCHIVE_SCHEME && uri.authority === authority) {
      uris.set(uri.toString(), uri);
    }
  };

  for (const doc of vscode.workspace.textDocuments) {
    add(doc.uri);
  }
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom) {
        add(input.uri);
      } else if (input instanceof vscode.TabInputTextDiff) {
        add(input.original);
        add(input.modified);
      }
    }
  }
  return [...uris.values()];
}
