import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import AdmZip from 'adm-zip';

/**
 * Large archives used by the benchmarks. They are generated once into the
 * OS temp directory (not committed) and reused across runs. Bump
 * FIXTURE_VERSION when changing their contents so stale copies are rebuilt.
 */
const FIXTURE_VERSION = 1;
export const BENCH_DIR = path.join(os.tmpdir(), `archive-peek-bench-v${FIXTURE_VERSION}`);

/** ~200 MB archive with a few large, incompressible files. */
export const LARGE_ZIP = path.join(BENCH_DIR, 'large.zip');
export const LARGE_ENTRIES = {
  first: 'readme.txt',
  medium: 'medium.bin',
  last: 'blobs/blob3.bin'
};

/** Archive with 50,000 small files in nested directories. */
export const MANY_ZIP = path.join(BENCH_DIR, 'many.zip');
export const MANY_FILE_COUNT = 50_000;
export const MANY_ENTRIES = {
  first: manyEntryPath(0),
  last: manyEntryPath(MANY_FILE_COUNT - 1)
};

function manyEntryPath(i: number): string {
  return `dir${Math.floor(i / 500)}/sub${Math.floor(i / 50) % 10}/file${i}.txt`;
}

/** Deterministic pseudo-random bytes (xorshift32) so fixtures are reproducible. */
function pseudoRandomBytes(size: number, seed: number): Buffer {
  const buf = Buffer.allocUnsafe(size);
  let x = seed || 1;
  for (let i = 0; i + 4 <= size; i += 4) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    buf.writeUInt32LE(x >>> 0, i);
  }
  buf.fill(0, size - (size % 4));
  return buf;
}

function writeAtomically(target: string, build: () => Buffer): void {
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, build());
  fs.renameSync(tmp, target);
}

/** Create the benchmark archives if they don't exist yet. */
export function ensureBenchFixtures(): void {
  fs.mkdirSync(BENCH_DIR, { recursive: true });

  if (!fs.existsSync(LARGE_ZIP)) {
    writeAtomically(LARGE_ZIP, () => {
      const zip = new AdmZip();
      zip.addFile(LARGE_ENTRIES.first, Buffer.from('Large benchmark archive\n'));
      zip.addFile(LARGE_ENTRIES.medium, pseudoRandomBytes(1024 * 1024, 7));
      for (let i = 0; i < 4; i++) {
        zip.addFile(`blobs/blob${i}.bin`, pseudoRandomBytes(50 * 1024 * 1024, 100 + i));
      }
      return zip.toBuffer();
    });
  }

  if (!fs.existsSync(MANY_ZIP)) {
    writeAtomically(MANY_ZIP, () => {
      const zip = new AdmZip();
      for (let i = 0; i < MANY_FILE_COUNT; i++) {
        zip.addFile(manyEntryPath(i), Buffer.from(`file ${i}\n`.repeat(25)));
      }
      return zip.toBuffer();
    });
  }
}
