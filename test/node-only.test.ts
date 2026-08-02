import { test, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
  exports: Record<string, Record<string, string>>;
  files: string[];
};

test('every entry point resolves to the guard outside Node', () => {
  for (const [name, entry] of Object.entries(pkg.exports)) {
    if (name === './package.json') continue;

    const conditions = Object.keys(entry);
    expect(entry.default, `${name} must fall back to the browser guard`).toBe('./dist/browser.mjs');
    expect(entry.node, `${name} must have a node condition`).toMatch(/^\.\/dist\//);
    expect(conditions.indexOf('node'), `${name} must list "node" before "default"`).toBeLessThan(
      conditions.indexOf('default'),
    );
  }
});

test('the guard throws on import instead of pulling in the compiler', async () => {
  await expect(import('../src/browser.js')).rejects.toThrow(/never reach a client bundle/);
});

test('the wasm artifact is reachable from exactly one module', async () => {
  const dir = new URL('../src/', import.meta.url);
  const files = await readdir(dir);

  const referencing: string[] = [];
  for (const file of files) {
    const source = await readFile(new URL(file, dir), 'utf8');
    if (source.includes('slang-wasm.js')) referencing.push(file);
  }

  expect(referencing).toEqual(['wasm.ts']);
});

test('the published tarball ships the compiler and its licences', () => {
  expect(pkg.files).toContain('dist');
  expect(pkg.files).toContain('vendor');
});
