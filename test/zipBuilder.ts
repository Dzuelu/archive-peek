import * as zlib from 'zlib';

/** A file to place in a hand-built zip. */
export interface RawZipEntry {
  /** Raw file name bytes (or a string, encoded as UTF-8). */
  name: Buffer | string;
  data: Buffer | string;
  /** Deflate the data (method 8) instead of storing it (method 0). */
  deflate?: boolean;
  /** Set the UTF-8 file name flag (bit 11). */
  utf8?: boolean;
}

/**
 * Build a minimal zip archive byte-for-byte. Used for cases adm-zip can't
 * produce: raw (CP437) name bytes, names with "..", leading "/" or backslashes.
 */
export function buildZip(entries: RawZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = typeof e.name === 'string' ? Buffer.from(e.name, 'utf-8') : e.name;
    const raw = typeof e.data === 'string' ? Buffer.from(e.data) : e.data;
    const data = e.deflate ? zlib.deflateRawSync(raw) : raw;
    const method = e.deflate ? 8 : 0;
    const flags = e.utf8 ? 0x800 : 0;
    const crc = zlib.crc32(raw);
    // 2024-01-01 00:00 in DOS format
    const dosTime = 0;
    const dosDate = ((2024 - 1980) << 9) | (1 << 5) | 1;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralDir, eocd]);
}
