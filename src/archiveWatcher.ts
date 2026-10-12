import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ArchiveManager } from './archiveManager';

/** Setting that enables/disables automatic refresh of changed archives. */
export const AUTO_REFRESH_SETTING = 'archivePeek.autoRefresh';

/** How long to wait after the last file event before re-reading (build tools write in bursts). */
const DEBOUNCE_MS = 300;

/**
 * Watches opened archives on disk and asks the ArchiveManager to re-read
 * them when they change, or to forget them when they are deleted.
 *
 * Each archive gets its own watcher scoped to that single file. Watching
 * continues after a deletion so an archive that is rebuilt later (e.g.
 * `make clean && make`) is picked up again; it stops when the archive is
 * explicitly closed.
 */
export class ArchiveWatcher implements vscode.Disposable {
  private watchers = new Map<string, vscode.FileSystemWatcher>();
  private timers = new Map<string, NodeJS.Timeout>();
  private disposables: vscode.Disposable[] = [];
  private enabled: boolean;

  constructor(private readonly archiveManager: ArchiveManager) {
    this.enabled = ArchiveWatcher.isEnabled();

    this.disposables.push(
      archiveManager.onDidChangeArchive((event) => {
        if (event.type === 'opened') {
          this.watch(event.filePath);
        } else if (event.type === 'closed') {
          this.unwatch(event.filePath);
        }
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(AUTO_REFRESH_SETTING)) {
          this.setEnabled(ArchiveWatcher.isEnabled());
        }
      })
    );

    for (const archive of archiveManager.getOpenArchives()) {
      this.watch(archive.filePath);
    }
  }

  private static isEnabled(): boolean {
    return vscode.workspace.getConfiguration().get<boolean>(AUTO_REFRESH_SETTING, true);
  }

  private setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) {
      return;
    }
    this.enabled = enabled;
    if (enabled) {
      for (const archive of this.archiveManager.getOpenArchives()) {
        this.watch(archive.filePath);
      }
    } else {
      for (const filePath of [...this.watchers.keys()]) {
        this.unwatch(filePath);
      }
    }
  }

  private watch(filePath: string): void {
    if (!this.enabled || this.watchers.has(filePath)) {
      return;
    }

    const pattern = new vscode.RelativePattern(
      vscode.Uri.file(path.dirname(filePath)),
      escapeGlob(path.basename(filePath))
    );
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const onEvent = (uri: vscode.Uri) => {
      if (path.resolve(uri.fsPath) === filePath) {
        this.schedule(filePath);
      }
    };
    watcher.onDidCreate(onEvent);
    watcher.onDidChange(onEvent);
    watcher.onDidDelete(onEvent);
    this.watchers.set(filePath, watcher);
  }

  private unwatch(filePath: string): void {
    this.watchers.get(filePath)?.dispose();
    this.watchers.delete(filePath);
    this.clearTimer(filePath);
  }

  private schedule(filePath: string): void {
    this.clearTimer(filePath);
    this.timers.set(
      filePath,
      setTimeout(() => {
        this.timers.delete(filePath);
        void this.sync(filePath);
      }, DEBOUNCE_MS)
    );
  }

  private clearTimer(filePath: string): void {
    const timer = this.timers.get(filePath);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(filePath);
    }
  }

  /**
   * Reconcile the manager with the archive's current state on disk.
   * Acting on disk state (rather than the event kind) handles atomic
   * temp-file-and-rename writes, which arrive as delete + create.
   */
  private async sync(filePath: string): Promise<void> {
    const exists = await fs.promises.stat(filePath).then(
      () => true,
      () => false
    );

    if (!exists) {
      this.archiveManager.markDeleted(filePath);
      return;
    }

    try {
      await this.archiveManager.refreshIfChanged(filePath);
    } catch (_error) {
      // Most likely the archive is still being written. The previous
      // contents are kept, and the next change event will retry.
    }
  }

  dispose(): void {
    for (const filePath of [...this.watchers.keys()]) {
      this.unwatch(filePath);
    }
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}

/** Escape glob metacharacters so a file name matches literally. */
function escapeGlob(name: string): string {
  return name.replace(/[[{}*?]/g, '[$&]');
}
