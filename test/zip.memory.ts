import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as v8 from 'v8';
import * as vm from 'vm';
import { ZipHandler } from '../src/handlers/zipHandler';
import { ensureBenchFixtures, LARGE_ZIP, LARGE_ENTRIES, MANY_ZIP, MANY_ENTRIES } from './benchFixtures';

/**
 * Measures memory retained by the ZipHandler while an archive is open.
 * Run with `npm run bench:memory`. Set BENCH_LABEL to name the run; results
 * are written to bench-results/memory-<label>.json, and compared against
 * bench-results/memory-baseline.json when it exists.
 */

v8.setFlagsFromString('--expose-gc');
const gc: () => void = vm.runInNewContext('gc');

const RESULTS_DIR = path.resolve(__dirname, '..', 'bench-results');
const LABEL = process.env.BENCH_LABEL ?? 'current';

interface Snapshot {
  heapUsed: number;
  arrayBuffers: number;
}

type Row = Record<string, number>;

/** Collect garbage until memory settles; external buffers are released asynchronously. */
async function snapshot(): Promise<Snapshot> {
  for (let i = 0; i < 3; i++) {
    gc();
    await new Promise((resolve) => setImmediate(resolve));
  }
  const m = process.memoryUsage();
  return { heapUsed: m.heapUsed, arrayBuffers: m.arrayBuffers };
}

const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;

function delta(after: Snapshot, before: Snapshot): Row {
  return {
    'heap MB': mb(after.heapUsed - before.heapUsed),
    'buffers MB': mb(after.arrayBuffers - before.arrayBuffers)
  };
}

async function measure(archivePath: string, reads: string[]): Promise<Record<string, Row>> {
  const handler = new ZipHandler();
  const before = await snapshot();

  const entries = await handler.listEntries(archivePath);
  const afterList = await snapshot();

  for (const entry of reads) {
    await handler.readEntry(archivePath, entry);
  }
  const afterReads = await snapshot();

  handler.dispose(archivePath);
  const afterDispose = await snapshot();

  expect(entries.length).toBeGreaterThan(0);
  return {
    'after list': delta(afterList, before),
    'after reads': delta(afterReads, before),
    'after dispose': delta(afterDispose, before)
  };
}

describe('ZipHandler retained memory', () => {
  it('measures large.zip and many.zip', async () => {
    ensureBenchFixtures();

    const results: Record<string, Record<string, Row>> = {
      'large.zip': await measure(LARGE_ZIP, [LARGE_ENTRIES.first, LARGE_ENTRIES.medium, LARGE_ENTRIES.last]),
      'many.zip': await measure(MANY_ZIP, [MANY_ENTRIES.first, MANY_ENTRIES.last])
    };

    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(RESULTS_DIR, `memory-${LABEL}.json`), JSON.stringify(results, null, 2));

    const baselinePath = path.join(RESULTS_DIR, 'memory-baseline.json');
    const baseline =
      LABEL !== 'baseline' && fs.existsSync(baselinePath)
        ? JSON.parse(fs.readFileSync(baselinePath, 'utf-8'))
        : undefined;

    for (const [archive, stages] of Object.entries(results)) {
      const rows: Record<string, Row> = {};
      for (const [stage, row] of Object.entries(stages)) {
        rows[stage] = { ...row };
        if (baseline?.[archive]?.[stage]) {
          rows[stage]['baseline heap MB'] = baseline[archive][stage]['heap MB'];
          rows[stage]['baseline buffers MB'] = baseline[archive][stage]['buffers MB'];
        }
      }
      console.log(`\n${archive} (${LABEL})`);
      console.table(rows);
    }
  });
});
