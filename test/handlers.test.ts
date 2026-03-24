import { describe, it, expect } from 'vitest';
import { ZipHandler } from '../src/handlers/zipHandler';
import { TarHandler } from '../src/handlers/tarHandler';
import { TarGzHandler } from '../src/handlers/tarGzHandler';
import { TarBz2Handler } from '../src/handlers/tarBz2Handler';
import { TarXzHandler } from '../src/handlers/tarXzHandler';
import { GzHandler } from '../src/handlers/gzHandler';
import { Bz2Handler } from '../src/handlers/bz2Handler';
import { XzHandler } from '../src/handlers/xzHandler';
import { IArchiveHandler, ArchiveEntry } from '../src/models';
import { fixture, HELLO_CONTENT, INDEX_TS_CONTENT, PACKAGE_JSON_CONTENT } from './helpers';

/**
 * Shared test suite that validates any IArchiveHandler against
 * the well-known sample fixtures.
 */
function handlerSuite(name: string, handler: IArchiveHandler, archiveFile: string) {
  describe(name, () => {
    describe('supports()', () => {
      it('returns true for matching extension', () => {
        expect(handler.supports(archiveFile)).toBe(true);
      });

      it('returns false for non-matching extension', () => {
        expect(handler.supports('/some/file.unknown')).toBe(false);
      });
    });

    describe('listEntries()', () => {
      let entries: ArchiveEntry[];

      it('lists entries without throwing', async () => {
        entries = await handler.listEntries(fixture(archiveFile));
        expect(entries).toBeDefined();
        expect(entries.length).toBeGreaterThan(0);
      });

      it('contains hello.txt', async () => {
        entries = await handler.listEntries(fixture(archiveFile));
        const hello = entries.find((e) => e.name === 'hello.txt');
        expect(hello).toBeDefined();
        expect(hello!.isDirectory).toBe(false);
        expect(hello!.size).toBeGreaterThan(0);
      });

      it('contains src/ directory', async () => {
        entries = await handler.listEntries(fixture(archiveFile));
        const srcDir = entries.find((e) => e.name === 'src' && e.isDirectory);
        expect(srcDir).toBeDefined();
      });

      it('contains src/index.ts', async () => {
        entries = await handler.listEntries(fixture(archiveFile));
        const indexTs = entries.find((e) => e.name === 'index.ts');
        expect(indexTs).toBeDefined();
        expect(indexTs!.isDirectory).toBe(false);
      });

      it('contains package.json', async () => {
        entries = await handler.listEntries(fixture(archiveFile));
        const pkg = entries.find((e) => e.name === 'package.json');
        expect(pkg).toBeDefined();
        expect(pkg!.isDirectory).toBe(false);
      });
    });

    describe('readEntry()', () => {
      it('reads hello.txt content', async () => {
        const entries = await handler.listEntries(fixture(archiveFile));
        const hello = entries.find((e) => e.name === 'hello.txt' && !e.isDirectory)!;
        const buffer = await handler.readEntry(fixture(archiveFile), hello.path);
        expect(buffer.toString('utf-8')).toBe(HELLO_CONTENT);
      });

      it('reads src/index.ts content', async () => {
        const entries = await handler.listEntries(fixture(archiveFile));
        const indexTs = entries.find((e) => e.name === 'index.ts' && !e.isDirectory)!;
        const buffer = await handler.readEntry(fixture(archiveFile), indexTs.path);
        expect(buffer.toString('utf-8')).toBe(INDEX_TS_CONTENT);
      });

      it('reads package.json content', async () => {
        const entries = await handler.listEntries(fixture(archiveFile));
        const pkg = entries.find((e) => e.name === 'package.json' && !e.isDirectory)!;
        const buffer = await handler.readEntry(fixture(archiveFile), pkg.path);
        expect(buffer.toString('utf-8')).toBe(PACKAGE_JSON_CONTENT);
      });

      it('throws for non-existent entry', async () => {
        await expect(handler.readEntry(fixture(archiveFile), 'does/not/exist.txt')).rejects.toThrow();
      });
    });
  });
}

// Zip
handlerSuite('ZipHandler', new ZipHandler(), 'sample.zip');

// Tar
handlerSuite('TarHandler', new TarHandler(), 'sample.tar');

// Tar.gz
handlerSuite('TarGzHandler', new TarGzHandler(), 'sample.tar.gz');

// Tar.bz2
handlerSuite('TarBz2Handler', new TarBz2Handler(), 'sample.tar.bz2');

