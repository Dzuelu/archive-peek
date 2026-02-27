import * as vscode from 'vscode';
import * as path from 'path';
import { ArchiveManager } from './archiveManager';
import { ArchiveFileSystemProvider, ARCHIVE_SCHEME } from './archiveFileSystemProvider';
import { ArchiveEditorProvider } from './archiveEditorProvider';

let archiveManager: ArchiveManager;
let fsProvider: ArchiveFileSystemProvider;

export function activate(context: vscode.ExtensionContext) {
  archiveManager = new ArchiveManager();
  fsProvider = new ArchiveFileSystemProvider(archiveManager);

  // Register the virtual filesystem for the archive:/ scheme
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(ARCHIVE_SCHEME, fsProvider, {
      isCaseSensitive: true,
      isReadonly: true
    })
  );

  // Register the custom editor — clicking an archive opens stats + embedded file tree
  const editorProvider = new ArchiveEditorProvider(archiveManager);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(ArchiveEditorProvider.viewType, editorProvider, {
      webviewOptions: { retainContextWhenHidden: false },
      supportsMultipleEditorsPerDocument: false
    })
  );

  // ─── Command: Open Archive ───────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('archivePeek.openArchive', async (uri?: vscode.Uri) => {
      let archivePath: string;

      if (uri) {
        archivePath = uri.fsPath;
      } else {
        const result = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          openLabel: 'Open Archive',
          filters: {
            Archives: [
              'zip',
              '7z',
              'rar',
              'tar',
              'tar.gz',
              'tgz',
              'tar.bz2',
              'tbz2',
              'tar.xz',
              'txz',
              'jar',
              'war',
              'ear',
              'vsix',
              'nupkg',
              'apk'
            ],
            'ZIP Files': ['zip', 'jar', 'war', 'ear', 'vsix', 'nupkg', 'apk'],
            '7-Zip Files': ['7z'],
            'RAR Files': ['rar'],
            'Tar Files': ['tar', 'tar.gz', 'tgz', 'tar.bz2', 'tbz2', 'tar.xz', 'txz'],
            'All Files': ['*']
          }
        });

        if (!result || result.length === 0) {
          return;
        }
        archivePath = result[0].fsPath;
      }

      if (!archiveManager.isSupported(archivePath)) {
        vscode.window.showErrorMessage(`Unsupported archive format: ${path.basename(archivePath)}`);
        return;
      }

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Opening archive: ${path.basename(archivePath)}`,
            cancellable: false
          },
          async () => {
            await archiveManager.openArchive(archivePath);
          }
        );

        // Open the archive in the custom editor
        await vscode.commands.executeCommand(
          'vscode.openWith',
          uri ?? vscode.Uri.file(archivePath),
          ArchiveEditorProvider.viewType
        );
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to open archive: ${error.message}`);
      }
    })
  );

  // ─── Command: Refresh ────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('archivePeek.refresh', async () => {
      const archives = archiveManager.getOpenArchives();
      for (const archive of archives) {
        try {
          await archiveManager.refreshArchive(archive.filePath);
        } catch (error: any) {
          vscode.window.showWarningMessage(`Failed to refresh ${path.basename(archive.filePath)}: ${error.message}`);
        }
      }
    })
  );

  // ─── Command: Close Archive (from command palette) ───────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('archivePeek.closeArchive', async () => {
      const archives = archiveManager.getOpenArchives();
      if (archives.length === 0) {
        vscode.window.showInformationMessage('No archives are currently open.');
        return;
      }

      const picked = await vscode.window.showQuickPick(
        archives.map((a) => ({
          label: path.basename(a.filePath),
          description: a.filePath,
          archivePath: a.filePath
        })),
        { placeHolder: 'Select an archive to close' }
      );

      if (!picked) {
        return;
      }
      archiveManager.closeArchive(picked.archivePath);
    })
  );
}

export function deactivate() {
  // Nothing to clean up
}
