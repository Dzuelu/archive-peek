# Archive Peek for VS Code

Peek inside archive files directly in VS Code — without extracting them to disk. Simply click an archive in the Explorer and get an interactive file browser with stats, right inside the editor.

![Archive Peek screenshot](screenshot.png)

## Supported Formats

| Format       | Extension(s)              | Library Used              |
|--------------|---------------------------|---------------------------|
| ZIP          | `.zip`                    | adm-zip                   |
| JAR          | `.jar`, `.war`, `.ear`    | adm-zip                   |
| VS Code Ext  | `.vsix`                   | adm-zip                   |
| NuGet        | `.nupkg`                  | adm-zip                   |
| Android      | `.apk`                    | adm-zip                   |
| Tar          | `.tar`                    | tar-stream                |
| Tar.gz       | `.tar.gz`, `.tgz`         | tar-stream + zlib          |
| Tar.bz2      | `.tar.bz2`, `.tbz2`       | tar-stream + unbzip2-stream|
| Tar.xz       | `.tar.xz`, `.txz`         | tar-stream + xz-decompress |
| RAR          | `.rar`                    | node-unrar-js              |
| 7-Zip        | `.7z`                     | node-7z + 7zip-bin         |

## Features

- **Click to browse** — click any archive in the Explorer and it opens an interactive file tree with stats in the editor
- **Open files inline** — click any file in the archive tree to view its contents in VS Code (read-only)
- **No extraction** — files are read directly from the archive stream, nothing written to disk
- **No sidebar clutter** — everything lives in the editor tab, no extra panels
- **16 file extensions** — covers ZIP-based, tar variants, RAR, and 7z out of the box
- **Context menu integration** — right-click archive files in the Explorer for quick access

## Usage

1. Click any supported archive file in the VS Code Explorer
2. The archive opens in an editor tab showing format info, file/directory counts, total size, and a browsable file tree
3. Click any file in the tree to view its contents

You can also right-click an archive and select **Open Archive**, or use the command palette: `Archive Peek: Open Archive`.

## Commands

| Command                          | Description                                |
|----------------------------------|--------------------------------------------|
| `Archive Peek: Open Archive`    | Open an archive file for browsing          |
| `Archive Peek: Refresh`          | Re-read all opened archives                |
| `Archive Peek: Close Archive`    | Close an opened archive                    |

## Development

```bash
# Install dependencies
npm install

# Validate - Compile + lint
npm run validate

# Watch mode
npm run watch
```

Press **F5** to launch the Extension Development Host.

## Requirements

- VS Code 1.85.0+
- For `.7z` support: the bundled `7zip-bin` package provides the 7z binary
- For `.tar.bz2` support: `unbzip2-stream`
- For `.tar.xz` support: `xz-decompress` (pure JS/WASM — no native binaries needed)
- For `.rar` support: `node-unrar-js` (pure JS/WASM — no native binaries needed)
