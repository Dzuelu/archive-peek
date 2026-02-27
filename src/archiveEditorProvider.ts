import * as vscode from 'vscode';
import * as path from 'path';
import { ArchiveManager, OpenArchive } from './archiveManager';
import { archiveEntryUri } from './archiveFileSystemProvider';

/**
 * Tree node structure passed to the webview as JSON.
 */
interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  children?: TreeNode[];
}

/**
 * CustomReadonlyEditorProvider that shows archive stats and an interactive
 * file browser when an archive is clicked in the Explorer.
 *
 * The file tree is rendered inside the webview so there's no separate
 * sidebar panel — everything is self-contained in the editor tab.
 */
export class ArchiveEditorProvider implements vscode.CustomReadonlyEditorProvider {
  public static readonly viewType = 'archivePeek.archiveEditor';

  constructor(private readonly archiveManager: ArchiveManager) {}

  async openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken
  ): Promise<vscode.CustomDocument> {
    return { uri, dispose: () => {} };
  }

  async resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const archivePath = document.uri.fsPath;
    const fileName = path.basename(archivePath);

    let archive: OpenArchive | undefined;
    try {
      archive = await this.archiveManager.openArchive(archivePath);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to open archive: ${error.message}`);
    }

    const fileCount = archive ? archive.entries.filter((e) => !e.isDirectory).length : 0;
    const dirCount = archive ? archive.entries.filter((e) => e.isDirectory).length : 0;
    const archiveType = archive ? archive.type.toUpperCase() : 'Unknown';
    const totalSize = archive ? archive.entries.reduce((sum, e) => sum + e.size, 0) : 0;

    // Build the tree structure for the webview
    const tree = archive ? this.buildTree(archive) : [];

    webviewPanel.webview.options = { enableScripts: true };
    webviewPanel.webview.html = this.getWebviewHtml(
      fileName,
      archivePath,
      archiveType,
      fileCount,
      dirCount,
      totalSize,
      tree
    );

    // Handle messages from the webview (file open requests)
    webviewPanel.webview.onDidReceiveMessage(async (message) => {
      if (message.command === 'openFile') {
        try {
          const uri = archiveEntryUri(archivePath, message.entryPath);
          const doc = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(doc, {
            preview: true
          });
        } catch (error: any) {
          vscode.window.showErrorMessage(`Failed to open file: ${error.message}`);
        }
      }
    }, undefined);
  }

  /**
   * Build a hierarchical tree from the flat list of archive entries.
   */
  private buildTree(archive: OpenArchive): TreeNode[] {
    const nodeMap: Map<string, TreeNode> = new Map();

    // Ensure all directory nodes exist
    for (const entry of archive.entries) {
      if (entry.isDirectory) {
        this.ensureDir(nodeMap, entry.path.replace(/\/$/, ''));
      }
    }

    // Add files (and ensure their parent directories exist)
    for (const entry of archive.entries) {
      if (!entry.isDirectory) {
        const parts = entry.path.split('/');
        const fileName = parts.pop()!;

        const fileNode: TreeNode = {
          name: fileName,
          path: entry.path,
          isDirectory: false,
          size: entry.size
        };

        if (parts.length === 0) {
          // Root level file
          nodeMap.set(entry.path, fileNode);
        } else {
          const dirPath = parts.join('/');
          const parentNode = this.ensureDir(nodeMap, dirPath);
          if (!parentNode.children!.find((c) => c.path === entry.path)) {
            parentNode.children!.push(fileNode);
          }
        }
      }
    }

    // Collect root-level nodes (no slashes in their path)
    const rootNodes = Array.from(nodeMap.values()).filter((n) => {
      const p = n.path.replace(/\/$/, '');
      return !p.includes('/');
    });

    this.sortTree(rootNodes);
    return rootNodes;
  }

  private ensureDir(nodeMap: Map<string, TreeNode>, dirPath: string): TreeNode {
    const existing = nodeMap.get(dirPath);
    if (existing) {
      return existing;
    }

    const parts = dirPath.split('/');
    const name = parts[parts.length - 1];

    const node: TreeNode = {
      name,
      path: dirPath,
      isDirectory: true,
      size: 0,
      children: []
    };

    nodeMap.set(dirPath, node);

    if (parts.length > 1) {
      // Nested — ensure parent exists and add as child
      const parentPath = parts.slice(0, -1).join('/');
      const parentNode = this.ensureDir(nodeMap, parentPath);
      if (!parentNode.children!.find((c) => c.path === dirPath)) {
        parentNode.children!.push(node);
      }
    }

    return node;
  }

  private sortTree(nodes: TreeNode[]): void {
    nodes.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) {
        return -1;
      }
      if (!a.isDirectory && b.isDirectory) {
        return 1;
      }
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children) {
        this.sortTree(node.children);
      }
    }
  }

  private getWebviewHtml(
    fileName: string,
    filePath: string,
    archiveType: string,
    fileCount: number,
    dirCount: number,
    totalSize: number,
    tree: TreeNode[]
  ): string {
    const treeJson = JSON.stringify(tree);

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(fileName)}</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 16px 24px;
      line-height: 1.5;
      margin: 0;
    }

    /* ── Header ── */
    .header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 20px;
    }
    .icon { font-size: 32px; opacity: 0.8; }
    h1 {
      font-size: 18px;
      font-weight: 600;
      margin: 0;
    }
    .subtitle {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-top: 2px;
      word-break: break-all;
    }

    /* ── Stats ── */
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }
    .stat-card {
      background: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-editorWidget-border, var(--vscode-widget-border, transparent));
      border-radius: 5px;
      padding: 12px;
    }
    .stat-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 2px;
    }
    .stat-value {
      font-size: 18px;
      font-weight: 600;
    }

    /* ── File Tree ── */
    .tree-header {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 8px;
      padding-bottom: 4px;
      border-bottom: 1px solid var(--vscode-editorWidget-border, var(--vscode-widget-border, transparent));
    }
    .tree {
      font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
      font-size: 13px;
    }
    .tree ul {
      list-style: none;
      margin: 0;
      padding-left: 16px;
    }
    .tree > ul {
      padding-left: 0;
    }
    .tree li {
      margin: 0;
    }
    .tree-row {
      display: flex;
      align-items: center;
      padding: 2px 6px;
      cursor: pointer;
      border-radius: 3px;
      user-select: none;
      gap: 4px;
    }
    .tree-row:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .tree-row .chevron {
      width: 16px;
      text-align: center;
      font-size: 12px;
      color: var(--vscode-foreground);
      flex-shrink: 0;
      transition: transform 0.1s ease;
    }
    .tree-row .chevron.expanded {
      transform: rotate(90deg);
    }
    .tree-row .chevron.hidden {
      visibility: hidden;
    }
    .tree-row .node-icon {
      width: 16px;
      text-align: center;
      flex-shrink: 0;
      font-size: 14px;
    }
    .tree-row .node-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tree-row .node-size {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-left: 8px;
      flex-shrink: 0;
    }
    .tree-row.file-row:hover .node-name {
      color: var(--vscode-textLink-foreground);
      text-decoration: underline;
    }
    .tree ul.collapsed {
      display: none;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="icon">📦</div>
    <div>
      <h1>${escapeHtml(fileName)}</h1>
      <div class="subtitle">${escapeHtml(filePath)}</div>
    </div>
  </div>

  <div class="stats">
    <div class="stat-card">
      <div class="stat-label">Format</div>
      <div class="stat-value">${escapeHtml(archiveType)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Files</div>
      <div class="stat-value">${fileCount}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Directories</div>
      <div class="stat-value">${dirCount}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Total Size (uncompressed)</div>
      <div class="stat-value">${formatSize(totalSize)}</div>
    </div>
  </div>

  <div class="tree-header">Contents</div>
  <div class="tree" id="fileTree"></div>

  <script>
    const vscode = acquireVsCodeApi();
    const treeData = ${treeJson};

    function formatSize(bytes) {
      if (bytes === 0) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(1024));
      const size = (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1);
      return size + ' ' + units[i];
    }

    function getFileIcon(name) {
      const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
      const iconMap = {
        'js': '📄', 'ts': '📄', 'jsx': '📄', 'tsx': '📄',
        'json': '📋', 'xml': '📋', 'yaml': '📋', 'yml': '📋', 'toml': '📋',
        'md': '📝', 'txt': '📝', 'rst': '📝',
        'html': '🌐', 'css': '🎨', 'scss': '🎨', 'less': '🎨',
        'py': '📄', 'rb': '📄', 'go': '📄', 'rs': '📄', 'java': '📄',
        'c': '📄', 'cpp': '📄', 'h': '📄', 'hpp': '📄',
        'sh': '⚙️', 'bash': '⚙️', 'zsh': '⚙️', 'bat': '⚙️', 'ps1': '⚙️',
        'png': '🖼️', 'jpg': '🖼️', 'jpeg': '🖼️', 'gif': '🖼️', 'svg': '🖼️', 'ico': '🖼️',
        'zip': '📦', '7z': '📦', 'gz': '📦', 'tar': '📦',
        'lock': '🔒',
      };
      return iconMap[ext] || '📄';
    }

    function buildTreeHtml(nodes, expanded) {
      const ul = document.createElement('ul');
      if (!expanded) ul.classList.add('collapsed');

      for (const node of nodes) {
        const li = document.createElement('li');

        const row = document.createElement('div');
        row.classList.add('tree-row');

        const chevron = document.createElement('span');
        chevron.classList.add('chevron');

        const icon = document.createElement('span');
        icon.classList.add('node-icon');

        const name = document.createElement('span');
        name.classList.add('node-name');
        name.textContent = node.name;

        if (node.isDirectory) {
          chevron.textContent = '▶';
          chevron.classList.add('expanded');
          icon.textContent = '📁';

          row.addEventListener('click', function(e) {
            e.stopPropagation();
            const childUl = li.querySelector(':scope > ul');
            if (childUl) {
              childUl.classList.toggle('collapsed');
              chevron.classList.toggle('expanded');
            }
          });

          row.appendChild(chevron);
          row.appendChild(icon);
          row.appendChild(name);
          li.appendChild(row);

          if (node.children && node.children.length > 0) {
            li.appendChild(buildTreeHtml(node.children, true));
          }
        } else {
          chevron.classList.add('hidden');
          row.classList.add('file-row');
          icon.textContent = getFileIcon(node.name);

          const size = document.createElement('span');
          size.classList.add('node-size');
          size.textContent = node.size > 0 ? formatSize(node.size) : '';

          row.addEventListener('click', function(e) {
            e.stopPropagation();
            vscode.postMessage({ command: 'openFile', entryPath: node.path });
          });

          row.appendChild(chevron);
          row.appendChild(icon);
          row.appendChild(name);
          row.appendChild(size);
          li.appendChild(row);
        }

        ul.appendChild(li);
      }

      return ul;
    }

    const container = document.getElementById('fileTree');
    container.appendChild(buildTreeHtml(treeData, true));
  </script>
</body>
</html>`;
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatSize(bytes: number): string {
  if (bytes === 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1);
  return `${size} ${units[i]}`;
}
