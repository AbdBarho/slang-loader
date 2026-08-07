import { fileURLToPath } from 'node:url';

import { test, expect } from 'vitest';

import { slangFactory, type SlangPluginOptions } from '../src/plugin.ts';
import { slang } from '../src/unplugin.ts';
import { APPLY_ONLY, BUNDLERS, NOT_CONSTRUCTIBLE_UNDER_NODE, compute } from './manifest.ts';

interface CapturedError {
  message: string;
  id?: string;
  plugin?: string;
  loc?: { file?: string; line: number; column: number };
}

interface TransformHook {
  filter: { id: { include: RegExp; exclude: RegExp[] } };
  handler: (this: unknown, code: string, id: string) => Promise<{ code: string } | null>;
}

function context() {
  const errors: CapturedError[] = [];
  const watched: string[] = [];
  return {
    errors,
    watched,
    error(error: CapturedError) {
      errors.push(error);
    },
    addWatchFile(id: string) {
      watched.push(id);
    },
  };
}

const COMPUTE = compute(16);

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url)).replace(/\\/g, '/');

function transformOf(options?: SlangPluginOptions): TransformHook {
  return slangFactory(options).transform as unknown as TransformHook;
}

test('transforms a .slang import into a WGSL module', async () => {
  const result = await transformOf().handler.call(context(), COMPUTE, '/src/shader.slang');

  expect(result?.code).toMatch(/export default code/);
  expect(result?.code).toMatch(/@workgroup_size\(16, 1, 1\)/);
  expect(result?.code).toMatch(/export const entryPoints =/);
  expect(result?.code).toMatch(/export const reflection =/);
});

test('the emitted module carries no reference back to the compiler', async () => {
  const result = await transformOf().handler.call(context(), COMPUTE, '/src/shader.slang');

  expect(result?.code).not.toMatch(/slang-loader|vendor|slang-wasm|\bimport\b/);
});

test('the declared id filter selects .slang and skips passthrough queries', () => {
  const { include, exclude } = transformOf().filter.id;
  const matches = (id: string) => include.test(id) && !exclude.some(pattern => pattern.test(id));

  expect(matches('/src/shader.slang')).toBe(true);
  expect(matches('/src/shader.slang?used')).toBe(true);
  expect(matches('/src/main.js')).toBe(false);
  expect(matches('/src/shader.slang?raw')).toBe(false);
  expect(matches('/src/shader.slang?url')).toBe(false);
});

test('a user-supplied exclude is added to the passthrough queries, not swapped for them', () => {
  const { exclude } = transformOf({ exclude: /generated/ }).filter.id;

  expect(exclude).toHaveLength(2);
  expect(exclude.some(pattern => pattern.test('/src/shader.slang?raw'))).toBe(true);
  expect(exclude.some(pattern => pattern.test('/src/generated/shader.slang'))).toBe(true);
});

test('reports a compile error the host can locate and frame', async () => {
  const ctx = context();

  const transformed = transformOf().handler.call(ctx, 'void f( { }', '/src/broken.slang');
  await expect(transformed).rejects.toThrow();

  expect(ctx.errors[0]).toMatchObject({
    plugin: 'slang-loader',
    id: '/src/broken.slang',
    loc: { file: '/src/broken.slang', line: 1, column: 9 },
  });
});

test('registers imported shaders as watch files', async () => {
  const ctx = context();
  const entry = `import util;\n[shader("compute")][numthreads(2,1,1)]\nvoid main(uint3 t : SV_DispatchThreadID, uniform RWStructuredBuffer<float> o) { o[t.x] = scaleBy(1.0); }`;

  const result = await transformOf().handler.call(ctx, entry, `${FIXTURES}entry.slang`);

  expect(result?.code).toMatch(/\* 21\.0f/);
  expect(ctx.watched).toEqual([`${FIXTURES}util.slang`]);
});

test('watches nothing extra for a single-file shader', async () => {
  const ctx = context();

  await transformOf().handler.call(ctx, COMPUTE, `${FIXTURES}solo.slang`);

  expect(ctx.watched).toEqual([]);
});

test('every supported bundler gets a plugin from the same factory', () => {
  const targets = slang as unknown as Record<string, () => { name?: string; apply?: unknown }>;

  for (const bundler of BUNDLERS) {
    if (NOT_CONSTRUCTIBLE_UNDER_NODE.includes(bundler)) {
      expect(typeof targets[bundler], bundler).toBe('function');
      continue;
    }

    const plugin = targets[bundler]?.();
    if (APPLY_ONLY.includes(bundler)) expect(typeof plugin?.apply, bundler).toBe('function');
    else expect(plugin?.name, bundler).toBe('slang-loader');
  }
});
