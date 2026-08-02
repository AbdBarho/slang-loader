import { describe, test, expect } from 'vitest';
import { existsSync } from 'node:fs';

import { APPLY_ONLY, BUNDLERS, NOT_CONSTRUCTIBLE_UNDER_NODE, compute, pkg } from './manifest.ts';

const DIST = new URL('../dist/', import.meta.url);
const built = existsSync(DIST);

describe.skipIf(!built)('the built package', () => {
  const load = (name: string) => import(new URL(`${name}.mjs`, DIST).href);

  test('every exports entry points at files that exist', () => {
    for (const [name, entry] of Object.entries(pkg.exports)) {
      if (typeof entry === 'string') continue;
      for (const [condition, file] of Object.entries(entry)) {
        expect(existsSync(new URL(file, new URL('../', DIST))), `${name} → ${condition}`).toBe(true);
      }
    }
  });

  test.each(BUNDLERS.filter(name => !NOT_CONSTRUCTIBLE_UNDER_NODE.includes(name)))(
    '%s builds a plugin from dist',
    async bundler => {
      const plugin = (await load(bundler)).default() as { name?: string; apply?: unknown };

      if (APPLY_ONLY.includes(bundler)) expect(typeof plugin.apply).toBe('function');
      else expect(plugin.name).toBe('slang-loader');
    },
  );

  test('the raw unplugin instance exposes every target', async () => {
    const { slang } = await load('unplugin');

    expect(typeof slang.raw).toBe('function');
    for (const target of BUNDLERS) {
      expect(typeof slang[target], target).toBe('function');
    }
  });

  test('the core entry compiles through the bundled wasm', async () => {
    const { compile, SLANG_VERSION } = await load('index');
    const result = await compile(compute(8), { path: '/dist-smoke.slang' });

    expect(SLANG_VERSION).toMatch(/^\d{4}\./);
    expect(result.code).toMatch(/@workgroup_size\(8, 1, 1\)/);
    expect(result.entryPoints).toHaveLength(1);
  });
});
