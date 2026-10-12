import { describe, bench } from 'vitest';
import { ZipHandler } from '../src/handlers/zipHandler';
import { ArchiveManager } from '../src/archiveManager';
import { ensureBenchFixtures, LARGE_ZIP, LARGE_ENTRIES, MANY_ZIP, MANY_ENTRIES } from './benchFixtures';

ensureBenchFixtures();

/** Large archives make each iteration slow, so cap the run instead of using the default time budget. */
const SLOW = { time: 2000, iterations: 5, warmupIterations: 1 };

/**
 * Cold benchmarks use a fresh handler each iteration so no state carried
 * over from a previous iteration (e.g. a cached in-memory archive) skews
 * the numbers. Warm benchmarks open once and then measure reads.
 */
describe('Zip: cold open + list', () => {
  bench(
    'large.zip (200 MB, 6 entries)',
    async () => {
      const handler = new ZipHandler();
      await handler.listEntries(LARGE_ZIP);
      handler.dispose(LARGE_ZIP);
    },
    SLOW
  );

  bench(
    'many.zip (50k entries)',
    async () => {
      const handler = new ZipHandler();
      await handler.listEntries(MANY_ZIP);
      handler.dispose(MANY_ZIP);
    },
    SLOW
  );
});

describe('Zip: warm read (archive already listed)', () => {
  const large = new ZipHandler();
  const many = new ZipHandler();
  const ready = Promise.all([large.listEntries(LARGE_ZIP), many.listEntries(MANY_ZIP)]);

  bench('large.zip first small entry', async () => {
    await ready;
    await large.readEntry(LARGE_ZIP, LARGE_ENTRIES.first);
  });

  bench('large.zip 1 MB entry', async () => {
    await ready;
    await large.readEntry(LARGE_ZIP, LARGE_ENTRIES.medium);
  });

  bench(
    'large.zip last 50 MB entry',
    async () => {
      await ready;
      await large.readEntry(LARGE_ZIP, LARGE_ENTRIES.last);
    },
    SLOW
  );

  bench('many.zip first entry', async () => {
    await ready;
    await many.readEntry(MANY_ZIP, MANY_ENTRIES.first);
  });

  bench('many.zip last entry', async () => {
    await ready;
    await many.readEntry(MANY_ZIP, MANY_ENTRIES.last);
  });
});

describe('Zip: time to first file (ArchiveManager open + read + close)', () => {
  bench(
    'large.zip',
    async () => {
      const manager = new ArchiveManager();
      await manager.openArchive(LARGE_ZIP);
      await manager.readEntry(LARGE_ZIP, LARGE_ENTRIES.first);
      manager.closeArchive(LARGE_ZIP);
    },
    SLOW
  );

  bench(
    'many.zip',
    async () => {
      const manager = new ArchiveManager();
      await manager.openArchive(MANY_ZIP);
      await manager.readEntry(MANY_ZIP, MANY_ENTRIES.last);
      manager.closeArchive(MANY_ZIP);
    },
    SLOW
  );
});
