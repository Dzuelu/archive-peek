import { describe, bench } from 'vitest';
import { ZipHandler } from '../src/handlers/zipHandler';
import { TarHandler } from '../src/handlers/tarHandler';
import { TarGzHandler } from '../src/handlers/tarGzHandler';
import { TarBz2Handler } from '../src/handlers/tarBz2Handler';
import { TarXzHandler } from '../src/handlers/tarXzHandler';
import { ArchiveManager } from '../src/archiveManager';
import { BufferCache } from '../src/bufferCache';
import { fixture } from './helpers';

describe('Handler: listEntries', () => {
  const zip = new ZipHandler();
  const tar = new TarHandler();
  const targz = new TarGzHandler();
  const tarbz2 = new TarBz2Handler();
  const tarxz = new TarXzHandler();

  bench('ZipHandler.listEntries', async () => {
    await zip.listEntries(fixture('sample.zip'));
  });

  bench('TarHandler.listEntries', async () => {
    await tar.listEntries(fixture('sample.tar'));
  });

  bench('TarGzHandler.listEntries', async () => {
    await targz.listEntries(fixture('sample.tar.gz'));
  });

  bench('TarBz2Handler.listEntries', async () => {
    await tarbz2.listEntries(fixture('sample.tar.bz2'));
  });

  bench('TarXzHandler.listEntries', async () => {
    await tarxz.listEntries(fixture('sample.tar.xz'));
  });
});

describe('Handler: readEntry', () => {
  const zip = new ZipHandler();
  const tar = new TarHandler();
  const targz = new TarGzHandler();
  const tarbz2 = new TarBz2Handler();
  const tarxz = new TarXzHandler();

  bench('ZipHandler.readEntry', async () => {
    await zip.readEntry(fixture('sample.zip'), 'hello.txt');
  });

  bench('TarHandler.readEntry', async () => {
    await tar.readEntry(fixture('sample.tar'), 'hello.txt');
  });

  bench('TarGzHandler.readEntry', async () => {
    await targz.readEntry(fixture('sample.tar.gz'), 'hello.txt');
  });

  bench('TarBz2Handler.readEntry', async () => {
    await tarbz2.readEntry(fixture('sample.tar.bz2'), 'hello.txt');
  });

  bench('TarXzHandler.readEntry', async () => {
    await tarxz.readEntry(fixture('sample.tar.xz'), 'hello.txt');
  });
});

describe('ArchiveManager: open + read cycle', () => {
  bench('open zip + read entry', async () => {
    const manager = new ArchiveManager();
    await manager.openArchive(fixture('sample.zip'));
    await manager.readEntry(fixture('sample.zip'), 'hello.txt');
  });

  bench('open tar.gz + read entry', async () => {
    const manager = new ArchiveManager();
    await manager.openArchive(fixture('sample.tar.gz'));
    await manager.readEntry(fixture('sample.tar.gz'), 'hello.txt');
  });

  bench('open tar.xz + read entry', async () => {
    const manager = new ArchiveManager();
    await manager.openArchive(fixture('sample.tar.xz'));
    await manager.readEntry(fixture('sample.tar.xz'), 'hello.txt');
  });
});

describe('BufferCache', () => {
  bench('set + get (hit)', () => {
    const cache = new BufferCache();
    const buf = Buffer.alloc(1024);
    cache.set('/a.zip', 'file.txt', buf);
    cache.get('/a.zip', 'file.txt');
  });

  bench('set with LRU eviction', () => {
    const cache = new BufferCache(1024);
    for (let i = 0; i < 20; i++) {
      cache.set('/a.zip', `file${i}.txt`, Buffer.alloc(100));
    }
  });

  bench('evictArchive', () => {
    const cache = new BufferCache();
    for (let i = 0; i < 100; i++) {
      cache.set('/a.zip', `file${i}.txt`, Buffer.alloc(64));
    }
    cache.evictArchive('/a.zip');
  });
});
