declare module 'adm-zip' {
  class AdmZip {
    constructor(filePath?: string | Buffer);
    getEntries(): AdmZip.IZipEntry[];
    readFile(entry: AdmZip.IZipEntry | string): Buffer | null;
    readAsText(entry: AdmZip.IZipEntry | string, encoding?: string): string;
  }

  namespace AdmZip {
    interface IZipEntry {
      entryName: string;
      name: string;
      isDirectory: boolean;
      comment: string;
      compressedSize: number;
      header: {
        size: number;
        compressedSize: number;
        offset: number;
        time: Date;
      };
    }
  }

  export = AdmZip;
}

declare module 'tar-stream' {
  import { Readable, Writable } from 'stream';

  interface Headers {
    name: string;
    size?: number;
    mode?: number;
    mtime?: Date;
    type?: string;
    linkname?: string;
    uid?: number;
    gid?: number;
    uname?: string;
    gname?: string;
  }

  interface Extract extends Writable {
    on(event: 'entry', listener: (header: Headers, stream: Readable, next: () => void) => void): this;
    on(event: 'finish', listener: () => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
  }

  export function extract(): Extract;
}

declare module 'node-7z' {
  import { Readable } from 'stream';

  interface ListResult {
    file: string;
    attr: string;
    size: number;
    compressed: number;
    date: string;
    time: string;
  }

  interface SevenZipOptions {
    $bin?: string;
    $progress?: boolean;
    recursive?: boolean;
    password?: string;
  }

  export function list(
    archivePath: string,
    options?: SevenZipOptions
  ): Readable & {
    on(event: 'data', listener: (data: ListResult) => void): any;
    on(event: 'end', listener: () => void): any;
    on(event: 'error', listener: (err: Error) => void): any;
  };

  export function extractFull(archivePath: string, outputDir: string, options?: SevenZipOptions): Readable;
  export function extract(archivePath: string, outputDir: string, options?: SevenZipOptions): Readable;
}

declare module '7zip-bin' {
  const path7za: string;
  export = path7za;
}

declare module 'unbzip2-stream' {
  import { Transform } from 'stream';
  function unbzip2Stream(): Transform;
  export = unbzip2Stream;
}

declare module 'xz-decompress' {
  export class XzReadableStream extends ReadableStream<Uint8Array> {
    constructor(input: ReadableStream<Uint8Array>);
  }
}
