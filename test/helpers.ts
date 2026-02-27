import * as path from 'path';

/** Absolute path to the test/fixtures directory */
export const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');

/** Get absolute path to a fixture file */
export function fixture(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

/** Known contents of hello.txt in our test fixtures */
export const HELLO_CONTENT = 'Hello, World!\n';

/** Known contents of src/index.ts in our test fixtures */
export const INDEX_TS_CONTENT = 'export const version = "1.0.0";\n';

/** Known contents of package.json in our test fixtures */
export const PACKAGE_JSON_CONTENT = '{"name":"test"}\n';