// Tar.xz
handlerSuite('TarXzHandler', new TarXzHandler(), 'sample.tar.xz');

// Gz (single-file compression — separate tests since it's not a multi-file archive)
describe('GzHandler', () => {
  const handler = new GzHandler();

  describe('supports()', () => {
    it('returns true for .gz files', () => {
      expect(handler.supports('hello.txt.gz')).toBe(true);
    });

    it('returns false for .tar.gz files', () => {
      expect(handler.supports('sample.tar.gz')).toBe(false);
    });

    it('returns false for non-matching extension', () => {
      expect(handler.supports('/some/file.unknown')).toBe(false);
    });
  });

  describe('listEntries()', () => {
    it('lists a single decompressed entry', async () => {
      const entries = await handler.listEntries(fixture('hello.txt.gz'));
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('hello.txt');
      expect(entries[0].isDirectory).toBe(false);
      expect(entries[0].size).toBeGreaterThan(0);
    });
  });

  describe('readEntry()', () => {
    it('reads the decompressed content', async () => {
      const buffer = await handler.readEntry(fixture('hello.txt.gz'), 'hello.txt');
      expect(buffer.toString('utf-8')).toBe(HELLO_CONTENT);
    });

    it('throws for non-existent entry', async () => {
      await expect(handler.readEntry(fixture('hello.txt.gz'), 'wrong.txt')).rejects.toThrow();
    });
  });
});

// Bz2 (single-file compression)
describe('Bz2Handler', () => {
  const handler = new Bz2Handler();

  describe('supports()', () => {
    it('returns true for .bz2 files', () => {
      expect(handler.supports('hello.txt.bz2')).toBe(true);
    });

    it('returns false for .tar.bz2 files', () => {
      expect(handler.supports('sample.tar.bz2')).toBe(false);
    });

    it('returns false for non-matching extension', () => {
      expect(handler.supports('/some/file.unknown')).toBe(false);
    });
  });

  describe('listEntries()', () => {
    it('lists a single decompressed entry', async () => {
      const entries = await handler.listEntries(fixture('hello.txt.bz2'));
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('hello.txt');
      expect(entries[0].isDirectory).toBe(false);
      expect(entries[0].size).toBeGreaterThan(0);
    });
  });

  describe('readEntry()', () => {
    it('reads the decompressed content', async () => {
      const buffer = await handler.readEntry(fixture('hello.txt.bz2'), 'hello.txt');
      expect(buffer.toString('utf-8')).toBe(HELLO_CONTENT);
    });

    it('throws for non-existent entry', async () => {
      await expect(handler.readEntry(fixture('hello.txt.bz2'), 'wrong.txt')).rejects.toThrow();
    });
  });
});

// Xz (single-file compression)
describe('XzHandler', () => {
  const handler = new XzHandler();

  describe('supports()', () => {
    it('returns true for .xz files', () => {
      expect(handler.supports('hello.txt.xz')).toBe(true);
    });

    it('returns false for .tar.xz files', () => {
      expect(handler.supports('sample.tar.xz')).toBe(false);
    });

    it('returns false for non-matching extension', () => {
      expect(handler.supports('/some/file.unknown')).toBe(false);
    });
  });

  describe('listEntries()', () => {
    it('lists a single decompressed entry', async () => {
      const entries = await handler.listEntries(fixture('hello.txt.xz'));
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('hello.txt');
      expect(entries[0].isDirectory).toBe(false);
      expect(entries[0].size).toBeGreaterThan(0);
    });
  });

  describe('readEntry()', () => {
    it('reads the decompressed content', async () => {
      const buffer = await handler.readEntry(fixture('hello.txt.xz'), 'hello.txt');
      expect(buffer.toString('utf-8')).toBe(HELLO_CONTENT);
    });

    it('throws for non-existent entry', async () => {
      await expect(handler.readEntry(fixture('hello.txt.xz'), 'wrong.txt')).rejects.toThrow();
    });
  });
});

// Zip variants — test that ZipHandler supports the new extensions
describe('ZipHandler additional extensions', () => {
  const handler = new ZipHandler();

  it('supports .whl files', () => {
    expect(handler.supports('package-1.0.whl')).toBe(true);
  });

  it('supports .xpi files', () => {
    expect(handler.supports('addon.xpi')).toBe(true);
  });

  it('supports .epub files', () => {
    expect(handler.supports('book.epub')).toBe(true);
  });

  it('supports .aar files', () => {
    expect(handler.supports('library.aar')).toBe(true);
  });
});
