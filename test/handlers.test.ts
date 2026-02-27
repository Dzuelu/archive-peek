import { describe, it, expect } from 'vitest';
import { ZipHandler } from '../src/handlers/zipHandler';
import { TarHandler } from '../src/handlers/tarHandler';
import { TarGzHandler } from '../src/handlers/tarGzHandler';
import { TarBz2Handler } from '../src/handlers/tarBz2Handler';
import { TarXzHandler } from '../src/handlers/tarXzHandler';
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
