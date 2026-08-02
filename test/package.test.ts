import { test, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUNDLERS, pkg } from './manifest.ts';

test('every entry point resolves into dist', () => {
  for (const [name, entry] of Object.entries(pkg.exports)) {
    if (name === './package.json') continue;

    expect(typeof entry, name).toBe('object');
    const conditions = entry as Record<string, string>;
    expect(conditions.types, `${name} must ship types`).toMatch(/^\.\/dist\/.+\.d\.mts$/);
    expect(conditions.default, `${name} must resolve to an esm build`).toMatch(/^\.\/dist\/.+\.mjs$/);
  }
});

test('every bundler entry module is exported, and every exported bundler has a module', async () => {
  const modules = (await readdir(new URL('../src/bundlers/', import.meta.url))).map(name => name.replace(/\.ts$/, ''));

  expect(BUNDLERS.slice().sort()).toEqual(modules.sort());
});

test('the wasm artifact is reachable from exactly one module', async () => {
  const root = fileURLToPath(new URL('../src/', import.meta.url));
  const entries = await readdir(root, { recursive: true, withFileTypes: true });

  const reaching = await Promise.all(
    entries
      .filter(entry => entry.isFile())
      .map(async entry => {
        const source = await readFile(join(entry.parentPath, entry.name), 'utf8');
        return source.includes('slang-wasm.js') ? entry.name : null;
      }),
  );

  expect(reaching.filter(Boolean)).toEqual(['vendor.ts']);
});

test('the published tarball ships the compiler and its licences', () => {
  expect(pkg.files).toContain('dist');
  expect(pkg.files).toContain('vendor');
});
